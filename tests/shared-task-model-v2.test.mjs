import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PISI_TASK_FIELDS,
    addPisiTaskDays,
    completePisiTask,
    findPisiTaskDependencyCycle,
    getNextPisiTaskDueDate,
    getPisiLocalDay,
    getPisiTaskDaysBetween,
    getPisiTaskLatestCompletion,
    getPisiTaskLocation,
    isSamePisiTask,
    makePisiTaskStoreData,
    normalizePisiTask,
    readPisiTask,
    readPisiTaskStore,
    reopenPisiTask
} from '../shared/task-model.mjs';

// Saturday 21 November 2026, 09:52 local time.
const NOW = new Date(2026, 10, 21, 9, 52);
const LATER = new Date(2026, 10, 21, 18, 5);
const NOTE = 'node_0b6a3c1e-7d2f-4a8b-9c5e-1f2a3b4c5d6e';
let uuid = 0;
const options = (now = NOW) => ({ now, makeUuid: () => `uuid-${++uuid}` });
const create = (payload, now = NOW) => {
    const result = normalizePisiTask({ noteId: NOTE, ...payload }, null, options(now));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.task;
};
const errorsOf = (payload, existing = null) => normalizePisiTask(payload, existing, options()).errors?.map((error) => `${error.field}:${error.code}`);

test('gün hesabı takvim günüyle yapılır: yaz saati ve ay sonu günü kaydırmaz', () => {
    assert.equal(addPisiTaskDays('2026-03-28', 2), '2026-03-30');
    assert.equal(addPisiTaskDays('2026-10-24', 7), '2026-10-31');
    assert.equal(addPisiTaskDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addPisiTaskDays('2028-03-01', -1), '2028-02-29');
    assert.equal(addPisiTaskDays('2026-02-30', 1), null);
    assert.equal(getPisiTaskDaysBetween('2026-11-21', '2026-11-24'), 3);
    assert.equal(getPisiTaskDaysBetween('2026-11-24', '2026-11-21'), -3);
    assert.equal(getPisiTaskDaysBetween('yarın', '2026-11-21'), null);
    assert.equal(getPisiLocalDay(NOW), '2026-11-21');
    assert.equal(getPisiLocalDay('bozuk'), null);
});

test('yeni görev: bütün alanlar §3.1 sırasıyla, varsayılanlarla ve task_<uuid> kimliğiyle yazılır', () => {
    const task = create({ title: '  Spor \n  sabah ', dueDate: '2026-11-22', dueTime: '07:30', repeat: 'daily', priority: 4 });
    assert.deepEqual(Object.keys(task), PISI_TASK_FIELDS);
    assert.match(task.id, /^task_uuid-\d+$/);
    assert.deepEqual(task, {
        id: task.id,
        title: 'Spor sabah',
        tags: [],
        status: 'todo',
        priority: 4,
        dueDate: '2026-11-22',
        dueTime: '07:30',
        repeat: 'daily',
        completionOffsetDays: null,
        reminderMode: 'none',
        reminderAt: null,
        dependencies: [],
        manualOrder: NOW.getTime(),
        noteId: NOTE,
        diaryDate: null,
        durationMinutes: 0,
        actualMinutes: 0,
        completions: [],
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        completedAt: null,
        completedOn: null
    });
    assert.equal(create({ title: 'x'.repeat(600) }).title.length, 500, 'başlık 500 karakterde kesilir');
    assert.equal(create({ title: '' }).title, '', 'yeni yazılan görevde başlık boş olabilir');
    assert.equal(create({ id: 'task_given-id', title: 'a' }).id, 'task_given-id');
});

