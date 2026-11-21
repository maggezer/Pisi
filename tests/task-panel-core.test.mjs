import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PISI_TASK_KANBAN_STATUSES,
    getPisiQuickAddRepeat,
    getPisiTaskCardSignature,
    getPisiTaskMonthCells,
    getPisiTaskPanelModel,
    getPisiTaskPlaceValue,
    getPisiTaskTimelineRows,
    groupPisiTasksForKanban,
    normalizePisiTaskPanelPrefs,
    readPisiQuickAddTask,
    readPisiTaskDetailPatch,
    readPisiTaskDetailPlace,
    shiftPisiTaskMonth
} from '../renderer/tasks/pisi-task-panel-core.mjs';
import { parsePisiTurkishDateExpression } from '../shared/date-parser.mjs';

// docs/task-plan.md G4: the task panel's rules without the DOM.

const TODAY = '2026-11-21';
const task = (id, fields = {}) => ({
    id: `task_${id}`,
    title: id,
    status: 'todo',
    priority: 3,
    dueDate: null,
    dueTime: null,
    repeat: 'none',
    completionOffsetDays: null,
    reminderMode: 'none',
    reminderAt: null,
    dependencies: [],
    manualOrder: 0,
    noteId: null,
    diaryDate: TODAY,
    durationMinutes: 0,
    actualMinutes: 0,
    completions: [],
    ...fields
});

test('tercihler: bilinmeyen değer varsayılana döner; varsayılan görünüm "Öncelikli" listedir', () => {
    assert.deepEqual(normalizePisiTaskPanelPrefs({}), { view: 'list', dateFilter: 'all', status: 'all', sort: 'workorder', showCompleted: false, month: null });
    assert.deepEqual(
        normalizePisiTaskPanelPrefs({ view: 'kanban', dateFilter: 'today', status: 'doing', sort: 'manual', showCompleted: true, month: '2026-12' }),
        {
            view: 'kanban',
            dateFilter: 'today',
            status: 'doing',
            sort: 'manual',
            showCompleted: true,
            month: '2026-12'
        }
    );
    assert.deepEqual(
        normalizePisiTaskPanelPrefs({ view: 'x', dateFilter: 'never', status: 'done', sort: 'random', showCompleted: 'yes', month: '2026-1' }),
        normalizePisiTaskPanelPrefs({})
    );
});

test('panel modeli: açık görevler iş sırasıyla (gecikenler önce), süzgeç sayıları ve tamamlanan sayısı', () => {
    const tasks = [
        task('later', { dueDate: '2026-12-20', priority: 5 }),
        task('overdue', { dueDate: '2026-11-19', priority: 1 }),
        task('today-high', { dueDate: TODAY, priority: 5 }),
        task('undated', { priority: 5 }),
        task('done', { dueDate: TODAY, status: 'done' }),
        task('soon', { dueDate: '2026-11-23', priority: 2 })
    ];
    const model = getPisiTaskPanelModel(tasks, {}, TODAY);
    assert.deepEqual(
        model.visible.map((item) => item.id),
        ['task_overdue', 'task_today-high', 'task_soon', 'task_later', 'task_undated']
    );
    assert.deepEqual(model.counts, { all: 5, today: 1, upcoming: 1, overdue: 1, undated: 1 });
    assert.equal(model.completedCount, 1);
    assert.equal(model.total, 6);

    const withDone = getPisiTaskPanelModel(tasks, { showCompleted: true, dateFilter: 'today' }, TODAY);
    assert.deepEqual(
        withDone.visible.map((item) => item.id),
        ['task_today-high', 'task_done'],
        'done tasks last'
    );
    assert.equal(withDone.counts.today, 2);
    assert.deepEqual(getPisiTaskPanelModel(tasks, { status: 'doing' }, TODAY).visible, [], 'the status filter');
});

