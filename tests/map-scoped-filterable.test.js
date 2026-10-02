'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.PISI_TEST_ROOT || root;
const read = (file) => fs.readFileSync(path.join(sourceRoot, file), 'utf8');

let corePromise = null;
function loadCore() {
    if (!corePromise) {
        corePromise = import(pathToFileURL(path.join(sourceRoot, 'renderer/map/pisi-map-operational-core.mjs')).href);
    }
    return corePromise;
}

function node(id, title, properties = {}) {
    return {
        id,
        fullPath: `/project/${title}.node`,
        fileName: `${title}.node`,
        metadata: { title },
        preview: `${title} preview`,
        properties
    };
}

function property(id, name, type, value) {
    return { id, name, type, value };
}

function emptyStates(nodes) {
    return new Map(
        nodes.map((item) => [
            item.id,
            {
                openTasks: [],
                blocked: false,
                overdue: false,
                missingNextAction: true,
                ownerMissing: true
            }
        ])
    );
}

test('live scoped map property filtrelerini text, multiselect ve number alanlarında AND olarak uygular', async () => {
    const core = await loadCore();
    const nodes = [
        node('node_A', 'Alpha', {
            status: property('status', 'Status', 'multiselect', ['Research', 'Ready']),
            owner: property('owner', 'Owner', 'text', 'Ali'),
            score: property('score', 'Score', 'number', 8)
        }),
        node('node_B', 'Beta', {
            status: property('status', 'Status', 'multiselect', ['Research']),
            owner: property('owner', 'Owner', 'text', 'Ayşe'),
            score: property('score', 'Score', 'number', 4)
        }),
        node('node_C', 'Gamma', {
            status: property('status', 'Status', 'multiselect', ['Archive']),
            owner: property('owner', 'Owner', 'text', 'Ali'),
            score: property('score', 'Score', 'number', 9)
        })
    ];
    const visible = core.getPisiOperationalVisibleNodeIds(nodes, [], emptyStates(nodes), {
        strategy: 'live',
        propertyFilters: [
            { property: 'status', operator: 'one-of', value: 'Research, Build' },
            { property: 'owner', operator: 'contains', value: 'ali' },
            { property: 'score', operator: 'gte', value: '5' }
        ]
    });
    assert.deepEqual([...visible], ['node_A']);
});

test('snapshot scope criteria değişse bile captured node membershipini sabit tutar', async () => {
    const core = await loadCore();
    const nodes = [
        node('node_A', 'Alpha', {
            stage: property('stage', 'Stage', 'text', 'active')
        }),
        node('node_B', 'Beta', {
            stage: property('stage', 'Stage', 'text', 'archive')
        })
    ];
    const visible = core.getPisiOperationalVisibleNodeIds(nodes, [], emptyStates(nodes), {
        strategy: 'snapshot',
        includedNodeIds: ['node_B'],
        query: 'alpha',
        propertyFilters: [{ property: 'stage', operator: 'equals', value: 'active' }]
    });
    assert.deepEqual([...visible], ['node_B']);
});

test('property filter normalizasyonu yalnız desteklenen operatorleri ve bounded kriterleri kabul eder', async () => {
    const core = await loadCore();
    const normalized = core.normalizePisiOperationalScope({
        strategy: 'snapshot',
        propertyFilters: [
            { property: ' Owner ', operator: 'equals', value: ' Ali ' },
            { property: 'Score', operator: 'bogus', value: '8' },
            { property: '', operator: 'equals', value: 'x' }
        ]
    });
    assert.equal(normalized.strategy, 'snapshot');
    assert.deepEqual(normalized.propertyFilters, [
        { property: 'owner', operator: 'equals', value: 'Ali' },
        { property: 'score', operator: 'contains', value: '8' }
    ]);
});

