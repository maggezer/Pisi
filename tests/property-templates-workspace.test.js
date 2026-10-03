'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const structuredViewFiles = [
    'renderer/data/pisi-structured-views.mjs',
    'renderer/data/pisi-structured-view-state.mjs',
    'renderer/data/pisi-structured-view-helpers.mjs',
    'renderer/data/pisi-structured-view-query.mjs',
    'renderer/data/pisi-structured-view-property-ui.mjs',
    'renderer/data/pisi-structured-view-ui.mjs'
];
const readStructuredViews = () => structuredViewFiles.map(read).join('\n');

test('property drawer yalnız alt-sağ template seçici ile add/save ikonlarını gösterir', () => {
    const structured = readStructuredViews();
    const styles = read('styles/58-workspaces-platform.css');
    const legacyStyles = read('styles/58-workspaces-platform.css');
    const icon = read('assets/properties/template.svg');

    assert.match(structured, /className = 'pisi-property-footer'/);
    assert.match(structured, /className = 'pisi-property-template-trigger'/);
    assert.match(structured, /controls\.append\(status, templatePicker, add, save\)/);
    assert.match(structured, /option\.addEventListener\('click', async \(\) =>/);
    assert.match(structured, /applyDatabaseTemplate[\s\S]*replaceProperties: false/);
    assert.match(structured, /refreshEditor: true/);
    assert.doesNotMatch(structured, /className = 'pisi-template-controls'/);
    assert.doesNotMatch(structured, /saveDatabaseTemplate/);
    assert.doesNotMatch(structured, /deleteDatabaseTemplate/);
    assert.doesNotMatch(legacyStyles, /\.pisi-template-controls/);
    assert.match(styles, /\.pisi-property-icon-button \{[\s\S]*width: 29px;[\s\S]*height: 29px;/);
    assert.match(styles, /bottom: calc\(100% \+ 7px\)/);
    assert.match(styles, /assets\/properties\/template\.svg/);
    assert.match(icon, /viewBox="0 0 24 24"/);
    assert.doesNotMatch(icon, /<script\b/i);
});

test('Workspace Center Templates sayfası property template oluşturma ve silmeyi yönetir', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const manifest = JSON.parse(read('renderer/module-manifest.json'));
    const source = read('renderer/data/pisi-property-templates.mjs');

    assert.match(bootstrap, /\.\/data\/pisi-property-templates\.mjs/);
    assert.ok(manifest.some((entry) => entry.module === 'data.propertyTemplates' && entry.path === 'renderer/data/pisi-property-templates.mjs'));
    assert.match(source, /id: 'templates'/);
    assert.match(source, /label: 'Templates'/);
    assert.match(source, /Property şablonları/);
    assert.match(source, /getPisiSearchCurrentNodePath/);
    assert.match(source, /saveDatabaseTemplate/);
    assert.match(source, /listDatabaseTemplates/);
    assert.match(source, /deleteDatabaseTemplate/);
    assert.match(source, /properties: properties|properties\n/);
    assert.match(source, /Şablon açıklaması/);
});

test('property template yüzeyleri açık/koyu temaya ve iki dile sahiptir', () => {
    const lightStyles = read('styles/90-themes.css');
    const tr = JSON.parse(read('locales/lang-tr.json')).strings;
    const eng = JSON.parse(read('locales/lang-eng.json')).strings;

    assert.match(lightStyles, /data-pisi-theme=["\']light["\'][^\n]*\.pisi-property-template-trigger/);
    assert.match(lightStyles, /data-pisi-theme=["\']light["\'][^\n]*\.pisi-property-template-section/);
    for (const key of [
        'Şablon seç',
        'Templates',
        'Property şablonları',
        'Şablon açıklaması',
        'Aktif node’dan şablon oluştur',
        'Şablon uygulandı.',
        'Şablon kaydedildi.'
    ]) {
        assert.equal(typeof tr[key], 'string', key);
        assert.equal(typeof eng[key], 'string', key);
    }
    assert.equal(eng['Şablon seç'], 'Choose template');
});
