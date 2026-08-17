'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const storageValues = new Map();
const localStorageMock = {
    getItem(key) {
        return storageValues.has(key) ? storageValues.get(key) : null;
    },
    setItem(key, value) {
        storageValues.set(key, String(value));
    },
    removeItem(key) {
        storageValues.delete(key);
    },
    clear() {
        storageValues.clear();
    }
};

function makeClassList() {
    const values = new Set();
    return {
        add(...names) {
            names.forEach((name) => values.add(name));
        },
        remove(...names) {
            names.forEach((name) => values.delete(name));
        },
        toggle(name, force) {
            if (force === true) {
                values.add(name);
                return true;
            }
            if (force === false) {
                values.delete(name);
                return false;
            }
            if (values.has(name)) {
                values.delete(name);
                return false;
            }
            values.add(name);
            return true;
        },
        contains(name) {
            return values.has(name);
        }
    };
}

function makeElement(tagName = 'div') {
    return {
        tagName: String(tagName).toUpperCase(),
        className: '',
        classList: makeClassList(),
        dataset: {},
        children: [],
        hidden: false,
        textContent: '',
        append(...nodes) {
            this.children.push(...nodes);
        },
        appendChild(node) {
            this.children.push(node);
            return node;
        },
        replaceChildren(...nodes) {
            this.children = [...nodes];
        },
        addEventListener() {},
        querySelector() {
            return null;
        }
    };
}

let activeMenu = null;

global.localStorage = localStorageMock;
global.window = {};
global.document = {
    readyState: 'loading',
    body: null,
    head: { appendChild() {} },
    addEventListener() {},
    querySelector() {
        return null;
    },
    getElementById(id) {
        return id === 'pisi-tag-menu' ? activeMenu : null;
    },
    createElement: makeElement,
    createDocumentFragment() {
        return makeElement('fragment');
    }
};

let modulesPromise = null;
function loadModules() {
    if (!modulesPromise) {
        modulesPromise = (async () => {
            const preferences = await import(pathToFileURL(
                path.join(root, 'renderer/editor/pisi-editor-command-preferences.mjs')
            ).href);
            const routing = await import(pathToFileURL(
                path.join(root, 'renderer/editor/pisi-editor-command-routing.mjs')
            ).href);
            const unified = await import(pathToFileURL(
                path.join(root, 'renderer/editor/pisi-unified-command-menu.mjs')
            ).href);
            return { preferences, routing, unified };
        })();
    }
    return modulesPromise;
}

function parseCaretToken(getPisiTokenAtCaret, text, mode) {
    const startContainer = {};
    const block = {};
    const editor = {
        contains(node) {
            return node === startContainer;
        }
    };
    const range = {
        startContainer,
        startOffset: text.length,
        cloneRange() {
            return {
                selectNodeContents() {},
                setEnd() {},
                toString() {
                    return text;
                }
            };
        }
    };

    window.getSelection = () => ({
        rangeCount: 1,
        isCollapsed: true,
        getRangeAt() {
            return range;
        }
    });
    window.getPisiCurrentEditorBlock = () => block;

    return getPisiTokenAtCaret(editor, mode);
}

function resetUnifiedState(unified, editor, items) {
    unified.pisiUnifiedCommandState.active = true;
    unified.pisiUnifiedCommandState.editor = editor;
    unified.pisiUnifiedCommandState.command = null;
    unified.pisiUnifiedCommandState.items = items.map((item) => ({ ...item }));
    unified.pisiUnifiedCommandState.selectedIndex = 0;
    activeMenu = makeElement('div');
    activeMenu.hidden = true;
}

