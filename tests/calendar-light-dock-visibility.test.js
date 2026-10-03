'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const rendererRuntimeFiles = [
    'renderer/runtime.mjs',
    'renderer/runtime-lifecycle.mjs',
    'renderer/runtime-events.mjs',
    'renderer/calendar/pisi-calendar-state.mjs',
    'renderer/calendar/pisi-calendar-ui.mjs',
    'renderer/calendar/pisi-calendar-diary.mjs',
    'renderer/calendar/pisi-calendar-runtime.mjs'
];
const readRendererRuntime = () => rendererRuntimeFiles.map(read).join('\n');

test('calendar drag exposes equal left and right dock targets slightly larger than the calendar', () => {
    const base = read('styles/92-compatibility.css');
    const fix = read('styles/105-feature-polish.css');
    const runtime = readRendererRuntime();
    const entry = read('style.css');

    assert.match(base, /#right-panel > \.pisi-calendar-dock-zone\[data-calendar-dock-zone=["\']right["\']\] \{[\s\S]*?height: 0;[\s\S]*?overflow: hidden;/);
    assert.match(runtime, /document\.body\.classList\.add\('pisi-calendar-is-dragging'\)/);
    assert.match(
        fix,
        /body\.pisi-calendar-is-dragging #left-panel > \.pisi-calendar-dock-zone\[data-calendar-dock-zone=["\']left["\']\]:not\(\.has-calendar\),[\s\S]*?body\.pisi-calendar-is-dragging #right-panel > \.pisi-calendar-dock-zone\[data-calendar-dock-zone=["\']right["\']\]:not\(\.has-calendar\) \{[\s\S]*?z-index: 7000;[\s\S]*?width: 238px;[\s\S]*?height: 270px;[\s\S]*?min-height: 270px;[\s\S]*?max-height: 270px;[\s\S]*?overflow: visible;/
    );
    assert.match(fix, /max-width: calc\(100% - 4px\);/);
    assert.match(fix, /\.active-drop-target,[\s\S]*?\.active-drop-target \{[\s\S]*?z-index: 7001;/);

    const baseIndex = entry.indexOf('92-compatibility.css');
    const fixIndex = entry.indexOf('105-feature-polish.css');
    assert.ok(baseIndex >= 0 && fixIndex > baseIndex);
});

test('compact calendar month controls have explicit light-theme styling', () => {
    const fix = read('styles/105-feature-polish.css');

    assert.match(fix, /html\[data-pisi-theme=["\']light["\']\] body \.pisi-calendar \{[\s\S]*?background: #ffffff;[\s\S]*?color-scheme: light;/);
    assert.match(fix, /html\[data-pisi-theme=["\']light["\']\] body \.pisi-calendar-month-label \{[\s\S]*?color: var\(--pisi-theme-text, #20252c\);/);
    assert.match(
        fix,
        /html\[data-pisi-theme=["\']light["\']\] body \.pisi-calendar-icon-btn,[\s\S]*?\.pisi-calendar-today-btn \{[\s\S]*?background: var\(--pisi-theme-surface-alt, #eceef0\);[\s\S]*?color: var\(--pisi-theme-text, #20252c\);/
    );
    assert.doesNotMatch(fix, /!important\b/);
});
