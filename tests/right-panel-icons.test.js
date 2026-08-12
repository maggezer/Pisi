'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const iconNames = ['todo', 'tags', 'customize', 'blocks', 'links'];

test('beş ana sağ panel sekmesi yalnız özel ikonlarla gösterilir', () => {
    const html = read('index.html');
    const tr = JSON.parse(read('locales/lang-tr.json')).strings;
    const eng = JSON.parse(read('locales/lang-eng.json')).strings;
    const extensions = read('renderer/core/pisi-extension-api.mjs');
    const blocks = read('renderer/search/pisi-block-graph.mjs');
    const links = read('renderer/search/pisi-links-panel.mjs');

    for (const name of ['todo', 'tags', 'customize']) {
        assert.match(html, new RegExp(`pisi-right-tab-icon-${name}`));
    }
    assert.match(html, /title="ToDo"/);
    assert.match(html, /aria-label="ToDo"/);
    assert.equal(typeof tr.ToDo, 'string');
    assert.equal(typeof eng.ToDo, 'string');
    assert.doesNotMatch(
        html,
        /data-right-tab="(?:missions|tags|customizations)"[^>]*>\s*(?:ToDo|Tags|Customize)\s*</s
    );
    assert.match(blocks, /icon: 'blocks'/);
    assert.match(extensions, /pisi-right-tab-icon-\$\{iconName\}/);
    assert.match(extensions, /button\.setAttribute\('aria-label', label\)/);
    assert.match(links, /pisi-right-tab-icon-links/);
    assert.match(links, /button\.setAttribute\('aria-label', button\.title\)/);
});

test('sağ panel sekmeleri kare ve sağa yaslıdır', () => {
    const css = read('styles/20-map-interactions.css');

    assert.match(css, /#right-panel-tabs \{[\s\S]*justify-content: flex-end/);
    assert.match(css, /\.right-panel-tab \{[\s\S]*width: 32px;[\s\S]*height: 32px/);
    assert.match(css, /\.pisi-right-tab-icon \{[\s\S]*background: currentColor/);
    for (const name of iconNames) {
        assert.match(css, new RegExp(`assets/right-tabs/${name}\\.svg`));
    }
});

test('özel sekme SVG assetleri güvenli ve ortak geometri kullanır', () => {
    for (const name of iconNames) {
        const svg = read(`assets/right-tabs/${name}.svg`);
        assert.match(svg, /<svg\b/);
        assert.match(svg, /viewBox="0 0 24 24"/);
        assert.doesNotMatch(svg, /<script\b/i);
    }
});
