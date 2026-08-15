'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

async function loadCore() {
    return import(pathToFileURL(
        path.join(root, 'renderer/navigation/pisi-navigation-core.mjs')
    ).href);
}

test('task navigation exact identity has deterministic priority', async () => {
    const { selectPisiTaskNavigationCandidate } = await loadCore();
    const cases = [];

    for (let index = 0; index < 10; index += 1) {
        const expected = {
            taskId: `task_exact_${index}`,
            blockId: `wrong_${index}`,
            nodePath: `/project/moved-${index}.node`,
            todoTag: 'todo.1.none',
            sourceText: `Expected ${index}`
        };
        cases.push({
            target: {
                taskId: `task_exact_${index}`,
                blockId: `blk_old_${index}`,
                nodePath: `/project/old-${index}.node`,
                todoTag: 'todo.5.none',
                sourceText: `Old ${index}`
            },
            candidates: [
                {
                    taskId: `task_other_${index}`,
                    blockId: `blk_old_${index}`,
                    nodePath: `/project/old-${index}.node`,
                    todoTag: 'todo.5.none',
                    sourceText: `Old ${index}`
                },
                expected
            ],
            expected
        });
    }

    for (let index = 10; index < 20; index += 1) {
        const expected = {
            blockId: `blk_${index}`,
            nodePath: `/project/node-${index}.node`,
            todoTag: 'todo.3.none',
            sourceText: `Task ${index}`
        };
        cases.push({
            target: {
                blockId: `blk_${index}`,
                nodePath: `/project/stale-${index}.node`,
                todoTag: 'todo.3.none',
                sourceText: `Task ${index}`
            },
            candidates: [
                {
                    blockId: `blk_other_${index}`,
                    nodePath: `/project/stale-${index}.node`,
                    todoTag: 'todo.3.none',
                    sourceText: `Task ${index}`
                },
                expected
            ],
            expected
        });
    }

    for (let index = 20; index < 30; index += 1) {
        const expected = {
            nodePath: `/project/node-${index}.node`,
            todoTag: `todo.${(index % 5) + 1}.none`,
            sourceText: `Task ${index}`
        };
        cases.push({
            target: { ...expected },
            candidates: [
                {
                    nodePath: `/project/other-${index}.node`,
                    todoTag: expected.todoTag,
                    sourceText: expected.sourceText
                },
                expected
            ],
            expected
        });
    }

    for (let index = 30; index < 40; index += 1) {
        const expected = {
            nodePath: `/project/node-${index}.node`,
            sourceText: `Unique task text ${index}`
        };
        cases.push({
            target: { sourceText: expected.sourceText },
            candidates: [
                {
                    nodePath: `/project/other-${index}.node`,
                    sourceText: `Other ${index}`
                },
                expected
            ],
            expected
        });
    }

    for (let index = 40; index < 50; index += 1) {
        const expected = {
            taskId: `task_combo_${index}`,
            blockId: `blk_combo_${index}`,
            nodePath: `/project/node-${index}.node`,
            todoTag: 'todo.2.none',
            sourceText: `Combo ${index}`
        };
        cases.push({
            target: { ...expected },
            candidates: [
                { ...expected, taskId: `task_wrong_${index}` },
                { ...expected, blockId: `blk_wrong_${index}` },
                { ...expected, nodePath: `/project/wrong-${index}.node` },
                expected
            ],
            expected
        });
    }

    assert.equal(cases.length, 50);
    for (const [index, scenario] of cases.entries()) {
        const result = selectPisiTaskNavigationCandidate(
            scenario.candidates,
            scenario.target
        );
        assert.equal(
            result?.candidate,
            scenario.expected,
            `navigation core case ${index + 1}/50 failed`
        );
    }
});

test('todo navigation resolves canonical task then opens node and exact block context', () => {
    const navigation = read('renderer/tags/pisi-todo-navigation.mjs');

    assert.match(navigation, /getPisiCanonicalTaskForNavigation/);
    assert.match(navigation, /resolvePisiTaskNavigationSource/);
    assert.match(navigation, /recoverPisiTaskNavigationSource/);
    assert.match(navigation, /data\.pisiTaskId/);
    assert.match(navigation, /openPisiFileTab/);
    assert.match(navigation, /highlightPisiEditorBlock/);
    assert.match(navigation, /pisi:task-navigation-complete/);
});

test('task clicks no longer stop at the currently visible map node box', () => {
    const navigation = read('renderer/tags/pisi-todo-navigation.mjs');
    const start = navigation.indexOf('async function openPisiTagBlockResult');
    const end = navigation.indexOf('const moduleApi', start);
    const implementation = navigation.slice(start, end);

    assert.match(implementation, /navigatePisiTaskToSource/);
    assert.doesNotMatch(implementation, /openNodeModalFromBox/);
    assert.doesNotMatch(implementation, /\.map-node-box/);
});
