import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// In-app notifications end to end: a real failed save (the note file is
// replaced by a folder, so the atomic rename fails) shows an error strip with
// role="alert" instead of a blocking dialog; a repeat merges (×2); "Show
// details" opens the detail; "Open version history" opens the recovery dialog;
// a destructive confirmation starts on "İptal" and Enter cancels it; a
// non-destructive one confirms with Enter; success strips close by themselves.
// No native alert() or confirm() is called at any point.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9240;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-notify-')));
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
    const args = ['--remote-debugging-port=' + port, ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), repoRoot];
    child = spawn(electronPath, args, {
        cwd: repoRoot,
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', PISI_TEST_USER_DATA: userDataPath },
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
const strips = `Array.from(document.querySelectorAll('.pisi-notification')).map((strip) => ({
    type: strip.dataset.pisiNotification,
    role: strip.getAttribute('role'),
    live: strip.getAttribute('aria-live'),
    message: strip.querySelector('.pisi-notification-message')?.textContent || '',
    count: strip.querySelector('[data-pisi-notification-count]')?.hidden ? 1 : Number((strip.querySelector('[data-pisi-notification-count]')?.textContent || '×1').slice(1)),
    detailHidden: strip.querySelector('.pisi-notification-detail')?.hidden,
    buttons: Array.from(strip.querySelectorAll('button')).map((button) => button.textContent)
}))`;

let cdp = null;
try {
    cdp = await launch();
    await cdp.evaluate(`(() => {
        localStorage.setItem('pisi.tutorial.v1.completed', '1');
        window.__nativeDialogs = [];
        window.alert = (message) => window.__nativeDialogs.push(['alert', String(message)]);
        window.confirm = (message) => { window.__nativeDialogs.push(['confirm', String(message)]); return false; };
    })()`);
    const nodePath = await createNode(cdp);
    await openNode(cdp, nodePath);
    await cdp.evaluate("document.getElementById('center-node-editor-content').focus()");
    await cdp.request('Input.insertText', { text: 'Kurtarılacak metin' });
    await key(cdp, 's', 'KeyS', 83, CTRL);
    await waitUntil('first save', async () => JSON.parse(await fs.readFile(nodePath, 'utf8')).content?.includes('Kurtarılacak metin'));

    // 1. A real failed save: the note file becomes a folder, so the atomic rename fails.
    const original = await fs.readFile(nodePath, 'utf8');
    await fs.rm(nodePath);
    await fs.mkdir(nodePath);
    await cdp.evaluate("document.getElementById('center-node-editor-content').focus()");
    await cdp.request('Input.insertText', { text: ' ve ek' });
    await key(cdp, 's', 'KeyS', 83, CTRL);
    const failed = await waitUntil('error strip', () => cdp.evaluate(strips).then((list) => list.find((strip) => strip.type === 'error') || null));
    assert(failed.role === 'alert' && failed.live === 'assertive', 'The error strip is announced as an alert', failed);
    assert(failed.message.length > 0, 'The error strip has a message', failed);
    assert(failed.buttons.includes('Sürüm geçmişini aç'), 'A failed save links to version history', failed.buttons);
    assert(failed.buttons.includes('Ayrıntıyı göster') && failed.buttons.includes('Kopyala'), 'Errors offer details and copy', failed.buttons);
    assert(!(await cdp.evaluate("Boolean(document.getElementById('pisi-confirm-overlay'))")), 'No blocking dialog opened');

    // 2. The same failure again merges into the strip.
    await cdp.evaluate("document.getElementById('center-node-editor-content').focus()");
    await key(cdp, 's', 'KeyS', 83, CTRL);
    const merged = await waitUntil('merged error', () =>
        cdp.evaluate(strips).then((list) => {
            const errors = list.filter((strip) => strip.type === 'error');
            return errors.length === 1 && errors[0].count === 2 ? errors[0] : null;
        })
    );
    assert(merged.count === 2, 'Repeated error shows ×2', merged);
    await sleep(4500);
    assert(
        (await cdp.evaluate(strips)).some((strip) => strip.type === 'error'),
        'The error strip does not close by itself'
    );

    // 3. Details, then the recovery link.
    await cdp.evaluate(
        "Array.from(document.querySelectorAll('.pisi-notification-error button')).find((button) => button.textContent === 'Ayrıntıyı göster').click()"
    );
    assert((await cdp.evaluate(strips)).find((strip) => strip.type === 'error').detailHidden === false, 'Details are shown');
    await fs.rm(nodePath, { recursive: true });
    await fs.writeFile(nodePath, original, 'utf8');
    await cdp.evaluate(
        "Array.from(document.querySelectorAll('.pisi-notification-error button')).find((button) => button.textContent === 'Sürüm geçmişini aç').click()"
    );
    await waitUntil('version history dialog', () =>
        cdp.evaluate("document.body.classList.contains('pisi-portability-dialog-open') && /sürüm geçmişi/i.test(document.body.innerText)")
    );
    assert(!(await cdp.evaluate(strips)).some((strip) => strip.type === 'error'), 'The strip closes after its action');
    await key(cdp, 'Escape', 'Escape', 27);

    // 4. Destructive confirmation starts on "İptal": Enter cancels. A normal one confirms with Enter.
    await cdp.evaluate(
        "void (window.__confirmResult = undefined, pisiConfirm('Bu öğe kalıcı olarak silinsin mi?', { confirmText: 'Sil', danger: true }).then((value) => (window.__confirmResult = value)))"
    );
    await waitUntil('danger confirm focus', () => cdp.evaluate("document.activeElement?.id === 'pisi-confirm-cancel'"));
    assert(await cdp.evaluate("document.getElementById('pisi-confirm-ok').classList.contains('danger')"), 'The destructive button is marked');
    await key(cdp, 'Enter', 'Enter', 13);
    await waitUntil('danger confirm cancelled', () => cdp.evaluate('window.__confirmResult === false'));
    await cdp.evaluate(
        "void (window.__confirmResult = undefined, pisiConfirm('Düğümler yeniden düzenlensin mi?', { confirmText: 'Düzenle' }).then((value) => (window.__confirmResult = value)))"
    );
    await waitUntil('normal confirm focus', () => cdp.evaluate("document.activeElement?.id === 'pisi-confirm-ok'"));
    await key(cdp, 'Tab', 'Tab', 9);
    assert(await cdp.evaluate("document.activeElement?.id === 'pisi-confirm-cancel'"), 'Tab moves between the buttons');
    await key(cdp, 'Tab', 'Tab', 9);
    await key(cdp, 'Enter', 'Enter', 13);
    await waitUntil('normal confirm accepted', () => cdp.evaluate('window.__confirmResult === true'));

    // 5. Success strips are polite and close by themselves.
    await cdp.evaluate("pisiNotifySuccess('Dışa aktarıldı', { duration: 600 })");
    const success = await waitUntil('success strip', () => cdp.evaluate(strips).then((list) => list.find((strip) => strip.type === 'success') || null));
    assert(success.role === 'status' && success.live === 'polite', 'Success is a polite status', success);
    await waitUntil('success closed', () => cdp.evaluate(strips).then((list) => !list.some((strip) => strip.type === 'success')), 5000);

    const native = await cdp.evaluate('window.__nativeDialogs');
    assert(Array.isArray(native) && native.length === 0, 'No native alert() or confirm() was called', native);

    console.log(
        '[E2E] Notifications passed: failed save shows an alert strip with version history link and no dialog, repeat merges ×2, errors stay, details, recovery dialog, danger confirm defaults to İptal, Tab/Enter, success auto-close, no native dialogs.'
    );
} finally {
    await stop(cdp);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
