import test from 'node:test';
import assert from 'node:assert/strict';
import { getNotePlainText, splitNoteBlocks } from '../shared/note-blocks.mjs';
import { makePisiTaskBlockHtml } from '../shared/task-blocks.mjs';
import { makePisiDiaryTaskSectionHtml } from '../shared/task-diary.mjs';

const paragraph = (id, text) => `<div class="pisi-editor-block" data-pisi-block-id="${id}">${text}</div>`;
// Old markup (before version 2): a task block found by its inner tags, and the managed diary section.
const OLD_TASK =
    '<div class="pisi-editor-block" data-pisi-block-id="blk_old" data-pisi-task-id="task_old1"><span class="pisi-todo-source" data-pisi-todo-for="todo.2.none">Eski</span> <span class="pisi-user-tag" data-pisi-tag="todo.2.none">todo.2.none</span></div>';

test('görev bloğu korumalı bir "task" parçasıdır ve görev kimliğini taşır', () => {
    const block = makePisiTaskBlockHtml({ blockId: 'blk_t', taskId: 'task_aaaa' });
    const [segment] = splitNoteBlocks(block);
    assert.deepEqual([segment.blockType, segment.editable, segment.taskId, segment.blockId], ['task', false, 'task_aaaa', 'blk_t']);
    const [old] = splitNoteBlocks(OLD_TASK);
    assert.deepEqual([old.blockType, old.taskId], ['task', undefined], 'eski işaret görev kimliği vermez');
});

test('günlük görev bölümü korumalı bir "diary-tasks" parçasıdır; metne girmez', () => {
    const section = makePisiDiaryTaskSectionHtml('2026-11-21', ['task_aaaa', 'task_bbbb']);
    const html = `${paragraph('blk_a', 'Sabah yürüyüşü')}${makePisiTaskBlockHtml({ blockId: 'blk_t', taskId: 'task_cccc' })}${section}`;
    const segments = splitNoteBlocks(html);
    assert.equal(segments.map((segment) => segment.html).join(''), html);
    const last = segments.at(-1);
    assert.deepEqual(
        [last.blockType, last.editable, last.taskIds, last.blockId],
        ['diary-tasks', false, ['task_aaaa', 'task_bbbb'], 'blk_diary-tasks-2026-11-21']
    );
    assert.equal(getNotePlainText(html), 'Sabah yürüyüşü');
});
