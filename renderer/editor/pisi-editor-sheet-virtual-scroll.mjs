import {
    computePisiSheetVirtualWindow,
    normalizePisiSheetPaginationConfig,
    paginatePisiSheetRecords
} from "./pisi-editor-sheet-pagination-core.mjs";
import {
    getPisiSheetViewRecords
} from "./pisi-editor-sheet-view-query.mjs";
import {
    ensurePisiSheetSearchControl
} from "./pisi-editor-sheet-search-ui.mjs";

const pisiSheetVirtualStates = new WeakMap();
const PISI_SHEET_PAGE_SIZE_OPTIONS = Object.freeze([
    50,
    100,
    250,
    500,
    1000
]);

function getPisiSheetVirtualState(table) {
    let state = pisiSheetVirtualStates.get(table);

    if (!state) {
        state = {
            page: null,
            start: 0,
            end: 0,
            forcedIndex: null,
            frame: 0,
            boundBlock: null
        };
        pisiSheetVirtualStates.set(table, state);
    }

    return state;
}

function getPisiSheetBlock(table) {
    return table?.closest?.(
        '.pisi-sheet-block'
    ) || null;
}

function getPisiSheetVirtualRenderState(table) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;
    const allRecords = getPisiSheetViewRecords(table);
    const normalized =
        normalizePisiSheetPaginationConfig(view || {});
    const pageInfo = paginatePisiSheetRecords(
        allRecords,
        normalized
    );
    const state = getPisiSheetVirtualState(table);
    const block = getPisiSheetBlock(table);
    const hasVariableRows = Boolean(
        database?.fields?.some(
            (field) => field.wrap === true
        )
    );
    const pageChanged =
        state.page !== pageInfo.page;
    const viewportHeight = block?.clientHeight || 448;
    const scrollTop = pageChanged
        ? 0
        : Math.max(
            0,
            (block?.scrollTop || 0) - 24
        );
    const windowInfo =
        computePisiSheetVirtualWindow({
            count: pageInfo.records.length,
            scrollTop,
            viewportHeight,
            rowHeight:
                pageInfo.virtualScroll.rowHeight,
            overscan:
                pageInfo.virtualScroll.overscan,
            enabled:
                pageInfo.virtualScroll.enabled &&
                !hasVariableRows,
            forcedIndex: state.forcedIndex
        });

    if (view) {
        view.page = pageInfo.page;
        view.pageSize = pageInfo.pageSize;
        view.virtualScroll =
            pageInfo.virtualScroll;
    }

    return {
        ...pageInfo,
        ...windowInfo,
        pageRecords: pageInfo.records,
        records: pageInfo.records.slice(
            windowInfo.start,
            windowInfo.end
        ),
        viewStart:
            pageInfo.start + windowInfo.start,
        pageChanged,
        forcedIndex: state.forcedIndex
    };
}

