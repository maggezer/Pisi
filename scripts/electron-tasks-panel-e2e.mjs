import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPisiDiaryTaskSection } from '../shared/task-diary.mjs';
import { getPisiTodayIsoDate } from '../shared/task-model.mjs';
import { sortPisiTasks } from '../shared/task-views.mjs';
import {
    assert,
    assertIntegrityClean,
    setKnownIntegrityFindings,
    integrityIssues,
    countNodeIo,
    createPisiTasksE2E,
    diaryPath,
    readJson,
    sleep,
    storedTask,
    storedTasks,
    tasksPath
} from './e2e-tasks-app.mjs';

// The task panel, the task workspace and Quick Add (docs/task-plan.md G4, Ek B
// S1–S4 and S19 from the interface), in the real app over CDP: the panel opens
// in the priority order; a checkbox, the status select, the kanban, the detail
// window and the manual order each write tasks.json through one task command,
// a field change reads and writes no .node (GV5) and a change of a task's days
// writes only those days' diaries; a dependency loop is refused in the detail
// window; a drag in "Elle sıra" is one tasks.json write. After every scenario
// Project Integrity must report nothing (GV14). Last, a 5.000-task project
// measures the panel's first drawing and how fast a completion shows.

const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-tasks-panel-')));
const projectPath = path.join(tempRoot, 'project');
const bigProjectPath = path.join(tempRoot, 'big-project');
const pisi = createPisiTasksE2E({ tempRoot, port: 9271, inspectPort: 9272 });
const { waitUntil } = pisi;

const addDays = (day, days) => {
    const date = new Date(`${day}T12:00:00`);
    date.setDate(date.getDate() + days);
    return getPisiTodayIsoDate(date);
};

let app = null;
const timings = {};
const run = (expression) => app.cdp.evaluate(expression);
const json = (value) => JSON.stringify(value);
const card = (taskId) => `document.querySelector('#pisi-missions-list [data-pisi-task-card=${json(taskId)}]')`;

async function command(name, payload) {
    const result = await run(`window.runPisiTaskCommand(${json(name)}, ${json(payload)})`);
    assert(result?.ok, name, result);
    return result;
}

async function createNote() {
    const before = new Set(await fs.readdir(projectPath));
    assert(await run("(() => { const b = document.getElementById('add-node-btn'); b?.click(); return Boolean(b); })()"), 'Add Node button');
    const notePath = await waitUntil('new note file', async () => {
        const created = (await fs.readdir(projectPath)).find((name) => name.endsWith('.node') && !before.has(name));
        return created ? path.join(projectPath, created) : null;
    });
    await waitUntil('tree item', () => run(`Array.from(document.querySelectorAll('.tree-node[data-path]')).some((n) => n.dataset.path === ${json(notePath)})`));
    return { path: notePath, id: (await readJson(notePath)).pisi.id };
}

async function openNote(notePath) {
    await run(
        `(() => { const node = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((n) => n.dataset.path === ${json(
            notePath
        )}); node?.querySelector(':scope > .tree-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })); })()`
    );
    await waitUntil('editor for ' + notePath, () =>
        run(`window.activeCenterNode?.path === ${json(notePath)} && document.getElementById('center-node-editor')?.hidden === false`)
    );
}

async function closeEditors() {
    await run(`(async () => {
        await window.flushPisiPendingSaves?.();
        await window.removePisiOpenTabsForDeletedPaths?.((window.Pisi?.state?.openTabs || []).map((tab) => tab.path));
        return true;
    })()`);
    await waitUntil('no open note', () => run('!window.activeCenterNode && !window.activeModalNode'));
}

async function openPanel() {
    await run(`document.querySelector('.right-panel-tab[data-right-tab="missions"]')?.click()`);
    await waitUntil('task panel', () => run(`Boolean(document.querySelector('#pisi-todo-panel-actions-host [data-pisi-task-toolbar="side"]'))`));
}

async function setSideFilter(name, value) {
    await run(`(() => {
        const select = document.querySelector('[data-pisi-task-toolbar="side"] [data-pisi-task-filter=${json(name)}]');
        select.value = ${json(value)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    })()`);
}

async function setShowCompleted(on) {
    await run(`(() => {
        const button = document.querySelector('[data-pisi-task-toolbar="side"] [data-pisi-task-toggle-completed]');
        if ((button.getAttribute('aria-pressed') === 'true') !== ${json(on)}) button.click();
        return true;
    })()`);
}

