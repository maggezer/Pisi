'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function makeNode(id, title, value) {
    return {
        pisi: {
            version: 1,
            id,
            type: 'node',
            title,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        content: '',
        properties: {
            status_a: {
                id: 'status_a',
                name: 'Durum',
                type: 'multiselect',
                value
            }
        }
    };
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-property-schema-'));
const projectFolder = path.join(tempRoot, 'Project');
fs.mkdirSync(projectFolder, { recursive: true });

globalThis.writeFileAtomic = (filePath, content) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
};
globalThis.runPisiAtomicMutation = (_project, _command, operation) => operation();
globalThis.snapshotPisiNodeVersion = () => ({ ok: true });
globalThis.writePisiDocument = (filePath, data) => writeJson(filePath, data);
globalThis.ensurePisiFileMetadata = (filePath) => {
    const data = readJson(filePath);
    return { ok: true, data, metadata: data.pisi };
};

const schemaStore = require('../main/functions/property-schema-store');
const mutations = require('../main/functions/property-schema-mutations');

function resetProject({ withSchema = true } = {}) {
    fs.rmSync(projectFolder, { recursive: true, force: true });
    fs.mkdirSync(projectFolder, { recursive: true });
    writeJson(path.join(projectFolder, 'A.node'), makeNode('node_A', 'A', ['Aktif']));
    writeJson(path.join(projectFolder, 'B.node'), makeNode('node_B', 'B', ['Bitti']));

    if (withSchema) {
        writeJson(schemaStore.getPisiPropertySchemaPath(projectFolder), {
            version: 1,
            definitions: [
                {
                    id: 'status_a',
                    name: 'Durum',
                    type: 'multiselect'
                }
            ],
            conflicts: [],
            updatedAt: '2026-01-01T00:00:00.000Z'
        });
    }
}

test.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('missing property schema creates an empty canonical schema without migrating node data', () => {
    resetProject({ withSchema: false });
    const beforeA = readJson(path.join(projectFolder, 'A.node'));

    const result = schemaStore.ensurePisiPropertySchema(projectFolder);

    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.equal(result.schema.version, 1);
    assert.deepEqual(result.schema.definitions, []);
    assert.deepEqual(readJson(path.join(projectFolder, 'A.node')), beforeA);
});

test('renaming a property changes the project definition and every matching node name but never its ID', () => {
    resetProject();
    const save = mutations.savePisiNodePropertiesBySchema(projectFolder, path.join(projectFolder, 'A.node'), [
        {
            id: 'status_a',
            name: 'Aşama',
            type: 'multiselect',
            value: ['Aktif']
        }
    ]);

    assert.equal(save.ok, true);
    const schema = schemaStore.readPisiPropertySchema(projectFolder).schema;
    assert.deepEqual(
        schema.definitions.map(({ id, name, type }) => ({ id, name, type })),
        [{ id: 'status_a', name: 'Aşama', type: 'multiselect' }]
    );
    assert.equal(readJson(path.join(projectFolder, 'A.node')).properties.status_a.name, 'Aşama');
    assert.equal(readJson(path.join(projectFolder, 'B.node')).properties.status_a.name, 'Aşama');
});

test('project-wide type change fails before mutation when an existing value is incompatible', () => {
    resetProject();
    const beforeA = fs.readFileSync(path.join(projectFolder, 'A.node'), 'utf8');
    const beforeB = fs.readFileSync(path.join(projectFolder, 'B.node'), 'utf8');
    const beforeSchema = fs.readFileSync(schemaStore.getPisiPropertySchemaPath(projectFolder), 'utf8');

    const save = mutations.savePisiNodePropertiesBySchema(projectFolder, path.join(projectFolder, 'A.node'), [
        { id: 'status_a', name: 'Durum', type: 'number', value: 1 }
    ]);

    assert.equal(save.ok, false);
    assert.equal(save.code, 'PROPERTY_TYPE_CHANGE_CONFLICT');
    assert.equal(fs.readFileSync(path.join(projectFolder, 'A.node'), 'utf8'), beforeA);
    assert.equal(fs.readFileSync(path.join(projectFolder, 'B.node'), 'utf8'), beforeB);
    assert.equal(fs.readFileSync(schemaStore.getPisiPropertySchemaPath(projectFolder), 'utf8'), beforeSchema);
});

test('removing a property value from one node does not delete its project definition', () => {
    resetProject();
    const save = mutations.savePisiNodePropertiesBySchema(projectFolder, path.join(projectFolder, 'A.node'), []);

    assert.equal(save.ok, true);
    assert.deepEqual(readJson(path.join(projectFolder, 'A.node')).properties, {});
    const schema = schemaStore.readPisiPropertySchema(projectFolder).schema;
    assert.equal(
        schema.definitions.some((item) => item.id === 'status_a'),
        true
    );
});
