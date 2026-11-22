// Task tags (docs/task-plan.md G6): the stored form, the lenient read of a
// record on disk, the strict check of a request and the copy rule.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PISI_TASK_TAG_LIMIT,
    isSamePisiTaskTag,
    makePisiTaskCopyFields,
    normalizePisiTask,
    normalizePisiTaskTag,
    normalizePisiTaskTags,
    readPisiTask
} from '../shared/task-model.mjs';

const NOW = new Date(2026, 10, 22, 9, 0);
const NOTE = 'node_0b6a3c1e-7d2f-4a8b-9c5e-1f2a3b4c5d6e';
const options = { now: NOW, makeUuid: () => 'uuid-1' };

test('a tag is stored without # and follows the note tag characters', () => {
    const cases = [
        ['#proje', 'proje'],
        ['  çalışma  ', 'çalışma'],
        ['iş..ön.', 'iş.ön'],
        ['Q4-hedef_1', 'Q4-hedef_1'],
        ['iki kelime', null],
        ['virgül,', null],
        ['#', null],
        ['', null],
        ['x'.repeat(65), null],
        [3, null]
    ];
    for (const [input, expected] of cases) assert.equal(normalizePisiTaskTag(input), expected, JSON.stringify(input));
    assert.equal(normalizePisiTaskTag('x'.repeat(64)), 'x'.repeat(64));
});

test('a tag list keeps the first spelling of each tag, the order and the limit', () => {
    assert.deepEqual(normalizePisiTaskTags(['Proje', '#proje', 'acil', 'PROJE', 'boş değer', 'İş', 'iş']), ['Proje', 'acil', 'İş']);
    assert.deepEqual(normalizePisiTaskTags('proje'), []);
    assert.deepEqual(normalizePisiTaskTags(null), []);
    const many = Array.from({ length: 30 }, (_, index) => `t${index}`);
    assert.equal(normalizePisiTaskTags(many).length, PISI_TASK_TAG_LIMIT);
    assert.equal(isSamePisiTaskTag('#Proje', 'proje'), true);
    assert.equal(isSamePisiTaskTag('proje', 'proj'), false);
    assert.equal(isSamePisiTaskTag('', ''), false);
});

test('a record on disk is read leniently: a missing or broken tags field is an empty list', () => {
    const id = 'task_uuid-a1';
    assert.deepEqual(readPisiTask({ id, title: 'Eski' }).tags, [], 'a version 1 record has no tags');
    assert.deepEqual(readPisiTask({ id, tags: 'proje' }).tags, []);
    assert.deepEqual(readPisiTask({ id, tags: ['#proje', 'iki kelime', 'Proje', 'acil'] }).tags, ['proje', 'acil']);
});

test('a request is checked strictly: an invalid tag or more than the limit is an error, not a silent fix', () => {
    const created = normalizePisiTask({ title: 'A', noteId: NOTE, tags: ['#proje', 'Proje', 'acil'] }, null, options);
    assert.equal(created.ok, true);
    assert.deepEqual(created.task.tags, ['proje', 'acil']);

    const invalid = normalizePisiTask({ tags: ['proje', 'iki kelime'] }, created.task, options);
    assert.deepEqual(invalid.errors, [{ field: 'tags', code: 'invalid' }]);
    assert.deepEqual(normalizePisiTask({ tags: 'proje' }, created.task, options).errors, [{ field: 'tags', code: 'invalid' }]);
    const tooMany = Array.from({ length: PISI_TASK_TAG_LIMIT + 1 }, (_, index) => `t${index}`);
    assert.deepEqual(normalizePisiTask({ tags: tooMany }, created.task, options).errors, [{ field: 'tags', code: 'too-many' }]);
    const duplicates = [...Array.from({ length: PISI_TASK_TAG_LIMIT }, (_, index) => `t${index}`), 'T0'];
    assert.equal(normalizePisiTask({ tags: duplicates }, created.task, options).ok, true, 'duplicates do not count against the limit');

    const cleared = normalizePisiTask({ tags: [] }, created.task, options);
    assert.deepEqual(cleared.task.tags, []);
    const untouched = normalizePisiTask({ title: 'B' }, created.task, options);
    assert.deepEqual(untouched.task.tags, ['proje', 'acil'], 'a request without tags keeps them');
});

test('a copy of a task takes its tags over', () => {
    const task = readPisiTask({ id: 'task_uuid-a1', title: 'A', tags: ['proje'], status: 'done', noteId: NOTE });
    const copy = makePisiTaskCopyFields(task);
    assert.deepEqual(copy.tags, ['proje']);
    assert.notEqual(copy.tags, task.tags, 'the copy has its own list');
    assert.equal(copy.status, 'todo');
});
