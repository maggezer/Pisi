'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { extractFunction } = require('./source-helper');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

function loadTaskStore() {
    const calls = [];
    const listeners = new Map();
    const window = {};
    const document = {
        addEventListener: (name, callback) => listeners.set(name, callback),
        dispatchEvent() {},
        createElement: () => ({ content: { querySelector: () => null, querySelectorAll: () => [] } })
    };
    const context = vm.createContext({
        window,
        document,
        console,
        CustomEvent: class {},
        registerModule: (_name, api) => Object.assign(window, api),
        parsePisiTodoTagValue: (tag) => (tag.startsWith('todo.') ? { priority: 3 } : null),
        getPisiTodoRepeatOption: (value) => ({ value: value || 'none' })
    });
    vm.runInContext(
        read('renderer/tags/pisi-task-store.mjs')
            .replace(/^import .*;\n/gm, '')
            .replace(/export \{[\s\S]*?\};/, ''),
        context
    );
    window.currentProjectFolder = '/project';
    window.pisiProject = {
        quickAddTask: async (_project, payload) => {
            calls.push(payload);
            return { ok: true, tasks: [] };
        }
    };
    return { window, calls, context, listeners };
}

test('sheet hydration reads its stored model and never reconstructs absent or corrupt models from DOM', () => {
    const writes = [];
    const context = vm.createContext({
        getPisiSheetDatabase: () => null,
        normalizePisiSheetDatabase: (value) => value,
        attachPisiSheetDatabase: (_table, database) => writes.push(database),
        persistPisiSheetDatabase: () => {}
    });
    vm.runInContext(extractFunction(read('renderer/editor/pisi-editor-sheet-database-dom.mjs'), 'hydratePisiSheetDatabase'), context);
    for (const serialized of [undefined, '{broken']) {
        context.table = {
            dataset: { pisiSheetModel: serialized },
            querySelectorAll: () => {
                throw new Error('DOM migration attempted');
            }
        };
        assert.equal(vm.runInContext('hydratePisiSheetDatabase(table)', context), null);
    }
    assert.equal(writes.length, 0);
    context.table = {
        dataset: {
            pisiSheetModel: JSON.stringify({ databaseId: 'db_a', fields: [{ id: 'col_a' }], items: [{ id: 'row_a', values: { col_a: { formula: '=2+3' } } }] })
        }
    };
    const result = vm.runInContext('hydratePisiSheetDatabase(table)', context);
    assert.equal(result.items[0].values.col_a.formula, '=2+3');
    assert.equal(writes.length, 1);
});

test('Trash restores canonical map references without reviving legacy edges', () => {
    const map = { nodes: [], relationshipViews: [] };
    const context = vm.createContext({
        fs: { existsSync: () => true },
        fromPisiTrashRelativePath: (_project, relative) => relative,
        documentStore: { ensurePisiFileMetadata: () => ({ ok: true, data: { map, pisi: {} } }) },
        mapSemanticCore: { normalizePisiRelationshipViews: (views) => views || [], PISI_MAP_RELATIONSHIP_VIEW_VERSION: 1 },
        filesystemCore: { writePisiDocumentsTransaction() {} },
        references: [{ mapPath: 'a.map', nodes: [{ id: 'node_a' }], relationshipViews: [{ relationshipId: 'rel_a' }], legacyEdges: [{ id: 'old_edge' }] }]
    });
    vm.runInContext(extractFunction(read('main/functions/trash-store.js'), 'restorePisiTrashMapReferences'), context);
    vm.runInContext("restorePisiTrashMapReferences('/project', references, ['rel_a'])", context);
    assert.equal(map.nodes[0].id, 'node_a');
    assert.equal(map.relationshipViews[0].relationshipId, 'rel_a');
    assert.equal(map.edges, undefined);
    assert.doesNotMatch(read('main/functions/trash-store.js'), /legacyEdges|mapData\.edges/);
});
