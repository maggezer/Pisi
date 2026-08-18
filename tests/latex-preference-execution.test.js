'use strict';

const assert = require('node:assert/strict');
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

global.window = {};
global.document = {
    readyState: 'loading',
    body: null,
    head: { appendChild() {} },
    addEventListener() {},
    querySelector() { return null; },
    getElementById() { return null; }
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
            return { preferences, unified };
        })();
    }
    return modulesPromise;
}

test('LaTeX preference gates both menu item creation and execution', async () => {
    const { preferences, unified } = await loadModules();
    localStorage.clear();

    assert.equal(preferences.getPisiLatexCommandsPreference(), true);
    assert.ok(unified.makePisiUnifiedLatexItems({ trigger: '/', body: 'frac' }).length > 0);

    preferences.setPisiLatexCommandsPreference(false);
    assert.equal(preferences.getPisiLatexCommandsPreference(), false);
    assert.deepEqual(
        unified.makePisiUnifiedLatexItems({ trigger: '/', body: 'frac' }),
        []
    );

    let rangeRequests = 0;
    window.makeRangeInElementByTextOffsets = () => {
        rangeRequests += 1;
        throw new Error('LaTeX range must not be created while support is disabled');
    };

    const editor = {
        focus() {
            throw new Error('Editor must not be focused by disabled LaTeX execution');
        },
        dispatchEvent() {
            throw new Error('Disabled LaTeX execution must not dispatch input');
        }
    };
    const command = {
        trigger: '/',
        body: 'frac',
        block: {},
        tokenStartInText: 0,
        tokenEndInText: 5
    };
    const item = {
        ...unified.PISI_LATEX_COMMANDS.find((record) => record.id === 'frac'),
        kind: 'latex'
    };

    assert.equal(
        await unified.runPisiUnifiedCommandItem(editor, command, item),
        false
    );
    assert.equal(
        unified.insertPisiLatexTemplate(editor, command, item.template),
        false
    );
    assert.equal(rangeRequests, 0);
});

test('switching LaTeX off immediately closes stale unified command state', async () => {
    const { preferences, unified } = await loadModules();
    localStorage.clear();
    preferences.setPisiLatexCommandsPreference(true);

    const menu = {
        hidden: false,
        cleared: false,
        replaceChildren() {
            this.cleared = true;
        },
        classList: {
            remove() {}
        }
    };
    document.getElementById = (id) => id === 'pisi-tag-menu' ? menu : null;
    unified.pisiUnifiedCommandState.active = true;
    unified.pisiUnifiedCommandState.editor = {};
    unified.pisiUnifiedCommandState.command = { trigger: '/', body: 'frac' };
    unified.pisiUnifiedCommandState.items = [{ kind: 'latex', id: 'frac' }];

    assert.equal(preferences.setPisiLatexCommandsPreference(false), false);
    assert.equal(menu.hidden, true);
    assert.equal(menu.cleared, true);
    assert.equal(unified.pisiUnifiedCommandState.active, false);
    assert.deepEqual(unified.pisiUnifiedCommandState.items, []);
});
