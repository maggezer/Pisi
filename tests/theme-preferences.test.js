'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadCustomizationRuntime(initialStorage = {}) {
    const storage = new Map(Object.entries(initialStorage));
    const cssVariables = new Map();
    const documentElement = {
        dataset: {},
        style: {
            colorScheme: '',
            setProperty(name, value) {
                cssVariables.set(name, value);
            }
        }
    };
    const document = {
        documentElement,
        body: { dataset: {} },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        getElementById() { return null; },
        dispatchEvent() {}
    };
    const context = {
        console,
        document,
        window: { pisiI18n: null },
        localStorage: {
            getItem(key) { return storage.get(key) ?? null; },
            setItem(key, value) { storage.set(key, String(value)); }
        },
        CustomEvent: class CustomEvent {},
        registerModule() {}
    };
    const source = read('renderer/shell/pisi-customizations.mjs')
        .replace(/^import[^\n]+\n/, '')
        .replace(/\nexport\s*\{[\s\S]*?\};\s*$/, '') + `
globalThis.__pisiThemeTest = {
    applyPisiMapNodeCustomization,
    resolvePisiCustomizationValue,
    setPisiThemePreference
};`;
    vm.runInNewContext(source, context);
    return {
        api: context.__pisiThemeTest,
        cssVariables,
        documentElement,
        storage
    };
}

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

test('map node varsayılanı iki yönde tema ile değişir, açık kullanıcı rengi korunur', () => {
    const customizations = read('renderer/shell/pisi-customizations.mjs');

    assert.match(customizations, /key === 'mapNodeBoxColor'/);
    assert.match(customizations, /PISI_THEME_MAP_NODE_BOX_COLORS/);
    assert.match(customizations, /dark: '#252526'/);
    assert.match(customizations, /light: '#ffffff'/);
    assert.match(customizations, /document\.documentElement\?\.dataset\?\.pisiTheme/);
    assert.match(customizations, /PISI_EXPLICIT_THEME_COLOR_KEYS/);
    assert.match(customizations, /explicitThemeColorKeys\.add\(key\)/);
    assert.match(customizations, /syncPisiCustomizationInputs\(settings\)/);
    assert.match(customizations, /root\.style\.setProperty\(cssVariable, value\)/);
});

test('eski açık tema rengi koyu temaya geçerken yenilenir', () => {
    const runtime = loadCustomizationRuntime({
        'pisi.theme.v1': 'light',
        'pisi.customization.v1': JSON.stringify({
            mapNodeBoxColor: '#ffffff'
        })
    });

    assert.equal(
        runtime.cssVariables.get('--pisi-map-node-box-color'),
        '#ffffff'
    );

    runtime.api.setPisiThemePreference('dark');

    assert.equal(runtime.documentElement.dataset.pisiTheme, 'dark');
    assert.equal(
        runtime.cssVariables.get('--pisi-map-node-box-color'),
        '#252526'
    );
});

test('açıkça seçilen global ve node özel renkleri tema varsayılanını ezer', () => {
    const runtime = loadCustomizationRuntime({
        'pisi.theme.v1': 'dark'
    });
    const explicitWhite = runtime.api.resolvePisiCustomizationValue(
        'mapNodeBoxColor',
        {
            mapNodeBoxColor: '#ffffff',
            _explicitThemeColorKeys: ['mapNodeBoxColor']
        }
    );
    assert.equal(explicitWhite, '#ffffff');

    const nodeVariables = new Map();
    const box = {
        dataset: {},
        style: {
            setProperty(name, value) {
                nodeVariables.set(name, value);
            },
            removeProperty(name) {
                nodeVariables.delete(name);
            }
        }
    };
    runtime.api.applyPisiMapNodeCustomization(box, {
        customization: { cardColor: '#dec0de' }
    });
    assert.equal(
        nodeVariables.get('--pisi-map-node-box-color'),
        '#dec0de'
    );
});
