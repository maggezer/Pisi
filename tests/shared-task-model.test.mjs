import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PISI_TASK_REPEATS,
    PISI_TASK_STATUSES,
    PISI_TODO_PRIORITY_OPTIONS,
    PISI_TODO_REPEAT_OPTIONS,
    PISI_TODO_STATUS_OPTIONS,
    formatPisiTodoTag,
    getNextPisiTodoDate,
    getPisiTodayIsoDate,
    getPisiTodoPriorityOption,
    getPisiTodoRepeatOption,
    getPisiTodoStatusOption,
    normalizePisiFirstClassDependencies,
    normalizePisiFirstClassTaskIso,
    normalizePisiFirstClassTaskRepeat,
    normalizePisiFirstClassTaskStatus,
    normalizePisiTaskRecord,
    normalizePisiTaskSource,
    normalizePisiTodoTagValue,
    parsePisiTaskDueDateFromTag,
    parsePisiTaskPriority
} from '../shared/task-model.mjs';

// Friday 13 November 2026, local time.
const NOW = new Date(2026, 10, 13, 9, 30);
const day = (date) => (date ? getPisiTodayIsoDate(date) : null);

function recordOptions(overrides = {}) {
    const calls = { uuid: 0 };
    return {
        calls,
        options: {
            now: new Date(Date.UTC(2026, 10, 13, 6, 30, 15, 123)),
            makeUuid: () => {
                calls.uuid += 1;
                return `uuid-${calls.uuid}`;
            },
            normalizeStoredPath: (value) => (value ? String(value).replace(/\\/g, '/') : null),
            ...overrides
        }
    };
}

test('canonical değerler: öncelik 1-5, beş durum, yedi tekrar', () => {
    assert.deepEqual(
        PISI_TODO_PRIORITY_OPTIONS.map((item) => item.value),
        [1, 2, 3, 4, 5]
    );
    assert.deepEqual([...PISI_TASK_STATUSES], ['todo', 'doing', 'waiting', 'blocked', 'done']);
    assert.deepEqual([...PISI_TASK_REPEATS].sort(), ['after-completion', 'biweekly', 'daily', 'monthly', 'none', 'weekdays', 'weekly']);
    // The option lists the desktop UI shows cover the same repeat values; "done" is not a selectable status.
    assert.deepEqual(PISI_TODO_REPEAT_OPTIONS.map((item) => item.value).sort(), [...PISI_TASK_REPEATS].sort());
    assert.deepEqual(
        PISI_TODO_STATUS_OPTIONS.map((item) => item.value),
        ['todo', 'doing', 'waiting', 'blocked']
    );

    assert.equal(getPisiTodoPriorityOption('4').value, 4);
    assert.equal(getPisiTodoPriorityOption(6), null);
    assert.equal(getPisiTodoStatusOption(' DOING ').value, 'doing');
    assert.equal(getPisiTodoStatusOption('done').value, 'todo');
    assert.equal(getPisiTodoRepeatOption('Weekly').value, 'weekly');
    assert.equal(getPisiTodoRepeatOption('yearly').value, 'none');
});

test('todo etiketi: todo.<öncelik>.<GG-AA-YYYY|none> yazılır, gösterim önekleri atılır', () => {
    assert.equal(formatPisiTodoTag(3, '2026-11-13'), 'todo.3.13-11-2026');
    assert.equal(formatPisiTodoTag('5', 'none'), 'todo.5.none');
    assert.equal(formatPisiTodoTag(1, ''), 'todo.1.none');
    assert.equal(formatPisiTodoTag(1, undefined), 'todo.1.none');
    assert.equal(formatPisiTodoTag(6, '2026-11-13'), null);
    assert.equal(formatPisiTodoTag(3, '2026-02-30'), null);
    assert.equal(formatPisiTodoTag(3, '13-11-2026'), null);

    assert.equal(normalizePisiTodoTagValue('..Todo.3.None'), 'todo.3.none');
    assert.equal(normalizePisiTodoTagValue('/todo.2.13-11-2026'), 'todo.2.13-11-2026');
    assert.equal(normalizePisiTodoTagValue('#TODO..4..none.'), 'todo.4.none');
    assert.equal(normalizePisiTodoTagValue(' todo.1.none '), 'todo.1.none');
    assert.equal(normalizePisiTodoTagValue(null), '');

    assert.equal(parsePisiTaskPriority('todo.4.none'), 4);
    assert.equal(parsePisiTaskPriority('serbest', 9), 5);
    assert.equal(parsePisiTaskPriority('', 'x'), 3);
    assert.equal(parsePisiTaskDueDateFromTag('todo.4.13-11-2026'), '2026-11-13');
    assert.equal(parsePisiTaskDueDateFromTag('todo.4.none'), null);
});

