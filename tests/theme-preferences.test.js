'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('tema tercihi proje bağımsız saklanır ve document köküne uygulanır', () => {
    const customizations = read('renderer/shell/pisi-customizations.mjs');

    assert.match(customizations, /PISI_THEME_STORAGE_KEY = 'pisi\.theme\.v1'/);
    assert.match(customizations, /new Set\(\['dark', 'light'\]\)/);
    assert.match(customizations, /root\.dataset\.pisiTheme = normalized/);
    assert.match(customizations, /root\.style\.colorScheme = normalized/);
    assert.match(customizations, /localStorage\.setItem\(PISI_THEME_STORAGE_KEY, normalized\)/);
    assert.match(customizations, /pisi:theme-changed/);
    assert.match(customizations, /applyPisiTheme\(getPisiThemePreference\(\)\)/);
});

test('Workspace Center Tercihler sayfası koyu ve açık tema seçicilerini sunar', () => {
    const commandCenter = read('renderer/shell/pisi-command-center.mjs');

    assert.match(commandCenter, /id: 'preferences'/);
    assert.match(commandCenter, /renderPisiPreferencesPage/);
    assert.match(commandCenter, /makePisiThemeOption\(/);
    assert.match(commandCenter, /'dark'/);
    assert.match(commandCenter, /'light'/);
    assert.match(commandCenter, /setPisiThemePreference\(theme\)/);
    assert.match(commandCenter, /pisi-theme-option/);
});

test('light palette son CSS katmanında ana Pisi yüzeylerini kapsar', () => {
    const style = read('style.css');
    const themes = read('styles/90-themes.css');

    assert.match(style, /styles\/90-themes\.css/);
    assert.match(themes, /html\[data-pisi-theme="light"\] body/);
    assert.match(themes, /html\[data-pisi-theme="light"\] #map-canvas/);
    assert.match(themes, /html\[data-pisi-theme="light"\] #center-node-editor-content/);
    assert.match(themes, /html\[data-pisi-theme="light"\] \.pisi-editor-toolbar/);
    assert.match(themes, /html\[data-pisi-theme="light"\] \.pisi-command-center-dialog/);
    assert.match(themes, /html\[data-pisi-theme="light"\] \.pisi-mission-card/);
});

test('light mode varsayılan map node rengini açar ama özel renk altyapısını korur', () => {
    const customizations = read('renderer/shell/pisi-customizations.mjs');

    assert.match(customizations, /key === 'mapNodeBoxColor'/);
    assert.match(customizations, /getPisiThemePreference\(\) === 'light'/);
    assert.match(customizations, /value = '#ffffff'/);
    assert.match(customizations, /root\.style\.setProperty\(cssVariable, value\)/);
});
