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

test('todo ve done bütün editör girişlerinden aynı blok görev modeline bağlanır', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const tagEditor = read('renderer/tags/pisi-tag-editor.mjs');
    const routing = read('renderer/editor/pisi-editor-command-routing.mjs');
    const unifiedMenu = read('renderer/editor/pisi-unified-command-menu.mjs');
    const blockEditor = read('renderer/editor/pisi-block-editor.mjs');
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    const todoBlocks = read('renderer/tags/pisi-todo-blocks.mjs');
    const sanitizer = read('renderer/editor/pisi-node-editor.mjs');
    const styles = read('styles/58-workspaces-platform.css');

    assert.match(bootstrap, /tags\/pisi-todo-blocks\.mjs/);
    assert.match(routing, /function buildPisiFinalCommandItems/);
    assert.match(routing, /runPisiExtendedUnifiedCommandItem/);
    assert.match(unifiedMenu, /item\.kind === 'todo-start'/);
    assert.match(unifiedMenu, /openPisiTodoPriorityMenu/);
    assert.match(unifiedMenu, /item\.kind === 'todo-done'/);
    assert.match(unifiedMenu, /applyPisiDoneCommandToEditor/);
    assert.doesNotMatch(tagEditor, /parsePisiTodoTagValue\(command\?\.body\)/);
    assert.doesNotMatch(tagEditor, /getPisiEditorCommandAtCaret|updatePisiTagMenuForEditor/);
    assert.match(blockEditor, /slash: record\.id === 'task' \? 'todo'/);
    assert.match(blockEditor, /slash: 'done'/);
    assert.match(toolbar, /data-pisi-todo-trigger/);
    assert.match(toolbar, /openPisiTodoPickerForEditor/);
    assert.match(todoBlocks, /function applyPisiTodoTagToEditor/);
    assert.match(todoBlocks, /function setPisiTodoBlockCompletion/);
    assert.match(todoBlocks, /completeAfterApply/);
    assert.match(sanitizer, /data-pisi-todo-checkbox/);
    assert.match(styles, /pisi-user-tag\.pisi-task-metadata/);
    assert.match(styles, /pisi-block-task-marker\[aria-checked=["\']true["\']\]/);
    assert.match(styles, /vertical-align: middle/);
    assert.match(styles, /transform: translateY\(-1px\)/);
    assert.match(styles, /border: 1px solid #fff/);
});

test('Markdown çıktısı görünmez todo ve done etiketlerini dışarı sızdırmaz', () => {
    const blockEditor = read('renderer/editor/pisi-block-editor.mjs');
    assert.match(blockEditor, /node\.matches\('\.pisi-task-metadata'\)/);
    assert.match(blockEditor, /data-pisi-tag\^="todo\."/);
    assert.match(blockEditor, /data-pisi-tag="done"/);
});

test('Görev bloğunda Enter ile alt satıra geçiş, yetim checkbox temizliği ve klavye navigasyonu korunur', () => {
    const blockEditor = read('renderer/editor/pisi-block-editor.mjs');
    const todoBlocks = read('renderer/tags/pisi-todo-blocks.mjs');
    const editorBlocks = read('renderer/tags/pisi-editor-blocks.mjs');
    const taskStore = read('renderer/tags/pisi-task-store.mjs');
    const tagEditor = read('renderer/tags/pisi-tag-editor.mjs');
    const routing = read('renderer/editor/pisi-editor-command-routing.mjs');

    assert.match(blockEditor, /function getPisiSelectionBlock/);
    assert.match(blockEditor, /function splitPisiTaskBlockOnEnter/);
    assert.match(blockEditor, /if \(splitPisiTaskBlockOnEnter\(editor, block, event\)\) return;/);
    assert.match(blockEditor, /function handlePisiTaskBlockBackspace/);
    assert.match(blockEditor, /if \(handlePisiTaskBlockBackspace\(editor, block, event\)\) return;/);
    assert.match(todoBlocks, /function cleanupOrphanPisiTodoBlock/);
    assert.match(todoBlocks, /function removePisiTodoFromBlock/);
    assert.match(todoBlocks, /function healSplitPisiTodoBlock/);
    assert.match(todoBlocks, /function ensurePisiTodoSourceTextNode/);
    assert.match(todoBlocks, /function absorbStrayNodesIntoPisiTodoSource/);
    assert.match(todoBlocks, /function placeCaretInPisiTodoSource/);
    assert.doesNotMatch(todoBlocks, /marker\.after\(document\.createTextNode\(' '\)\)/);
    assert.match(editorBlocks, /const seenBlockIds = new Set\(\);/);
    assert.match(editorBlocks, /if \(didMutateDom && selectionSnapshot\)/);
    assert.match(taskStore, /function extractCleanPisiTaskTitleFromBlock/);
    assert.match(taskStore, /const seenTaskIds = new Set\(\);/);
    assert.match(tagEditor, /pisiTagMenuState\.mode === 'todo-priority'/);
    assert.match(tagEditor, /pisiTagMenuState\.mode === 'todo-date'/);
    assert.match(routing, /function isPisiTodoStepMenuActive/);
});
