import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getPisiTaskCalendarSummary, listPisiDiaryTaskIds, readPisiDiaryTaskSection } from '../shared/task-diary.mjs';
import { listPisiNoteTaskIds } from '../shared/task-blocks.mjs';
import { getPisiTodayIsoDate, readPisiTask } from '../shared/task-model.mjs';
import { assert, assertIntegrityClean, countNodeIo, createPisiTasksE2E, diaryPath, readJson, storedTask, storedTasks, tasksPath } from './e2e-tasks-app.mjs';

// The other surfaces that show tasks (docs/task-plan.md G5, Ek B S10 and S16),
// in the real app over CDP:
// - the calendar marks the days of the diary task sections (§3.2.2) and
//   updates them in place on a task change;
// - the map's badges count a note's tasks by `noteId`; a note copied on the
//   map copies its tasks with new ids (S16, GK9);
// - search finds every task of tasks.json, the phone's (version 1, no place)
//   too, and opens its place or its detail window (S10, GB11);
// - a tag result opens exactly its block, nothing guessed (GK3);
// - the Markdown export writes the task rows and the import makes `- [ ]`
//   lines tasks again;
// - a note's history restore brings back the tasks of the restored blocks.
// Reading and drawing write no file (GV3); after every scenario Project
// Integrity reports nothing (GV14).

const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-tasks-surfaces-')));
const projectPath = path.join(tempRoot, 'project');
const exportPath = path.join(tempRoot, 'export');
const importPath = path.join(tempRoot, 'import');
process.env.PISI_TEST_EXPORT_DIR = exportPath;
process.env.PISI_TEST_IMPORT_DIR = importPath;
const pisi = createPisiTasksE2E({ tempRoot, port: 9281, inspectPort: 9282 });
const { waitUntil } = pisi;

const addDays = (day, days) => {
    const date = new Date(`${day}T12:00:00`);
    date.setDate(date.getDate() + days);
    return getPisiTodayIsoDate(date);
};

let app = null;
const run = (expression) => app.cdp.evaluate(expression);
const json = (value) => JSON.stringify(value);

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

async function openMap(mapPath) {
    await waitUntil('tree item ' + mapPath, () =>
        run(`Array.from(document.querySelectorAll('.tree-node[data-path]')).some((n) => n.dataset.path === ${json(mapPath)})`)
    );
    await run(
        `(() => { const node = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((n) => n.dataset.path === ${json(
            mapPath
        )}); node?.querySelector(':scope > .tree-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })); })()`
    );
    await waitUntil('map open', () => run(`window.activeMapPath === ${json(mapPath)} && document.getElementById('map-canvas')?.hidden === false`));
}

async function closeEditors() {
    await run(`(async () => {
        await window.flushPisiPendingSaves?.();
        await window.removePisiOpenTabsForDeletedPaths?.((window.Pisi?.state?.openTabs || []).map((tab) => tab.path));
        return true;
    })()`);
    await waitUntil('no open note', () => run('!window.activeCenterNode && !window.activeModalNode'));
}

async function diaryIds(day) {
    try {
        return readPisiDiaryTaskSection((await readJson(diaryPath(projectPath, day))).content).taskIds;
    } catch {
        return null;
    }
}

async function waitStoreEvent(probe, label) {
    return waitUntil(label, () => run(`(() => { const tasks = window.getPisiTasks(); return (${probe})(tasks); })()`));
}

const noWrites = (io, label) => assert(io.writes.length === 0 && io.taskStoreWrites.length === 0, label + ' writes no file (GV3)', io);

