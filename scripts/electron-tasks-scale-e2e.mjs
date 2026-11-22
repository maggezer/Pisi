import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generatePisiProjectFixture } from './generate-project-fixture.mjs';
import { assert, assertIntegrityClean, countNodeIo, createPisiTasksE2E, readJson, sleep, storedTask, tasksPath } from './e2e-tasks-app.mjs';
import { getPisiTodayIsoDate } from '../shared/task-model.mjs';

// The large project measurement of the task system (docs/task-plan.md G7,
// S8): a project of 2.000 notes and 5.000 version 2 tasks made by
// scripts/generate-project-fixture.mjs (`taskModel: 2`: task blocks in the
// notes, a diary with its task section for every task day) plus a note with
// 200 task blocks. It measures, in the real app:
// - opening the project until the task store is loaded,
// - the task panel's first drawing,
// - opening the note with 200 task blocks until every block is drawn,
// - completing a note task and a daily task (command round trip from the
//   renderer, the main process's own share, broken into reading tasks.json,
//   and the whole atomic command), with .node reads and writes counted: a
//   completion reads and writes no note, only the diaries of the days it
//   changes (GV5); a completion that changes no day touches no .node at all,
// - the diaries the completions created, the size of tasks.json and the
//   number of `completions`.
// Project Integrity has no finding at the end (GV14). The report is printed
// and written as JSON to PISI_TASK_SCALE_OUTPUT (a file path; by default
// task-scale-timing.json in the system temp folder). The limits it checks are
// coarse (a slow CI machine must pass); the numbers are the report.

// The real path: on Windows os.tmpdir() can be a short 8.3 name (RUNNER~1), the app opens the long one.
const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-tasks-scale-e2e-')));
const projectPath = path.join(tempRoot, 'project');
const outputPath = path.resolve(process.env.PISI_TASK_SCALE_OUTPUT || path.join(os.tmpdir(), 'task-scale-timing.json'));
const SIZE = { notes: 2000, perMap: 250, tasks: 5000, diaryDays: 60, heavyNoteTasks: 200 };
const pisi = createPisiTasksE2E({ tempRoot, port: Number(process.env.PISI_E2E_PORT) || 9291, inspectPort: Number(process.env.PISI_E2E_INSPECT_PORT) || 9292 });
const { waitUntil } = pisi;
let app = null;
const run = (expression) => app.cdp.evaluate(expression);
const runMain = (expression) => app.main.evaluate(expression, { page: false });

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function countDiaries() {
    return (await fs.readdir(path.join(projectPath, 'diary'))).filter((name) => name.endsWith('.node')).length;
}

/** A completion from the renderer: the command's round trip, and the files it read and wrote. */
async function completeFromRenderer(taskId) {
    const { result, io } = await countNodeIo(app, () =>
        run(`(async () => {
            const started = performance.now();
            const result = await window.runPisiTaskCommand('task.complete.v1', { taskId: ${JSON.stringify(taskId)} });
            return { ok: result?.ok === true, ms: Math.round(performance.now() - started), writtenDiaries: result?.writtenDiaries || [], createdDiaries: result?.createdDiaries || [] };
        })()`)
    );
    assert(result.ok, 'complete ' + taskId, result);
    return { ...result, nodeReads: io.reads, nodeWrites: io.writes, taskStoreWrites: io.taskStoreWrites.length };
}

/** The main process's share of a completion: reading tasks.json fresh, and the whole command in its atomic mutation. */
async function measureMainCompletion(taskId) {
    return runMain(`(() => {
        const project = ${JSON.stringify(projectPath)};
        const read = [];
        for (let round = 0; round < 3; round += 1) {
            const started = performance.now();
            readPisiTaskStoreState(project, { fresh: true });
            read.push(performance.now() - started);
        }
        const started = performance.now();
        const result = runPisiAtomicMutation(project, 'task.complete.v1', () => completePisiTaskCommand(project, { taskId: ${JSON.stringify(taskId)} }));
        const commandMs = performance.now() - started;
        return { ok: result?.ok === true, readTasksJsonMs: Math.round(Math.min(...read)), commandMs: Math.round(commandMs) };
    })()`);
}

