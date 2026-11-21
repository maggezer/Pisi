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
        { id: 'bullet', label: 'Bullet', slash: 'bullet', action: 'block' }
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
        assert.ok(!commandIds.has('todo'));
        assert.ok(!commandIds.has('done'));
    }
});

// The task commands (/todo, /done) are closed until the editor makes tasks from the task store
// (docs/task-plan.md G2, G3): with LaTeX off, / and .. offer nothing.
test('LaTeX support off leaves no / and .. commands while the task commands are closed (G2)', async () => {
    const { preferences, routing } = await loadModules();
    localStorage.clear();
    preferences.setPisiDoubleDotCommandsPreference(true);
    preferences.setPisiLatexCommandsPreference(false);

    for (const trigger of ['/', '..']) {
        assert.deepEqual(routing.buildPisiFinalCommandItems({ trigger, body: '' }), []);
        assert.deepEqual(routing.buildPisiFinalCommandItems({ trigger, body: 'todo' }), []);
        assert.deepEqual(routing.buildPisiFinalCommandItems({ trigger, body: 'done' }), []);
        assert.deepEqual(routing.buildPisiFinalCommandItems({ trigger, body: 'bold' }), []);
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
