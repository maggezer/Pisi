import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makePisiTaskBlockHtml, listPisiTaskBlocks } from '../shared/task-blocks.mjs';
import { readPisiDiaryTaskSection } from '../shared/task-diary.mjs';
import { getPisiTodayIsoDate } from '../shared/task-model.mjs';
import { assert, assertIntegrityClean, countNodeIo, createPisiTasksE2E, diaryPath, readJson, sleep, storedTask, storedTasks } from './e2e-tasks-app.mjs';

// The task block and the diary's task section in the editor (docs/task-plan.md
// G3, Ek B S12–S15 and S18), in the real app over CDP: tasks are made with
// `[ ]`, the slash command, the block type and the toolbar; a title is typed
// and lands in tasks.json only (the note keeps the bare §3.2.1 block, GV2,
// GV5); Enter, Backspace and the arrows follow docs/editor-keyboard-rules.md;
// undo takes back a completion, a title and a deletion; cut and paste moves a
// task, copy and paste copies it; find and replace changes titles; in a diary
// a task goes into the day's section and an earlier completion is locked.
// After every scenario Project Integrity must report nothing (GV14).

const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-tasks-editor-')));
const projectPath = path.join(tempRoot, 'project');
const pisi = createPisiTasksE2E({ tempRoot, port: 9263, inspectPort: 9264 });
const { waitUntil } = pisi;

const addDays = (day, days) => {
    const date = new Date(`${day}T12:00:00`);
    date.setDate(date.getDate() + days);
    return getPisiTodayIsoDate(date);
};

let app = null;
const timings = {};

const run = (expression) => app.cdp.evaluate(expression);
const EDITOR = "document.getElementById('center-node-editor-content')";

async function key(name, { shift = false, ctrl = false, text = undefined } = {}) {
    const codes = { Enter: 13, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Escape: 27, ' ': 32, z: 90, y: 89 };
    const code = { ' ': 'Space', z: 'KeyZ', y: 'KeyY' }[name] || name;
    const params = { key: name, code, windowsVirtualKeyCode: codes[name], modifiers: (shift ? 8 : 0) | (ctrl ? 2 : 0) };
    await app.cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(text ? { text } : {}) });
    await app.cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}

