'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('sağ panel sekme içerikleri yinelenen turuncu adları göstermez', () => {
    const files = [
        'index.html',
        'renderer/search/pisi-links-panel.mjs',
        'renderer/search/pisi-search-panel.mjs',
        'renderer/tags/pisi-todo-workspace.mjs',
        'styles/20-map-interactions.css',
        'styles/91-light-theme-tuning.css'
    ];

    for (const file of files) {
        assert.doesNotMatch(read(file), /right-panel-section-title/, file);
    }

    assert.match(read('index.html'), /id="pisi-todo-panel-actions-host"/);
});
