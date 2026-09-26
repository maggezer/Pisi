'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function normalizeNodeId(value) {
    const id = String(value || '');
    return /^node_[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

function makeFilesystemCoreStub() {
    const ports = new Set(['top', 'right', 'bottom', 'left']);
    const normalizeMapEdge = (raw = {}) => {
        const sourceId = normalizeNodeId(raw.sourceId);
        const targetId = normalizeNodeId(raw.targetId);
        if (!sourceId || !targetId || sourceId === targetId) return null;
        let type = String(raw.type || '');
        if (!['down-hub', 'stream', 'co-level'].includes(type)) return null;
        let sourceRole = 'down-hub';
        let targetRole = 'up-hub';
        if (type === 'stream') {
            sourceRole = 'downstream';
            targetRole = 'upstream';
        } else if (type === 'co-level') {
            sourceRole = 'co-level';
            targetRole = 'co-level';
        }
        const edge = {
            id: /^edge_[A-Za-z0-9_-]+$/.test(String(raw.id || ''))
                ? String(raw.id)
                : 'edge_generated',
            sourceId,
            targetId,
            sourcePort: ports.has(raw.sourcePort) ? raw.sourcePort : 'bottom',
            targetPort: ports.has(raw.targetPort) ? raw.targetPort : 'top',
            type,
            sourceRole,
            targetRole
        };
        const color = String(raw.customization?.color || '');
        if (/^#[0-9a-fA-F]{6}$/.test(color)) {
            edge.customization = { color: color.toLowerCase() };
        }
        return edge;
    };

    return {
        normalizeMapEdge,
        normalizePisiMapEdgeCustomization(value = {}) {
            const color = String(value.color || '');
            return /^#[0-9a-fA-F]{6}$/.test(color)
                ? { color: color.toLowerCase() }
                : {};
        },
        getPisiEdgeSemanticKey(raw) {
            const edge = normalizeMapEdge(raw);
            if (!edge) return '';
            if (edge.type === 'co-level') {
                const pair = [edge.sourceId, edge.targetId].sort();
                return `co-level:${pair[0]}:${pair[1]}`;
            }
            return [
                edge.type,
                edge.sourceId,
                edge.targetId,
                edge.sourceRole,
                edge.targetRole
            ].join(':');
        },
        isHierarchyEdge(edge) {
            return edge?.type === 'down-hub' &&
                edge?.sourceRole === 'down-hub' &&
                edge?.targetRole === 'up-hub';
        },
        wouldCreatePisiHierarchyCycle(parentByChild, parentId, childId) {
            let current = parentId;
            const visited = new Set();
            while (current && !visited.has(current)) {
                if (current === childId) return true;
                visited.add(current);
                current = parentByChild.get(current) || null;
            }
            return false;
        },
        readJsonFileResult(filePath) {
            try {
                const raw = fs.readFileSync(filePath, 'utf8');
                return { ok: true, raw, data: JSON.parse(raw) };
            } catch (error) {
                return { ok: false, error: error.message, data: null };
            }
        },
        writeFileAtomic(filePath, content) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content, 'utf8');
        }
    };
}

function loadSeparationModules() {
    const registry = require('../main/module-registry');
    if (!registry.modules['main.filesystemCore']) {
        registry.registerMainModule('main.filesystemCore', makeFilesystemCoreStub());
    }
    if (!registry.modules['main.pathSecurity']) {
        registry.registerMainModule('main.pathSecurity', {
            normalizePisiId: normalizeNodeId,
            getDefaultNodeConnectionTypes() {
                return {
                    'up-hub': [],
                    'down-hub': [],
                    'co-level': [],
                    upstream: [],
                    downstream: []
                };
            }
        });
    }
    require('../main/functions/relationship-store');
    require('../main/functions/map-semantic-core');
    return {
        relationshipStore: registry.modules['main.relationshipStore'],
        mapCore: registry.modules['main.mapSemanticCore']
    };
}

function makeProject() {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-map-semantic-'));
    fs.mkdirSync(path.join(project, '.pisi'), { recursive: true });
    return project;
}

const modules = loadSeparationModules();

