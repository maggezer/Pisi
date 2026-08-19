'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

let corePromise = null;
function loadCore() {
    if (!corePromise) {
        corePromise = import(pathToFileURL(
            path.join(root, 'renderer/map/pisi-map-operational-core.mjs')
        ).href);
    }
    return corePromise;
}

function node(id, title, fullPath, properties = {}) {
    return {
        id,
        fullPath,
        fileName: `${title}.node`,
        metadata: { title, updatedAt: '2026-08-15T10:00:00.000Z' },
        properties,
        preview: `${title} preview`
    };
}

function task(id, nodePath, options = {}) {
    return {
        id,
        title: options.title || id,
        status: options.status || 'todo',
        priority: options.priority || 3,
        dueDate: options.dueDate || null,
        dependencies: options.dependencies || [],
        source: { nodePath, blockId: `block_${id}` }
    };
}

test('blocked ve overdue durumları canonical task dependencylerinden node seviyesinde türetilir', async () => {
    const core = await loadCore();
    const nodes = [
        node('node_A', 'A', '/project/A.node'),
        node('node_B', 'B', '/project/B.node')
    ];
    const tasks = [
        task('task_A', '/project/A.node', {
            dueDate: '2026-08-20',
            priority: 2
        }),
        task('task_B', '/project/B.node', {
            dueDate: '2026-08-10',
            dependencies: ['task_A'],
            priority: 1
        })
    ];
    const states = core.buildPisiOperationalNodeStates(
        nodes,
        tasks,
        Date.parse('2026-08-15T12:00:00Z')
    );

    assert.equal(states.get('node_A').blocked, false);
    assert.equal(states.get('node_A').overdue, false);
    assert.equal(states.get('node_B').blocked, true);
    assert.equal(states.get('node_B').overdue, true);
    assert.equal(states.get('node_B').blockedTasks[0].id, 'task_B');
});

test('task dependency overlay yalnız unresolved cross-node dependencyleri üretir', async () => {
    const core = await loadCore();
    const nodes = [
        node('node_A', 'A', '/project/A.node'),
        node('node_B', 'B', '/project/B.node'),
        node('node_C', 'C', '/project/C.node')
    ];
    const tasks = [
        task('task_A', '/project/A.node'),
        task('task_B', '/project/B.node', { dependencies: ['task_A'] }),
        task('task_C', '/project/C.node', { status: 'done' }),
        task('task_B2', '/project/B.node', { dependencies: ['task_C'] })
    ];
    const visible = new Set(['node_A', 'node_B', 'node_C']);
    const projections = core.buildPisiTaskDependencyProjections(nodes, tasks, visible);

    assert.deepEqual(projections, [{
        id: 'task-dependency:node_A->node_B',
        sourceId: 'node_A',
        targetId: 'node_B',
        blockedTaskId: 'task_B',
        dependencyTaskId: 'task_A'
    }]);
});

test('focused neighbor görünümü semantic graph üzerinde deterministic 1-3 hop BFS uygular', async () => {
    const core = await loadCore();
    const edges = [
        { sourceId: 'node_A', targetId: 'node_B' },
        { sourceId: 'node_B', targetId: 'node_C' },
        { sourceId: 'node_C', targetId: 'node_D' },
        { sourceId: 'node_X', targetId: 'node_Y' }
    ];

    assert.deepEqual(
        [...core.collectPisiOperationalNeighborIds('node_A', edges, 1)].sort(),
        ['node_A', 'node_B']
    );
    assert.deepEqual(
        [...core.collectPisiOperationalNeighborIds('node_A', edges, 2)].sort(),
        ['node_A', 'node_B', 'node_C']
    );
    assert.deepEqual(
        [...core.collectPisiOperationalNeighborIds('node_A', edges, 3)].sort(),
        ['node_A', 'node_B', 'node_C', 'node_D']
    );
});

