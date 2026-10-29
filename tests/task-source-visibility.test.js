'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { extractFunction } = require('./source-helper');

const source = fs.readFileSync(path.join(__dirname, '../renderer/tags/pisi-todo-navigation.mjs'), 'utf8');

function navigationScenario({ hidden = false, sameNode = true, modal = null, saveSucceeds = true, openSucceeds = true } = {}) {
    const target = { nodePath: '/project/diary/2026-10-29.node', blockId: 'daily-task' };
    const surface = { hidden };
    const calls = [];
    const context = {
        activeCenterNode: { path: sameNode ? target.nodePath : '/project/other.node' },
        activeModalNode: modal,
        document: { getElementById: (id) => (id === 'center-node-editor' ? surface : null) },
        clearPisiMissionHighlight() {},
        getPisiCanonicalTaskForNavigation: () => null,
        shouldRejectMissingPisiCanonicalTask: () => false,
        getPisiTaskNavigationTaskId: () => '',
        resolvePisiTaskNavigationSource: async () => target,
        samePisiPathForTags: (a, b) => Boolean(a && b && a === b),
        makePisiNavigationNodeItem: (value) => ({ fullPath: value.nodePath }),
        highlightPisiEditorBlock: async () => {
            calls.push('highlight');
            return !surface.hidden;
        },
        dispatchPisiTaskNavigationComplete: (result) => result,
        window: {
            closeNodeModalAndSave: async () => {
                calls.push('save-modal');
                return saveSucceeds;
            },
            openPisiFileTab: async (item) => {
                calls.push(['open', item.fullPath]);
                // The normal center-open flow reveals the editor and closes To-Do.
                if (openSucceeds) surface.hidden = false;
                return openSucceeds;
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(`async ${extractFunction(source, 'navigatePisiTaskToSource')}`, context);
    return { run: () => context.navigatePisiTaskToSource(target), calls, surface, target };
}

test('a task click reveals its already-loaded note hidden by the To-Do workspace', async () => {
    const scenario = navigationScenario({ hidden: true });
    const result = await scenario.run();
    assert.equal(result.ok, true);
    assert.equal(scenario.surface.hidden, false);
    assert.deepEqual(scenario.calls, [['open', scenario.target.nodePath], 'highlight']);
});

test('a visible source note is highlighted without reloading its unsaved editor', async () => {
    const scenario = navigationScenario();
    assert.equal((await scenario.run()).ok, true);
    assert.deepEqual(scenario.calls, ['highlight']);
});

test('a task in another note opens its source tab before highlighting', async () => {
    const scenario = navigationScenario({ sameNode: false });
    assert.equal((await scenario.run()).nodeOpened, true);
    assert.deepEqual(scenario.calls, [['open', scenario.target.nodePath], 'highlight']);
});

test('failed modal saves do not reveal or replace the current view', async () => {
    const scenario = navigationScenario({ hidden: true, modal: { path: '/project/modal.node' }, saveSucceeds: false });
    assert.equal((await scenario.run()).code, 'CURRENT_NODE_SAVE_FAILED');
    assert.equal(scenario.surface.hidden, true);
    assert.deepEqual(scenario.calls, ['save-modal']);
});

test('failed source opens do not claim a hidden note was opened', async () => {
    const scenario = navigationScenario({ hidden: true, openSucceeds: false });
    const result = await scenario.run();
    assert.equal(result.code, 'NODE_OPEN_FAILED');
    assert.notEqual(result.nodeOpened, true);
    assert.equal(scenario.surface.hidden, true);
    assert.deepEqual(scenario.calls, [['open', scenario.target.nodePath]]);
});
