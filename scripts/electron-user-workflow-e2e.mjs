import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { testEditorHistory } from './electron-editor-history-e2e.mjs';
import { testEditorKeyboard } from './electron-editor-keyboard-e2e.mjs';
import { testEditorPaste } from './electron-editor-paste-e2e.mjs';

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9224;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-user-flow-'));
const userDataPath = path.join(tempRoot, 'user-data');
const projectPath = path.join(tempRoot, 'project');
const contentMarker = 'P3.10 persistent node content';

await fs.mkdir(userDataPath, { recursive: true });
await fs.mkdir(projectPath, { recursive: true });
await fs.writeFile(path.join(userDataPath, 'pisi-settings.json'), JSON.stringify({ lastProjectFolder: projectPath }, null, 2), 'utf8');

const args = ['--remote-debugging-port=' + port, ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), repoRoot];
const child = spawn(electronPath, args, {
    cwd: repoRoot,
    env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        PISI_TEST_USER_DATA: userDataPath
    },
    stdio: ['ignore', 'pipe', 'pipe']
});

let logs = '';
const collect = (chunk) => {
    const text = String(chunk || '');
    logs += text;
    process.stdout.write(text);
};
child.stdout?.on('data', collect);
child.stderr?.on('data', collect);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(label, probe, timeoutMs = 15000) {
    const started = Date.now();
    let lastValue = null;

    while (Date.now() - started < timeoutMs) {
        if (child.exitCode !== null) {
            throw new Error('Electron exited while waiting for ' + label + '.\n' + logs);
        }

        try {
            lastValue = await probe();
            if (lastValue) return lastValue;
        } catch {}

        await sleep(120);
    }

    throw new Error('Timed out waiting for ' + label + '. Last value: ' + JSON.stringify(lastValue) + '\n' + logs);
}

async function waitForPage(timeoutMs = 15000) {
    return waitUntil(
        'Electron DevTools page',
        async () => {
            try {
                const response = await fetch('http://127.0.0.1:' + port + '/json/list');
                if (!response.ok) return null;
                const pages = await response.json();
                return pages.find((item) => item.type === 'page' && String(item.url || '').startsWith('file:')) || null;
            } catch {
                return null;
            }
        },
        timeoutMs
    );
}

class CdpClient {
    constructor(url) {
        this.socket = new WebSocket(url);
        this.nextId = 1;
        this.pending = new Map();
    }

    async open() {
        if (this.socket.readyState === WebSocket.OPEN) return;
        await new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
        this.socket.addEventListener('message', (event) => {
            const payload = JSON.parse(String(event.data));
            if (!payload.id) return;
            const pending = this.pending.get(payload.id);
            if (!pending) return;
            this.pending.delete(payload.id);
            if (payload.error) {
                pending.reject(new Error(payload.error.message));
            } else {
                pending.resolve(payload.result);
            }
        });
    }

    request(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const response = await this.request('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true
        });
        if (response.exceptionDetails) {
            throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Renderer evaluation failed');
        }
        return response.result?.value;
    }

    close() {
        this.socket.close();
    }
}

async function waitForRendererState(cdp, timeoutMs = 15000) {
    return waitUntil(
        'interactive renderer',
        async () => {
            const state = await cdp.evaluate(
                '(() => ({ readyState: document.readyState, currentProjectFolder: window.currentProjectFolder || null, tagsBound: document.querySelector(\'[data-right-tab=\\"tags\\"]\')?.dataset.bound || null }))()'
            );
            return state?.readyState === 'complete' && state.currentProjectFolder && state.tagsBound === '1' ? state : null;
        },
        timeoutMs
    );
}

async function listProjectFiles() {
    return fs.readdir(projectPath);
}

async function waitForNewProjectFile(extension, previousNames) {
    const previous = new Set(previousNames);
    return waitUntil('new ' + extension + ' file', async () => {
        const names = await listProjectFiles();
        const created = names.find((name) => name.endsWith(extension) && !previous.has(name));
        return created ? path.join(projectPath, created) : null;
    });
}

async function waitForTreePath(cdp, targetPath) {
    const serializedPath = JSON.stringify(targetPath);
    return waitUntil('tree item ' + targetPath, async () => {
        return cdp.evaluate(
            "(() => Array.from(document.querySelectorAll('.tree-node[data-path]')).some((node) => node.dataset.path === " + serializedPath + '))()'
        );
    });
}

async function clickTreePath(cdp, targetPath) {
    const serializedPath = JSON.stringify(targetPath);
    const clicked = await cdp.evaluate(
        "(() => { const node = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((candidate) => candidate.dataset.path === " +
            serializedPath +
            "); const row = node?.querySelector(':scope > .tree-row'); if (!row) return false; row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })); return true; })()"
    );
    if (!clicked) throw new Error('Tree row could not be clicked: ' + targetPath);
}

