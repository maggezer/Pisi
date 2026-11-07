import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Map editing end to end: align two selected nodes from the context menu and
// check the positions survive reopening the map (and undo in one step); connect
// them with Mod+Enter; arrow keys move focus to the neighbour with a spoken
// label; Mod+C / Mod+V into another map adds references without creating
// notes; Mod+Alt+V adds exactly one copied note; pinch zoom and long press
// work through touch events.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9233;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-map-editing-')));
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
    // Same layout on every OS: a fixed 1400×900 viewport (the default window size) and a
    // focused page, even where the OS shrinks the window to a small screen or keeps it
    // in the background (Windows CI runners).
    await cdp.request('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.request('Emulation.setFocusEmulationEnabled', { enabled: true });
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

async function exists(targetPath) {
    return fs
        .access(targetPath)
        .then(() => true)
        .catch(() => false);
}

async function waitForTreePath(cdp, targetPath) {
    await waitUntil('tree item ' + targetPath, () =>
        cdp.evaluate("Array.from(document.querySelectorAll('.tree-node[data-path]')).some((n) => n.dataset.path === " + JSON.stringify(targetPath) + ')')
    );
}

async function openMap(cdp, mapPath) {
    await waitForTreePath(cdp, mapPath);
    await cdp.evaluate(
        "(() => { const node = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((n) => n.dataset.path === " +
            JSON.stringify(mapPath) +
            "); node?.querySelector(':scope > .tree-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })); })()"
    );
    await waitUntil('map workspace for ' + mapPath, () =>
        cdp.evaluate('window.activeMapPath === ' + JSON.stringify(mapPath) + " && document.getElementById('map-canvas')?.hidden === false")
    );
}

async function createMap(cdp) {
    const before = new Set(await fs.readdir(projectPath));
    await cdp.evaluate("document.getElementById('add-map-btn').click()");
    const mapPath = await waitUntil('new map file', async () => {
        const created = (await fs.readdir(projectPath)).find((name) => name.endsWith('.map') && !before.has(name));
        return created ? path.join(projectPath, created) : null;
    });
    await openMap(cdp, mapPath);
    return mapPath;
}

async function countNodeFiles(directory = projectPath) {
    let count = 0;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) count += await countNodeFiles(full);
        else if (entry.name.endsWith('.node')) count += 1;
    }
    return count;
}

async function dblclickCanvas(cdp, dx, dy) {
    const count = await cdp.evaluate("document.querySelectorAll('#map-board .map-node-box').length");
    await cdp.evaluate(`(() => {
        const canvas = document.getElementById('map-canvas');
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, clientX: rect.left + ${dx}, clientY: rect.top + ${dy} }));
    })()`);
    await waitUntil('node created', () => cdp.evaluate("document.querySelectorAll('#map-board .map-node-box').length === " + (count + 1)));
    return cdp.evaluate("document.querySelector('#map-board .map-node-box:last-of-type').dataset.nodeId");
}

const boxes = `Array.from(document.querySelectorAll('#map-board .map-node-box')).map((box) => ({ id: box.dataset.nodeId, x: Math.round(parseFloat(box.style.left)), y: Math.round(parseFloat(box.style.top)), reference: box.dataset.pisiReference === 'true', selected: box.classList.contains('selected') }))`;
const historySize = 'window.pisiMapHistoryState.history.size()';

async function select(cdp, ids) {
    await cdp.evaluate(
        `(() => { window.clearSelectedMapNodes(); for (const id of ${JSON.stringify(ids)}) document.querySelector('.map-node-box[data-node-id="' + id + '"]').classList.add('selected'); document.activeElement?.blur?.(); })()`
    );
}

async function shortcut(cdp, key, code, keyCode, modifiers) {
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}

const CTRL = 2;
const ALT = 1;
const SHIFT = 8;

