import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { keepPagePromise } from './e2e-cdp.mjs';

// Launching Pisi for the task E2E scripts (docs/task-plan.md §3.8): the
// renderer over CDP, the main process over its inspector with .node reads and
// writes counted (GV5), and Project Integrity after each scenario (GV14).

const PISI_E2E_CHROMIUM_FLAGS = [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'
];

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function assert(condition, message, detail) {
    if (!condition) throw new Error(message + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
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

    async evaluate(expression, { page = true } = {}) {
        const response = await this.request('Runtime.evaluate', {
            expression: page ? keepPagePromise(expression) : expression,
            awaitPromise: true,
            returnByValue: true
        });
        if (response.exceptionDetails) {
            throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Evaluation failed');
        }
        return response.result?.value;
    }

    close() {
        this.socket.close();
    }
}

/** One Pisi process for an E2E script: `launch(project)`, `stop()`, and the helpers bound to it. */
export function createPisiTasksE2E({ tempRoot, port, inspectPort }) {
    const userDataPath = path.join(tempRoot, 'user-data');
    let child = null;
    let logs = '';
    let app = null;

    async function waitUntil(label, probe, timeoutMs = 15000) {
        const started = Date.now();
        let lastValue = null;
        while (Date.now() - started < timeoutMs) {
            if (child?.exitCode !== null) throw new Error('Electron exited while waiting for ' + label + '.\n' + logs.slice(-4000));
            try {
                lastValue = await probe();
                if (lastValue) return lastValue;
            } catch (error) {
                lastValue = String(error?.message || error);
            }
            await sleep(100);
        }
        throw new Error('Timed out waiting for ' + label + '. Last value: ' + JSON.stringify(lastValue));
    }

    async function launch(project) {
        await fs.mkdir(userDataPath, { recursive: true });
        await fs.writeFile(path.join(userDataPath, 'pisi-settings.json'), JSON.stringify({ lastProjectFolder: project }, null, 2), 'utf8');
        const args = [
            '--remote-debugging-port=' + port,
            '--inspect=' + inspectPort,
            ...PISI_E2E_CHROMIUM_FLAGS,
            ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []),
            repoRoot
        ];
        logs = '';
        child = spawn(electronPath, args, {
            cwd: repoRoot,
            env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', PISI_TEST_USER_DATA: userDataPath },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const collect = (chunk) => {
            logs += String(chunk || '');
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
            () => cdp.evaluate("document.readyState === 'complete' && window.currentProjectFolder === " + JSON.stringify(project)),
            30000
        );
        await cdp.evaluate("(localStorage.setItem('pisi.tutorial.v1.completed', '1'), window.finishPisiTutorial?.(true))");
        await waitUntil('task store loaded', () => cdp.evaluate('window.isPisiTaskStoreLoaded?.() === true'), 30000);
        const target = await waitUntil('main inspector', async () => {
            const response = await fetch('http://127.0.0.1:' + inspectPort + '/json/list');
            const targets = response.ok ? await response.json() : [];
            return targets[0] || null;
        });
        const main = new CdpClient(target.webSocketDebuggerUrl);
        await main.open();
        // Atomic writes go to a temp file and rename onto the .node: both are counted.
        await main.evaluate(
            `(() => {
                const fs = process.getBuiltinModule('node:fs');
                const { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
                const counts = (globalThis.__pisiNodeIo = { reads: [], writes: [], taskStoreWrites: [] });
                const wrap = (name, kind) => {
                    const original = fs[name];
                    fs[name] = function countingPisiFs(target, ...rest) {
                        const value = String(name === 'renameSync' ? rest[0] : target);
                        if (/\\.node$/i.test(value)) counts[kind].push(value);
                        if (kind === 'writes' && /[\\\\/]\\.pisi[\\\\/]tasks\\.json$/i.test(value)) counts.taskStoreWrites.push(value);
                        return original.call(this, target, ...rest);
                    };
                };
                wrap('readFileSync', 'reads');
                wrap('writeFileSync', 'writes');
                wrap('renameSync', 'writes');
                syncBuiltinESMExports();
                return true;
            })()`,
            { page: false }
        );
        app = { cdp, main, project };
        return app;
    }

    async function stop() {
        app?.cdp?.close();
        app?.main?.close();
        if (child && child.exitCode === null) {
            child.kill('SIGTERM');
            await waitUntil('Electron exit', async () => child.exitCode !== null, 8000).catch(() => child.kill('SIGKILL'));
        }
        app = null;
    }

    return { launch, stop, waitUntil, logs: () => logs };
}

export const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));
export const tasksPath = (project) => path.join(project, '.pisi', 'tasks.json');
export const diaryPath = (project, day) => path.join(project, 'diary', `${day}.node`);
export const storedTasks = async (project) => {
    try {
        return (await readJson(tasksPath(project))).tasks;
    } catch {
        return [];
    }
};
export const storedTask = async (project, id) => (await storedTasks(project)).find((task) => task.id === id) || null;

/**
 * Runs `run` and returns its result with the main process's .node reads and
 * writes during it, and the writes of .pisi/tasks.json (`taskStoreWrites`).
 */
export async function countNodeIo(app, run) {
    await app.main.evaluate('(globalThis.__pisiNodeIo.reads = [], globalThis.__pisiNodeIo.writes = [], globalThis.__pisiNodeIo.taskStoreWrites = [], true)', {
        page: false
    });
    const result = await run();
    const io = await app.main.evaluate(
        '({ reads: globalThis.__pisiNodeIo.reads.slice(), writes: globalThis.__pisiNodeIo.writes.slice(), taskStoreWrites: globalThis.__pisiNodeIo.taskStoreWrites.slice() })',
        { page: false }
    );
    return { result, io };
}

export async function integrityIssues(app) {
    const audit = await app.cdp.evaluate(`window.pisiDomain.query('integrity.audit.v1', { projectFolder: ${JSON.stringify(app.project)} })`);
    return Array.isArray(audit?.issues) ? audit.issues : audit?.report?.issues;
}

export async function assertIntegrityClean(app, label) {
    const issues = await integrityIssues(app);
    assert(Array.isArray(issues) && issues.length === 0, 'Project Integrity after ' + label, issues);
}
