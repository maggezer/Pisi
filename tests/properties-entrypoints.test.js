'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Properties için sol panelde kalıcı ve doğrudan erişim bulunur', () => {
    const html = read('index.html');
    const commandCenter = read('renderer/shell/pisi-command-center.mjs');
    const icons = JSON.parse(read('assets/icons/icons.json'));

    assert.match(html, /id="pisi-command-center-button"/);
    assert.match(html, /id="pisi-properties-button"/);
    assert.match(html, /pisi-project-action-icon-workspace/);
    assert.match(html, /pisi-project-action-icon-properties/);
    assert.match(commandCenter, /openPisiCommandCenter\('data'\)/);
    assert.match(commandCenter, /ensurePisiCommandCenterLauncher/);
    assert.equal(icons.actions.workspaceCenter, 'assets/icons/workspace-center.svg');
    assert.equal(icons.actions.properties, 'assets/icons/properties.svg');
});

test('Properties Workspace Center içinde ikonlu sekme olarak kayıtlıdır', () => {
    const structured = read('renderer/data/pisi-structured-views.mjs');
    const commandCenter = read('renderer/shell/pisi-command-center.mjs');
    const css = read('styles/58-roadmap-workspace.css');

    assert.match(
        structured,
        /id: 'data',[\s\S]*label: 'Özellikler',[\s\S]*icon: 'properties'/
    );
    assert.match(commandCenter, /pisi-command-center-tab-icon-/);
    assert.match(css, /pisi-command-center-tab-icon-properties/);
    assert.match(css, /assets\/icons\/properties\.svg/);
});

test('Workspace Center proje yokken boş sayfa yerine erişilebilir girişler gösterir', () => {
    const commandCenter = read('renderer/shell/pisi-command-center.mjs');

    assert.doesNotMatch(
        commandCenter,
        /if \(!window\.currentProjectFolder && !requestedPage\)/
    );
    assert.match(commandCenter, /function renderPisiSettingsPage/);
    assert.match(commandCenter, /render: async \(container\) => renderPisiSettingsPage\(container\)/);
});

test('yeni Workspace Center ikonları güvenli ortak SVG geometrisini kullanır', () => {
    for (const name of ['workspace-center', 'properties']) {
        const svg = read(`assets/icons/${name}.svg`);
        assert.match(svg, /<svg\b/);
        assert.match(svg, /viewBox="0 0 64 64"/);
        assert.doesNotMatch(svg, /<script\b/i);
    }
});
