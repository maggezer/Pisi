import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePisiTodoTagValue } from '../renderer/tags/pisi-todo-utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('kısa tarihli ..todo sözdizimi görev metadata etiketi olarak ayrıştırılır', () => {
    const todo = parsePisiTodoTagValue('..todo.4.07-08-26', new Date(2026, 7, 7));
    assert.equal(todo?.tag, 'todo.4.07-08-26');
    assert.equal(todo?.priority, 4);
    assert.equal(todo?.finishDate?.getFullYear(), 2026);
    assert.equal(todo?.daysLeft, 0);
});

test('Markdown çıktısı görünmez todo ve done etiketlerini dışarı sızdırmaz', () => {
    const blockEditor = read('renderer/editor/pisi-block-editor.mjs');
    assert.match(blockEditor, /node\.matches\('\.pisi-task-metadata'\)/);
    assert.match(blockEditor, /data-pisi-tag\^="todo\."/);
    assert.match(blockEditor, /data-pisi-tag="done"/);
});
