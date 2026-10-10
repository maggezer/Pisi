'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Bases-lite Workspace Center yerine map sağ üst düğmesinden açılır', () => {
    const structured = read('renderer/data/pisi-structured-views.mjs');
    const dialog = read('renderer/data/pisi-bases-dialog.mjs');
    const bootstrap = read('renderer/bootstrap.mjs');
    const manifest = JSON.parse(read('renderer/module-manifest.json'));

    assert.doesNotMatch(structured, /registerPisiCommandCenterPage/);
    assert.doesNotMatch(structured, /id: 'data'|renderPisiStructuredPage/);
    assert.match(bootstrap, /\.\/data\/pisi-bases-dialog\.mjs/);
    assert.ok(manifest.some((record) => record.module === 'data.basesDialog'));
    assert.match(dialog, /function installPisiBasesMapTrigger/);
    assert.match(dialog, /button\.id = 'pisi-bases-map-trigger'/);
    assert.match(dialog, /canvas\.appendChild\(control\)/);
    assert.match(dialog, /void openPisiBasesDialog\(\)/);
});

test('map Bases-lite düğmesi zoom kontrolleriyle aynı sağ çizgide ve üsttedir', () => {
    const css = read('styles/10-shell-map-panels.css');
    const creation = read('renderer/map/pisi-map-creation.mjs');
    const interactions = read('renderer/map/pisi-map-canvas-interactions.mjs');

    assert.match(css, /#map-zoom-controls\s*\{[\s\S]*right: 18px;[\s\S]*bottom: 18px;/);
    assert.match(css, /#pisi-bases-map-control\s*\{[\s\S]*top: 18px;[\s\S]*right: 18px;/);
    assert.match(css, /\.map-zoom-btn,\s*\.pisi-map-bases-trigger\s*\{[\s\S]*width: 38px;[\s\S]*height: 38px;/);
    assert.match(creation, /closest\?\.\('\.pisi-map-overlay-control'\)/);
    assert.match(interactions, /closest\('\.pisi-map-overlay-control'\)/);
});

test('özel Bases-lite penceresi sağlamlaştırılmış ortak projection görünümünü kullanır', () => {
    const dialog = read('renderer/data/pisi-bases-dialog.mjs');
    const view = read('renderer/data/pisi-bases-view.mjs');
    const core = read('renderer/data/pisi-bases-core.mjs');
    const css = read('styles/58-workspaces-platform.css');

    assert.match(dialog, /className = 'pisi-bases-dialog'/);
    assert.match(dialog, /setAttribute\('aria-modal', 'true'\)/);
    assert.match(dialog, /renderPisiBasesView\(content, \{ showTitle: false \}\)/);
    assert.match(dialog, /event\.key === 'Escape'/);
    assert.match(view, /async function renderPisiBasesView\(container, options = \{\}\)/);
    assert.match(view, /buildPisiBaseProjection/);
    assert.match(view, /renderPisiBasesTable/);
    assert.match(view, /renderPisiBasesCards/);
    assert.match(view, /window\.closePisiBasesDialog\?\.\(\)/);
    assert.match(core, /function collectPisiBaseColumns/);
    assert.match(css, /\.pisi-bases-dialog-overlay/);
    assert.match(css, /\.pisi-bases-dialog-body/);
});

test('Bases-lite düğmesi, penceresi ve özel ikonu iki temaya uygundur', () => {
    const dark = read('styles/58-workspaces-platform.css');
    const light = read('styles/90-themes.css');
    const mapCss = read('styles/10-shell-map-panels.css');
    const icon = read('assets/icons/bases-lite.svg');
    const icons = JSON.parse(read('assets/icons/icons.json'));
    const tr = JSON.parse(read('locales/lang-tr.json')).strings;
    const eng = JSON.parse(read('locales/lang-eng.json')).strings;

    assert.match(mapCss, /assets\/icons\/bases-lite\.svg/);
    assert.match(dark, /\.pisi-bases-dialog/);
    assert.match(light, /data-pisi-theme=["\']light["\'][^\n]*\.pisi-map-bases-trigger/);
    assert.match(light, /data-pisi-theme=["\']light["\'][^\n]*\.pisi-bases-dialog/);
    assert.equal(icons.actions.basesLite, 'assets/icons/bases-lite.svg');
    assert.match(icon, /viewBox="0 0 24 24"/);
    assert.doesNotMatch(icon, /<script\b|on\w+=/i);
    for (const key of ["Bases-lite'ı aç", 'Bases-lite yüklenemedi.']) {
        assert.equal(typeof tr[key], 'string', key);
        assert.equal(typeof eng[key], 'string', key);
    }
});