async function closeTab(cdp, targetPath) {
    const serializedPath = JSON.stringify(targetPath);
    const closed = await cdp.evaluate(
        "(() => { const tab = Array.from(document.querySelectorAll('.center-tab')).find((candidate) => candidate.title === " +
            serializedPath +
            "); const close = tab?.querySelector('.center-tab-close'); if (!close) return false; close.click(); return true; })()"
    );
    if (!closed) throw new Error('Open tab could not be closed: ' + targetPath);

    await waitUntil('tab close ' + targetPath, async () => {
        return cdp.evaluate("(() => !Array.from(document.querySelectorAll('.center-tab')).some((candidate) => candidate.title === " + serializedPath + '))()');
    });
}

async function readNodeContent(nodePath) {
    const raw = await fs.readFile(nodePath, 'utf8');
    return JSON.parse(raw)?.content || '';
}

function assertNoFatalRendererLog() {
    const fatalPatterns = [/Uncaught Error:/i, /ReferenceError:/i, /TypeError:/i, /SyntaxError:/i, /ERR_MODULE_NOT_FOUND/i, /Renderer process crashed/i];
    const fatal = fatalPatterns.find((pattern) => pattern.test(logs));
    if (fatal) {
        throw new Error('Renderer log contains fatal error matching ' + fatal + '\n' + logs);
    }
}

