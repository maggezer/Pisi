'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('global etiket gezgini sağ panel yerine Workspace Center içinde yaşar', () => {
    const html = read('index.html');
    const tags = read('renderer/tags/pisi-tag-panels.mjs');
    const tagIndex = read('renderer/tags/pisi-tag-index.mjs');

    assert.doesNotMatch(html, /id="right-tab-tags"|data-right-tab="tags"/);
    assert.match(tags, /registerPisiCommandCenterPage\(\{/);
    assert.match(tags, /id: 'tags'/);
    assert.match(tags, /className = 'pisi-tag-explorer-page'/);
    assert.match(tags, /function openPisiTagExplorer/);
    assert.match(tagIndex, /pisi:tags-index-updated/);
});

test('Bağlantılar sekmesi node ilişkileri ile blok referanslarını birleştirir', () => {
    const links = read('renderer/search/pisi-links-panel.mjs');
    const blocks = read('renderer/search/pisi-block-graph.mjs');
    const commandCenter = read('renderer/shell/pisi-command-center.mjs');

    assert.match(links, /right-tab-connections/);
    assert.match(links, /\['node', 'Node bağlantıları'\]/);
    assert.match(links, /\['blocks', 'Blok referansları'\]/);
    assert.match(links, /renderPisiBlockRelationshipPanel\(panel, \{ showTitle: false \}\)/);
    assert.match(links, /function openPisiBlockConnections/);
    assert.match(blocks, /id: 'block-graph'[\s\S]*hidden: true/);
    assert.doesNotMatch(blocks, /core\.block-relations|icon: 'blocks'/);
    assert.match(commandCenter, /hidden: page\.hidden === true/);
    assert.match(commandCenter, /!page\.hidden/);
});

test('blok hover menüsü kimlik yazmadan referans ekler ve kullanımları açar', () => {
    const bootstrap = read('renderer/bootstrap.mjs');
    const editor = read('renderer/editor/pisi-block-editor.mjs');
    const actions = read('renderer/editor/pisi-block-actions.mjs');
    const graph = read('renderer/search/pisi-block-graph.mjs');
    const research = read('renderer/research/pisi-research-panel.mjs');
    const manifest = JSON.parse(read('renderer/module-manifest.json'));

    assert.match(bootstrap, /editor\/pisi-block-actions\.mjs/);
    assert.match(editor, /`\[\[\$\{nodeTitle\}#\^\$\{block\.dataset\.pisiBlockId\}\]\]`/);
    assert.match(actions, /className = 'pisi-block-handle'/);
    assert.match(actions, /Blok referansı ekle/);
    assert.match(actions, /Kullanıldığı yerleri göster/);
    assert.match(actions, /dataset\.pisiBlockRef = `\$\{candidate\.nodePath\}#\$\{candidate\.blockId\}`/);
    assert.match(actions, /window\.openPisiBlockConnections/);
    assert.match(actions, /function openPisiEmbeddedBlockReference/);
    assert.doesNotMatch(graph, /meta\.textContent = `\$\{item\.blockId\}/);
    assert.match(research, /Blok seçerek referans ekle/);
    assert.match(research, /const blockReference = document\.createElement\('select'\)/);
    assert.doesNotMatch(research, /Node\.node#block-id/);
    assert.ok(manifest.some((entry) => (
        entry.module === 'editor.blockActions' &&
        entry.path === 'renderer/editor/pisi-block-actions.mjs'
    )));
});

test('birleşik detay, bağlantı ve blok yüzeyleri iki temada tanımlıdır', () => {
    const system = read('styles/59-platform-system.css');
    const links = read('styles/57-search-and-links.css');
    const light = read('styles/91-light-theme-tuning.css');

    assert.match(system, /\.pisi-node-details-tags/);
    assert.match(system, /\.pisi-block-handle/);
    assert.match(system, /\.pisi-block-reference-picker-dialog/);
    assert.match(links, /\.pisi-connections-switcher/);
    assert.match(light, /data-pisi-theme="light"[^\n]*\.pisi-node-details-tag/);
    assert.match(light, /data-pisi-theme="light"[^\n]*\.pisi-block-handle/);
    assert.match(light, /data-pisi-theme="light"[^\n]*\.pisi-connections-switcher/);
});
