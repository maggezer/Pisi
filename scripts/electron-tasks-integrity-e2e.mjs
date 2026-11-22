import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assert, assertIntegrityClean, countNodeIo, createPisiTasksE2E, diaryPath, readJson, storedTask, storedTasks, tasksPath } from './e2e-tasks-app.mjs';
import { listPisiTaskBlocks, makePisiTaskBlockHtml, removePisiTaskBlock } from '../shared/task-blocks.mjs';
import { readPisiDiaryTaskSection } from '../shared/task-diary.mjs';

// The repairs of Project Integrity's task findings (docs/task-plan.md G7), in
// the real app over CDP: a project is broken from outside the app the way a
// sync tool, a crash or a hand edit can break it, then Settings → Project
// Integrity audits it and each task finding is repaired with its "Onar"
// button (one repair, its own confirmation):
// - orphan block, its task nowhere → the block is taken out of the note;
// - orphan block, its task in the Trash → the task comes back into that note;
// - homeless task, its note open in the editor → the editor gets the block
//   and saves it; the main process does not write the open note (GV9);
// - task whose note is gone → it lives in today's diary;
// - block in two notes → the other note's block becomes a copy task;
// - dependency loop and a missing dependency → the dependency goes; tasks.json
//   only, no .node written (GV5; the repair's audits read the notes, as every
//   Integrity audit does);
// - diary section that breaks the rule → made again from tasks.json.
// At the end Project Integrity reports nothing (GV14).

const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-tasks-integrity-')));
const projectPath = path.join(tempRoot, 'project');
const pisi = createPisiTasksE2E({ tempRoot, port: 9293, inspectPort: 9294 });
const { waitUntil } = pisi;

let app = null;
const run = (expression) => app.cdp.evaluate(expression);
const json = (value) => JSON.stringify(value);
const EDITOR = "document.getElementById('center-node-editor-content')";
const SECTION = "document.querySelector('.pisi-integrity-expanded')";

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

/** Changes a closed note's content from outside the app (as a sync tool or a hand edit would). */
async function editFromOutside(notePath, change) {
    const data = await readJson(notePath);
    data.content = change(String(data.content || ''));
    await fs.writeFile(notePath, JSON.stringify(data, null, 2), 'utf8');
}

/** Records the call stacks of the main process's writes of `notePath` until `stop()`, to tell who wrote it. */
async function watchNoteWriters(notePath) {
    await app.main.evaluate(
        `(() => {
            const fs = process.getBuiltinModule('node:fs');
            const { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
            const stacks = (globalThis.__pisiNoteWriters = []);
            Error.stackTraceLimit = 60;
            const originals = (globalThis.__pisiNoteWriterOriginals = {});
            for (const name of ['writeFileSync', 'renameSync']) {
                const original = (originals[name] = fs[name]);
                fs[name] = function watchingPisiNote(target, ...rest) {
                    if (String(name === 'renameSync' ? rest[0] : target) === ${json(notePath)}) stacks.push(new Error().stack);
                    return original.call(this, target, ...rest);
                };
            }
            syncBuiltinESMExports();
            return true;
        })()`,
        { page: false }
    );
    return {
        stop: () =>
            app.main.evaluate(
                `(() => {
                    const fs = process.getBuiltinModule('node:fs');
                    Object.assign(fs, globalThis.__pisiNoteWriterOriginals);
                    process.getBuiltinModule('node:module').syncBuiltinESMExports();
                    return globalThis.__pisiNoteWriters.slice();
                })()`,
                { page: false }
            )
    };
}

const noteContent = async (notePath) => String((await readJson(notePath)).content || '');
const blockIds = async (notePath) => (listPisiTaskBlocks(await noteContent(notePath)) || []).map((block) => block.taskId);

/** Settings → Project Integrity → "Projeyi denetle"; returns once the report is drawn. */
async function auditInSettings() {
    await run("window.openPisiCommandCenter('settings')");
    await waitUntil('integrity section', () => run(`Boolean(${SECTION})`));
    await run(`${SECTION}.querySelector('.pisi-integrity-actions .pisi-primary-button').click()`);
    await waitUntil('integrity report', () => run(`Boolean(${SECTION}.querySelector('.pisi-integrity-status'))`), 30000);
}

const repairButtons = () => run(`Array.from(${SECTION}.querySelectorAll('.pisi-integrity-repair-one')).map((button) => button.dataset.repairAction)`);

