// Pure rules for copying a note into a map (main/functions/map-node-copy.js).

import { PISI_DIARY_TASKS_BLOCK_TYPE, findPisiElements, listPisiTaskBlocks, makePisiTaskBlockHtml } from '../../shared/task-blocks.mjs';
import { makePisiTaskCopyFields } from '../../shared/task-model.mjs';

export const PISI_MAP_COPY_SUFFIX = ' (kopya)';

/**
 * The content of a note's copy and the tasks it needs (docs/task-plan.md §3.3,
 * G5): every task block of the source becomes the block of a new task with a
 * new id (`makeTaskId()`), the copy rule's fields of the source task and its
 * place in the copy. A block whose task has no record is left out (the copy
 * would point at a task that is not there), as is a diary's task section (a
 * copy is an ordinary note; the tasks of that diary stay in it). Every other
 * byte stays.
 * Returns `{ content, copies: [{ id, sourceId, task }] }`, or null when the
 * markup cannot be followed.
 */
export function copyPisiNoteTasks(content, { tasksById = new Map(), makeTaskId }) {
    const html = String(content ?? '');
    const blocks = listPisiTaskBlocks(html);
    const sections = findPisiElements(html, (attributes) => attributes['data-pisi-block-type'] === PISI_DIARY_TASKS_BLOCK_TYPE, PISI_DIARY_TASKS_BLOCK_TYPE);
    if (!blocks || !sections) return null;
    const replacements = [];
    const copies = [];
    for (const block of blocks) {
        const source = tasksById.get(block.taskId);
        if (!source || !block.blockId) {
            replacements.push({ start: block.start, end: block.end, html: '' });
            continue;
        }
        const id = makeTaskId();
        copies.push({ id, sourceId: source.id, task: makePisiTaskCopyFields(source) });
        replacements.push({ start: block.start, end: block.end, html: makePisiTaskBlockHtml({ blockId: block.blockId, taskId: id }) });
    }
    for (const section of sections) replacements.push({ start: section.start, end: section.end, html: '' });
    let result = html;
    for (const item of replacements.sort((a, b) => b.start - a.start)) result = result.slice(0, item.start) + item.html + result.slice(item.end);
    return { content: result, copies };
}

export function makePisiCopyTitle(title) {
    const base = String(title || 'Node').trim() || 'Node';
    return base.endsWith(PISI_MAP_COPY_SUFFIX) ? base : `${base}${PISI_MAP_COPY_SUFFIX}`;
}