test('yer: yeni görevde notun ya da günlüğün tam biri gerekir; biri verilince öbürü boşalır', () => {
    assert.deepEqual(errorsOf({ title: 'Yersiz' }), ['noteId:location-required']);
    assert.deepEqual(errorsOf({ title: 'İki yer', noteId: NOTE, diaryDate: '2026-11-21' }), ['noteId:location-conflict']);
    assert.deepEqual(errorsOf({ title: 'Kötü not', noteId: 'map_abc' }), ['noteId:invalid', 'noteId:location-required']);

    const inNote = create({ title: 'Notta' });
    assert.deepEqual(getPisiTaskLocation(inNote), { kind: 'note', noteId: NOTE });
    const moved = normalizePisiTask({ diaryDate: '2026-11-21' }, inNote, options()).task;
    assert.deepEqual([moved.noteId, moved.diaryDate], [null, '2026-11-21']);
    assert.deepEqual(getPisiTaskLocation(moved), { kind: 'diary', date: '2026-11-21' });
    const back = normalizePisiTask({ noteId: NOTE }, moved, options()).task;
    assert.deepEqual([back.noteId, back.diaryDate], [NOTE, null]);
    assert.deepEqual(normalizePisiTask({ noteId: null }, back, options()).errors, [{ field: 'noteId', code: 'location-required' }]);
});

test('sürüm 1 kaydı: yeri olmadan güncellenebilir; eski ve bilinmeyen alanlar okunmaz ama korunur', () => {
    const legacy = {
        id: 'task_source_0011aabbccddeeff',
        title: 'Mobil görev',
        status: 'todo',
        priority: 2,
        dueDate: '2026-11-25',
        scheduledAt: '2026-11-24T10:00',
        deadline: '2026-11-30',
        todoTag: 'todo.2.25-11-2026',
        source: { nodePath: null, blockId: 'task-block-1', nodeTitle: 'Task' },
        futureField: { keep: true },
        createdAt: '2026-11-01T08:00:00.000Z'
    };
    assert.equal(getPisiTaskLocation(legacy), null);
    const result = normalizePisiTask({ status: 'doing' }, legacy, options());
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    for (const field of ['scheduledAt', 'deadline', 'todoTag', 'source', 'futureField', 'createdAt']) {
        assert.deepEqual(result.task[field], legacy[field], field);
    }
    assert.equal(result.task.status, 'doing');
    assert.equal(result.task.dueDate, '2026-11-25', 'günü yalnız dueDate belirler; scheduledAt okunmaz');
    assert.deepEqual(Object.keys(result.task).slice(0, Object.keys(legacy).length), Object.keys(legacy), 'diskteki alanların sırası korunur');

    const read = readPisiTask({ ...legacy, priority: 9, status: 'bitti', dependencies: ['task_self', legacy.id, 'kötü'], completions: [{ date: 'x' }] });
    assert.deepEqual([read.priority, read.status, read.dependencies, read.completions], [3, 'todo', ['task_self'], []]);
    assert.equal(readPisiTask({ id: 'bad' }), null);
    assert.equal(readPisiTask(null), null);
});

test('istenen geçersiz değer sessizce düzeltilmez, hata verir', () => {
    const task = create({ title: 'Alanlar' });
    const cases = [
        [{ status: 'bitti' }, 'status:invalid'],
        [{ priority: 6 }, 'priority:invalid'],
        [{ priority: 2.5 }, 'priority:invalid'],
        [{ dueDate: '2026-02-30' }, 'dueDate:invalid'],
        [{ dueDate: '21-11-2026' }, 'dueDate:invalid'],
        [{ dueTime: '25:00' }, 'dueTime:invalid'],
        [{ dueTime: '07:30' }, 'dueTime:time-without-date'],
        [{ repeat: 'yearly' }, 'repeat:invalid'],
        [{ reminderMode: 'hourly' }, 'reminderMode:invalid'],
        [{ reminderAt: '2026-11-21 09:00' }, 'reminderAt:invalid'],
        [{ dependencies: ['nope'] }, 'dependencies:invalid'],
        [{ dependencies: [task.id] }, 'dependencies:self-dependency'],
        [{ durationMinutes: -5 }, 'durationMinutes:invalid'],
        [{ manualOrder: Number.NaN }, 'manualOrder:invalid'],
        [{ completions: [{ date: '2026-11-21', at: 'dün' }] }, 'completions:invalid'],
        [{ title: 42 }, 'title:invalid'],
        [{ id: 'task_other-id' }, 'id:immutable']
    ];
    for (const [payload, expected] of cases) assert.deepEqual(errorsOf(payload, task), [expected], JSON.stringify(payload));
    assert.deepEqual(errorsOf({ id: 'bad', title: 'x' }), ['id:invalid']);
});

