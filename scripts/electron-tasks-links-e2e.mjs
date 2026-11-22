import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assert, assertIntegrityClean, countNodeIo, createPisiTasksE2E, readJson, storedTask } from './e2e-tasks-app.mjs';

// Task tags and note links in task titles (docs/task-plan.md G6), in the real
// app over CDP:
// - tags are edited as chips in the note's task block, in the diary row and
//   in the detail window; every change writes tasks.json only, no .node (GV5);
// - the Tags panel lists tagged tasks from tasks.json and opens their place;
// - "[[" in a task title opens the link menu and puts [[Başlık]] into the
//   title; Ctrl+click on it in the note, and its button on the panel card,
//   open the note;
// - the links panel counts the task as a backlink;
// - renaming the note rewrites the notes' links and the task title in one
//   rename command.
// After every scenario Project Integrity must report nothing (GV14).

const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-electron-tasks-links-')));
const projectPath = path.join(tempRoot, 'project');
const pisi = createPisiTasksE2E({ tempRoot, port: 9291, inspectPort: 9292 });
const { waitUntil } = pisi;

let app = null;
const run = (expression) => app.cdp.evaluate(expression);
const json = (value) => JSON.stringify(value);
const EDITOR = "document.getElementById('center-node-editor-content')";

async function key(name, { ctrl = false } = {}) {
    const codes = { Enter: 13, Escape: 27, Backspace: 8 };
    const params = { key: name, code: name, windowsVirtualKeyCode: codes[name], modifiers: ctrl ? 2 : 0 };
    await app.cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(name === 'Enter' ? { text: '\r' } : {}) });
    await app.cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}

const type = (text) => app.cdp.request('Input.insertText', { text });
const flush = () => run('(async () => { await window.flushPisiTaskTitles?.(); return window.flushPisiPendingSaves?.(); })()');

async function command(name, payload) {
    const result = await run(`window.runPisiTaskCommand(${json(name)}, ${json(payload)})`);
    assert(result?.ok, name, result);
    return result;
}

