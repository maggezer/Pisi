'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('search projection is explicitly rebuildable and driver-backed without becoming authority', () => {
    const core = read('renderer/search/pisi-projection-index-core.mjs');
    const adapter = read('renderer/search/pisi-search-index-adapter.mjs');
    const enhanced = read('renderer/search/pisi-search-enhanced-index.mjs');

    assert.match(core, /PISI_PROJECTION_INDEX_CONTRACT_VERSION\s*=\s*1/);
    assert.match(core, /replaceAll/);
    assert.match(core, /applyDelta/);
    assert.match(core, /invalidate/);
    assert.match(adapter, /memory-trigram-v1/);
    assert.match(enhanced, /createPisiRebuildableSearchIndex/);
    assert.match(enhanced, /applyPisiCanonicalTaskSearchDelta/);

    for (const source of [core, adapter, enhanced]) {
        assert.doesNotMatch(source, /\.pisi\/(?:tasks|relationships|properties)\.json/);
        assert.doesNotMatch(source, /writeFileAtomic|writeJson|writeText/);
    }
});

test('future persistent index backends are isolated behind the adapter contract', () => {
    const adapter = read('renderer/search/pisi-search-index-adapter.mjs');
    const query = read('renderer/search/pisi-search-query.mjs');
    const globalSearch = read('renderer/search/pisi-global-search.mjs');

    assert.match(adapter, /createPisiSearchMemoryIndexDriver/);
    assert.match(adapter, /createPisiRebuildableProjectionIndex/);
    assert.doesNotMatch(query, /memory-trigram-v1|sqlite|fts/i);
    assert.doesNotMatch(globalSearch, /memory-trigram-v1|sqlite|fts/i);
});

test('canonical task updates use the delta gateway while base invalidation requires a rebuild', () => {
    const core = read('renderer/search/pisi-projection-index-core.mjs');
    const enhanced = read('renderer/search/pisi-search-enhanced-index.mjs');
    assert.match(enhanced, /pisi:task-store-updated[\s\S]*applyPisiCanonicalTaskSearchDelta/);
    assert.match(enhanced, /pisi:search-index-invalidated[\s\S]*invalidatePisiEnhancedSearchProjection/);
    assert.match(enhanced, /task-delta-rebuild-required/);
    assert.match(core, /requiresRebuild:\s*true/);
});
