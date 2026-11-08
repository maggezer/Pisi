import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
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

// Note-to-note links end to end: type [[, pick a note from the suggestion list
// with the keyboard, Ctrl+click it, rename the target from its title field
// (confirming the impact prompt), and see the new title in the source note.
// Legacy [[Başlık]] text is followed by title and turned into an id link by
// the "Bağlantıları onar" command.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9229;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-wiki-')));
const userDataPath = path.join(tempRoot, 'user-data');
const projectPath = path.join(tempRoot, 'project');

await fs.mkdir(userDataPath, { recursive: true });
await fs.mkdir(projectPath, { recursive: true });
await fs.writeFile(path.join(userDataPath, 'pisi-settings.json'), JSON.stringify({ lastProjectFolder: projectPath }, null, 2), 'utf8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let logs = '';
const dialogs = [];

function assert(condition, message, detail) {
    if (!condition) throw new Error(message + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
}

const child = spawn(
    electronPath,
    ['--remote-debugging-port=' + port, ...PISI_E2E_CHROMIUM_FLAGS, ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), repoRoot],
    {
        cwd: repoRoot,
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', PISI_TEST_USER_DATA: userDataPath },
        stdio: ['ignore', 'pipe', 'pipe']
    }
);
const collect = (chunk) => {
    const text = String(chunk || '');
    logs += text;
    process.stdout.write(text);
};
child.stdout?.on('data', collect);
child.stderr?.on('data', collect);

async function waitUntil(label, probe, timeoutMs = 15000) {
    const started = Date.now();
    let lastValue = null;
    while (Date.now() - started < timeoutMs) {
        if (child.exitCode !== null) throw new Error('Electron exited while waiting for ' + label + '.\n' + logs);
        try {
            lastValue = await probe();
            if (lastValue) return lastValue;
        } catch (error) {
            lastValue = String(error?.message || error);
        }
        await sleep(120);
    }
    throw new Error('Timed out waiting for ' + label + '. Last value: ' + JSON.stringify(lastValue) + '\n' + logs);
}

class CdpClient {
    constructor(url) {
        this.socket = new WebSocket(url);
        this.nextId = 1;
        this.pending = new Map();
    }

    async open() {
        await new Promise((resolve, reject) => {
            this.socket.addEventListener('open', resolve, { once: true });
            this.socket.addEventListener('error', reject, { once: true });
        });
        this.socket.addEventListener('message', (event) => {
            const payload = JSON.parse(String(event.data));
            if (payload.method === 'Page.javascriptDialogOpening') {
                // Accept confirm()/alert() and keep the text for assertions.
                dialogs.push({ type: payload.params.type, message: payload.params.message });
                void this.request('Page.handleJavaScriptDialog', { accept: true });
                return;
            }
            const pending = payload.id ? this.pending.get(payload.id) : null;
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
}

const CTRL = 2;
let cdp;

/** Accepts the in-app confirmation (pisiConfirm) and keeps its text for assertions. */
async function acceptInAppConfirm(label) {
    const message = await waitUntil(label + ' confirmation', () => cdp.evaluate("document.getElementById('pisi-confirm-message')?.textContent || null"));
    dialogs.push({ type: 'confirm', message });
    await cdp.evaluate("document.getElementById('pisi-confirm-ok').click()");
    return message;
}

async function key(name, code, keyCode, modifiers = 0) {
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: keyCode, modifiers });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: keyCode, modifiers });
}

