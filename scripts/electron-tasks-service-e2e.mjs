import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { keepPagePromise } from './e2e-cdp.mjs';
import { formatPisiTaskId } from '../shared/ids.mjs';
import { listPisiDiaryTaskIds, readPisiDiaryTaskSection } from '../shared/task-diary.mjs';
import { getPisiTodayIsoDate, normalizePisiTask } from '../shared/task-model.mjs';

// The task service end to end (docs/task-plan.md G2, Ek B S1–S9, S11, S17, S19,
// S21), in the real app over CDP. The renderer runs the task.*.v1 commands the
// UI runs; the main process is reached through its inspector, where the .node
// reads and writes are counted (GV5). After every scenario Project Integrity
// must report nothing (GV14).

const PISI_E2E_CHROMIUM_FLAGS = [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'
];

const require = createRequire(import.meta.url);
const electronPath = /** @type {string} */ (require('electron'));
const repoRoot = path.resolve(import.meta.dirname, '..');
const port = 9251;
const inspectPort = 9252;
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-tasks-')));
const userDataPath = path.join(tempRoot, 'user-data');
const projectPath = path.join(tempRoot, 'project');
const bigProjectPath = path.join(tempRoot, 'big-project');

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

    // The main process: count .node reads and writes (GV5). Atomic writes go to a temp file and rename onto the .node.
    const target = await waitUntil('main inspector', async () => {
        const response = await fetch('http://127.0.0.1:' + inspectPort + '/json/list');
        const targets = response.ok ? await response.json() : [];
        return targets[0] || null;
    });
    const main = new CdpClient(target.webSocketDebuggerUrl);
    await main.open();
    await main.evaluate(
        `(() => {
            const fs = process.getBuiltinModule('node:fs');
            const { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
            const counts = (globalThis.__pisiNodeIo = { reads: [], writes: [] });
            const wrap = (name, kind) => {
                const original = fs[name];
                fs[name] = function countingPisiFs(target, ...rest) {
                    const value = String(name === 'renameSync' ? rest[0] : target);
                    if (/\\.node$/i.test(value)) counts[kind].push(value);
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
    return { cdp, main };
}

async function stop(app) {
    app?.cdp?.close();
    app?.main?.close();
    if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        await waitUntil('Electron exit', async () => child.exitCode !== null, 8000).catch(() => child.kill('SIGKILL'));
    }
}

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));
const tasksPath = (project) => path.join(project, '.pisi', 'tasks.json');
const diaryPath = (project, day) => path.join(project, 'diary', `${day}.node`);
const storedTask = async (project, id) => (await readJson(tasksPath(project))).tasks.find((task) => task.id === id);
const diaryIds = async (project, day) => {
    try {
        return readPisiDiaryTaskSection((await readJson(diaryPath(project, day))).content).taskIds;
    } catch {
        return null;
    }
};
const addDays = (day, days) => {
    const date = new Date(`${day}T12:00:00`);
    date.setDate(date.getDate() + days);
    return getPisiTodayIsoDate(date);
};

/** Runs `run` and returns its result with the main process's .node reads and writes during it. */
async function countNodeIo(app, run) {
    await app.main.evaluate('(globalThis.__pisiNodeIo.reads = [], globalThis.__pisiNodeIo.writes = [], true)', { page: false });
    const result = await run();
    const io = await app.main.evaluate('({ reads: globalThis.__pisiNodeIo.reads.slice(), writes: globalThis.__pisiNodeIo.writes.slice() })', {
        page: false
    });
    return { result, io };
}

const command = (app, name, payload) => app.cdp.evaluate(`window.runPisiTaskCommand(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);

async function createTask(app, task, target) {
    const result = await command(app, 'task.create.v1', { task, target });
    assert(result?.ok, 'task.create.v1 ' + task.title, result);
    return result.task;
}

async function integrityIssues(app, project) {
    const audit = await app.cdp.evaluate(`window.pisiDomain.query('integrity.audit.v1', { projectFolder: ${JSON.stringify(project)} })`);
    return Array.isArray(audit?.issues) ? audit.issues : audit?.report?.issues;
}

async function assertClean(app, project, label) {
    const issues = await integrityIssues(app, project);
    assert(Array.isArray(issues) && issues.length === 0, 'Project Integrity after ' + label, issues);
}

async function createNote(app, project) {
    const before = new Set(await fs.readdir(project));
    assert(await app.cdp.evaluate("(() => { const b = document.getElementById('add-node-btn'); b?.click(); return Boolean(b); })()"), 'Add Node button');
    const notePath = await waitUntil('new note file', async () => {
        const created = (await fs.readdir(project)).find((name) => name.endsWith('.node') && !before.has(name));
        return created ? path.join(project, created) : null;
    });
    await waitUntil('tree item', () =>
        app.cdp.evaluate(`Array.from(document.querySelectorAll('.tree-node[data-path]')).some((n) => n.dataset.path === ${JSON.stringify(notePath)})`)
    );
    return { path: notePath, id: (await readJson(notePath)).pisi.id };
}

async function openNote(app, notePath) {
    await app.cdp.evaluate(
        `(() => { const node = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((n) => n.dataset.path === ${JSON.stringify(
            notePath
        )}); node?.querySelector(':scope > .tree-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })); })()`
    );
    await waitUntil('editor for ' + notePath, () =>
        app.cdp.evaluate(`window.activeCenterNode?.path === ${JSON.stringify(notePath)} && document.getElementById('center-node-editor')?.hidden === false`)
    );
}

async function closeEditors(app) {
    await app.cdp.evaluate(`(async () => {
        await window.flushPisiPendingSaves?.();
        await window.removePisiOpenTabsForDeletedPaths?.((window.Pisi?.state?.openTabs || []).map((tab) => tab.path));
        return true;
    })()`);
    await waitUntil('no open note', () => app.cdp.evaluate('!window.activeCenterNode && !window.activeModalNode'));
}

async function saveOpenNote(app, notePath) {
    const saved = await app.cdp.evaluate('window.flushPisiPendingSaves?.()');
    assert(saved !== false, 'pending saves', saved);
    return readJson(notePath);
}

// ---- A big project for S8: 1.000 notes and 5.000 tasks ---------------------------------

async function writeBigProject() {
    await fs.mkdir(path.join(bigProjectPath, '.pisi'), { recursive: true });
    const now = new Date();
    const today = getPisiTodayIsoDate(now);
    const tasks = [];
    for (let index = 0; index < 1000; index += 1) {
        const id = `node_${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`;
        const blocks = [];
        for (let task = 0; task < 5; task += 1) {
            const taskId = formatPisiTaskId(`${String(index).padStart(8, '0')}-${String(task).padStart(4, '0')}-4000-8000-000000000000`);
            const normalized = normalizePisiTask({ id: taskId, title: `Görev ${index}.${task}`, noteId: id, dueDate: today }, null, {
                now,
                makeUuid: () => ''
            });
            tasks.push(normalized.task);
            blocks.push(
                `<div class="pisi-editor-block pisi-task-block" data-pisi-block-id="blk_${String(index).padStart(5, '0')}_${task}" data-pisi-block-type="task" data-pisi-task-id="${taskId}" contenteditable="false"></div>`
            );
        }
        const document = {
            pisi: {
                version: 1,
                type: 'node',
                id,
                title: `Not ${index}`,
                sidecar: null,
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
                parentMap: null
            },
            content: `<div class="pisi-editor-block" data-pisi-block-id="blk_p${index}">Not ${index}</div>${blocks.join('')}`
        };
        await fs.writeFile(path.join(bigProjectPath, `Not ${index}.node`), JSON.stringify(document, null, 2));
    }
    await fs.writeFile(tasksPath(bigProjectPath), JSON.stringify({ version: 2, updatedAt: now.toISOString(), tasks }, null, 2) + '\n');
    return { today, tasks };
}

// ---- Scenarios ------------------------------------------------------------------------

let app = null;
const timings = {};
try {
    await fs.mkdir(projectPath, { recursive: true });
    app = await launch(projectPath);
    const today = await app.cdp.evaluate('window.getPisiTaskToday()');
    const note = await createNote(app, projectPath);
    await closeEditors(app);

    // S1 · A task in a note and one in a diary; the note task is completed from the panel's command.
    const noteTask = await createTask(app, { title: 'Nottaki görev', dueDate: today }, { noteId: note.id, notePath: note.path });
    const diaryTask = await createTask(app, { title: 'Günlükteki görev' }, { diaryDate: today });
    assert((await readJson(note.path)).content.includes(`data-pisi-task-id="${noteTask.id}"`), 'S1: the closed note got the block');
    {
        const { result, io } = await countNodeIo(app, () => command(app, 'task.complete.v1', { taskId: noteTask.id }));
        assert(result?.ok, 'S1 complete', result);
        assert(io.reads.length === 0 && io.writes.length === 0, 'S1: completing on the due day touches no .node', io);
        assert((await storedTask(projectPath, noteTask.id)).status === 'done', 'S1: done in tasks.json');
        await app.cdp.evaluate(`document.querySelector('.right-panel-tab[data-right-tab="missions"]')?.click()`);
        await app.cdp.evaluate(`(() => { const b = document.querySelector('.pisi-task-panel-toggle input'); if (b && !b.checked) b.click(); return true; })()`);
        await waitUntil('S1: the panel shows the task ticked', () =>
            app.cdp.evaluate(
                `document.querySelector('.pisi-task-panel-row[data-pisi-task-id=${JSON.stringify(noteTask.id)}] .pisi-task-panel-check')?.checked === true`
            )
        );
    }
    await assertClean(app, projectPath, 'S1');

    // S3 · Field changes write tasks.json only.
    for (const patch of [{ status: 'doing' }, { title: 'Yeni başlık' }, { priority: 5 }, { dueTime: '08:15' }, { reminderMode: 'due-morning' }]) {
        const { result, io } = await countNodeIo(app, () => command(app, 'task.update.v1', { taskId: diaryTask.id, patch }));
        assert(result?.ok, 'S3 update', { patch, result });
        assert(io.reads.length === 0 && io.writes.length === 0, 'S3: a field change touches no .node', { patch, io });
    }
    assert((await storedTask(projectPath, diaryTask.id)).status === 'doing', 'S3: status in tasks.json');
    await assertClean(app, projectPath, 'S3');

    // S2 · A repeating task: one completion, it moves to the next day; that day ☑, the next day ☐.
    const daily = await createTask(app, { title: 'Spor', repeat: 'daily', dueDate: today }, { diaryDate: today });
    {
        const tomorrow = addDays(today, 1);
        const { result, io } = await countNodeIo(app, () => command(app, 'task.complete.v1', { taskId: daily.id }));
        assert(result?.ok, 'S2 complete', result);
        const stored = await storedTask(projectPath, daily.id);
        assert(stored.completions.length === 1 && stored.dueDate === tomorrow && stored.status === 'todo', 'S2: moved on', stored);
        assert((await diaryIds(projectPath, today)).includes(daily.id) && (await diaryIds(projectPath, tomorrow)).includes(daily.id), 'S2: both days list it');
        assert(
            io.writes.every((file) => file.endsWith(`${tomorrow}.node`)),
            'S2: only the next day diary is written',
            io
        );
    }
    await assertClean(app, projectPath, 'S2');

    // S21 · An overdue repeat: completed today for the missed occurrence, then the first day after today.
    const overdue = await createTask(app, { title: 'Geciken', repeat: 'daily', dueDate: addDays(today, -3) }, { diaryDate: addDays(today, -3) });
    {
        const result = await command(app, 'task.complete.v1', { taskId: overdue.id });
        assert(result?.ok, 'S21 complete', result);
        const stored = await storedTask(projectPath, overdue.id);
        const last = stored.completions.at(-1);
        assert(
            last.date === today && last.dueDate === addDays(today, -3) && stored.dueDate === addDays(today, 1),
            'S21: completion today, next tomorrow',
            stored
        );
    }
    await assertClean(app, projectPath, 'S21');

    // S9 · A task dated later: its diary is created with the section; the calendar marks the day.
    {
        const later = addDays(today, 2);
        const dated = await createTask(app, { title: 'İleri tarihli' }, { noteId: note.id, notePath: note.path });
        const { result } = await countNodeIo(app, () => command(app, 'task.update.v1', { taskId: dated.id, patch: { dueDate: later } }));
        assert(result?.ok && result.createdDiaries.includes(later), 'S9: the diary is created', result);
        assert((await diaryIds(projectPath, later)).includes(dated.id), 'S9: the section lists it');
        await app.cdp.evaluate('window.refreshPisiCalendar?.()');
        await waitUntil('S9: calendar mark', () =>
            app.cdp.evaluate(
                `document.querySelector('.pisi-calendar-day[data-date=${JSON.stringify(later)}]')?.classList.contains('has-uncompleted-tasks') === true`
            )
        );
    }
    await assertClean(app, projectPath, 'S9');

    // S4 · A version 1 task without a place (the phone wrote it) is completed and edited; no source is added.
    {
        const store = await readJson(tasksPath(projectPath));
        const v1 = {
            id: 'task_phone000001',
            title: 'Telefondan',
            status: 'todo',
            priority: 3,
            dueDate: today,
            todoTag: 'todo.3.none',
            source: {},
            dependencies: []
        };
        store.tasks.push(v1);
        await fs.writeFile(tasksPath(projectPath), JSON.stringify(store, null, 2) + '\n');
        await app.cdp.evaluate('window.loadPisiTaskStore({ force: true })');
        assert((await command(app, 'task.update.v1', { taskId: v1.id, patch: { title: 'Masaüstünde düzenlendi' } }))?.ok, 'S4 update');
        assert((await command(app, 'task.complete.v1', { taskId: v1.id }))?.ok, 'S4 complete');
        const stored = await storedTask(projectPath, v1.id);
        assert(stored.status === 'done' && stored.title === 'Masaüstünde düzenlendi' && JSON.stringify(stored.source) === '{}' && !stored.noteId, 'S4', stored);
    }
    await assertClean(app, projectPath, 'S4');

    // S5 · Completed from a reminder, then the note is edited and saved: it stays done.
    {
        const reminded = await createTask(app, { title: 'Hatırlatmalı', dueDate: today }, { noteId: note.id, notePath: note.path });
        const completed = await app.cdp.evaluate(
            `window.pisiDomain.command('reminder.complete.v1', { key: ${JSON.stringify(reminded.id + '@2026-01-01T00:00:00.000Z')} })`
        );
        assert(completed?.ok !== false, 'S5 reminder complete', completed);
        await waitUntil('S5: done', async () => (await storedTask(projectPath, reminded.id))?.status === 'done');
        await openNote(app, note.path);
        await app.cdp.evaluate(`(() => {
            const editor = document.getElementById('center-node-editor-content');
            const block = document.createElement('div');
            block.className = 'pisi-editor-block';
            block.textContent = 'Not düzenlendi.';
            editor.prepend(block);
            editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
            return true;
        })()`);
        const saved = await saveOpenNote(app, note.path);
        assert(
            saved.content.includes('Not düzenlendi.') && saved.content.includes(`data-pisi-task-id="${reminded.id}"`),
            'S5: the note keeps the block',
            saved.content
        );
        assert((await storedTask(projectPath, reminded.id)).status === 'done', 'S5: still done');
    }
    await assertClean(app, projectPath, 'S5');

    // S7 · A task added to the open note: the editor shows the block at once, the file keeps it after the save.
    {
        const result = await app.cdp.evaluate(
            `window.createPisiTaskInTarget({ title: 'Açık nota eklenen' }, { noteId: ${JSON.stringify(note.id)}, notePath: ${JSON.stringify(note.path)} })`
        );
        assert(result?.ok && result.deferred.notes.length === 1, 'S7: the open note is left to the editor', result);
        await waitUntil('S7: block drawn in the editor', () =>
            app.cdp.evaluate(`document.getElementById('center-node-editor-content').innerText.includes('Açık nota eklenen')`)
        );
        const saved = await saveOpenNote(app, note.path);
        assert(saved.content.includes(`data-pisi-task-id="${result.task.id}"`), 'S7: the block is saved', saved.content);
        assert(!saved.content.includes('Açık nota eklenen'), 'S7: the title is not in the note (GV2)');
    }
    await assertClean(app, projectPath, 'S7');

    // S6 · The block is deleted and the note saved: the task goes to the Trash and leaves the diaries; undo brings it back.
    {
        const doomed = await createTask(app, { title: 'Silinecek', dueDate: addDays(today, 4) }, { noteId: note.id, notePath: note.path });
        await waitUntil('S6: block in the editor', () =>
            app.cdp.evaluate(`Boolean(document.querySelector('#center-node-editor-content [data-pisi-task-id=${JSON.stringify(doomed.id)}]'))`)
        );
        const blockHtml = await app.cdp.evaluate(`(() => {
            const block = document.querySelector('#center-node-editor-content [data-pisi-task-id=${JSON.stringify(doomed.id)}]');
            const html = block.outerHTML;
            block.remove();
            document.getElementById('center-node-editor-content').dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
            return html;
        })()`);
        const savedWithout = await saveOpenNote(app, note.path);
        assert(!savedWithout.content.includes(doomed.id), 'S6: the note is saved without the block', savedWithout.content);
        await waitUntil('S6: gone from tasks.json', async () => !(await storedTask(projectPath, doomed.id)));
        assert(!(await diaryIds(projectPath, addDays(today, 4))).includes(doomed.id), 'S6: gone from its diary');
        const trash = await app.cdp.evaluate(`window.pisiDomain.query('trash.list.v1', { projectFolder: ${JSON.stringify(projectPath)} })`);
        assert(
            trash.items.some((item) => item.kind === 'task' && item.label === 'Silinecek'),
            'S6: a task Trash item',
            trash.items
        );
        await app.cdp.evaluate(`(() => {
            const editor = document.getElementById('center-node-editor-content');
            const template = document.createElement('template');
            template.innerHTML = ${JSON.stringify(blockHtml)};
            editor.appendChild(template.content.firstElementChild);
            editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'historyUndo' }));
            return true;
        })()`);
        await saveOpenNote(app, note.path);
        await waitUntil('S6: back in tasks.json', async () => Boolean(await storedTask(projectPath, doomed.id)));
        assert((await diaryIds(projectPath, addDays(today, 4))).includes(doomed.id), 'S6: back in its diary');
    }
    await assertClean(app, projectPath, 'S6');
    await closeEditors(app);

    // S11 · In a diary, the repeating task's checkbox completes it (the diary section draws the rows).
    {
        const dayTask = await createTask(app, { title: 'Günlük tekrar', repeat: 'daily' }, { diaryDate: today });
        await app.cdp.evaluate(`window.openPisiDiaryForDate(${JSON.stringify(today)})`);
        await waitUntil('S11: the diary is open', () => app.cdp.evaluate(`window.activeCenterNode?.metadata?.diaryDate === ${JSON.stringify(today)}`));
        await waitUntil('S11: the row is drawn', () =>
            app.cdp.evaluate(
                `Boolean(document.querySelector('#center-node-editor-content .pisi-diary-task-row[data-pisi-task-row=${JSON.stringify(dayTask.id)}] [data-pisi-task-check]'))`
            )
        );
        await app.cdp.evaluate(
            `document.querySelector('#center-node-editor-content .pisi-diary-task-row[data-pisi-task-row=${JSON.stringify(dayTask.id)}] [data-pisi-task-check]').click()`
        );
        await waitUntil('S11: completed and moved on', async () => {
            const stored = await storedTask(projectPath, dayTask.id);
            return stored.completions.length === 1 && stored.dueDate === addDays(today, 1);
        });
        await waitUntil('S11: the row is ticked on that day', () =>
            app.cdp.evaluate(
                `document.querySelector('#center-node-editor-content .pisi-diary-task-row[data-pisi-task-row=${JSON.stringify(dayTask.id)}] [data-pisi-task-check]')?.getAttribute('aria-checked') === 'true'`
            )
        );
        await saveOpenNote(app, diaryPath(projectPath, today));
        const tasks = (await readJson(tasksPath(projectPath))).tasks;
        assert(
            JSON.stringify(await diaryIds(projectPath, today)) === JSON.stringify(listPisiDiaryTaskIds(today, tasks)),
            'S11: the saved diary section is the rule (GV15)'
        );
    }
    await assertClean(app, projectPath, 'S11');
    await closeEditors(app);

    // S19 · Quick Add: with a note open the target is that note; with none, today's diary. No Inbox.
    {
        const quickAdd = async (title) => {
            await app.cdp.evaluate('window.openPisiQuickAddModal()');
            await waitUntil('Quick Add form', () => app.cdp.evaluate(`Boolean(document.querySelector('.pisi-quick-add-form input[name="text"]'))`));
            const target = await app.cdp.evaluate(`document.querySelector('.pisi-quick-add-form select[name="target"]').value`);
            await app.cdp.evaluate(`(() => {
                const form = document.querySelector('.pisi-quick-add-form');
                form.querySelector('input[name="text"]').value = ${JSON.stringify(title)};
                form.querySelector('input[name="dateExpression"]').value = 'yarın 10:00';
                form.requestSubmit();
                return true;
            })()`);
            await waitUntil('Quick Add stored ' + title, async () => (await readJson(tasksPath(projectPath))).tasks.find((task) => task.title === title));
            return { target, task: (await readJson(tasksPath(projectPath))).tasks.find((task) => task.title === title) };
        };
        const noOpen = await quickAdd('Hızlı günlüğe');
        assert(noOpen.target === 'today' && noOpen.task.diaryDate === today, 'S19: no open note, today diary', noOpen);
        assert(noOpen.task.dueDate === addDays(today, 1) && noOpen.task.dueTime === '10:00', 'S19: the Turkish date gives the day and time', noOpen.task);
        await openNote(app, note.path);
        await app.cdp.evaluate(`document.getElementById('center-node-editor-content').focus()`);
        const withOpen = await quickAdd('Hızlı nota');
        assert(withOpen.target === 'last' && withOpen.task.noteId === note.id, 'S19: the open note is the target', withOpen);
        await waitUntil('S19: the block is in the editor', () =>
            app.cdp.evaluate(`Boolean(document.querySelector('#center-node-editor-content [data-pisi-task-id=${JSON.stringify(withOpen.task.id)}]'))`)
        );
        await saveOpenNote(app, note.path);
        assert(!(await fs.readdir(projectPath)).some((name) => /inbox/i.test(name)), 'S19: no Inbox note');
    }
    await assertClean(app, projectPath, 'S19');
    await closeEditors(app);

    // S17 · A note and a diary go to the Trash with their tasks and come back with them.
    {
        const notePlaced = (await readJson(tasksPath(projectPath))).tasks.filter((task) => task.noteId === note.id).map((task) => task.id);
        const trashedNote = await app.cdp.evaluate(`window.pisiDomain.command('project.item.delete.v1', { targetPath: ${JSON.stringify(note.path)} })`);
        assert(trashedNote?.ok, 'S17: note to Trash', trashedNote);
        const left = (await readJson(tasksPath(projectPath))).tasks;
        assert(!left.some((task) => notePlaced.includes(task.id)), 'S17: the note tasks left');
        const back = await app.cdp.evaluate(
            `window.pisiDomain.command('trash.restore.v1', { projectFolder: ${JSON.stringify(projectPath)}, trashId: ${JSON.stringify(trashedNote.trashId)} })`
        );
        assert(back?.ok, 'S17: restore', back);
        const restored = (await readJson(tasksPath(projectPath))).tasks;
        assert(
            notePlaced.every((id) => restored.some((task) => task.id === id)),
            'S17: the note tasks came back'
        );
    }
    await assertClean(app, projectPath, 'S17');
    await stop(app);
    app = null;

    // S8 · 1.000 notes and 5.000 tasks: completing a task reads and writes no note; the time is measured.
    {
        const { today: bigToday, tasks } = await writeBigProject();
        app = await launch(bigProjectPath);
        const open = await app.cdp.evaluate('window.getPisiTasks().length');
        assert(open === 5000, 'S8: the store lists 5.000 tasks', open);
        const started = Date.now();
        const { result, io } = await countNodeIo(app, () => command(app, 'task.complete.v1', { taskId: tasks[2500].id }));
        timings.completeMs = Date.now() - started;
        assert(result?.ok, 'S8 complete', result);
        assert(io.reads.length === 0 && io.writes.length === 0, 'S8: no .node read or written', { reads: io.reads.length, writes: io.writes.length });
        assert(bigToday === tasks[2500].dueDate, 'S8: completed on its day');
        // The same kind of command in the main process alone (the service, tasks.json and the event).
        timings.updateMainMs = await app.main.evaluate(
            `(async () => {
                const started = Date.now();
                const result = await executePisiDomainCommand('task.update.v1', { projectFolder: ${JSON.stringify(bigProjectPath)}, taskId: ${JSON.stringify(tasks[11].id)}, patch: { priority: 4 } });
                return result.ok ? Date.now() - started : -1;
            })()`,
            { page: false }
        );
        timings.panelRenderMs = await app.cdp.evaluate(
            '(() => { const started = performance.now(); window.renderPisiTaskPanel(); return Math.round(performance.now() - started); })()'
        );
        timings.storeEventMs = await app.cdp.evaluate(`(() => {
            const started = performance.now();
            document.dispatchEvent(new CustomEvent('pisi:task-store-updated', { detail: { changedIds: [], removedIds: [] } }));
            return Math.round(performance.now() - started);
        })()`);
        const fieldStarted = Date.now();
        const field = await countNodeIo(app, () => command(app, 'task.update.v1', { taskId: tasks[10].id, patch: { priority: 5 } }));
        timings.updateMs = Date.now() - fieldStarted;
        assert(field.io.reads.length === 0 && field.io.writes.length === 0, 'S8: a field change reads no note', field.io);
        // The generated notes have no sidecar folders (document findings); the tasks must have none.
        const auditStarted = Date.now();
        const taskIssues = (await integrityIssues(app, bigProjectPath)).filter((issue) => issue.domain === 'tasks');
        timings.integrityMs = Date.now() - auditStarted;
        assert(taskIssues.length === 0, 'S8: no task finding', taskIssues.slice(0, 5));
    }

    console.log(
        `[E2E] Task service passed: S1–S9, S11, S17, S19, S21; no .node read or written by field changes; Integrity clean after each scenario. Timings (1.000 notes, 5.000 tasks): ${JSON.stringify(timings)}`
    );
} catch (error) {
    console.error(error);
    if (logs) console.error(logs.slice(-3000));
    process.exitCode = 1;
} finally {
    await stop(app);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
