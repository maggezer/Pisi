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
    assert.match(panel, /ensurePisiEnhancedLiveSearchIndex/);
    assert.match(panel, /searchPisiAdvancedIndex/);
    assert.match(panel, /makePisiSearchRecentMap/);
    assert.match(panel, /openPisiSearchResult/);
    assert.ok(manifest.some((entry) => entry.module === 'search.rightPanel' && entry.path === 'renderer/search/pisi-search-panel.mjs'));
});

test('arama sonuçları teknik node kimliklerini kullanıcıya göstermez', () => {
    const panel = read('renderer/search/pisi-search-panel.mjs');
    const helperSource = panel.slice(panel.indexOf('function getPisiRightSearchDisplayPath'), panel.indexOf('function getPisiRightSearchPreview'));
    const getDisplayPath = Function(`${helperSource}; return getPisiRightSearchDisplayPath;`)();

    assert.equal(getDisplayPath('nd_Proje__map_24fc/Plan__node_f35a-91b2.node'), 'Plan.node');
    assert.equal(getDisplayPath('Belgeler/Plan__node_f35a-91b2.node'), 'Belgeler / Plan.node');
    assert.match(panel, /getPisiRightSearchPreview\(result\)/);
    assert.match(panel, /openPisiSearchResult\(result/);
    assert.doesNotMatch(panel, /\[result\.mapTitle, result\.relativePath\]/);
    assert.doesNotMatch(panel, /getPisiRightSearchContext/);
    assert.doesNotMatch(panel, /pisi-right-search-result-context/);
});

test('Links dahil dinamik sekmeler her tıklamada güncel durumdan seçilir', () => {
    const source = read('renderer/shell/pisi-window.mjs');

    assert.match(source, /async function activatePisiRightPanelTab/);
    assert.match(source, /document\.querySelectorAll\('\.right-panel-tab\[data-right-tab\]'\)/);
    assert.match(source, /item\.classList\.toggle\('active', selected\)/);
    assert.match(source, /aria-selected', selected \? 'true' : 'false'/);
    assert.match(source, /void activatePisiRightPanelTab\(button\)/);
});

test('sağ arama yüzeyi koyu ve açık tema stillerine sahiptir', () => {
    const searchCss = read('styles/50-productivity.css');
    const enhancementCss = read('styles/50-productivity.css');
    const lightCss = read('styles/90-themes.css');

    assert.match(searchCss, /\.pisi-right-search-input-row/);
    assert.match(searchCss, /\.pisi-right-search-result\.selected/);
    assert.match(searchCss, /assets\/right-tabs\/search\.svg/);
    assert.match(enhancementCss, /\.pisi-right-search-syntax/);
    assert.match(enhancementCss, /html\[data-theme=["\']light["\']\]/);
    assert.match(lightCss, /\.pisi-right-search-input-row/);
    assert.match(lightCss, /\.pisi-right-search-result\.selected/);
    assert.doesNotMatch(searchCss, /\.pisi-right-search-result-context/);
    assert.doesNotMatch(lightCss, /\.pisi-right-search-result-context/);
});

test('arka plan arama indeksi güncellemeleri odağı arama çubuğuna zorla çekmez', () => {
    const panel = read('renderer/search/pisi-search-panel.mjs');

    assert.match(panel, /if \(options\.focus === true && state\.page\.classList\.contains\('active'\)\)/);
    assert.match(panel, /activatePisiRightSearchPanel\(\{\s*focus:\s*true\s*\}\)/);
    assert.match(panel, /'pisi:search-index-invalidated'[\s\S]*?shouldDeferRightSearchRefresh/);
    assert.match(panel, /'pisi:enhanced-search-index-updated'[\s\S]*?shouldDeferRightSearchRefresh/);
});

test('not yazılırken veya düzenlenirken sağ arama paneli kendini yenilemez', () => {
    const panel = read('renderer/search/pisi-search-panel.mjs');

    assert.match(panel, /function isUserEditingNote\(\)/);
    assert.match(panel, /function shouldDeferRightSearchRefresh\(event\)/);
    assert.match(panel, /state\.pendingRefresh = true/);
    assert.match(panel, /hadMatches/);
});


