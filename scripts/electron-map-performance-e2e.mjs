import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generatePisiMapFixture } from './generate-map-fixture.mjs';

// A background or occluded test window must still run timers, animation frames and
// layout at full speed (Windows CI runners keep the window behind other desktops).
const PISI_E2E_CHROMIUM_FLAGS = [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'
];

// Map performance report. Generates synthetic maps (scripts/generate-map-fixture.mjs)
// with 200, 1,000 and 5,000 nodes, opens each in Electron and measures:
// - open time (map.projection.v1 in main, and the whole openMapInWorkspace until two frames later),
// - pan and zoom frame times (requestAnimationFrame intervals while the camera moves every frame),
// - JS heap and DOM node count after garbage collection.
// Prints a Markdown table and writes JSON + Markdown to PISI_PERF_OUTPUT (default: the temp folder).
// With PISI_PERF_REPORT_ONLY=1 (CI) it always exits 0: it reports, it does not judge.
// PISI_PERF_SIZES=200,1000 limits the sizes.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.PISI_PERF_PORT) || 9234;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-map-perf-')));
const userDataPath = path.join(tempRoot, 'user-data');
const projectPath = path.join(tempRoot, 'project');

const sizes = String(process.env.PISI_PERF_SIZES || '200,1000,5000')
    .split(',')
    .map(Number)
    .filter((value) => value > 0);
const reportOnly = process.env.PISI_PERF_REPORT_ONLY === '1';
const outputFolder = path.resolve(process.env.PISI_PERF_OUTPUT || os.tmpdir());

await fs.mkdir(userDataPath, { recursive: true });
await fs.mkdir(projectPath, { recursive: true });
const fixture = await generatePisiMapFixture(projectPath, sizes);
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

const measureInRenderer = `async (mapPath, frameCount) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const stats = (values) => {
        const sorted = [...values].sort((a, b) => a - b);
        const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
        return { avg, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0, max: sorted[sorted.length - 1] || 0, fps: avg ? 1000 / avg : 0 };
    };
    const item = { fullPath: mapPath, name: mapPath.split(/[\\\\/]/).pop(), fileName: mapPath.split(/[\\\\/]/).pop(), isDirectory: false };
    const projectionStart = performance.now();
    await window.pisiProject.listMapNodes(mapPath);
    const projectionMs = performance.now() - projectionStart;
    const openStart = performance.now();
    await window.openMapInWorkspace(item);
    await frame();
    await frame();
    const openMs = performance.now() - openStart;
    const domNodes = document.querySelectorAll('#map-board .map-node-box').length;
    const domEdges = document.querySelectorAll('#map-board .map-edge-group, svg .map-edge-group, .map-edge-group').length;
    const run = async (step) => {
        const intervals = [];
        await frame();
        let last = performance.now();
        for (let index = 0; index < frameCount; index += 1) {
            step(index);
            await frame();
            const now = performance.now();
            intervals.push(now - last);
            last = now;
        }
        return stats(intervals);
    };
    const pan = await run(() => {
        window.activeMapCamera.x -= 18;
        window.activeMapCamera.y -= 6;
        window.applyMapCamera();
    });
    const canvas = document.getElementById('map-canvas').getBoundingClientRect();
    const zoom = await run((index) => window.zoomMapAtClientPoint(canvas.left + canvas.width / 2, canvas.top + canvas.height / 2, index < frameCount / 2 ? -1 : 1));
    // Overview: the whole map on screen at a far zoom, then pan.
    window.activeMapCamera.zoom = 0.12;
    window.activeMapCamera.x = 20;
    window.activeMapCamera.y = 20;
    window.applyMapCamera();
    await frame();
    await frame();
    const overview = await run(() => {
        window.activeMapCamera.x -= 6;
        window.applyMapCamera();
    });
    const overviewBoxes = document.querySelectorAll('#map-board .map-node-box').length;
    return { projectionMs, openMs, domNodes, domEdges, pan, zoom, overview, overviewBoxes };
}`;

async function metrics(cdp) {
    await cdp.request('HeapProfiler.collectGarbage');
    const { metrics: list } = await cdp.request('Performance.getMetrics');
    const value = (name) => list.find((item) => item.name === name)?.value || 0;
    return { heapMb: value('JSHeapUsedSize') / 1048576, domNodeCount: value('Nodes') };
}

function formatRow(result) {
    const f = (value, digits = 0) => Number(value).toFixed(digits);
    return `| ${result.size} | ${result.edges} | ${f(result.projectionMs)} | ${f(result.openMs)} | ${f(result.pan.avg, 1)} / ${f(result.pan.p95, 1)} (${f(result.pan.fps)} fps) | ${f(result.zoom.avg, 1)} / ${f(result.zoom.p95, 1)} (${f(result.zoom.fps)} fps) | ${result.overview ? `${f(result.overview.avg, 1)} (${f(result.overview.fps)} fps)` : '—'} | ${f(result.heapMb, 1)} | ${result.domNodeCount} | ${result.domNodes} |`;
}

let cdp = null;
const results = [];
let failure = null;
try {
    cdp = await launch();
    await cdp.request('Performance.enable');
    await cdp.request('HeapProfiler.enable');
    await cdp.evaluate("localStorage.setItem('pisi.tutorial.v1.completed', '1')");
    const baseline = await metrics(cdp);
    for (const map of fixture.maps) {
        const frameCount = Number(process.env.PISI_PERF_FRAMES) || 90;
        const measured = await cdp.evaluate(`(${measureInRenderer})(${JSON.stringify(map.mapPath)}, ${frameCount})`);
        const memory = await metrics(cdp);
        results.push({ size: map.size, edges: map.edges, ...measured, heapMb: memory.heapMb - baseline.heapMb, domNodeCount: memory.domNodeCount });
        console.log(
            `[PERF] ${map.size} nodes: open ${Math.round(measured.openMs)} ms, pan ${measured.pan.avg.toFixed(1)} ms/frame, zoom ${measured.zoom.avg.toFixed(1)} ms/frame`
        );
    }
} catch (error) {
    failure = error;
} finally {
    await stop(cdp);
}

const table = [
    '| Düğüm | Bağlantı | Projection (ms) | Açılış (ms) | Pan ort/p95 ms (fps) | Zoom ort/p95 ms (fps) | Uzak görünüm pan ms (fps) | JS heap artışı (MB) | DOM düğümü | Çizilen kutu |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...results.map(formatRow)
].join('\n');
const report = {
    generatedAt: new Date().toISOString(),
    environment: { platform: process.platform, xvfb: Boolean(process.env.DISPLAY), electron: electronPath },
    results,
    error: failure ? String(failure.message || failure).slice(0, 2000) : null
};
await fs.mkdir(outputFolder, { recursive: true });
await fs.writeFile(path.join(outputFolder, 'pisi-map-performance.json'), JSON.stringify(report, null, 2), 'utf8');
await fs.writeFile(path.join(outputFolder, 'pisi-map-performance.md'), table + '\n', 'utf8');
console.log('\n' + table + '\n');
console.log('[E2E] Map performance report written to ' + path.join(outputFolder, 'pisi-map-performance.md'));
await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
if (failure) {
    console.error('[PERF] Measurement failed:', failure.message || failure);
    if (!reportOnly) process.exit(1);
}
