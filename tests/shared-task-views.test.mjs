import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PISI_TODO_FILTER_OPTIONS,
    getPisiTaskCalendarIsoDate,
    getPisiTaskTodoTag,
    getPisiTodoDateBucket,
    getPisiTodoFilterOption,
    matchesPisiTodoFilter,
    parsePisiTodoTagValue
} from '../shared/task-views.mjs';

// Friday 13 November 2026, local time.
const NOW = new Date(2026, 10, 13, 9, 30);
const daysFromNow = (offset, hour = 0) => new Date(2026, 10, 13 + offset, hour);

test('tarih kovaları: gecikmiş, bugün, yaklaşan (1-7 gün), sonra, tarihsiz', () => {
    assert.equal(getPisiTodoDateBucket(daysFromNow(-1), NOW), 'overdue');
    assert.equal(getPisiTodoDateBucket(daysFromNow(-400), NOW), 'overdue');
    assert.equal(getPisiTodoDateBucket(daysFromNow(0), NOW), 'today');
    assert.equal(getPisiTodoDateBucket(daysFromNow(1), NOW), 'upcoming');
    assert.equal(getPisiTodoDateBucket(daysFromNow(7), NOW), 'upcoming');
    assert.equal(getPisiTodoDateBucket(daysFromNow(8), NOW), 'later');

    for (const undated of [null, undefined, '2026-11-13', new Date(NaN)]) {
        assert.equal(getPisiTodoDateBucket(undated, NOW), 'undated');
    }
});

test('kova günün saatine bakmaz', () => {
    assert.equal(getPisiTodoDateBucket(daysFromNow(0, 23), new Date(2026, 10, 13, 0, 1)), 'today');
    assert.equal(getPisiTodoDateBucket(daysFromNow(0, 0), new Date(2026, 10, 13, 23, 59)), 'today');
    assert.equal(getPisiTodoDateBucket(daysFromNow(1, 0), new Date(2026, 10, 13, 23, 59)), 'upcoming');
});

test('tarih filtreleri kovaları kullanır; bilinmeyen filtre "tümü" sayılır', () => {
    assert.deepEqual(
        PISI_TODO_FILTER_OPTIONS.map((item) => item.value),
        ['all', 'today', 'upcoming', 'overdue', 'undated']
    );
    assert.equal(getPisiTodoFilterOption(' UPCOMING ').value, 'upcoming');
    assert.equal(getPisiTodoFilterOption('later').value, 'all');

    const todo = (offset) => ({ finishDate: offset === null ? null : daysFromNow(offset) });
    const listed = (filter) => [-3, 0, 2, 7, 8, null].filter((offset) => matchesPisiTodoFilter(todo(offset), filter, NOW));

    assert.deepEqual(listed('all'), [-3, 0, 2, 7, 8, null]);
    assert.deepEqual(listed('today'), [0]);
    assert.deepEqual(listed('upcoming'), [2, 7]);
    assert.deepEqual(listed('overdue'), [-3]);
    assert.deepEqual(listed('undated'), [null]);
    // A task more than a week away is in no dated view; it shows only under "all".
    assert.equal(
        ['today', 'upcoming', 'overdue', 'undated'].some((filter) => matchesPisiTodoFilter(todo(8), filter, NOW)),
        false
    );
});

test('etiketten görünüm bilgisi: öncelik, bitiş günü, kalan gün, kova ve iş sırası', () => {
    const upcoming = parsePisiTodoTagValue('todo.4.20-11-2026', NOW);
    assert.equal(upcoming.tag, 'todo.4.20-11-2026');
    assert.equal(upcoming.priority, 4);
    assert.equal(upcoming.priorityLabel, 'high');
    assert.equal(upcoming.finishDate.getTime(), new Date(2026, 10, 20).getTime());
    assert.equal(upcoming.daysLeft, 7);
    assert.equal(upcoming.dateBucket, 'upcoming');
    assert.equal(upcoming.workorder, 1.75);

    const overdue = parsePisiTodoTagValue('todo.5.10-11-2026', NOW);
    assert.equal(overdue.daysLeft, -3);
    assert.equal(overdue.dateBucket, 'overdue');

    const undated = parsePisiTodoTagValue('..todo.2.none', NOW);
    assert.equal(undated.tag, 'todo.2.none');
    assert.equal(undated.finishDate, null);
    assert.equal(undated.daysLeft, null);
    assert.equal(undated.dateBucket, 'undated');
    assert.equal(undated.workorder, Number.POSITIVE_INFINITY);
});

test('etiket: iki haneli yıl ve 5 üstü eski öncelik kabul edilir, geçersiz etiket reddedilir', () => {
    const legacy = parsePisiTodoTagValue('todo.8.13-11-26', NOW);
    assert.equal(legacy.rawPriority, 8);
    assert.equal(legacy.priority, 5);
    assert.equal(legacy.legacyPriority, true);
    assert.equal(legacy.dateBucket, 'today');

    for (const invalid of ['todo.3.31-02-2026', 'todo.0.none', 'todo.3', 'etiket', '', null]) {
        assert.equal(parsePisiTodoTagValue(invalid, NOW), null, String(invalid));
    }
});

test('görevin etiketi: kayıttaki etiket, yoksa önceliğe göre tarihsiz etiket', () => {
    assert.equal(getPisiTaskTodoTag({ todoTag: 'todo.4.20-11-2026', priority: 1 }), 'todo.4.20-11-2026');
    assert.equal(getPisiTaskTodoTag({ priority: 5 }), 'todo.5.none');
    assert.equal(getPisiTaskTodoTag({ todoTag: '' }), 'todo.3.none');
    assert.equal(getPisiTaskTodoTag(null), 'todo.3.none');

    // Lists place a task by its tag: a due date alone does not date it.
    const listedBy = (task) => parsePisiTodoTagValue(getPisiTaskTodoTag(task), NOW).dateBucket;
    assert.equal(listedBy({ todoTag: 'todo.3.13-11-2026', dueDate: '2026-12-31' }), 'today');
    assert.equal(listedBy({ priority: 3, dueDate: '2026-11-13' }), 'undated');
});

test('takvim günü: planlanan gün, yoksa bitiş tarihi, yoksa son tarih', () => {
    assert.equal(getPisiTaskCalendarIsoDate({ scheduledAt: '2026-11-20T10:00', dueDate: '2026-11-21', deadline: '2026-11-22' }), '2026-11-20');
    assert.equal(getPisiTaskCalendarIsoDate({ scheduledAt: null, dueDate: '2026-11-21', deadline: '2026-11-22' }), '2026-11-21');
    assert.equal(getPisiTaskCalendarIsoDate({ deadline: '2026-11-22T18:00' }), '2026-11-22');
    assert.equal(getPisiTaskCalendarIsoDate({ scheduledAt: 'yarın', dueDate: '', deadline: undefined }), null);
    assert.equal(getPisiTaskCalendarIsoDate({ scheduledAt: 'geçersiz', dueDate: '2026-11-21' }), '2026-11-21');
    assert.equal(getPisiTaskCalendarIsoDate({}), null);
});