/** A new note (the Add Node button) renamed to `title`; its new path and id. */
async function createNote(title) {
    const before = new Set(await fs.readdir(projectPath));
    assert(await run("(() => { const b = document.getElementById('add-node-btn'); b?.click(); return Boolean(b); })()"), 'Add Node button');
    const createdPath = await waitUntil('new note file', async () => {
        const created = (await fs.readdir(projectPath)).find((name) => name.endsWith('.node') && !before.has(name));
        return created ? path.join(projectPath, created) : null;
    });
    await closeEditors();
    const renamed = await run(`window.pisiProject.renamePisiFile(${json(createdPath)}, ${json(title)})`);
    assert(renamed?.ok, 'rename to ' + title, renamed);
    await run('window.refreshCurrentProjectTree?.()');
    await waitUntil('tree item ' + title, () =>
        run(`Array.from(document.querySelectorAll('.tree-node[data-path]')).some((n) => n.dataset.path === ${json(renamed.fullPath)})`)
    );
    return { path: renamed.fullPath, id: (await readJson(renamed.fullPath)).pisi.id };
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

async function rebuildSearchIndex() {
    await run(`(async () => { window.invalidatePisiSearchIndex?.('e2e'); await window.ensurePisiSearchIndex?.(); return true; })()`);
}

const noNodeIo = (io, label) => assert(io.reads.length === 0 && io.writes.length === 0, label + ': no .node read or write (GV5)', io);
const oneStoreWrite = (io, label) => assert(io.taskStoreWrites.length >= 1, label + ': tasks.json written', io);

/** Opens the tag window of a task's chip in `scope` and returns once its field has focus. */
async function openTagWindow(scope, taskId) {
    await run(`${scope}.querySelector('[data-pisi-task-chip="tags"][data-pisi-task-chip-for="${taskId}"]').click()`);
    await waitUntil('tag window', () => run(`document.activeElement?.classList.contains('pisi-task-tags-input') === true`));
}

async function waitTags(taskId, tags) {
    return waitUntil(`tags ${json(tags)}`, async () => json((await storedTask(projectPath, taskId))?.tags) === json(tags));
}

try {
    await fs.mkdir(projectPath, { recursive: true });
    app = await pisi.launch(projectPath);
    const today = await run('window.getPisiTaskToday()');
    await run(`window.__pisiLinkErrors = [];
        window.addEventListener('error', (event) => window.__pisiLinkErrors.push(String(event.message)));
        window.addEventListener('unhandledrejection', (event) => window.__pisiLinkErrors.push(String(event.reason?.stack || event.reason)));
        true`);

    const target = await createNote('Hedef');
    const source = await createNote('Kaynak');
    const third = await createNote('Üçüncü');
    const saved = await run(
        `window.pisiProject.saveNodeContent(${json(third.path)}, ${json(
            '<div class="pisi-editor-block" data-pisi-block-id="blk_third_1" data-pisi-block-type="paragraph" data-pisi-section-level="0">Bak: [[Hedef]]</div>'
        )})`
    );
    assert(saved?.ok !== false, 'third note content', saved);
    const task = (await command('task.create.v1', { task: { title: 'Raporu yaz' }, target: { noteId: source.id, notePath: source.path } })).task;
    await rebuildSearchIndex();
    await assertIntegrityClean(app, 'setup');

    // ---- 1. Tags in the note's task block: the chip window adds and removes; tasks.json only.
    await openNote(source.path);
    await waitUntil('task block drawn', () => run(`Boolean(${EDITOR}.querySelector('[data-pisi-task-chip="tags"][data-pisi-task-chip-for="${task.id}"]'))`));
    {
        const { io } = await countNodeIo(app, async () => {
            await openTagWindow(EDITOR, task.id);
            await type('#proje');
            await key('Enter');
            await waitTags(task.id, ['proje']);
            await type('acil');
            await key('Enter');
            await waitTags(task.id, ['proje', 'acil']);
            await run(`document.querySelector('.pisi-task-popover .pisi-task-tag-remove').click()`);
            await waitTags(task.id, ['acil']);
        });
        noNodeIo(io, 'tag chip');
        oneStoreWrite(io, 'tag chip');
        await key('Escape');
        await waitUntil('chip shows the tag', () =>
            run(`${EDITOR}.querySelector('[data-pisi-task-chip="tags"][data-pisi-task-chip-for="${task.id}"]')?.textContent === '#acil'`)
        );
        await run(`(() => { const field = document.activeElement; if (field?.blur) field.blur(); return true; })()`);
        const invalid = await run(`(async () => {
            const result = await window.runPisiTaskCommand('task.update.v1', { taskId: ${json(task.id)}, patch: { tags: ['iki kelime'] } }, { quiet: true });
            return result?.code || null;
        })()`);
        assert(invalid === 'TASK_INVALID', 'an invalid tag is refused', invalid);
        await flush();
        const content = (await readJson(source.path)).content;
        assert(!content.includes('acil'), 'the note holds no tag (GV2)', content);
    }
    await assertIntegrityClean(app, 'tags in the block');

    // ---- 2. The Tags panel lists the tagged task from tasks.json and opens its place.
    {
        await closeEditors();
        const { io } = await countNodeIo(app, async () => {
            await run(`document.querySelector('.right-panel-tab[data-right-tab="tags"]')?.click()`);
            await run('window.refreshPisiTagsPanel?.()');
            await waitUntil('tag panel with the task', () => run(`Boolean(document.querySelector('#pisi-tags-panel [data-pisi-task-id="${task.id}"]'))`));
        });
        assert(io.writes.length === 0 && io.taskStoreWrites.length === 0, 'the Tags panel writes nothing (GV3)', io);
        const picker = await run(`document.getElementById('pisi-tag-picker-button').textContent.trim()`);
        assert(picker === '#acil (1)', 'the tag counts its task', picker);
        await run(`document.querySelector('#pisi-tags-panel [data-pisi-task-id="${task.id}"]').click()`);
        await waitUntil('the task opens in its note', () => run(`window.activeCenterNode?.path === ${json(source.path)}`));
    }
    await assertIntegrityClean(app, 'Tags panel');

    // ---- 3. A diary row has the tag chip; the detail window edits tags with the rest of the form.
    {
        await closeEditors();
        const diaryTask = (await command('task.create.v1', { task: { title: 'Günlükteki iş', tags: ['ev'] }, target: { diaryDate: today } })).task;
        await run(`window.openPisiDiaryForDate(${json(today)})`);
        await waitUntil('diary row chip', () =>
            run(`${EDITOR}.querySelector('[data-pisi-task-chip="tags"][data-pisi-task-chip-for="${diaryTask.id}"]')?.textContent === '#ev'`)
        );
        const { io } = await countNodeIo(app, async () => {
            await openTagWindow(EDITOR, diaryTask.id);
            await type('market');
            await key('Enter');
            await waitTags(diaryTask.id, ['ev', 'market']);
        });
        noNodeIo(io, 'diary row tag');
        await key('Escape');
        await closeEditors();

        await run(`window.openPisiTaskDetail(${json(diaryTask.id)})`);
        await waitUntil('detail window', () => run(`Boolean(document.querySelector('.pisi-task-detail-form [data-field="tags"] .pisi-task-tags-input'))`));
        const detail = await countNodeIo(app, async () => {
            await run(`(() => {
                const form = document.querySelector('.pisi-task-detail-form');
                form.querySelector('[data-field="tags"] .pisi-task-tag-remove').click();
                const input = form.querySelector('.pisi-task-tags-input');
                input.focus();
                return true;
            })()`);
            await type('iş');
            await key('Enter');
            await run(`document.querySelector('.pisi-task-detail-form').requestSubmit()`);
            await waitTags(diaryTask.id, ['market', 'iş']);
        });
        noNodeIo(detail.io, 'detail tags');
        await waitUntil('detail closed', () => run(`!document.querySelector('.pisi-task-detail-form')`));
    }
    await assertIntegrityClean(app, 'diary and detail tags');

    // ---- 4. "[[" in the title opens the link menu; the chosen note goes in as [[Hedef]] text.
    await openNote(source.path);
    {
        const focused = await run(`(() => {
            const field = ${EDITOR}.querySelector('[data-pisi-task-title="${task.id}"]');
            field.focus();
            const range = document.createRange();
            range.setStart(field.firstChild, field.firstChild.length);
            range.collapse(true);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            return document.activeElement === field;
        })()`);
        assert(focused, 'title focused');
        const { io } = await countNodeIo(app, async () => {
            await type(' için [[Hed');
            await waitUntil('link menu with Hedef', () =>
                run(
                    `window.pisiTagMenuState?.active === true && window.pisiTagMenuState.mode === 'wiki-link' && window.pisiTagMenuState.items[0]?.title === 'Hedef'`
                )
            );
            await key('Enter');
            await waitUntil('title text', () =>
                run(`${EDITOR}.querySelector('[data-pisi-task-title="${task.id}"]').textContent === 'Raporu yaz için [[Hedef]] '`)
            );
            await run(`document.activeElement.blur()`);
            await waitUntil('title in tasks.json', async () => (await storedTask(projectPath, task.id))?.title === 'Raporu yaz için [[Hedef]]');
        });
        noNodeIo(io, 'title link');
        const blocks = await run(`${EDITOR}.querySelectorAll('.pisi-editor-block').length`);
        assert(blocks === 1, 'Enter chose the menu item; no new task was opened', blocks);
        assert(!(await run('window.pisiTagMenuState?.active')), 'the menu closed');
    }
    await assertIntegrityClean(app, 'link menu');

    // ---- 5. Ctrl+click on [[Hedef]] in the title opens the note.
    {
        const point = await run(`(() => {
            const field = ${EDITOR}.querySelector('[data-pisi-task-title="${task.id}"]');
            field.scrollIntoView({ block: 'center' });
            const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
            let text = null;
            while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('[[Hedef]]')) text = walker.currentNode;
            if (!text) return { missing: field.textContent };
            const start = text.nodeValue.indexOf('[[Hedef]]') + 3;
            const range = document.createRange();
            range.setStart(text, start);
            range.setEnd(text, start + 2);
            const rect = range.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`);
        assert(!point.missing, 'the title has the link text', point);
        // What the click lands on, for the failure message (Windows CI has failed here before).
        const probe = () =>
            run(`(async () => {
                const caret = document.caretRangeFromPoint(${point.x}, ${point.y});
                const index = await window.ensurePisiSearchIndex?.();
                const documents = index?.documents instanceof Map ? Array.from(index.documents.values()) : [];
                return {
                    point: ${json(point)},
                    viewport: [innerWidth, innerHeight, devicePixelRatio],
                    platform: navigator.userAgentData?.platform || navigator.platform,
                    hit: document.elementFromPoint(${point.x}, ${point.y})?.outerHTML.slice(0, 160) || null,
                    caret: caret ? { text: caret.startContainer.nodeValue, offset: caret.startOffset } : null,
                    hedef: documents.filter((item) => item.title === 'Hedef').map((item) => ({ id: item.metadata?.id, path: item.path })),
                    active: window.activeCenterNode?.path || null,
                    target: ${json(target.path)},
                    chooser: Boolean(document.querySelector('.pisi-wiki-chooser')),
                    toasts: Array.from(document.querySelectorAll('.pisi-toast, .pisi-notification, [role="alert"], [role="status"]')).map((item) => item.textContent).slice(-3),
                    errors: window.__pisiLinkErrors
                };
            })()`);
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
            await app.cdp.request('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1, modifiers: 2 });
        }
        await waitUntil('Hedef opened by Ctrl+click', () => run(`window.activeCenterNode?.path === ${json(target.path)}`)).catch(async (error) => {
            throw new Error(error.message + '\n' + JSON.stringify(await probe(), null, 2));
        });
    }

    // ---- 6. The links panel of Hedef counts the task as a backlink.
    {
        await run(`document.querySelector('.right-panel-tab[data-right-tab="links"]')?.click()`);
        await run('window.refreshPisiLinksPanel?.()');
        await waitUntil('backlink task', () =>
            run(`(() => {
                const item = document.querySelector('#pisi-links-panel .pisi-links-section [data-pisi-task-id="${task.id}"]');
                return Boolean(item?.querySelector('.pisi-links-type-task'));
            })()`)
        );
        const title = await run(`document.querySelector('#pisi-links-panel [data-pisi-task-id="${task.id}"] .pisi-links-item-title').textContent`);
        assert(title === 'Raporu yaz için Hedef', 'the task reads with the note title', title);
    }

    // ---- 7. The panel card shows the tags and a button that opens the linked note.
    {
        await openNote(source.path);
        await run(`document.querySelector('.right-panel-tab[data-right-tab="missions"]')?.click()`);
        const card = `document.querySelector('#pisi-missions-list [data-pisi-task-card="${task.id}"]')`;
        await waitUntil('card link', () => run(`${card}?.querySelector('.pisi-task-card-link')?.textContent === '↗ Hedef'`));
        const shown = await run(`({
            tags: ${card}.querySelector('.pisi-task-card-tags')?.textContent,
            link: ${card}.querySelector('.pisi-task-card-title .pisi-task-title-link')?.textContent
        })`);
        assert(shown.tags === '#acil' && shown.link === 'Hedef', 'the card draws tags and the link', shown);
        await run(`${card}.querySelector('.pisi-task-card-link').click()`);
        await waitUntil('Hedef opened from the card', () => run(`window.activeCenterNode?.path === ${json(target.path)}`)).catch(async (error) => {
            const state = await run(`({ active: window.activeCenterNode?.path || null, chooser: Boolean(document.querySelector('.pisi-wiki-chooser')) })`);
            throw new Error(error.message + '\n' + JSON.stringify({ ...state, target: target.path }));
        });
    }
    await assertIntegrityClean(app, 'link surfaces');

    // ---- 8. Renaming Hedef rewrites the note link and the task title in one rename command.
    {
        await closeEditors();
        const renaming = run(`window.renamePisiItemWithLinkReview(${json(target.path)}, 'Yeni Hedef')`);
        await waitUntil('rename review', () => run(`Boolean(document.getElementById('pisi-confirm-ok'))`));
        const message = await run(`document.getElementById('pisi-confirm-message').textContent`);
        assert(/Etkilenecek görev: 1/.test(message) && /Etkilenecek not: 1/.test(message), 'the review counts notes and tasks', message);
        const { io, result } = await countNodeIo(app, async () => {
            await run(`document.getElementById('pisi-confirm-ok').click()`);
            return renaming;
        });
        assert(result?.ok && result.wikiLinks?.tasks === 1, 'rename result', result);
        assert(io.taskStoreWrites.length === 1, 'one tasks.json write for the titles', io);
        const stored = await storedTask(projectPath, task.id);
        assert(stored.title === 'Raporu yaz için [[Yeni Hedef]]', 'the task title follows the rename', stored);
        const thirdContent = (await readJson(third.path)).content;
        assert(thirdContent.includes('[[Yeni Hedef]]'), 'the note link follows the rename', thirdContent);
        await waitUntil('the store has the new title', () => run(`window.getPisiTask(${json(task.id)})?.title === 'Raporu yaz için [[Yeni Hedef]]'`));
    }
    await assertIntegrityClean(app, 'rename');

    const errors = await run('window.__pisiLinkErrors');
    assert(errors.length === 0, 'no renderer errors', errors);
    console.log('Electron task tags and links E2E passed.');
} catch (error) {
    console.error(error?.stack || error);
    console.error(pisi.logs().slice(-6000));
    process.exitCode = 1;
} finally {
    await pisi.stop();
    await fs.rm(tempRoot, { recursive: true, force: true });
}
