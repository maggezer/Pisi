import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generatePisiProjectFixture } from './generate-project-fixture.mjs';

// Main-process performance report for large projects. For each size it writes
// a synthetic project (scripts/generate-project-fixture.mjs), starts Electron
// with the test-only perf probe (PISI_TEST_PERF=1) and measures, one after the
// other: project open, the first search index build, the Project Integrity
// scan, the Markdown export of the whole project and renaming 50 notes. For
// each step it reports the wall time and the main-process event loop delay
// (perf_hooks.monitorEventLoopDelay: max and p99) and the open watcher count.
// Prints a Markdown table and writes JSON + Markdown to PISI_PERF_OUTPUT.
// PISI_PERF_SIZES=1000,10000 picks the sizes. PISI_PERF_REPORT_ONLY=1 never fails.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const basePort = Number(process.env.PISI_PERF_PORT) || 9242;
const sizes = String(process.env.PISI_PERF_SIZES || '1000,10000')
    .split(',')
    .map(Number)
    .filter((value) => value > 0);
const outputFolder = path.resolve(process.env.PISI_PERF_OUTPUT || os.tmpdir());
const PISI_PERF_TIMEOUT = 20 * 60 * 1000;
const RENAMES = 50;
let child = null;
let logs = '';

function assert(condition, message, detail) {
    if (!condition) throw new Error(message + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(label, probe, timeoutMs = 15000) {
    // Probes run while main may be busy; a slow answer is not a failure.
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

async function launch(projectPath, userDataPath, port) {
    const args = ['--remote-debugging-port=' + port, ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []), repoRoot];
    child = spawn(electronPath, args, {
        cwd: repoRoot,
        env: {
            ...process.env,
            ELECTRON_ENABLE_LOGGING: '1',
            PISI_TEST_USER_DATA: userDataPath,
            PISI_TEST_PERF: '1',
            PISI_TEST_EXPORT_DIR: path.join(path.dirname(projectPath), 'export')
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const collect = (chunk) => {
        const text = String(chunk || '');
        logs += text;
        if (process.env.PISI_PERF_VERBOSE === '1') process.stdout.write(text);
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
        () =>
            cdp.evaluate(
                "document.readyState === 'complete' && window.currentProjectFolder === " +
                    JSON.stringify(projectPath) +
                    " && document.querySelectorAll('.tree-node[data-path]').length > 0"
            ),
        PISI_PERF_TIMEOUT
    );
    return cdp;
}

async function stop(cdp) {
    cdp?.close();
    if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        await waitUntil('Electron exit', async () => child.exitCode !== null, 15000).catch(() => child.kill('SIGKILL'));
    }
}

async function loop(cdp, reset = true) {
    return cdp.evaluate(`window.pisiDomain.query('perf.test.loop.v1', { reset: ${reset} })`);
}

/** Runs `expression` (awaited) in the renderer and returns wall time and the main loop delay during it. */
async function measure(cdp, label, expression) {
    await loop(cdp, true);
    const started = performance.now();
    const value = await cdp.evaluate(expression);
    const wallMs = Math.round(performance.now() - started);
    // A blocked loop is recorded when its delayed timer finally runs: wait for it.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const delay = await loop(cdp, true);
    console.log(`[perf] ${label}: ${wallMs} ms, loop max ${delay.maxMs} ms, gap ${delay.maxGapMs} ms, p99 ${delay.p99Ms} ms`);
    return { label, wallMs, loopMaxMs: delay.maxMs, gapMs: delay.maxGapMs, loopP99Ms: delay.p99Ms, watchers: delay.watchers, value };
}

async function runSize(size, index) {
    const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `pisi-project-perf-${size}-`)));
    const userDataPath = path.join(tempRoot, 'user-data');
    const projectPath = path.join(tempRoot, 'project');
    await fs.mkdir(userDataPath, { recursive: true });
    const fixture = await generatePisiProjectFixture(projectPath, { notes: size, perMap: 250 });
    await fs.writeFile(path.join(userDataPath, 'pisi-settings.json'), JSON.stringify({ lastProjectFolder: projectPath }, null, 2), 'utf8');
    const steps = [];
    let cdp = null;
    try {
        const started = performance.now();
        cdp = await launch(projectPath, userDataPath, basePort + index);
        await cdp.evaluate("localStorage.setItem('pisi.tutorial.v1.completed', '1')");
        // Let the open settle (watchers, recovery, background reads) before reading the delay.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const openDelay = await loop(cdp, true);
        steps.push({
            label: 'Proje açma',
            wallMs: Math.round(performance.now() - started),
            loopMaxMs: openDelay.maxMs,
            gapMs: openDelay.maxGapMs,
            loopP99Ms: openDelay.p99Ms,
            watchers: openDelay.watchers
        });
        console.log(`[perf] ${size} open: watchers ${openDelay.watchers}, loop max ${openDelay.maxMs} ms, gap ${openDelay.maxGapMs} ms`);
        if (process.env.PISI_PERF_OPEN_ONLY === '1') return { size, fixture: { notes: fixture.notes }, steps };

        steps.push(
            await measure(
                cdp,
                'Arama indeksi (ilk kurulum)',
                '(async () => { const index = await window.ensurePisiSearchIndex({ force: true }); return index?.records?.length ?? null; })()'
            )
        );
        steps.push(
            await measure(
                cdp,
                'Project Integrity taraması',
                `(async () => { const r = await window.pisiDomain.query('integrity.audit.v1', { projectFolder: ${JSON.stringify(projectPath)} }); return r?.ok ?? r; })()`
            )
        );
        steps.push(
            await measure(
                cdp,
                'Markdown dışa aktarma',
                `(async () => { const r = await window.pisiProject.exportProjectMarkdown(${JSON.stringify(projectPath)}); return r?.exported ?? r; })()`
            )
        );
        const renamePaths = fixture.notePaths.slice(1, 1 + RENAMES);
        steps.push(
            await measure(
                cdp,
                `Toplu yeniden adlandırma (${RENAMES} not)`,
                `(async () => { let ok = 0; for (const p of ${JSON.stringify(renamePaths)}) { const r = await window.pisiProject.renamePisiFile(p, 'Yeni ' + p.split(/[\\\\/]/).pop().replace(/\\.node$/, '')); if (r?.ok) ok += 1; } return ok; })()`
            )
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const after = await loop(cdp, false);
        steps.push({
            label: 'İzleyici sayısı (sonra)',
            wallMs: null,
            loopMaxMs: after.maxMs,
            gapMs: after.maxGapMs,
            loopP99Ms: after.p99Ms,
            watchers: after.watchers
        });
        return { size, fixture: { notes: fixture.notes, maps: fixture.maps, directories: fixture.directories, files: fixture.files }, steps };
    } finally {
        await stop(cdp);
        await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

function toMarkdown(results) {
    const lines = ['| Notlar | İşlem | Süre (ms) | Main en uzun blokaj (ms) | Histogram max (ms) | İzleyici |', '| ---: | --- | ---: | ---: | ---: | ---: |'];
    for (const result of results) {
        for (const step of result.steps) {
            lines.push(
                `| ${result.size.toLocaleString('tr-TR')} | ${step.label} | ${step.wallMs ?? '—'} | ${step.gapMs ?? '—'} | ${step.loopMaxMs} | ${step.watchers ?? '—'} |`
            );
        }
    }
    return lines.join('\n');
}

const results = [];
try {
    for (const [index, size] of sizes.entries()) {
        logs = '';
        results.push(await runSize(size, index));
    }
} catch (error) {
    console.error(error?.message || error);
    if (process.env.PISI_PERF_REPORT_ONLY !== '1') process.exitCode = 1;
}
const markdown = toMarkdown(results);
console.log('\n' + markdown);
await fs.mkdir(outputFolder, { recursive: true });
await fs.writeFile(path.join(outputFolder, 'pisi-project-performance.json'), JSON.stringify(results, null, 2), 'utf8');
await fs.writeFile(path.join(outputFolder, 'pisi-project-performance.md'), markdown + '\n', 'utf8');