test('tekrar eden görevin sonraki tarihi', () => {
    const friday = new Date(2026, 10, 13);

    assert.equal(day(getNextPisiTodoDate(friday, 'daily', NOW)), '2026-11-14');
    assert.equal(day(getNextPisiTodoDate(friday, 'weekdays', NOW)), '2026-11-16');
    assert.equal(day(getNextPisiTodoDate(new Date(2026, 10, 14), 'weekdays', NOW)), '2026-11-16');
    assert.equal(day(getNextPisiTodoDate(friday, 'weekly', NOW)), '2026-11-20');
    assert.equal(day(getNextPisiTodoDate(friday, 'biweekly', NOW)), '2026-11-27');
    // Monthly keeps the day of the month and clamps to the last day of a shorter month.
    assert.equal(day(getNextPisiTodoDate(new Date(2026, 0, 31), 'monthly', NOW)), '2026-02-28');
    assert.equal(day(getNextPisiTodoDate(new Date(2026, 11, 15), 'monthly', NOW)), '2027-01-15');
});

test('tamamlandıktan sonra tekrar bugünden sayılır; tarihsiz görev bugünü temel alır', () => {
    const old = new Date(2026, 10, 1);

    assert.equal(day(getNextPisiTodoDate(old, 'after-completion', NOW, 3)), '2026-11-16');
    assert.equal(day(getNextPisiTodoDate(old, 'after-completion', NOW)), '2026-11-14');
    assert.equal(day(getNextPisiTodoDate(old, 'after-completion', NOW, 0)), '2026-11-14');
    assert.equal(day(getNextPisiTodoDate(null, 'daily', NOW)), '2026-11-14');

    assert.equal(getNextPisiTodoDate(old, 'none', NOW), null);
    assert.equal(getNextPisiTodoDate(old, 'yearly', NOW), null);

    const next = getNextPisiTodoDate(new Date(2026, 10, 13, 17, 45), 'daily', NOW);
    assert.equal(next.getHours() + next.getMinutes(), 0);
});

test('tarih alanları: yalnız gerçek tarihler, saat yalnız izin verilen alanda', () => {
    assert.equal(normalizePisiFirstClassTaskIso('2026-11-13'), '2026-11-13');
    assert.equal(normalizePisiFirstClassTaskIso('2026-11-13T09:30'), '2026-11-13T09:30');
    assert.equal(normalizePisiFirstClassTaskIso(' 2026-11-13 '), '2026-11-13');
    assert.equal(normalizePisiFirstClassTaskIso('2026-11-13T09:30', false), null);
    assert.equal(normalizePisiFirstClassTaskIso('2026-02-30'), null);
    assert.equal(normalizePisiFirstClassTaskIso('2026-11-13T24:00'), null);
    assert.equal(normalizePisiFirstClassTaskIso('2026-11-13T7:05'), null);
    assert.equal(normalizePisiFirstClassTaskIso('13-11-2026'), null);
    assert.equal(normalizePisiFirstClassTaskIso(''), null);
    assert.equal(normalizePisiFirstClassTaskIso(null), null);
});