/** Waits until the main process reads and writes no .node for a second; returns how long that took. */
async function waitForQuiet() {
    const started = Date.now();
    await run('window.ensurePisiSearchIndex?.().then(() => true)');
    await waitUntil(
        'no background .node reads',
        async () => {
            const idle = await countNodeIo(app, () => sleep(1000));
            return idle.io.reads.length === 0 && idle.io.writes.length === 0;
        },
        180000
    );
    return Date.now() - started;
}

/** Opens a note in the center editor: until it is shown, and until its `taskBlocks` task blocks are drawn. */
function openNoteMeasured(fullPath, taskBlocks) {
    return run(`(async () => {
        const started = performance.now();
        const fullPath = ${JSON.stringify(fullPath)};
        const fileName = fullPath.split(/[\\\\/]/).pop();
        const opening = window.openPisiFileTab({ name: fileName, fileName, fullPath, type: 'file', isFile: true, isDirectory: false });
        let editorMs = null;
        for (let attempt = 0; attempt < 600; attempt += 1) {
            const editor = document.getElementById('center-node-editor-content');
            const open = editor && window.activeCenterNode?.path === fullPath;
            if (open && editorMs === null) editorMs = Math.round(performance.now() - started);
            const blocks = open ? editor.querySelectorAll('.pisi-task-block') : [];
            if (open && blocks.length >= ${taskBlocks} && Array.from(blocks).every((block) => block.childElementCount > 0)) {
                const ms = Math.round(performance.now() - started);
                await opening;
                // Drawing every block again from its record (what a task store update costs at most).
                const redrawStarted = performance.now();
                for (const block of blocks) window.drawPisiTaskBlock(block);
                return { blocks: blocks.length, ms, editorShownMs: editorMs, redrawAllBlocksMs: Math.round(performance.now() - redrawStarted) };
            }
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        return null;
    })()`);
}

