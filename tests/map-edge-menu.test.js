'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const edgeSource = fs.readFileSync(path.join(root, 'renderer/map/pisi-map-edges.mjs'), 'utf8');
const dismissSource = fs.readFileSync(path.join(root, 'renderer/map/pisi-map-edge-selection-dismiss.mjs'), 'utf8');
const relationshipSource = fs.readFileSync(path.join(root, 'main/functions/relationship-store.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const menuStyleSource = fs.readFileSync(path.join(root, 'styles/103-map-edge-menu.css'), 'utf8');

test('selected map edge exposes a three-type connection menu instead of an x delete button', () => {
    assert.match(edgeSource, /type:\s*'down-hub'[\s\S]*sourceRole:\s*'down-hub'[\s\S]*targetRole:\s*'up-hub'/);
    assert.match(edgeSource, /type:\s*'co-level'[\s\S]*sourceRole:\s*'co-level'[\s\S]*targetRole:\s*'co-level'/);
    assert.match(edgeSource, /type:\s*'stream'[\s\S]*sourceRole:\s*'downstream'[\s\S]*targetRole:\s*'upstream'/);
    assert.match(edgeSource, /text\.textContent\s*=\s*'⋯'/);
    assert.doesNotMatch(edgeSource, /text\.textContent\s*=\s*'×'/);
    assert.match(edgeSource, /pisi-map-edge-menu-delete/);
    assert.match(edgeSource, /await deleteMapEdge\(edgeId\)/);
});

test('changing connection type persists the same edge through semantic upsert and refreshes map state', () => {
    assert.match(
        edgeSource,
        /persistPisiMapConnection\(\{[\s\S]*\.\.\.edge,[\s\S]*id:\s*edge\.id,[\s\S]*type:\s*option\.type,[\s\S]*sourceRole:\s*option\.sourceRole,[\s\S]*targetRole:\s*option\.targetRole/
    );
    assert.match(edgeSource, /activeMapEdges\s*=\s*result\.edges\s*\|\|\s*activeMapEdges/);
    assert.match(edgeSource, /drawMapConnections\(\)/);
    assert.match(edgeSource, /await refreshActiveMapTreeBranch\(\)/);
    assert.match(edgeSource, /prunePisiStaleCollapsedHubPorts\(\)/);
    assert.match(edgeSource, /selectPisiMapEdge\(edgeId\)/);

    // The semantic store replaces the relationship with the same id before appending
    // the updated form, so a type change cannot leave a duplicate old relationship.
    assert.match(relationshipSource, /relationship\.id\s*!==\s*incoming\.id[\s\S]*relationships:\s*\[\.\.\.withoutCurrent,\s*incoming\]/);
});

test('connection menu interaction keeps the edge selected while menu items are clicked', () => {
    assert.match(dismissSource, /\.pisi-map-edge-menu/);
    assert.match(edgeSource, /pisiMapEdgeMenu\.contains\(event\.target\)/);
    assert.match(edgeSource, /aria-haspopup',\s*'menu'/);
    assert.match(edgeSource, /aria-expanded',\s*'false'/);
});

test('connection menu stylesheet is loaded and supports both themes', () => {
    assert.match(styleSource, /styles\/103-map-edge-menu\.css/);
    assert.match(menuStyleSource, /\.map-edge-menu-trigger/);
    assert.match(menuStyleSource, /\.pisi-map-edge-menu/);
    assert.match(menuStyleSource, /\.pisi-map-edge-menu-type\.current/);
    assert.match(menuStyleSource, /html\[data-pisi-theme=["\']light["\']\]\s+\.pisi-map-edge-menu/);
});
