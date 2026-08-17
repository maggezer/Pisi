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
    const listeners = Object.create(null);
    return {
        tagName: String(tagName).toUpperCase(),
        className: '',
        classList: makeClassList(),
        dataset: {},
        children: [],
        hidden: false,
        textContent: '',
        listeners,
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
        addEventListener(type, handler) {
            if (!listeners[type]) listeners[type] = [];
            listeners[type].push(handler);
        },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        },
        contains(node) {
            return node === this || this.children.includes(node);
        }
    };
}

let activeMenu = null;

global.localStorage = localStorageMock;
global.window = {
    PISI_BLOCK_SLASH_COMMANDS: [
        { id: 'paragraph', label: 'Paragraf', slash: 'paragraph', action: 'block' },
        { id: 'heading1', label: 'Başlık 1', slash: 'heading1', action: 'block' },
        { id: 'bullet', label: 'Madde', slash: 'bullet', action: 'block' },
        { id: 'number', label: 'Numara', slash: 'number', action: 'block' },
        { id: 'task', label: 'Görev', slash: 'todo', action: 'todo' },
        { id: 'done', label: 'Tamamlandı', slash: 'done', action: 'done' }
    ]
};
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
            const unified = await import(pathToFileURL(
                path.join(root, 'renderer/editor/pisi-unified-command-menu.mjs')
            ).href);
            const routing = await import(pathToFileURL(
                path.join(root, 'renderer/editor/pisi-editor-command-routing.mjs')
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

function resetMenuState(unified) {
    unified.pisiUnifiedCommandState.active = false;
    unified.pisiUnifiedCommandState.editor = null;
    unified.pisiUnifiedCommandState.command = null;
    unified.pisiUnifiedCommandState.items = [];
    unified.pisiUnifiedCommandState.selectedIndex = 0;
    activeMenu = makeElement('div');
    activeMenu.hidden = true;
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

test('/ and .. build one command menu with formatting, lists, todo/done and LaTeX but no tags', async () => {
    const { preferences, routing } = await loadModules();
    localStorage.clear();
    preferences.setPisiDoubleDotCommandsPreference(true);
    preferences.setPisiLatexCommandsPreference(true);

    for (const trigger of ['/', '..']) {
        const items = routing.buildPisiFinalCommandItems({ trigger, body: '' });
        const kinds = items.map((item) => item.kind);
        const ids = new Set(items.map((item) => item.id));

        assert.ok(kinds.includes('format'));
        assert.ok(kinds.includes('block'));
        assert.ok(kinds.includes('todo-start'));
        assert.ok(kinds.includes('todo-done'));
        assert.ok(kinds.includes('latex'));
        assert.ok(!kinds.includes('user'));
        assert.ok(!kinds.includes('new-user'));
        assert.ok(!kinds.includes('system'));
        assert.ok(ids.has('bold'));
        assert.ok(ids.has('italic'));
        assert.ok(ids.has('bullet'));
        assert.ok(ids.has('number'));
        assert.ok(ids.has('todo'));
        assert.ok(ids.has('done'));
        assert.ok(ids.has('frac'));

        assert.equal(
            items.find((item) => item.id === 'bullet')?.category,
            'Formatting · Lists'
        );
        assert.equal(
            items.find((item) => item.id === 'number')?.category,
            'Formatting · Lists'
        );
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

    assert.ok(
        routing.buildPisiFinalCommandItems({ trigger: '/', body: '' })
            .some((item) => item.kind === 'latex')
    );

    preferences.setPisiLatexCommandsPreference(false);
    assert.equal(preferences.getPisiLatexCommandsPreference(), false);
    assert.ok(
        !routing.buildPisiFinalCommandItems({ trigger: '/', body: '' })
            .some((item) => item.kind === 'latex')
    );
});

test('routed /frac menu click removes the token and inserts the LaTeX template', async () => {
    const { preferences, routing, unified } = await loadModules();
    localStorage.clear();
    preferences.setPisiLatexCommandsPreference(true);
    resetMenuState(unified);

    let deleted = false;
    let insertedNode = null;
    let caretOffset = null;
    let focused = false;
    let dispatchedInput = null;

    window.makeRangeInElementByTextOffsets = () => ({
        deleteContents() {
            deleted = true;
        },
        insertNode(node) {
            insertedNode = node;
        }
    });
    document.createTextNode = (value) => ({ nodeValue: String(value) });
    document.createRange = () => ({
        setStart(node, offset) {
            assert.equal(node, insertedNode);
            caretOffset = offset;
        },
        collapse() {}
    });
    window.getSelection = () => ({
        removeAllRanges() {},
        addRange() {}
    });
    global.InputEvent = class InputEvent {
        constructor(type, init = {}) {
            this.type = type;
            Object.assign(this, init);
        }
    };

    const editor = {
        focus() {
            focused = true;
        },
        dispatchEvent(event) {
            dispatchedInput = event;
            return true;
        }
    };
    const command = {
        trigger: '/',
        body: 'frac',
        block: {},
        tokenStartInText: 0,
        tokenEndInText: 5,
        editor
    };

    assert.equal(routing.renderPisiRoutedUnifiedMenu(editor, command), true);
    assert.deepEqual(
        unified.pisiUnifiedCommandState.items.map((item) => item.id),
        ['frac']
    );

    const fragment = activeMenu.children[0];
    const option = fragment.children.find((child) => child.tagName === 'BUTTON');
    assert.ok(option, 'final routed LaTeX option should be rendered as a button');
    assert.equal(option.listeners.mousedown?.length, 1);

    option.listeners.mousedown[0]({
        preventDefault() {},
        stopPropagation() {}
    });

    assert.equal(deleted, true);
    assert.equal(insertedNode?.nodeValue, '\\frac{}{}');
    assert.equal(caretOffset, '\\frac{'.length);
    assert.equal(focused, true);
    assert.equal(dispatchedInput?.type, 'input');
    assert.equal(dispatchedInput?.inputType, 'insertText');
    assert.equal(dispatchedInput?.data, '\\frac{}{}');
});

test('.. commands preference defaults on and gates the alternate command menu', async () => {
    const { preferences, routing } = await loadModules();
    localStorage.clear();

    assert.equal(preferences.getPisiDoubleDotCommandsPreference(), true);
    assert.ok(routing.buildPisiFinalCommandItems({ trigger: '..', body: '' }).length > 0);

    preferences.setPisiDoubleDotCommandsPreference(false);
    assert.equal(preferences.getPisiDoubleDotCommandsPreference(), false);
    assert.deepEqual(routing.buildPisiFinalCommandItems({ trigger: '..', body: '' }), []);

    preferences.setPisiDoubleDotCommandsPreference(true);
    assert.equal(preferences.getPisiDoubleDotCommandsPreference(), true);
    assert.ok(routing.buildPisiFinalCommandItems({ trigger: '..', body: '' }).length > 0);
});

test('production source has one / and .. menu renderer and no legacy menu/parser implementation', () => {
    const routing = read('renderer/editor/pisi-editor-command-routing.mjs');
    const unified = read('renderer/editor/pisi-unified-command-menu.mjs');
    const formatting = read('renderer/editor/pisi-unified-command-formatting.mjs');
    const blocks = read('renderer/editor/pisi-block-editor.mjs');
    const tags = read('renderer/tags/pisi-tag-editor.mjs');

    assert.match(routing, /function renderPisiRoutedUnifiedMenu/);
    assert.match(routing, /function buildPisiFinalCommandItems/);
    assert.match(routing, /runPisiExtendedUnifiedCommandItem\(editor, command, item\)/);
    assert.match(routing, /editor\.addEventListener\('keydown',[\s\S]*true\);/);

    assert.doesNotMatch(unified, /addEventListener\('keydown'|initializePisiUnifiedEditorCommandMenu|renderPisiUnifiedCommandMenu/);
    assert.doesNotMatch(formatting, /installPisiUnifiedCommandFormatting|renderPisiExtendedUnifiedMenu|addEventListener\('input'/);
    assert.doesNotMatch(blocks, /pisi-block-slash-menu|openPisiSlashMenu|isPisiSlashMenuOpen/);
    assert.doesNotMatch(tags, /getPisiEditorCommandAtCaret|updatePisiTagMenuForEditor|buildPisiTagMenuItems/);
});

test('Preferences UI exposes and wires LaTeX and .. command toggles', () => {
    const source = read('renderer/editor/pisi-editor-command-preferences.mjs');
    const bootstrap = read('renderer/bootstrap.mjs');

    assert.match(source, /id: 'pisi-preference-latex-commands'/);
    assert.match(source, /labelText: 'LaTeX support'/);
    assert.match(source, /setValue: setPisiLatexCommandsPreference/);
    assert.match(source, /id: 'pisi-preference-double-dot-commands'/);
    assert.match(source, /labelText: '\.\. commands'/);
    assert.match(source, /setValue: setPisiDoubleDotCommandsPreference/);
    assert.match(source, /pisi:editor-command-preferences-changed/);

    const preferenceIndex = bootstrap.indexOf('pisi-editor-command-preferences.mjs');
    const tagEditorIndex = bootstrap.indexOf('pisi-tag-editor.mjs');
    const authorityIndex = bootstrap.indexOf('pisi-editor-command-authority.mjs');
    const routingIndex = bootstrap.indexOf('pisi-editor-command-routing.mjs');

    assert.ok(preferenceIndex >= 0);
    assert.ok(tagEditorIndex > preferenceIndex);
    assert.ok(authorityIndex > tagEditorIndex);
    assert.ok(routingIndex > authorityIndex);
});