test('durum, tekrar ve bağımlılık normalizasyonu', () => {
    assert.equal(normalizePisiFirstClassTaskStatus(' Doing '), 'doing');
    assert.equal(normalizePisiFirstClassTaskStatus('bitti'), 'todo');
    assert.equal(normalizePisiFirstClassTaskStatus(undefined), 'todo');
    assert.equal(normalizePisiFirstClassTaskStatus('todo', true), 'done');

    assert.equal(normalizePisiFirstClassTaskRepeat(' Weekly '), 'weekly');
    assert.equal(normalizePisiFirstClassTaskRepeat('yearly'), 'none');
    assert.equal(normalizePisiFirstClassTaskRepeat(null), 'none');

    assert.deepEqual(normalizePisiFirstClassDependencies(['task_dep1', 'task_dep1', ' task_dep2 ', 'bad', 'task_ab', null, 'task_self'], 'task_self'), [
        'task_dep1',
        'task_dep2'
    ]);
    assert.deepEqual(normalizePisiFirstClassDependencies('task_dep1', 'task_self'), []);
});

test('yeni görev kaydı: alanlar, varsayılanlar ve alan sırası tasks.json sözleşmesidir', () => {
    const { options, calls } = recordOptions();
    const record = normalizePisiTaskRecord(
        {
            title: '  Raporu   yaz ',
            priority: 4,
            dueDate: '2026-11-20',
            scheduledAt: '2026-11-20T10:00',
            repeat: 'Weekly',
            dependencies: ['task_dep1', 'task_dep1', 'bad'],
            source: { nodePath: 'notlar\\a.node', blockId: ' blk_1 ', nodeTitle: ' A ' }
        },
        null,
        options
    );

    assert.deepEqual(record, {
        id: 'task_uuid-1',
        title: 'Raporu yaz',
        status: 'todo',
        priority: 4,
        dueDate: '2026-11-20',
        scheduledAt: '2026-11-20T10:00',
        deadline: null,
        reminderAt: null,
        reminderMode: 'none',
        durationMinutes: 0,
        actualMinutes: 0,
        repeat: 'weekly',
        completionOffsetDays: null,
        dependencies: ['task_dep1'],
        manualOrder: options.now.getTime(),
        todoTag: 'todo.4.none',
        source: { nodePath: 'notlar/a.node', blockId: 'blk_1', mapPath: null, nodeTitle: 'A', mapTitle: '' },
        createdAt: '2026-11-13T06:30:15.123Z',
        updatedAt: '2026-11-13T06:30:15.123Z',
        completedAt: null
    });
    assert.deepEqual(Object.keys(record), [
        'id',
        'title',
        'status',
        'priority',
        'dueDate',
        'scheduledAt',
        'deadline',
        'reminderAt',
        'reminderMode',
        'durationMinutes',
        'actualMinutes',
        'repeat',
        'completionOffsetDays',
        'dependencies',
        'manualOrder',
        'todoTag',
        'source',
        'createdAt',
        'updatedAt',
        'completedAt'
    ]);
    assert.equal(calls.uuid, 1);
});

test('görev kaydı: geçerli kimlik korunur, yeni kimlik yalnız gerektiğinde üretilir', () => {
    const kept = recordOptions();
    assert.equal(normalizePisiTaskRecord({ id: '  task_verilen  ' }, null, kept.options).id, 'task_verilen');
    assert.equal(kept.calls.uuid, 0);

    const replaced = recordOptions();
    assert.equal(normalizePisiTaskRecord({ id: 'node_x' }, null, replaced.options).id, 'task_uuid-1');
    assert.equal(replaced.calls.uuid, 1);

    // The stored record's id wins over the payload.
    const existing = recordOptions();
    assert.equal(normalizePisiTaskRecord({ id: 'task_baska' }, { id: 'task_mevcut' }, existing.options).id, 'task_mevcut');
    assert.equal(existing.calls.uuid, 0);
});

