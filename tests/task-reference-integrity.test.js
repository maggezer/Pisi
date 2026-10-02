'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function installTaskStoreTestGlobals() {
    globalThis.readJsonFileResult = (filePath) => {
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            return { ok: true, raw, data: JSON.parse(raw) };
        } catch (error) {
            return { ok: false, error: error.message, data: null };
        }
    };
    globalThis.writeFileAtomic = (filePath, content) => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
    };
}

function loadTaskModules() {
    installTaskStoreTestGlobals();
    const registry = require('../main/module-registry');
    if (!registry.modules['main.taskCapture']) {
        registry.registerMainModule('main.taskCapture', {
            quickAddPisiTask() {
                return { ok: false, error: 'not used in integrity tests' };
            }
        });
    }
    require('../main/functions/task-store');
    require('../main/functions/task-reference-integrity');
    return {
        taskStore: registry.modules['main.taskStore'],
        integrity: registry.modules['main.taskReferenceIntegrity']
    };
}

function makeProject() {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-task-ref-'));
    fs.mkdirSync(path.join(project, '.pisi'), { recursive: true });
    return project;
}

function putTask(taskStore, project, index, overrides = {}) {
    const id = overrides.id || `task_ref_${String(index).padStart(3, '0')}`;
    const nodePath = overrides.nodePath || path.join(project, 'nodes', `Node ${index}.node`);
    const mapPath = overrides.mapPath === undefined ? path.join(project, 'Project.map') : overrides.mapPath;
    const blockId = overrides.blockId || `block-ref-${String(index).padStart(3, '0')}`;
    const result = taskStore.upsertPisiFirstClassTask(project, {
        id,
        title: overrides.title || `Task ${index}`,
        status: 'todo',
        priority: 3,
        todoTag: 'todo.3.none',
        source: {
            nodePath,
            blockId,
            mapPath,
            nodeTitle: overrides.nodeTitle || `Node ${index}`,
            mapTitle: 'Project'
        }
    });
    assert.equal(result.ok, true);
    return result.task;
}

const modules = loadTaskModules();
const navigationCorePromise = import(pathToFileURL(path.join(root, 'renderer/navigation/pisi-navigation-core.mjs')).href);

