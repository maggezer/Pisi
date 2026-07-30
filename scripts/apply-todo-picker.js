'use strict';

const fs = require('fs');

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
    fs.writeFileSync(filePath, content, 'utf8');
}

function replaceOnce(source, search, replacement, label) {
    if (source.includes(replacement)) return source;
    const index = source.indexOf(search);
    if (index === -1) {
        throw new Error(`Expected source fragment not found: ${label}`);
    }
    return source.slice(0, index) + replacement + source.slice(index + search.length);
}

function replaceRegex(source, pattern, replacement, label) {
    if (source.includes(replacement)) return source;
    if (!pattern.test(source)) {
        throw new Error(`Expected source pattern not found: ${label}`);
    }
    return source.replace(pattern, replacement);
}

const todoUtils = `export const PISI_TODO_PRIORITY_OPTIONS = Object.freeze([
    Object.freeze({ value: 1, label: 'very low' }),
    Object.freeze({ value: 2, label: 'low' }),
    Object.freeze({ value: 3, label: 'medium' }),
    Object.freeze({ value: 4, label: 'high' }),
    Object.freeze({ value: 5, label: 'very high' })
]);

export function getPisiTodoPriorityOption(value) {
    const priority = Number(value);
    return PISI_TODO_PRIORITY_OPTIONS.find((item) => item.value === priority) || null;
}

function normalizePisiTodoTagValue(value) {
    return String(value || '')
        .trim()
        .replace(/^(?:\\.\\.|\\/|#)/, '')
        .replace(/\\.+/g, '.')
        .replace(/^\\.|\\.$/g, '')
        .toLowerCase();
}

function parsePisiTodoIsoDate(value) {
    const match = String(value || '').match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    date.setHours(0, 0, 0, 0);
    return date;
}

export function getPisiTodayIsoDate(now = new Date()) {
    const date = new Date(now);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return \`${'${year}'}-${'${month}'}-${'${day}'}\`;
}

export function formatPisiTodoTag(priorityValue, isoDate) {
    const priority = Number(priorityValue);
    const priorityOption = getPisiTodoPriorityOption(priority);
    const date = parsePisiTodoIsoDate(isoDate);

    if (!priorityOption || !date) return null;

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());

    return \`todo.${'${priority}'}.${'${day}'}-${'${month}'}-${'${year}'}\`;
}

export function parsePisiTodoTagValue(tag, now = new Date()) {
    const normalized = normalizePisiTodoTagValue(tag);
    const match = normalized.match(
        /^todo\\.([1-9])\\.(\\d{2})-(\\d{2})-(\\d{2}|\\d{4})$/
    );

    if (!match) return null;

    const rawPriority = Number(match[1]);
    const priority = Math.min(rawPriority, 5);
    const priorityOption = getPisiTodoPriorityOption(priority);
    const day = Number(match[2]);
    const month = Number(match[3]);
    const year = match[4].length === 2
        ? 2000 + Number(match[4])
        : Number(match[4]);
    const finishDate = new Date(year, month - 1, day);

    if (
        finishDate.getFullYear() !== year ||
        finishDate.getMonth() !== month - 1 ||
        finishDate.getDate() !== day
    ) {
        return null;
    }

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    finishDate.setHours(0, 0, 0, 0);

    const daysLeft = Math.floor(
        (finishDate.getTime() - today.getTime()) / 86400000
    );

    return {
        tag: normalized,
        rawPriority,
        priority,
        priorityLabel: priorityOption.label,
        legacyPriority: rawPriority > 5,
        finishDate,
        daysLeft,
        workorder: daysLeft / priority
    };
}
`;

write('renderer/tags/pisi-todo-utils.mjs', todoUtils);

