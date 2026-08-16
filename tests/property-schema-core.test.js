'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const contract = require('../main/functions/property-schema-core');

test('editable property schema is frozen to Text Number Tags and Relation for 1.0', () => {
    assert.deepEqual(contract.PISI_EDITABLE_PROPERTY_TYPES, [
        'text', 'number', 'multiselect', 'relation'
    ]);
    assert.equal(contract.isEditablePropertyType('rollup'), false);
    assert.equal(contract.isSupportedPropertyType('rollup'), true);
    assert.equal(contract.isSupportedPropertyType('formula'), false);
});

test('legacy types migrate deterministically without adding new public types', () => {
    assert.equal(contract.normalizePropertyType('date'), 'text');
    assert.equal(contract.normalizePropertyType('select'), 'multiselect');
    assert.equal(contract.normalizePropertyType('node'), 'relation');
    assert.equal(contract.normalizePropertyType('checkbox'), 'multiselect');
});

test('legacy properties without IDs receive deterministic stable IDs', () => {
    const first = contract.makeDeterministicPropertyId('Öncelik', 'number');
    const second = contract.makeDeterministicPropertyId('Öncelik', 'number');
    const renamed = contract.makeDeterministicPropertyId('Priority', 'number');
    assert.equal(first, second);
    assert.match(first, /^prop_[a-f0-9]{16}$/);
    assert.notEqual(first, renamed);
});

test('invalid types and values fail explicitly instead of silently becoming text', () => {
    assert.equal(contract.validatePropertyValue('formula', '1+1').ok, false);
    assert.equal(contract.validatePropertyValue('number', 'not-a-number').ok, false);
    assert.equal(contract.validatePropertyValue('relation', 'A.node').ok, false);
    assert.deepEqual(
        contract.validatePropertyValue('relation', ['A.node']).normalized,
        ['A.node']
    );
});

test('type changes are allowed only when existing values are losslessly compatible', () => {
    assert.equal(contract.canLosslesslyChangePropertyType('text', 'number', '12.5'), true);
    assert.equal(contract.canLosslesslyChangePropertyType('text', 'number', 'twelve'), false);
    assert.equal(contract.canLosslesslyChangePropertyType('text', 'multiselect', 'a,b'), false);
    assert.equal(contract.canLosslesslyChangePropertyType('relation', 'multiselect', ['A.node']), true);
    assert.equal(contract.canLosslesslyChangePropertyType('text', 'relation', ''), true);
});

test('legacy checked-percent rollup is detected but not accepted as current aggregate', () => {
    const result = contract.validatePropertyValue('rollup', {
        relationProperty: 'tasks',
        targetProperty: 'done',
        aggregate: 'checked-percent'
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PROPERTY_ROLLUP_LEGACY_AGGREGATE');
    assert.equal(result.normalized.aggregate, 'count');
});