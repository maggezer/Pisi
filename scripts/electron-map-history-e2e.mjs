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

// Map undo/redo end to end: create a node, move it and connect it, undo three
// times with Mod+Z and check the map DOM and the files on disk are back at the
// starting state (the new node is in Trash), then redo three times (Mod+Shift+Z
// twice and Mod+Y once) and check the same node, layout and relationship are
// back. Also checks that an editable target keeps its own undo and that the
// history is cleared when another map opens.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9232;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-map-history-')));
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

const domState = `(() => ({
    nodes: Array.from(document.querySelectorAll('#map-board .map-node-box')).map((box) => ({ id: box.dataset.nodeId, x: Math.round(parseFloat(box.style.left || '0')), y: Math.round(parseFloat(box.style.top || '0')) })).sort((a, b) => a.id.localeCompare(b.id)),
    edges: (window.activeMapEdges || []).map((edge) => edge.id).sort(),
    history: window.pisiMapHistoryState.history.size(),
    running: window.pisiMapHistoryState.running,
    undoDisabled: document.getElementById('map-history-undo')?.disabled,
    redoDisabled: document.getElementById('map-history-redo')?.disabled
}))()`;

async function readJsonFile(filePath, fallback) {
    return fs
        .readFile(filePath, 'utf8')
        .then((text) => JSON.parse(text))
        .catch(() => fallback);
}

async function diskState(mapPath) {
    const map = (await readJsonFile(mapPath, {})).map || {};
    const relationships = (await readJsonFile(path.join(projectPath, '.pisi', 'relationships.json'), { relationships: [] })).relationships || [];
    return {
        nodes: (map.nodes || []).map((node) => ({ id: node.id, x: Math.round(node.x), y: Math.round(node.y) })).sort((a, b) => a.id.localeCompare(b.id)),
        relationships: relationships.map((item) => item.id).sort()
    };
}

async function dblclickCanvas(cdp, dx, dy) {
    const count = await cdp.evaluate("document.querySelectorAll('#map-board .map-node-box').length");
    await cdp.evaluate(`(() => {
        const canvas = document.getElementById('map-canvas');
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, clientX: rect.left + ${dx}, clientY: rect.top + ${dy} }));
    })()`);
    await waitUntil('node created on canvas', () => cdp.evaluate("document.querySelectorAll('#map-board .map-node-box').length === " + (count + 1)));
    return cdp.evaluate("document.querySelector('#map-board .map-node-box:last-of-type').dataset.nodeId");
}

async function settled(cdp, label, undo, redo) {
    return waitUntil(
        label,
        () => cdp.evaluate(domState).then((state) => (!state.running && state.history.undo === undo && state.history.redo === redo ? state : null)),
        20000
    );
}

async function shortcut(cdp, key, code, keyCode, modifiers) {
    // The map, not an editable element, owns the keyboard.
    await cdp.evaluate('document.activeElement?.blur?.()');
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}

const CTRL = 2;
const SHIFT = 8;
const undoKey = (cdp) => shortcut(cdp, 'z', 'KeyZ', 90, CTRL);
const redoKey = (cdp) => shortcut(cdp, 'Z', 'KeyZ', 90, CTRL | SHIFT);
const redoAltKey = (cdp) => shortcut(cdp, 'y', 'KeyY', 89, CTRL);

