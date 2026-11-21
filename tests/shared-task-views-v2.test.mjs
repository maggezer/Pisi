import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PISI_TASK_DATE_FILTERS,
    filterPisiTasks,
    getPisiTaskBucket,
    getPisiTaskCalendarSummary,
    getPisiTaskDay,
    getPisiTaskDaysLeft,
    getPisiTaskDependencyState,
    getPisiTaskProgress,
    getPisiTaskWorkOrder,
    sortPisiTasks
} from '../shared/task-views.mjs';
import { getPisiTaskCalendarSummary as diarySummary } from '../shared/task-diary.mjs';

const TODAY = '2026-11-21';
const task = (id, fields = {}) => ({ id: `task_${id}`, title: id, status: 'todo', priority: 3, dueDate: null, dependencies: [], manualOrder: 0, ...fields });

test('görevin günü yalnız dueDate: scheduledAt ve deadline okunmaz (GK1)', () => {
    assert.equal(getPisiTaskDay(task('a', { dueDate: '2026-11-25', scheduledAt: '2026-11-22T10:00', deadline: '2026-11-30' })), '2026-11-25');
    assert.equal(getPisiTaskDay(task('b', { scheduledAt: '2026-11-22T10:00', deadline: '2026-11-30' })), null);
    assert.equal(getPisiTaskDay(task('c', { dueDate: '2026-02-30' })), null);
});

test('kovalar: geciken, bugün, yaklaşan (1-7 gün), sonra, tarihsiz', () => {
    const bucket = (dueDate) => getPisiTaskBucket(task('x', { dueDate }), TODAY);
    assert.deepEqual(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-28', '2026-11-29', null].map(bucket), [
        'overdue',
        'today',
        'upcoming',
        'upcoming',
        'later',
        'undated'
    ]);
    assert.equal(getPisiTaskDaysLeft(task('x', { dueDate: '2026-11-18' }), TODAY), -3);
    assert.equal(getPisiTaskDaysLeft(task('x'), TODAY), null);
});

test('öncelik sırası (varsayılan): gecikenler önce, sonra kalan gün / öncelik; tamamlananlar ve tarihsizler sona', () => {
    const tasks = [
        task('undated', { priority: 5 }),
        task('later', { dueDate: '2026-12-10', priority: 1 }),
        task('soonHigh', { dueDate: '2026-11-25', priority: 5 }),
        task('soonLow', { dueDate: '2026-11-23', priority: 1 }),
        task('today', { dueDate: TODAY }),
        task('overdue', { dueDate: '2026-11-19', priority: 2 }),
        task('done', { dueDate: '2026-11-01', status: 'done' })
    ];
    assert.deepEqual(
        sortPisiTasks(tasks, { today: TODAY }).map((item) => item.title),
        ['overdue', 'today', 'soonHigh', 'soonLow', 'later', 'undated', 'done']
    );
    assert.equal(getPisiTaskWorkOrder(tasks[2], TODAY), 4 / 5);
    assert.equal(getPisiTaskWorkOrder(tasks[0], TODAY), Number.POSITIVE_INFINITY);
    assert.deepEqual(
        sortPisiTasks(tasks, { mode: 'bilinmeyen', today: TODAY }).map((item) => item.title),
        sortPisiTasks(tasks, { today: TODAY }).map((item) => item.title)
    );
});

test('öncelik, elle sıra, tarih ve durum sıralamaları; eşitlikte iş sırası', () => {
    const tasks = [
        task('a', { priority: 2, manualOrder: 3, dueDate: '2026-11-30', status: 'waiting' }),
        task('b', { priority: 5, manualOrder: 1, dueDate: '2026-11-22', status: 'todo' }),
        task('c', { priority: 5, manualOrder: 2, dueDate: '2026-11-21', status: 'doing' }),
        task('d', { priority: 1, manualOrder: 0 })
    ];
    const order = (mode) => sortPisiTasks(tasks, { mode, today: TODAY }).map((item) => item.title);
    assert.deepEqual(order('priority'), ['c', 'b', 'a', 'd']);
    assert.deepEqual(order('manual'), ['d', 'b', 'c', 'a']);
    assert.deepEqual(order('date'), ['c', 'b', 'a', 'd']);
    assert.deepEqual(order('status'), ['c', 'b', 'd', 'a']);
});

test('süzgeçler: tarih kovası, durum ve tamamlananları göster', () => {
    assert.deepEqual(PISI_TASK_DATE_FILTERS, ['all', 'today', 'upcoming', 'overdue', 'undated']);
    const tasks = [
        task('o', { dueDate: '2026-11-19' }),
        task('t', { dueDate: TODAY, status: 'doing' }),
        task('u', { dueDate: '2026-11-24' }),
        task('n'),
        task('d', { dueDate: TODAY, status: 'done' })
    ];
    const titles = (options) => filterPisiTasks(tasks, { today: TODAY, ...options }).map((item) => item.title);
    assert.deepEqual(titles({}), ['o', 't', 'u', 'n']);
    assert.deepEqual(titles({ dateFilter: 'today' }), ['t']);
    assert.deepEqual(titles({ dateFilter: 'today', showCompleted: true }), ['t', 'd']);
    assert.deepEqual(titles({ dateFilter: 'overdue' }), ['o']);
    assert.deepEqual(titles({ dateFilter: 'undated' }), ['n']);
    assert.deepEqual(titles({ status: 'doing' }), ['t']);
    assert.deepEqual(titles({ dateFilter: 'yok' }), ['o', 't', 'u', 'n']);
});

test('bağımlılık durumu ve ilerleme sayıları', () => {
    const tasks = [
        task('a', { status: 'done' }),
        task('b', { dependencies: ['task_a'], status: 'doing', priority: 4 }),
        task('c', { dependencies: ['task_b', 'task_missing'], dueDate: '2026-11-19', priority: 5 }),
        task('r', { repeat: 'daily', dueDate: '2026-11-22', completions: [{ date: '2026-11-20' }, { date: '2026-11-21' }] })
    ];
    const deps = getPisiTaskDependencyState(tasks);
    assert.deepEqual(deps.get('task_b'), { missing: [], open: [], blocked: false, effectiveStatus: 'doing' });
    assert.deepEqual(deps.get('task_c'), { missing: ['task_missing'], open: ['task_b'], blocked: true, effectiveStatus: 'blocked' });

    assert.deepEqual(getPisiTaskProgress(tasks, TODAY), {
        total: 4,
        open: 3,
        completed: 1,
        rate: 25,
        blocked: 1,
        overdue: 1,
        byStatus: { todo: 1, doing: 1, waiting: 0, blocked: 1 },
        byPriority: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 },
        completedOccurrences: 2
    });
    assert.equal(getPisiTaskProgress([], TODAY).rate, 0);
});

test('takvim özeti günlük bölümüyle aynı gün kuralını kullanır', () => {
    assert.equal(getPisiTaskCalendarSummary, diarySummary);
});
