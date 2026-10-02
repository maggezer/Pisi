'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspacePath = path.join(__dirname, '..', 'renderer', 'map', 'pisi-map-workspace.mjs');
const creationPath = path.join(__dirname, '..', 'renderer', 'map', 'pisi-map-creation.mjs');

const creationBindings = [
    'getMapWorldPointFromClient',
    'isMapBlankEventTarget',
    'createMapNodeBoxAtClientPoint',
    'hidePisiMapContextMenu',
    'showPisiMapContextMenu',
    'bindMapCreationEvents'
];

test('split map creation bindings are owned only by map.creation', () => {
    const workspaceSource = fs.readFileSync(workspacePath, 'utf8');
    const creationSource = fs.readFileSync(creationPath, 'utf8');

    assert.match(creationSource, /registerModule\(["\']map\.creation["\']\s*,[\s\S]*?\);/);

    for (const binding of creationBindings) {
        assert.match(creationSource, new RegExp('\\b' + binding + '\\b'), binding + ' must remain in map.creation');

        assert.doesNotMatch(
            workspaceSource,
            new RegExp('"' + binding + '"\\s*:\\s*\\{\\s*enumerable\\s*:\\s*true[\\s\\S]*?' + 'return\\s+' + binding + '\\s*;'),
            binding + ' must not be re-exported by map.workspace'
        );
    }
});