test('operational scope blocked, overdue, next-action ve query filtrelerini tek projectionda uygular', async () => {
    const core = await loadCore();
    const nodes = [
        node('node_A', 'Alpha', '/project/A.node'),
        node('node_B', 'Beta', '/project/B.node'),
        node('node_C', 'Gamma', '/project/C.node')
    ];
    const tasks = [
        task('task_A', '/project/A.node'),
        task('task_B', '/project/B.node', {
            dueDate: '2026-08-10',
            dependencies: ['task_A']
        })
    ];
    const states = core.buildPisiOperationalNodeStates(
        nodes,
        tasks,
        Date.parse('2026-08-15T12:00:00Z')
    );
    const edges = [];

    assert.deepEqual(
        [...core.getPisiOperationalVisibleNodeIds(nodes, edges, states, { mode: 'blocked' })],
        ['node_B']
    );
    assert.deepEqual(
        [...core.getPisiOperationalVisibleNodeIds(nodes, edges, states, { mode: 'overdue' })],
        ['node_B']
    );
    assert.deepEqual(
        [...core.getPisiOperationalVisibleNodeIds(nodes, edges, states, { mode: 'missing-next-action' })],
        ['node_C']
    );
    assert.deepEqual(
        [...core.getPisiOperationalVisibleNodeIds(nodes, edges, states, { mode: 'all', query: 'alpha preview' })],
        ['node_A']
    );
});

test('owner operational feature is fully retired and stale owner scope falls back to all', async () => {
    const core = await loadCore();
    assert.equal(core.hasPisiOperationalOwner, undefined);
    assert.equal(core.normalizePisiOperationalScope({ mode: 'owner-missing' }).mode, 'all');

    const coreSource = read('renderer/map/pisi-map-operational-core.mjs');
    const renderer = read('renderer/map/pisi-map-operational-render.mjs');
    const controls = read('renderer/map/pisi-map-operational.mjs');
    const store = read('main/functions/map-operational-store.js');

    for (const source of [coreSource, renderer, controls, store]) {
        assert.doesNotMatch(source, /owner-missing|ownerMissing|hasPisiOperationalOwner|owner\?/);
    }
    assert.doesNotMatch(coreSource, /owner\|assignee\|sorumlu\|sahip/);
    assert.doesNotMatch(controls, /Owner yok|Missing owner/);
});

test('relationship type filtresi node membershipi değiştirmeden yalnız semantic edge projectionını daraltır', async () => {
    const core = await loadCore();
    const visible = new Set(['node_A', 'node_B', 'node_C']);
    const edges = [
        { id: 'edge_1', sourceId: 'node_A', targetId: 'node_B', type: 'down-hub' },
        { id: 'edge_2', sourceId: 'node_B', targetId: 'node_C', type: 'stream' },
        { id: 'edge_3', sourceId: 'node_A', targetId: 'node_C', type: 'co-level' }
    ];
    const filtered = core.getPisiOperationalVisibleEdges(edges, visible, {
        relationshipTypes: ['stream']
    });
    assert.deepEqual(filtered.map((edge) => edge.id), ['edge_2']);
    assert.equal(visible.size, 3);
});

test('sıradaki çalışma önerisi blocked nodeu dışlar ve overdue/priority ile deterministik sıralar', async () => {
    const core = await loadCore();
    const nodes = [
        node('node_A', 'Alpha', '/project/A.node'),
        node('node_B', 'Beta', '/project/B.node'),
        node('node_C', 'Gamma', '/project/C.node')
    ];
    const tasks = [
        task('task_A', '/project/A.node', { priority: 4 }),
        task('task_B', '/project/B.node', { priority: 1, dependencies: ['task_A'] }),
        task('task_C', '/project/C.node', { priority: 2, dueDate: '2026-08-10' })
    ];
    const states = core.buildPisiOperationalNodeStates(
        nodes,
        tasks,
        Date.parse('2026-08-15T12:00:00Z')
    );
    const ranked = core.rankPisiOperationalNextNodes(nodes, states);
    assert.deepEqual(ranked.map((item) => item.node.id), ['node_C', 'node_A']);
});

