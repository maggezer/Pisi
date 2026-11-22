// The desktop calendar's task marks (docs/task-plan.md G5, §3.2.2): a day is
// marked by the tasks its diary section lists, with their state on that day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCalendarDayMarks, getCalendarTaskSummaryByDate } from '../renderer/calendar/pisi-calendar-ui.mjs';
import { listPisiDiaryTaskIds } from '../shared/task-diary.mjs';

const id = (n) => `task_00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const TASKS = [
    { id: id(1), title: 'Açık', status: 'todo', dueDate: '2026-11-20', createdAt: '2026-11-01T00:00:00.000Z' },
    { id: id(2), title: 'Geç biten', status: 'done', dueDate: '2026-11-10', completedOn: '2026-11-16', createdAt: '2026-11-01T00:00:01.000Z' },
    {
        id: id(3),
        title: 'Spor',
        status: 'todo',
        repeat: 'daily',
        dueDate: '2026-11-22',
        completions: [{ date: '2026-11-21', dueDate: '2026-11-21', at: '2026-11-21T06:00:00.000Z' }],
        createdAt: '2026-11-01T00:00:02.000Z'
    },
    { id: id(4), title: 'Günlükte', status: 'todo', diaryDate: '2026-11-05', dueDate: '2026-11-28', createdAt: '2026-11-01T00:00:03.000Z' },
    // Eski alanlar okunmaz: yalnız scheduledAt / deadline taşıyan kayıt hiçbir güne düşmez (GK1).
    { id: id(5), title: 'Eski', status: 'todo', scheduledAt: '2026-11-11T09:00', deadline: '2026-11-12', createdAt: '2026-11-01T00:00:04.000Z' }
];

function withTasks(tasks, run) {
    const previous = globalThis.window;
    globalThis.window = { getPisiTasks: () => tasks };
    try {
        return run();
    } finally {
        globalThis.window = previous;
    }
}

function fakeDayButton(date) {
    const classes = new Set(['pisi-calendar-day']);
    return {
        dataset: { date },
        title: '',
        classes,
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name))
        }
    };
}

test('takvim günü, o günün günlük bölümündeki görevleri sayar (yer, bitiş günü, tamamlama günü)', () => {
    const summary = withTasks(TASKS, () => getCalendarTaskSummaryByDate());
    const days = [...summary.keys()].sort();
    assert.deepEqual(days, ['2026-11-05', '2026-11-10', '2026-11-16', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-28']);
    // Her işaretli gün, aynı kuralın ürettiği günlük bölümüyle aynı görevleri sayar.
    for (const day of days) assert.equal(summary.get(day).total, listPisiDiaryTaskIds(day, TASKS).length, day);
    assert.deepEqual(summary.get('2026-11-21'), { total: 1, open: 0, completed: 1 });
    assert.deepEqual(summary.get('2026-11-22'), { total: 1, open: 1, completed: 0 });
    assert.deepEqual(summary.get('2026-11-16'), { total: 1, open: 0, completed: 1 });
    assert.deepEqual(summary.get('2026-11-05'), { total: 1, open: 1, completed: 0 });
    assert.equal(summary.has('2026-11-11'), false);
    assert.equal(summary.has('2026-11-12'), false);
});

test('gün düğmesinin sınıfları: açık görev, hepsi biten görevler, yalnız günlük; eski işaret temizlenir', () => {
    const summary = withTasks(TASKS, () => getCalendarTaskSummaryByDate());
    const open = fakeDayButton('2026-11-20');
    withTasks(TASKS, () => applyCalendarDayMarks(open, summary.get('2026-11-20'), true));
    assert.deepEqual([...open.classes].sort(), ['has-diary-node', 'has-uncompleted-tasks', 'pisi-calendar-day']);
    assert.match(open.title, /Tamamlanmamış görev var/);

    const done = fakeDayButton('2026-11-21');
    withTasks(TASKS, () => applyCalendarDayMarks(done, summary.get('2026-11-21'), false));
    assert.deepEqual([...done.classes].sort(), ['has-completed-tasks', 'has-diary-node', 'pisi-calendar-day']);

    // Aynı düğme yerinde güncellenir: görev gidince yalnız günlük işareti kalır.
    withTasks(TASKS, () => applyCalendarDayMarks(done, undefined, true));
    assert.deepEqual([...done.classes].sort(), ['has-diary-node', 'has-diary-note-only', 'pisi-calendar-day']);
    assert.match(done.title, /Günlük not var/);
    withTasks(TASKS, () => applyCalendarDayMarks(done, undefined, false));
    assert.deepEqual([...done.classes], ['pisi-calendar-day']);
    assert.equal(done.title, '2026-11-21');
});