let cdp = null;
try {
    cdp = await launch();
    await cdp.evaluate("(localStorage.setItem('pisi.tutorial.v1.completed', '1'), window.finishPisiTutorial?.(true))");
    const mapPath = await createMap(cdp);
    const nodeA = await dblclickCanvas(cdp, 160, 140);
    await sleep(500);
    // Start from a clean history with node A on the map.
    await cdp.evaluate('window.clearPisiMapHistory()');
    const startDom = await settled(cdp, 'clean start', 0, 0);
    assert(startDom.undoDisabled === true && startDom.redoDisabled === true, 'Buttons are disabled with nothing to undo', startDom);
    const startDisk = await diskState(mapPath);
    assert(startDisk.nodes.length === 1 && startDisk.relationships.length === 0, 'Start state', startDisk);

    // 1. Create node B.
    const nodeB = await dblclickCanvas(cdp, 520, 160);
    await settled(cdp, 'create recorded', 1, 0);
    const nodeBPath = await cdp.evaluate(`document.querySelector('.map-node-box[data-node-id="${nodeB}"]').dataset.nodePath`);

    // 2. Move node B with one drag.
    await cdp.evaluate(`(() => {
        const box = document.querySelector('.map-node-box[data-node-id="${nodeB}"]');
        const rect = box.getBoundingClientRect();
        const startX = rect.left + 30;
        const startY = rect.top + 40;
        box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: startX, clientY: startY }));
        window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, clientX: startX + 60, clientY: startY + 30 }));
        window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, button: 0, clientX: startX + 120, clientY: startY + 90 }));
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: startX + 120, clientY: startY + 90 }));
    })()`);
    await settled(cdp, 'move recorded as one step', 2, 0);

    // 3. Connect A → B with the keyboard port flow.
    await cdp.evaluate(`(() => {
        const press = (port) => port.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        press(document.querySelector('.map-node-box[data-node-id="${nodeA}"] .map-port.bottom'));
        press(document.querySelector('.map-node-box[data-node-id="${nodeB}"] .map-port.top'));
    })()`);
    const endDom = await settled(cdp, 'connection recorded', 3, 0);
    assert(endDom.edges.length === 1, 'One connection on the map', endDom);
    assert(endDom.undoDisabled === false && endDom.redoDisabled === true, 'Undo enabled, redo disabled', endDom);
    await sleep(800);
    const endDisk = await diskState(mapPath);
    assert(endDisk.nodes.length === 2 && endDisk.relationships.length === 1, 'End state on disk', endDisk);

    // An editable target keeps its own undo: Mod+Z in an input does not touch the map history.
    await cdp.evaluate(
        "(() => { const input = document.createElement('input'); input.id = 'e2e-history-input'; document.body.appendChild(input); input.focus(); })()"
    );
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: CTRL });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: CTRL });
    await sleep(300);
    assert((await cdp.evaluate(domState)).history.undo === 3, 'Mod+Z in an input must not undo the map');
    await cdp.evaluate("document.getElementById('e2e-history-input').remove()");

    // 4. Undo three times: map and disk return to the start state; B is in Trash.
    await undoKey(cdp);
    await settled(cdp, 'undo connection', 2, 1);
    await undoKey(cdp);
    await settled(cdp, 'undo move', 1, 2);
    await undoKey(cdp);
    const undoneDom = await settled(cdp, 'undo create', 0, 3);
    assert(JSON.stringify(undoneDom.nodes) === JSON.stringify(startDom.nodes), 'Map DOM back at start', { undoneDom, startDom });
    assert(undoneDom.edges.length === 0, 'No connection after undo', undoneDom);
    assert(undoneDom.undoDisabled === true && undoneDom.redoDisabled === false, 'Undo disabled, redo enabled', undoneDom);
    const undoneDisk = await diskState(mapPath);
    assert(JSON.stringify(undoneDisk) === JSON.stringify(startDisk), 'Disk back at start', { undoneDisk, startDisk });
    assert(!(await exists(nodeBPath)), 'Created node must be in Trash after undo');
    const trash = await cdp.evaluate('window.pisiDomain.query("trash.list.v1", { projectFolder: window.currentProjectFolder })');
    assert(
        (trash?.items || []).some((item) => String(item.originalTarget || '').endsWith(path.basename(nodeBPath))),
        'Trash lists the undone node',
        trash
    );

    // 5. Redo three times: Mod+Shift+Z twice, then Mod+Y.
    await redoKey(cdp);
    await settled(cdp, 'redo create', 1, 2);
    await redoKey(cdp);
    await settled(cdp, 'redo move', 2, 1);
    await redoAltKey(cdp);
    const redoneDom = await settled(cdp, 'redo connection', 3, 0);
    assert(JSON.stringify(redoneDom.nodes) === JSON.stringify(endDom.nodes), 'Same nodes and layout after redo', { redoneDom, endDom });
    assert(JSON.stringify(redoneDom.edges) === JSON.stringify(endDom.edges), 'Same connection id after redo', { redoneDom, endDom });
    assert(await exists(nodeBPath), 'Node restored at its path');
    await sleep(800);
    const redoneDisk = await diskState(mapPath);
    assert(JSON.stringify(redoneDisk) === JSON.stringify(endDisk), 'Disk back at end state', { redoneDisk, endDisk });

    // 6. Opening another map clears the history.
    await createMap(cdp);
    const otherDom = await settled(cdp, 'history cleared on map change', 0, 0);
    assert(otherDom.undoDisabled === true && otherDom.redoDisabled === true, 'Buttons disabled on another map', otherDom);
    await openMap(cdp, mapPath);
    assert((await cdp.evaluate(domState)).history.undo === 0, 'History does not come back with the first map');

    console.log(
        '[E2E] Map history passed: create, move and connect undone three times to the start state on screen and disk, redone with Mod+Shift+Z and Mod+Y, input keeps its own undo, map change clears history.'
    );
} finally {
    await stop(cdp);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
