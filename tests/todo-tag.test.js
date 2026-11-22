'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (filePath) => fs.readFileSync(path.join(root, filePath), 'utf8');
const readJson = (filePath) => JSON.parse(read(filePath));
// The version 1 todo grammar (shared/task-model.mjs, shared/task-views.mjs): old records and the fixture generator's version 1 mode still carry it.
const utilsPromise = Promise.all([
    import(pathToFileURL(path.join(root, 'shared/task-model.mjs')).href),
    import(pathToFileURL(path.join(root, 'shared/task-views.mjs')).href)
]).then(([model, views]) => ({ ...model, ...views }));

test('todo önem dereceleri 1-5 ve mevcut sözdizimi korunur', async () => {
    const { PISI_TODO_PRIORITY_OPTIONS, formatPisiTodoTag } = await utilsPromise;

    assert.deepEqual(
        PISI_TODO_PRIORITY_OPTIONS.map(({ value, label }) => ({ value, label })),
        [
            { value: 1, label: 'very low' },
            { value: 2, label: 'low' },
            { value: 3, label: 'medium' },
            { value: 4, label: 'high' },
            { value: 5, label: 'very high' }
        ]
    );
    assert.equal(formatPisiTodoTag(3, '2026-07-30'), 'todo.3.30-07-2026');
    assert.equal(formatPisiTodoTag(5, '2026-12-01'), 'todo.5.01-12-2026');
    assert.equal(formatPisiTodoTag(6, '2026-07-30'), null);
    assert.equal(formatPisiTodoTag(0, '2026-07-30'), null);
    assert.equal(formatPisiTodoTag(3, '2026-02-30'), null);
});

test('tarihsiz görev mevcut todo sözdiziminin geriye uyumlu uzantısıdır', async () => {
    const { formatPisiTodoTag, parsePisiTodoTagValue } = await utilsPromise;

    assert.equal(formatPisiTodoTag(2, 'none'), 'todo.2.none');
    assert.equal(formatPisiTodoTag(2, ''), 'todo.2.none');

    const task = parsePisiTodoTagValue('..todo.2.none', new Date(2026, 7, 4));
    assert.equal(task.tag, 'todo.2.none');
    assert.equal(task.priority, 2);
    assert.equal(task.finishDate, null);
    assert.equal(task.daysLeft, null);
    assert.equal(task.dateBucket, 'undated');
    assert.equal(task.workorder, Number.POSITIVE_INFINITY);
});

test('eski 6-9 todo etiketleri very high olarak geriye dönük okunur', async () => {
    const { parsePisiTodoTagValue } = await utilsPromise;
    const now = new Date(2026, 6, 30);
    const current = parsePisiTodoTagValue('todo.4.31-07-2026', now);
    const legacy = parsePisiTodoTagValue('..todo.9.31-07-2026', now);

    assert.equal(current.priority, 4);
    assert.equal(current.priorityLabel, 'high');
    assert.equal(current.daysLeft, 1);
    assert.equal(legacy.rawPriority, 9);
    assert.equal(legacy.priority, 5);
    assert.equal(legacy.priorityLabel, 'very high');
    assert.equal(legacy.legacyPriority, true);
});

test('bugün, yaklaşan, geciken ve tarihsiz filtreleri doğru sınıflandırır', async () => {
    const { getPisiTodoDateBucket, matchesPisiTodoFilter, parsePisiTodoTagValue } = await utilsPromise;
    const now = new Date(2026, 7, 4);
    const today = parsePisiTodoTagValue('todo.3.04-08-2026', now);
    const upcoming = parsePisiTodoTagValue('todo.3.10-08-2026', now);
    const later = parsePisiTodoTagValue('todo.3.20-08-2026', now);
    const overdue = parsePisiTodoTagValue('todo.3.03-08-2026', now);
    const undated = parsePisiTodoTagValue('todo.3.none', now);

    assert.equal(getPisiTodoDateBucket(today.finishDate, now), 'today');
    assert.equal(getPisiTodoDateBucket(upcoming.finishDate, now), 'upcoming');
    assert.equal(getPisiTodoDateBucket(later.finishDate, now), 'later');
    assert.equal(getPisiTodoDateBucket(overdue.finishDate, now), 'overdue');
    assert.equal(getPisiTodoDateBucket(undated.finishDate, now), 'undated');
    assert.equal(matchesPisiTodoFilter(today, 'today', now), true);
    assert.equal(matchesPisiTodoFilter(upcoming, 'upcoming', now), true);
    assert.equal(matchesPisiTodoFilter(later, 'upcoming', now), false);
    assert.equal(matchesPisiTodoFilter(overdue, 'overdue', now), true);
    assert.equal(matchesPisiTodoFilter(undated, 'undated', now), true);
    assert.equal(matchesPisiTodoFilter(later, 'all', now), true);
});