test('görev kaydı güncelleme: verilmeyen alanlar korunur, tamamlanma zamanı duruma bağlıdır', () => {
    const first = normalizePisiTaskRecord(
        { title: 'Görev', priority: 2, dueDate: '2026-11-20', manualOrder: 7, todoTag: 'todo.2.20-11-2026' },
        null,
        recordOptions().options
    );
    const later = new Date(Date.UTC(2026, 10, 14, 8, 0, 0, 0));

    const done = normalizePisiTaskRecord({ status: 'done' }, first, recordOptions({ now: later }).options);
    assert.equal(done.id, first.id);
    assert.equal(done.title, 'Görev');
    assert.equal(done.priority, 2);
    assert.equal(done.dueDate, '2026-11-20');
    assert.equal(done.manualOrder, 7);
    assert.equal(done.todoTag, 'todo.2.20-11-2026');
    assert.equal(done.createdAt, first.createdAt);
    assert.equal(done.updatedAt, '2026-11-14T08:00:00.000Z');
    assert.equal(done.completedAt, '2026-11-14T08:00:00.000Z');

    const stillDone = normalizePisiTaskRecord({ title: 'Görev (düzeltildi)' }, done, recordOptions({ now: new Date(Date.UTC(2026, 10, 15)) }).options);
    assert.equal(stillDone.completedAt, '2026-11-14T08:00:00.000Z');

    const reopened = normalizePisiTaskRecord({ status: 'todo' }, done, recordOptions({ now: later }).options);
    assert.equal(reopened.status, 'todo');
    assert.equal(reopened.completedAt, null);

    assert.equal(normalizePisiTaskRecord({ completed: true }, first, recordOptions().options).status, 'done');
    // An explicit empty date clears the field; a missing one keeps it.
    assert.equal(normalizePisiTaskRecord({ dueDate: '' }, first, recordOptions().options).dueDate, null);
});

test('görev kaydı: sayılar sınırlanır, geçersiz değerler varsayılana döner', () => {
    const record = normalizePisiTaskRecord(
        {
            priority: 9,
            status: 'bitti',
            dueDate: '2026-11-13T10:00',
            scheduledAt: '2026-02-30',
            durationMinutes: 5000,
            actualMinutes: -4,
            completionOffsetDays: 4000,
            manualOrder: 'x',
            reminderMode: ' Day-Before ',
            todoTag: ' TODO.5.13-11-2026 ',
            text: 'metinden başlık'
        },
        null,
        recordOptions().options
    );

    assert.equal(record.priority, 5);
    assert.equal(record.status, 'todo');
    assert.equal(record.dueDate, null);
    assert.equal(record.scheduledAt, null);
    assert.equal(record.durationMinutes, 1440);
    assert.equal(record.actualMinutes, 0);
    assert.equal(record.completionOffsetDays, 3650);
    assert.equal(record.manualOrder, recordOptions().options.now.getTime());
    assert.equal(record.reminderMode, 'day-before');
    assert.equal(record.todoTag, 'todo.5.13-11-2026');
    assert.equal(record.title, 'metinden başlık');
    assert.equal(normalizePisiTaskRecord({ priority: 0 }, null, recordOptions().options).priority, 3);
    assert.equal(normalizePisiTaskRecord({ priority: -1 }, null, recordOptions().options).priority, 1);
});

test('görev kaynağı: yolu çağıran çözer, proje dışı yol hatası yukarı taşınır', () => {
    const seen = [];
    const source = normalizePisiTaskSource({ nodePath: 'a.node', blockId: 5 }, { mapPath: 'm.map', nodeTitle: ' Eski ', blockId: 'blk_eski' }, (value) => {
        seen.push(value);
        return value ? `stored:${value}` : null;
    });
    assert.deepEqual(source, { nodePath: 'stored:a.node', blockId: '5', mapPath: 'stored:m.map', nodeTitle: 'Eski', mapTitle: '' });
    assert.deepEqual(seen, ['a.node', 'm.map']);
    assert.deepEqual(
        normalizePisiTaskSource({}, {}, () => null),
        { nodePath: null, blockId: null, mapPath: null, nodeTitle: '', mapTitle: '' }
    );

    const outside = recordOptions({
        normalizeStoredPath: () => {
            throw new Error('Görev kaynağı proje klasörünün dışında olamaz.');
        }
    });
    assert.throws(() => normalizePisiTaskRecord({ source: { nodePath: '../x.node' } }, null, outside.options), /proje klasörünün dışında/);
});