/** Clicks the "Onar" button of the first finding with `action`, accepts its confirmation and waits for the new report. */
async function repairInSettings(action) {
    const before = (await repairButtons()).length;
    assert(
        await run(`(() => {
        const button = ${SECTION}.querySelector('.pisi-integrity-repair-one[data-repair-action=${json(action)}]');
        button?.click();
        return Boolean(button);
    })()`),
        'repair button ' + action,
        await repairButtons()
    );
    const message = await waitUntil(action + ' confirmation', () => run("document.getElementById('pisi-confirm-message')?.textContent || null"));
    assert(/görev onarımı|task repair/i.test(message), action + ': confirmation names the repair', message);
    await run("document.getElementById('pisi-confirm-ok').click()");
    await waitUntil(action + ' repaired', async () => (await repairButtons()).length < before, 30000);
}

try {
    await fs.mkdir(projectPath, { recursive: true });
    app = await pisi.launch(projectPath);
    const today = await run('window.getPisiTaskToday()');
    await run(`window.__pisiIntegrityErrors = [];
        window.addEventListener('error', (event) => window.__pisiIntegrityErrors.push(String(event.message)));
        window.addEventListener('unhandledrejection', (event) => window.__pisiIntegrityErrors.push(String(event.reason?.stack || event.reason)));
        true`);

    const noteA = await createNote();
    const noteB = await createNote();
    const noteC = await createNote();
    await closeEditors();
    const target = (note) => ({ noteId: note.id, notePath: note.path });
    const homeless = (await command('task.create.v1', { task: { title: 'Evsiz' }, target: target(noteA) })).task;
    const doubled = (await command('task.create.v1', { task: { title: 'Çift', priority: 5 }, target: target(noteA) })).task;
    const trashed = (await command('task.create.v1', { task: { title: 'Çöpten dönen' }, target: target(noteA) })).task;
    const lost = (await command('task.create.v1', { task: { title: 'Notu silinen' }, target: target(noteC) })).task;
    const loopA = (await command('task.create.v1', { task: { title: 'Döngü A' }, target: target(noteB) })).task;
    const loopB = (await command('task.create.v1', { task: { title: 'Döngü B', dependencies: [loopA.id] }, target: target(noteB) })).task;
    const diaryTask = (await command('task.create.v1', { task: { title: 'Günlükte' }, target: { diaryDate: today } })).task;
    await command('task.delete.v1', { taskId: trashed.id, notePath: noteA.path });
    await assertIntegrityClean(app, 'setup');

    // ---- The project is broken from outside the app.
    await editFromOutside(
        noteA.path,
        (html) =>
            removePisiTaskBlock(html, homeless.id) + makePisiTaskBlockHtml({ blockId: 'blk_orphan0001', taskId: 'task_00000000-0000-4000-8000-0000000000aa' })
    );
    await editFromOutside(
        noteB.path,
        (html) =>
            html +
            makePisiTaskBlockHtml({ blockId: 'blk_double0001', taskId: doubled.id }) +
            makePisiTaskBlockHtml({ blockId: 'blk_back0001', taskId: trashed.id })
    );
    await fs.rm(noteC.path);
    {
        const store = await readJson(tasksPath(projectPath));
        store.tasks = store.tasks.map((task) =>
            task.id === loopA.id ? { ...task, dependencies: [loopB.id, 'task_00000000-0000-4000-8000-0000000000bb'] } : task
        );
        await fs.writeFile(tasksPath(projectPath), JSON.stringify(store, null, 2), 'utf8');
    }
    await editFromOutside(
        diaryPath(projectPath, today),
        (html) => html + '<div class="pisi-editor-block" data-pisi-block-id="blk_after0001" data-pisi-block-type="paragraph">Bölümden sonra</div>'
    );
    await run('window.refreshCurrentProjectTree?.()');
    await waitUntil('note C gone from the tree', () =>
        run(`!Array.from(document.querySelectorAll('.tree-node[data-path]')).some((n) => n.dataset.path === ${json(noteC.path)})`)
    );

    // Note A is open while its homeless task is repaired (GV9).
    await openNote(noteA.path);
    await auditInSettings();
    const actions = (await repairButtons()).sort();
    assert(
        json(actions) ===
            json(
                [
                    'task-append-block',
                    'task-place-in-today-diary',
                    'task-rebuild-diary-section',
                    'task-remove-dependency',
                    'task-remove-dependency',
                    'task-remove-orphan-block',
                    'task-restore-orphan',
                    'task-split-duplicate'
                ].sort()
            ),
        'one repair for each task finding',
        actions
    );

    // Dependencies: tasks.json only (GV5).
    {
        const { io } = await countNodeIo(app, async () => {
            await repairInSettings('task-remove-dependency');
            await repairInSettings('task-remove-dependency');
        });
        // The repair entry audits the project before and after (it reads every note, GV5 leaves Integrity out); the repair writes no .node.
        assert(io.writes.length === 0, 'dependency repairs: no .node written', io.writes);
        assert(io.taskStoreWrites.length >= 2, 'dependency repairs: tasks.json written', io);
        const deps = [...(await storedTask(projectPath, loopA.id)).dependencies, ...(await storedTask(projectPath, loopB.id)).dependencies];
        assert(deps.length === 1 && !deps.includes('task_00000000-0000-4000-8000-0000000000bb'), 'loop and missing dependency gone', deps);
    }

    // The homeless task of the open note: the repair leaves the file to the editor (GV9), which saves the block.
    {
        const writers = await watchNoteWriters(noteA.path);
        await repairInSettings('task-append-block');
        await waitUntil('block in the open editor', () =>
            run(`Boolean(${EDITOR}.querySelector('.pisi-task-block[data-pisi-task-id="${homeless.id}"] .pisi-task-check'))`)
        );
        await waitUntil('block saved by the editor', async () => (await blockIds(noteA.path)).includes(homeless.id));
        const stacks = await writers.stop();
        assert(stacks.length > 0 && stacks.every((stack) => !stack.includes('applyPisiTaskRepair')), 'the repair does not write the open note', stacks);
        assert(
            stacks.some((stack) => stack.includes('savePisiNoteWithTasks')),
            'the editor’s save writes it'
        );
    }

    // The orphan block of an unknown task goes (the note is open: the editor removes and saves it).
    await repairInSettings('task-remove-orphan-block');
    await waitUntil('orphan block gone', async () => !(await noteContent(noteA.path)).includes('task_00000000-0000-4000-8000-0000000000aa'));

    // The orphan block of a trashed task brings it back into note B.
    await repairInSettings('task-restore-orphan');
    assert((await storedTask(projectPath, trashed.id))?.noteId === noteB.id, 'trashed task back in note B');

    // The block in two notes: note A keeps the task, note B's block becomes a copy.
    await repairInSettings('task-split-duplicate');
    {
        const ids = await blockIds(noteB.path);
        assert(!ids.includes(doubled.id), 'note B no longer holds the original', ids);
        const copy = (await storedTasks(projectPath)).find((task) => ids.includes(task.id) && task.title === 'Çift');
        assert(copy && copy.noteId === noteB.id && copy.priority === 5, 'copy task in note B', copy);
        await waitUntil('note A keeps the original', async () => (await blockIds(noteA.path)).includes(doubled.id));
    }

    // Today's section after the paragraph: made again, last, with today's task.
    await repairInSettings('task-rebuild-diary-section');
    {
        const content = await noteContent(diaryPath(projectPath, today));
        const section = readPisiDiaryTaskSection(content);
        assert(section.count === 1 && section.last, 'one section, last', section);
        assert(section.taskIds.includes(diaryTask.id), 'section names today’s task', section);
        assert(content.includes('Bölümden sonra'), 'the paragraph stays');
    }

    // The task whose note is gone lives in today's diary.
    await repairInSettings('task-place-in-today-diary');
    {
        const record = await storedTask(projectPath, lost.id);
        assert(record.diaryDate === today && record.noteId === null, 'lost task in today’s diary', record);
        const section = readPisiDiaryTaskSection(await noteContent(diaryPath(projectPath, today)));
        assert(section.taskIds.includes(lost.id) && section.last, 'today’s section names it', section);
    }

    assert((await repairButtons()).length === 0, 'no task repair left', await repairButtons());
    await closeEditors();
    await assertIntegrityClean(app, 'after the repairs');
    const errors = await run('window.__pisiIntegrityErrors');
    assert(Array.isArray(errors) && errors.length === 0, 'no page errors', errors);
    console.log('[tasks-integrity-e2e] passed');
} catch (error) {
    console.error('[tasks-integrity-e2e] failed:', error?.stack || error);
    console.error(pisi.logs().slice(-4000));
    process.exitCode = 1;
} finally {
    await pisi.stop();
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}
