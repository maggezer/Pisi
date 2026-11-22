// Tasks in exported notes and in imported Markdown (docs/task-plan.md G5, §3.6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { expandPisiTaskMarkupForExport, makePisiExportTaskRowHtml, readPisiMarkdownTaskLine } from '../main/functions/portability-tasks-core.js';
import { makePisiTaskBlockHtml } from '../shared/task-blocks.mjs';
import { makePisiDiaryTaskSectionHtml } from '../shared/task-diary.mjs';

const id = (n) => `task_00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const EN = { Görevler: 'Tasks', 'Görev bulunamadı': 'Task not found', 'Görevler okunamadı': 'Tasks could not be read', Görev: 'Task' };
const translate = (value) => EN[value] ?? value;
const block = (n, blockId = `blk_${n}`) => makePisiTaskBlockHtml({ blockId, taskId: id(n) });

test('görev bloğu kayıttan çizilir; öbür baytlar aynen kalır; başlık kaçırılır', () => {
    const html = `<p>Önce</p>${block(1)}<p>Sonra</p>${block(2)}`;
    const tasks = [
        { id: id(1), title: 'A & <b>', status: 'todo' },
        { id: id(2), title: 'Bitti', status: 'done' }
    ];
    assert.equal(
        expandPisiTaskMarkupForExport(html, { tasks, translate }),
        `<p>Önce</p>${makePisiExportTaskRowHtml('A & <b>', false)}<p>Sonra</p>${makePisiExportTaskRowHtml('Bitti', true)}`
    );
    assert.match(makePisiExportTaskRowHtml('A & <b>', false), /☐<\/span> A &amp; &lt;b&gt;<\/div>$/);
    assert.match(makePisiExportTaskRowHtml('x', true), /data-pisi-export-task="done"><span class="pisi-block-task-marker">☑/);
    // Görevi olmayan not aynen döner.
    assert.equal(expandPisiTaskMarkupForExport('<p>Düz</p>', { tasks }), '<p>Düz</p>');
});

test('kaydı olmayan blok "Görev bulunamadı", okunamayan tasks.json "Görevler okunamadı" yazar; başlıksız görev "Görev"dir', () => {
    assert.match(expandPisiTaskMarkupForExport(block(9), { tasks: [], translate }), /☐<\/span> Task not found</);
    assert.match(expandPisiTaskMarkupForExport(block(1), { tasks: [{ id: id(1), title: 'A' }], readOnly: true, translate }), /Tasks could not be read/);
    assert.match(expandPisiTaskMarkupForExport(block(1), { tasks: [{ id: id(1), title: '' }], translate }), /☐<\/span> Task</);
});

test('günlüğün görev bölümü başlık ve satırlarıyla, her görevin o gündeki durumuyla yazılır', () => {
    const day = '2026-11-21';
    const tasks = [
        {
            id: id(1),
            title: 'Spor',
            status: 'todo',
            repeat: 'daily',
            dueDate: '2026-11-22',
            completions: [{ date: day, dueDate: day, at: '2026-11-21T06:00:00.000Z' }]
        },
        { id: id(2), title: 'Fatura', status: 'todo', dueDate: day }
    ];
    const html = `<p>Günün notu</p>${makePisiDiaryTaskSectionHtml(day, [id(1), id(2)])}`;
    assert.equal(
        expandPisiTaskMarkupForExport(html, { tasks, translate }),
        `<p>Günün notu</p><h3>Tasks</h3>${makePisiExportTaskRowHtml('Spor', true)}${makePisiExportTaskRowHtml('Fatura', false)}`
    );
});

test('Markdown görev satırı okunur: - [ ], * [x], + [X]; düz madde görev değildir', () => {
    assert.deepEqual(readPisiMarkdownTaskLine('- [ ] Raporu   yaz '), { done: false, title: 'Raporu yaz' });
    assert.deepEqual(readPisiMarkdownTaskLine('* [x] Bitti'), { done: true, title: 'Bitti' });
    assert.deepEqual(readPisiMarkdownTaskLine('  + [X] Girintili'), { done: true, title: 'Girintili' });
    assert.equal(readPisiMarkdownTaskLine('- Düz madde'), null);
    assert.equal(readPisiMarkdownTaskLine('- [] Boşluksuz'), null);
});
