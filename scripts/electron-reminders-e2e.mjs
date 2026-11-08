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

// Reminders end to end. The main-process service plans reminders from
// .pisi/tasks.json; in test mode (PISI_TEST_CAPTURE_EXTERNAL=1) native
// notifications are written to pisi-notifications.log instead of being shown,
// and reminder.test.activate.v1 stands in for a click on one of them.
// Covered: a Quick Add reminder fires once, a click opens the task's note,
// snooze and done from the in-app list, a reminder missed while Pisi was closed
// produces one summary notification and a missed entry, and the default
// reminder time is saved from Settings.

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9231;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-reminders-')));
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

const pad = (value) => String(value).padStart(2, '0');
const localMinute = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

async function readNotifications() {
    return fs
        .readFile(path.join(userDataPath, 'pisi-notifications.log'), 'utf8')
        .then((text) =>
            text
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line))
        )
        .catch(() => []);
}

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

const tasksPath = path.join(projectPath, '.pisi', 'tasks.json');
const statePath = path.join(projectPath, '.pisi', 'reminder-state.json');

async function captureTask(cdp, nodePath, text, reminderAt) {
    const result = await cdp.evaluate(
        `window.pisiDomain.command('task.capture.v1', { projectFolder: window.currentProjectFolder, task: { text: ${JSON.stringify(text)}, priority: 3, nodePath: ${JSON.stringify(
            nodePath
        )}, reminderAt: ${JSON.stringify(reminderAt)} } })`
    );
    assert(result?.ok, 'Quick Add capture must succeed', result);
    return result;
}

async function taskByTitle(text) {
    const store = await readJson(tasksPath);
    return store.tasks.find((task) => task.title === text);
}

const pendingItems = `Array.from(document.querySelectorAll('.pisi-reminder-panel:not([hidden]) .pisi-reminder-item')).map((item) => ({
    key: item.dataset.pisiReminderKey,
    taskId: item.dataset.pisiReminderTask,
    missed: item.dataset.pisiReminderMissed === '1',
    title: item.querySelector('.pisi-reminder-title')?.textContent || ''
}))`;

async function clickPanelAction(cdp, taskId, action) {
    const clicked = await cdp.evaluate(
        `(() => { const button = document.querySelector('.pisi-reminder-item[data-pisi-reminder-task=${JSON.stringify(
            taskId
        )}] [data-pisi-reminder-action=${JSON.stringify(action)}]'); button?.click(); return Boolean(button); })()`
    );
    assert(clicked, 'Reminder action button missing: ' + action);
}

