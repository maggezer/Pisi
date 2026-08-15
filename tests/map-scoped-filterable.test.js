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
        corePromise = import(pathToFileURL(
            path.join(sourceRoot, 'renderer/map/pisi-map-operational-core.mjs')
        ).href);
    }
    return corePromise;
}

function node(id, title, properties = {}) {
    return {
        id,
        fullPath: `/project/${id}.node`,
        fileName: `${title}.node`,
        metadata: { title },
        properties,
        preview: `${title} preview`
    };
}

test('live scoped map property filtrelerini text, multiselect ve number alanlarında AND olarak uygular', async () => {
    const core = await loadCore();
    const nodes = [
        node('node_A', 'Alpha', {
            owner: { id: 'owner', name: 'Owner', type: 'text', value: 'Ali' },
            tags: { id: 'tags', name: 'Tags', type: 'multiselect', value: ['research', 'urgent'] },
            score: { id: 'score', name: 'Score', type: 'number', value: 9 }
        }),
        node('node_B', 'Beta', {
            owner: { id: 'owner', name: 'Owner', type: 'text', value: 'Ayşe' },
            tags: { id: 'tags', name: 'Tags', type: 'multiselect', value: ['research'] },
            score: { id: 'score', name: 'Score', type: 'number', value: 4 }
        }),
        node('node_C', 'Gamma', {
            tags: { id: 'tags', name: 'Tags', type: 'multiselect', value: ['archive'] },
            score: { id: 'score', name: 'Score', type: 'number', value: 10 }
        })
    ];
    const states = new Map(nodes.map((item) => [item.id, {}]));
    const visible = core.getPisiOperationalVisibleNodeIds(nodes, [], states, {
        strategy: 'live',
        propertyFilters: [
            { property: 'tags', operator: 'one-of', value: 'research,active' },
            { property: 'score', operator: 'gte', value: '5' },
            { property: 'owner', operator: 'contains', value: 'ali' }
        ]
    });
    assert.deepEqual([...visible], ['node_A']);
});

test('snapshot scope criteria değişse bile captured node membershipini sabit tutar', async () => {
    const core = await loadCore();
    const nodes = [
        node('node_A', 'Alpha'),
        node('node_B', 'Beta'),
        node('node_C', 'Gamma')
    ];
    const states = new Map(nodes.map((item) => [item.id, {
        blocked: item.id === 'node_C',
        openTasks: item.id === 'node_A' ? [{}] : []
    }]));
    const visible = core.getPisiOperationalVisibleNodeIds(nodes, [], states, {
        strategy: 'snapshot',
        includedNodeIds: ['node_A', 'node_C'],
        mode: 'blocked',
        query: 'beta',
        propertyFilters: [{ property: 'owner', operator: 'equals', value: 'Nobody' }]
    });
    assert.deepEqual([...visible], ['node_A', 'node_C']);
});

test('property filter normalizasyonu yalnız desteklenen operatorleri ve bounded kriterleri kabul eder', async () => {
    const core = await loadCore();
    assert.deepEqual(core.normalizePisiOperationalPropertyFilter({
        property: ' Owner ', operator: 'equals', value: ' Ali '
    }), {
        property: 'owner', operator: 'equals', value: 'Ali'
    });
    assert.deepEqual(core.normalizePisiOperationalPropertyFilter({
        property: 'Tags', operator: 'unknown', value: 'x'
    }), {
        property: 'tags', operator: 'contains', value: 'x'
    });
    assert.equal(core.normalizePisiOperationalPropertyFilter({}), null);
});

test('relationship filtresi snapshot node membershipinden bağımsız edge projectionı olarak kalır', async () => {
    const core = await loadCore();
    const visible = new Set(['node_A', 'node_B', 'node_C']);
    const edges = [
        { id: 'edge_1', sourceId: 'node_A', targetId: 'node_B', type: 'stream' },
        { id: 'edge_2', sourceId: 'node_B', targetId: 'node_C', type: 'co-level' }
    ];
    const filtered = core.getPisiOperationalVisibleEdges(edges, visible, {
        strategy: 'snapshot',
        includedNodeIds: [...visible],
        relationshipTypes: ['stream']
    });
    assert.deepEqual(filtered.map((edge) => edge.id), ['edge_1']);
    assert.equal(visible.size, 3);
});

test('map operational store saved scopesu layouttan bağımsız ve map-local olarak persist eder', () => {
    const store = read('main/functions/map-operational-store.js');
    assert.match(store, /PISI_OPERATIONAL_MAP_VERSION = 2/);
    assert.match(store, /savedScopes/);
    assert.match(store, /op === 'save-scope'/);
    assert.match(store, /op === 'delete-scope'/);
    assert.match(store, /normalizePisiSavedOperationalScope/);
    assert.match(store, /propertyFilters/);
    assert.match(store, /strategy/);
    assert.doesNotMatch(store, /tasks\.json/);
    assert.doesNotMatch(store, /relationships\.json/);
});

test('scoped map toolbar live/snapshot, property filter, saved scope ve dim controlsunu map toolbarına ekler', () => {
    const ui = read('renderer/map/pisi-map-scopes.mjs');
    assert.match(ui, /pisi-map-operational-bar/);
    assert.match(ui, /pisi-map-scope-strategy/);
    assert.match(ui, /pisi-map-freeze-scope/);
    assert.match(ui, /pisi-map-scope-property/);
    assert.match(ui, /pisi-map-scope-operator/);
    assert.match(ui, /pisi-map-save-scope/);
    assert.match(ui, /pisi-map-apply-scope/);
    assert.match(ui, /pisi-map-delete-scope/);
    assert.match(ui, /pisi-map-dim-filtered/);
    assert.match(ui, /includedNodeIds:\s*ids/);
    assert.doesNotMatch(ui, /upsertMapConnection/);
    assert.doesNotMatch(ui, /tasks\.json/);
});

test('task/query/focus criteria düzenlenince frozen snapshot tekrar live scopea döner', () => {
    const ui = read('renderer/map/pisi-map-scopes.mjs');
    assert.match(ui, /function bindExistingCriteria/);
    assert.match(ui, /pisi-map-operational-scope/);
    assert.match(ui, /pisi-map-operational-query/);
    assert.match(ui, /pisi-map-operational-depth/);
    assert.match(ui, /pisi-map-operational-focus/);
    assert.match(ui, /current\.scope\.strategy = 'live'/);
});

test('scoped filter module operational mapten sonra, export/runtime öncesinde bootstrapa bağlanır', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const operational = bootstrap.indexOf('./map/pisi-map-operational.mjs');
    const scopes = bootstrap.indexOf('./map/pisi-map-scopes.mjs');
    const exportModule = bootstrap.indexOf('./map/pisi-map-export.mjs');
    assert.ok(operational >= 0);
    assert.ok(scopes > operational);
    assert.ok(exportModule > scopes);
});
