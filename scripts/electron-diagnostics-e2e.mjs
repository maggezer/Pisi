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

// Local logging and crash handling end to end (dialogs are captured in test
// mode and answered with their first button): a renderer error reaches the
// log without absolute paths, renderer reports are rate-limited, a real
// renderer crash (CDP Page.crash) is logged and the window reloads with the
// project still open, and Settings → Diagnostics saves a ZIP with recent logs
// and system.json but no note content.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9241;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-diagnostics-')));
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
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', PISI_TEST_USER_DATA: userDataPath, PISI_TEST_CAPTURE_DIALOGS: '1' },
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

async function readLogLines() {
    const dir = path.join(userDataPath, 'logs');
    const names = (await fs.readdir(dir).catch(() => [])).filter((name) => name.endsWith('.log'));
    const lines = [];
    for (const name of names) {
        for (const line of (await fs.readFile(path.join(dir, name), 'utf8')).split('\n')) if (line.trim()) lines.push(JSON.parse(line));
    }
    return lines;
}

async function reconnect() {
    const page = await waitUntil('reloaded DevTools page', async () => {
        const response = await fetch('http://127.0.0.1:' + port + '/json/list');
        const pages = response.ok ? await response.json() : [];
        return pages.find((item) => item.type === 'page' && String(item.url || '').startsWith('file:')) || null;
    });
    const next = new CdpClient(page.webSocketDebuggerUrl);
    await next.open();
    await next.request('Runtime.enable');
    return next;
}

const SECRET = 'GİZLİ-NOT-İÇERİĞİ-7319';
const CTRL = 2;

let cdp = null;
try {
    cdp = await launch();
    await cdp.evaluate("(localStorage.setItem('pisi.tutorial.v1.completed', '1'), window.finishPisiTutorial?.(true))");
    const nodePath = await createNode(cdp);
    await openNode(cdp, nodePath);
    await cdp.evaluate("document.getElementById('center-node-editor-content').focus()");
    await cdp.request('Input.insertText', { text: SECRET });
    await key(cdp, 's', 'KeyS', 83, CTRL);
    await waitUntil('note saved', async () => (await fs.readFile(nodePath, 'utf8')).includes(SECRET));

    // 1. A renderer error reaches the main-process log, without absolute paths.
    await cdp.evaluate("setTimeout(() => { throw new Error('E2E renderer hatası ' + location.href); }, 0)");
    const rendererLine = await waitUntil('renderer error logged', () =>
        readLogLines().then((lines) => lines.find((line) => line.module === 'renderer' && line.message.includes('E2E renderer hatası')) || null)
    );
    assert(rendererLine.level === 'error' && /^error: Error: E2E renderer hatası/.test(rendererLine.message), 'Renderer error line', rendererLine);
    assert(/app:\/index\.html/.test(rendererLine.message), 'The app path is shortened to app:', rendererLine.message);
    assert(!rendererLine.context?.location || rendererLine.context.location.startsWith('app:/'), 'The source location is app-relative', rendererLine.context);

    // 2. Rate limit: at most 20 renderer reports per minute.
    await cdp.evaluate('(() => { for (let i = 0; i < 30; i += 1) Promise.reject(new Error("E2E red " + i)); return true; })()');
    await waitUntil('rejections logged', () => readLogLines().then((lines) => lines.filter((line) => line.module === 'renderer').length >= 20));
    await sleep(500);
    const rendererCount = (await readLogLines()).filter((line) => line.module === 'renderer').length;
    assert(rendererCount === 20, 'Only 20 renderer reports are written in one minute', rendererCount);

    // 3. A real renderer crash: logged, the user is asked, the window reloads with the project.
    await cdp.request('Page.enable').catch(() => null);
    void cdp.request('Page.crash').catch(() => null);
    await waitUntil('crash logged', () => readLogLines().then((lines) => lines.some((line) => line.module === 'window' && line.level === 'fatal')));
    cdp.close();
    cdp = await reconnect();
    await waitUntil('project open after reload', () =>
        cdp.evaluate("document.readyState === 'complete' && window.currentProjectFolder === " + JSON.stringify(projectPath))
    );
    const state = await cdp.evaluate("window.pisiDomain.query('diagnostics.test.state.v1', {})");
    const crashDialog = state.dialogs.find((dialog) => dialog.kind === 'render-process-gone');
    assert(crashDialog && crashDialog.buttons[0] === 'Yeniden yükle', 'The crash dialog offered Reload', state.dialogs);
    assert(
        (await readLogLines()).some((line) => line.message.includes('yeniden yüklendi')),
        'The reload is logged'
    );

    // 4. Settings → Diagnostics: open the log folder and save a ZIP without note content.
    await cdp.evaluate("window.openPisiCommandCenter('settings')");
    await waitUntil('diagnostics section', () => cdp.evaluate('Boolean(document.querySelector(\'[data-pisi-diagnostics-action="bundle"]\'))'));
    await cdp.evaluate('document.querySelector(\'[data-pisi-diagnostics-action="open-logs"]\').click()');
    await waitUntil('log folder opened', () =>
        cdp
            .evaluate("window.pisiDomain.query('diagnostics.test.state.v1', {})")
            .then((result) => result.dialogs.some((dialog) => dialog.kind === 'open-log-folder'))
    );
    await cdp.evaluate('document.querySelector(\'[data-pisi-diagnostics-action="bundle"]\').click()');
    await waitUntil('bundle saved notice', () =>
        cdp.evaluate(
            'Array.from(document.querySelectorAll(\'[data-pisi-notification="success"]\')).some((strip) => /pisi-tanilama-.*\\.zip/.test(strip.textContent))'
        )
    );
    const zipName = (await fs.readdir(userDataPath)).find((name) => /^pisi-tanilama-.*\.zip$/.test(name));
    assert(zipName, 'The diagnostics ZIP is written');
    const zip = await fs.readFile(path.join(userDataPath, zipName));
    assert(zip.subarray(0, 4).toString('hex') === '504b0304', 'A ZIP file');
    const raw = zip.toString('utf8');
    assert(/logs\/pisi-\d{4}-\d{2}-\d{2}\.log/.test(raw) && raw.includes('system.json'), 'Logs and system.json are inside');
    assert(/"electron": "\d+/.test(raw) && /"platform": "/.test(raw), 'system.json has versions and the OS');
    assert(!raw.includes(SECRET), 'No note content in the bundle');
    assert(!raw.includes(tempRoot) && !raw.includes(projectPath), 'No absolute project or user paths in the bundle');

    console.log(
        '[E2E] Diagnostics passed: renderer error logged with app-relative paths, 20/min rate limit, real renderer crash logged and reloaded with the project, log folder action, diagnostics ZIP with logs and system.json and no note content or absolute paths.'
    );
} finally {
    await stop(cdp);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
