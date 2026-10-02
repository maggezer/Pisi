import test from 'node:test';
import assert from 'node:assert/strict';

import {
    computePisiSheetVirtualWindow,
    normalizePisiSheetPaginationConfig,
    paginatePisiSheetRecords
} from '../renderer/editor/pisi-editor-sheet-pagination-core.mjs';

test('pagination clamps page and slices records without changing source order', () => {
    const records = Array.from({ length: 10000 }, (_, index) => ({ id: index + 1 }));

    const page = paginatePisiSheetRecords(records, {
        page: 3,
        pageSize: 250,
        virtualScroll: {
            enabled: true
        }
    });

    assert.equal(page.page, 3);
    assert.equal(page.pageSize, 250);
    assert.equal(page.pageCount, 40);
    assert.equal(page.total, 10000);
    assert.equal(page.start, 500);
    assert.equal(page.end, 750);
    assert.equal(page.records.length, 250);
    assert.equal(page.records[0].id, 501);
    assert.equal(page.records.at(-1).id, 750);
    assert.equal(records[0].id, 1);
});

test('pagination normalizes unsafe page values and page sizes', () => {
    const normalized = normalizePisiSheetPaginationConfig({
        page: -10,
        pageSize: 50000,
        virtualScroll: {
            enabled: true,
            rowHeight: 2,
            overscan: 999
        }
    });

    assert.equal(normalized.page, 1);
    assert.equal(normalized.pageSize, 1000);
    assert.equal(normalized.virtualScroll.rowHeight, 24);
    assert.equal(normalized.virtualScroll.overscan, 40);
});

test('virtual window renders a bounded row window with spacer heights', () => {
    const window = computePisiSheetVirtualWindow({
        count: 250,
        scrollTop: 2800,
        viewportHeight: 560,
        rowHeight: 28,
        overscan: 8,
        enabled: true
    });

    assert.equal(window.virtualized, true);
    assert.ok(window.start > 0);
    assert.ok(window.end < 250);
    assert.ok(window.end - window.start < 50);
    assert.equal(window.topHeight, window.start * 28);
    assert.equal(window.bottomHeight, (250 - window.end) * 28);
});

test('forced virtual index keeps a selected off-DOM row in the render window', () => {
    const window = computePisiSheetVirtualWindow({
        count: 250,
        scrollTop: 0,
        viewportHeight: 420,
        rowHeight: 28,
        overscan: 8,
        enabled: true,
        forcedIndex: 220
    });

    assert.equal(window.virtualized, true);
    assert.ok(window.start <= 220);
    assert.ok(window.end > 220);
});

test('small pages skip virtual rendering', () => {
    const window = computePisiSheetVirtualWindow({
        count: 50,
        scrollTop: 0,
        viewportHeight: 420,
        enabled: true
    });

    assert.equal(window.virtualized, false);
    assert.equal(window.start, 0);
    assert.equal(window.end, 50);
    assert.equal(window.topHeight, 0);
    assert.equal(window.bottomHeight, 0);
});
