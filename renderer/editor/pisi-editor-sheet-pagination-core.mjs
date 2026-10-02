const PISI_SHEET_DEFAULT_PAGE_SIZE = 250;
const PISI_SHEET_MIN_PAGE_SIZE = 25;
const PISI_SHEET_MAX_PAGE_SIZE = 1000;
const PISI_SHEET_VIRTUAL_ROW_HEIGHT = 28;
const PISI_SHEET_VIRTUAL_OVERSCAN = 8;
const PISI_SHEET_VIRTUAL_THRESHOLD = 80;

function clampPisiSheetInteger(value, min, max, fallback) {
    const numeric = Math.trunc(Number(value));
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function normalizePisiSheetPaginationConfig(view = {}) {
    const pageSize = clampPisiSheetInteger(view.pageSize, PISI_SHEET_MIN_PAGE_SIZE, PISI_SHEET_MAX_PAGE_SIZE, PISI_SHEET_DEFAULT_PAGE_SIZE);
    const page = clampPisiSheetInteger(view.page, 1, Number.MAX_SAFE_INTEGER, 1);
    const rawVirtual = view.virtualScroll && typeof view.virtualScroll === 'object' ? view.virtualScroll : {};

    return {
        page,
        pageSize,
        virtualScroll: {
            enabled: rawVirtual.enabled !== false,
            rowHeight: clampPisiSheetInteger(rawVirtual.rowHeight, 24, 64, PISI_SHEET_VIRTUAL_ROW_HEIGHT),
            overscan: clampPisiSheetInteger(rawVirtual.overscan, 2, 40, PISI_SHEET_VIRTUAL_OVERSCAN)
        }
    };
}

function paginatePisiSheetRecords(records, config = {}) {
    const source = Array.isArray(records) ? records : [];
    const normalized = normalizePisiSheetPaginationConfig(config);
    const total = source.length;
    const pageCount = Math.max(1, Math.ceil(total / normalized.pageSize));
    const page = Math.max(1, Math.min(normalized.page, pageCount));
    const start = (page - 1) * normalized.pageSize;
    const end = Math.min(total, start + normalized.pageSize);

    return {
        ...normalized,
        page,
        pageCount,
        total,
        start,
        end,
        records: source.slice(start, end)
    };
}

function computePisiSheetVirtualWindow(options = {}) {
    const count = Math.max(0, Math.trunc(Number(options.count) || 0));
    const rowHeight = clampPisiSheetInteger(options.rowHeight, 24, 64, PISI_SHEET_VIRTUAL_ROW_HEIGHT);
    const overscan = clampPisiSheetInteger(options.overscan, 2, 40, PISI_SHEET_VIRTUAL_OVERSCAN);
    const enabled = options.enabled !== false && count > PISI_SHEET_VIRTUAL_THRESHOLD;

    if (!enabled) {
        return {
            virtualized: false,
            start: 0,
            end: count,
            topHeight: 0,
            bottomHeight: 0,
            rowHeight,
            overscan
        };
    }

    const viewportHeight = Math.max(rowHeight * 12, Number(options.viewportHeight) || 0);
    const visibleCount = Math.max(12, Math.ceil(viewportHeight / rowHeight));
    const forcedIndex = Number.isInteger(options.forcedIndex) ? Math.max(0, Math.min(count - 1, options.forcedIndex)) : null;

    let start;

    if (forcedIndex !== null) {
        start = Math.max(0, forcedIndex - Math.floor(visibleCount / 2) - overscan);
    } else {
        start = Math.max(0, Math.floor(Math.max(0, Number(options.scrollTop) || 0) / rowHeight) - overscan);
    }

    let end = Math.min(count, start + visibleCount + overscan * 2);

    if (forcedIndex !== null && forcedIndex >= end) {
        end = Math.min(count, forcedIndex + overscan + 1);
        start = Math.max(0, end - visibleCount - overscan * 2);
    }

    return {
        virtualized: true,
        start,
        end,
        topHeight: start * rowHeight,
        bottomHeight: Math.max(0, count - end) * rowHeight,
        rowHeight,
        overscan
    };
}

export {
    PISI_SHEET_DEFAULT_PAGE_SIZE,
    PISI_SHEET_MAX_PAGE_SIZE,
    PISI_SHEET_MIN_PAGE_SIZE,
    PISI_SHEET_VIRTUAL_OVERSCAN,
    PISI_SHEET_VIRTUAL_ROW_HEIGHT,
    PISI_SHEET_VIRTUAL_THRESHOLD,
    computePisiSheetVirtualWindow,
    normalizePisiSheetPaginationConfig,
    paginatePisiSheetRecords
};
