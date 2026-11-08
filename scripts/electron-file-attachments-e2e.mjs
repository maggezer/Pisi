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

// File attachments end to end: a dropped non-image file becomes an attachment
// block backed by file/<sha256>.<ext> in the note sidecar, next to an image
// dropped with it. Clicking opens it (executables are only revealed); opening
// is captured in test mode (PISI_TEST_CAPTURE_EXTERNAL=1). The attachment
// survives delete/undo, a copy into another note, an app restart and
// delete → Trash → restore.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9230;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-files-')));
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
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', PISI_TEST_USER_DATA: userDataPath, PISI_TEST_CAPTURE_EXTERNAL: '1' },
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

const fileState = `(() => Array.from(document.querySelectorAll('#center-node-editor-content .pisi-file-block')).map((block) => ({
    reference: block.dataset.pisiFileAsset,
    name: block.dataset.pisiFileName,
    size: block.dataset.pisiFileSize,
    kind: block.dataset.pisiFileKind,
    state: block.dataset.pisiFileState || null,
    text: block.textContent
})))()`;

async function waitForFiles(cdp, count, label) {
    return waitUntil(label, () =>
        cdp.evaluate(fileState).then((files) => (files.length === count && files.every((file) => file.state === 'ready') ? files : null))
    );
}

async function dropFiles(cdp, filesSource) {
    return cdp.evaluate(`(async () => {
        const editor = document.getElementById('center-node-editor-content');
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        const data = new DataTransfer();
        for (const file of await (${filesSource})()) data.items.add(file);
        const event = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
        editor.lastElementChild.dispatchEvent(event);
        return event.defaultPrevented;
    })()`);
}

const reportFile = "async () => [new File([new TextEncoder().encode('%PDF-1.4 Pisi rapor')], 'Rapor Özet.pdf', { type: 'application/pdf' })]";
const reportAndImage = `async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 16;
    canvas.getContext('2d').fillRect(0, 0, 24, 16);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return [...(await (${reportFile})()), new File([png], 'ekran.png', { type: 'image/png' })];
}`;

async function clickFileBlock(cdp, index, options = {}) {
    await cdp.evaluate(`(() => {
        const block = document.querySelectorAll('#center-node-editor-content .pisi-file-block')[${index}];
        block.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
        ${options.click === false ? '' : "block.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));"}
    })()`);
}

async function readOpenLog() {
    return fs
        .readFile(path.join(userDataPath, 'pisi-file-open.log'), 'utf8')
        .then((text) => text.split('\n').filter(Boolean))
        .catch(() => []);
}

async function readNode(nodePath) {
    return JSON.parse(await fs.readFile(nodePath, 'utf8'));
}

async function sidecarPath(nodePath, reference) {
    const data = await readNode(nodePath);
    assert(data.pisi?.sidecar, 'Node has no sidecar folder', data.pisi);
    return path.join(path.dirname(nodePath), data.pisi.sidecar, reference);
}

async function exists(targetPath) {
    return fs
        .access(targetPath)
        .then(() => true)
        .catch(() => false);
}

async function key(cdp, keyName, code, keyCode, modifiers = 0) {
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
}