test('saat tarihe bağlıdır; tamamlama gün sayısı yalnız "tamamlandıktan sonra" tekrarındadır', () => {
    const timed = create({ title: 'Saatli', dueDate: '2026-11-22', dueTime: '07:30' });
    assert.equal(normalizePisiTask({ dueDate: null }, timed, options()).task.dueTime, null);
    const after = create({ title: 'Su', dueDate: '2026-11-22', repeat: 'after-completion' });
    assert.equal(after.completionOffsetDays, 1);
    assert.equal(normalizePisiTask({ completionOffsetDays: 3 }, after, options()).task.completionOffsetDays, 3);
    assert.equal(normalizePisiTask({ repeat: 'weekly', completionOffsetDays: 3 }, after, options()).task.completionOffsetDays, null);
});

test('durum: tekrarsız görev "done" olunca tamamlanma anı ve günü yazılır; tekrar eden görev tamamlama ister', () => {
    const task = create({ title: 'Rapor', dueDate: '2026-11-20' });
    const done = normalizePisiTask({ status: 'done' }, task, options(LATER)).task;
    assert.deepEqual([done.completedAt, done.completedOn], [LATER.toISOString(), '2026-11-21']);
    const touched = normalizePisiTask({ title: 'Rapor 2' }, done, options(new Date(2026, 10, 23))).task;
    assert.deepEqual([touched.completedAt, touched.completedOn], [done.completedAt, done.completedOn], 'yeniden yazılan alan tamamlanma gününü değiştirmez');
    const open = normalizePisiTask({ status: 'todo' }, done, options()).task;
    assert.deepEqual([open.completedAt, open.completedOn], [null, null]);

    const repeating = create({ title: 'Spor', dueDate: '2026-11-21', repeat: 'daily' });
    assert.deepEqual(errorsOf({ status: 'done' }, repeating), ['status:use-complete']);
});

test('aynılık updatedAt dışındaki alanlara bakar (değişmeyen kayıt yazılmaz)', () => {
    const task = create({ title: 'Aynı' });
    const rewritten = normalizePisiTask({ title: 'Aynı' }, task, options(LATER)).task;
    assert.notEqual(rewritten.updatedAt, task.updatedAt);
    assert.equal(isSamePisiTask(task, rewritten), true);
    assert.equal(isSamePisiTask(task, { ...rewritten, priority: 5 }), false);
});

test('tasks.json: sürüm 1 ve 2 okunur, 2 yazılır; bilinmeyen üst düzey anahtarlar korunur', () => {
    assert.deepEqual(readPisiTaskStore({ version: 1, tasks: [{ id: 'task_a1b2' }, null, 'x', []] }), { ok: true, version: 1, tasks: [{ id: 'task_a1b2' }] });
    assert.deepEqual(readPisiTaskStore({ tasks: [] }), { ok: true, version: 1, tasks: [] });
    assert.deepEqual(readPisiTaskStore({ version: 2, tasks: [] }), { ok: true, version: 2, tasks: [] });
    assert.equal(readPisiTaskStore({ version: 3, tasks: [] }).error, 'unsupported-version');
    assert.equal(readPisiTaskStore({ version: 2, tasks: {} }).error, 'tasks-not-a-list');
    assert.equal(readPisiTaskStore([]).error, 'not-an-object');

    const written = makePisiTaskStoreData({ version: 1, updatedAt: null, tasks: [], extra: { a: 1 } }, [{ id: 'task_a1b2' }], { now: NOW });
    assert.deepEqual(Object.keys(written), ['version', 'updatedAt', 'tasks', 'extra']);
    assert.deepEqual(written, { version: 2, updatedAt: NOW.toISOString(), tasks: [{ id: 'task_a1b2' }], extra: { a: 1 } });
});

