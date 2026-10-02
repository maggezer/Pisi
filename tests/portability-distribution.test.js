'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('portability tools are distributed without a command-center portability page', () => {
    const panel = read('renderer/portability/pisi-portability-panel.mjs');
    const commandCenter = read('renderer/shell/pisi-command-center.mjs');
    const appMenu = read('renderer/shell/pisi-window.mjs');

    assert.doesNotMatch(panel, /registerPisiCommandCenterPage/);
    assert.doesNotMatch(panel, /renderPisiPortabilityPage/);
    assert.match(appMenu, /'import',\s*'export'/);
    assert.match(appMenu, /pisi:portability-action/);
    assert.match(commandCenter, /id: 'settings'[\s\S]*renderPisiSettingsPage/);
    assert.match(commandCenter, /pisi:render-settings-sections/);
    assert.match(panel, /pisi:render-settings-sections/);
    assert.match(panel, /renderPisiIntegritySettings/);
});

test('toolbar keeps history, export, and import as a right-aligned vertical stack', () => {
    const toolbar = read('renderer/editor/pisi-editor-unified-toolbar.mjs');
    const css = read('styles/65-unified-toolbar.css');
    const actions = ['history', 'export', 'import'].map((action) => toolbar.indexOf(`data-pisi-portability-action="${action}"`));

    assert.ok(actions.every((position) => position >= 0));
    assert.deepEqual(
        [...actions].sort((a, b) => a - b),
        actions
    );
    assert.ok(toolbar.indexOf('pisi-toolbar-section-portability') > toolbar.indexOf('pisi-toolbar-section-drawing'));
    assert.match(toolbar, /detail: {[\s\S]*action: portabilityTrigger\.dataset\.pisiPortabilityAction/);
    assert.match(css, /pisi-toolbar-section-portability[\s\S]*margin-left: auto/);
    assert.match(css, /pisi-toolbar-portability-stack[\s\S]*grid-template-rows: repeat\(3, 26px\)/);
});

test('all existing transfer and restore capabilities remain available', () => {
    const panel = read('renderer/portability/pisi-portability-panel.mjs');

    assert.match(panel, /importMarkdownFolder/);
    assert.match(panel, /exportProjectMarkdown/);
    for (const format of ['markdown', 'html', 'pdf', 'docx']) {
        assert.match(panel, new RegExp(`['"]${format}['"]`));
    }
    assert.match(panel, /renderPisiHistory/);
    assert.match(panel, /renderPisiBackups/);
    assert.match(panel, /restoreNodeHistory/);
    assert.match(panel, /restoreBackup/);
});

test('new toolbar assets and light theme counterparts are present', () => {
    for (const name of ['history', 'export', 'import']) {
        const darkPath = `assets/toolbar/${name}.svg`;
        const lightPath = `assets/toolbar/light/${name}.svg`;
        assert.equal(fs.existsSync(path.join(root, darkPath)), true, darkPath);
        assert.equal(fs.existsSync(path.join(root, lightPath)), true, lightPath);
        assert.match(read(darkPath), /viewBox="0 0 24 24"/);
        assert.match(read(lightPath), /viewBox="0 0 24 24"/);
    }

    const themes = read('styles/90-themes.css');
    assert.match(themes, /light.*pisi-portability-dialog/);
    assert.match(themes, /light.*pisi-app-menu-dropdown/);
});