function ensurePisiSheetPaginationControls(
    table,
    info
) {
    const block = getPisiSheetBlock(table);
    if (!block) return null;

    let controls = Array.from(
        block.children
    ).find((child) => (
        child.classList?.contains(
            'pisi-sheet-pagination'
        )
    ));

    if (!controls) {
        controls = document.createElement('div');
        controls.className =
            'pisi-sheet-pagination';
        controls.setAttribute(
            'contenteditable',
            'false'
        );

        const previous =
            document.createElement('button');
        const status =
            document.createElement('span');
        const next =
            document.createElement('button');
        const pageSize =
            document.createElement('select');

        previous.type = 'button';
        previous.dataset.pisiSheetPagePrevious = '1';
        previous.textContent = '‹';
        previous.setAttribute(
            'aria-label',
            window.pisiT?.('Önceki sayfa') ||
                'Önceki sayfa'
        );

        status.className =
            'pisi-sheet-pagination-status';
        status.dataset.pisiSheetPageStatus = '1';

        next.type = 'button';
        next.dataset.pisiSheetPageNext = '1';
        next.textContent = '›';
        next.setAttribute(
            'aria-label',
            window.pisiT?.('Sonraki sayfa') ||
                'Sonraki sayfa'
        );

        pageSize.dataset.pisiSheetPageSize = '1';
        pageSize.setAttribute(
            'aria-label',
            window.pisiT?.('Sayfa boyutu') ||
                'Sayfa boyutu'
        );

        controls.append(
            previous,
            status,
            next,
            pageSize
        );
        block.appendChild(controls);

        previous.addEventListener('click', () => {
            const current =
                getPisiSheetVirtualRenderState(
                    table
                );
            setPisiSheetViewPage(
                table,
                current.page - 1
            );
        });

        next.addEventListener('click', () => {
            const current =
                getPisiSheetVirtualRenderState(
                    table
                );
            setPisiSheetViewPage(
                table,
                current.page + 1
            );
        });

        pageSize.addEventListener('change', () => {
            setPisiSheetViewPageSize(
                table,
                Number(pageSize.value)
            );
        });
    }

    const previous = controls.querySelector(
        '[data-pisi-sheet-page-previous]'
    );
    const next = controls.querySelector(
        '[data-pisi-sheet-page-next]'
    );
    const status = controls.querySelector(
        '[data-pisi-sheet-page-status]'
    );
    const pageSize = controls.querySelector(
        '[data-pisi-sheet-page-size]'
    );

    if (previous) {
        previous.disabled = info.page <= 1;
    }

    if (next) {
        next.disabled =
            info.page >= info.pageCount;
    }

    if (status) {
        const first = info.total
            ? info.start + 1
            : 0;
        const last = info.end;

        status.textContent =
            first + '–' + last +
            ' / ' + info.total +
            ' · ' +
            (window.pisiT?.('Sayfa') || 'Sayfa') +
            ' ' + info.page +
            '/' + info.pageCount;
    }

    if (pageSize) {
        const options = new Set(
            PISI_SHEET_PAGE_SIZE_OPTIONS
        );
        options.add(info.pageSize);

        pageSize.replaceChildren(
            ...[...options]
                .sort((a, b) => a - b)
                .map((value) => {
                    const option =
                        document.createElement('option');
                    option.value = String(value);
                    option.textContent =
                        String(value) +
                        ' ' +
                        (
                            window.pisiT?.('satır/sayfa') ||
                            'satır/sayfa'
                        );
                    return option;
                })
        );
        pageSize.value = String(info.pageSize);
    }

    controls.hidden =
        info.total <= 50 &&
        info.pageCount === 1;

    return controls;
}

function refreshPisiSheetVirtualView(
    table,
    options = {}
) {
    if (!table) return null;

    if (
        typeof isPisiSheetEditingCell === 'function' &&
        isPisiSheetEditingCell(table)
    ) {
        finishPisiSheetCellEdit(table, {
            commit: true,
            refocus: false
        });
    }

    renderPisiSheetDatabase(table, {
        persist: options.persist !== false,
        preserveScroll:
            options.preserveScroll === true
    });
    recalcPisiSheet(table);
    reconcilePisiSheetSelection(table);

    if (options.notify !== false) {
        schedulePisiSheetEditorNotification(table);
    }

    return table;
}

function bindPisiSheetVirtualScroll(table) {
    const block = getPisiSheetBlock(table);
    const state = getPisiSheetVirtualState(table);

    if (!block || state.boundBlock === block) {
        return;
    }

    state.boundBlock = block;

    block.addEventListener('scroll', () => {
        if (state.frame) return;

        state.frame = requestAnimationFrame(() => {
            state.frame = 0;

            if (
                typeof isPisiSheetEditingCell === 'function' &&
                isPisiSheetEditingCell(table)
            ) {
                return;
            }

            const info =
                getPisiSheetVirtualRenderState(
                    table
                );

            if (
                !info.virtualized ||
                (
                    info.start === state.start &&
                    info.end === state.end &&
                    info.page === state.page
                )
            ) {
                return;
            }

            renderPisiSheetDatabase(table, {
                persist: false,
                preserveScroll: true
            });
            recalcPisiSheet(table);
            reconcilePisiSheetSelection(table);
        });
    });
}