const sideCardIds = () =>
    run(`Array.from(document.querySelectorAll('#pisi-missions-list [data-pisi-task-card]')).map((element) => element.dataset.pisiTaskCard)`);

async function waitStored(label, taskId, probe) {
    return waitUntil(label, async () => {
        const task = await storedTask(projectPath, taskId);
        return task && probe(task) ? task : null;
    });
}

async function diaryIds(day) {
    try {
        return readPisiDiaryTaskSection((await readJson(diaryPath(projectPath, day))).content).taskIds;
    } catch {
        return null;
    }
}

/** Runs a drag of `source` onto `target` (both page expressions) with a real DataTransfer. */
async function drag(source, target, { before = true } = {}) {
    await run(`(() => {
        const source = ${source};
        const target = ${target};
        const data = new DataTransfer();
        const rect = target.getBoundingClientRect();
        const clientY = ${json(before)} ? rect.top + 2 : rect.bottom - 2;
        const fire = (element, type) => element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.left + 4, clientY }));
        fire(source, 'dragstart');
        fire(target, 'dragover');
        fire(target, 'drop');
        fire(source, 'dragend');
        return true;
    })()`);
}

try {
    // A version 1 record without a place, as the mobile app wrote it before G8 (S4).
    const today = getPisiTodayIsoDate(new Date());
    const phoneTaskId = 'task_0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
    await fs.mkdir(path.join(projectPath, '.pisi'), { recursive: true });
    await fs.writeFile(
        tasksPath(projectPath),
        JSON.stringify(
            {
                version: 1,
                updatedAt: new Date().toISOString(),
                tasks: [
                    {
                        id: phoneTaskId,
                        title: 'Telefondan görev',
                        status: 'todo',
                        priority: 2,
                        todoTag: 'todo.2.none',
                        scheduledAt: null,
                        dueDate: null,
                        repeat: 'none',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    }
                ]
            },
            null,
            2
        ) + '\n'
    );
    app = await pisi.launch(projectPath);
    // Since G8 an old record without a place is a finding (task-place-missing, §3.1); it was there before the scenario, so it is not new (GV14).
    setKnownIntegrityFindings([{ code: 'task-place-missing', entityId: phoneTaskId }]);
    {
        const issues = await integrityIssues(app);
        assert(
            issues.some(
                (issue) => issue.code === 'task-place-missing' && issue.entityId === phoneTaskId && issue.repair?.action === 'task-place-in-today-diary'
            ),
            'the old record without a place is reported with its repair',
            issues
        );
    }
    assert((await run('window.getPisiTaskToday()')) === today, 'today');
    await run(`window.__pisiPanelErrors = [];
        window.addEventListener('error', (event) => window.__pisiPanelErrors.push(String(event.message)));
        window.addEventListener('unhandledrejection', (event) => window.__pisiPanelErrors.push(String(event.reason?.stack || event.reason)));
        true`);
    const note = await createNote();
    await closeEditors();

    // The priority order on open: overdue first, then days left divided by priority (shared/task-views.mjs).
    const noteTask = (
        await command('task.create.v1', { task: { title: 'Nottaki görev', dueDate: today, priority: 3 }, target: { noteId: note.id, notePath: note.path } })
    ).task;
    const diaryTask = (await command('task.create.v1', { task: { title: 'Günlükteki görev', priority: 4 }, target: { diaryDate: today } })).task;
    const lateTask = (await command('task.create.v1', { task: { title: 'Geciken', dueDate: addDays(today, -2), priority: 1 }, target: { diaryDate: today } }))
        .task;
    const soonTask = (await command('task.create.v1', { task: { title: 'Yakında', dueDate: addDays(today, 2), priority: 5 }, target: { diaryDate: today } }))
        .task;
    const laterTask = (await command('task.create.v1', { task: { title: 'Sonra', dueDate: addDays(today, 20), priority: 2 }, target: { diaryDate: today } }))
        .task;
    await openPanel();
    {
        const expected = sortPisiTasks(
            (await storedTasks(projectPath)).filter((task) => task.status !== 'done'),
            { mode: 'workorder', today }
        ).map((task) => task.id);
        await waitUntil('the panel lists every open task', async () => (await sideCardIds()).length === expected.length);
        const shown = await sideCardIds();
        assert(json(shown) === json(expected), 'the panel opens in the priority order', { shown, expected });
        assert(shown[0] === lateTask.id, 'overdue first', shown);
        const label = await run(`${card(noteTask.id)}.querySelector('.pisi-task-card-check').getAttribute('aria-label')`);
        assert(/Nottaki görev/.test(label), 'the checkbox is named after the task', label);
        const place = await run(`${card(phoneTaskId)}?.querySelector('.pisi-task-card-place')?.textContent`);
        assert(place === 'Yeri yok', 'S4: a task without a place shows so', place);
    }
    await assertIntegrityClean(app, 'priority order');

    // S1 · A note task and a diary task are completed from the panel: done in tasks.json, no .node read or written.
    for (const task of [noteTask, diaryTask]) {
        const { io } = await countNodeIo(app, async () => {
            await run(`${card(task.id)}.querySelector('.pisi-task-card-check').click()`);
            await waitStored('S1: done ' + task.title, task.id, (stored) => stored.status === 'done');
            await waitUntil('S1: the card leaves the open list', () => run(`!${card(task.id)}`));
        });
        assert(io.reads.length === 0 && io.writes.length === 0, 'S1: completing on its day touches no .node', io);
        assert(io.taskStoreWrites.length === 1, 'S1: one tasks.json write', io);
    }
    await setShowCompleted(true);
    await waitUntil('S1: shown ticked with completed tasks', () => run(`${card(noteTask.id)}?.querySelector('.pisi-task-card-check')?.checked === true`));
    await setShowCompleted(false);
    await assertIntegrityClean(app, 'S1');

    // S2 · A repeating task is completed from the panel: it moves on, completions + 1; today ☑, tomorrow ☐ (§3.2.3).
    const repeating = (
        await command('task.create.v1', { task: { title: 'Spor', dueDate: today, repeat: 'daily' }, target: { noteId: note.id, notePath: note.path } })
    ).task;
    await waitUntil('S2 card', () => run(`Boolean(${card(repeating.id)})`));
    {
        const { io } = await countNodeIo(app, async () => {
            await run(`${card(repeating.id)}.querySelector('.pisi-task-card-check').click()`);
            await waitStored('S2: moved on', repeating.id, (stored) => stored.dueDate === addDays(today, 1));
        });
        const stored = await storedTask(projectPath, repeating.id);
        assert(stored.status === 'todo' && stored.completions.length === 1 && stored.completions[0].date === today, 'S2: one completion, still open', stored);
        const allowed = new Set([diaryPath(projectPath, today), diaryPath(projectPath, addDays(today, 1))]);
        assert(
            io.writes.every((written) => allowed.has(written)),
            'S2: only the two days’ diaries are written',
            io.writes
        );
        assert(!io.writes.includes(note.path), 'S2: the note is not written');
        assert(
            (await diaryIds(today))?.includes(repeating.id) && (await diaryIds(addDays(today, 1)))?.includes(repeating.id),
            'S2: today and tomorrow list it'
        );
        await waitUntil('S2: the card shows tomorrow, unticked', () =>
            run(
                `(() => { const c = ${card(repeating.id)}; return c && !c.querySelector('.pisi-task-card-check').checked && c.querySelector('.pisi-task-card-day').textContent.startsWith(${json(addDays(today, 1).split('-').reverse().join('.'))}); })()`
            )
        );
    }
    await assertIntegrityClean(app, 'S2');

    // S3 · The status select changes tasks.json at once; no file but tasks.json is written.
    {
        const { io } = await countNodeIo(app, async () => {
            await run(
                `(() => { const select = ${card(soonTask.id)}.querySelector('.pisi-task-card-status'); select.value = 'doing'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`
            );
            await waitStored('S3: doing', soonTask.id, (stored) => stored.status === 'doing');
        });
        assert(io.reads.length === 0 && io.writes.length === 0 && io.taskStoreWrites.length === 1, 'S3: one tasks.json write and no .node', io);
        await waitUntil('S3: the card shows it', () => run(`${card(soonTask.id)}?.querySelector('.pisi-task-card-status')?.value === 'doing'`));
    }
    await assertIntegrityClean(app, 'S3');

    // S4 · The mobile task (version 1, no place) is completed, reopened and edited from the desktop; no place is made up for it.
    {
        await run(`${card(phoneTaskId)}.querySelector('.pisi-task-card-check').click()`);
        await waitStored('S4: done', phoneTaskId, (stored) => stored.status === 'done');
        await setShowCompleted(true);
        await waitUntil('S4: its card is ticked', () => run(`${card(phoneTaskId)}?.querySelector('.pisi-task-card-check')?.checked === true`));
        await run(`${card(phoneTaskId)}.querySelector('.pisi-task-card-check').click()`);
        await waitStored('S4: open again', phoneTaskId, (stored) => stored.status === 'todo');
        await setShowCompleted(false);
        await waitUntil('S4: card', () => run(`Boolean(${card(phoneTaskId)})`));
        await run(`${card(phoneTaskId)}.querySelector('.pisi-task-card-title').click()`);
        await waitUntil('S4: detail window', () => run(`Boolean(document.querySelector('[data-pisi-task-detail=${json(phoneTaskId)}] form'))`));
        const { io } = await countNodeIo(app, async () => {
            await run(`(() => {
                const form = document.querySelector('.pisi-task-detail-form');
                form.querySelector('[name="title"]').value = 'Telefondan görev (masaüstü)';
                form.querySelector('[name="priority"]').value = '5';
                form.requestSubmit();
                return true;
            })()`);
            await waitStored('S4: edited', phoneTaskId, (stored) => stored.title === 'Telefondan görev (masaüstü)' && stored.priority === 5);
        });
        assert(io.reads.length === 0 && io.writes.length === 0 && io.taskStoreWrites.length === 1, 'S4: the detail save is one task.update, no .node', io);
        const stored = await storedTask(projectPath, phoneTaskId);
        assert(!stored.noteId && !stored.diaryDate && stored.source === undefined, 'S4: no place or source made up', stored);
        assert(stored.todoTag === 'todo.2.none', 'S4: the old field is kept (GV12)', stored);
        await waitUntil('S4: the window closed', () => run(`!document.querySelector('.pisi-task-detail-dialog')`));
    }
    await assertIntegrityClean(app, 'S4');

    // The detail window refuses a dependency loop; the task service refuses it too.
    {
        await command('task.update.v1', { taskId: laterTask.id, patch: { dependencies: [soonTask.id] } });
        await run(`window.openPisiTaskDetail(${json(soonTask.id)})`);
        await waitUntil('detail of the dependency', () => run(`Boolean(document.querySelector('[data-pisi-task-detail=${json(soonTask.id)}] form'))`));
        await run(
            `(() => { const select = document.querySelector('.pisi-task-detail-form [name="dependency"]'); select.value = ${json(laterTask.id)}; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`
        );
        const message = await run(`document.querySelector('.pisi-task-detail-status').textContent`);
        assert(/döngü/.test(message), 'the detail window names the loop', message);
        assert(
            !(await run(`Boolean(document.querySelector('.pisi-task-detail-form [data-pisi-task-dependency=${json(laterTask.id)}]'))`)),
            'the loop is not added'
        );
        const { io } = await countNodeIo(app, async () => {
            await run(`document.querySelector('.pisi-task-detail-form').requestSubmit()`);
            await waitUntil('closed', () => run(`!document.querySelector('.pisi-task-detail-dialog')`));
        });
        assert(io.taskStoreWrites.length === 0, 'nothing changed, nothing written', io);
        assert((await storedTask(projectPath, soonTask.id)).dependencies.length === 0, 'no dependency stored');
        const refused = await run(
            `window.runPisiTaskCommand('task.update.v1', { taskId: ${json(soonTask.id)}, patch: { dependencies: [${json(laterTask.id)}] } }, { quiet: true })`
        );
        assert(refused?.ok === false && refused.code === 'TASK_DEPENDENCY_CYCLE', 'the service refuses the loop', refused);
        await waitUntil('the blocked badge', () => run(`Boolean(${card(laterTask.id)}?.querySelector('.pisi-task-card-blocked'))`));
    }
    await assertIntegrityClean(app, 'dependency loop');

    // The detail window: a completed day is removed; the place moves to a diary (task.move.v1, the closed note loses the block).
    {
        await run(`window.openPisiTaskDetail(${json(repeating.id)})`);
        await waitUntil('detail of the repeating task', () =>
            run(`document.querySelectorAll('.pisi-task-detail-form [data-pisi-task-completion]').length === 1`)
        );
        await run(`(() => {
            const form = document.querySelector('.pisi-task-detail-form');
            form.querySelector('.pisi-task-detail-completion-remove').click();
            form.querySelector('[name="place"]').value = ${json(`diary:${today}`)};
            form.requestSubmit();
            return true;
        })()`);
        const stored = await waitStored('completion removed and moved', repeating.id, (task) => task.completions.length === 0 && task.diaryDate === today);
        assert(!stored.noteId, 'moved to the diary', stored);
        await waitUntil('the block left the closed note', async () => !(await readJson(note.path)).content.includes(repeating.id));
    }
    await assertIntegrityClean(app, 'detail');

    // Kanban: a drop on another column and Alt+→ change the status; nothing but tasks.json is written.
    {
        await run(`document.querySelector('[data-pisi-task-workspace-open]').click()`);
        await waitUntil('the workspace', () =>
            run(`document.getElementById('pisi-task-workspace')?.hidden === false && Boolean(document.querySelector('.pisi-task-workspace-tab.active'))`)
        );
        await run(`document.querySelector('[data-pisi-task-view-button="kanban"]').click()`);
        const kanbanCard = (taskId) => `document.querySelector('.pisi-task-kanban [data-pisi-task-view-task=${json(taskId)}]')`;
        await waitUntil('kanban', () => run(`Boolean(${kanbanCard(laterTask.id)})`));
        const { io } = await countNodeIo(app, async () => {
            await drag(kanbanCard(laterTask.id), `document.querySelector('[data-pisi-task-column="waiting"]')`);
            await waitStored('kanban: waiting', laterTask.id, (task) => task.status === 'waiting');
        });
        assert(io.reads.length === 0 && io.writes.length === 0 && io.taskStoreWrites.length === 1, 'kanban: one tasks.json write', io);
        await waitUntil('kanban: the card moved', () =>
            run(`Boolean(document.querySelector('[data-pisi-task-column="waiting"] [data-pisi-task-view-task=${json(laterTask.id)}]'))`)
        );
        await run(
            `(() => { const c = ${kanbanCard(laterTask.id)}; c.focus(); c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true })); return true; })()`
        );
        await waitStored('kanban: Alt+→ blocked', laterTask.id, (task) => task.status === 'blocked');
        for (const view of ['calendar', 'timeline', 'stats', 'list']) {
            await run(`document.querySelector('[data-pisi-task-view-button=${json(view)}]').click()`);
            await waitUntil('view ' + view, () =>
                run(`document.querySelector('[data-pisi-task-view-button=${json(view)}]').getAttribute('aria-pressed') === 'true'`)
            );
        }
        assert(await run(`Boolean(document.querySelector('.pisi-task-workspace-content [data-pisi-task-card]'))`), 'the workspace list');
        await openNote(note.path);
        await waitUntil('opening a note closes the workspace', () =>
            run(`document.getElementById('pisi-task-workspace').hidden === true && !document.querySelector('.pisi-task-workspace-tab')`)
        );
        await closeEditors();
    }
    await assertIntegrityClean(app, 'kanban');

    // Manual order: a drag and Alt+↑ are each one task.batch.v1, one tasks.json write; no .node.
    {
        await setSideFilter('sort', 'manual');
        await waitUntil('handles', () => run(`document.querySelectorAll('#pisi-missions-list .pisi-task-card-handle').length >= 3`));
        const before = await sideCardIds();
        const moved = before[before.length - 1];
        const { io } = await countNodeIo(app, async () => {
            await drag(`${card(moved)}.querySelector('.pisi-task-card-handle')`, card(before[0]), { before: true });
            await waitUntil('manual: the card is first', async () => (await sideCardIds())[0] === moved);
        });
        assert(io.reads.length === 0 && io.writes.length === 0 && io.taskStoreWrites.length === 1, 'manual: one tasks.json write for a drag', io);
        const after = await sideCardIds();
        assert(json(after) === json([moved, ...before.filter((id) => id !== moved)]), 'manual: the order', { before, after });
        const second = after[1];
        const keyboard = await countNodeIo(app, async () => {
            await run(
                `(() => { const h = ${card(second)}.querySelector('.pisi-task-card-handle'); h.focus(); h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true })); return true; })()`
            );
            await waitUntil('manual: Alt+↑', async () => (await sideCardIds())[0] === second);
        });
        assert(keyboard.io.taskStoreWrites.length === 1 && keyboard.io.writes.length === 0, 'manual: one write for Alt+↑', keyboard.io);
        await setSideFilter('sort', 'workorder');
    }
    await assertIntegrityClean(app, 'manual order');

    // S19 · Quick Add from the panel: no open note, today's diary; the note the user worked in, that note. The form
    // fills the repeat from the date expression and keeps the reminder. No Inbox.
    {
        const quickAdd = async (fill) => {
            await run(`document.querySelector('[data-pisi-task-toolbar="side"] [data-pisi-task-add]').click()`);
            await waitUntil('Quick Add form', () => run(`Boolean(document.querySelector('.pisi-quick-add-form input[name="text"]'))`));
            return run(`(() => {
                const form = document.querySelector('.pisi-quick-add-form');
                const values = ${json(fill)};
                form.querySelector('[name="text"]').value = values.title;
                const date = form.querySelector('[name="dateExpression"]');
                date.value = values.date || '';
                date.dispatchEvent(new Event('input', { bubbles: true }));
                const seen = { target: form.querySelector('[name="target"]').value, repeat: form.querySelector('[name="repeat"]').value, preview: form.querySelector('.pisi-date-parse-preview').textContent };
                if (values.reminder) form.querySelector('[name="reminderMode"]').value = values.reminder;
                form.requestSubmit();
                return seen;
            })()`);
        };
        const findByTitle = (title) =>
            waitUntil('Quick Add stored ' + title, async () => (await storedTasks(projectPath)).find((task) => task.title === title));
        const seen = await quickAdd({ title: 'Her cuma rapor', date: 'her cuma 9:00', reminder: 'day-before' });
        assert(seen.target === 'today' && seen.repeat === 'weekly', 'S19: today’s diary; the repeat comes from the expression', seen);
        const weekly = await findByTitle('Her cuma rapor');
        assert(
            weekly.diaryDate === today && weekly.repeat === 'weekly' && weekly.dueTime === '09:00' && weekly.reminderMode === 'day-before',
            'S19: the task',
            weekly
        );
        assert(new Date(`${weekly.dueDate}T12:00:00`).getDay() === 5, 'S19: a Friday', weekly.dueDate);
        await waitUntil('S19: the form closed', () => run(`document.getElementById('pisi-quick-add-overlay').hidden === true`));

        const numbered = await quickAdd({ title: 'Sayfa notu', date: '3-4 sayfa' });
        assert(/algılanmadı/.test(numbered.preview), 'S19: numbers are not a date (§5e)', numbered);
        assert((await findByTitle('Sayfa notu')).dueDate === null, 'S19: no day');
        await waitUntil('S19: the form closed', () => run(`document.getElementById('pisi-quick-add-overlay').hidden === true`));

        await openNote(note.path);
        await run(`document.getElementById('center-node-editor-content').focus()`);
        const toNote = await quickAdd({ title: 'Hızlı nota' });
        assert(toNote.target === 'last', 'S19: the open note is the target', toNote);
        const placed = await findByTitle('Hızlı nota');
        assert(placed.noteId === note.id, 'S19: the task lives in the note', placed);
        await waitUntil('S19: the block is in the editor', () =>
            run(`Boolean(document.querySelector('#center-node-editor-content [data-pisi-task-id=${json(placed.id)}]'))`)
        );
        await run('window.flushPisiPendingSaves?.()');
        assert((await readJson(note.path)).content.includes(placed.id), 'S19: the block is saved in the note');
        assert(!(await fs.readdir(projectPath)).some((name) => /inbox/i.test(name)), 'S19: no Inbox note');
        await closeEditors();
    }
    await assertIntegrityClean(app, 'S19');

    // A task title that is also an interface text stays the user's text in English (G7: the page
    // translator skips task titles and note names in the panel and the views).
    {
        const today = await run('window.getPisiTaskToday()');
        await run(`window.runPisiTaskCommand('task.create.v1', { task: { title: 'Görev ekle' }, target: { diaryDate: ${json(today)} } })`);
        await run(`window.pisiI18n.setLanguage('eng')`);
        await waitUntil('english interface', () => run(`document.documentElement.lang === 'en'`));
        await waitUntil('the card keeps the title', () =>
            run(`Array.from(document.querySelectorAll('#pisi-missions-list .pisi-task-card-title')).some((item) => item.textContent === 'Görev ekle')`)
        );
        assert(
            !(await run(`Array.from(document.querySelectorAll('#pisi-missions-list .pisi-task-card-title')).some((item) => item.textContent === 'Add task')`)),
            'the title is not translated'
        );
        await run(`window.pisiI18n.setLanguage('tr')`);
        await waitUntil('turkish interface', () => run(`document.documentElement.lang === 'tr'`));
    }
    const errors = await run('window.__pisiPanelErrors');
    assert(Array.isArray(errors) && errors.length === 0, 'no page errors', errors);
    await pisi.stop();
    app = null;

    // 5.000 tasks: the panel's first drawing and a completion shown (targets: ≤ 300 ms and ≤ 150 ms).
    {
        await fs.mkdir(path.join(bigProjectPath, '.pisi'), { recursive: true });
        const now = new Date().toISOString();
        const tasks = Array.from({ length: 5000 }, (_, index) => ({
            id: `task_${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
            title: `Görev ${index}`,
            status: 'todo',
            priority: (index % 5) + 1,
            dueDate: addDays(today, (index % 60) - 20),
            dueTime: null,
            repeat: 'none',
            completionOffsetDays: null,
            reminderMode: 'none',
            reminderAt: null,
            dependencies: [],
            manualOrder: index,
            noteId: null,
            diaryDate: addDays(today, (index % 60) - 20),
            durationMinutes: 0,
            actualMinutes: 0,
            completions: [],
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            completedOn: null
        }));
        await fs.writeFile(tasksPath(bigProjectPath), JSON.stringify({ version: 2, updatedAt: now, tasks }, null, 2) + '\n');
        app = await pisi.launch(bigProjectPath);
        assert((await run('window.getPisiTasks().length')) === 5000, 'big: 5.000 tasks');
        await run(`document.querySelector('.right-panel-tab[data-right-tab="missions"]')?.click()`);
        await waitUntil('big: panel', () => run(`document.querySelectorAll('#pisi-missions-list [data-pisi-task-card]').length === 200`));
        await sleep(300);
        const firstDraw = [];
        for (let round = 0; round < 3; round += 1) {
            firstDraw.push(
                await run(`(() => {
                    const surface = window.getPisiTaskPanelSurface('side');
                    surface.mode = null;
                    const started = performance.now();
                    window.renderPisiTaskSurface(surface, { full: true });
                    return Math.round(performance.now() - started);
                })()`)
            );
        }
        timings.panelFirstDrawMs = Math.max(...firstDraw);
        const shown = await run(`(() => new Promise((resolve) => {
            const list = document.getElementById('pisi-missions-list');
            const first = list.querySelector('[data-pisi-task-card]');
            const id = first.dataset.pisiTaskCard;
            let changed = 0;
            document.addEventListener('pisi:task-store-updated', () => (changed = performance.now()), { once: true });
            const started = performance.now();
            // The card is gone from the open list: measured at the next frame, after the whole redraw.
            const observer = new MutationObserver(() => {
                if (list.querySelector('[data-pisi-task-card=' + JSON.stringify(id) + ']')) return;
                observer.disconnect();
                requestAnimationFrame(() => {
                    const end = performance.now();
                    resolve({ totalMs: Math.round(end - started), eventToScreenMs: Math.round(end - changed), renderMs: Math.round(window.pisiTaskPanelState.lastRenderMs) });
                });
            });
            observer.observe(list, { childList: true, subtree: true });
            first.querySelector('.pisi-task-card-check').click();
        }))()`);
        timings.completeTotalMs = shown.totalMs;
        timings.completeEventToScreenMs = shown.eventToScreenMs;
        timings.completeRenderMs = shown.renderMs;
        console.log('[tasks-panel-e2e] timings', JSON.stringify(timings));
        assert(timings.panelFirstDrawMs <= 300, 'big: first drawing ≤ 300 ms', timings);
        assert(timings.completeEventToScreenMs <= 150 && timings.completeRenderMs <= 150, 'big: a completion is on screen ≤ 150 ms after its event', timings);
    }
    console.log('[tasks-panel-e2e] passed');
} catch (error) {
    console.error('[tasks-panel-e2e] failed:', error?.stack || error);
    console.error(pisi.logs().slice(-4000));
    process.exitCode = 1;
} finally {
    await pisi.stop();
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}
