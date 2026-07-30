'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (filePath) => fs.readFileSync(path.join(root, filePath), 'utf8');
const utilsPromise = import(
    pathToFileURL(path.join(root, 'renderer/tags/pisi-todo-utils.mjs')).href
);

test('todo önem dereceleri 1-5 ve beklenen etiketlerdir', async () => {
    const { PISI_TODO_PRIORITY_OPTIONS } = await utilsPromise;
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
});

test('yeni todo etiketi yalnızca 1-5 ile üretilir', async () => {
    const { formatPisiTodoTag } = await utilsPromise;
    assert.equal(formatPisiTodoTag(3, '2026-07-30'), 'todo.3.30-07-2026');
    assert.equal(formatPisiTodoTag(5, '2026-12-01'), 'todo.5.01-12-2026');
    assert.equal(formatPisiTodoTag(6, '2026-07-30'), null);
    assert.equal(formatPisiTodoTag(0, '2026-07-30'), null);
    assert.equal(formatPisiTodoTag(3, '2026-02-30'), null);
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

test('..todo yazımı öncelik ve tarih seçicisini açar', () => {
    const editorSource = read('renderer/tags/pisi-tag-editor.mjs');
    const cssSource = read('styles/20-map-interactions.css');

    assert.ok(editorSource.includes('isPisiTodoCommand(command)'));
    assert.ok(editorSource.includes('openPisiTodoPriorityMenu(editor, command)'));
    assert.ok(editorSource.includes('type="date"'));
    assert.ok(editorSource.includes('showPicker'));
    assert.ok(editorSource.includes('formatPisiTodoTag(priority.value, dateInput?.value)'));
    assert.ok(cssSource.includes('.pisi-todo-date-input'));
    assert.ok(cssSource.includes('.pisi-todo-picker-actions'));
});
