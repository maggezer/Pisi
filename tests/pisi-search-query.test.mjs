import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { buildPisiSearchAccelerator } from '../renderer/search/pisi-search-core.mjs';
import {
    boundedPisiEditDistance,
    parsePisiSearchQuery,
    searchPisiAdvancedIndex
} from '../renderer/search/pisi-search-query.mjs';

function makeIndex(records) {
    return {
        records,
        accelerator: buildPisiSearchAccelerator(records),
        complete: true
    };
}

function makeRecord(id, kind, title, extra = {}) {
    return {
        id,
        kind,
        title,
        nodeTitle: extra.nodeTitle || title,
        mapTitle: extra.mapTitle || '',
        relativePath: extra.relativePath || `${title}.node`,
        status: extra.status,
        priority: extra.priority,
        tag: extra.tag,
        tags: extra.tags,
        nodePathKey: extra.nodePathKey,
        mapPathKey: extra.mapPathKey,
        memberships: extra.memberships || [],
        searchFields: extra.searchFields || [
            { kind: kind === 'task' ? 'task' : 'title', value: title }
        ]
    };
}

test('advanced query parser separates quoted terms and navigation filters', () => {
    const parsed = parsePisiSearchQuery(
        'type:task map:Makale status:todo priority:5 #review "final abstract"'
    );
    assert.deepEqual([...parsed.filters.kinds], ['task']);
    assert.deepEqual(parsed.filters.maps, ['makale']);
    assert.deepEqual(parsed.filters.statuses, ['todo']);
    assert.deepEqual(parsed.filters.priorities, [5]);
    assert.deepEqual(parsed.filters.tags, ['review']);
    assert.deepEqual(parsed.phrases, ['final abstract']);
    assert.equal(parsed.hasFilters, true);
    assert.equal(parsed.hasText, true);
});

test('filter-only queries return matching canonical task projection', () => {
    const index = makeIndex([
        makeRecord('task:a', 'task', 'Abstract düzelt', {
            mapTitle: 'Makale', status: 'todo', priority: 5, tag: 'todo.5.none',
            searchFields: [
                { kind: 'task', value: 'Abstract düzelt' },
                { kind: 'map', value: 'Makale' },
                { kind: 'tag', value: 'review todo.5.none' }
            ]
        }),
        makeRecord('task:b', 'task', 'Grafik düzelt', {
            mapTitle: 'Makale', status: 'done', priority: 5, tag: 'todo.5.none'
        }),
        makeRecord('node:a', 'node', 'Makale')
    ]);
    const results = searchPisiAdvancedIndex(
        index,
        'type:task map:Makale status:todo priority:5',
        { limit: 20 }
    );
    assert.deepEqual(results.map((item) => item.id), ['task:a']);
});

test('tag shorthand and kind chips intersect instead of broadening results', () => {
    const index = makeIndex([
        makeRecord('task:a', 'task', 'Review task', {
            tag: 'review', tags: ['review'],
            searchFields: [{ kind: 'tag', value: 'review' }]
        }),
        makeRecord('tag:a', 'tag', 'Review tag', {
            tag: 'review', tags: ['review'],
            searchFields: [{ kind: 'tag', value: 'review' }]
        })
    ]);
    const results = searchPisiAdvancedIndex(index, '#review', {
        kinds: new Set(['task'])
    });
    assert.deepEqual(results.map((item) => item.id), ['task:a']);
});

test('bounded fuzzy matching is used only when exact trigram candidates are absent', () => {
    assert.equal(boundedPisiEditDistance('goldbach', 'goldbch', 2), 1);
    const exactIndex = makeIndex([
        makeRecord('exact', 'node', 'Gldbach'),
        makeRecord('alternative', 'node', 'Goldbach')
    ]);
    const exactResults = searchPisiAdvancedIndex(exactIndex, 'gldbach');
    assert.deepEqual(exactResults.map((item) => item.id), ['exact']);
    assert.equal(exactResults[0].fuzzyMatch, false);

    const fuzzyIndex = makeIndex([
        makeRecord('fuzzy', 'node', 'Goldbach'),
        makeRecord('unrelated', 'node', 'Mekanik')
    ]);
    const fuzzyResults = searchPisiAdvancedIndex(fuzzyIndex, 'goldbch');
    assert.deepEqual(fuzzyResults.map((item) => item.id), ['fuzzy']);
    assert.equal(fuzzyResults[0].fuzzyMatch, true);
});

test('project-local recency and current map context improve quick-switch ranking', () => {
    const index = makeIndex([
        makeRecord('old', 'node', 'Alpha', { mapPathKey: 'map-a' }),
        makeRecord('recent', 'node', 'Beta', { mapPathKey: 'map-b' }),
        makeRecord('current-map', 'node', 'Gamma', { mapPathKey: 'map-current' })
    ]);
    const recentById = new Map([
        ['recent', { lastOpened: 10_000, openCount: 8 }]
    ]);
    const results = searchPisiAdvancedIndex(index, '', {
        recentById,
        currentMapPathKey: 'map-current',
        now: 10_500
    });
    assert.equal(results[0].id, 'recent');
    assert.ok(results.findIndex((item) => item.id === 'current-map') < results.findIndex((item) => item.id === 'old'));
});

test('property fields make node metadata searchable without creating a new authority record', () => {
    const index = makeIndex([
        makeRecord('node:sample', 'node', 'Numune', {
            searchFields: [
                { kind: 'title', value: 'Numune' },
                { kind: 'property', value: 'Material WNbMoV' }
            ]
        })
    ]);
    const results = searchPisiAdvancedIndex(index, 'wnbmov');
    assert.deepEqual(results.map((item) => item.id), ['node:sample']);
    assert.equal(results[0].matchedField, 'property');
});

test('10k-record exact quick search stays accelerated and below release guardrail', () => {
    const records = Array.from({ length: 10_000 }, (_value, index) => {
        const title = index === 8765 ? 'Benzersiz Refrakter Alaşım' : `Node ${index}`;
        return makeRecord(`node:${index}`, 'node', title, {
            searchFields: [
                { kind: 'title', value: title },
                { kind: 'content', value: `deney veri grubu ${index}` }
            ]
        });
    });
    const startBuild = performance.now();
    const index = makeIndex(records);
    const buildMs = performance.now() - startBuild;
    const durations = [];
    for (let iteration = 0; iteration < 25; iteration += 1) {
        const started = performance.now();
        const result = searchPisiAdvancedIndex(index, 'refrakter alaşım', { limit: 20 });
        durations.push(performance.now() - started);
        assert.equal(result[0]?.id, 'node:8765');
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)];
    assert.ok(buildMs < 1500, `10k accelerator build took ${buildMs.toFixed(1)}ms`);
    assert.ok(p95 < 500, `10k query p95 took ${p95.toFixed(1)}ms`);
});