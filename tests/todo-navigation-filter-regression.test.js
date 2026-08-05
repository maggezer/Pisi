'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Todo source navigation targets the active node and never persists highlight classes', () => {
    const source = read('renderer/tags/pisi-todo-navigation.mjs');

    assert.match(source, /samePisiPathForTags\(activeModalNode\?\.path, mission\?\.nodePath\)/);
    assert.match(source, /samePisiPathForTags\(activeCenterNode\?\.path, mission\?\.nodePath\)/);
    assert.match(source, /idMatches\.find[\s\S]*pisiMissionBlockContainsTodo/);
    assert.match(source, /todoBlocks\.length === 1 \? todoBlocks\[0\] : null/);
    assert.match(source, /target\.animate\(/);
    assert.match(source, /clearPisiMissionHighlightArtifacts\(editor\)/);
    assert.match(source, /new MutationObserver/);
    assert.match(read('renderer/bootstrap.mjs'), /pisi-todo-navigation\.mjs/);
    assert.doesNotMatch(source, /block\.classList\.add\('pisi-block-highlight'\)/);
    assert.doesNotMatch(source, /setTimeout\(\(\) => \{\s*highlightPisiEditorBlock/);
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