let cdp;
try {
    const page = await waitForPage();
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.request('Runtime.enable');

    const startup = await waitForRendererState(cdp);
    if (path.resolve(startup.currentProjectFolder) !== path.resolve(projectPath)) {
        throw new Error('User-flow E2E did not restore the expected project.');
    }

    const filesBeforeNode = await listProjectFiles();
    const nodeButtonClicked = await cdp.evaluate(
        "(() => { const button = document.getElementById('add-node-btn'); if (!button) return false; button.click(); return true; })()"
    );
    if (!nodeButtonClicked) throw new Error('Add Node button is missing.');

    const nodePath = await waitForNewProjectFile('.node', filesBeforeNode);
    await waitForTreePath(cdp, nodePath);
    await clickTreePath(cdp, nodePath);

    await waitUntil('center node editor open', async () => {
        return cdp.evaluate(
            "(() => { const activePath = window.Pisi?.state?.activeTabPath || null; const wrapper = document.getElementById('center-node-editor'); return activePath === " +
                JSON.stringify(nodePath) +
                ' && wrapper?.hidden === false; })()'
        );
    });

    const editorFocused = await cdp.evaluate(
        "(() => { const editor = document.getElementById('center-node-editor-content'); if (!editor) return false; editor.focus(); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return document.activeElement === editor; })()"
    );
    if (!editorFocused) throw new Error('Center node editor could not receive focus.');

    await cdp.request('Input.insertText', { text: contentMarker });

    await waitUntil('typed node content', async () => {
        return cdp.evaluate("document.getElementById('center-node-editor-content')?.textContent?.includes(" + JSON.stringify(contentMarker) + ') === true');
    });

    const saveShortcutDispatched = await cdp.evaluate(
        "(() => { const editor = document.getElementById('center-node-editor-content'); if (!editor) return false; editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 's', ctrlKey: true })); return true; })()"
    );
    if (!saveShortcutDispatched) throw new Error('Center node Ctrl+S shortcut could not be dispatched.');

    await waitUntil('node content persisted to disk', async () => {
        try {
            return (await readNodeContent(nodePath)).includes(contentMarker);
        } catch {
            return false;
        }
    });

    await testEditorHistory(cdp);
    await testEditorKeyboard(cdp);
    await testEditorPaste(cdp);
    await cdp.evaluate(`window.setPisiEditorContent(document.getElementById('center-node-editor-content'), ${JSON.stringify(contentMarker)})`);
    await cdp.evaluate(`document.getElementById('center-node-editor-content').dispatchEvent(new Event('input', { bubbles: true }))`);
    await closeTab(cdp, nodePath);
    await waitForTreePath(cdp, nodePath);
    await clickTreePath(cdp, nodePath);

    await waitUntil('node content restored after reopen', async () => {
        return cdp.evaluate("document.getElementById('center-node-editor-content')?.textContent?.includes(" + JSON.stringify(contentMarker) + ') === true');
    });
    await closeTab(cdp, nodePath);

    const filesBeforeMap = await listProjectFiles();
    const mapButtonClicked = await cdp.evaluate(
        "(() => { const button = document.getElementById('add-map-btn'); if (!button) return false; button.click(); return true; })()"
    );
    if (!mapButtonClicked) throw new Error('Add Map button is missing.');

    const mapPath = await waitForNewProjectFile('.map', filesBeforeMap);
    await waitForTreePath(cdp, mapPath);
    await waitForTreePath(cdp, nodePath);

    const treeDropStarted = await cdp.evaluate(
        "(() => { const sourceNode = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((candidate) => candidate.dataset.path === " +
            JSON.stringify(nodePath) +
            "); const targetNode = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((candidate) => candidate.dataset.path === " +
            JSON.stringify(mapPath) +
            "); const sourceRow = sourceNode?.querySelector(':scope > .tree-row'); const targetRow = targetNode?.querySelector(':scope > .tree-row'); if (!sourceRow || !targetRow) return false; const dataTransfer = new DataTransfer(); sourceRow.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer })); targetRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer })); targetRow.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })); sourceRow.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer })); return true; })()"
    );
    if (!treeDropStarted) throw new Error('Node-to-map tree drag could not be dispatched.');

    const movedNode = await waitUntil('node moved under map', async () => {
        const result = await cdp.evaluate(
            '(async () => { const listed = await window.pisiProject?.listMapNodes?.(' +
                JSON.stringify(mapPath) +
                '); const node = Array.isArray(listed?.nodes) ? listed.nodes.find((item) => item?.fullPath) : null; return node ? { ok: listed.ok === true, fullPath: node.fullPath, id: node.id } : null; })()'
        );
        return result?.ok && result.fullPath ? result : null;
    });

    if (path.resolve(movedNode.fullPath) === path.resolve(nodePath)) {
        throw new Error('Tree drag reported success but the node path did not move into the map sidecar.');
    }

    await waitUntil('tree refresh after node-to-map drop', async () => {
        return cdp.evaluate(
            "(() => { const paths = Array.from(document.querySelectorAll('.tree-node[data-path]')).map((node) => node.dataset.path); return !paths.includes(" +
                JSON.stringify(nodePath) +
                ') && paths.includes(' +
                JSON.stringify(mapPath) +
                '); })()'
        );
    });

    await waitForTreePath(cdp, mapPath);
    await clickTreePath(cdp, mapPath);

    await waitUntil('map workspace active', async () => {
        return cdp.evaluate(
            '(() => window.Pisi?.state?.activeTabPath === ' + JSON.stringify(mapPath) + " && document.getElementById('map-canvas')?.hidden === false)()"
        );
    });

    const beforeDrag = await waitUntil('map node visible', async () => {
        return cdp.evaluate(
            "(() => { const box = Array.from(document.querySelectorAll('.map-node-box[data-node-path]')).find((candidate) => candidate.dataset.nodePath === " +
                JSON.stringify(movedNode.fullPath) +
                "); if (!box) return null; return { x: Number.parseFloat(box.style.left || '0'), y: Number.parseFloat(box.style.top || '0') }; })()"
        );
    });

    const afterDrag = await cdp.evaluate(
        "(() => { const box = Array.from(document.querySelectorAll('.map-node-box[data-node-path]')).find((candidate) => candidate.dataset.nodePath === " +
            JSON.stringify(movedNode.fullPath) +
            "); if (!box) return null; const rect = box.getBoundingClientRect(); const startX = rect.left + 24; const startY = rect.top + 24; box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: startX, clientY: startY })); window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, clientX: startX + 96, clientY: startY + 54 })); window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: startX + 96, clientY: startY + 54 })); return { x: Number.parseFloat(box.style.left || '0'), y: Number.parseFloat(box.style.top || '0') }; })()"
    );

    if (!afterDrag || Math.abs(afterDrag.x - beforeDrag.x) < 40 || Math.abs(afterDrag.y - beforeDrag.y) < 20) {
        throw new Error('Map node drag did not change layout enough: ' + JSON.stringify({ beforeDrag, afterDrag }));
    }

    await sleep(700);
    await closeTab(cdp, mapPath);
    await waitForTreePath(cdp, mapPath);
    await clickTreePath(cdp, mapPath);

    const reopenedLayout = await waitUntil('persisted map layout after reopen', async () => {
        return cdp.evaluate(
            "(() => { const box = Array.from(document.querySelectorAll('.map-node-box[data-node-path]')).find((candidate) => candidate.dataset.nodePath === " +
                JSON.stringify(movedNode.fullPath) +
                "); if (!box) return null; return { x: Number.parseFloat(box.style.left || '0'), y: Number.parseFloat(box.style.top || '0') }; })()"
        );
    });

    if (Math.abs(reopenedLayout.x - afterDrag.x) > 2 || Math.abs(reopenedLayout.y - afterDrag.y) > 2) {
        throw new Error('Map layout did not persist after close/reopen: ' + JSON.stringify({ afterDrag, reopenedLayout }));
    }

    const persistedMapNode = await cdp.evaluate(
        '(async () => { const listed = await window.pisiProject?.listMapNodes?.(' +
            JSON.stringify(mapPath) +
            '); const node = Array.isArray(listed?.nodes) ? listed.nodes.find((item) => item?.id === ' +
            JSON.stringify(movedNode.id) +
            ') : null; return node ? { ok: listed.ok === true, fullPath: node.fullPath, layout: node.layout } : null; })()'
    );

    if (!persistedMapNode?.ok || path.resolve(persistedMapNode.fullPath) !== path.resolve(movedNode.fullPath)) {
        throw new Error('Moved map node was not persisted by the main-process store: ' + JSON.stringify(persistedMapNode));
    }

    assertNoFatalRendererLog();
    console.log('[E2E] User workflow passed: create node, type/save, close/reopen, create map, drag node into map, move layout, and reopen persistence.');
} finally {
    cdp?.close();
    if (child.exitCode === null) {
        child.kill('SIGTERM');
        await sleep(400);
        if (child.exitCode === null) child.kill('SIGKILL');
    }
    await fs.rm(tempRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200
    });
}