function makeMixedMenuItems(trigger = '/') {
    return [
        {
            kind: 'user', id: 'project', label: 'project',
            category: 'Tags · User', typedToken: `${trigger}project`, description: 'tag'
        },
        {
            kind: 'new-user', id: 'newtag', label: 'newtag',
            category: 'Tags · User', typedToken: `${trigger}newtag`, description: 'new tag'
        },
        {
            kind: 'system', id: 'h2', label: 'h2',
            category: 'Tags · System', typedToken: `${trigger}h2`, description: 'heading tag'
        },
        {
            kind: 'todo-start', id: 'todo', label: 'todo',
            category: 'Tasks', typedToken: `${trigger}todo`, description: 'Task'
        },
        {
            kind: 'todo-done', id: 'done', label: 'done',
            category: 'Tasks', typedToken: `${trigger}done`, description: 'Done'
        },
        {
            kind: 'latex', id: 'frac', label: 'frac',
            category: 'LaTeX · Yapı', typedToken: `${trigger}frac`, description: 'Fraction'
        },
        {
            kind: 'format', id: 'bold', label: 'Bold',
            category: 'Formatting · Text', typedToken: `${trigger}bold`, description: 'Bold'
        }
    ];
}

test('parser reserves # for tags and / or .. for editor commands', async () => {
    const { routing } = await loadModules();
    const parse = routing.getPisiTokenAtCaret;

    const hash = parseCaretToken(parse, '#project', 'tag');
    assert.equal(hash?.trigger, '#');
    assert.equal(hash?.body, 'project');

    assert.equal(parseCaretToken(parse, '/project', 'tag'), null);
    assert.equal(parseCaretToken(parse, '..project', 'tag'), null);
    assert.equal(parseCaretToken(parse, '#project', 'command'), null);

    const slash = parseCaretToken(parse, '/todo', 'command');
    assert.equal(slash?.trigger, '/');
    assert.equal(slash?.body, 'todo');

    const doubleDot = parseCaretToken(parse, '..done', 'command');
    assert.equal(doubleDot?.trigger, '..');
    assert.equal(doubleDot?.body, 'done');
});

test('hash-tag menu creates tags only from # tokens', async () => {
    const { routing } = await loadModules();

    window.collectPisiUserTagSuggestions = () => ['project', 'research', 'todo', 'done'];
    window.isValidPisiUserTag = (value) => /^[A-Za-z0-9_-]+$/.test(String(value || ''));

    const items = routing.buildPisiHashTagItems({
        trigger: '#',
        body: 'pro',
        editor: {}
    });
    assert.ok(items.some((item) => item.kind === 'user' && item.typedToken === '#project'));
    assert.ok(items.every((item) => item.typedToken.startsWith('#')));

    const newItems = routing.buildPisiHashTagItems({
        trigger: '#',
        body: 'brandnew',
        editor: {}
    });
    assert.ok(newItems.some((item) => item.kind === 'new-user' && item.typedToken === '#brandnew'));

    assert.deepEqual(routing.buildPisiHashTagItems({ trigger: '/', body: 'project' }), []);
    assert.deepEqual(routing.buildPisiHashTagItems({ trigger: '..', body: 'project' }), []);
});

test('/ and .. routed menus remove tag commands but preserve todo and done', async () => {
    const { preferences, routing, unified } = await loadModules();
    localStorage.clear();
    preferences.setPisiDoubleDotCommandsPreference(true);
    preferences.setPisiLatexCommandsPreference(true);

    const editor = {};
    for (const trigger of ['/', '..']) {
        resetUnifiedState(unified, editor, makeMixedMenuItems(trigger));
        const rendered = routing.renderPisiRoutedUnifiedMenu(editor, {
            trigger,
            body: '',
            editor
        });

        assert.equal(rendered, true);
        const kinds = unified.pisiUnifiedCommandState.items.map((item) => item.kind);
        assert.ok(!kinds.includes('user'));
        assert.ok(!kinds.includes('new-user'));
        assert.ok(!kinds.includes('system'));
        assert.ok(kinds.includes('todo-start'));
        assert.ok(kinds.includes('todo-done'));
        assert.ok(kinds.includes('latex'));
        assert.ok(kinds.includes('format'));
    }
});

