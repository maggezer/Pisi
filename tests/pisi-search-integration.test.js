'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
};

test('arama modülleri bootstrap ve stil zincirine bağlıdır', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const styles = read('style.css');

    for (const moduleName of [
        'pisi-search-index.mjs',
        'pisi-search-query.mjs',
        'pisi-search-history.mjs',
        'pisi-search-enhanced-index.mjs',
        'pisi-search-navigation.mjs',
        'pisi-global-search.mjs',
        'pisi-search-panel.mjs',
        'pisi-links-panel.mjs'
    ]) {
        assert.match(bootstrap, new RegExp('search/' + moduleName.replace('.', '\\.')));
    }
    assert.doesNotMatch(bootstrap, /search\/pisi-block-graph\.mjs/);
    assert.match(styles, /57-search-and-links\.css/);
    assert.match(styles, /57-search-navigation-enhancements\.css/);
    assert.match(styles, /59-platform-system\.css/);
});

test('hızlı geçiş klavye, filtre ve map odağı davranışlarını taşır', () => {
    const source = read('renderer/search/pisi-global-search.mjs');
    const navigation = read('renderer/search/pisi-search-navigation.mjs');
    const commands = read('renderer/core/pisi-command-registry.mjs');

    assert.match(source, /defaultShortcut: 'Mod\+P'/);
    assert.match(source, /PageDown/);
    assert.match(source, /Home/);
    assert.match(source, /pisi-global-search-filter/);
    assert.match(source, /mapOnly: event\.altKey/);
    assert.match(navigation, /focusPisiSearchMapBox/);
    assert.match(navigation, /activeMapPath/);
    assert.match(commands, /event\.stopImmediatePropagation\(\)/);
});

test('task search results use canonical taskId and exact task navigation', () => {
    const enhanced = read('renderer/search/pisi-search-enhanced-index.mjs');
    const navigation = read('renderer/search/pisi-search-navigation.mjs');

    assert.match(enhanced, /getPisiCanonicalSearchTasks/);
    assert.match(enhanced, /kind: 'task'/);
    assert.match(enhanced, /taskId: task\.id/);
    assert.match(enhanced, /id: `task:\$\{task\.id\}`/);
    assert.match(enhanced, /\.filter\(\(record\) => record\?\.kind !== 'task'\)/);
    assert.match(navigation, /result\?\.kind === 'task'/);
    assert.match(navigation, /result\?\.taskId/);
    assert.match(navigation, /openPisiTagBlockResult/);
    assert.match(navigation, /missionId: result\.taskId/);
});

test('indeks içerik türlerini korur ve node property değerlerini projection olarak ekler', () => {
    const source = read('renderer/search/pisi-search-index.mjs');
    const enhanced = read('renderer/search/pisi-search-enhanced-index.mjs');
    const adapter = read('renderer/search/pisi-search-index-adapter.mjs');

    for (const kind of ["'node'", "'map'", "'content'", "'task'", "'tag'", "'table'"]) {
        assert.match(source, new RegExp('kind: ' + kind));
    }
    assert.match(source, /listFolder/);
    assert.match(source, /listMapNodes/);
    assert.match(source, /getPisiDocument/);
    assert.match(source, /onFileSystemChanged/);
    assert.match(source, /buildPisiSearchAccelerator/);
    assert.match(source, /pisiSearchDocumentCache/);
    assert.match(source, /changedPaths/);
    assert.match(enhanced, /makePisiSearchPropertyFields/);
    assert.match(enhanced, /kind: 'property'/);
    assert.match(enhanced, /createPisiRebuildableSearchIndex/);
    assert.match(adapter, /buildPisiSearchAccelerator\(records\)/);
});

test('quick switch son kullanılanları proje bazlı tutar ve başarılı navigasyonda kaydeder', () => {
    const history = read('renderer/search/pisi-search-history.mjs');
    const navigation = read('renderer/search/pisi-search-navigation.mjs');
    const source = read('renderer/search/pisi-global-search.mjs');

    assert.match(history, /PISI_SEARCH_HISTORY_PREFIX/);
    assert.match(history, /pisiSearchPathKey\(projectFolder\)/);
    assert.match(history, /PISI_SEARCH_HISTORY_LIMIT = 32/);
    assert.match(navigation, /rememberPisiSearchResult/);
    assert.match(navigation, /if \(opened\) rememberSuccessfulPisiSearchNavigation/);
    assert.match(source, /makePisiSearchRecentMap/);
    assert.match(source, /Son kullanılanlar ve hızlı geçiş/);
});

test('advanced query grammar fuzzy ranking ve bounded fallback kullanılır', () => {
    const query = read('renderer/search/pisi-search-query.mjs');
    const source = read('renderer/search/pisi-global-search.mjs');
    const panel = read('renderer/search/pisi-search-panel.mjs');

    for (const filter of ['type', 'kind', 'map', 'path', 'tag', 'status', 'priority']) {
        assert.match(query, new RegExp("'" + filter + "'"));
    }
    assert.match(query, /boundedPisiEditDistance/);
    assert.match(query, /PISI_SEARCH_FUZZY_FIELDS/);
    assert.match(query, /slice\(0, 2500\)/);
    assert.match(source, /searchPisiAdvancedIndex/);
    assert.match(panel, /searchPisiAdvancedIndex/);
});

test('aktif node olayı ve proje değişimi ilişki indeksini yeniler', () => {
    const editor = read('renderer/editor/pisi-node-editor.mjs');
    const project = read('renderer/tree/pisi-project.mjs');
    const links = read('renderer/search/pisi-links-panel.mjs');

    assert.match(editor, /pisi:active-node-changed/);
    assert.match(project, /invalidatePisiSearchIndex\('project-change'\)/);
    assert.match(links, /buildPisiRelationshipModel/);
    assert.match(links, /pisi:active-node-changed/);
});

test('arama arayüzünün Türkçe ve İngilizce anahtarları eşlenmiştir', () => {
    const turkish = JSON.parse(read('locales/lang-tr.json')).strings;
    const english = JSON.parse(read('locales/lang-eng.json')).strings;
    const required = ['Global arama ve hızlı geçiş', 'Bağlantılar', 'Bağlantısız bahsetmeler', 'Map içinde göster'];

    for (const key of required) {
        assert.equal(typeof turkish[key], 'string');
        assert.equal(typeof english[key], 'string');
        assert.ok(english[key].trim());
    }
});
