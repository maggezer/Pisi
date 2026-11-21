import test from 'node:test';
import assert from 'node:assert/strict';
import {
    cleanPisiTaskTitle,
    decidePisiPastedTask,
    formatPisiTaskPlainLine,
    isPisiTaskShortcutMarker,
    makePisiTaskClipboardPayload,
    makePisiTaskCopyFields,
    makePisiTaskHistoryKey,
    normalizePisiTaskTitleDraft,
    pickPisiTaskHistoryFields,
    planPisiTaskHistoryRestore,
    readPisiTaskClipboardPayload,
    splitPisiTaskTitle
} from '../renderer/tasks/pisi-task-edit-core.mjs';
import { completePisiTask, normalizePisiTask } from '../shared/task-model.mjs';

const now = new Date('2026-11-21T09:00:00.000Z');
const makeTask = (fields) => normalizePisiTask({ noteId: 'node_a', ...fields }, null, { now, makeUuid: () => '00000000-0000-4000-8000-000000000001' }).task;

test('başlık taslağı tek satırdır, kaydedilen başlık sadeleşir', () => {
    assert.equal(normalizePisiTaskTitleDraft('Rapor\nyaz\t '), 'Rapor yaz  ');
    assert.equal(cleanPisiTaskTitle('  Rapor \n  yaz  '), 'Rapor yaz');
    assert.equal(cleanPisiTaskTitle('a'.repeat(700)).length, 500);
    assert.equal(normalizePisiTaskTitleDraft('a\u200bb'), 'ab');
});

test('[ ] ve [] kısayol işaretidir; başka metin değildir', () => {
    for (const text of ['[]', '[ ]', ' [ ] ', '[\u00a0]']) assert.equal(isPisiTaskShortcutMarker(text), true, text);
    for (const text of ['[x]', '[  ]', '- [ ]', '[ ] Rapor', '']) assert.equal(isPisiTaskShortcutMarker(text), false, text);
});

test('başlık imleçten bölünür', () => {
    assert.deepEqual(splitPisiTaskTitle('Rapor yaz', 5), { before: 'Rapor', after: ' yaz' });
    assert.deepEqual(splitPisiTaskTitle('Rapor', 99), { before: 'Rapor', after: '' });
    assert.deepEqual(splitPisiTaskTitle('Rapor', -3), { before: '', after: 'Rapor' });
});

test('kopya açık görevdir ve tamamlanan günleri almaz', () => {
    const task = makeTask({ title: 'Spor', repeat: 'daily', dueDate: '2026-11-21', priority: 5 });
    assert.ok(task);
    const fields = makePisiTaskCopyFields({ ...task, status: 'done', completions: [{ date: '2026-11-20', dueDate: '2026-11-20', at: 'x' }] });
    assert.equal(fields.status, 'todo');
    assert.equal(fields.priority, 5);
    assert.equal(fields.repeat, 'daily');
    assert.equal('completions' in fields, false);
    assert.equal('id' in fields, false);
    assert.equal('noteId' in fields, false);
});

test('pano yükü okunur; bozuk metin yük değildir', () => {
    const task = makeTask({ title: 'Rapor' });
    const text = makePisiTaskClipboardPayload({ projectFolder: '/p', tasks: [task, { id: 'bozuk' }], cut: true });
    const payload = readPisiTaskClipboardPayload(text);
    assert.equal(payload.projectFolder, '/p');
    assert.equal(payload.cut, true);
    assert.deepEqual([...payload.tasks.keys()], [task.id]);
    for (const bad of ['', 'x', '{}', '{"version":2,"tasks":[]}']) assert.equal(readPisiTaskClipboardPayload(bad), null, bad);
});