test('standard LaTeX snippets are available by default and disappear when preference is off', async () => {
    const { preferences, routing, unified } = await loadModules();
    localStorage.clear();

    assert.equal(preferences.getPisiLatexCommandsPreference(), true);

    const byId = new Map(unified.PISI_LATEX_COMMANDS.map((item) => [item.id, item]));
    assert.equal(byId.get('frac')?.template, '\\frac{__PISI_CURSOR__}{}');
    assert.equal(byId.get('sqrt')?.template, '\\sqrt{__PISI_CURSOR__}');
    assert.match(byId.get('sum')?.template || '', /^\\sum_/);
    assert.match(byId.get('int')?.template || '', /^\\int_/);
    assert.match(byId.get('matrix')?.template || '', /^\\begin\{matrix\}/);

    const editor = {};
    resetUnifiedState(unified, editor, makeMixedMenuItems('/'));
    assert.equal(routing.renderPisiRoutedUnifiedMenu(editor, { trigger: '/', body: '', editor }), true);
    assert.ok(unified.pisiUnifiedCommandState.items.some((item) => item.kind === 'latex'));

    preferences.setPisiLatexCommandsPreference(false);
    assert.equal(preferences.getPisiLatexCommandsPreference(), false);

    resetUnifiedState(unified, editor, makeMixedMenuItems('/'));
    assert.equal(routing.renderPisiRoutedUnifiedMenu(editor, { trigger: '/', body: '', editor }), true);
    assert.ok(!unified.pisiUnifiedCommandState.items.some((item) => item.kind === 'latex'));
});

test('.. commands preference defaults on and gates the alternate command menu', async () => {
    const { preferences, routing, unified } = await loadModules();
    localStorage.clear();

    assert.equal(preferences.getPisiDoubleDotCommandsPreference(), true);

    const editor = {};
    resetUnifiedState(unified, editor, makeMixedMenuItems('..'));
    assert.equal(routing.renderPisiRoutedUnifiedMenu(editor, { trigger: '..', body: '', editor }), true);

    preferences.setPisiDoubleDotCommandsPreference(false);
    assert.equal(preferences.getPisiDoubleDotCommandsPreference(), false);
    resetUnifiedState(unified, editor, makeMixedMenuItems('..'));
    assert.equal(routing.renderPisiRoutedUnifiedMenu(editor, { trigger: '..', body: '', editor }), false);

    preferences.setPisiDoubleDotCommandsPreference(true);
    assert.equal(preferences.getPisiDoubleDotCommandsPreference(), true);
    resetUnifiedState(unified, editor, makeMixedMenuItems('..'));
    assert.equal(routing.renderPisiRoutedUnifiedMenu(editor, { trigger: '..', body: '', editor }), true);
});

test('Preferences UI exposes and wires LaTeX and .. command toggles', () => {
    const source = read('renderer/editor/pisi-editor-command-preferences.mjs');
    const bootstrap = read('renderer/bootstrap.mjs');
    const routing = read('renderer/editor/pisi-editor-command-routing.mjs');

    assert.match(source, /getPisiLatexCommandsPreference\(\)[\s\S]*PISI_LATEX_COMMANDS_STORAGE_KEY, true/);
    assert.match(source, /getPisiDoubleDotCommandsPreference\(\)[\s\S]*PISI_DOUBLE_DOT_COMMANDS_STORAGE_KEY, true/);
    assert.match(source, /id: 'pisi-preference-latex-commands'/);
    assert.match(source, /labelText: 'LaTeX support'/);
    assert.match(source, /setValue: setPisiLatexCommandsPreference/);
    assert.match(source, /id: 'pisi-preference-double-dot-commands'/);
    assert.match(source, /labelText: '\.\. commands'/);
    assert.match(source, /setValue: setPisiDoubleDotCommandsPreference/);
    assert.match(source, /setValue\(!getValue\(\)\)/);
    assert.match(source, /pisi:editor-command-preferences-changed/);

    const preferenceIndex = bootstrap.indexOf('pisi-editor-command-preferences.mjs');
    const tagEditorIndex = bootstrap.indexOf('pisi-tag-editor.mjs');
    const routingIndex = bootstrap.indexOf('pisi-editor-command-routing.mjs');
    assert.ok(preferenceIndex >= 0);
    assert.ok(tagEditorIndex >= 0);
    assert.ok(routingIndex > tagEditorIndex);

    assert.match(routing, /kind === 'user' \|\| item\.kind === 'new-user' \|\| item\.kind === 'system'/);
    assert.match(routing, /body === 'todo'/);
    assert.match(routing, /body === 'done'/);
    assert.match(routing, /editor\.addEventListener\('keydown',[\s\S]*true\);/);
});