try {
    // A version 1 record without a place, as the phone writes it before G8 (S10).
    const phoneTaskId = 'task_6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
    const now = new Date().toISOString();
    await fs.mkdir(path.join(projectPath, '.pisi'), { recursive: true });
    await fs.writeFile(
        tasksPath(projectPath),
        JSON.stringify(
            {
                version: 1,
                updatedAt: now,
                tasks: [
                    {
                        id: phoneTaskId,
                        title: 'Telefonda yazılan iş',
                        status: 'todo',
                        priority: 4,
                        todoTag: 'todo.4.none',
                        scheduledAt: null,
                        dueDate: null,
                        repeat: 'none',
                        createdAt: now,
                        updatedAt: now
                    }
                ]
            },
            null,
            2
        ) + '\n'
    );
    app = await pisi.launch(projectPath);
    const today = await run('window.getPisiTaskToday()');
    await run(`window.__pisiSurfaceErrors = [];
        window.addEventListener('error', (event) => window.__pisiSurfaceErrors.push(String(event.message)));
        window.addEventListener('unhandledrejection', (event) => window.__pisiSurfaceErrors.push(String(event.reason?.stack || event.reason)));
        true`);

    // ---- 1. Calendar: the marks are the days of the diary task sections (§3.2.2).
    const note = await createNote();
    await closeEditors();
    const noteTask = (
        await command('task.create.v1', { task: { title: 'Nottaki iş', dueDate: addDays(today, 3) }, target: { noteId: note.id, notePath: note.path } })
    ).task;
    // Lives in today's diary, dated another day: it is on both days.
    const livingTask = (await command('task.create.v1', { task: { title: 'Günlükte yaşayan', dueDate: addDays(today, 5) }, target: { diaryDate: today } }))
        .task;
    // Due two days ago and completed today: done on both days.
    const lateTask = (
        await command('task.create.v1', { task: { title: 'Geç biten', dueDate: addDays(today, -2) }, target: { noteId: note.id, notePath: note.path } })
    ).task;
    await command('task.complete.v1', { taskId: lateTask.id });
    // Repeats daily: done today, open tomorrow (§3.2.3).
    const dailyTask = (
        await command('task.create.v1', { task: { title: 'Her gün', dueDate: today, repeat: 'daily' }, target: { noteId: note.id, notePath: note.path } })
    ).task;
    await command('task.complete.v1', { taskId: dailyTask.id });
    await waitStoreEvent(`(tasks) => tasks.find((task) => task.id === ${json(dailyTask.id)})?.dueDate === ${json(addDays(today, 1))}`, 'repeat advanced');

    const calendarMarks = () =>
        run(`Array.from(document.querySelectorAll('#pisi-calendar .pisi-calendar-day[data-date]')).map((button) => ({
            date: button.dataset.date,
            open: button.classList.contains('has-uncompleted-tasks'),
            done: button.classList.contains('has-completed-tasks'),
            diaryOnly: button.classList.contains('has-diary-note-only')
        }))`);
    const expectCalendar = async (label) => {
        const tasks = (await storedTasks(projectPath)).map(readPisiTask).filter(Boolean);
        const summary = getPisiTaskCalendarSummary(tasks);
        await waitUntil(label, async () => {
            const marks = await calendarMarks();
            if (!marks.length) return false;
            for (const mark of marks) {
                const entry = summary.get(mark.date);
                if (Boolean(entry && entry.open > 0) !== mark.open || Boolean(entry && entry.total > 0 && entry.open === 0) !== mark.done) return false;
            }
            return marks;
        });
        // Every marked day is a day whose diary section lists those tasks: the same rule (GV15).
        for (const mark of await calendarMarks()) {
            if (!mark.open && !mark.done) continue;
            const ids = listPisiDiaryTaskIds(mark.date, tasks);
            assert(ids.length > 0, 'a marked day has tasks in its section', mark);
            assert(json(await diaryIds(mark.date)) === json(ids), 'the diary file of a marked day has that section', {
                mark,
                ids,
                file: await diaryIds(mark.date)
            });
        }
    };
    {
        const { io } = await countNodeIo(app, () => run('(window.refreshPisiCalendar(), true)'));
        noWrites(io, 'drawing the calendar');
        await expectCalendar('calendar marks follow the diary sections');
        const marks = Object.fromEntries((await calendarMarks()).map((mark) => [mark.date, mark]));
        if (marks[today]) assert(marks[today].open, 'today: the living task is open', marks[today]);
        if (marks[addDays(today, -2)]) assert(marks[addDays(today, -2)].done, 'the late task is done on its due day', marks[addDays(today, -2)]);
        if (marks[addDays(today, 1)]) assert(marks[addDays(today, 1)].open, 'tomorrow: the next repeat is open', marks[addDays(today, 1)]);
        // A task change updates the marks in place: the day buttons stay the same elements (§3.5).
        await run(`(document.querySelector('#pisi-calendar .pisi-calendar-day[data-date]').dataset.e2eKeep = '1', true)`);
        await command('task.complete.v1', { taskId: noteTask.id });
        await expectCalendar('calendar marks after a completion');
        assert(await run(`document.querySelector('#pisi-calendar .pisi-calendar-day[data-date]').dataset.e2eKeep === '1'`), 'the day grid is not rebuilt');
        await command('task.reopen.v1', { taskId: noteTask.id });
        await expectCalendar('calendar marks after a reopen');
    }
    await assertIntegrityClean(app, 'calendar');

    // ---- 2. Search (S10, GB11): every task of tasks.json, by its place.
    const searchRecord = async (taskId) =>
        run(`(async () => {
            const index = await window.ensurePisiEnhancedSearchIndex();
            const record = index.records.find((item) => item.id === ${json('task:' + taskId)});
            return record ? { title: record.title, nodeTitle: record.nodeTitle, nodePath: record.nodePath, place: record.place, opensDetail: record.opensDetail } : null;
        })()`);
    {
        const { result: phone, io } = await countNodeIo(app, () => searchRecord(phoneTaskId));
        assert(io.writes.length === 0, 'building the search index writes no file (GV3)', io);
        assert(phone?.title === 'Telefonda yazılan iş' && phone.place === 'none' && phone.opensDetail === true, 'the phone task is found', phone);
        const living = await searchRecord(livingTask.id);
        assert(living?.place === 'diary', 'a diary task is found with its day', living);
        // A note made after the index was built (pisi-error.md §5h): its task is found with the note's title.
        const lateNote = await createNote();
        await closeEditors();
        const lateNoteTask = (await command('task.create.v1', { task: { title: 'Yeni notun işi' }, target: { noteId: lateNote.id, notePath: lateNote.path } }))
            .task;
        const found = await waitUntil('task of the new note in search', () => searchRecord(lateNoteTask.id));
        assert(found.nodePath === lateNote.path && found.opensDetail === false, 'the new note is found by id', found);

        // From the search dialog: Enter on the phone task opens its detail window.
        await run('(window.openPisiGlobalSearch(), true)');
        await waitUntil('search dialog', () =>
            run(`Boolean(document.querySelector('.pisi-global-search-input, #pisi-global-search-input, .pisi-global-search-dialog input'))`)
        );
        await run(`(() => {
            const input = document.querySelector('.pisi-global-search-dialog input[type="search"]');
            input.value = 'Telefonda yazılan';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        })()`);
        await waitUntil('search result', () =>
            run(`Array.from(document.querySelectorAll('.pisi-global-search-result')).some((row) => row.textContent.includes('Telefonda yazılan iş'))`)
        );
        await run(`(() => {
            const rows = Array.from(document.querySelectorAll('.pisi-global-search-result'));
            const row = rows.find((item) => item.textContent.includes('Telefonda yazılan iş'));
            row.click();
            return true;
        })()`);
        await waitUntil('task detail opened from search', () =>
            run(`window.pisiTaskDetailState?.taskId === ${json(phoneTaskId)} && Boolean(window.pisiTaskDetailState.overlay?.isConnected)`)
        );
        await run('(window.closePisiTaskDetail(), true)');
        // A note task opens its note and shows its block.
        await run(`window.openPisiSearchResult({ kind: 'task', id: ${json('task:' + noteTask.id)}, taskId: ${json(noteTask.id)} })`);
        await waitUntil('note opened from a task result', () =>
            run(
                `window.activeCenterNode?.path === ${json(note.path)} && Boolean(document.querySelector('#center-node-editor-content [data-pisi-task-id=${json(noteTask.id)}]'))`
            )
        );
        await closeEditors();
        assert((await storedTask(projectPath, phoneTaskId)).source === undefined, 'no fake place is written to the phone task (GB5)');
    }
    await assertIntegrityClean(app, 'search');

    // ---- 3. Tag result: exactly its block (GK3).
    {
        const tagNote = await createNote();
        await closeEditors();
        const data = await readJson(tagNote.path);
        data.content =
            '<p class="pisi-editor-block" data-pisi-block-id="blk_tag_one">Aynı metin #e2e</p><p class="pisi-editor-block" data-pisi-block-id="blk_tag_two">Aynı metin #e2e</p>';
        await fs.writeFile(tagNote.path, JSON.stringify(data, null, 2));
        await waitUntil('note reread', async () => (await readJson(tagNote.path)).content.includes('blk_tag_two'));
        const { result: opened, io } = await countNodeIo(app, () =>
            run(`window.openPisiTagBlockResult({ nodePath: ${json(tagNote.path)}, blockId: 'blk_tag_two', nodeTitle: 'Etiket' })`)
        );
        assert(opened?.ok && opened.code === 'OK' && opened.blockId === 'blk_tag_two', 'the tag result opens its block', opened);
        const missing = await run(`window.openPisiTagBlockResult({ nodePath: ${json(tagNote.path)}, blockId: 'blk_yok' })`);
        assert(missing?.ok === false && missing.code === 'BLOCK_NOT_FOUND', 'a missing block is not guessed', missing);
        assert(
            io.writes.filter((file) => file !== tagNote.path).length === 0 && io.taskStoreWrites.length === 0,
            'navigation writes no other file and no task (GK3)',
            io
        );
        await closeEditors();
    }
    await assertIntegrityClean(app, 'tag navigation');

    // ---- 4. Map: badges by noteId; a note copy copies its tasks with new ids (S16, GK9).
    let mapPath = null;
    let mapNote = null;
    {
        const before = new Set(await fs.readdir(projectPath));
        await run("document.getElementById('add-map-btn').click()");
        mapPath = await waitUntil('new map file', async () => {
            const created = (await fs.readdir(projectPath)).find((name) => name.endsWith('.map') && !before.has(name));
            return created ? path.join(projectPath, created) : null;
        });
        await openMap(mapPath);
        await run(`(() => {
            const canvas = document.getElementById('map-canvas');
            const rect = canvas.getBoundingClientRect();
            canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, clientX: rect.left + 200, clientY: rect.top + 160 }));
            return true;
        })()`);
        const box = await waitUntil('map node', () =>
            run(
                `(() => { const box = document.querySelector('#map-board .map-node-box[data-node-path]'); return box ? { id: box.dataset.nodeId, path: box.dataset.nodePath } : null; })()`
            )
        );
        mapNote = { id: (await readJson(box.path)).pisi.id, path: box.path };
        const open = (await command('task.create.v1', { task: { title: 'Haritadaki açık iş' }, target: { noteId: mapNote.id, notePath: mapNote.path } })).task;
        const late = (
            await command('task.create.v1', {
                task: { title: 'Haritadaki geciken', dueDate: addDays(today, -1) },
                target: { noteId: mapNote.id, notePath: mapNote.path }
            })
        ).task;
        const done = (await command('task.create.v1', { task: { title: 'Haritadaki biten' }, target: { noteId: mapNote.id, notePath: mapNote.path } })).task;
        await command('task.complete.v1', { taskId: done.id });
        if (!(await run(`window.activeMapPath === ${json(mapPath)}`))) await openMap(mapPath);
        const badgeState = () =>
            run(`(() => {
                // Compared as a value: a Windows path's backslashes would be CSS escapes in a selector.
                const box = Array.from(document.querySelectorAll('#map-board .map-node-box[data-node-path]')).find((item) => item.dataset.nodePath === ${json(mapNote.path)});
                const count = box?.querySelector('.pisi-map-task-count-badge');
                return {
                    count: count?.textContent || null,
                    label: count?.getAttribute('aria-label') || null,
                    dot: box?.querySelector('.pisi-map-status-dot')?.getAttribute('aria-label') || null,
                    overdue: Array.from(box?.querySelectorAll('.pisi-map-work-badge.overdue') || []).map((item) => item.textContent)
                };
            })()`);
        const badge = await waitUntil('task count badge', async () => ((await badgeState()).count === '2' ? badgeState() : null));
        assert(badge.label === '2 açık görev' && badge.dot === 'Gecikmiş', 'the badges count the note tasks by noteId, in Turkish', badge);
        // The work badges are off by default; turned on, the overdue one names the count.
        await run(`(document.getElementById('pisi-map-operational-work')?.click(), true)`);
        const work = await waitUntil('work badges', async () => ((await badgeState()).overdue.length ? badgeState() : null));
        assert(json(work.overdue) === json(['1 gecikmiş']), 'the overdue badge counts by dueDate', work);

        const sourceBefore = await fs.readFile(mapNote.path, 'utf8');
        const tasksBefore = await storedTasks(projectPath);
        const copy = await run(
            `window.pisiDomain.command('map.nodes.duplicate.v1', { mapPath: ${json(mapPath)}, nodes: [{ sourcePath: ${json(mapNote.path)}, layout: { x: 600, y: 300 } }], edges: [], openPaths: window.getPisiOpenDocumentPaths() })`
        );
        assert(copy?.ok && copy.tasks === 3 && copy.nodes.length === 1, 'the copy is made with its three tasks', copy);
        assert((await fs.readFile(mapNote.path, 'utf8')) === sourceBefore, 'the source note is not changed');
        const copyPath = copy.nodes[0].fullPath;
        const copyId = copy.nodes[0].id;
        const copyIds = listPisiNoteTaskIds((await readJson(copyPath)).content);
        const sourceIds = [open.id, late.id, done.id];
        assert(copyIds.length === 3 && copyIds.every((id) => !sourceIds.includes(id)), 'the copy has three blocks with new ids (GV7)', copyIds);
        const tasksAfter = await storedTasks(projectPath);
        assert(tasksAfter.length === tasksBefore.length + 3, 'three records are added', tasksAfter.length);
        const copies = copyIds.map((id) => tasksAfter.find((task) => task.id === id));
        assert(
            copies.every((task) => task && task.noteId === copyId && task.status === 'todo'),
            'each copy lives in the copied note and is open',
            copies
        );
        assert(
            json(copies.map((task) => task.title)) === json(['Haritadaki açık iş', 'Haritadaki geciken', 'Haritadaki biten']),
            'the copies keep the titles',
            copies
        );
        for (const id of sourceIds) assert((await storedTask(projectPath, id)).noteId === mapNote.id, 'the source tasks stay in their note');
        // The dated copy joins its day's diary section.
        assert((await diaryIds(addDays(today, -1))).includes(copies[1].id), 'the dated copy is on its day', await diaryIds(addDays(today, -1)));
        await waitStoreEvent(`(tasks) => ${json(copyIds)}.every((id) => tasks.some((task) => task.id === id))`, 'renderer store has the copies');
    }
    await assertIntegrityClean(app, 'map copy');

    // ---- 5. Markdown export and import (§3.6).
    {
        const exported = await run(`window.pisiProject.exportProjectMarkdown(${json(projectPath)})`);
        assert(exported?.ok && exported.destination, 'export works', exported);
        const relative = path.relative(projectPath, mapNote.path).replace(/\.node$/, '.md');
        const noteMarkdown = await fs.readFile(path.join(exported.destination, relative), 'utf8');
        assert(
            noteMarkdown.includes('- [ ] Haritadaki açık iş') && noteMarkdown.includes('- [x] Haritadaki biten'),
            'the note export has the task rows',
            noteMarkdown
        );
        const diaryMarkdown = await fs.readFile(
            path.join(exported.destination, path.relative(projectPath, diaryPath(projectPath, today)).replace(/\.node$/, '.md')),
            'utf8'
        );
        assert(
            diaryMarkdown.includes('### Görevler') && diaryMarkdown.includes('- [ ] Günlükte yaşayan'),
            'the diary export has its task section',
            diaryMarkdown
        );
        assert(!noteMarkdown.includes('data-pisi-task-id') && !noteMarkdown.includes('task_'), 'no task markup in the export');

        await fs.mkdir(importPath, { recursive: true });
        await fs.copyFile(path.join(exported.destination, relative), path.join(importPath, 'Harita notu.md'));
        const tasksBefore = await storedTasks(projectPath);
        const imported = await run(`window.pisiProject.importMarkdownFolder(${json(projectPath)})`);
        assert(imported?.ok && imported.imported === 1 && imported.tasks === 2, 'import makes the two open rows tasks', imported);
        const importedNote = await readJson(imported.created[0]);
        const importedIds = listPisiNoteTaskIds(importedNote.content);
        const tasksAfter = await storedTasks(projectPath);
        assert(tasksAfter.length === tasksBefore.length + 2, 'two records are added', tasksAfter.length);
        const importedTasks = importedIds.map((id) => tasksAfter.find((task) => task.id === id));
        assert(
            json(importedTasks.map((task) => [task?.title, task?.noteId])) ===
                json([
                    ['Haritadaki açık iş', importedNote.pisi.id],
                    ['Haritadaki geciken', importedNote.pisi.id]
                ]),
            'the imported tasks live in the imported note',
            importedTasks
        );
        assert(importedNote.content.includes('☑ Haritadaki biten'), 'a done row stays text');
    }
    await assertIntegrityClean(app, 'export and import');

    // ---- 6. A note's history restore brings back the tasks of the restored blocks (§3.3).
    {
        const historyNote = await createNote();
        await closeEditors();
        const first = (await command('task.create.v1', { task: { title: 'Geçmişteki iş' }, target: { noteId: historyNote.id, notePath: historyNote.path } }))
            .task;
        const second = (await command('task.create.v1', { task: { title: 'Taşınacak iş' }, target: { noteId: historyNote.id, notePath: historyNote.path } }))
            .task;
        const withBoth = (await readJson(historyNote.path)).content;
        // The first task's block is deleted in a save: it goes to the Trash; the second moves to another note.
        const saved = await run(
            `window.pisiProject.saveNodeContent(${json(historyNote.path)}, ${json(withBoth.replace(new RegExp(`<div[^>]*data-pisi-task-id="${first.id}"[^>]*></div>`), ''))})`
        );
        assert(saved?.ok, 'save without the first block', saved);
        await waitUntil('first task in the Trash', async () => !(await storedTask(projectPath, first.id)));
        await command('task.move.v1', { taskId: second.id, target: { noteId: note.id, notePath: note.path }, fromNotePath: historyNote.path });
        const history = await run(`window.pisiProject.listNodeHistory(${json(historyNote.path)})`);
        const version = await (async () => {
            for (const item of history?.versions || []) {
                const read = await run(`window.pisiProject.getNodeHistoryVersion(${json(historyNote.path)}, ${json(item.historyId)})`);
                const ids = listPisiNoteTaskIds(read?.data?.content || '') || [];
                if (ids.includes(first.id) && ids.includes(second.id)) return item;
            }
            return null;
        })();
        assert(version, 'a version with both blocks', history);
        const restored = await run(`window.pisiProject.restoreNodeHistory(${json(historyNote.path)}, ${json(version.historyId)}, [])`);
        assert(restored?.ok, 'restore works', restored);
        assert(json(restored.tasks?.restored) === json([first.id]), 'the trashed task comes back', restored.tasks);
        assert(json(listPisiNoteTaskIds((await readJson(historyNote.path)).content)) === json([first.id]), 'the moved task is not brought back (GV7)');
        assert((await storedTask(projectPath, first.id))?.noteId === historyNote.id, 'the task lives in the note again');
        assert((await storedTask(projectPath, second.id))?.noteId === note.id, 'the moved task stays where it is');
        await waitStoreEvent(`(tasks) => tasks.some((task) => task.id === ${json(first.id)})`, 'renderer store has the restored task');
    }
    await assertIntegrityClean(app, 'history restore');

    const errors = await run('window.__pisiSurfaceErrors');
    assert(Array.isArray(errors) && errors.length === 0, 'no renderer errors', errors);
    console.log('[tasks-surfaces-e2e] passed');
} catch (error) {
    console.error('[tasks-surfaces-e2e] failed:', error?.stack || error);
    console.error(pisi.logs().slice(-4000));
    process.exitCode = 1;
} finally {
    await pisi.stop();
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}