let cdp = null;
try {
    cdp = await launch();
    await cdp.evaluate("localStorage.setItem('pisi.tutorial.v1.completed', '1')");

    // 1. A PDF dropped together with a PNG: an attachment block and an image block.
    const firstNode = await createNode(cdp);
    await openNode(cdp, firstNode);
    assert(await dropFiles(cdp, reportAndImage), 'Mixed drop must be handled by the attachment module');
    const [dropped] = await waitForFiles(cdp, 1, 'dropped attachment block');
    assert(/^file\/[a-f0-9]{64}\.pdf$/.test(dropped.reference), 'Attachment must be stored content addressed', dropped);
    assert(dropped.name === 'Rapor Özet.pdf' && dropped.size === '19' && dropped.kind === 'pdf', 'Block must keep name, size and kind', dropped);
    assert(dropped.text.includes('Rapor Özet.pdf') && dropped.text.includes('19 B'), 'Block must show name and size', dropped);
    await waitUntil('image block from the same drop', () =>
        cdp.evaluate("document.querySelectorAll('#center-node-editor-content .pisi-image-block').length === 1")
    );

    await waitUntil('attachment reference persisted', async () => (await readNode(firstNode)).content?.includes(dropped.reference));
    const assetPath = await sidecarPath(firstNode, dropped.reference);
    assert(await exists(assetPath), 'Attachment must exist in the note sidecar', assetPath);

    // The same file again shares one sidecar file.
    assert(await dropFiles(cdp, reportFile), 'Second drop must be handled');
    const twice = await waitForFiles(cdp, 2, 'second attachment block');
    assert(twice[0].reference === twice[1].reference, 'Identical files must share one reference', twice);
    assert((await fs.readdir(path.dirname(assetPath))).filter((name) => !name.startsWith('.')).length === 1, 'Identical files must share one file');

    // 2. Click opens in the default app; an executable is only shown in its folder.
    await clickFileBlock(cdp, 0);
    await waitUntil('open captured', async () => (await readOpenLog()).includes('opened ' + assetPath));
    assert(await dropFiles(cdp, "async () => [new File(['echo merhaba'], 'kur.sh', { type: 'application/x-sh' })]"), 'Executable drop must be handled');
    const withScript = await waitForFiles(cdp, 3, 'executable attachment block');
    const scriptIndex = withScript.findIndex((file) => file.kind === 'executable');
    assert(scriptIndex >= 0 && withScript[scriptIndex].name === 'kur.sh', 'Script must be marked executable', withScript);
    await clickFileBlock(cdp, scriptIndex);
    const scriptPath = await sidecarPath(firstNode, withScript[scriptIndex].reference);
    await waitUntil('reveal captured', async () => (await readOpenLog()).includes('revealed ' + scriptPath));
    assert(!(await readOpenLog()).includes('opened ' + scriptPath), 'Executable must never be opened');

    // Oversized files are refused with a clear message and nothing is stored.
    assert(
        await dropFiles(cdp, "async () => [new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'buyuk.zip', { type: 'application/zip' })]"),
        'Large drop must be handled'
    );
    await waitUntil('size limit message', () =>
        cdp.evaluate(
            'Array.from(document.querySelectorAll(\'[data-pisi-notification="error"] .pisi-notification-message\')).some((el) => /20 MB/.test(el.textContent))'
        )
    );
    assert((await cdp.evaluate(fileState)).length === 3, 'Oversized file must not create a block');

    // 3. Delete the selected attachment with the keyboard, then undo.
    await clickFileBlock(cdp, scriptIndex, { click: false });
    await key(cdp, 'Delete', 'Delete', 46);
    await waitUntil('attachment deleted', () => cdp.evaluate(fileState).then((files) => files.length === 2));
    await key(cdp, 'z', 'KeyZ', 90, 2);
    await waitForFiles(cdp, 3, 'attachment restored by undo');

    // 4. Copy the block into another note: the asset follows the reference.
    const secondNode = await createNode(cdp);
    const blockHtml = await cdp.evaluate("document.querySelector('#center-node-editor-content .pisi-file-block').outerHTML");
    await openNode(cdp, secondNode);
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        const data = new DataTransfer();
        data.setData('text/html', ${JSON.stringify(blockHtml)});
        data.setData('text/plain', '');
        editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    })()`);
    await waitForFiles(cdp, 1, 'attachment copied into second note');
    await waitUntil('copied asset stored in second sidecar', async () => exists(await sidecarPath(secondNode, dropped.reference)));
    await waitUntil('second note saved', async () => (await readNode(secondNode)).content?.includes(dropped.reference));
    await waitUntil(
        'first note saved with three attachments',
        async () => ((await readNode(firstNode)).content?.match(/data-pisi-file-asset=/g) || []).length === 3
    );

    await stop(cdp);

    // 5. After a restart the attachment is shown and still opens.
    cdp = await launch();
    await waitForTreeItem(cdp, firstNode);
    await openNode(cdp, firstNode);
    const afterRestart = await waitForFiles(cdp, 3, 'attachments after restart');
    assert(afterRestart.filter((file) => file.text.includes('Rapor Özet.pdf')).length === 2, 'Restarted blocks must show the file name', afterRestart);

    // 6. Delete the note to Trash and restore it: the attachment comes back with it.
    const deleted = await cdp.evaluate('window.pisiDomain.command("project.item.delete.v1", { targetPath: ' + JSON.stringify(firstNode) + ' })');
    assert(deleted?.ok, 'Note must move to Trash', deleted);
    await waitUntil('note removed from disk', async () => !(await exists(firstNode)));
    assert(!(await exists(assetPath)), 'Attachment must move to Trash with the note');
    const listed = await cdp.evaluate('window.pisiDomain.query("trash.list.v1", { projectFolder: window.currentProjectFolder })');
    const item = (listed?.items || []).find((entry) => JSON.stringify(entry).includes(path.basename(firstNode)));
    assert(item, 'Trash must list the deleted note', listed);
    const restored = await cdp.evaluate(
        'window.pisiDomain.command("trash.restore.v1", { projectFolder: window.currentProjectFolder, trashId: ' +
            JSON.stringify(item.id || item.trashId) +
            ' })'
    );
    assert(restored?.ok, 'Trash restore must succeed', restored);
    await waitUntil('restored note on disk', async () => exists(firstNode));
    assert(await exists(assetPath), 'Restored note must bring its attachment back');
    await waitForTreeItem(cdp, firstNode);
    await openNode(cdp, firstNode);
    await waitForFiles(cdp, 3, 'attachments after Trash restore');
    await clickFileBlock(
        cdp,
        (await cdp.evaluate(fileState)).findIndex((file) => file.kind === 'pdf')
    );
    await waitUntil('restored attachment opens', async () => (await readOpenLog()).filter((line) => line === 'opened ' + assetPath).length === 2);

    console.log(
        '[E2E] File attachments passed: mixed drop, dedupe, open and executable reveal, size limit, delete/undo, cross-note copy, restart and Trash restore.'
    );
} finally {
    await stop(cdp);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
