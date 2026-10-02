'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('filesystem search updates prefer scoped node and map deltas over full project rebuilds', () => {
    const index = read('renderer/search/pisi-search-index.mjs');
    const service = read('renderer/search/pisi-search-filesystem-delta.mjs');
    const core = read('renderer/search/pisi-search-filesystem-delta-core.mjs');

    assert.match(index, /classifyPisiSearchChangedPaths/);
    assert.match(index, /createPisiSearchFilesystemDeltaController/);
    assert.match(index, /applyPisiSearchFilesystemDelta/);
    assert.match(service, /resolveNodeDelta/);
    assert.match(service, /applyMapDelta/);
    assert.match(service, /pisi:search-index-delta-applied/);
    assert.match(service, /mode: 'delta'/);
    assert.match(service, /filesystem-delta-fallback/);
    assert.match(core, /PISI_SEARCH_SCOPED_DELTA_MAX_PATHS\s*=\s*24/);
});

test('scoped delete is verified against the parent folder before projection removal', () => {
    const service = read('renderer/search/pisi-search-filesystem-delta.mjs');
    assert.match(service, /inspectPath/);
    assert.match(service, /listFolder/);
    assert.match(service, /if \(probe\.exists\)/);
    assert.match(service, /mode: 'remove'/);
    assert.match(service, /mode: 'ambiguous'/);
});

test('scoped search deltas remain disposable and never write canonical authorities', () => {
    const sources = [
        read('renderer/search/pisi-search-index.mjs'),
        read('renderer/search/pisi-search-filesystem-delta.mjs'),
        read('renderer/search/pisi-search-filesystem-delta-core.mjs')
    ];
    for (const source of sources) {
        assert.doesNotMatch(source, /\.pisi\/(?:tasks|relationships|properties)\.json/);
        assert.doesNotMatch(source, /writeFileAtomic|writeJson|writeText|saveNodeContent/);
    }
});

test('rename recovery can reuse stable node identity to preserve map membership', () => {
    const service = read('renderer/search/pisi-search-filesystem-delta.mjs');
    assert.match(service, /inferMemberships/);
    assert.match(service, /metadata\?\.id/);
    assert.match(service, /node\?\.id !== metadata\.id/);
});
