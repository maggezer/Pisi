import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// A background or occluded test window must still run timers, animation frames and
// layout at full speed (Windows CI runners keep the window behind other desktops).
const PISI_E2E_CHROMIUM_FLAGS = [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'
];

// Legacy sync is configured in settings but disabled by its feature flag, so it
// must never reload the project behind the user. An explicit reload of the same
// project must first write pending saves and then keep tabs, note and caret.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9226;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-sync-reload-')));
const userDataPath = path.join(tempRoot, 'user-data');
const projectPath = path.join(tempRoot, 'project');
const sharedPath = path.join(tempRoot, 'shared');

// Mirrors projectKey() in main/functions/sync-domain.js.
const projectKey = crypto.createHash('sha256').update(path.resolve(projectPath).toLowerCase()).digest('hex').slice(0, 24);

await fs.mkdir(userDataPath, { recursive: true });
await fs.mkdir(projectPath, { recursive: true });
await fs.mkdir(sharedPath, { recursive: true });
await fs.writeFile(
    path.join(userDataPath, 'pisi-settings.json'),
    JSON.stringify(
        {
            lastProjectFolder: projectPath,
            pisiSync: {
                deviceId: 'device_e2e_sync_reload',
                deviceName: 'E2E',
                projects: { [projectKey]: { projectPath, folderPath: sharedPath } }
            }
        },
        null,
        2
    ),
    'utf8'
);

const args = [
    '--remote-debugging-port=' + port,
    ...PISI_E2E_CHROMIUM_FLAGS,
    ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []),
    repoRoot
];
const child = spawn(electronPath, args, {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', PISI_TEST_USER_DATA: userDataPath },
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
        if (child.exitCode !== null) throw new Error('Electron exited while waiting for ' + label + '.\n' + logs);
        try {
            lastValue = await probe();
            if (lastValue) return lastValue;
        } catch {}
        await sleep(120);
    }
    throw new Error('Timed out waiting for ' + label + '. Last value: ' + JSON.stringify(lastValue) + '\n' + logs);
}

async function waitForPage() {
    return waitUntil('Electron DevTools page', async () => {
        try {
            const response = await fetch('http://127.0.0.1:' + port + '/json/list');
            if (!response.ok) return null;
            const pages = await response.json();
            return pages.find((item) => item.type === 'page' && String(item.url || '').startsWith('file:')) || null;
        } catch {
            return null;
        }
    });
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
            if (payload.error) pending.reject(new Error(payload.error.message));
            else pending.resolve(payload.result);
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
        const response = await this.request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (response.exceptionDetails) {
            throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Renderer evaluation failed');
        }
        return response.result?.value;
    }

    close() {
        this.socket.close();
    }
}

async function readNodeContent(nodePath) {
    return JSON.parse(await fs.readFile(nodePath, 'utf8'))?.content || '';
}

async function exists(targetPath) {
    return fs
        .access(targetPath)
        .then(() => true)
        .catch(() => false);
}

