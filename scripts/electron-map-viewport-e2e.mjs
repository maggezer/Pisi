import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generatePisiMapFixture } from './generate-map-fixture.mjs';

// Viewport culling end to end on a generated 1,000-node map: only nodes in
// view are in the DOM; a selected node stays mounted when it scrolls away; a
// node that leaves the DOM keeps its moved position; reveal and search mount
// off-screen nodes; export sees every node; the title and far zoom tiers;
// arrow keys reach a neighbour through the model.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9237;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-map-viewport-')));
const userDataPath = path.join(tempRoot, 'user-data');
const projectPath = path.join(tempRoot, 'project');

await fs.mkdir(userDataPath, { recursive: true });
await fs.mkdir(projectPath, { recursive: true });
const fixture = await generatePisiMapFixture(projectPath, [1000]);
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
    await waitUntil(
        'project restored',
        () => cdp.evaluate("document.readyState === 'complete' && window.currentProjectFolder === " + JSON.stringify(projectPath)),
        120000
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

const state = `(() => {
    const boxes = Array.from(document.querySelectorAll('#map-board .map-node-box'));
    return {
        mounted: boxes.length,
        ids: boxes.map((box) => box.dataset.nodeId),
        total: (window.activeMapNodes || []).length,
        edgesDrawn: document.querySelectorAll('#map-connections .map-edge-group').length,
        tier: document.getElementById('map-canvas').dataset.zoomTier,
        farVisible: document.getElementById('map-far-layer')?.hidden === false
    };
})()`;

async function setCamera(cdp, camera) {
    await cdp.evaluate(
        `(async () => { Object.assign(window.activeMapCamera, ${JSON.stringify(camera)}); window.applyMapCamera(); await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => requestAnimationFrame(r)); })()`
    );
}

let cdp = null;
try {
    cdp = await launch();
    await cdp.evaluate("localStorage.setItem('pisi.tutorial.v1.completed', '1')");
    const map = fixture.maps[0];
    await cdp.evaluate(
        `window.openMapInWorkspace({ fullPath: ${JSON.stringify(map.mapPath)}, name: 'Perf 1000.map', fileName: 'Perf 1000.map', isDirectory: false })`
    );
    await setCamera(cdp, { x: 0, y: 0, zoom: 1 });
    const opened = await cdp.evaluate(state);
    assert(opened.total === 1000 && opened.mounted > 0 && opened.mounted < 120, 'Only nodes in view are mounted', { ...opened, ids: undefined });
    assert(opened.edgesDrawn > 0 && opened.edgesDrawn < 200, 'Only visible connections are drawn', { ...opened, ids: undefined });
    const first = opened.ids[0];

    // A selected node stays mounted when it scrolls out of view; others leave.
    await cdp.evaluate(`document.querySelector('.map-node-box[data-node-id="${first}"]').classList.add('selected')`);
    const otherEarly = opened.ids.find((id) => id !== first);
    // Move another node a little, so it leaves the DOM with a changed position.
    await cdp.evaluate(
        `(() => { const box = document.querySelector('.map-node-box[data-node-id="${otherEarly}"]'); box.style.left = (parseFloat(box.style.left) + 33) + 'px'; })()`
    );
    const movedX = await cdp.evaluate(`parseFloat(document.querySelector('.map-node-box[data-node-id="${otherEarly}"]').style.left)`);
    await setCamera(cdp, { x: -8000, y: -2000, zoom: 1 });
    const panned = await cdp.evaluate(state);
    assert(panned.ids.includes(first), 'The selected node stays mounted', { ...panned, ids: undefined });
    assert(!panned.ids.includes(otherEarly), 'Nodes out of view leave the DOM');
    assert(panned.mounted > 1 && panned.mounted < 150, 'Nodes that scrolled in are mounted', { ...panned, ids: undefined });
    const modelX = await cdp.evaluate(`window.activeMapNodes.find((node) => node.id === ${JSON.stringify(otherEarly)}).layout.x`);
    assert(Math.round(modelX) === Math.round(movedX), 'An unmounted node keeps its latest position in the model', { modelX, movedX });

    // Reveal and search mount nodes that are not in the DOM.
    const last = await cdp.evaluate('window.activeMapNodes[999].id');
    const lastPath = await cdp.evaluate('window.activeMapNodes[999].fullPath');
    const revealed = await cdp.evaluate(`Boolean(window.revealPisiMapNode(${JSON.stringify(last)}))`);
    assert(revealed && (await cdp.evaluate(state)).ids.includes(last), 'Reveal mounts the node and moves the camera to it');
    await setCamera(cdp, { x: 0, y: 0, zoom: 1 });
    const middle = await cdp.evaluate('window.activeMapNodes[525]');
    assert(!(await cdp.evaluate(state)).ids.includes(middle.id), 'Middle node starts unmounted');
    assert(await cdp.evaluate(`Boolean(window.ensurePisiMapNodeMountedByPath(${JSON.stringify(middle.fullPath)}))`), 'Search mounts the node by path');

    // Export sees every node, then culling returns.
    const exportCount = await cdp.evaluate("window.withAllPisiMapNodesMounted(() => document.querySelectorAll('#map-board .map-node-box').length)");
    assert(exportCount === 1000, 'Export renders every node', exportCount);
    await setCamera(cdp, { x: 0, y: 0, zoom: 1 });
    assert((await cdp.evaluate(state)).mounted < 150, 'Culling resumes after export');

    // Title tier hides previews; far tier draws on the canvas with no cards.
    await setCamera(cdp, { x: 0, y: 0, zoom: 0.45 });
    const title = await cdp.evaluate(state);
    assert(title.tier === 'title', 'Title tier at 0.45', title.tier);
    const previewHidden = await cdp.evaluate("getComputedStyle(document.querySelector('#map-board .map-node-box .map-node-preview')).display === 'none'");
    assert(previewHidden, 'Title cards hide the preview');
    await cdp.evaluate(`document.querySelector('.map-node-box[data-node-id="${first}"]')?.classList.remove('selected')`);
    // Pins from reveal and search last four seconds.
    await sleep(4300);
    await setCamera(cdp, { x: 40, y: 40, zoom: 0.12 });
    const far = await cdp.evaluate(state);
    assert(far.tier === 'far' && far.farVisible && far.mounted === 0 && far.edgesDrawn === 0, 'Far tier uses the canvas only', { ...far, ids: undefined });
    await cdp.evaluate(
        `(() => { const canvas = document.getElementById('map-far-layer'); const rect = canvas.getBoundingClientRect(); const x = rect.left + 100, y = rect.top + 80; canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y })); canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })); })()`
    );
    await sleep(200);
    const zoomedIn = await cdp.evaluate('window.activeMapCamera.zoom');
    assert(Math.abs(zoomedIn - 0.6) < 1e-6, 'A click on the overview zooms in to the title tier', zoomedIn);

    // Arrow keys reach the neighbour through the model.
    await setCamera(cdp, { x: 0, y: 0, zoom: 1 });
    // activeMapNodes follows file names; pick the nodes by position.
    const n0 = await cdp.evaluate('window.activeMapNodes.find((node) => node.layout.x === 0 && node.layout.y === 0).id');
    const n1 = await cdp.evaluate('window.activeMapNodes.find((node) => node.layout.x === 260 && node.layout.y === 0).id');
    await cdp.evaluate(`document.querySelector('.map-node-box[data-node-id="${n0}"]').focus()`);
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await waitUntil('focus on the right neighbour', () => cdp.evaluate(`document.activeElement?.dataset?.nodeId === ${JSON.stringify(n1)}`));

    console.log(
        '[E2E] Map viewport passed: only visible nodes and edges mounted, selection kept off-screen, layout kept on unmount, reveal/search mount, export sees all, title and far tiers, overview click zoom, arrow navigation.'
    );
} finally {
    await stop(cdp);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