let cdp = null;
try {
    cdp = await launch();
    await cdp.evaluate("localStorage.setItem('pisi.tutorial.v1.completed', '1')");
    const sourceNode = await createNode(cdp);
    const otherNode = await createNode(cdp);
    await openNode(cdp, otherNode);

    // 1. A Quick Add reminder for the current minute fires once as a native notification.
    const firstText = 'E2E hatırlatma ' + Date.now();
    await captureTask(cdp, sourceNode, firstText, localMinute(new Date()));
    const firstTask = await waitUntil('task stored with reminderAt', () => taskByTitle(firstText));
    assert(firstTask.reminderAt, 'reminderAt must be stored on the canonical task', firstTask);
    const [notification] = await waitUntil('native notification captured', async () => {
        const records = (await readNotifications()).filter((record) => record.taskId === firstTask.id);
        return records.length ? records : null;
    });
    assert(notification.kind === 'entry' && notification.body === firstText, 'Notification must name the task', notification);
    assert(notification.title === 'Pisi görev hatırlatması', 'Notification title', notification);
    await waitUntil('pending list shows the reminder', () =>
        cdp.evaluate(pendingItems).then((items) => items.some((item) => item.taskId === firstTask.id && item.title === firstText))
    );
    const state = await readJson(statePath);
    assert(
        Object.keys(state.shown || {}).some((key) => key.startsWith(firstTask.id + '@')),
        'Shown record must be in .pisi/reminder-state.json',
        state
    );
    assert(!(await cdp.evaluate("Object.keys(localStorage).some((key) => key.includes('reminded'))")), 'Reminder state must not be kept in localStorage');

    // A re-plan does not repeat it.
    await cdp.evaluate(`window.pisiDomain.command('reminder.dismiss.v1', { keys: [] })`);
    await sleep(600);
    assert((await readNotifications()).filter((record) => record.taskId === firstTask.id).length === 1, 'A reminder must be shown once');

    // 2. Clicking the notification opens the task's source note.
    const activated = await cdp.evaluate('window.pisiDomain.command("reminder.test.activate.v1", {})');
    assert(activated?.ok, 'Captured notification must activate', activated);
    await waitUntil('source note opened from the notification', () => cdp.evaluate('window.activeCenterNode?.path === ' + JSON.stringify(sourceNode)));

    // 3. Snooze from the in-app list: gone from the list, planned ten minutes later.
    const before = Date.now();
    await clickPanelAction(cdp, firstTask.id, 'snooze');
    await waitUntil('snoozed reminder leaves the list', () => cdp.evaluate(pendingItems).then((items) => !items.some((item) => item.taskId === firstTask.id)));
    const snoozed = (await readJson(statePath)).snoozed?.[firstTask.id];
    assert(snoozed && snoozed.until >= before + 9 * 60 * 1000 && snoozed.until <= Date.now() + 10 * 60 * 1000 + 1000, 'Snooze must be ten minutes', snoozed);

    // 4. Done from the in-app list completes the canonical task.
    const doneText = 'E2E tamamla ' + Date.now();
    await captureTask(cdp, sourceNode, doneText, localMinute(new Date()));
    const doneTask = await waitUntil('second task stored', () => taskByTitle(doneText));
    await waitUntil('second reminder listed', () => cdp.evaluate(pendingItems).then((items) => items.some((item) => item.taskId === doneTask.id)));
    await clickPanelAction(cdp, doneTask.id, 'complete');
    await waitUntil('task completed in tasks.json', async () => (await taskByTitle(doneText))?.status === 'done');
    await waitUntil('completed reminder leaves the list', () => cdp.evaluate(pendingItems).then((items) => !items.some((item) => item.taskId === doneTask.id)));

    // 5. Default reminder time is saved from Settings.
    const saved = await cdp.evaluate(`(async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        document.dispatchEvent(new CustomEvent('pisi:render-settings-sections', { detail: { container } }));
        const input = container.querySelector('.pisi-reminder-settings input[type="time"]');
        if (!input) return false;
        input.value = '18:30';
        input.dispatchEvent(new Event('change'));
        container.remove();
        return true;
    })()`);
    assert(saved, 'Reminder settings section must render');
    await waitUntil('default time saved', async () => (await readJson(path.join(userDataPath, 'pisi-settings.json'))).reminders?.defaultTime === '18:30');

    // 6. A reminder that comes due while Pisi is closed is reported on the next start.
    const missedText = 'E2E kaçırılan ' + Date.now();
    await captureTask(cdp, sourceNode, missedText, '2099-01-01T09:00');
    const missedTask = await waitUntil('future task stored', () => taskByTitle(missedText));
    await stop(cdp);
    const store = await readJson(tasksPath);
    store.tasks.find((task) => task.id === missedTask.id).reminderAt = '2026-01-02T08:00';
    await fs.writeFile(tasksPath, JSON.stringify(store, null, 2) + '\n', 'utf8');

    cdp = await launch();
    const summary = await waitUntil('missed summary notification', async () =>
        (await readNotifications()).find((record) => record.kind === 'summary' && /1 hatırlatma kaçırıldı/.test(record.body))
    );
    assert(summary, 'Missed reminders must produce one summary');
    const missedItems = await waitUntil('missed reminder listed', () =>
        cdp.evaluate(pendingItems).then((items) => (items.some((item) => item.taskId === missedTask.id && item.missed) ? items : null))
    );
    assert(missedItems.length >= 1, 'Missed list must not be empty', missedItems);
    await clickPanelAction(cdp, missedTask.id, 'dismiss');
    await waitUntil('missed reminder dismissed', () => cdp.evaluate(pendingItems).then((items) => !items.some((item) => item.taskId === missedTask.id)));

    console.log(
        '[E2E] Reminders passed: Quick Add reminder notified once, click opens the note, snooze, done, settings default time and missed summary after restart.'
    );
} finally {
    await stop(cdp);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
