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

    assert.match(bootstrap, /search\/pisi-search-index\.mjs/);
    assert.match(bootstrap, /search\/pisi-global-search\.mjs/);
    assert.match(bootstrap, /search\/pisi-links-panel\.mjs/);
    assert.match(styles, /57-search-and-links\.css/);
});

test('hızlı geçiş klavye ve map odağı davranışlarını taşır', () => {
    const source = read('renderer/search/pisi-global-search.mjs');

    assert.match(source, /event\.key\.toLocaleLowerCase\('en-US'\) === 'p'/);
    assert.match(source, /mapOnly: event\.altKey/);
    assert.match(source, /focusPisiSearchMapBox/);
    assert.match(source, /openNodeModalFromBox/);
    assert.match(source, /event\.stopPropagation\(\)/);
});

test('indeks bütün istenen içerik türlerini ayrı kayıtlar olarak üretir', () => {
    const source = read('renderer/search/pisi-search-index.mjs');

    for (const kind of [
        "'node'",
        "'map'",
        "'content'",
        "'task'",
        "'tag'",
        "'table'"
    ]) {
        assert.match(source, new RegExp('kind: ' + kind));
    }
    assert.match(source, /listFolder/);
    assert.match(source, /listMapNodes/);
    assert.match(source, /getPisiDocument/);
    assert.match(source, /onFileSystemChanged/);
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
    const required = [
        'Global arama ve hızlı geçiş',
        'Bağlantılar',
        'Bağlantısız bahsetmeler',
        'Map içinde göster'
    ];

    for (const key of required) {
        assert.equal(typeof turkish[key], 'string');
        assert.equal(typeof english[key], 'string');
        assert.ok(english[key].trim());
    }
});
