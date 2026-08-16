'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('filesystem search updates prefer scoped node and map deltas over full project rebuilds', () => {
    const source = read('renderer/search/pisi-search-index.mjs');
    const core = read('renderer/search/pisi-search-filesystem-delta-core.mjs');

    assert.match(source, /classifyPisiSearchChangedPaths/);
    assert.match(source, /applyPisiSearchFilesystemDelta/);
    assert.match(source, /resolvePisiSearchNodeDelta/);
    assert.match(source, /applyPisiSearchMapDelta/);
    assert.match(source, /pisi:search-index-delta-applied/);
    assert.match(source, /mode: 'delta'/);
    assert.match(source, /filesystem-delta-fallback/);
    assert.match(core, /PISI_SEARCH_SCOPED_DELTA_MAX_PATHS\s*=\s*24/);
});

test('scoped delete is verified against the parent folder before projection removal', () => {
    const source = read('renderer/search/pisi-search-index.mjs');
    assert.match(source, /inspectPisiSearchPath/);
    assert.match(source, /listFolder/);
    assert.match(source, /if \(probe\.exists\)/);
    assert.match(source, /mode: 'remove'/);
    assert.match(source, /mode: 'ambiguous'/);
});

test('scoped search deltas remain disposable and never write canonical authorities', () => {
    const sources = [
        read('renderer/search/pisi-search-index.mjs'),
        read('renderer/search/pisi-search-filesystem-delta-core.mjs')
    ];
    for (const source of sources) {
        assert.doesNotMatch(source, /\.pisi\/(?:tasks|relationships|properties)\.json/);
        assert.doesNotMatch(source, /writeFileAtomic|writeJson|writeText|saveNodeContent/);
    }
});

test('rename recovery can reuse stable node identity to preserve map membership', () => {
    const source = read('renderer/search/pisi-search-index.mjs');
    assert.match(source, /inferPisiSearchMemberships/);
    assert.match(source, /metadata\?\.id/);
    assert.match(source, /node\?\.id !== metadata\.id/);
});