test('kart imzası yalnız çizilen değerler değişince değişir', () => {
    const base = task('a', { dueDate: '2026-11-22' });
    const signature = getPisiTaskCardSignature(base, { today: TODAY, place: 'Not' });
    assert.equal(getPisiTaskCardSignature({ ...base, updatedAt: 'x', actualMinutes: 30 }, { today: TODAY, place: 'Not' }), signature);
    for (const change of [{ title: 'b' }, { status: 'doing' }, { priority: 4 }, { dueDate: '2026-11-23' }, { repeat: 'daily' }, { noteId: 'node_x' }]) {
        assert.notEqual(getPisiTaskCardSignature({ ...base, ...change }, { today: TODAY, place: 'Not' }), signature, JSON.stringify(change));
    }
    assert.notEqual(getPisiTaskCardSignature(base, { today: '2026-11-23', place: 'Not' }), signature, 'it becomes overdue');
    assert.notEqual(getPisiTaskCardSignature(base, { today: TODAY, place: 'Başka' }), signature);
    assert.notEqual(getPisiTaskCardSignature(base, { today: TODAY, place: 'Not', blocked: true }), signature);
});

test('kanban: açık görevler kayıttaki durumlarına göre, iş sırasıyla; tamamlanan sütunda değil', () => {
    const columns = groupPisiTasksForKanban(
        [
            task('a', { status: 'doing', dueDate: '2026-11-30' }),
            task('b', { status: 'doing', dueDate: '2026-11-20' }),
            task('c', { status: 'blocked' }),
            task('d', { status: 'done' }),
            task('e', { dependencies: ['task_c'] })
        ],
        TODAY
    );
    assert.deepEqual(Object.keys(columns), [...PISI_TASK_KANBAN_STATUSES]);
    assert.deepEqual(
        columns.doing.map((item) => item.id),
        ['task_b', 'task_a']
    );
    assert.deepEqual(
        columns.todo.map((item) => item.id),
        ['task_e'],
        'a task waiting on a dependency stays in its own column'
    );
    assert.deepEqual(
        columns.blocked.map((item) => item.id),
        ['task_c']
    );
});

test('ay görünümü: 42 gün, pazartesiyle başlar; görev bitiş gününde; tarihsizler ayrı', () => {
    const { cells, undated } = getPisiTaskMonthCells('2026-11', [task('a', { dueDate: '2026-11-21' }), task('b', { dueDate: '2026-12-01' }), task('c')], TODAY);
    assert.equal(cells.length, 42);
    assert.equal(cells[0].day, '2026-10-26', 'Monday before 1 November 2026 (a Sunday)');
    assert.equal(cells[6].day, '2026-11-01');
    assert.equal(cells.filter((cell) => cell.inMonth).length, 30);
    const today = cells.find((cell) => cell.today);
    assert.equal(today.day, TODAY);
    assert.deepEqual(
        today.tasks.map((item) => item.id),
        ['task_a']
    );
    assert.deepEqual(
        cells.find((cell) => cell.day === '2026-12-01').tasks.map((item) => item.id),
        ['task_b']
    );
    assert.deepEqual(
        undated.map((item) => item.id),
        ['task_c']
    );
    assert.equal(shiftPisiTaskMonth('2026-12', 1), '2027-01');
    assert.equal(shiftPisiTaskMonth('2026-01', -1), '2025-12');
});

test('zaman çizelgesi: güne göre, 30 günlük izde sıkıştırılmış konum', () => {
    const { rows, undated } = getPisiTaskTimelineRows(
        [task('later', { dueDate: '2027-01-30' }), task('mid', { dueDate: '2026-12-06' }), task('late', { dueDate: '2026-11-11' }), task('none')],
        TODAY
    );
    assert.deepEqual(
        rows.map((row) => [row.task.id, row.offset, row.position, row.overdue, row.later]),
        [
            ['task_late', -10, 0, true, false],
            ['task_mid', 15, 50, false, false],
            ['task_later', 70, 100, false, true]
        ]
    );
    assert.deepEqual(
        undated.map((item) => item.id),
        ['task_none']
    );
});

