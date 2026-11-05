import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Image blocks end to end: a clipboard image becomes a sidecar asset referenced
// by the note, survives an app restart, survives delete → Trash → restore,
// follows a copy into another note, and comes back through undo.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9227;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-images-')));
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

const imageState = `(() => {
    const images = Array.from(document.querySelectorAll('#center-node-editor-content .pisi-image-block img'));
    return images.map((img) => ({ reference: img.getAttribute('data-pisi-image-asset'), blob: img.src.startsWith('blob:'), loaded: img.complete && img.naturalWidth > 0, width: img.naturalWidth }));
})()`;

async function waitForLoadedImages(cdp, count, label) {
    return waitUntil(label, () =>
        cdp.evaluate(imageState).then((images) => (images.length === count && images.every((image) => image.blob && image.loaded) ? images : null))
    );
}

async function pasteGeneratedImage(cdp) {
    return cdp.evaluate(`(async () => {
        const editor = document.getElementById('center-node-editor-content');
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 40;
        const context = canvas.getContext('2d');
        context.fillStyle = '#1e88e5';
        context.fillRect(0, 0, 64, 40);
        context.fillStyle = '#ffffff';
        context.fillRect(8, 8, 20, 20);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const data = new DataTransfer();
        data.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        editor.dispatchEvent(event);
        return event.defaultPrevented;
    })()`);
}

async function readNode(nodePath) {
    return JSON.parse(await fs.readFile(nodePath, 'utf8'));
}

async function sidecarImagePath(nodePath, reference) {
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

let cdp = null;
try {
    cdp = await launch();

    // 1. Clipboard image → image block → sidecar asset + reference-only HTML.
    const firstNode = await createNode(cdp);
    await openNode(cdp, firstNode);
    assert(await pasteGeneratedImage(cdp), 'Image paste must be handled by the image block module');
    const [pasted] = await waitForLoadedImages(cdp, 1, 'pasted image block');
    assert(/^image\/[a-f0-9]{64}\.png$/.test(pasted.reference), 'Pasted image must be stored as a content-addressed PNG', pasted);

    await waitUntil('image reference persisted', async () => (await readNode(firstNode)).content?.includes(pasted.reference));
    const savedContent = (await readNode(firstNode)).content;
    assert(!/\ssrc=|blob:|data:image/.test(savedContent), 'Saved HTML must carry only the asset reference', savedContent);
    const assetPath = await sidecarImagePath(firstNode, pasted.reference);
    assert(await exists(assetPath), 'Asset must exist in the note sidecar', assetPath);

    // Pasting the same image again stores a single file.
    assert(await pasteGeneratedImage(cdp), 'Second paste must be handled');
    const twice = await waitForLoadedImages(cdp, 2, 'second image block');
    assert(twice[0].reference === twice[1].reference, 'Identical images must share one reference', twice);
    assert((await fs.readdir(path.dirname(assetPath))).filter((name) => !name.startsWith('.')).length === 1, 'Identical images must share one file');

    // 2. Delete the selected block with the keyboard, then undo.
    await cdp.evaluate(
        "(() => { const img = document.querySelector('#center-node-editor-content .pisi-image-block img'); img.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); })()"
    );
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await waitUntil('image block deleted', () => cdp.evaluate(imageState).then((images) => images.length === 1));
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
    await waitForLoadedImages(cdp, 2, 'image restored by undo');

    // Alt+Shift+ArrowDown moves the selected image block like any other block.
    const orderBefore = await cdp.evaluate(
        "Array.from(document.querySelectorAll('#center-node-editor-content > .pisi-editor-block')).map((b) => b.dataset.pisiBlockId)"
    );
    await cdp.evaluate(
        "(() => { const img = document.querySelector('#center-node-editor-content .pisi-image-block img'); img.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); })()"
    );
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, modifiers: 1 | 8 });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, modifiers: 1 | 8 });
    const orderAfter = await waitUntil('image block moved down', () =>
        cdp
            .evaluate("Array.from(document.querySelectorAll('#center-node-editor-content > .pisi-editor-block')).map((b) => b.dataset.pisiBlockId)")
            .then((order) => (order[1] === orderBefore[0] ? order : null))
    );
    assert(orderAfter[0] === orderBefore[1], 'Moved image block must swap with its neighbour', { orderBefore, orderAfter });
    await waitForLoadedImages(cdp, 2, 'images after block move');

    // Typing while an image is selected continues below it instead of replacing it.
    await cdp.evaluate(
        "(() => { const img = document.querySelector('#center-node-editor-content .pisi-image-block img'); img.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); })()"
    );
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key: 'q', code: 'KeyQ', text: 'q', windowsVirtualKeyCode: 81 });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81 });
    const typedBelow = await waitUntil('text typed below the selected image', () =>
        cdp.evaluate(
            "(() => { const first = document.querySelector('#center-node-editor-content .pisi-image-block'); const next = first?.nextElementSibling; return next && !next.matches('.pisi-image-block') && next.textContent === 'q' ? true : null; })()"
        )
    );
    assert(typedBelow, 'Typed text must land in the block after the image');
    await waitForLoadedImages(cdp, 2, 'images kept after typing');

    // 3. Copy the block into another note: the asset follows the reference.
    const secondNode = await createNode(cdp);
    const blockHtml = await cdp.evaluate("document.querySelector('#center-node-editor-content .pisi-image-block').outerHTML");
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
    await waitForLoadedImages(cdp, 1, 'image copied into second note');
    await waitUntil('copied asset stored in second sidecar', async () => exists(await sidecarImagePath(secondNode, pasted.reference)));
    await waitUntil('second note saved', async () => (await readNode(secondNode)).content?.includes(pasted.reference));

    await stop(cdp);

    // 4. After a restart the image is shown from the sidecar asset.
    cdp = await launch();
    await waitForTreeItem(cdp, firstNode);
    await openNode(cdp, firstNode);
    await waitForLoadedImages(cdp, 2, 'image after restart');

    // 5. Delete the note to Trash and restore it: the image comes back with it.
    const deleted = await cdp.evaluate('window.pisiDomain.command("project.item.delete.v1", { targetPath: ' + JSON.stringify(firstNode) + ' })');
    assert(deleted?.ok, 'Note must move to Trash', deleted);
    await waitUntil('note removed from disk', async () => !(await exists(firstNode)));
    assert(!(await exists(assetPath)), 'Sidecar asset must move to Trash with the note');
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
    assert(await exists(assetPath), 'Restored note must bring its image asset back');
    await waitForTreeItem(cdp, firstNode);
    await openNode(cdp, firstNode);
    await waitForLoadedImages(cdp, 2, 'image after Trash restore');

    console.log('[E2E] Image blocks passed: clipboard paste, dedupe, delete/undo, block move, cross-note copy, restart persistence and Trash restore.');
} finally {
    await stop(cdp);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