try {
    const today = getPisiTodayIsoDate();
    const generated = await generatePisiProjectFixture(projectPath, { ...SIZE, relationships: false, today, taskModel: 2 });
    const store = await readJson(tasksPath(projectPath));
    const heavyNote = generated.notePaths[0];
    const heavyNoteId = (await readJson(heavyNote)).pisi.id;
    const noteTask = store.tasks.find(
        (task) => task.noteId && task.noteId !== heavyNoteId && task.repeat === 'none' && task.status !== 'done' && task.dueDate > today
    );
    const dailyTask = store.tasks.find((task) => task.repeat === 'daily' && task.noteId);
    const heavyTask = store.tasks.find((task) => task.noteId === heavyNoteId && task.status !== 'done' && task.repeat === 'none');
    const todayTask = store.tasks.find(
        (task) =>
            task.noteId && task.noteId !== heavyNoteId && task.repeat === 'none' && task.status !== 'done' && task.dueDate === today && task.id !== noteTask?.id
    );
    assert(noteTask && dailyTask && heavyTask && todayTask, 'fixture tasks found');

    const report = {
        measuredAt: new Date().toISOString(),
        platform: `${process.platform}-${process.arch}`,
        node: process.version,
        cpus: os.cpus().length,
        size: { ...SIZE, tasksInStore: store.tasks.length, diariesGenerated: generated.diaries }
    };

    const openStarted = Date.now();
    app = await pisi.launch(projectPath);
    report.projectOpenMs = Date.now() - openStarted;
    assert((await run('window.getPisiTasks().length')) === store.tasks.length, 'all tasks in the store');

    await run(`document.querySelector('.right-panel-tab[data-right-tab="missions"]')?.click()`);
    await waitUntil('panel', () => run(`document.querySelectorAll('#pisi-missions-list [data-pisi-task-card]').length > 0`), 30000);
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
    report.panelFirstDrawMs = median(firstDraw);

    // After the open the app reads the project in the background (the search index; after a note
    // opens, the tag index reads every note and diary: renderer/tags/pisi-tag-index.mjs). The counts
    // below are for the task commands alone, so the measurement waits until no .node is read.
    report.backgroundReadUntilQuietMs = await waitForQuiet();

    // The note with 200 task blocks, after a note without task blocks: from the open call until the
    // editor shows it and every task block is drawn from its record.
    report.plainNoteOpen = await openNoteMeasured(generated.notePaths[1], 0);
    const noteOpen = await openNoteMeasured(heavyNote, SIZE.heavyNoteTasks);
    assert(noteOpen, 'the note with 200 task blocks opens and draws every block');
    report.heavyNoteOpen = noteOpen;
    report.tagIndexReadUntilQuietMs = await waitForQuiet();

    // Completions: a task due today (no day changes); a task of a closed note; a task of the open note (its note is not written: GV9); a daily task (next day's diary).
    const diariesBefore = await countDiaries();
    // Due today and done today: no day changes, so no .node is read or written at all (GV5).
    report.completeDueToday = await completeFromRenderer(todayTask.id);
    assert(
        report.completeDueToday.nodeReads.length === 0 && report.completeDueToday.nodeWrites.length === 0,
        'due today: no .node touched',
        report.completeDueToday
    );
    report.completeDueToday.nodeReads = 0;
    report.completeDueToday.nodeWrites = 0;
    report.completeClosedNote = await completeFromRenderer(noteTask.id);
    report.completeOpenNote = await completeFromRenderer(heavyTask.id);
    report.completeDaily = await completeFromRenderer(dailyTask.id);
    for (const [label, entry] of Object.entries({
        completeClosedNote: report.completeClosedNote,
        completeOpenNote: report.completeOpenNote,
        completeDaily: report.completeDaily
    })) {
        // Only the diaries of the days the completion changes are read and written; no note (GV5).
        const days = new Set([...entry.writtenDiaries, ...entry.createdDiaries]);
        const ofDays = (file) => {
            const match = /[\\/]diary[\\/](\d{4}-\d{2}-\d{2})\.node/.exec(file);
            return Boolean(match) && days.has(match[1]);
        };
        assert(entry.nodeReads.every(ofDays), `${label}: only the diaries of its days are read`, entry.nodeReads);
        assert(entry.nodeWrites.every(ofDays), `${label}: only the diaries of its days are written`, entry.nodeWrites);
        assert(entry.taskStoreWrites >= 1, `${label}: tasks.json written`, entry);
        entry.nodeReads = entry.nodeReads.length;
        entry.nodeWrites = entry.nodeWrites.length;
    }
    assert((await storedTask(projectPath, noteTask.id)).status === 'done', 'closed note task done');
    assert((await storedTask(projectPath, dailyTask.id)).completions.length === dailyTask.completions.length + 1, 'daily task: one completion more');
    report.diariesCreatedByCompletions = (await countDiaries()) - diariesBefore;

    // The main process's own share of a completion.
    const second = store.tasks.find(
        (task) => task.noteId && task.repeat === 'none' && task.status !== 'done' && task.id !== noteTask.id && task.id !== heavyTask.id
    );
    report.completeMain = await measureMainCompletion(second.id);
    assert(report.completeMain.ok, 'main completion', report.completeMain);

    const after = await readJson(tasksPath(projectPath));
    const stat = await fs.stat(tasksPath(projectPath));
    report.tasksJson = {
        bytes: stat.size,
        tasks: after.tasks.length,
        completions: after.tasks.reduce((sum, task) => sum + (Array.isArray(task.completions) ? task.completions.length : 0), 0),
        repeatingTasks: after.tasks.filter((task) => task.repeat !== 'none').length,
        bytesPerTask: Math.round(stat.size / after.tasks.length)
    };
    report.diaries = await countDiaries();

    const integrityStarted = Date.now();
    await assertIntegrityClean(app, 'scale');
    report.integrityMs = Date.now() - integrityStarted;

    console.log('[tasks-scale-e2e] report', JSON.stringify(report, null, 2));
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log('[tasks-scale-e2e] written to', outputPath);

    // Coarse limits: a regression of an order of magnitude fails, a slow machine does not.
    assert(report.projectOpenMs <= 30000, 'project opens ≤ 30 s', report.projectOpenMs);
    assert(report.panelFirstDrawMs <= 1000, 'panel first drawing ≤ 1 s', report.panelFirstDrawMs);
    assert(report.heavyNoteOpen.ms <= 5000, 'the 200-task note opens ≤ 5 s', report.heavyNoteOpen);
    assert(report.completeClosedNote.ms <= 3000, 'a completion ≤ 3 s', report.completeClosedNote);
    console.log('[tasks-scale-e2e] passed');
} catch (error) {
    console.error('[tasks-scale-e2e] failed:', error?.stack || error);
    console.error(pisi.logs().slice(-4000));
    process.exitCode = 1;
} finally {
    await pisi.stop();
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}