test('yapıştırma kararı: kesilen görev kimliğini korur, canlı görev ve başka proje kopyalanır', () => {
    const task = makeTask({ title: 'Rapor' });
    const cut = readPisiTaskClipboardPayload(makePisiTaskClipboardPayload({ projectFolder: '/p', tasks: [task], cut: true }));
    const copied = readPisiTaskClipboardPayload(makePisiTaskClipboardPayload({ projectFolder: '/p', tasks: [task] }));
    const decide = (payload, liveTask, projectFolder = '/p') => decidePisiPastedTask({ taskId: task.id, payload, projectFolder, liveTask });
    assert.equal(decide(cut, null), 'keep', 'kesilen ve kaydı olmayan görev çöp kutusundan geri gelir');
    assert.equal(decide(cut, task), 'copy', 'kesilip yeniden yapıştırılan (artık canlı) görev kopyalanır');
    assert.equal(decide(copied, task), 'copy');
    assert.equal(decide(copied, null), 'copy', 'silinmiş bir görevin kopyası yeni görevdir');
    assert.equal(decide(cut, null, '/q'), 'copy', 'başka projeye her zaman yeni kimlik');
    assert.equal(decide(null, task), 'copy', 'pano yükü olmadan canlı görevin bloğu kopyadır');
    assert.equal(decide(null, null), 'drop', 'kaydı hiçbir yerde olmayan blok yapıştırılmaz');
    assert.equal(decidePisiPastedTask({ taskId: 'task_x', payload: cut, projectFolder: '/q', liveTask: null }), 'drop');
});

test('geçmiş: başlık ve alanlar tek yamada, tamamlama komutla geri alınır', () => {
    const before = makeTask({ title: 'Rapor', dueDate: '2026-11-21' });
    const done = completePisiTask(before, { now }).task;
    const renamed = { ...before, title: 'Rapor yaz', priority: 5 };
    const pick = (task, draft) => pickPisiTaskHistoryFields(task, draft);

    let plan = planPisiTaskHistoryRestore({ [before.id]: pick(renamed) }, { [before.id]: pick(before) });
    assert.deepEqual(plan.updates, [{ taskId: before.id, patch: { title: 'Rapor', priority: 3 } }]);
    assert.deepEqual(plan.reopen, []);

    plan = planPisiTaskHistoryRestore({ [before.id]: pick(done) }, { [before.id]: pick(before) });
    assert.deepEqual(plan.reopen, [{ taskId: before.id, completion: { status: 'todo' } }]);
    assert.deepEqual(plan.updates, [], 'durum alan olarak yazılmaz');

    plan = planPisiTaskHistoryRestore({ [before.id]: pick(before) }, { [before.id]: pick(done) });
    assert.deepEqual(plan.complete, [before.id]);
    assert.deepEqual(plan.updates, []);

    plan = planPisiTaskHistoryRestore({ [before.id]: pick(before, 'Rapor yaz ') }, { [before.id]: pick(before) });
    assert.deepEqual(plan.updates, [{ taskId: before.id, patch: { title: 'Rapor' } }], 'taslak başlık da adımdır');
});

test('geçmiş: tekrar eden görevde son tamamlama geri alınır, tarih alan olarak yazılmaz', () => {
    const before = makeTask({ title: 'Spor', repeat: 'daily', dueDate: '2026-11-21' });
    const after = completePisiTask(before, { now }).task;
    const plan = planPisiTaskHistoryRestore({ [before.id]: pickPisiTaskHistoryFields(after) }, { [before.id]: pickPisiTaskHistoryFields(before) });
    assert.equal(plan.reopen.length, 1);
    assert.equal(plan.reopen[0].completion.date, after.completions[0].date);
    assert.deepEqual(plan.updates, []);
    const redo = planPisiTaskHistoryRestore({ [before.id]: pickPisiTaskHistoryFields(before) }, { [before.id]: pickPisiTaskHistoryFields(after) });
    assert.deepEqual(redo.complete, [before.id]);
    assert.deepEqual(redo.updates, []);
});

test('geçmiş: kaydı olmayan görev geri gelir, adımda olmayan görev "gone" olur', () => {
    const task = makeTask({ title: 'Rapor' });
    const state = pickPisiTaskHistoryFields(task);
    assert.deepEqual(planPisiTaskHistoryRestore({ [task.id]: null }, { [task.id]: state }).restore, [task.id]);
    assert.deepEqual(planPisiTaskHistoryRestore({ [task.id]: state }, {}).gone, [task.id]);
    assert.equal(makePisiTaskHistoryKey({ b: 1, a: 2 }), makePisiTaskHistoryKey({ a: 2, b: 1 }));
    assert.equal(makePisiTaskHistoryKey(null), '');
});

test('düz metin satırı Markdown görev biçimindedir', () => {
    assert.equal(formatPisiTaskPlainLine({ title: ' Rapor ', status: 'todo' }), '- [ ] Rapor');
    assert.equal(formatPisiTaskPlainLine({ title: 'Rapor', status: 'done' }), '- [x] Rapor');
});
