'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Todo source navigation targets the active node and never persists highlight classes', () => {
    const source = read('renderer/tags/pisi-todo-navigation.mjs');

    assert.ok(source.includes('samePisiPathForTags(activeModalNode?.path, mission?.nodePath)'));
    assert.ok(source.includes('samePisiPathForTags(activeCenterNode?.path, mission?.nodePath)'));
    assert.ok(source.includes('getPisiTaskNavigationTaskId'));
    assert.ok(source.includes('selectPisiTaskNavigationCandidate'));
    assert.ok(source.includes("scope: 'direct'"));
    assert.ok(source.includes("scope: 'recovery'"));
    assert.ok(source.includes('getPisiMissionSourceInBlock(selected.block, mission)'));
    assert.ok(source.includes('target.animate('));
    assert.ok(source.includes('clearPisiMissionHighlightArtifacts(editor)'));
    assert.ok(source.includes('new MutationObserver'));
    assert.ok(read('renderer/bootstrap.mjs').includes('pisi-todo-navigation.mjs'));
    assert.equal(source.includes("block.classList.add('pisi-block-highlight')"), false);
});

test('Todo date filters render inside one dropdown trigger', () => {
    const source = read('renderer/tags/pisi-todo-first-release.mjs');
    const css = read('styles/50-tags-and-missions.css');

    assert.match(source, /pisi-missions-filter-trigger/);
    assert.match(source, /pisi-missions-filter-popover/);
    assert.match(source, /role', 'menuitemradio'/);
    assert.match(source, /for \(const option of PISI_TODO_FILTER_OPTIONS\)/);
    assert.match(source, /event\.key !== 'Escape'/);
    assert.doesNotMatch(source, /className = 'pisi-missions-filter';/);
    assert.match(css, /\.pisi-missions-filter-popover \{/);
    assert.match(css, /\.pisi-missions-filter-option \{/);
    assert.doesNotMatch(css, /\.pisi-missions-filter-bar \{/);
});
