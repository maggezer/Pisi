'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Properties düzenleyicisi node toolbarının açılır alanında yaşar', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const source = read('renderer/data/pisi-node-properties-ui.mjs');
    const structured = read('renderer/data/pisi-structured-views.mjs');

    assert.match(bootstrap, /\.\/data\/pisi-node-properties-ui\.mjs/);
    assert.match(source, /\.pisi-editor-toolbar\[data-editor-target\]/);
    assert.match(source, /className = 'pisi-node-properties-toggle'/);
    assert.match(source, /className = 'pisi-node-properties-toggle-rail'/);
    assert.match(source, /frame\.append\(toolbar, toggleRail, drawer\)/);
    assert.match(source, /record\.drawer\.hidden = !open/);
    assert.match(source, /renderPisiNodeProperties\(staging\)/);
    assert.match(source, /aria-expanded/);
    assert.doesNotMatch(structured, /registerPisiCommandCenterPage|id: 'data'/);
});

test('sağ Properties sekmesi yalnız aktif node bilgisini gösterir', () => {
    const html = read('index.html');
    const source = read('renderer/data/pisi-node-properties-ui.mjs');
    const section = html.slice(html.indexOf('<section id="right-tab-properties"'), html.indexOf('<section id="right-tab-customizations"'));
    const infoRenderer = source.slice(source.indexOf('async function renderPisiNodePropertiesInfo()'), source.indexOf('function syncPisiNodePropertiesTab'));

    assert.match(html, /data-right-tab="properties"/);
    assert.match(html, /id="pisi-node-properties-info"/);
    assert.match(source, /pisi:active-node-changed/);
    assert.match(source, /button\.disabled = !enabled/);
    assert.doesNotMatch(section, /<(?:button|input|select)\b/i);
    assert.doesNotMatch(infoRenderer, /createElement\('(?:button|input|select)'\)/);
    assert.doesNotMatch(infoRenderer, /renderPisiNodeProperties\(/);
    assert.doesNotMatch(infoRenderer, /pisi-properties-info-header/);
    assert.doesNotMatch(infoRenderer, /pisi-properties-readonly-badge/);
    assert.doesNotMatch(infoRenderer, /snapshot\.title/);
});

test('Properties yüzeyleri koyu ve açık tema ile özel sekme ikonuna sahiptir', () => {
    const systemCss = read('styles/58-workspaces-platform.css');
    const lightCss = read('styles/90-themes.css');
    const tabCss = read('styles/10-shell-map-panels.css');
    const icon = read('assets/right-tabs/properties.svg');
    const tr = JSON.parse(read('locales/lang-tr.json')).strings;
    const eng = JSON.parse(read('locales/lang-eng.json')).strings;

    assert.match(systemCss, /\.pisi-node-properties-drawer/);
    assert.match(systemCss, /\.pisi-node-properties-toggle-icon/);
    assert.match(systemCss, /\.pisi-node-properties-toggle-rail/);
    assert.match(systemCss, /border-radius: 50%/);
    assert.match(systemCss, /transform: translateY\(-50%\)/);
    assert.match(systemCss, /\.pisi-properties-info-row/);
    assert.doesNotMatch(systemCss, /\.pisi-properties-info-header/);
    assert.doesNotMatch(systemCss, /\.pisi-properties-readonly-badge/);
    assert.match(lightCss, /data-pisi-theme=["\']light["\'][^\n]*\.pisi-node-properties-drawer/);
    assert.match(tabCss, /assets\/right-tabs\/properties\.svg/);
    assert.match(icon, /viewBox="0 0 24 24"/);
    assert.doesNotMatch(icon, /<script\b/i);
    for (const key of ['Özellikleri göster', 'Özellikleri gizle', 'Bu node için özellik tanımlanmamış.']) {
        assert.equal(typeof tr[key], 'string', key);
        assert.equal(typeof eng[key], 'string', key);
    }
});
