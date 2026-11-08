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

// External backups end to end (test mode passes folders instead of native
// dialogs): a folder inside the project is refused; "Şimdi yedekle" writes
// Pisi-<proje>-YYYY-MM-DD-HHmm.zip outside the project without version
// history; Settings shows the last successful backup; a backup older than
// three days raises a warning; "Yedekten geri yükle" opens the ZIP into a new
// folder and switches to it while the original project stays untouched.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9244;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-backup-')));
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
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', PISI_TEST_USER_DATA: userDataPath, PISI_TEST_BACKUP_DIALOGS: '1' },
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
const backupFolder = path.join(tempRoot, 'Yedekler');
const restoreParent = path.join(tempRoot, 'Geri');
await fs.mkdir(backupFolder, { recursive: true });
await fs.mkdir(restoreParent, { recursive: true });
const zipNames = async () => (await fs.readdir(backupFolder)).filter((name) => /^Pisi-project-\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?\.zip$/.test(name));

let cdp = null;
try {
    cdp = await launch();
    await cdp.evaluate("(localStorage.setItem('pisi.tutorial.v1.completed', '1'), window.finishPisiTutorial?.(true))");
    const nodePath = await createNode(cdp);
    await openNode(cdp, nodePath);
    await cdp.evaluate("document.getElementById('center-node-editor-content').focus()");
    await cdp.request('Input.insertText', { text: 'Yedeklenecek metin' });
    await key(cdp, 's', 'KeyS', 83, CTRL);
    await waitUntil('note saved', async () => (await fs.readFile(nodePath, 'utf8')).includes('Yedeklenecek metin'));
    await cdp.request('Input.insertText', { text: ' ve devamı' });
    await key(cdp, 's', 'KeyS', 83, CTRL);
    await waitUntil('note history exists', async () => (await fs.readdir(path.join(projectPath, '.pisi-history')).catch(() => [])).length > 0);

    // 1. A folder inside the project is refused; one outside is accepted.
    const inside = await cdp.evaluate(`window.pisiDomain.command('backup.folder.choose.v1', { folder: ${JSON.stringify(projectPath)} })`);
    assert(inside.ok === false && inside.code === 'BACKUP_FOLDER_INSIDE_PROJECT', 'A folder inside the project is refused', inside);
    const parent = await cdp.evaluate(`window.pisiDomain.command('backup.folder.choose.v1', { folder: ${JSON.stringify(tempRoot)} })`);
    assert(parent.ok === false && parent.code === 'BACKUP_FOLDER_CONTAINS_PROJECT', 'A folder containing the project is refused', parent);
    const chosen = await cdp.evaluate(`window.pisiDomain.command('backup.folder.choose.v1', { folder: ${JSON.stringify(backupFolder)} })`);
    assert(chosen.ok === true && chosen.folder === backupFolder, 'An outside folder is accepted', chosen);

    // 2. Settings → Yedekleme → Şimdi yedekle.
    await cdp.evaluate("window.openPisiCommandCenter('settings')");
    await waitUntil('backup settings', () => cdp.evaluate('Boolean(document.querySelector(\'[data-pisi-backup-action="run"]:not([disabled])\'))'));
    await cdp.evaluate('document.querySelector(\'[data-pisi-backup-action="run"]\').click()');
    const [zipName] = await waitUntil('backup ZIP written', () => zipNames().then((names) => (names.length ? names : null)));
    await waitUntil('backup notice', () =>
        cdp.evaluate('Array.from(document.querySelectorAll(\'[data-pisi-notification="success"]\')).some((strip) => /Yedek alındı/.test(strip.textContent))')
    );
    const zip = await fs.readFile(path.join(backupFolder, zipName));
    const text = zip.toString('latin1');
    assert(text.includes(path.basename(nodePath)), 'The note is in the backup');
    assert(!text.includes('.pisi-history/') && !text.includes('.pisi.lock'), 'No version history or lock in the backup');
    const last = await waitUntil('last backup shown', () =>
        cdp.evaluate(
            "(() => { const text = document.querySelector('[data-pisi-backup-last]')?.textContent || ''; return /Henüz/.test(text) ? null : text; })()"
        )
    );
    assert(/Son başarılı yedek: \d/.test(last), 'Settings shows the last successful backup', last);
    assert(await cdp.evaluate("document.querySelector('[data-pisi-backup-warning]').hidden === true"), 'No warning after a fresh backup');

    // 3. A last backup older than three days raises a warning.
    const settingsPath = path.join(userDataPath, 'pisi-settings.json');
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    for (const record of Object.values(settings.backups.projects)) record.lastSuccessAt = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
    await cdp.evaluate("window.pisiBackupSettingsState.warnedFor = ''; window.checkPisiBackupWarning()");
    await waitUntil('stale warning', () =>
        cdp.evaluate(
            'Array.from(document.querySelectorAll(\'[data-pisi-notification="warning"]\')).some((strip) => /3 günden uzun süredir yedek alınamadı/.test(strip.textContent))'
        )
    );

    // 4. Restore into a new folder; the original project is not touched.
    const originalNote = await fs.readFile(nodePath, 'utf8');
    const originalNames = (await fs.readdir(projectPath)).sort();
    const restored = await cdp.evaluate(
        `window.restorePisiProjectFromBackup({ zipPath: ${JSON.stringify(path.join(backupFolder, zipName))}, parentFolder: ${JSON.stringify(restoreParent)} })`
    );
    assert(restored?.ok && restored.loaded, 'The backup opens as a project', restored);
    assert(restored.folderPath.startsWith(restoreParent) && restored.folderPath !== projectPath, 'It opens in a new folder', restored.folderPath);
    await waitUntil('the restored project is open', () => cdp.evaluate('window.currentProjectFolder === ' + JSON.stringify(restored.folderPath)));
    const restoredNote = path.join(restored.folderPath, path.basename(nodePath));
    assert(JSON.parse(await fs.readFile(restoredNote, 'utf8')).content.includes('Yedeklenecek metin ve devamı'), 'The restored note has the content');
    assert((await fs.readFile(nodePath, 'utf8')) === originalNote, 'The original note is unchanged');
    assert(
        JSON.stringify((await fs.readdir(projectPath)).filter((name) => name !== '.pisi.lock').sort()) ===
            JSON.stringify(originalNames.filter((name) => name !== '.pisi.lock')),
        'The original project has the same files'
    );
    assert(!(await fs.readdir(restored.folderPath)).includes('.pisi-history'), 'The restored project has no copied history');
    await waitUntil('restored note in the tree', () =>
        cdp.evaluate("Array.from(document.querySelectorAll('.tree-node[data-path]')).some((n) => n.dataset.path === " + JSON.stringify(restoredNote) + ')')
    );

    console.log(
        '[E2E] Backup passed: folder inside or containing the project refused, Şimdi yedekle wrote the ZIP without history or lock, last backup shown, stale warning after 3 days, restore opened a new folder and left the original untouched.'
    );
} finally {
    await stop(cdp);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
