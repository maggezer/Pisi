'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const tutorial = read('renderer/shell/pisi-tutorial.mjs');
const bootstrap = read('renderer/bootstrap.mjs');
const styleRoot = read('style.css');
const css = read('styles/110-tutorial.css');

test('tutorial is loaded and registered as an application-level Workspace Center page', () => {
    assert.match(bootstrap, /\.\/shell\/pisi-tutorial\.mjs/);
    assert.match(tutorial, /registerModule\('shell\.tutorial'/);
    assert.match(tutorial, /id:\s*'tutorial'/);
    assert.match(tutorial, /requiresProject:\s*false/);
    assert.match(tutorial, /registerPisiCommandCenterPage/);
});

test('tutorial is first-run once and can be replayed without mutating project data', () => {
    assert.match(tutorial, /pisi\.tutorial\.v1\.completed/);
    assert.match(tutorial, /localStorage\.setItem\(PISI_TUTORIAL_COMPLETED_KEY, '1'\)/);
    assert.match(tutorial, /window\.currentProjectFolder/);
    assert.match(tutorial, /startPisiTutorial/);
    assert.doesNotMatch(tutorial, /pisiProject\?\.(?:save|create|delete|rename|upsert)/);
});

test('tutorial covers the primary Pisi work areas and provides keyboard exit/navigation', () => {
    for (const selector of [
        '#left-panel',
        '#project-actions',
        '#workspace',
        'data-right-tab=\\"missions\\"',
        'data-right-tab=\\"mindmap\\"',
        '#pisi-command-center-button'
    ]) {
        assert.match(tutorial, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(tutorial, /event\.key === 'Escape'/);
    assert.match(tutorial, /event\.key === 'ArrowRight'/);
    assert.match(tutorial, /event\.key === 'ArrowLeft'/);
});

test('tutorial spotlight and cards support both themes', () => {
    assert.match(styleRoot, /110-tutorial\.css/);
    assert.match(css, /\.pisi-tutorial-spotlight\s*\{/);
    assert.match(css, /box-shadow:\s*0 0 0 9999px/);
    assert.match(css, /html\[data-pisi-theme="light"\] body \.pisi-tutorial-card/);
    assert.match(css, /\.pisi-tutorial-page-start/);
});