let cdp = null;
try {
    cdp = await launch();
    await cdp.evaluate("localStorage.setItem('pisi.tutorial.v1.completed', '1')");
    const firstMap = await createMap(cdp);
    const nodeA = await dblclickCanvas(cdp, 160, 140);
    const nodeB = await dblclickCanvas(cdp, 520, 330);
    await sleep(400);
    await cdp.evaluate('window.clearPisiMapHistory()');

    // 1. Align two selected nodes from the node context menu.
    await select(cdp, [nodeA, nodeB]);
    await cdp.evaluate(`(() => {
        const box = document.querySelector('.map-node-box[data-node-id="${nodeB}"]');
        const rect = box.getBoundingClientRect();
        box.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: rect.left + 20, clientY: rect.top + 20 }));
    })()`);
    const clicked = await waitUntil('align menu item', () =>
        cdp.evaluate(
            "(() => { const item = Array.from(document.querySelectorAll('#pisi-map-context-menu .pisi-map-context-menu-item')).find((el) => el.textContent === 'Sola hizala'); if (!item) return false; item.click(); return true; })()"
        )
    );
    assert(clicked, 'Align item must be in the node context menu');
    await waitUntil('align recorded as one step', () => cdp.evaluate(historySize).then((size) => size.undo === 1));
    const aligned = await cdp.evaluate(boxes);
    const alignedX = aligned.find((box) => box.id === nodeA).x;
    assert(aligned.every((box) => box.x === alignedX) && alignedX < 300, 'Both nodes share the left edge', aligned);

    // Positions survive reopening the map.
    await cdp.evaluate('window.openMapInWorkspace(window.getActiveMapTabItemForReload())');
    await sleep(600);
    const reopened = await cdp.evaluate(boxes);
    assert(
        reopened.every((box) => box.x === alignedX),
        'Aligned positions persist after reopening',
        reopened
    );
    const mapJson = JSON.parse(await fs.readFile(firstMap, 'utf8'));
    assert(
        mapJson.map.nodes.every((node) => Math.round(node.x) === alignedX),
        'Aligned positions are in the .map file',
        mapJson.map.nodes
    );

    // 2. Mod+Enter connects A → B from the keyboard.
    await cdp.evaluate(`document.querySelector('.map-node-box[data-node-id="${nodeA}"]').focus()`);
    await shortcut(cdp, 'Enter', 'Enter', 13, CTRL);
    await cdp.evaluate(`document.querySelector('.map-node-box[data-node-id="${nodeB}"]').focus()`);
    await shortcut(cdp, 'Enter', 'Enter', 13, CTRL);
    await waitUntil('keyboard connection', () => cdp.evaluate('(window.activeMapEdges || []).length === 1'));
    assert((await cdp.evaluate('Boolean(window.activeModalNode)')) === false, 'Mod+Enter must not open the note');

    // 3. Arrow keys move focus to the nearest node and announce it.
    await cdp.evaluate(`document.querySelector('.map-node-box[data-node-id="${nodeA}"]').focus()`);
    await shortcut(cdp, 'ArrowDown', 'ArrowDown', 40, 0);
    const focused = await waitUntil('focus moved down', () =>
        cdp
            .evaluate(
                "(() => { const el = document.activeElement; return el?.dataset?.nodeId ? { id: el.dataset.nodeId, label: el.getAttribute('aria-label'), description: el.getAttribute('aria-description'), selected: el.classList.contains('selected') } : null; })()"
            )
            .then((state) => (state?.id === nodeB ? state : null))
    );
    assert(
        /Yeni Node/.test(focused.label) && /1 bağlantı/.test(focused.description) && focused.selected,
        'Focused node is selected, named and described with its connections',
        focused
    );

    // 4. Mod+C, then Mod+V into another map: references only, no new note files.
    const nodeFilesBefore = await countNodeFiles();
    await select(cdp, [nodeA, nodeB]);
    await shortcut(cdp, 'c', 'KeyC', 67, CTRL);
    await waitUntil('copied', () => cdp.evaluate('window.pisiMapClipboardState.clip?.nodes?.length === 2'));
    const secondMap = await createMap(cdp);
    await cdp.evaluate('document.activeElement?.blur?.()');
    await shortcut(cdp, 'v', 'KeyV', 86, CTRL);
    const pasted = await waitUntil('references pasted', () => cdp.evaluate(boxes).then((list) => (list.length === 2 ? list : null)));
    assert(
        pasted.every((box) => box.reference),
        'Pasted nodes are map references',
        pasted
    );
    await waitUntil('edge between pasted references', () => cdp.evaluate('(window.activeMapEdges || []).length === 1'));
    assert((await countNodeFiles()) === nodeFilesBefore, 'Mod+V must not create note files');
    assert((await cdp.evaluate(historySize)).undo === 1, 'Paste is one history step');

    // 5. Mod+Alt+V pastes a copy: exactly one more note file.
    await cdp.evaluate('window.pisiMapClipboardState.clip.nodes.splice(1); window.pisiMapClipboardState.clip.edges = [];');
    await cdp.evaluate('document.activeElement?.blur?.()');
    await shortcut(cdp, 'v', 'KeyV', 86, CTRL | ALT);
    await waitUntil('copy pasted', () => cdp.evaluate(boxes).then((list) => list.length === 3));
    await waitUntil('one more note file', async () => (await countNodeFiles()) === nodeFilesBefore + 1);
    const copy = (await cdp.evaluate(boxes)).find((box) => !box.reference);
    assert(copy && copy.id !== nodeA, 'The copy is a new note with a new id', copy);
    assert(
        await cdp.evaluate(`/\\(kopya\\)/.test(document.querySelector('.map-node-box[data-node-id="${copy.id}"] .map-node-title-text').textContent)`),
        'Copy title'
    );

    // Undoing the copy sends it to Trash in one step.
    await cdp.evaluate('document.activeElement?.blur?.()');
    await shortcut(cdp, 'z', 'KeyZ', 90, CTRL);
    await waitUntil('copy undone', async () => (await countNodeFiles()) === nodeFilesBefore);
    await waitUntil('copy box removed', () => cdp.evaluate(boxes).then((list) => list.length === 2));

    // 6. Touch: two fingers pinch-zoom, a long press opens the context menu.
    const zoomBefore = await cdp.evaluate('window.activeMapCamera.zoom');
    const canvasRect = await cdp.evaluate(
        "(() => { const r = document.getElementById('map-canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()"
    );
    const touch = (id, x, y) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 });
    await cdp.request('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [touch(1, canvasRect.x - 40, canvasRect.y), touch(2, canvasRect.x + 40, canvasRect.y)]
    });
    for (let step = 1; step <= 5; step += 1) {
        await cdp.request('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [touch(1, canvasRect.x - 40 - step * 20, canvasRect.y), touch(2, canvasRect.x + 40 + step * 20, canvasRect.y)]
        });
    }
    await cdp.request('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const zoomAfter = await waitUntil('pinch zoomed in', () =>
        cdp.evaluate('window.activeMapCamera.zoom').then((zoom) => (zoom > zoomBefore * 1.3 ? zoom : null))
    );
    assert((await cdp.evaluate(historySize)).undo === 1, 'Camera moves are not history steps', zoomAfter);
    const layers = await cdp.evaluate(
        "({ board: document.getElementById('map-board').style.transform, edges: document.getElementById('map-edge-layer')?.style.transform })"
    );
    assert(layers.edges && layers.edges === layers.board, 'Connections follow the zoom with the board', layers);

    await cdp.request('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(3, canvasRect.x + 200, canvasRect.y + 150)] });
    await sleep(800);
    await cdp.request('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitUntil('long press menu', () => cdp.evaluate("Boolean(document.getElementById('pisi-map-context-menu'))"));
    void secondMap;

    console.log(
        '[E2E] Map editing passed: align is one step and persists after reopening, Mod+Enter connect, arrow focus with label, Mod+V adds references without new notes, Mod+Alt+V adds one copy and undoes in one step, pinch zoom and long press.'
    );
} finally {
    await stop(cdp);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