test('Quick Add: Türkçe tarih günü ve saati verir; tarih yoksa gün yok; tekrar alanı ifadeden dolar', () => {
    const now = new Date(2026, 10, 21, 10, 0);
    const parsed = parsePisiTurkishDateExpression('yarın 14:00', now);
    assert.deepEqual(readPisiQuickAddTask({ title: '  Rapor   yaz ', priority: '5', repeat: 'none', reminderMode: 'day-before' }, parsed), {
        task: {
            title: 'Rapor yaz',
            priority: 5,
            dueDate: '2026-11-22',
            dueTime: '14:00',
            repeat: 'none',
            completionOffsetDays: null,
            reminderMode: 'day-before',
            reminderAt: null
        }
    });
    const undated = readPisiQuickAddTask({ title: 'Not al', reminderMode: 'day-before' }, parsePisiTurkishDateExpression('', now));
    assert.equal(undated.task.dueDate, null);
    assert.equal(undated.task.reminderMode, 'none', 'a reminder mode needs a day');
    assert.deepEqual(readPisiQuickAddTask({ title: '   ' }, null), { error: 'empty-title' });

    const repeating = parsePisiTurkishDateExpression('görev tamamlandıktan üç gün sonra', now);
    assert.deepEqual(getPisiQuickAddRepeat(repeating), { repeat: 'after-completion', completionOffsetDays: 3 });
    assert.deepEqual(getPisiQuickAddRepeat(parsePisiTurkishDateExpression('her cuma', now)), { repeat: 'weekly', completionOffsetDays: null });
    const reminded = readPisiQuickAddTask(
        { title: 'Ara', repeat: 'after-completion', completionOffsetDays: '3' },
        parsePisiTurkishDateExpression('yarın 9:00 hatırlat', now)
    );
    assert.equal(reminded.task.reminderAt, '2026-11-22T09:00');
    assert.equal(reminded.task.completionOffsetDays, 3);
    // A number in the title is not a date (pisi-error §5e).
    assert.equal(readPisiQuickAddTask({ title: 'x' }, parsePisiTurkishDateExpression('3-4 sayfa', now)).task.dueDate, null);
});

test('ayrıntı yaması: yalnız değişen alanlar; saat gün ister; gün sayısı yalnız after-completion', () => {
    const base = task('a', {
        dueDate: '2026-11-22',
        dueTime: '10:00',
        completions: [{ date: '2026-11-20', dueDate: '2026-11-20', at: '2026-11-20T08:00:00.000Z' }]
    });
    const same = {
        title: 'a',
        status: 'todo',
        priority: '3',
        dueDate: '2026-11-22',
        dueTime: '10:00',
        repeat: 'none',
        completionOffsetDays: '1',
        reminderMode: 'none',
        reminderAt: '',
        dependencies: [],
        durationMinutes: '0',
        actualMinutes: '0',
        completions: base.completions
    };
    assert.deepEqual(readPisiTaskDetailPatch(base, same), { patch: {}, changed: false });
    assert.deepEqual(readPisiTaskDetailPatch(base, { ...same, title: ' b ', priority: '5', dueDate: '', dependencies: ['task_x', 'task_x', 'task_a'] }).patch, {
        title: 'b',
        priority: 5,
        dueDate: null,
        dueTime: null,
        dependencies: ['task_x']
    });
    assert.deepEqual(readPisiTaskDetailPatch(base, { ...same, repeat: 'after-completion', completionOffsetDays: '4' }).patch, {
        repeat: 'after-completion',
        completionOffsetDays: 4
    });
    assert.deepEqual(readPisiTaskDetailPatch(base, { ...same, completions: [] }).patch, { completions: [] }, 'a completed day is removed');
    assert.deepEqual(readPisiTaskDetailPatch({ ...base, status: 'done' }, { ...same, status: 'doing' }).patch, {}, 'a done task keeps its status');
    assert.deepEqual(readPisiTaskDetailPatch(base, { ...same, reminderAt: '2026-11-22T08:30' }).patch, { reminderAt: '2026-11-22T08:30' });
});

test('ayrıntıda yer: kendi yeri değişiklik değildir; not hedefi yolunu da taşır', () => {
    const inNote = task('a', { noteId: 'node_1', diaryDate: null });
    assert.equal(getPisiTaskPlaceValue(inNote), 'note:node_1');
    assert.equal(getPisiTaskPlaceValue(task('b')), `diary:${TODAY}`);
    assert.equal(readPisiTaskDetailPlace(inNote, 'note:node_1', '/p/a.node'), null);
    assert.deepEqual(readPisiTaskDetailPlace(inNote, 'diary:2026-11-25'), { diaryDate: '2026-11-25' });
    assert.deepEqual(readPisiTaskDetailPlace(task('b'), 'note:node_2', '/p/b.node'), { noteId: 'node_2', notePath: '/p/b.node' });
    assert.equal(readPisiTaskDetailPlace(task('b'), 'note:node_2', null), null, 'without a path a note cannot be written');
    assert.equal(readPisiTaskDetailPlace(task('b'), `diary:${TODAY}`), null);
});
