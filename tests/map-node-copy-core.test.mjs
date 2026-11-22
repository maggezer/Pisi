// Copying a note into a map copies its tasks with new ids (docs/task-plan.md §3.3, G5, GK9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyPisiNoteTasks, makePisiCopyTitle } from '../main/functions/map-node-copy-core.js';
import { makePisiTaskBlockHtml, listPisiTaskBlocks } from '../shared/task-blocks.mjs';
import { makePisiDiaryTaskSectionHtml } from '../shared/task-diary.mjs';

const id = (n) => `task_00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const block = (n) => makePisiTaskBlockHtml({ blockId: `blk_${n}`, taskId: id(n) });

test('kopyadaki her görev bloğu yeni kimlikli bir görevin bloğu olur; alanlar kopya kuralıyla gelir', () => {
    const source = {
        id: id(1),
        title: 'Rapor',
        status: 'done',
        priority: 5,
        dueDate: '2026-11-25',
        repeat: 'weekly',
        noteId: 'node_src',
        dependencies: [id(3)],
        completions: [{ date: '2026-11-18', dueDate: '2026-11-18', at: 'x' }],
        manualOrder: 7
    };
    const html = `<p>Önce</p>${block(1)}<p>Sonra</p>`;
    let next = 10;
    const result = copyPisiNoteTasks(html, { tasksById: new Map([[source.id, source]]), makeTaskId: () => id(next++) });
    assert.equal(result.content, `<p>Önce</p>${makePisiTaskBlockHtml({ blockId: 'blk_1', taskId: id(10) })}<p>Sonra</p>`);
    assert.deepEqual(result.copies, [
        { id: id(10), sourceId: id(1), task: { title: 'Rapor', status: 'todo', priority: 5, dueDate: '2026-11-25', repeat: 'weekly' } }
    ]);
    // Kaynak görevin kimliği kopyada yoktur: bir görev iki notta bloğa sahip olmaz (GV7).
    assert.deepEqual(
        listPisiTaskBlocks(result.content).map((item) => item.taskId),
        [id(10)]
    );
});

test('kaydı olmayan blok ve günlüğün görev bölümü kopyaya girmez; öbür baytlar aynen kalır', () => {
    const html = `<h1>Gün</h1>${block(2)}<p>metin</p>${makePisiDiaryTaskSectionHtml('2026-11-21', [id(4)])}`;
    const result = copyPisiNoteTasks(html, { tasksById: new Map(), makeTaskId: () => assert.fail('kopya yok') });
    assert.equal(result.content, '<h1>Gün</h1><p>metin</p>');
    assert.deepEqual(result.copies, []);
    assert.equal(copyPisiNoteTasks('<p>Düz</p>', { makeTaskId: () => '' }).content, '<p>Düz</p>');
    assert.equal(copyPisiNoteTasks('<div><p>kırık', { makeTaskId: () => '' }), null);
});

test('copy titles get one "(kopya)" suffix', () => {
    assert.equal(makePisiCopyTitle('Plan'), 'Plan (kopya)');
    assert.equal(makePisiCopyTitle('Plan (kopya)'), 'Plan (kopya)');
    assert.equal(makePisiCopyTitle('  '), 'Node (kopya)');
});