test('sonraki bitiş günü: kuralın bitiş gününden ve bugünden sonraki ilk tarihi', () => {
    const next = (repeat, dueDate, today, extra = {}) => getNextPisiTaskDueDate({ repeat, dueDate, ...extra }, today);
    assert.equal(next('none', '2026-11-21', '2026-11-21'), null);
    assert.equal(next('daily', '2026-11-21', '2026-11-21'), '2026-11-22');
    assert.equal(next('daily', '2026-11-22', '2026-11-24'), '2026-11-25', 'geciken tekrarlar atlanır');
    assert.equal(next('daily', '2026-11-25', '2026-11-21'), '2026-11-26', 'ileri tarihli tekrar bitiş gününden ilerler');
    assert.equal(next('weekly', '2026-11-02', '2026-11-21'), '2026-11-23');
    assert.equal(next('biweekly', '2026-11-21', '2026-11-21'), '2026-12-05');
    assert.equal(next('weekdays', '2026-11-20', '2026-11-20'), '2026-11-23', 'cuma -> pazartesi');
    assert.equal(next('weekdays', '2026-11-21', '2026-11-21'), '2026-11-23', 'cumartesi -> pazartesi');
    assert.equal(next('monthly', '2026-01-31', '2026-01-31'), '2026-02-28', 'ay sonu kuralı bugünkü gibi');
    assert.equal(next('monthly', '2026-12-15', '2026-12-15'), '2027-01-15');
    assert.equal(next('monthly', '2026-01-31', '2026-03-01'), '2026-03-28', 'bugünkü kural ay sonundan sonra kayar');
    assert.equal(next('after-completion', '2026-11-01', '2026-11-21', { completionOffsetDays: 3 }), '2026-11-24');
    assert.equal(next('after-completion', '2026-11-01', '2026-11-21', { completionOffsetDays: null }), '2026-11-22');
    assert.equal(next('daily', null, '2026-11-21'), '2026-11-22', 'tarihsiz tekrar bugünden sayılır');
});

test('tekrarsız görevi tamamlama ve geri açma', () => {
    const task = create({ title: 'Rapor', dueDate: '2026-11-20', status: 'doing' });
    const done = completePisiTask(task, { now: LATER });
    assert.equal(done.changed, true);
    assert.deepEqual(
        [done.task.status, done.task.completedAt, done.task.completedOn, done.task.dueDate, done.task.completions],
        ['done', LATER.toISOString(), '2026-11-21', '2026-11-20', []]
    );
    assert.deepEqual(done.completion, { date: '2026-11-21', dueDate: '2026-11-20', at: LATER.toISOString(), status: 'doing' });
    assert.equal(completePisiTask(done.task, { now: LATER }).changed, false, 'tamamlanmış görev yeniden tamamlanmaz');

    const reopened = reopenPisiTask(done.task, done.completion, { now: LATER });
    assert.deepEqual([reopened.task.status, reopened.task.completedAt, reopened.task.completedOn], ['doing', null, null]);
    assert.equal(reopenPisiTask(done.task, null, { now: LATER }).task.status, 'todo', 'bilgi yoksa todo');
    assert.equal(reopenPisiTask(task, null, { now: LATER }).changed, false);
});

