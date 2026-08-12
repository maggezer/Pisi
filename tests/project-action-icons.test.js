'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('sol panel proje eylemleri özel SVG ikonlarla gösterilir', () => {
    const html = read('index.html');
    const css = read('styles/93-node-action-icons.css');
    const registry = JSON.parse(read('assets/icons/icons.json'));

    assert.match(html, /id="add-map-btn"[^>]*[\s\S]*?pisi-project-action-icon-map/);
    assert.match(html, /id="change-project-btn"[^>]*[\s\S]*?pisi-project-action-icon-project/);
    assert.match(html, /id="add-node-btn"[^>]*[\s\S]*?pisi-project-action-icon-node/);
    assert.doesNotMatch(html, /id="(?:add-map-btn|change-project-btn)"[^>]*>\s*(?:🗺️|📁)/);
    assert.match(css, /assets\/icons\/create-map\.svg/);
    assert.match(css, /assets\/icons\/change-project\.svg/);
    assert.equal(registry.actions.createMap, 'assets/icons/create-map.svg');
    assert.equal(registry.actions.changeProject, 'assets/icons/change-project.svg');
});

test('yeni proje eylemi SVG assetleri güvenli ve ortak geometri kullanır', () => {
    for (const name of ['create-map', 'change-project']) {
        const svg = read(`assets/icons/${name}.svg`);
        assert.match(svg, /<svg\b/);
        assert.match(svg, /viewBox="0 0 64 64"/);
        assert.doesNotMatch(svg, /<script\b/i);
    }
});

test('proje eylem butonları tema, odak ve basma durumlarını taşır', () => {
    const foundation = read('styles/00-foundation.css');
    const themes = read('styles/90-themes.css');

    assert.match(foundation, /\.project-action-btn \{[\s\S]*width: 32px;[\s\S]*height: 32px/);
    assert.match(foundation, /\.project-action-btn:hover \{[\s\S]*border-color: #f39c12/);
    assert.match(foundation, /\.project-action-btn:focus-visible/);
    assert.match(themes, /html\[data-pisi-theme="light"\] \.project-action-btn/);
});