async function clickPoint(point, modifiers = 0) {
    await cdp.request('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, modifiers });
    await cdp.request('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1, modifiers });
    await cdp.request('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1, modifiers });
}

async function createNode(title) {
    const before = new Set(await fs.readdir(projectPath));
    await cdp.evaluate("document.getElementById('add-node-btn').click()");
    const created = await waitUntil('new node', async () => {
        const name = (await fs.readdir(projectPath)).find((entry) => entry.endsWith('.node') && !before.has(entry));
        return name ? path.join(projectPath, name) : null;
    });
    const renamed = await cdp.evaluate(`window.pisiProject.renamePisiFile(${JSON.stringify(created)}, ${JSON.stringify(title)})`);
    assert(renamed?.ok, 'Fixture rename must succeed', renamed);
    await cdp.evaluate('window.refreshCurrentProjectTree?.()');
    await waitUntil('tree item ' + title, () =>
        cdp.evaluate("Array.from(document.querySelectorAll('.tree-node[data-path]')).some((n) => n.dataset.path === " + JSON.stringify(renamed.fullPath) + ')')
    );
    return { path: renamed.fullPath, id: renamed.metadata.id };
}

async function openNode(nodePath) {
    await cdp.evaluate(
        "Array.from(document.querySelectorAll('.tree-node[data-path]')).find((n) => n.dataset.path === " +
            JSON.stringify(nodePath) +
            ").querySelector(':scope > .tree-row').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }))"
    );
    await waitUntil('editor for ' + nodePath, () => cdp.evaluate('window.activeCenterNode?.path === ' + JSON.stringify(nodePath)));
}

async function caretAtEnd() {
    await cdp.evaluate(
        "(() => { const e = document.getElementById('center-node-editor-content'); e.focus(); const r = document.createRange(); r.selectNodeContents(e.lastElementChild || e); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); })()"
    );
}

const menuState = `(() => { const s = window.pisiTagMenuState; return { active: Boolean(s?.active), mode: s?.mode || null, selected: s?.selectedIndex ?? -1, items: (s?.items || []).map((i) => i.kind + ':' + (i.title || i.label)) }; })()`;
const readContent = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8')).content || '';

try {
    const page = await waitUntil('Electron DevTools page', async () => {
        const response = await fetch('http://127.0.0.1:' + port + '/json/list');
        const pages = response.ok ? await response.json() : [];
        return pages.find((item) => item.type === 'page' && String(item.url || '').startsWith('file:')) || null;
    });
    cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.request('Runtime.enable');
    await cdp.request('Page.enable');
    await cdp.evaluate("localStorage.setItem('pisi.tutorial.v1.completed', '1')");
    await waitUntil('project restored', () =>
        cdp.evaluate("document.readyState === 'complete' && window.currentProjectFolder === " + JSON.stringify(projectPath))
    );

    const target = await createNode('Hedef Not');
    const other = await createNode('Hesap Defteri');
    const source = await createNode('Kaynak');
    await openNode(source.path);

    // 1. [[ opens the suggestion list; arrows move, Escape closes, Enter picks.
    await caretAtEnd();
    await cdp.request('Input.insertText', { text: 'Bkz. [[He' });
    const opened = await waitUntil('wiki suggestions', () =>
        cdp.evaluate(menuState).then((state) => (state.active && state.mode === 'wiki-link' && state.items.length >= 2 ? state : null))
    );
    assert(opened.items.includes('wiki-note:Hedef Not') && opened.items.includes('wiki-note:Hesap Defteri'), 'Both notes must be suggested', opened);
    assert(opened.items.includes('wiki-create:He'), 'A create item is offered when no note has the exact title', opened);
    await key('ArrowDown', 'ArrowDown', 40);
    assert((await cdp.evaluate(menuState)).selected === 1, 'ArrowDown moves the selection');
    await key('ArrowUp', 'ArrowUp', 38);
    assert((await cdp.evaluate(menuState)).selected === 0, 'ArrowUp moves the selection back');
    await key('Escape', 'Escape', 27);
    assert(!(await cdp.evaluate(menuState)).active, 'Escape closes the list');
    await cdp.request('Input.insertText', { text: 'def' });
    const narrowed = await waitUntil('narrowed suggestions', () =>
        cdp.evaluate(menuState).then((state) => (state.active && state.items[0] === 'wiki-note:Hedef Not' ? state : null))
    );
    assert(!narrowed.items.includes('wiki-note:Hesap Defteri'), 'Typing narrows the list', narrowed);
    await key('Enter', 'Enter', 13);
    const linkSelector = `#center-node-editor-content a.pisi-wiki-link[data-pisi-node-id="${target.id}"]`;
    await waitUntil('id link inserted', () => cdp.evaluate(`document.querySelector('${linkSelector}')?.textContent === 'Hedef Not'`));
    assert(!(await cdp.evaluate("document.getElementById('center-node-editor-content').textContent.includes('[[')")), 'The [[ token is replaced');
    await waitUntil('source saved with id link', async () => (await readContent(source.path)).includes(`data-pisi-node-id="${target.id}"`));

    // 2. A plain click keeps the note; Ctrl+click opens the target.
    const point = await cdp.evaluate(
        `(() => { const r = document.querySelector('${linkSelector}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
    );
    await clickPoint(point);
    await sleep(300);
    assert((await cdp.evaluate('window.activeCenterNode?.path')) === source.path, 'A plain click must not navigate');
    await clickPoint(point, CTRL);
    await waitUntil('target opened by Ctrl+click', () => cdp.evaluate('window.activeCenterNode?.path === ' + JSON.stringify(target.path)));

    // 3. Rename the target from the tree; the rename applies on Enter and the
    //    impact prompt names the one note that links to it.
    await cdp.evaluate(
        "Array.from(document.querySelectorAll('.tree-node[data-path]')).find((n) => n.dataset.path === " +
            JSON.stringify(target.path) +
            ").querySelector(':scope > .tree-row').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }))"
    );
    await cdp.evaluate('window.startRenameSelectedTreeFile()');
    await waitUntil('tree rename input', () =>
        cdp.evaluate("(() => { const i = document.querySelector('.tree-rename-input'); if (!i) return false; i.focus(); i.select(); return true; })()")
    );
    await cdp.request('Input.insertText', { text: 'Yeni Hedef' });
    await key('Enter', 'Enter', 13);
    await acceptInAppConfirm('rename impact');
    const renamedPath = await waitUntil('target renamed', async () => {
        const name = (await fs.readdir(projectPath)).find((entry) => entry.startsWith('Yeni Hedef') && entry.endsWith('.node'));
        return name ? path.join(projectPath, name) : null;
    });
    const impact = dialogs.find((dialog) => dialog.type === 'confirm' && dialog.message.includes('Etkilenecek not: 1'));
    assert(impact, 'The rename must confirm the number of affected notes', dialogs);

    // 4. The source note on disk and in the editor shows the new title.
    await waitUntil('source rewritten on disk', async () => (await readContent(source.path)).includes(`data-pisi-node-title="Yeni Hedef"`));
    await openNode(source.path);
    await waitUntil('source shows new title', () => cdp.evaluate(`document.querySelector('${linkSelector}')?.textContent === 'Yeni Hedef'`));

    // 5. Legacy [[Başlık]] text follows by title on Ctrl+click.
    await cdp.evaluate(
        "(() => { const e = document.getElementById('center-node-editor-content'); window.setPisiEditorContent(e, '<div>Eski biçim: [[yeni hedef]] burada</div>'); e.dispatchEvent(new InputEvent('input', { bubbles: true })); })()"
    );
    await waitUntil('legacy text saved', async () => (await readContent(source.path)).includes('[[yeni hedef]]'));
    const legacyPoint = await cdp.evaluate(`(() => {
        const walker = document.createTreeWalker(document.getElementById('center-node-editor-content'), NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const index = node.nodeValue.indexOf('[[yeni hedef]]');
            if (index < 0) continue;
            const range = document.createRange();
            range.setStart(node, index + 4);
            range.setEnd(node, index + 5);
            const rect = range.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        return null;
    })()`);
    assert(legacyPoint, 'Legacy text must be on screen');
    await clickPoint(legacyPoint, CTRL);
    await waitUntil('legacy link followed', () => cdp.evaluate('window.activeCenterNode?.path === ' + JSON.stringify(renamedPath)));

    // 6. "Bağlantıları onar" turns the legacy text into an id link.
    // The command waits for the in-app confirmation, so it is not awaited here.
    await cdp.evaluate("void window.runPisiCommand?.('links.repair')");
    await acceptInAppConfirm('repair preview');
    await waitUntil('legacy text repaired on disk', async () => {
        const content = await readContent(source.path);
        return content.includes(`data-pisi-node-id="${target.id}"`) && !content.includes('[[yeni hedef]]');
    });
    assert(
        dialogs.some((dialog) => dialog.message.includes('Kimlik eklenecek bağlantı: 1')),
        'Repair must preview the change',
        dialogs
    );
    assert(!(await readContent(other.path)).includes('pisi-wiki-link'), 'Unrelated notes are not touched by the repair');

    console.log('[E2E] Wiki links passed: [[ suggestions with keyboard, Ctrl+click, tree rename with impact prompt, source updated, legacy follow and repair.');
} finally {
    if (child.exitCode === null) {
        child.kill('SIGTERM');
        await sleep(400);
        if (child.exitCode === null) child.kill('SIGKILL');
    }
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