function assert(condition, message, detail) {
    if (!condition) throw new Error(message + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
}

async function createNode(cdp) {
    const before = new Set(await fs.readdir(projectPath));
    const clicked = await cdp.evaluate(
        "(() => { const button = document.getElementById('add-node-btn'); if (!button) return false; button.click(); return true; })()"
    );
    assert(clicked, 'Add Node button is missing');
    const nodePath = await waitUntil('new node file', async () => {
        const created = (await fs.readdir(projectPath)).find((name) => name.endsWith('.node') && !before.has(name));
        return created ? path.join(projectPath, created) : null;
    });
    const serialized = JSON.stringify(nodePath);
    await waitUntil('tree item ' + nodePath, () =>
        cdp.evaluate("Array.from(document.querySelectorAll('.tree-node[data-path]')).some((node) => node.dataset.path === " + serialized + ')')
    );
    return nodePath;
}

async function openNode(cdp, nodePath) {
    const serialized = JSON.stringify(nodePath);
    const clicked = await cdp.evaluate(
        "(() => { const node = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((candidate) => candidate.dataset.path === " +
            serialized +
            "); const row = node?.querySelector(':scope > .tree-row'); if (!row) return false; row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })); return true; })()"
    );
    assert(clicked, 'Tree row could not be clicked', nodePath);
    await waitUntil('center editor for ' + nodePath, () =>
        cdp.evaluate(editorStateExpression).then((state) => state.activeTabPath === nodePath && state.visible)
    );
}

const editorStateExpression = `(() => {
    const editor = document.getElementById('center-node-editor-content');
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    let textBeforeCaret = null;
    if (range && editor?.contains(range.startContainer)) {
        const block = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement)?.closest('.pisi-editor-block');
        if (block) {
            const prefix = document.createRange();
            prefix.selectNodeContents(block);
            prefix.setEnd(range.startContainer, range.startOffset);
            textBeforeCaret = prefix.toString();
        }
    }
    return {
        visible: document.getElementById('center-node-editor')?.hidden === false,
        activeTabPath: window.Pisi?.state?.activeTabPath || null,
        centerPath: window.activeCenterNode?.path || null,
        tabs: (window.Pisi?.state?.openTabs || []).map((tab) => tab.path),
        text: editor?.textContent || '',
        caretCollapsed: Boolean(range?.collapsed),
        textBeforeCaret
    };
})()`;

async function typeAtEnd(cdp, text) {
    const focused = await cdp.evaluate(
        "(() => { const editor = document.getElementById('center-node-editor-content'); if (!editor) return false; editor.focus(); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return document.activeElement === editor; })()"
    );
    assert(focused, 'Center editor could not receive focus');
    await cdp.request('Input.insertText', { text });
}

let cdp;
try {
    const page = await waitForPage();
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.request('Runtime.enable');
    await waitUntil('project restored', () =>
        cdp.evaluate("document.readyState === 'complete' && window.currentProjectFolder === " + JSON.stringify(projectPath))
    );

    const status = await cdp.evaluate('window.pisiSync.getStatus()');
    assert(status?.enabled === false && status.configured === false, 'Legacy sync must report disabled even when configured', status);

    const settingsRendered = await cdp.evaluate(
        "(() => { const container = document.createElement('div'); document.dispatchEvent(new CustomEvent('pisi:render-settings-sections', { detail: { container } })); return Boolean(container.querySelector('.pisi-sync-settings')); })()"
    );
    assert(settingsRendered === false, 'Disabled sync must not render its settings section');

    // 1. Configured legacy sync must not close the note or lose text after typing.
    const firstNode = await createNode(cdp);
    const secondNode = await createNode(cdp);
    await openNode(cdp, firstNode);
    await openNode(cdp, secondNode);
    const idleMarker = 'P1.2 idle sync guard';
    await typeAtEnd(cdp, idleMarker);
    await sleep(10000);
    const afterIdle = await cdp.evaluate(editorStateExpression);
    // The first-run tutorial must not start while the user is typing and steal focus.
    const focusAfterIdle = await cdp.evaluate('document.activeElement?.id || null');
    assert(focusAfterIdle === 'center-node-editor-content', 'Typing focus must stay in the note', focusAfterIdle);
    assert(
        afterIdle.visible && afterIdle.activeTabPath === secondNode && afterIdle.centerPath === secondNode,
        'Editor must stay open 10s after typing',
        afterIdle
    );
    assert(afterIdle.text.includes(idleMarker), 'Typed text must remain in the editor', afterIdle);
    assert((await readNodeContent(secondNode)).includes(idleMarker), 'Autosave must persist the typed text');
    assert(!(await exists(path.join(sharedPath, '.pisi-sync'))), 'Disabled sync must not create .pisi-sync');
    assert(!(await exists(path.join(projectPath, '.pisi', 'sync-state.json'))), 'Disabled sync must not create sync-state.json');

    // 2. Reloading the same project before the 800 ms autosave fires flushes first
    //    and keeps the open tabs, the active note and the caret.
    const reloadMarker = 'P1.2 flush before reload';
    await typeAtEnd(cdp, reloadMarker);
    const reloaded = await cdp.evaluate('window.loadProject(window.currentProjectFolder)');
    assert(reloaded === true, 'loadProject must succeed', reloaded);
    assert((await readNodeContent(secondNode)).includes(reloadMarker), 'Pending text must be on disk once loadProject resolves');

    const afterReload = await waitUntil('workspace restored after reload', () =>
        cdp.evaluate(editorStateExpression).then((state) => (state.visible && state.centerPath === secondNode ? state : null))
    );
    assert(afterReload.activeTabPath === secondNode, 'Active tab must be kept', afterReload);
    assert(JSON.stringify([...afterReload.tabs].sort()) === JSON.stringify([firstNode, secondNode].sort()), 'Open tabs must be kept', afterReload);
    assert(afterReload.text.includes(idleMarker + reloadMarker), 'Reloaded editor must show the saved text', afterReload);
    assert(afterReload.caretCollapsed && afterReload.textBeforeCaret?.endsWith(reloadMarker), 'Caret must return to where typing stopped', afterReload);

    console.log('[E2E] Sync reload passed: configured legacy sync stays disabled, pending saves flush before reload, tabs and caret survive.');
} finally {
    cdp?.close();
    if (child.exitCode === null) {
        child.kill('SIGTERM');
        await sleep(400);
        if (child.exitCode === null) child.kill('SIGKILL');
    }
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
