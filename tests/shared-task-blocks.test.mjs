import test from 'node:test';
import assert from 'node:assert/strict';
import {
    diffPisiTaskMembership,
    findPisiElements,
    insertPisiTaskBlock,
    listPisiNoteTaskIds,
    listPisiTaskBlocks,
    makePisiTaskBlockHtml,
    removePisiTaskBlock,
    stripPisiTaskBlocks
} from '../shared/task-blocks.mjs';
import { makePisiDiaryTaskSectionHtml } from '../shared/task-diary.mjs';

const paragraph = (id, text) => `<div class="pisi-editor-block" data-pisi-block-id="${id}">${text}</div>`;
const block = (taskId, blockId = `blk_${taskId.slice(5)}`) => makePisiTaskBlockHtml({ blockId, taskId });
// Old task markup the desktop wrote before version 2 (renderer/tags/pisi-task-store.mjs).
const OLD_TASK =
    '<div class="pisi-editor-block" data-pisi-block-id="blk_old" data-pisi-task-id="task_old1"><span class="pisi-todo-source" data-pisi-todo-for="todo.2.none">Eski</span> <span class="pisi-user-tag" data-pisi-tag="todo.2.none">todo.2.none</span></div>';

test('görev bloğu §3.2.1 biçiminde ve her yerde aynı baytlarla üretilir', () => {
    assert.equal(
        makePisiTaskBlockHtml({ blockId: 'blk_1a2b', taskId: 'task_6f1c2a0e' }),
        '<div class="pisi-editor-block pisi-task-block" data-pisi-block-id="blk_1a2b" data-pisi-block-type="task" data-pisi-task-id="task_6f1c2a0e" contenteditable="false"></div>'
    );
    assert.throws(() => makePisiTaskBlockHtml({ blockId: 'blk_1', taskId: 'task_"x"' }), TypeError);
    assert.throws(() => makePisiTaskBlockHtml({ blockId: 'x"><script>', taskId: 'task_abcd' }), TypeError);
});

test('nottaki görev blokları belge sırasıyla okunur; eski görev işareti görev sayılmaz', () => {
    const html = [paragraph('blk_a', 'Giriş'), block('task_aaaa'), OLD_TASK, paragraph('blk_b', 'Son'), block('task_bbbb', 'blk_x')].join('\n');
    const blocks = listPisiTaskBlocks(html);
    assert.deepEqual(
        blocks.map((item) => [item.taskId, item.blockId]),
        [
            ['task_aaaa', 'blk_aaaa'],
            ['task_bbbb', 'blk_x']
        ]
    );
    for (const item of blocks) assert.equal(html.slice(item.start, item.end), block(item.taskId, item.blockId));
    assert.deepEqual(listPisiNoteTaskIds(html), ['task_aaaa', 'task_bbbb']);
    assert.deepEqual(listPisiTaskBlocks(OLD_TASK), []);
    assert.deepEqual(listPisiTaskBlocks(''), []);
});

test('editörün geçici çizimi kalmış blok da tanınır; içindeki iç içe öğeler ayrı sayılmaz', () => {
    const drawn = `<div class="pisi-editor-block pisi-task-block" data-pisi-block-id="blk_d" data-pisi-block-type="task" data-pisi-task-id="task_dddd" contenteditable="false"><span>☐</span><div class="pisi-task-block" data-pisi-block-type="task" data-pisi-task-id="task_inner"></div></div>`;
    assert.deepEqual(
        listPisiTaskBlocks(drawn).map((item) => [item.taskId, item.end]),
        [['task_dddd', drawn.length]]
    );
});

test('okunamayan not boş liste değil null verir; hiçbir görev silinmiş sayılmaz', () => {
    const broken = `${block('task_aaaa')}<div><span>kapanmamış</div>`;
    assert.equal(listPisiTaskBlocks(broken), null);
    assert.equal(diffPisiTaskMembership(block('task_aaaa'), broken), null);
    assert.equal(insertPisiTaskBlock(broken, { blockId: 'blk_n', taskId: 'task_nnnn' }), null);
    assert.equal(removePisiTaskBlock(broken, 'task_aaaa'), null);
    assert.equal(stripPisiTaskBlocks(broken), null);
    assert.equal(
        findPisiElements('<div', () => true),
        null
    );
});

test('üyelik farkı: eklenen, çıkan ve kalan görevler', () => {
    const before = [block('task_aaaa'), block('task_bbbb'), block('task_cccc')].join('');
    const after = [block('task_cccc'), block('task_dddd'), block('task_aaaa')].join('');
    assert.deepEqual(diffPisiTaskMembership(before, after), { added: ['task_dddd'], removed: ['task_bbbb'], kept: ['task_cccc', 'task_aaaa'] });
    assert.deepEqual(diffPisiTaskMembership('', ''), { added: [], removed: [], kept: [] });
    assert.deepEqual(diffPisiTaskMembership(after, after), { added: [], removed: [], kept: ['task_cccc', 'task_dddd', 'task_aaaa'] });
});

test('blok ekleme: verilen bloğun arkasına, yoksa sona; aynı görev ikinci kez eklenmez', () => {
    const html = `${paragraph('blk_a', 'A')}\n${paragraph('blk_b', 'B')}`;
    const task = { blockId: 'blk_t', taskId: 'task_tttt' };
    const after = insertPisiTaskBlock(html, task, { afterBlockId: 'blk_a' });
    assert.equal(after, `${paragraph('blk_a', 'A')}${block('task_tttt', 'blk_t')}\n${paragraph('blk_b', 'B')}`);
    assert.equal(insertPisiTaskBlock(html, task), `${html}${block('task_tttt', 'blk_t')}`);
    assert.equal(insertPisiTaskBlock(html, task, { afterBlockId: 'blk_yok' }), `${html}${block('task_tttt', 'blk_t')}`);
    assert.equal(insertPisiTaskBlock(after, { blockId: 'blk_other', taskId: 'task_tttt' }), after, 'bir görevin en çok bir bloğu olur');
});

test('blok kaldırma yalnız o görevin bloğunu çıkarır; öbür baytlar aynı kalır', () => {
    const html = `${paragraph('blk_a', 'A')}\n${block('task_aaaa')}\n${paragraph('blk_b', 'B &amp; C')}`;
    assert.equal(removePisiTaskBlock(html, 'task_aaaa'), `${paragraph('blk_a', 'A')}\n\n${paragraph('blk_b', 'B &amp; C')}`);
    assert.equal(removePisiTaskBlock(html, 'task_none'), html);
});

test('çakışma kopyası için görev blokları ve günlük görev bölümü çıkarılır', () => {
    const section = makePisiDiaryTaskSectionHtml('2026-11-21', ['task_aaaa']);
    const html = `${paragraph('blk_a', 'A')}${block('task_aaaa')}${OLD_TASK}${section}`;
    assert.equal(stripPisiTaskBlocks(html), `${paragraph('blk_a', 'A')}${OLD_TASK}`);
});