function finalizePisiSheetVirtualRender(
    table,
    info
) {
    const block = getPisiSheetBlock(table);
    const state = getPisiSheetVirtualState(table);

    if (!block) return;

    const forcedIndex = state.forcedIndex;

    block.classList.toggle(
        'pisi-sheet-virtualized',
        info.virtualized
    );

    state.page = info.page;
    state.start = info.start;
    state.end = info.end;
    state.forcedIndex = null;

    bindPisiSheetVirtualScroll(table);
    ensurePisiSheetSearchControl(
        table,
        info
    );
    ensurePisiSheetPaginationControls(
        table,
        info
    );

    if (
        info.pageChanged &&
        forcedIndex === null
    ) {
        block.scrollTop = 0;
    }

    if (
        info.virtualized &&
        forcedIndex !== null
    ) {
        block.scrollTop = Math.max(
            0,
            forcedIndex * info.rowHeight -
            info.rowHeight * 5
        );
    }
}

function setPisiSheetViewPage(
    table,
    page
) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;

    if (!view) return false;

    view.page = Math.max(
        1,
        Math.trunc(Number(page) || 1)
    );

    persistPisiSheetDatabase(table);
    refreshPisiSheetVirtualView(table, {
        notify: true
    });
    return true;
}

function setPisiSheetViewPageSize(
    table,
    pageSize
) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;

    if (!view) return false;

    const normalized =
        normalizePisiSheetPaginationConfig({
            ...view,
            page: 1,
            pageSize
        });

    view.page = 1;
    view.pageSize = normalized.pageSize;
    view.virtualScroll =
        normalized.virtualScroll;

    persistPisiSheetDatabase(table);
    refreshPisiSheetVirtualView(table, {
        notify: true
    });
    return true;
}

function resetPisiSheetVirtualScroll(table) {
    const state = getPisiSheetVirtualState(table);
    const block = getPisiSheetBlock(table);

    state.page = null;
    state.start = 0;
    state.end = 0;
    state.forcedIndex = null;

    if (block) {
        block.scrollTop = 0;
    }
}

function ensurePisiSheetPointRendered(
    table,
    point
) {
    if (!table || !point) return null;

    const existing = table.querySelector(
        'tbody tr[data-pisi-row-id="' +
        point.rowId +
        '"] td[data-pisi-col-id="' +
        point.colId +
        '"]'
    );

    if (existing) return existing;

    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;
    const records = getPisiSheetViewRecords(table);

    if (!database || !view) return null;

    const recordIndex = records.findIndex(
        (record) => (
            record.item.id === point.rowId
        )
    );

    if (recordIndex < 0) return null;

    const normalized =
        normalizePisiSheetPaginationConfig(view);
    const targetPage =
        Math.floor(
            recordIndex / normalized.pageSize
        ) + 1;
    const pageOffset =
        recordIndex % normalized.pageSize;
    const state = getPisiSheetVirtualState(table);

    view.page = targetPage;
    view.pageSize = normalized.pageSize;
    view.virtualScroll =
        normalized.virtualScroll;
    state.forcedIndex = pageOffset;

    renderPisiSheetDatabase(table, {
        persist: true,
        preserveScroll: false
    });
    recalcPisiSheet(table);
    reconcilePisiSheetSelection(table);

    return table.querySelector(
        'tbody tr[data-pisi-row-id="' +
        point.rowId +
        '"] td[data-pisi-col-id="' +
        point.colId +
        '"]'
    );
}

function ensurePisiSheetModelCellRendered(
    table,
    row,
    col
) {
    const point = getPisiSheetPointByIndex(
        table,
        row,
        col
    );

    return point
        ? ensurePisiSheetPointRendered(
            table,
            point
        )
        : null;
}

export {
    ensurePisiSheetModelCellRendered,
    ensurePisiSheetPointRendered,
    finalizePisiSheetVirtualRender,
    getPisiSheetVirtualRenderState,
    refreshPisiSheetVirtualView,
    resetPisiSheetVirtualScroll,
    setPisiSheetViewPage,
    setPisiSheetViewPageSize
};