let panels = read('renderer/tags/pisi-tag-panels.mjs');
panels = replaceOnce(
    panels,
    'import { registerModule } from "../core/module-registry.mjs";\n',
    'import { registerModule } from "../core/module-registry.mjs";\nimport { parsePisiTodoTagValue } from "./pisi-todo-utils.mjs";\n',
    'todo parser import'
);
panels = replaceRegex(
    panels,
    /function parsePisiTodoTag\(tag\) \{[\s\S]*?\n\}\n\nfunction formatPisiMissionDate/,
    `function parsePisiTodoTag(tag) {
    return parsePisiTodoTagValue(normalizePisiUserTag(tag));
}

function formatPisiMissionDate`,
    'todo parser implementation'
);
panels = replaceOnce(
    panels,
    '                priority: todo.priority,\n                finishDate: todo.finishDate,',
    '                priority: todo.priority,\n                priorityLabel: todo.priorityLabel,\n                rawPriority: todo.rawPriority,\n                finishDate: todo.finishDate,',
    'mission priority metadata'
);
panels = replaceOnce(
    panels,
    '                    <span>workorder: ${mission.workorder.toFixed(2)}</span>',
    '                    <span class="pisi-mission-priority" data-priority="${mission.priority}">\n                        priority: ${mission.priority} ${escapeHtml(mission.priorityLabel)}\n                    </span>\n                    <span>workorder: ${mission.workorder.toFixed(2)}</span>',
    'mission priority label'
);
write('renderer/tags/pisi-tag-panels.mjs', panels);

let editor = read('renderer/tags/pisi-tag-editor.mjs');
editor = replaceOnce(
    editor,
    'import { registerModule } from "../core/module-registry.mjs";\n',
    `import { registerModule } from "../core/module-registry.mjs";
import {
    PISI_TODO_PRIORITY_OPTIONS,
    formatPisiTodoTag,
    getPisiTodoPriorityOption,
    getPisiTodayIsoDate
} from "./pisi-todo-utils.mjs";
`,
    'todo editor imports'
);

const todoHelpers = `

function isPisiTodoCommand(command) {
    return String(command?.body || '').trim().toLowerCase() === 'todo';
}

function buildPisiTodoPriorityItems() {
    return PISI_TODO_PRIORITY_OPTIONS.map((option) => ({
        kind: 'todo-priority',
        id: \`todo-priority-${'${option.value}'}\`,
        label: String(option.value),
        typedToken: String(option.value),
        description: option.label,
        priority: option.value
    }));
}

function openPisiTodoPriorityMenu(editor, commandOverride = null) {
    const command =
        commandOverride ||
        pisiTagMenuState.command ||
        getPisiEditorCommandAtCaret(editor);

    if (!command) return;

    openPisiTagMenuForEditor(editor, {
        ...command,
        mode: 'todo-priority',
        items: buildPisiTodoPriorityItems()
    });
}

function openPisiTodoDateMenu(editor, priorityValue, commandOverride = null) {
    const menu = document.getElementById('pisi-tag-menu');
    const priority = getPisiTodoPriorityOption(priorityValue);
    const command = commandOverride || pisiTagMenuState.command;

    if (!menu || !priority || !command) return;

    pisiTagMenuState = {
        active: true,
        mode: 'todo-date',
        editor,
        command,
        selectedIndex: 0,
        items: [],
        todoPriority: priority.value
    };

    menu.innerHTML = \`
        <div class="pisi-todo-picker">
            <div class="pisi-todo-picker-title">Finish date</div>
            <div class="pisi-todo-priority-summary">
                ${'${priority.value}'} — ${'${pisiEscapeHtml(priority.label)}'}
            </div>
            <input
                class="pisi-todo-date-input"
                type="date"
                value="${'${getPisiTodayIsoDate()}'}"
                aria-label="Todo finish date"
            >
            <div class="pisi-todo-picker-actions">
                <button class="pisi-todo-back" type="button">Back</button>
                <button class="pisi-todo-apply" type="button">Add</button>
            </div>
        </div>
    \`;

    const dateInput = menu.querySelector('.pisi-todo-date-input');
    const backButton = menu.querySelector('.pisi-todo-back');
    const applyButton = menu.querySelector('.pisi-todo-apply');

    const commitTodo = () => {
        const todoTag = formatPisiTodoTag(priority.value, dateInput?.value);

        if (!todoTag) {
            dateInput?.setCustomValidity('Choose a valid date.');
            dateInput?.reportValidity();
            return;
        }

        dateInput.setCustomValidity('');
        applyPisiUserTagToEditor(editor, todoTag, command);
    };

    dateInput?.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });
    dateInput?.addEventListener('change', commitTodo);
    dateInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            commitTodo();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closePisiTagMenu();
            editor.focus();
        }
    });

    backButton?.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPisiTodoPriorityMenu(editor, command);
    });

    applyButton?.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        commitTodo();
    });

    menu.hidden = false;
    positionPisiTagMenuAtSelection();

    dateInput?.focus({ preventScroll: true });
    try {
        dateInput?.showPicker?.();
    } catch {
        // Native picker may require a direct user gesture; the input remains usable.
    }
}
`;