test('semantic relationship store never persists map geometry or visual customization', () => {
    const project = makeProject();
    try {
        const saved = modules.relationshipStore.upsertPisiSemanticRelationship(
            project,
            {
                id: 'edge_sep_001',
                sourceId: 'node_A',
                targetId: 'node_B',
                type: 'stream',
                sourcePort: 'left',
                targetPort: 'right',
                customization: { color: '#ABCDEF' },
                label: 'supports',
                properties: { weight: 2 }
            }
        );
        assert.equal(saved.ok, true);

        const persisted = JSON.parse(fs.readFileSync(
            path.join(project, '.pisi', 'relationships.json'),
            'utf8'
        ));
        assert.equal(persisted.relationships.length, 1);
        const relationship = persisted.relationships[0];
        assert.equal(relationship.id, 'edge_sep_001');
        assert.equal(relationship.sourceId, 'node_A');
        assert.equal(relationship.targetId, 'node_B');
        assert.equal(relationship.type, 'stream');
        assert.equal(relationship.label, 'supports');
        assert.deepEqual(relationship.properties, { weight: 2 });
        assert.equal('sourcePort' in relationship, false);
        assert.equal('targetPort' in relationship, false);
        assert.equal('customization' in relationship, false);
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('map relationshipViews contain presentation only and reject semantic duplication', () => {
    const mapData = {};
    const relationship = {
        id: 'edge_view_001',
        sourceId: 'node_A',
        targetId: 'node_B',
        type: 'down-hub',
        sourceRole: 'down-hub',
        targetRole: 'up-hub'
    };

    const view = modules.mapCore.upsertPisiRelationshipView(
        mapData,
        relationship,
        {
            sourcePort: 'right',
            targetPort: 'left',
            customization: { color: '#112233' },
            sourceId: 'node_WRONG',
            type: 'stream'
        }
    );

    assert.deepEqual(view, {
        relationshipId: 'edge_view_001',
        sourcePort: 'right',
        targetPort: 'left',
        customization: { color: '#112233' }
    });
    assert.equal(modules.mapCore.assertPisiMapViewHasNoSemanticFields(view), true);
    assert.equal('sourceId' in view, false);
    assert.equal('targetId' in view, false);
    assert.equal('type' in view, false);
    assert.equal('sourceRole' in view, false);
    assert.equal('targetRole' in view, false);
});

test('the same semantic relationship can have independent presentation in different maps', () => {
    const relationship = modules.relationshipStore.normalizePisiSemanticRelationship({
        id: 'edge_shared_001',
        sourceId: 'node_A',
        targetId: 'node_B',
        type: 'co-level'
    });

    const mapA = modules.mapCore.projectPisiSemanticRelationshipToMapEdge(
        relationship,
        {
            relationshipId: relationship.id,
            sourcePort: 'right',
            targetPort: 'left',
            customization: { color: '#111111' }
        }
    );
    const mapB = modules.mapCore.projectPisiSemanticRelationshipToMapEdge(
        relationship,
        {
            relationshipId: relationship.id,
            sourcePort: 'bottom',
            targetPort: 'top',
            customization: { color: '#eeeeee' }
        }
    );

    assert.equal(mapA.id, mapB.id);
    assert.equal(mapA.sourceId, mapB.sourceId);
    assert.equal(mapA.targetId, mapB.targetId);
    assert.equal(mapA.type, mapB.type);
    assert.notEqual(mapA.sourcePort, mapB.sourcePort);
    assert.notEqual(mapA.targetPort, mapB.targetPort);
    assert.notDeepEqual(mapA.customization, mapB.customization);
});

test('map placement and camera state can change without mutating semantic relationship authority', () => {
    const project = makeProject();
    try {
        const saved = modules.relationshipStore.upsertPisiSemanticRelationship(project, {
            id: 'edge_state_001',
            sourceId: 'node_A',
            targetId: 'node_B',
            type: 'down-hub'
        });
        assert.equal(saved.ok, true);
        const storePath = path.join(project, '.pisi', 'relationships.json');
        const before = fs.readFileSync(storePath, 'utf8');

        const mapState = {
            nodes: [
                { id: 'node_A', x: 10, y: 10 },
                { id: 'node_B', x: 30, y: 30 }
            ],
            camera: { x: 0, y: 0, zoom: 1 },
            relationshipViews: []
        };
        mapState.nodes[0].x = 900;
        mapState.nodes[1].y = -500;
        mapState.camera = { x: 220, y: 180, zoom: 1.7 };

        assert.equal(fs.readFileSync(storePath, 'utf8'), before);
        assert.equal(
            modules.relationshipStore.listPisiSemanticRelationships(project)
                .relationships[0].id,
            'edge_state_001'
        );
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('semantic hierarchy constraints are project-wide instead of map-local', () => {
    const project = makeProject();
    try {
        assert.equal(modules.relationshipStore.upsertPisiSemanticRelationship(project, {
            id: 'edge_parent_A',
            sourceId: 'node_A',
            targetId: 'node_C',
            type: 'down-hub'
        }).ok, true);

        const secondParent = modules.relationshipStore.upsertPisiSemanticRelationship(project, {
            id: 'edge_parent_B',
            sourceId: 'node_B',
            targetId: 'node_C',
            type: 'down-hub'
        });
        assert.equal(secondParent.ok, false);
        assert.equal(secondParent.code, 'SECOND_PARENT_CONFIRM_REQUIRED');

        const confirmed = modules.relationshipStore.upsertPisiSemanticRelationship(
            project,
            {
                id: 'edge_parent_B',
                sourceId: 'node_B',
                targetId: 'node_C',
                type: 'down-hub'
            },
            { confirmSecondParentAsStream: true }
        );
        assert.equal(confirmed.ok, true);
        assert.equal(confirmed.relationship.type, 'stream');

        assert.equal(modules.relationshipStore.upsertPisiSemanticRelationship(project, {
            id: 'edge_chain_AB',
            sourceId: 'node_A',
            targetId: 'node_B',
            type: 'down-hub'
        }).ok, true);

        const cycle = modules.relationshipStore.upsertPisiSemanticRelationship(project, {
            id: 'edge_cycle_CA',
            sourceId: 'node_C',
            targetId: 'node_A',
            type: 'down-hub'
        });
        assert.equal(cycle.ok, false);
        assert.equal(cycle.code, 'HIERARCHY_CYCLE');
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});

test('node connectionTypes are derived in memory from canonical semantic relationships', () => {
    const nodes = [
        { id: 'node_A', metadata: {} },
        { id: 'node_B', metadata: {} },
        { id: 'node_C', metadata: {} }
    ];
    const relationships = [
        modules.relationshipStore.normalizePisiSemanticRelationship({
            id: 'edge_derive_1',
            sourceId: 'node_A',
            targetId: 'node_B',
            type: 'down-hub'
        }),
        modules.relationshipStore.normalizePisiSemanticRelationship({
            id: 'edge_derive_2',
            sourceId: 'node_B',
            targetId: 'node_C',
            type: 'stream'
        })
    ];

    modules.mapCore.applyPisiDerivedConnectionTypes(nodes, relationships);
    assert.deepEqual(nodes[0].metadata.connectionTypes['down-hub'], ['node_B']);
    assert.deepEqual(nodes[1].metadata.connectionTypes['up-hub'], ['node_A']);
    assert.deepEqual(nodes[1].metadata.connectionTypes.downstream, ['node_C']);
    assert.deepEqual(nodes[2].metadata.connectionTypes.upstream, ['node_B']);
});

test('runtime IPC contract exposes only canonical semantic relationship writes', () => {
    const bootstrap = read('main.js');
    const hooks = read('main/functions/map-semantic-operation-hooks.js');

    assert.ok(
        bootstrap.indexOf('main/runtime') <
            bootstrap.indexOf('map-semantic-operation-hooks'),
        'canonical semantic IPC hooks load after runtime initialization'
    );

    for (const channel of [
        'project:list-map-nodes',
        'project:upsert-map-connection',
        'project:delete-map-connection',
        'project:reparent-map-node',
        'project:save-map-layout',
        'project:save-map-camera',
        'project:detach-map-reference'
    ]) {
        assert.ok(hooks.includes(`ipcMain.handle('${channel}'`));
        assert.equal(
            read('main/runtime.js').includes(`ipcMain.handle('${channel}'`),
            false
        );
        assert.equal(hooks.includes(`ipcMain.removeHandler('${channel}')`), false);
    }

    assert.match(hooks, /upsertPisiSemanticRelationship/);
    assert.match(hooks, /deletePisiSemanticRelationship/);
    assert.doesNotMatch(hooks, /migratePisiLegacyMapRelationships/);
    assert.doesNotMatch(hooks, /migratePisiLegacyMapEdgesData/);
    assert.doesNotMatch(hooks, /mapInfo\.data\.map\.edges\.push/);
    assert.doesNotMatch(hooks, /syncMapConnectionMetadata\(/);
});