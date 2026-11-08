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

// Window shell end to end (menus and print jobs are captured in test mode):
// the native context menu in the editor and on a link, no native menu where the
// Sheet and the map show their own, interface zoom with Mod+= / Mod+- / Mod+0
// kept across a restart and chosen in Settings, Mod+P still project search, and
// Mod+Alt+P / the export panel send the note's PDF-export HTML to print.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9239;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-shell-')));
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
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', PISI_TEST_USER_DATA: userDataPath, PISI_TEST_CAPTURE_SHELL: '1', PISI_TEST_CAPTURE_EXTERNAL: '1' },
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

const content =
    '<div class="pisi-editor-block" data-pisi-block-id="blk_shell_a" data-pisi-block-type="paragraph">Yazdırılacak rapor metni.</div>' +
    '<div class="pisi-editor-block" data-pisi-block-id="blk_shell_b" data-pisi-block-type="paragraph">Bağlantı: <a href="https://ornek.com/pisi">ornek</a> sonu</div>';

async function key(cdp, keyName, code, keyCode, modifiers = 0) {
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
}

async function capture(cdp) {
    return cdp.evaluate("window.pisiDomain.query('shell.test.capture.v1', {})");
}

/** Right-clicks the centre of the element matched by `selector` (in CSS pixels). */
async function rightClick(cdp, selector) {
    const point = await cdp.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return null;
        element.scrollIntoView({ block: 'center' });
        const rect = element.getBoundingClientRect();
        return { x: rect.left + Math.min(rect.width / 2, 40), y: rect.top + rect.height / 2 };
    })()`);
    assert(point, 'Element to right-click is missing', selector);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await cdp.request('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'right', clickCount: 1 });
    }
}

async function menuCount(cdp) {
    return (await capture(cdp)).menus.length;
}

async function readSettings() {
    return JSON.parse(await fs.readFile(path.join(userDataPath, 'pisi-settings.json'), 'utf8'));
}

const CTRL = 2;
const ALT = 1;

let cdp = null;
try {
    cdp = await launch();
    await cdp.evaluate("(localStorage.setItem('pisi.tutorial.v1.completed', '1'), window.finishPisiTutorial?.(true))");
    const nodePath = await createNode(cdp);
    await openNode(cdp, nodePath);
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        window.setPisiEditorContent(editor, ${JSON.stringify(content)});
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
        editor.focus();
    })()`);
    await waitUntil('content saved', async () => JSON.parse(await fs.readFile(nodePath, 'utf8')).content?.includes('blk_shell_b'));

    // 1. Native context menu: editing items in the note, link items on a link.
    await rightClick(cdp, '#center-node-editor-content [data-pisi-block-id="blk_shell_a"]');
    const editMenu = await waitUntil('editor context menu', () => capture(cdp).then((state) => state.menus[0] || null));
    assert(
        JSON.stringify(editMenu.items) === JSON.stringify(['cut', 'copy', 'paste', 'paste-plain', 'separator', 'select-all']),
        'Editable text gets cut, copy, paste, plain paste and select all',
        editMenu.items
    );
    await rightClick(cdp, '#center-node-editor-content a[href="https://ornek.com/pisi"]');
    const linkMenu = await waitUntil('link context menu', () => capture(cdp).then((state) => state.menus[1] || null));
    assert(
        linkMenu.items[0] === 'open-link' && linkMenu.items[1] === 'copy-link' && linkMenu.items.includes('paste'),
        'A link adds open and copy',
        linkMenu.items
    );

    // 2. Mod+P stays project search.
    await key(cdp, 'p', 'KeyP', 80, CTRL);
    await waitUntil('global search open', () => cdp.evaluate("document.querySelector('.pisi-global-search-input')?.closest('[hidden]') === null"));
    await key(cdp, 'Escape', 'Escape', 27);
    await waitUntil('global search closed', () => cdp.evaluate("document.querySelector('.pisi-global-search-input')?.closest('[hidden]') !== null"));

    // 3. Print: Mod+Alt+P and the export panel send the PDF-export document.
    await cdp.evaluate("document.getElementById('center-node-editor-content').focus()");
    await key(cdp, 'p', 'KeyP', 80, CTRL | ALT);
    const printed = await waitUntil('print captured', () => capture(cdp).then((state) => state.prints[0] || null));
    const title = path.basename(nodePath, '.node');
    assert(printed.title === title, 'The print job carries the note title', { printed: printed.title, title });
    assert(printed.html.includes('Yazdırılacak rapor metni.') && printed.html.includes('https://ornek.com/pisi'), 'The note content is printed', printed.html);
    assert(printed.html.startsWith('<!doctype html>') || /<html/i.test(printed.html), 'A full HTML document is sent', printed.html.slice(0, 80));
    assert(!/<script/i.test(printed.html), 'No script in the print document');
    assert(printed.options.silent === false, 'The system print dialog is used', printed.options);
    assert(!(await cdp.evaluate("document.querySelector('.pisi-global-search-input')?.closest('[hidden]') === null")), 'Mod+Alt+P does not open search');
    await cdp.evaluate('document.querySelector(\'[data-pisi-portability-action="export"]\').click()');
    await waitUntil('export panel print button', () => cdp.evaluate("Boolean(document.querySelector('[data-pisi-print-note]:not([disabled])'))"));
    await cdp.evaluate("document.querySelector('[data-pisi-print-note]').click()");
    await waitUntil('second print captured', () => capture(cdp).then((state) => state.prints.length === 2));
    await cdp.evaluate(
        "document.querySelector('.pisi-portable-overlay, .pisi-portability-overlay')?.remove?.(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
    );

    // 4. The Sheet keeps its own menu: no native one.
    await cdp.evaluate(`(() => {
        const editor = document.getElementById('center-node-editor-content');
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.querySelector('[data-editor-target="center-node-editor-content"] [data-pisi-table-trigger]').click();
    })()`);
    await waitUntil('sheet inserted', () =>
        cdp.evaluate("Boolean(document.querySelector('#center-node-editor-content table[data-pisi-sheet] td[data-cell]'))")
    );
    const beforeSheet = await menuCount(cdp);
    await rightClick(cdp, '#center-node-editor-content table[data-pisi-sheet] td[data-cell]');
    await waitUntil('sheet menu open', () => cdp.evaluate("Boolean(document.querySelector('.pisi-sheet-context-menu'))"));
    await sleep(300);
    assert((await menuCount(cdp)) === beforeSheet, 'No native menu over the Sheet menu');
    await key(cdp, 'Escape', 'Escape', 27);

    // 5. Interface zoom: Mod+= twice, Ctrl+NumpadAdd, Mod+-; kept across a restart.
    await cdp.evaluate("document.getElementById('center-node-editor-content').focus()");
    await key(cdp, '=', 'Equal', 187, CTRL);
    await key(cdp, '=', 'Equal', 187, CTRL);
    await waitUntil('zoom 1.2', () => capture(cdp).then((state) => state.zoomFactor === 1.2));
    await key(cdp, '+', 'NumpadAdd', 107, CTRL);
    await waitUntil('zoom 1.3', () => capture(cdp).then((state) => state.zoomFactor === 1.3));
    await key(cdp, '-', 'Minus', 189, CTRL);
    await waitUntil('zoom back to 1.2', () => capture(cdp).then((state) => state.zoomFactor === 1.2));
    assert((await readSettings()).shell?.zoomFactor === 1.2, 'Zoom level is stored', (await readSettings()).shell);

    // 6. The map keeps its own menu, and Mod+= on the map zooms the interface (the rule).
    const before = new Set(await fs.readdir(projectPath));
    await cdp.evaluate("document.getElementById('add-map-btn').click()");
    const mapPath = await waitUntil('new map file', async () => {
        const created = (await fs.readdir(projectPath)).find((name) => name.endsWith('.map') && !before.has(name));
        return created ? path.join(projectPath, created) : null;
    });
    await waitForTreeItem(cdp, mapPath);
    await cdp.evaluate(
        "(() => { const node = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((n) => n.dataset.path === " +
            JSON.stringify(mapPath) +
            "); node?.querySelector(':scope > .tree-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })); })()"
    );
    await waitUntil('map open', () =>
        cdp.evaluate('window.activeMapPath === ' + JSON.stringify(mapPath) + " && document.getElementById('map-canvas')?.hidden === false")
    );
    const beforeMap = await menuCount(cdp);
    const mapZoom = await cdp.evaluate('window.activeMapCamera?.zoom');
    await rightClick(cdp, '#map-canvas');
    await waitUntil('map menu open', () => cdp.evaluate("Boolean(document.getElementById('pisi-map-context-menu'))"));
    await sleep(300);
    assert((await menuCount(cdp)) === beforeMap, 'No native menu over the map menu');
    await cdp.evaluate("document.getElementById('pisi-map-context-menu')?.remove(); document.getElementById('map-canvas').focus?.()");
    await key(cdp, '=', 'Equal', 187, CTRL);
    await waitUntil('interface zoom on the map', () => capture(cdp).then((state) => state.zoomFactor === 1.3));
    assert((await cdp.evaluate('window.activeMapCamera?.zoom')) === mapZoom, 'Map zoom is unchanged');
    await key(cdp, '-', 'Minus', 189, CTRL);
    await waitUntil('zoom 1.2 again', () => capture(cdp).then((state) => state.zoomFactor === 1.2));

    await stop(cdp);
    cdp = await launch();
    await waitUntil('zoom restored after restart', () => capture(cdp).then((state) => state.zoomFactor === 1.2));
    await key(cdp, '0', 'Digit0', 48, CTRL);
    await waitUntil('zoom reset', () => capture(cdp).then((state) => state.zoomFactor === 1));

    // 7. Settings: zoom level and spell checking.
    await cdp.evaluate("window.openPisiCommandCenter('settings')");
    await waitUntil('settings zoom select', () =>
        cdp.evaluate('document.querySelector(\'[data-pisi-shell-setting="zoomFactor"] option[value="1.5"]\') !== null')
    );
    await cdp.evaluate(`(() => {
        const select = document.querySelector('[data-pisi-shell-setting="zoomFactor"]');
        select.value = '1.5';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const spell = document.querySelector('[data-pisi-shell-setting="spellcheck"]');
        spell.checked = false;
        spell.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitUntil('zoom from settings', () => capture(cdp).then((state) => state.zoomFactor === 1.5));
    await waitUntil('settings stored', async () => {
        const shell = (await readSettings()).shell;
        return shell?.zoomFactor === 1.5 && shell?.spellcheck === false;
    });

    console.log(
        '[E2E] Window shell passed: editor and link context menus, no native menu over Sheet and map menus, Mod+P search kept, Mod+Alt+P and export panel print the PDF template, interface zoom keys (also on a map) persisted across restart, Settings zoom and spell checking.'
    );
} finally {
    await stop(cdp);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
