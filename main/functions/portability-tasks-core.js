// Tasks in exported and imported notes (docs/task-plan.md G5, §3.6). Pure:
// no file access; the caller gives the tasks of tasks.json and the language.
//
// A note on disk holds only the id of a task (§3.2.1) and a diary only the ids
// of its task section (§3.2.2), so an export draws them from the records:
// each becomes a task row the existing converters write as `- [ ] Title` in
// Markdown and as a check box line in HTML, PDF and DOCX. An imported
// Markdown `- [ ] Title` line becomes a task of the new note; a `- [x]` line
// stays the text "☑ Title" (a done task's completion day is not known).

import {
    PISI_DIARY_TASKS_BLOCK_TYPE,
    PISI_DIARY_TASKS_CLASS,
    PISI_TASK_BLOCK_CLASS,
    PISI_TASK_BLOCK_TYPE,
    findPisiElements
} from '../../shared/task-blocks.mjs';
import { getPisiTaskStateOnDay } from '../../shared/task-diary.mjs';
import { isPisiTaskId } from '../../shared/ids.mjs';

const TASK_REF = /\sdata-pisi-task-ref="([^"]*)"/g;
const SECTION_DAY = /^blk_diary-tasks-(\d{4}-\d{2}-\d{2})$/;

const identity = (value) => String(value ?? '');

function escapePisiExportText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const hasClass = (attributes, name) =>
    String(attributes.class || '')
        .split(/\s+/)
        .includes(name);

const isTaskMarkup = (attributes) =>
    (attributes['data-pisi-block-type'] === PISI_TASK_BLOCK_TYPE &&
        hasClass(attributes, PISI_TASK_BLOCK_CLASS) &&
        isPisiTaskId(attributes['data-pisi-task-id'])) ||
    (attributes['data-pisi-block-type'] === PISI_DIARY_TASKS_BLOCK_TYPE && hasClass(attributes, PISI_DIARY_TASKS_CLASS));

/**
 * One exported task row. The box is a `pisi-block-task-marker` span (the
 * Markdown converter reads ☑ from it and drops it); its text stays in plain
 * text and DOCX.
 */
export function makePisiExportTaskRowHtml(title, done) {
    return `<div class="pisi-editor-block pisi-export-task" data-pisi-block-type="task" data-pisi-export-task="${done ? 'done' : 'todo'}"><span class="pisi-block-task-marker">${done ? '☑' : '☐'}</span> ${escapePisiExportText(title)}</div>`;
}

/**
 * The note's HTML with its task blocks and its diary task section drawn from
 * the records:
 * - `tasks`: the records of tasks.json; `readOnly`: tasks.json could not be read;
 * - `translate`: the user's language for "Görevler", "Görev bulunamadı" and "Görevler okunamadı".
 * The section's rows show each task's state on the section's day. Markup that
 * cannot be followed comes back as it is.
 */
export function expandPisiTaskMarkupForExport(html, { tasks = [], readOnly = false, translate = identity } = {}) {
    const content = String(html ?? '');
    if (!content.includes('pisi-')) return content;
    const elements = findPisiElements(content, isTaskMarkup, 'data-pisi-');
    if (!elements || !elements.length) return content;
    const byId = new Map((Array.isArray(tasks) ? tasks : []).filter((task) => task && task.id).map((task) => [task.id, task]));
    const unreadable = translate('Görevler okunamadı');
    const rowOf = (taskId, day = null) => {
        if (readOnly) return makePisiExportTaskRowHtml(unreadable, false);
        const task = byId.get(taskId);
        if (!task) return makePisiExportTaskRowHtml(translate('Görev bulunamadı'), false);
        const state = day ? getPisiTaskStateOnDay(task, day) : null;
        const done = state ? state.state === 'done' || (state.state === 'dated' && state.status === 'done') : task.status === 'done';
        return makePisiExportTaskRowHtml(task.title || translate('Görev'), done);
    };
    let result = content;
    for (const element of [...elements].reverse()) {
        const attributes = element.attributes;
        let replacement;
        if (attributes['data-pisi-block-type'] === PISI_TASK_BLOCK_TYPE) {
            replacement = rowOf(attributes['data-pisi-task-id']);
        } else {
            const day = SECTION_DAY.exec(String(attributes['data-pisi-block-id'] || ''))?.[1] || null;
            const ids = [];
            for (const match of content.slice(element.openEnd, element.innerEnd).matchAll(TASK_REF)) {
                if (isPisiTaskId(match[1]) && !ids.includes(match[1])) ids.push(match[1]);
            }
            replacement = ids.length ? `<h3>${escapePisiExportText(translate('Görevler'))}</h3>${ids.map((id) => rowOf(id, day)).join('')}` : '';
        }
        result = result.slice(0, element.start) + replacement + result.slice(element.end);
    }
    return result;
}

const TASK_LINE = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;

/**
 * Reads a Markdown task line: `{ done, title }` for `- [ ] Title` / `- [x] Title`
 * (also `*` and `+`), else null. The title is folded to one line.
 */
export function readPisiMarkdownTaskLine(line) {
    const match = TASK_LINE.exec(String(line ?? ''));
    if (!match) return null;
    const title = match[2].replace(/\s+/g, ' ').trim();
    return { done: match[1] !== ' ', title };
}
