'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Bases consumes project-level stable property definitions while relation candidates remain active-map nodes', () => {
    const view = read('renderer/data/pisi-bases-view.mjs');
    const hooks = read('main/functions/property-schema-operation-hooks.js');

    assert.match(view, /listMapNodes\?\.\(mapPath\)/);
    assert.match(view, /getNodePropertyContext\([\s\S]*anchorNode\.fullPath,[\s\S]*mapPath/);
    assert.match(view, /schemaContext\.propertyDefinitions/);
    assert.match(hooks, /propertyDefinitions: schemaResult\.definitions/);
    assert.match(hooks, /nodes,[\s\S]*propertyDefinitions: schemaResult\.definitions/);
});

test('Table and Card are projections only and never create another property authority', () => {
    const core = read('renderer/data/pisi-bases-core.mjs');
    const view = read('renderer/data/pisi-bases-view.mjs');

    assert.match(core, /buildPisiBaseProjection/);
    assert.match(view, /renderPisiBasesTable/);
    assert.match(view, /renderPisiBasesCards/);
    assert.doesNotMatch(core, /localStorage|writeFile|saveNodeProperties|properties\.json/);
    assert.doesNotMatch(view, /saveNodeProperties|propertyDefinitions\s*=\s*.*map\(/);
});

test('filtering does not redefine columns and cards use the same bounded canonical columns', () => {
    const core = read('renderer/data/pisi-bases-core.mjs');
    const view = read('renderer/data/pisi-bases-view.mjs');

    assert.match(core, /const columns = collectPisiBaseColumns\(sourceDocuments, definitions\)/);
    assert.match(core, /cardColumns: columns\.slice\(0, PISI_BASE_CARD_COLUMN_LIMIT\)/);
    assert.match(core, /filteredDocuments = filterPisiPropertyDocuments\(sourceDocuments, query\)/);
    assert.match(view, /for \(const column of projection\.columns\)/);
    assert.match(view, /for \(const column of projection\.cardColumns\)/);
});

test('Bases saved views keep current query/layout scope and invalid layout fails closed to table', () => {
    const view = read('renderer/data/pisi-bases-view.mjs');
    const core = read('renderer/data/pisi-bases-core.mjs');
    const store = read('main/functions/structured-nodes.js');

    assert.match(view, /query: String\(view\.query \|\| ''\).*slice\(0, 2000\)/);
    assert.match(view, /layout: normalizePisiBaseLayout\(view\.layout\)/);
    assert.match(core, /return PISI_BASE_LAYOUTS\.includes\(layout\) \? layout : 'table'/);
    assert.match(store, /layout: \['table', 'cards'\]\.includes\(view\.layout\) \? view\.layout : 'table'/);
    assert.doesNotMatch(view, /sortBy|groupBy|formula|databaseId|automation/);
});

test('Create-map action uses exactly the currently visible projection rather than a second filter implementation', () => {
    const view = read('renderer/data/pisi-bases-view.mjs');

    assert.match(view, /currentProjection = buildPisiBaseProjection/);
    assert.match(view, /query: currentProjection\.query/);
    assert.match(view, /nodePaths: currentProjection\.documents\.map\(\(item\) => item\.path\)/);
    assert.doesNotMatch(view, /createMap[\s\S]*filterPisiPropertyDocuments/);
});

test('project switch clears ephemeral Bases query/layout state to avoid cross-project leakage', () => {
    const view = read('renderer/data/pisi-bases-view.mjs');

    assert.match(view, /pisiBasesViewState\.projectFolder !== projectFolder/);
    assert.match(view, /pisiBasesViewState\.query = ''/);
    assert.match(view, /pisiBasesViewState\.layout = 'table'/);
    assert.match(view, /pisiBasesViewState\.savedViews = \[\]/);
});