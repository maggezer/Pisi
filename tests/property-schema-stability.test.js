'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('project-level property schema loads after legacy structured storage and before integrity/runtime hooks', () => {
    const main = read('main.js');
    const structured = main.indexOf('structured-nodes');
    const schema = main.indexOf('property-schema-store');
    const mutations = main.indexOf('property-schema-mutations');
    const integrity = main.indexOf('project-integrity');
    const runtime = main.indexOf('main/runtime');
    const hooks = main.indexOf('property-schema-operation-hooks');

    assert.ok(structured >= 0 && structured < schema);
    assert.ok(schema < mutations && mutations < integrity);
    assert.ok(integrity < runtime && runtime < hooks);
});

test('normal property save and context IPC are rebound through stable schema layer', () => {
    const hooks = read('main/functions/property-schema-operation-hooks.js');
    assert.match(hooks, /removeHandler\('project:get-node-property-context'\)/);
    assert.match(hooks, /getPisiPropertySchemaDefinitions/);
    assert.match(hooks, /propertyDefinitions: schemaResult\.definitions/);
    assert.match(hooks, /removeHandler\('project:save-node-properties'\)/);
    assert.match(hooks, /savePisiNodePropertiesBySchema/);
    assert.match(hooks, /removeHandler\('project:save-database-template'\)/);
    assert.match(hooks, /savePisiDatabaseTemplateStable/);
});

test('schema authority is versioned and does not store per-node values', () => {
    const core = read('main/functions/property-schema-core.js');
    const store = read('main/functions/property-schema-store.js');
    assert.match(core, /PISI_PROPERTY_SCHEMA_VERSION = 1/);
    assert.match(core, /\.pisi\/properties\.json/);
    assert.match(store, /definitions:/);
    assert.doesNotMatch(store, /nodeValues|valuesByNode|propertyValues/);
});

test('rename preserves stable ID and type changes are lossless-or-fail project-wide', () => {
    const mutations = read('main/functions/property-schema-mutations.js');
    assert.match(mutations, /const previousName = definition\.name/);
    assert.match(mutations, /definition\.name = name/);
    assert.doesNotMatch(mutations, /definition\.id =/);
    assert.match(mutations, /canLosslesslyChangePropertyType/);
    assert.match(mutations, /PROPERTY_TYPE_CHANGE_CONFLICT/);
    assert.match(mutations, /runPisiAtomicMutation\(projectFolder, 'property\.node\.save\.v1'/);
});

test('removing a node value does not implicitly delete schema definitions', () => {
    const mutations = read('main/functions/property-schema-mutations.js');
    assert.match(mutations, /const normalized = \{\}/);
    assert.doesNotMatch(mutations, /schema\.definitions\s*=\s*schema\.definitions\.filter/);
    assert.doesNotMatch(mutations, /deleteDefinition|removeDefinition/);
});

test('Project Integrity audits property authority invalid type value drift and migration conflicts', () => {
    const integrity = read('main/functions/project-integrity-properties.js');
    const orchestrator = read('main/functions/project-integrity.js');
    for (const code of [
        'property-schema-duplicate-id',
        'property-schema-duplicate-name',
        'node-property-schema-orphan',
        'node-property-name-drift',
        'node-property-type-drift',
        'node-property-type-invalid',
        'node-property-value-invalid'
    ]) {
        assert.ok(integrity.includes(code), code);
    }
    assert.match(orchestrator, /properties\.auditPisiPropertySchema/);
    assert.match(orchestrator, /properties: '\.pisi\/properties\.json'/);
});

test('1.0 property surface does not add formula nested database or automation types', () => {
    const core = read('main/functions/property-schema-core.js');
    const editableBlock = core.slice(core.indexOf('PISI_EDITABLE_PROPERTY_TYPES'), core.indexOf('PISI_INTERNAL_PROPERTY_TYPES'));
    for (const type of ['text', 'number', 'multiselect', 'relation']) {
        assert.match(editableBlock, new RegExp(`'${type}'`));
    }
    for (const forbidden of ['formula', 'date', 'select', 'checkbox', 'node', 'automation', 'database']) {
        assert.doesNotMatch(editableBlock, new RegExp(`'${forbidden}'`));
    }
});
