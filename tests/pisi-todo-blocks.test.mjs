import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePisiTodoTagValue } from '../renderer/tags/pisi-todo-utils.mjs';

test('kısa tarihli ..todo sözdizimi görev metadata etiketi olarak ayrıştırılır', () => {
    const todo = parsePisiTodoTagValue('..todo.4.07-08-26', new Date(2026, 7, 7));
    assert.equal(todo?.tag, 'todo.4.07-08-26');
    assert.equal(todo?.priority, 4);
    assert.equal(todo?.finishDate?.getFullYear(), 2026);
    assert.equal(todo?.daysLeft, 0);
});