editor = replaceRegex(
    editor,
    /const PISI_SYSTEM_TAGS = \[[\s\S]*?\n\];/,
    (match) => `${match}${todoHelpers}`,
    'todo helper insertion'
);

editor = replaceOnce(
    editor,
    `            if (command && command.body && !getExactPisiSystemTag(command.body)) {
                event.preventDefault();
                applyPisiUserTagToEditor(editor, command.body, command);
                return;
            }`,
    `            if (isPisiTodoCommand(command)) {
                event.preventDefault();
                openPisiTodoPriorityMenu(editor, command);
                return;
            }

            if (command && command.body && !getExactPisiSystemTag(command.body)) {
                event.preventDefault();
                applyPisiUserTagToEditor(editor, command.body, command);
                return;
            }`,
    'space todo interception'
);

editor = replaceOnce(
    editor,
    '    const exactSystem = getExactPisiSystemTag(command.body);',
    `    if (isPisiTodoCommand(command)) {
        openPisiTodoPriorityMenu(editor, command);
        return;
    }

    const exactSystem = getExactPisiSystemTag(command.body);`,
    'exact todo interception'
);

editor = replaceOnce(
    editor,
    '    const items = [];\n\n    const systemItems = PISI_SYSTEM_TAGS',
    `    const items = [];

    if (!body.includes('.') && 'todo'.startsWith(lowerBody)) {
        items.push({
            kind: 'todo-start',
            id: 'todo',
            label: 'todo',
            typedToken: \`${'${command.trigger}'}todo\`,
            description: 'Task'
        });
    }

    const systemItems = PISI_SYSTEM_TAGS`,
    'todo menu suggestion'
);

editor = replaceOnce(
    editor,
    `    const userItems = collectPisiUserTagSuggestions(command.editor)
        .filter((tag) => {
            if (!body) return true;
            return tag.toLowerCase().startsWith(lowerBody);
        })`,
    `    const userItems = collectPisiUserTagSuggestions(command.editor)
        .filter((tag) => !/^todo(?:\\.|$)/i.test(tag))
        .filter((tag) => {
            if (!body) return true;
            return tag.toLowerCase().startsWith(lowerBody);
        })`,
    'hide todo tags from generic suggestions'
);

editor = replaceOnce(
    editor,
    `    pisiTagMenuState = {
        active: true,
        editor,
        command,
        selectedIndex: 0,
        items: command.items
    };`,
    `    pisiTagMenuState = {
        active: true,
        mode: command.mode || 'tags',
        editor,
        command,
        selectedIndex: 0,
        items: command.items,
        todoPriority: null
    };`,
    'tag menu state mode'
);

editor = replaceRegex(
    editor,
    /function applyPisiTagMenuItem\(editor, item\) \{[\s\S]*?\n\}/,
    `function applyPisiTagMenuItem(editor, item) {
    if (!item) return;

    const command = pisiTagMenuState.command;

    if (item.kind === 'todo-start') {
        openPisiTodoPriorityMenu(editor, command);
        return;
    }

    if (item.kind === 'todo-priority') {
        openPisiTodoDateMenu(editor, item.priority, command);
        return;
    }

    if (item.kind === 'system') {
        applyPisiSystemTagToEditor(editor, item);
        return;
    }

    applyPisiUserTagToEditor(editor, item.label);
}`,
    'todo menu item application'
);

