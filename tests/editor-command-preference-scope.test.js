'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const storageValues = new Map();

global.localStorage = {
    getItem(key) {
        return storageValues.has(key) ? storageValues.get(key) : null;
    },
    setItem(key, value) {
        storageValues.set(key, String(value));
    },
    clear() {
        storageValues.clear();
    }
};

global.window = {
    PISI_BLOCK_SLASH_COMMANDS: [
        { id: 'paragraph', label: 'Paragraph', slash: 'paragraph', action: 'block' },
        { id: 'bullet', label: 'Bullet', slash: 'bullet', action: 'block' },
        { id: 'task', label: 'Todo', slash: 'todo', action: 'todo' },
        { id: 'done', label: 'Done', slash: 'done', action: 'done' }
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
    getElementById() {
        return null;
    }
};

let modulesPromise = null;
function loadModules() {
    if (!modulesPromise) {
        modulesPromise = (async () => {
            const preferences = await import(pathToFileURL(path.join(root, 'renderer/editor/pisi-editor-command-preferences.mjs')).href);
            const routing = await import(pathToFileURL(path.join(root, 'renderer/editor/pisi-editor-command-routing.mjs')).href);
            return { preferences, routing };
        })();
    }
    return modulesPromise;
}

function ids(items) {
    return new Set(items.map((item) => item.id));
}

test('LaTeX support on exposes the full / and .. command sets', async () => {
    const { preferences, routing } = await loadModules();
    localStorage.clear();
    preferences.setPisiDoubleDotCommandsPreference(true);
    preferences.setPisiLatexCommandsPreference(true);

    for (const trigger of ['/', '..']) {
        const commandIds = ids(routing.buildPisiFinalCommandItems({ trigger, body: '' }));
        assert.ok(commandIds.has('bold'));
        assert.ok(commandIds.has('italic'));
        assert.ok(commandIds.has('paragraph'));
        assert.ok(commandIds.has('bullet'));
        assert.ok(commandIds.has('frac'));
        assert.ok(commandIds.has('todo'));
        assert.ok(commandIds.has('done'));
    }
});

test('LaTeX support off leaves only todo and done for / and ..', async () => {
    const { preferences, routing } = await loadModules();
    localStorage.clear();
    preferences.setPisiDoubleDotCommandsPreference(true);
    preferences.setPisiLatexCommandsPreference(false);

    for (const trigger of ['/', '..']) {
        const items = routing.buildPisiFinalCommandItems({ trigger, body: '' });
        assert.equal(items.length, 2);
        assert.deepEqual(ids(items), new Set(['todo', 'done']));
        assert.ok(items.every((item) => ['todo-start', 'todo-done'].includes(item.kind)));

        assert.deepEqual(routing.buildPisiFinalCommandItems({ trigger, body: 'bold' }), []);
        assert.deepEqual(routing.buildPisiFinalCommandItems({ trigger, body: 'italic' }), []);
        assert.deepEqual(routing.buildPisiFinalCommandItems({ trigger, body: 'paragraph' }), []);
        assert.deepEqual(routing.buildPisiFinalCommandItems({ trigger, body: 'frac' }), []);
        assert.equal(routing.buildPisiFinalCommandItems({ trigger, body: 'todo' }).length, 1);
        assert.equal(routing.buildPisiFinalCommandItems({ trigger, body: 'done' }).length, 1);
    }
});

test('.. master preference still disables even todo and done', async () => {
    const { preferences, routing } = await loadModules();
    localStorage.clear();
    preferences.setPisiLatexCommandsPreference(false);
    preferences.setPisiDoubleDotCommandsPreference(false);

    assert.deepEqual(routing.buildPisiFinalCommandItems({ trigger: '..', body: '' }), []);
    assert.deepEqual(routing.buildPisiFinalCommandItems({ trigger: '..', body: 'todo' }), []);
});

test('all routed menu execution paths pass through the preference gate', () => {
    const source = fs.readFileSync(path.join(root, 'renderer/editor/pisi-editor-command-routing.mjs'), 'utf8');
    const directRunnerCalls = source.match(/runPisiExtendedUnifiedCommandItem\(/g) || [];

    assert.equal(directRunnerCalls.length, 1);
    assert.match(source, /function isPisiEssentialCommandItem/);
    assert.match(source, /function isPisiRoutedCommandAllowed/);
    assert.match(source, /function runPisiRoutedCommandItem/);
    assert.match(source, /candidates\.filter\(isPisiEssentialCommandItem\)/);
});