test('operational state map state içinde kalır; relationship store veya task store authoritysine yazılmaz', () => {
    const mainStore = read('main/functions/map-operational-store.js');
    const semanticHook = read('main/functions/map-semantic-operation-hooks.js');
    const relationshipStore = read('main/functions/relationship-store.js');

    assert.match(mainStore, /map\.operational/);
    assert.match(mainStore, /savedLayouts/);
    assert.match(mainStore, /includedNodeIds/);
    assert.match(mainStore, /focusRootNodeId/);
    assert.match(semanticHook, /operationalPayload/);
    assert.match(semanticHook, /mapOperationalStore\.savePisiOperationalMapState/);
    assert.doesNotMatch(mainStore, /relationships\.json/);
    assert.doesNotMatch(mainStore, /tasks\.json/);
    assert.doesNotMatch(relationshipStore, /operationalPayload/);
});

test('saved layouts node customization, camera, collapsed hubs, scope ve display durumunu birlikte taşır', () => {
    const mainStore = read('main/functions/map-operational-store.js');
    const renderer = read('renderer/map/pisi-map-operational.mjs');

    assert.match(mainStore, /normalizePisiMapNodeCustomization/);
    assert.match(mainStore, /collapsedHubs/);
    assert.match(mainStore, /scope:\s*normalizePisiOperationalScope/);
    assert.match(mainStore, /display:\s*normalizePisiOperationalDisplay/);
    assert.match(mainStore, /slice\(-20\)/);
    assert.match(renderer, /collectMapLayout/);
    assert.match(renderer, /op:\s*'save-layout'/);
    assert.match(renderer, /op:\s*'delete-layout'/);
    assert.match(renderer, /restorePisiOperationalLayout/);
});

test('quick linked node işlemi node oluşturur, yakına yerleştirir ve semantic link kurar', () => {
    const renderer = read('renderer/map/pisi-map-operational.mjs');
    const start = renderer.indexOf('async function createPisiOperationalLinkedNode');
    const end = renderer.indexOf('async function savePisiOperationalLayout', start);
    const fn = renderer.slice(start, end);

    assert.ok(fn.indexOf('createNodeUnderMap') < fn.indexOf('saveMapLayout'));
    assert.ok(fn.indexOf('saveMapLayout') < fn.indexOf('upsertMapConnection'));
    assert.match(fn, /sourcePort:\s*'right'/);
    assert.match(fn, /targetPort:\s*'left'/);
    assert.match(fn, /type:\s*'down-hub'/);
    assert.match(fn, /openMapInWorkspace/);
});

test('operational renderer dependency overlayi semantic edge listesine eklemez ve ayrı DOM layer kullanır', () => {
    const renderer = read('renderer/map/pisi-map-operational-render.mjs');
    const core = read('renderer/map/pisi-map-operational-core.mjs');

    assert.match(renderer, /pisi-map-task-dependencies/);
    assert.match(renderer, /data-pisi-derived/);
    assert.match(renderer, /buildPisiTaskDependencyProjections/);
    assert.doesNotMatch(renderer, /activeMapEdges\s*=\s*\[/);
    assert.doesNotMatch(core, /upsertMapConnection/);
    assert.doesNotMatch(core, /saveMapLayout/);
});

test('operational toolbar bootstrap zincirinde semantic edge çiziminden sonra yüklenir', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const edgesIndex = bootstrap.indexOf('./map/pisi-map-edges.mjs');
    const operationalIndex = bootstrap.indexOf('./map/pisi-map-operational.mjs');
    const runtimeIndex = bootstrap.indexOf('./runtime.mjs');

    assert.ok(edgesIndex >= 0);
    assert.ok(operationalIndex > edgesIndex);
    assert.ok(runtimeIndex > operationalIndex);
    assert.match(bootstrap, /pisi-map-operational-core\.mjs/);
    assert.match(bootstrap, /pisi-map-operational-render\.mjs/);
});