const type = (text) => app.cdp.request('Input.insertText', { text });
const undo = () => key('z', { ctrl: true });
const redo = () => key('z', { ctrl: true, shift: true });
const command = (name, payload) => run(`window.runPisiTaskCommand(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);
const flush = () => run('(async () => { await window.flushPisiTaskTitles?.(); return window.flushPisiPendingSaves?.(); })()');

async function createNote() {
    const before = new Set(await fs.readdir(projectPath));
    assert(await run("(() => { const b = document.getElementById('add-node-btn'); b?.click(); return Boolean(b); })()"), 'Add Node button');
    const notePath = await waitUntil('new note file', async () => {
        const created = (await fs.readdir(projectPath)).find((name) => name.endsWith('.node') && !before.has(name));
        return created ? path.join(projectPath, created) : null;
    });
    await waitUntil('tree item', () =>
        run(`Array.from(document.querySelectorAll('.tree-node[data-path]')).some((n) => n.dataset.path === ${JSON.stringify(notePath)})`)
    );
    return { path: notePath, id: (await readJson(notePath)).pisi.id };
}

async function openNote(notePath) {
    await run(
        `(() => { const node = Array.from(document.querySelectorAll('.tree-node[data-path]')).find((n) => n.dataset.path === ${JSON.stringify(
            notePath
        )}); node?.querySelector(':scope > .tree-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })); })()`
    );
    await waitUntil('editor for ' + notePath, () =>
        run(`window.activeCenterNode?.path === ${JSON.stringify(notePath)} && document.getElementById('center-node-editor')?.hidden === false`)
    );
}

async function openDiary(day) {
    await run(`window.openPisiDiaryForDate(${JSON.stringify(day)})`);
    await waitUntil('diary ' + day, () => run(`window.activeCenterNode?.metadata?.diaryDate === ${JSON.stringify(day)}`));
    await waitUntil('diary section drawn', () => run(`Boolean(${EDITOR}.querySelector(':scope > .pisi-diary-tasks .pisi-diary-task-add'))`));
}

/** Sets the open note's content and puts the caret in block `index` at `offset` (or the end). */
async function setNote(html, index = 0, offset = null) {
    await run(`(() => {
        const editor = ${EDITOR};
        window.setPisiEditorContent(editor, ${JSON.stringify(html)});
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.focus();
        const block = editor.children[${index}];
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        const text = walker.nextNode();
        const range = document.createRange();
        if (text) range.setStart(text, ${offset === null ? 'text.length' : offset});
        else range.setStart(block, 0);
        range.collapse(true);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        return true;
    })()`);
    await flush();
}

/** Puts the caret in the title of task `taskId` at `offset` (null: the end). */
async function focusTitle(taskId, offset = null) {
    return run(`(() => {
        const field = ${EDITOR}.querySelector('[data-pisi-task-title="${taskId}"]');
        if (!field) return false;
        field.focus();
        const text = field.firstChild;
        const range = document.createRange();
        if (text) range.setStart(text, ${offset === null ? 'text.length' : offset});
        else range.setStart(field, 0);
        range.collapse(true);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        return document.activeElement === field;
    })()`);
}

const editorBlocks = () =>
    run(`Array.from(${EDITOR}.children).map((block) => ({
        type: block.dataset.pisiBlockType,
        taskId: block.dataset.pisiTaskId || null,
        pending: Boolean(block.dataset.pisiTaskPending),
        text: block.matches('.pisi-task-block') ? (block.querySelector('[data-pisi-task-title]')?.textContent ?? '') : block.textContent
    }))`);
const caretBlockId = () =>
    run(
        `(() => { const node = window.getSelection().anchorNode; const element = node?.nodeType === 1 ? node : node?.parentElement; return element?.closest('.pisi-editor-block')?.dataset.pisiBlockId ?? null; })()`
    );
const activeTitle = () => run(`document.activeElement?.dataset?.pisiTaskTitle ?? null`);
const noteTaskBlocks = async (notePath) => listPisiTaskBlocks((await readJson(notePath)).content);

async function waitTitle(taskId, title) {
    return waitUntil(`title "${title}" in tasks.json`, async () => (await storedTask(projectPath, taskId))?.title === title);
}

async function waitSettled() {
    await waitUntil('no task block being made', () => run(`!${EDITOR}.querySelector('.pisi-task-pending, .pisi-diary-task-pending')`));
    await flush();
}

try {
    await fs.mkdir(projectPath, { recursive: true });
    app = await pisi.launch(projectPath);
    const today = await run('window.getPisiTaskToday()');
    const note = await createNote();
    await openNote(note.path);

    // S13 · `[ ]` and a space make a task; the title is typed into it (S14).
    await setNote(
        '<div class="pisi-editor-block" data-pisi-block-id="blk_intro" data-pisi-block-type="paragraph">Giriş</div><div class="pisi-editor-block" data-pisi-block-id="blk_s13" data-pisi-block-type="paragraph">[ ]</div>',
        1
    );
    const madeAt = Date.now();
    await key(' ', { text: ' ' });
    await type('Rap');
    await type('or yaz');
    await waitUntil('the task has its id', () => run(`Boolean(${EDITOR}.querySelector('.pisi-task-block[data-pisi-task-id]'))`));
    timings.createMs = Date.now() - madeAt;
    await waitSettled();
    let blocks = await editorBlocks();
    const first = blocks[1];
    assert(first.type === 'task' && first.taskId && first.text === 'Rapor yaz', 'S13: `[ ]` made a task with the typed title', blocks);
    assert((await activeTitle()) === first.taskId, 'S13: the caret is in the new title');
    await waitTitle(first.taskId, 'Rapor yaz');
    {
        const saved = await readJson(note.path);
        const found = listPisiTaskBlocks(saved.content).find((block) => block.taskId === first.taskId);
        assert(found, 'S14: the note has the block');
        assert(
            saved.content.slice(found.start, found.end) === makePisiTaskBlockHtml({ blockId: found.blockId, taskId: first.taskId }),
            'S14: the saved block is the bare §3.2.1 form',
            saved.content
        );
        assert(!saved.content.includes('Rapor yaz'), 'S14: the title is not in the note file');
        const task = await storedTask(projectPath, first.taskId);
        assert(task.noteId === note.id && !task.diaryDate, 'S13: the task lives in the note', task);
    }
    // A title change reads and writes no .node (GV5).
    {
        await focusTitle(first.taskId);
        const { io } = await countNodeIo(app, async () => {
            const typedAt = Date.now();
            await type(' bugün');
            await waitTitle(first.taskId, 'Rapor yaz bugün');
            timings.titleToFileMs = Date.now() - typedAt;
            await sleep(300);
        });
        assert(io.reads.length === 0 && io.writes.length === 0, 'S14: typing a title touches no .node', io);
    }
    await assertIntegrityClean(app, 'S13/S14 `[ ]`');

    // Enter splits a title into a new task below; Enter at the end opens an empty one (§1.3).
    await focusTitle(first.taskId, 'Rapor'.length);
    await key('Enter');
    await waitSettled();
    blocks = await editorBlocks();
    const second = blocks[2];
    assert(blocks[1].text === 'Rapor' && second.type === 'task' && second.text === 'yaz bugün', 'Enter splits the title into a new task', blocks);
    assert((await activeTitle()) === second.taskId, 'the caret is in the new task');
    await waitTitle(first.taskId, 'Rapor');
    await waitTitle(second.taskId, 'yaz bugün');
    await focusTitle(second.taskId);
    await key('Enter');
    await waitSettled();
    blocks = await editorBlocks();
    const third = blocks[3];
    assert(third.type === 'task' && third.text === '' && (await activeTitle()) === third.taskId, 'Enter at the end opens an empty task', blocks);
    await type('Üçüncü');
    await waitTitle(third.taskId, 'Üçüncü');

    // Backspace at the start of a title moves to the block before; a paragraph never joins a task block.
    await focusTitle(first.taskId, 0);
    await key('Backspace');
    assert(
        (await caretBlockId()) === 'blk_intro' && !(await activeTitle()),
        'Backspace at the start of a title goes to the block before',
        await caretBlockId()
    );
    assert((await editorBlocks()).length === 4 && (await storedTask(projectPath, first.taskId)).title === 'Rapor', 'Backspace at the start changed nothing');
    await key('ArrowDown');
    assert((await activeTitle()) === first.taskId, 'ArrowDown from the paragraph... or the title moves on');
    await key('ArrowDown');
    assert((await activeTitle()) === second.taskId, 'ArrowDown in a title goes to the next block');
    await key('ArrowUp');
    assert((await activeTitle()) === first.taskId, 'ArrowUp in a title goes to the block before');

    // An empty task: Enter makes it a paragraph; the save sends the task to the Trash; undo brings it back (S6, G3.6).
    await focusTitle(third.taskId);
    await run(
        `(() => { const f = ${EDITOR}.querySelector('[data-pisi-task-title="${third.taskId}"]'); f.textContent = ''; f.dispatchEvent(new InputEvent('input', { bubbles: true })); return true; })()`
    );
    await waitTitle(third.taskId, '');
    await key('Enter');
    await flush();
    blocks = await editorBlocks();
    assert(blocks.length === 4 && blocks[3].type === 'paragraph', 'Enter on an empty task makes a paragraph', blocks);
    await waitUntil('the empty task went to the Trash', async () => !(await storedTask(projectPath, third.taskId)));
    await undo();
    await flush();
    await waitUntil('undo brings the task back', async () => Boolean(await storedTask(projectPath, third.taskId)));
    assert((await editorBlocks())[3].taskId === third.taskId, 'undo brings the block back');
    await redo();
    await flush();
    await waitUntil('redo sends it to the Trash again', async () => !(await storedTask(projectPath, third.taskId)));
    await assertIntegrityClean(app, 'Enter, Backspace, undo');

    // The checkbox completes; undo reopens and redo completes again, with no .node written (GV5).
    {
        const { io } = await countNodeIo(app, async () => {
            await run(`${EDITOR}.querySelector('[data-pisi-task-check="${first.taskId}"]').click()`);
            await waitUntil('done', async () => (await storedTask(projectPath, first.taskId)).status === 'done');
            await focusTitle(first.taskId);
            await undo();
            await waitUntil('undo reopens', async () => (await storedTask(projectPath, first.taskId)).status === 'todo');
            await focusTitle(first.taskId);
            await redo();
            await waitUntil('redo completes', async () => (await storedTask(projectPath, first.taskId)).status === 'done');
        });
        assert(io.writes.filter((file) => file === note.path).length === 0, 'completing and undoing it writes no note', io);
    }
    // Undo of a typed title gives the earlier title back (one step for the typing).
    await focusTitle(second.taskId);
    await type(' acil');
    await waitTitle(second.taskId, 'yaz bugün acil');
    await undo();
    await waitTitle(second.taskId, 'yaz bugün');
    assert(
        (await run(`${EDITOR}.querySelector('[data-pisi-task-title="${second.taskId}"]').textContent`)) === 'yaz bugün',
        'the field shows the earlier title'
    );
    await assertIntegrityClean(app, 'checkbox and title undo');

    // S13 · the slash command, the block type and the toolbar make tasks too.
    await setNote('<div class="pisi-editor-block" data-pisi-block-id="blk_slash" data-pisi-block-type="paragraph"><br></div>');
    await type('/todo');
    await waitUntil('slash menu', () => run(`Boolean(document.querySelector('#pisi-tag-menu:not([hidden]) .pisi-unified-command-option'))`));
    await key('Enter');
    await waitSettled();
    blocks = await editorBlocks();
    assert(blocks[0].type === 'task' && blocks[0].taskId && blocks[0].text === '', 'S13: /todo made a task', blocks);
    await type('Slash görevi');
    await waitTitle(blocks[0].taskId, 'Slash görevi');
    await setNote('<div class="pisi-editor-block" data-pisi-block-id="blk_type" data-pisi-block-type="paragraph">Paragraf <b>görevi</b></div>');
    await run(`window.applyPisiBlockType(${EDITOR}.firstElementChild, 'task')`);
    await waitSettled();
    blocks = await editorBlocks();
    assert(blocks[0].type === 'task' && blocks[0].text === 'Paragraf görevi', 'S13: the block type makes a task of the text', blocks);
    await waitTitle(blocks[0].taskId, 'Paragraf görevi');
    await setNote('<div class="pisi-editor-block" data-pisi-block-id="blk_tool" data-pisi-block-type="paragraph">Araç çubuğu</div>');
    await run(`document.querySelector('#center-node-editor [data-pisi-todo-trigger], [data-pisi-todo-trigger]')?.click()`);
    await waitSettled();
    blocks = await editorBlocks();
    assert(blocks[0].type === 'task' && blocks[0].text === 'Araç çubuğu', 'S13: the toolbar button makes a task', blocks);
    await waitTitle(blocks[0].taskId, 'Araç çubuğu');
    await assertIntegrityClean(app, 'S13 slash, type, toolbar');

    // S15 · copy and paste copies a task (new id); cut and paste into another note moves it (same id).
    const clip = (kind) =>
        run(`(() => {
            const editor = ${EDITOR};
            const block = editor.querySelector('.pisi-task-block[data-pisi-task-id]');
            const range = document.createRange();
            range.selectNode(block);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            editor.focus();
            const data = new DataTransfer();
            block.dispatchEvent(new ClipboardEvent(${JSON.stringify(kind)}, { clipboardData: data, bubbles: true, cancelable: true }));
            return Object.fromEntries(data.types.map((type) => [type, data.getData(type)]));
        })()`);
    const pasteInto = (data) =>
        run(`(() => {
            const editor = ${EDITOR};
            editor.focus();
            const last = Array.from(editor.children).filter((child) => !child.matches('.pisi-diary-tasks')).at(-1);
            const range = document.createRange();
            range.selectNodeContents(last);
            range.collapse(false);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            const data = new DataTransfer();
            for (const [type, value] of Object.entries(${JSON.stringify(data)})) data.setData(type, value);
            last.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
            return true;
        })()`);
    const toolTaskId = blocks[0].taskId;
    await setNote(
        `<div class="pisi-editor-block" data-pisi-block-id="blk_c1" data-pisi-block-type="paragraph">Kopya</div>` +
            makePisiTaskBlockHtml({ blockId: 'blk_c2', taskId: toolTaskId }) +
            `<div class="pisi-editor-block" data-pisi-block-id="blk_c3" data-pisi-block-type="paragraph"><br></div>`
    );
    {
        const copied = await clip('copy');
        assert(
            copied['application/x-pisi-tasks'] && /- \[ \] Araç çubuğu/.test(copied['text/plain']),
            'S15: the clipboard carries the record and the text',
            copied
        );
        await pasteInto(copied);
        await waitSettled();
        const ids = (await editorBlocks()).filter((block) => block.type === 'task').map((block) => block.taskId);
        assert(ids.length === 2 && ids[0] === toolTaskId && ids[1] !== toolTaskId, 'S15: copy and paste makes a new task', ids);
        assert((await storedTask(projectPath, ids[1]))?.title === 'Araç çubuğu', 'S15: the copy has the title');
        await run(`window.duplicatePisiBlock(${EDITOR}.querySelector('[data-pisi-task-id="${toolTaskId}"]'))`);
        await waitSettled();
        const afterDuplicate = (await editorBlocks()).filter((block) => block.type === 'task').map((block) => block.taskId);
        assert(new Set(afterDuplicate).size === 3, 'duplicating a task block copies the task', afterDuplicate);
    }
    await assertIntegrityClean(app, 'S15 copy');
    const otherNote = await createNote();
    await openNote(note.path);
    {
        const cut = await clip('cut');
        await waitUntil('cut: the task is in the Trash', async () => !(await storedTask(projectPath, toolTaskId)));
        await openNote(otherNote.path);
        await setNote('<div class="pisi-editor-block" data-pisi-block-id="blk_o1" data-pisi-block-type="paragraph">Başka not</div>');
        await pasteInto(cut);
        await waitSettled();
        await waitUntil('cut and paste: the task is back', async () => (await storedTask(projectPath, toolTaskId))?.noteId === otherNote.id);
        assert(
            (await noteTaskBlocks(otherNote.path)).some((block) => block.taskId === toolTaskId),
            'S15: the block is in the other note'
        );
        assert(!(await noteTaskBlocks(note.path)).some((block) => block.taskId === toolTaskId), 'S15: the block left the first note');
    }
    await assertIntegrityClean(app, 'S15 cut');

    // Find and replace changes titles in tasks.json, as one undo step (G3.8).
    {
        const findTaskId = (await editorBlocks()).find((block) => block.type === 'task').taskId;
        await run(`(() => {
            ${EDITOR}.focus();
            window.openPisiFind({ replace: true });
            const bar = document.querySelector('.pisi-find-bar');
            const input = bar.querySelector('[data-pisi-find-input]');
            input.value = 'çubuğu';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            bar.querySelector('[data-pisi-find-replace-input]').value = 'menüsü';
            return window.pisiFindState.matches.length;
        })()`);
        assert((await run('window.pisiFindState.matches.length')) === 1, 'the find bar finds the task title');
        await run('window.replacePisiFindAll()');
        await waitTitle(findTaskId, 'Araç menüsü');
        await run('window.closePisiFind()');
        await focusTitle(findTaskId);
        await undo();
        await waitTitle(findTaskId, 'Araç çubuğu');
    }
    await assertIntegrityClean(app, 'find and replace');

    // A chip opens its window; the date lands in tasks.json and the day's diary gets the task (§3.3).
    {
        const chipTaskId = (await editorBlocks()).find((block) => block.type === 'task').taskId;
        const later = addDays(today, 3);
        await run(`${EDITOR}.querySelector('[data-pisi-task-chip="date"][data-pisi-task-chip-for="${chipTaskId}"]').click()`);
        await waitUntil('date window', () => run(`Boolean(document.querySelector('.pisi-task-popover[data-pisi-task-popover="date"]'))`));
        const { io } = await countNodeIo(app, async () => {
            await run(`(() => {
                const pop = document.querySelector('.pisi-task-popover');
                pop.querySelector('input[type="date"]').value = ${JSON.stringify(later)};
                pop.querySelector('.pisi-task-popover-primary').click();
                return true;
            })()`);
            await waitUntil('due date', async () => (await storedTask(projectPath, chipTaskId))?.dueDate === later);
        });
        const written = io.writes.filter((file) => file.endsWith('.node'));
        assert(
            written.every((file) => file.endsWith(`${later}.node`)),
            "only the day's diary is written",
            written
        );
        const section = readPisiDiaryTaskSection((await readJson(diaryPath(projectPath, later))).content);
        assert(section.taskIds.includes(chipTaskId), 'the diary of the due day lists the task', section);
    }
    await assertIntegrityClean(app, 'chips');

    // Tasks of this note without a block: the notice offers to add them at the end (§3.3).
    {
        const homelessId = (await editorBlocks()).find((block) => block.type === 'task').taskId;
        await run(`(() => {
            const editor = ${EDITOR};
            editor.querySelector('[data-pisi-task-id="${homelessId}"]').remove();
            window.updatePisiTaskHomelessNotice(editor, { allowShow: true });
            return true;
        })()`);
        const text = await run(`document.querySelector('.pisi-task-homeless span')?.textContent`);
        assert(/1/.test(String(text)), 'the notice counts the task without a block', text);
        await run(`document.querySelector('.pisi-task-homeless-add').click()`);
        await waitUntil('the block is back at the end', async () => (await noteTaskBlocks(otherNote.path)).some((block) => block.taskId === homelessId));
        assert(!(await run(`Boolean(document.querySelector('.pisi-task-homeless'))`)), 'the notice is gone');
    }
    await assertIntegrityClean(app, 'homeless notice');
    const elsewhere = (await command('task.create.v1', { task: { title: 'Notta, bugün', dueDate: today }, target: { noteId: note.id, notePath: note.path } }))
        .task;
    const late = (
        await command('task.create.v1', { task: { title: 'Geciken', dueDate: addDays(today, -2) }, target: { noteId: note.id, notePath: note.path } })
    ).task;
    const cutForDiary = await clip('cut');
    const movedId = (await editorBlocks()).length ? JSON.parse(cutForDiary['application/x-pisi-tasks']).tasks[0].id : null;
    await flush();

    // S12 · in a diary `[ ]` makes a task of that day; it goes into the day's section; no title in the file.
    await openDiary(today);
    const diaryEditorFirstBlock = async (text) =>
        run(`(() => {
            const editor = ${EDITOR};
            const block = editor.querySelector(':scope > .pisi-editor-block:not(.pisi-diary-tasks)');
            block.textContent = ${JSON.stringify(text)};
            editor.focus();
            const range = document.createRange();
            range.setStart(block.firstChild, block.firstChild.length);
            range.collapse(true);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            return true;
        })()`);
    await diaryEditorFirstBlock('[ ]');
    await key(' ', { text: ' ' });
    await type('Günlükte görev');
    await waitSettled();
    const diaryTaskId = await activeTitle();
    assert(diaryTaskId, 'S12: the caret is in the new row');
    await waitTitle(diaryTaskId, 'Günlükte görev');
    {
        const task = await storedTask(projectPath, diaryTaskId);
        assert(task.diaryDate === today && task.dueDate === today && !task.noteId, 'S12: the task lives in the diary, due that day', task);
        await flush();
        const content = (await readJson(diaryPath(projectPath, today))).content;
        const section = readPisiDiaryTaskSection(content);
        assert(section.count === 1 && section.last && section.taskIds.includes(diaryTaskId), 'S12: the diary section lists it', section);
        assert(
            !content.includes('Günlükte görev') && !content.includes('Görevler') && !content.includes('[ ]'),
            'S12: no title or heading in the file',
            content
        );
        assert(section.taskIds.includes(elsewhere.id), 'a task of another note due today is in the section');
        assert(await run(`Boolean(${EDITOR}.querySelector('.pisi-diary-overdue [data-pisi-task-row="${late.id}"]'))`), "today's diary shows the overdue task");
        assert(!section.taskIds.includes(late.id), 'the overdue group is not written');
    }
    // Enter in a row makes another task of the day; the add field too.
    await focusTitle(diaryTaskId);
    await key('Enter');
    await waitSettled();
    const secondDiaryId = await activeTitle();
    assert(secondDiaryId && secondDiaryId !== diaryTaskId, 'Enter in a diary row opens a new task of the day');
    await type('İkinci');
    await waitTitle(secondDiaryId, 'İkinci');
    assert((await storedTask(projectPath, secondDiaryId)).diaryDate === today, 'the new task lives in the diary');
    await run(`(() => { const f = ${EDITOR}.querySelector('[data-pisi-task-add]'); f.focus(); return true; })()`);
    await type('Ekleme satırı');
    await key('Enter');
    await waitUntil('the add field made a task', async () =>
        (await storedTasks(projectPath)).some((task) => task.title === 'Ekleme satırı' && task.diaryDate === today)
    );
    // An empty row of this diary: Backspace sends its task to the Trash; undo brings it back.
    await focusTitle(secondDiaryId);
    await run(
        `(() => { const f = ${EDITOR}.querySelector('[data-pisi-task-title="${secondDiaryId}"]'); f.textContent = ''; f.dispatchEvent(new InputEvent('input', { bubbles: true })); return true; })()`
    );
    await waitTitle(secondDiaryId, '');
    await key('Backspace');
    await waitUntil('the empty diary task went to the Trash', async () => !(await storedTask(projectPath, secondDiaryId)));
    await run(`${EDITOR}.focus()`);
    await focusTitle(diaryTaskId);
    await undo();
    await waitUntil('undo brings the diary task back', async () => Boolean(await storedTask(projectPath, secondDiaryId)));
    // A row of another note is not deleted from the keyboard; its menu takes it off this day (§1.4).
    await focusTitle(elsewhere.id, 0);
    await key('Backspace');
    assert(Boolean(await storedTask(projectPath, elsewhere.id)), 'Backspace keeps a task of another note');
    await run(`${EDITOR}.querySelector('[data-pisi-task-menu="${elsewhere.id}"]').click()`);
    await waitUntil('row menu', () => run(`Boolean(document.querySelector('.pisi-task-popover[data-pisi-task-popover="menu"]'))`));
    await run(`Array.from(document.querySelectorAll('.pisi-task-popover-option')).find((b) => b.textContent === window.pisiT('Bu günden kaldır')).click()`);
    await waitUntil('taken off the day', async () => (await storedTask(projectPath, elsewhere.id)).dueDate === null);
    await waitUntil(
        'the row left the section',
        async () => !(await run(`Boolean(${EDITOR}.querySelector(':scope > .pisi-diary-tasks > [data-pisi-task-row="${elsewhere.id}"]'))`))
    );
    // Cut from a note and pasted into a diary: the task now lives in the diary (same id).
    if (movedId) {
        await pasteInto(cutForDiary);
        await waitUntil('the cut task lives in the diary', async () => (await storedTask(projectPath, movedId))?.diaryDate === today);
        await flush();
        assert(!listPisiTaskBlocks((await readJson(diaryPath(projectPath, today))).content).length, 'the diary has no task block');
        assert(readPisiDiaryTaskSection((await readJson(diaryPath(projectPath, today))).content).taskIds.includes(movedId), 'the section lists the moved task');
    }
    // A sync turn updates the open diary block by block: the task section is never merged, it is drawn by its rule (GV15, G3.9).
    {
        const outcome = await run(`(() => {
            const editor = ${EDITOR};
            const local = window.getPisiEditorContent(editor);
            const first = editor.querySelector(':scope > .pisi-editor-block:not(.pisi-diary-tasks)');
            const id = first.dataset.pisiBlockId;
            const template = document.createElement('template');
            template.innerHTML = local;
            const remoteFirst = template.content.querySelector('[data-pisi-block-id="' + id + '"]');
            remoteFirst.textContent = 'Uzaktan gelen metin';
            template.content.querySelector('.pisi-diary-tasks')?.remove();
            const remote = template.innerHTML;
            const result = window.applyPisiSyncRemoteNoteBlocks(editor, local, local, remote);
            window.renderPisiTaskBlocksIn(editor);
            const section = editor.querySelector(':scope > .pisi-diary-tasks');
            return { ok: result.ok, conflicts: result.conflicts, text: editor.querySelector('[data-pisi-block-id="' + id + '"]')?.textContent, last: editor.lastElementChild === section, rows: section?.querySelectorAll(':scope > [data-pisi-task-row]').length };
        })()`);
        assert(outcome.ok && !outcome.conflicts.length && outcome.text === 'Uzaktan gelen metin', 'sync: the paragraph is updated in place', outcome);
        assert(outcome.last && outcome.rows >= 3, 'sync: the section stays, drawn from tasks.json', outcome);
        await run(`${EDITOR}.dispatchEvent(new Event('input', { bubbles: true }))`);
        await flush();
    }
    await assertIntegrityClean(app, 'S12 diary');

    // S18 · an earlier completion is locked; the latest one is taken back (§3.2.3 steps 3–4).
    {
        const yesterday = addDays(today, -1);
        const repeat = (await command('task.create.v1', { task: { title: 'Spor', repeat: 'daily', dueDate: yesterday }, target: { diaryDate: yesterday } }))
            .task;
        await app.main.evaluate(`(setPisiTaskServiceClock(() => new Date(${JSON.stringify(yesterday + 'T12:00:00')})), true)`, { page: false });
        assert((await command('task.complete.v1', { taskId: repeat.id }))?.ok, 'S18: completed yesterday');
        await app.main.evaluate('(setPisiTaskServiceClock(null), true)', { page: false });
        assert((await command('task.complete.v1', { taskId: repeat.id }))?.ok, 'S18: completed today');
        let stored = await storedTask(projectPath, repeat.id);
        assert(stored.completions.length === 2 && stored.dueDate === addDays(today, 1), 'S18: two completions, due tomorrow', stored);
        await openDiary(yesterday);
        const lockedBox = `${EDITOR}.querySelector('[data-pisi-task-check="${repeat.id}"]')`;
        assert(
            (await run(`${lockedBox}.getAttribute('aria-disabled')`)) === 'true' && (await run(`${lockedBox}.textContent`)) === '☑',
            'S18: yesterday is ☑ and locked'
        );
        await run(`${lockedBox}.click()`);
        await sleep(300);
        assert((await storedTask(projectPath, repeat.id)).completions.length === 2, 'S18: a locked completion is not taken back');
        await openDiary(today);
        assert((await run(`${lockedBox}.getAttribute('aria-disabled')`)) !== 'true', 'S18: today is the latest completion');
        await run(`${lockedBox}.click()`);
        await waitUntil('S18: the latest completion is taken back', async () => (await storedTask(projectPath, repeat.id)).completions.length === 1);
        stored = await storedTask(projectPath, repeat.id);
        assert(stored.dueDate === today, 'S18: due today again', stored);
    }
    await assertIntegrityClean(app, 'S18');

    console.log(
        '[E2E] Task editor passed: S12–S15, S18; making, titles, keys, undo, clipboard, find and replace, chips; no .node for a title; Integrity clean after each scenario. Timings: ' +
            JSON.stringify(timings)
    );
} catch (error) {
    console.error(pisi.logs().slice(-6000));
    throw error;
} finally {
    await pisi.stop();
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}