editor = replaceOnce(
    editor,
    `    pisiTagMenuState = {
        active: false,
        editor: null,
        command: null,
        selectedIndex: 0,
        items: []
    };`,
    `    pisiTagMenuState = {
        active: false,
        mode: null,
        editor: null,
        command: null,
        selectedIndex: 0,
        items: [],
        todoPriority: null
    };`,
    'tag menu reset state'
);
write('renderer/tags/pisi-tag-editor.mjs', editor);

let state = read('renderer/core/state.mjs');
state = replaceOnce(
    state,
    `                previousState.pisiTagMenuState ?? {
                    active: false,
                    command: '',
                    range: null,
                    items: [],
                    selectedIndex: 0
                },`,
    `                previousState.pisiTagMenuState ?? {
                    active: false,
                    mode: null,
                    editor: null,
                    command: null,
                    items: [],
                    selectedIndex: 0,
                    todoPriority: null
                },`,
    'default todo menu state'
);
write('renderer/core/state.mjs', state);

let css = read('styles/20-map-interactions.css');
const todoCss = `

.pisi-tag-option.todo-start .pisi-tag-option-code,
.pisi-tag-option.todo-priority .pisi-tag-option-code {
    color: #2ecc71;
}

.pisi-todo-picker {
    width: 240px;
    max-width: calc(100vw - 36px);
    padding: 5px;
}

.pisi-todo-picker-title {
    color: #f39c12;
    font-size: 12px;
    font-weight: 850;
    margin-bottom: 7px;
}

.pisi-todo-priority-summary {
    min-height: 28px;
    display: flex;
    align-items: center;
    border-radius: 7px;
    background: rgba(46, 204, 113, 0.1);
    color: #8ee8b5;
    padding: 5px 8px;
    margin-bottom: 8px;
    font-size: 12px;
    font-weight: 800;
}

.pisi-todo-date-input {
    width: 100%;
    height: 34px;
    border: 1px solid #555;
    border-radius: 8px;
    outline: none;
    background: #1e1e1e;
    color: #d4d4d4;
    color-scheme: dark;
    padding: 0 8px;
    font: inherit;
}

.pisi-todo-date-input:focus {
    border-color: #f39c12;
    box-shadow: 0 0 0 2px rgba(243, 156, 18, 0.18);
}

.pisi-todo-picker-actions {
    display: flex;
    justify-content: flex-end;
    gap: 7px;
    margin-top: 9px;
}

.pisi-todo-picker-actions button {
    min-width: 68px;
    height: 30px;
    border: 1px solid #444;
    border-radius: 7px;
    background: #2d2d30;
    color: #d4d4d4;
    cursor: pointer;
    font-size: 11px;
    font-weight: 800;
}

.pisi-todo-picker-actions button:hover {
    border-color: #f39c12;
    background: #333;
}

.pisi-todo-picker-actions .pisi-todo-apply {
    border-color: #2ecc71;
    background: #247a49;
    color: white;
}

.pisi-mission-priority {
    color: #8ee8b5;
    font-weight: 750;
}
`;
if (!css.includes('.pisi-todo-picker {')) {
    css += todoCss;
}
write('styles/20-map-interactions.css', css);

const todoTest = `'use strict';

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

    assert.match(editorSource, /isPisiTodoCommand\(command\)/);
    assert.match(editorSource, /openPisiTodoPriorityMenu\(editor, command\)/);
    assert.match(editorSource, /type="date"/);
    assert.match(editorSource, /showPicker/);
    assert.match(editorSource, /formatPisiTodoTag\(priority\.value, dateInput\?\.value\)/);
    assert.match(cssSource, /\.pisi-todo-date-input/);
    assert.match(cssSource, /\.pisi-todo-picker-actions/);
});
`;
write('tests/todo-tag.test.js', todoTest);

console.log('Todo priority and date picker changes applied.');
