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

// Canonical store history end to end: a task is added to a note, then
// deleted by removing its block and saving; the Görevler tab of Version
// History shows "1 görev geri gelir" for the version from before the delete;
// restoring it (one atomic command, with a before-restore snapshot) brings the
// task back to .pisi/tasks.json and its block back into the note, on disk and
// in the open editor, and Project Integrity reports no findings.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9243;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-store-history-')));
const userDataPath = path.join(tempRoot, 'user-data');
const projectPath = path.join(tempRoot, 'project');

await fs.mkdir(userDataPath, { recursive: true });
await fs.mkdir(projectPath, { recursive: true });
await fs.writeFile(path.join(userDataPath, 'pisi-settings.json'), JSON.stringify({ lastProjectFolder: projectPath }, null, 2), 'utf8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child = null;
let logs = '';

function assert(condition, message, detail) {
    if (!condition) throw new Error(message + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
}

async function waitUntil(label, probe, timeoutMs = 15000) {
    const started = Date.now();
    let lastValue = null;
    while (Date.now() - started < timeoutMs) {
        if (child?.exitCode !== null) throw new Error('Electron exited while waiting for ' + label + '.\n' + logs);
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

    close() {
        this.socket.close();
    }
}

async function launch() {
    const args = [
        '--remote-debugging-port=' + port,
        ...PISI_E2E_CHROMIUM_FLAGS,
        ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []),
        repoRoot
    ];
    child = spawn(electronPath, args, {
        cwd: repoRoot,
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', PISI_TEST_USER_DATA: userDataPath, PISI_TEST_STORE_HISTORY_INTERVAL_MS: '0' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const collect = (chunk) => {
        const text = String(chunk || '');
        logs += text;
        process.stdout.write(text);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    const page = await waitUntil('Electron DevTools page', async () => {
        const response = await fetch('http://127.0.0.1:' + port + '/json/list');
        const pages = response.ok ? await response.json() : [];
        return pages.find((item) => item.type === 'page' && String(item.url || '').startsWith('file:')) || null;
    });
    const cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.request('Runtime.enable');
    await waitUntil('project restored', () =>
        cdp.evaluate("document.readyState === 'complete' && window.currentProjectFolder === " + JSON.stringify(projectPath))
    );
    return cdp;
}

async function stop(cdp) {
    cdp?.close();
    if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        await waitUntil('Electron exit', async () => child.exitCode !== null, 8000).catch(() => child.kill('SIGKILL'));
    }
}

async function createNode(cdp) {
    const before = new Set(await fs.readdir(projectPath));
    assert(await cdp.evaluate("(() => { const b = document.getElementById('add-node-btn'); b?.click(); return Boolean(b); })()"), 'Add Node button is missing');
    const nodePath = await waitUntil('new node file', async () => {
        const created = (await fs.readdir(projectPath)).find((name) => name.endsWith('.node') && !before.has(name));
        return created ? path.join(projectPath, created) : null;
    });
    await waitForTreeItem(cdp, nodePath);
    return nodePath;
}

async function waitForTreeItem(cdp, nodePath) {
    await waitUntil('tree item ' + nodePath, () =>
        cdp.evaluate("Array.from(document.querySelectorAll('.tree-node[data-path]')).some((n) => n.dataset.path === " + JSON.stringify(nodePath) + ')')
    );
}

async function openNode(cdp, nodePath) {
    const serialized = JSON.stringify(nodePath);
    await cdp.evaluate(
        "(() => { const node = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((n) => n.dataset.path === " +
            serialized +
            "); node?.querySelector(':scope > .tree-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })); })()"
    );
    await waitUntil('editor for ' + nodePath, () =>
        cdp.evaluate('window.activeCenterNode?.path === ' + serialized + " && document.getElementById('center-node-editor')?.hidden === false")
    );
}

async function key(cdp, keyName, code, keyCode, modifiers = 0) {
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
}

const CTRL = 2;
const TASK = 'Raporu bitir';
const readJson = async (file, fallback = null) => JSON.parse(await fs.readFile(file, 'utf8').catch(() => JSON.stringify(fallback)));
const tasksPath = path.join(projectPath, '.pisi', 'tasks.json');
const storeTasks = async () => ((await readJson(tasksPath, { tasks: [] })).tasks || []).filter((task) => task.title === TASK);

let cdp = null;
try {
    cdp = await launch();
    await cdp.evaluate("localStorage.setItem('pisi.tutorial.v1.completed', '1')");
    const nodePath = await createNode(cdp);

    // 1. A task in the note (quick add writes the block and the task store).
    const added = await cdp.evaluate(
        `window.pisiProject.quickAddTask(${JSON.stringify(projectPath)}, { text: ${JSON.stringify(TASK)}, nodePath: ${JSON.stringify(nodePath)} })`
    );
    assert(added?.ok, 'Quick add works', added);
    const [task] = await waitUntil('task in the store', () => storeTasks().then((list) => (list.length ? list : null)));
    assert(task.source?.blockId, 'The task has a source block', task);
    await openNode(cdp, nodePath);
    await waitUntil('task block in the editor', () =>
        cdp.evaluate(`document.getElementById('center-node-editor-content').innerText.includes(${JSON.stringify(TASK)})`)
    );

    // 2. Delete it: remove the block in the editor and save.
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        editor.querySelector('[data-pisi-block-id=${JSON.stringify(task.source.blockId)}]').remove();
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        editor.focus();
    })()`);
    await key(cdp, 's', 'KeyS', 83, CTRL);
    await waitUntil('task gone from the store', () => storeTasks().then((list) => list.length === 0));
    await waitUntil('block gone from the note', async () => !(await fs.readFile(nodePath, 'utf8')).includes(task.source.blockId));

    // 3. Version History → Görevler: the version before the delete brings 1 task back.
    await cdp.evaluate('window.openPisiHistoryDialog(null, undefined, "tasks")');
    await waitUntil('tasks history list', () =>
        cdp.evaluate('document.querySelectorAll(\'[data-pisi-store-history-list="tasks"] [data-pisi-history-id]\').length > 0')
    );
    await cdp.evaluate(`(async () => {
        for (const button of document.querySelectorAll('[data-pisi-store-history-list="tasks"] [data-pisi-store-history-action="preview"]')) button.click();
    })()`);
    const target = await waitUntil('a version that brings the task back', () =>
        cdp.evaluate(`(() => {
            const rows = Array.from(document.querySelectorAll('[data-pisi-store-history-list="tasks"] [data-pisi-history-id]'));
            const row = rows.find((item) => /1 görev geri gelir/.test(item.querySelector('[data-pisi-store-history-summary]')?.textContent || ''));
            return row ? { id: row.dataset.pisiHistoryId, summary: row.querySelector('[data-pisi-store-history-summary]').textContent, items: row.innerText } : null;
        })()`)
    );
    assert(target.items.includes(TASK), 'The comparison lists the task', target);

    // 4. Restore it.
    await cdp.evaluate(`document.querySelector('[data-pisi-history-id=${JSON.stringify(target.id)}] [data-pisi-store-history-action="restore"]').click()`);
    await waitUntil('confirmation', () => cdp.evaluate("Boolean(document.getElementById('pisi-confirm-ok'))"));
    assert(await cdp.evaluate("document.activeElement?.id === 'pisi-confirm-cancel'"), 'Restore is destructive: focus starts on İptal');
    await cdp.evaluate("document.getElementById('pisi-confirm-ok').click()");
    const [restored] = await waitUntil('task back in the store', () => storeTasks().then((list) => (list.length ? list : null)));
    assert(restored.id === task.id, 'The same task id comes back', { restored: restored.id, task: task.id });
    const note = await waitUntil('block back in the note', async () => {
        const html = JSON.parse(await fs.readFile(nodePath, 'utf8')).content || '';
        return html.includes(`data-pisi-block-id="${task.source.blockId}"`) ? html : null;
    });
    assert(note.includes(TASK) && note.includes(`data-pisi-task-id="${task.id}"`), 'The note shows the task again', note);
    await waitUntil('task back in the editor', () =>
        cdp.evaluate(`document.getElementById('center-node-editor-content').innerText.includes(${JSON.stringify(TASK)})`)
    );
    await waitUntil('integrity is clean', () =>
        cdp.evaluate('Array.from(document.querySelectorAll(\'[data-pisi-notification="success"]\')).some((strip) => /bütünlüğü temiz/.test(strip.textContent))')
    );
    const audit = await cdp.evaluate(`window.pisiDomain.query('integrity.audit.v1', { projectFolder: ${JSON.stringify(projectPath)} })`);
    assert(Array.isArray(audit?.issues) && audit.issues.length === 0, 'Project Integrity has no findings', audit?.issues);

    // 5. The restore kept a before-restore snapshot; the task survives the next save of the note.
    const history = await cdp.evaluate("window.pisiDomain.query('history.store.list.v1', { store: 'tasks' })");
    assert(
        history.versions.some((version) => version.reason === 'before-restore'),
        'A before-restore snapshot exists',
        history.versions
    );
    await cdp.evaluate("document.getElementById('center-node-editor-content').focus()");
    await key(cdp, 's', 'KeyS', 83, CTRL);
    await sleep(800);
    assert((await storeTasks()).length === 1, 'Saving the note keeps the restored task');

    console.log(
        '[E2E] Store history passed: task deleted, Görevler tab shows 1 görev geri gelir with the task listed, restore brings the same task id back to tasks.json and its block to the note and editor, integrity clean, before-restore snapshot kept.'
    );
} finally {
    await stop(cdp);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