test('node rename rewrites nodePath while taskId and blockId remain stable', () => {
    const project = makeProject();
    try {
        const oldPath = path.join(project, 'nodes', 'Original.node');
        const newPath = path.join(project, 'nodes', 'Renamed.node');
        const before = [];
        for (let index = 0; index < 20; index += 1) {
            before.push(putTask(modules.taskStore, project, index, { nodePath: oldPath }));
        }

        const rewritten = modules.integrity.rewritePisiTaskSourcePaths(project, [{ oldPath, newPath }]);
        assert.equal(rewritten.ok, true);
        assert.equal(rewritten.updated, 20);

        const after = modules.taskStore.listPisiFirstClassTasks(project).tasks;
        assert.equal(after.length, 20);
        for (let index = 0; index < after.length; index += 1) {
            assert.equal(after[index].id, before[index].id);
            assert.equal(after[index].source.blockId, before[index].source.blockId);
            assert.equal(after[index].source.nodePath, newPath);
        }
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('folder and map move rewrite descendant nodePath and mapPath without changing identities', () => {
    const project = makeProject();
    try {
        const oldMap = path.join(project, 'A', 'Research.map');
        const newMap = path.join(project, 'B', 'Research.map');
        const oldSidecar = path.join(project, 'A', 'nd_Research__map_ref');
        const newSidecar = path.join(project, 'B', 'nd_Research__map_ref');
        const before = [];

        for (let index = 0; index < 20; index += 1) {
            before.push(
                putTask(modules.taskStore, project, 100 + index, {
                    nodePath: path.join(oldSidecar, 'nested', `Node ${index}.node`),
                    mapPath: oldMap,
                    blockId: `block-move-${index}`
                })
            );
        }

        const rewritten = modules.integrity.rewritePisiTaskSourcePaths(project, [
            { oldPath: oldMap, newPath: newMap },
            { oldPath: oldSidecar, newPath: newSidecar }
        ]);
        assert.equal(rewritten.ok, true);
        assert.equal(rewritten.updated, 20);

        const after = modules.taskStore.listPisiFirstClassTasks(project).tasks;
        for (let index = 0; index < after.length; index += 1) {
            assert.equal(after[index].id, before[index].id);
            assert.equal(after[index].source.blockId, before[index].source.blockId);
            assert.equal(after[index].source.mapPath, newMap);
            assert.equal(after[index].source.nodePath, path.join(newSidecar, 'nested', `Node ${index}.node`));
        }
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('moving a task between nodes and changing blockId preserves canonical taskId', () => {
    const project = makeProject();
    try {
        const task = putTask(modules.taskStore, project, 250, {
            nodePath: path.join(project, 'A.node'),
            blockId: 'block-before'
        });
        const moved = modules.taskStore.updatePisiFirstClassTask(project, task.id, {
            source: {
                ...task.source,
                nodePath: path.join(project, 'B.node'),
                blockId: 'block-after',
                nodeTitle: 'B'
            }
        });
        assert.equal(moved.ok, true);
        assert.equal(moved.task.id, task.id);
        assert.equal(moved.task.source.nodePath, path.join(project, 'B.node'));
        assert.equal(moved.task.source.blockId, 'block-after');
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('deleted task identity disappears and a stale projection is explicitly rejected', async () => {
    const project = makeProject();
    try {
        const task = putTask(modules.taskStore, project, 300);
        assert.equal(modules.taskStore.deletePisiFirstClassTask(project, task.id).removed, true);
        assert.equal(modules.taskStore.deletePisiFirstClassTask(project, task.id).removed, false);
        assert.equal(
            modules.taskStore.listPisiFirstClassTasks(project).tasks.some((item) => item.id === task.id),
            false
        );
        assert.equal(modules.taskStore.updatePisiFirstClassTask(project, task.id, { title: 'stale' }).ok, false);

        const { shouldRejectMissingPisiCanonicalTask } = await navigationCorePromise;
        assert.equal(
            shouldRejectMissingPisiCanonicalTask(
                {
                    taskId: task.id,
                    nodePath: task.source.nodePath,
                    blockId: task.source.blockId
                },
                null
            ),
            true
        );
        assert.equal(
            shouldRejectMissingPisiCanonicalTask(
                {
                    nodePath: task.source.nodePath,
                    blockId: task.source.blockId
                },
                null
            ),
            false,
            'generic non-task block links retain their legacy fallback'
        );
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('recovery rejects stale copies and deterministically selects the exact moved task', async () => {
    const { isPisiTaskNavigationCandidateAccepted, selectPisiTaskNavigationCandidate } = await navigationCorePromise;

    for (let index = 0; index < 50; index += 1) {
        const taskId = `task_recovery_${String(index).padStart(3, '0')}`;
        const oldBlockId = `block-old-${index}`;
        const target = {
            taskId,
            blockId: oldBlockId,
            nodePath: `/project/old/Node-${index}.node`,
            todoTag: 'todo.3.none',
            sourceText: `Task ${index}`
        };
        const staleCopy = {
            taskId: `task_stale_${String(index).padStart(3, '0')}`,
            blockId: oldBlockId,
            nodePath: target.nodePath,
            todoTag: target.todoTag,
            sourceText: target.sourceText
        };
        const unprovenCopy = {
            taskId: '',
            blockId: oldBlockId,
            nodePath: `/project/copy/Node-${index}.node`,
            todoTag: target.todoTag,
            sourceText: target.sourceText
        };
        const movedExact = {
            taskId,
            blockId: `block-new-${index}`,
            nodePath: `/project/new/Node-${index}.node`,
            todoTag: target.todoTag,
            sourceText: target.sourceText
        };

        assert.equal(isPisiTaskNavigationCandidateAccepted(staleCopy, target, { scope: 'recovery' }), false);
        assert.equal(isPisiTaskNavigationCandidateAccepted(unprovenCopy, target, { scope: 'recovery' }), false);
        assert.equal(isPisiTaskNavigationCandidateAccepted(movedExact, target, { scope: 'recovery' }), true);
        assert.equal(
            selectPisiTaskNavigationCandidate([staleCopy, unprovenCopy, movedExact], target, { scope: 'recovery' })?.candidate,
            movedExact,
            `recovery case ${index + 1}/50 selected a stale reference`
        );
    }
});

test('direct canonical node keeps blockId fallback only when no conflicting taskId is present', async () => {
    const { isPisiTaskNavigationCandidateAccepted } = await navigationCorePromise;
    const target = {
        taskId: 'task_direct_0001',
        blockId: 'block-direct',
        nodePath: '/project/Node.node'
    };

    assert.equal(
        isPisiTaskNavigationCandidateAccepted(
            {
                blockId: 'block-direct',
                nodePath: '/project/Node.node'
            },
            target,
            { scope: 'direct' }
        ),
        true
    );

    assert.equal(
        isPisiTaskNavigationCandidateAccepted(
            {
                taskId: 'task_conflict_0001',
                blockId: 'block-direct',
                nodePath: '/project/Node.node'
            },
            target,
            { scope: 'direct' }
        ),
        false
    );

    assert.equal(
        isPisiTaskNavigationCandidateAccepted(
            {
                blockId: 'block-direct',
                nodePath: '/project/Other.node'
            },
            target,
            { scope: 'direct' }
        ),
        false
    );
});

test('task identity survives editor sanitation and recovery repairs canonical source fields', () => {
    const sanitizer = read('renderer/editor/pisi-node-editor.mjs');
    const taskStore = read('renderer/tags/pisi-task-store.mjs');
    const navigation = read('renderer/tags/pisi-todo-navigation.mjs');

    assert.match(sanitizer, /'data-pisi-task-id'/);
    assert.match(taskStore, /block\.dataset\.pisiTaskId = taskId/);
    assert.match(taskStore, /tag\.dataset\.pisiTaskId = taskId/);
    assert.match(navigation, /op: 'update'/);
    assert.match(navigation, /nodePath: target\.nodePath/);
    assert.match(navigation, /blockId: target\.blockId/);
    assert.match(navigation, /mapPath: target\.mapPath/);
    assert.match(navigation, /code: 'TASK_NOT_FOUND'/);
    assert.match(navigation, /scope: 'recovery'/);
});

test('task source path rewrite layer is part of the main module graph', () => {
    const bootstrap = read('main.js');
    const integrity = read('main/functions/task-reference-integrity.js');

    assert.match(bootstrap, /task-store/);
    assert.match(bootstrap, /task-reference-integrity/);
    assert.ok(
        bootstrap.indexOf('task-store') < bootstrap.indexOf('task-reference-integrity'),
        'task reference integrity must load after the canonical task store'
    );
    assert.match(integrity, /rewritePisiTaskSourcePaths/);
    assert.match(integrity, /source\.nodePath/);
    assert.match(integrity, /source\.mapPath/);
});
