'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('arama soldan kaldırılır ve gerçek sağ panel sekmesine taşınır', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const globalSearch = read('renderer/search/pisi-global-search.mjs');
    const panel = read('renderer/search/pisi-search-panel.mjs');
    const manifest = JSON.parse(read('renderer/module-manifest.json'));

    assert.match(bootstrap, /search\/pisi-search-panel\.mjs/);
    assert.doesNotMatch(globalSearch, /function installPisiSearchTrigger/);
    assert.doesNotMatch(globalSearch, /getElementById\('project-actions'\)/);
    assert.match(globalSearch, /defaultShortcut: 'Mod\+P'/);
    assert.match(panel, /id = 'pisi-search-tab-button'/);
    assert.match(panel, /page\.id = 'right-tab-search'/);
    assert.match(panel, /ensurePisiSearchIndex/);
    assert.match(panel, /searchPisiIndex/);
    assert.match(panel, /openPisiSearchResult/);
    assert.ok(manifest.some((entry) => (
        entry.module === 'search.rightPanel' &&
        entry.path === 'renderer/search/pisi-search-panel.mjs'
    )));
});

test('Links dahil dinamik sekmeler her tıklamada güncel durumdan seçilir', () => {
    const source = read('renderer/shell/pisi-window.mjs');

    assert.match(source, /async function activatePisiRightPanelTab/);
    assert.match(
        source,
        /document\.querySelectorAll\('\.right-panel-tab\[data-right-tab\]'\)/
    );
    assert.match(source, /item\.classList\.toggle\('active', selected\)/);
    assert.match(source, /aria-selected', selected \? 'true' : 'false'/);
    assert.match(source, /void activatePisiRightPanelTab\(button\)/);
});

test('sağ arama yüzeyi koyu ve açık tema stillerine sahiptir', () => {
    const searchCss = read('styles/57-search-and-links.css');
    const lightCss = read('styles/91-light-theme-tuning.css');

    assert.match(searchCss, /\.pisi-right-search-input-row/);
    assert.match(searchCss, /\.pisi-right-search-result\.selected/);
    assert.match(searchCss, /assets\/right-tabs\/search\.svg/);
    assert.match(lightCss, /\.pisi-right-search-input-row/);
    assert.match(lightCss, /\.pisi-right-search-result\.selected/);
});
