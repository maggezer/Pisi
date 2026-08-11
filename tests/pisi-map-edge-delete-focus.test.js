'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file) {
    return fs.readFileSync(path.join(root, file), 'utf8');
}

test('bağlantı silme node düzenleme odağını ve map etkileşim durumunu geri yükler', () => {
    const edges = read('renderer/map/pisi-map-edges.mjs');
    const deleteFlow = edges.match(
        /async function deleteMapEdge\(edgeId\) \{[\s\S]*?\n\}\n\nfunction createMapEdgeDeleteButton/
    )?.[0] || '';

    assert.match(deleteFlow, /await pisiConfirm\('Bu bağlantı silinsin mi\?'/);
    assert.match(deleteFlow, /resetPisiKeyboardAndPointerState\(\)/);
    assert.match(deleteFlow, /await refreshActiveMapTreeBranch\(\)/);
    assert.match(deleteFlow, /refocusPisiRenderer\(\)/);
    assert.match(deleteFlow, /setTimeout\(\(\) => \{[\s\S]*?refocusPisiRenderer\(\);[\s\S]*?\}, 80\)/);
});