test('tekrar eden görev: tamamlama kaydı, ilerleme, hatırlatmanın kayması ve durumun todo olması', () => {
    const task = create({
        title: 'Spor',
        dueDate: '2026-11-21',
        dueTime: '07:30',
        repeat: 'daily',
        reminderAt: '2026-11-21T07:00',
        status: 'doing'
    });
    const done = completePisiTask(task, { now: LATER });
    assert.deepEqual(done.task.completions, [{ date: '2026-11-21', dueDate: '2026-11-21', at: LATER.toISOString() }]);
    assert.deepEqual(
        [done.task.status, done.task.dueDate, done.task.dueTime, done.task.reminderAt, done.task.completedAt],
        ['todo', '2026-11-22', '07:30', '2026-11-22T07:00', null]
    );
    assert.equal(done.completion.status, 'doing');

    const back = reopenPisiTask(done.task, done.completion, { now: LATER }).task;
    assert.deepEqual([back.status, back.dueDate, back.reminderAt, back.completions], ['doing', '2026-11-21', '2026-11-21T07:00', []]);
    assert.equal(back.updatedAt, LATER.toISOString(), 'geri alma da bir değişikliktir');
});

test('tekrar eden görevde yalnız en son tamamlama geri alınır; bilinmeyen tamamlama bulunamaz', () => {
    const task = create({ title: 'Spor', dueDate: '2026-11-21', repeat: 'daily' });
    const first = completePisiTask(task, { now: new Date(2026, 10, 21, 8) });
    const second = completePisiTask(first.task, { now: new Date(2026, 10, 22, 8) });
    assert.equal(getPisiTaskLatestCompletion(second.task).date, '2026-11-22');
    assert.equal(reopenPisiTask(second.task, first.completion, { now: LATER }).error, 'locked');
    assert.equal(reopenPisiTask(second.task, { date: '2026-11-10', dueDate: null, at: NOW.toISOString() }, { now: LATER }).error, 'not-found');
    const undone = reopenPisiTask(second.task, null, { now: LATER });
    assert.equal(undone.task.dueDate, '2026-11-22', 'bilgi verilmezse en son tamamlama geri alınır');
    assert.equal(undone.task.completions.length, 1);
});

test('tarihsiz tekrar eden görev bugünden ilerler ve geri alınınca yine tarihsiz olur', () => {
    const task = create({ title: 'Kitap', repeat: 'weekly', reminderAt: '2026-11-21T20:00' });
    const done = completePisiTask(task, { now: NOW });
    assert.deepEqual(done.task.completions, [{ date: '2026-11-21', dueDate: null, at: NOW.toISOString() }]);
    assert.deepEqual([done.task.dueDate, done.task.reminderAt], ['2026-11-28', '2026-11-28T20:00']);
    const back = reopenPisiTask(done.task, done.completion, { now: NOW }).task;
    assert.deepEqual([back.dueDate, back.reminderAt], [null, '2026-11-21T20:00']);
});

test('bağımlılık döngüsü: kendine bağımlılık, uzun döngü ve döngüsüz durum', () => {
    const tasks = [
        { id: 'task_aaaa', dependencies: ['task_bbbb'] },
        { id: 'task_bbbb', dependencies: ['task_cccc'] },
        { id: 'task_cccc', dependencies: [] },
        { id: 'task_dddd', dependencies: ['task_aaaa', 'task_cccc'] }
    ];
    assert.deepEqual(findPisiTaskDependencyCycle(tasks, 'task_aaaa', ['task_aaaa']), ['task_aaaa', 'task_aaaa']);
    assert.deepEqual(findPisiTaskDependencyCycle(tasks, 'task_cccc', ['task_dddd']), ['task_cccc', 'task_dddd', 'task_aaaa', 'task_bbbb', 'task_cccc']);
    assert.equal(findPisiTaskDependencyCycle(tasks, 'task_cccc', []), null);
    assert.equal(findPisiTaskDependencyCycle(tasks, 'task_dddd', ['task_bbbb', 'task_cccc']), null);
    assert.equal(findPisiTaskDependencyCycle(tasks, 'task_eeee', ['task_dddd', 'task_missing']), null, 'olmayan görev döngü kurmaz');
});
