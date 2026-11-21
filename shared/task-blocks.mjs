// The task block of a note (docs/task-plan.md §3.2.1). A note holds a task as
// one empty block that carries only its block id and the task id; the editor
// draws the inside from tasks.json and writes the empty form back. This module
// is the only place that writes and reads that block. It works on the text of
// the note, without a DOM, and never changes a byte outside the blocks it
// adds or removes.
//
// Functions that read or edit note HTML return null when the markup cannot be
// followed (an unclosed tag): a caller then must not act on the note, since an
// unreadable note would otherwise look as if it had lost its tasks.

import { isPisiTaskId } from './ids.mjs';
import { parseTagAttributes, walkTags } from './html-tokens.mjs';

export const PISI_TASK_BLOCK_TYPE = 'task';
export const PISI_TASK_BLOCK_CLASS = 'pisi-task-block';
// The diary's task section (shared/task-diary.mjs); named here so that stripPisiTaskBlocks drops it too.
export const PISI_DIARY_TASKS_BLOCK_TYPE = 'diary-tasks';
export const PISI_DIARY_TASKS_CLASS = 'pisi-diary-tasks';

const BLOCK_ID = /^blk_[A-Za-z0-9_-]{1,160}$/;
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

export const isPisiBlockId = (value) => BLOCK_ID.test(String(value ?? ''));

const hasClass = (attributes, name) =>
    String(attributes.class || '')
        .split(/\s+/)
        .includes(name);

/**
 * Elements of `html` for which `matches(attributes, name)` is true, outermost
 * only (an element inside a match is not looked at). `hint` is a piece of
 * text the opening tag must contain before its attributes are parsed.
 * Returns `[{ name, start, end, openEnd, innerEnd, attributes }]` in document
 * order, or null when the markup cannot be followed.
 */
export function findPisiElements(html, matches, hint = '') {
    const content = String(html ?? '');
    const found = [];
    const stack = [];
    let broken = false;
    const followed = walkTags(content, (token) => {
        if (broken || token.comment) return;
        if (!token.closing) {
            if (VOID_TAGS.has(token.name) || token.selfClosing) return;
            const inside = stack.some((item) => item.match);
            const openTag = content.slice(token.start, token.end);
            const attributes = !inside && (!hint || openTag.includes(hint)) ? parseTagAttributes(openTag) : null;
            stack.push({ name: token.name, start: token.start, openEnd: token.end, attributes, match: Boolean(attributes && matches(attributes, token.name)) });
            return;
        }
        if (VOID_TAGS.has(token.name)) return;
        const top = stack.pop();
        if (!top || top.name !== token.name) {
            broken = true;
            return;
        }
        if (top.match) {
            found.push({ name: top.name, start: top.start, end: token.end, openEnd: top.openEnd, innerEnd: token.start, attributes: top.attributes });
        }
    });
    return followed && !broken && !stack.length ? found : null;
}

const isTaskBlock = (attributes) =>
    attributes['data-pisi-block-type'] === PISI_TASK_BLOCK_TYPE && hasClass(attributes, PISI_TASK_BLOCK_CLASS) && isPisiTaskId(attributes['data-pisi-task-id']);

const isDiarySection = (attributes) => attributes['data-pisi-block-type'] === PISI_DIARY_TASKS_BLOCK_TYPE && hasClass(attributes, PISI_DIARY_TASKS_CLASS);

/** The HTML of a task block, byte for byte the same on every platform. Throws on an invalid id. */
export function makePisiTaskBlockHtml({ blockId, taskId }) {
    if (!isPisiBlockId(blockId)) throw new TypeError(`invalid block id: ${blockId}`);
    if (!isPisiTaskId(taskId)) throw new TypeError(`invalid task id: ${taskId}`);
    return `<div class="pisi-editor-block ${PISI_TASK_BLOCK_CLASS}" data-pisi-block-id="${blockId}" data-pisi-block-type="${PISI_TASK_BLOCK_TYPE}" data-pisi-task-id="${taskId}" contenteditable="false"></div>`;
}

/**
 * The task blocks of a note in document order: `[{ taskId, blockId, start, end }]`.
 * Old task markup (`todo.*` tags, `data-pisi-todo-*`) is not a task block.
 * Null when the markup cannot be followed.
 */
export function listPisiTaskBlocks(html) {
    const elements = findPisiElements(html, isTaskBlock, PISI_TASK_BLOCK_CLASS);
    if (!elements) return null;
    return elements.map((element) => ({
        taskId: element.attributes['data-pisi-task-id'],
        blockId: element.attributes['data-pisi-block-id'] || null,
        start: element.start,
        end: element.end
    }));
}

/** The task ids of a note, each once, in document order; null when unreadable. */
export function listPisiNoteTaskIds(html) {
    const blocks = listPisiTaskBlocks(html);
    return blocks ? Array.from(new Set(blocks.map((block) => block.taskId))) : null;
}

/**
 * Which tasks a save added to and removed from a note (§3.3):
 * `{ added, removed, kept }`, ids in document order. Null when either
 * version cannot be read, so that nothing is taken for removed.
 */
export function diffPisiTaskMembership(before, after) {
    const old = listPisiNoteTaskIds(before);
    const next = listPisiNoteTaskIds(after);
    if (!old || !next) return null;
    const oldSet = new Set(old);
    const nextSet = new Set(next);
    return {
        added: next.filter((id) => !oldSet.has(id)),
        removed: old.filter((id) => !nextSet.has(id)),
        kept: next.filter((id) => oldSet.has(id))
    };
}

/**
 * Adds a task block after the block with id `afterBlockId`, or at the end when
 * that is not given or not found. A note that already has a block of the task
 * comes back as it is (one block per task, GV7). Null when unreadable.
 */
export function insertPisiTaskBlock(html, block, { afterBlockId = null } = {}) {
    const content = String(html ?? '');
    const blockHtml = makePisiTaskBlockHtml(block);
    const existing = listPisiTaskBlocks(content);
    if (!existing) return null;
    if (existing.some((item) => item.taskId === block.taskId)) return content;
    let at = content.length;
    if (afterBlockId) {
        const anchors = findPisiElements(content, (attributes) => attributes['data-pisi-block-id'] === afterBlockId, afterBlockId);
        if (!anchors) return null;
        if (anchors.length) at = anchors[0].end;
    }
    return content.slice(0, at) + blockHtml + content.slice(at);
}

function removeRanges(content, ranges) {
    let result = content;
    for (const range of [...ranges].sort((a, b) => b.start - a.start)) result = result.slice(0, range.start) + result.slice(range.end);
    return result;
}

/** Takes the block(s) of `taskId` out of the note; the rest stays byte for byte. Null when unreadable. */
export function removePisiTaskBlock(html, taskId) {
    const content = String(html ?? '');
    const blocks = listPisiTaskBlocks(content);
    if (!blocks) return null;
    return removeRanges(
        content,
        blocks.filter((block) => block.taskId === taskId)
    );
}

/**
 * The note without task blocks and without the diary's task section: the
 * content of a sync conflict copy (§3.3), where tasks stay in the original
 * note. Null when unreadable.
 */
export function stripPisiTaskBlocks(html) {
    const content = String(html ?? '');
    const elements = findPisiElements(content, (attributes) => isTaskBlock(attributes) || isDiarySection(attributes), 'pisi-');
    return elements ? removeRanges(content, elements) : null;
}