test('relationship filtresi snapshot node membershipinden bağımsız edge projectionı olarak kalır', async () => {
    const core = await loadCore();
    const nodes = [node('node_A', 'Alpha'), node('node_B', 'Beta'), node('node_C', 'Gamma')];
    const visible = core.getPisiOperationalVisibleNodeIds(nodes, [], emptyStates(nodes), { strategy: 'snapshot', includedNodeIds: ['node_A', 'node_B'] });
    const edges = core.getPisiOperationalVisibleEdges(
        [
            { id: 'edge_1', sourceId: 'node_A', targetId: 'node_B', type: 'stream' },
            { id: 'edge_2', sourceId: 'node_A', targetId: 'node_B', type: 'co-level' },
            { id: 'edge_3', sourceId: 'node_B', targetId: 'node_C', type: 'stream' }
        ],
        visible,
        { relationshipTypes: ['stream'] }
    );
    assert.deepEqual([...visible], ['node_A', 'node_B']);
    assert.deepEqual(
        edges.map((edge) => edge.id),
        ['edge_1']
    );
});

test('map operational store saved scopesu layouttan bağımsız ve map-local olarak persist eder', () => {
    const store = read('main/functions/map-operational-store.js');
    assert.match(store, /PISI_OPERATIONAL_MAP_VERSION\s*=\s*2/);
    assert.match(store, /strategy/);
    assert.match(store, /propertyFilters/);
    assert.match(store, /savedScopes/);
    assert.match(store, /op === 'save-scope'/);
    assert.match(store, /op === 'delete-scope'/);
    assert.match(store, /normalizePisiSavedOperationalScope/);
    assert.match(store, /slice\(-40\)/);
    assert.doesNotMatch(store, /relationships\.json/);
    assert.doesNotMatch(store, /tasks\.json/);
});

test('scoped map toolbar live/snapshot, property filter, saved scope ve dim controlsunu map toolbarına ekler', () => {
    const ui = read('renderer/map/pisi-map-scopes.mjs');
    assert.match(ui, /pisi-map-operational-bar/);
    assert.match(ui, /pisi-map-scope-strategy/);
    assert.match(ui, /capturePisiScopeSnapshot/);
    assert.match(ui, /lastRender\?\.visibleNodeIds/);
    assert.match(ui, /pisi-map-scope-property/);
    assert.match(ui, /normalizePisiOperationalPropertyFilter/);
    assert.match(ui, /op:\s*'save-scope'/);
    assert.match(ui, /op:\s*'delete-scope'/);
    assert.match(ui, /dimFiltered/);
    assert.doesNotMatch(ui, /upsertMapConnection/);
    assert.doesNotMatch(ui, /tasks\.json|relationships\.json/);
});

test('task/query/focus criteria düzenlenince frozen snapshot tekrar live scopea döner', () => {
    const ui = read('renderer/map/pisi-map-scopes.mjs');
    assert.match(ui, /function bindExistingCriteria/);
    assert.match(ui, /pisi-map-operational-scope/);
    assert.match(ui, /pisi-map-operational-query/);
    assert.match(ui, /pisi-map-operational-depth/);
    assert.match(ui, /pisi-map-operational-focus/);
    assert.match(ui, /current\.scope\.strategy = 'live'/);
    assert.match(ui, /\['pisi-map-operational-focus', 'click'\]/);
});

test('scope observer kendi control mutasyonlarında reload döngüsü üretmez', () => {
    const ui = read('renderer/map/pisi-map-scopes.mjs');
    assert.match(ui, /if \(createControls\(\)\) \{/);
    assert.match(ui, /mapNodesChanged/);
    assert.match(ui, /matches\?\.\('\.map-node-box'\)/);
});

test('snapshot refresh önce live projectionı render edip sonra görünümü yeniden dondurur', () => {
    const ui = read('renderer/map/pisi-map-scopes.mjs');
    assert.match(ui, /function refreshPisiScopeSnapshot/);
    assert.match(ui, /current\.scope\.strategy = 'live'/);
    assert.match(ui, /schedulePisiOperationalRender/);
    assert.match(ui, /requestAnimationFrame\(\(\) => void capturePisiScopeSnapshot\(\)\)/);
});

test('scoped filter module operational mapten sonra, export/runtime öncesinde bootstrapa bağlanır', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const operationalIndex = bootstrap.indexOf('./map/pisi-map-operational.mjs');
    const scopesIndex = bootstrap.indexOf('./map/pisi-map-scopes.mjs');
    const exportIndex = bootstrap.indexOf('./map/pisi-map-export.mjs');
    assert.ok(operationalIndex >= 0);
    assert.ok(scopesIndex > operationalIndex);
    assert.ok(exportIndex > scopesIndex);
});
