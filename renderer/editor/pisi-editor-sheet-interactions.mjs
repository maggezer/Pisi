import { registerModule } from '../core/module-registry.mjs';

const pisiSheetNotifyTimers = new WeakMap();

let pisiSheetDragSelection = null;
let pisiSheetContextMenu = null;
function closePisiSheetContextMenu() {
    if (!pisiSheetContextMenu) return;
    pisiSheetContextMenu.remove();
    pisiSheetContextMenu = null;
}

function getPisiSheetContextToolbar(table) {
    const editor = getEditorForPisiElement(table);
    if (!editor) return null;

    return document.querySelector('.pisi-editor-toolbar[data-editor-target="' + editor.id + '"]');
}

function runPisiSheetContextAction(table, action) {
    const toolbar = getPisiSheetContextToolbar(table);

    if (toolbar) {
        runPisiExcelAction(toolbar, action);
        return;
    }

    let changed = false;

    if (action === 'addRow') {
        changed = addPisiSheetRow(table);
    } else if (action === 'deleteRow') {
        changed = deletePisiSheetRows(table);
    } else if (action === 'addCol') {
        changed = addPisiSheetColumn(table);
    } else if (action === 'deleteCol') {
        changed = deletePisiSheetColumns(table);
    }

    if (changed) {
        syncPisiSheetToolbarForTable(table);
        schedulePisiSheetEditorNotification(table);
    }
}

function openPisiSheetContextMenu(table, clientX, clientY) {
    closePisiSheetColumnMenu();
    closePisiSheetContextMenu();

    const dimensions = getPisiSheetDimensions(table);
    const actions = [
        {
            action: 'addRow',
            label: window.pisiT?.('Satır ekle') || 'Satır ekle',
            disabled: dimensions.rows >= PISI_SHEET_MAX_ROWS
        },
        {
            action: 'deleteRow',
            label: window.pisiT?.('Satır sil') || 'Satır sil',
            disabled: dimensions.rows <= 1
        },
        {
            action: 'addCol',
            label: window.pisiT?.('Sütun ekle') || 'Sütun ekle',
            disabled: dimensions.cols >= PISI_SHEET_MAX_COLS
        },
        {
            action: 'deleteCol',
            label: window.pisiT?.('Sütun sil') || 'Sütun sil',
            disabled: dimensions.cols <= 1
        }
    ];
    const menu = document.createElement('div');

    menu.className = 'pisi-sheet-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', window.pisiT?.('Tablo satır ve sütun işlemleri') || 'Tablo satır ve sütun işlemleri');

    actions.forEach(({ action, label, disabled }) => {
        const button = document.createElement('button');

        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.setAttribute('data-pisi-sheet-context-action', action);
        button.textContent = label;
        button.disabled = disabled;

        button.addEventListener('click', () => {
            closePisiSheetContextMenu();
            runPisiSheetContextAction(table, action);
        });

        menu.appendChild(button);
    });

    document.body.appendChild(menu);
    pisiSheetContextMenu = menu;

    const margin = 8;
    const rect = menu.getBoundingClientRect();

    menu.style.left = String(Math.max(margin, Math.min(clientX, window.innerWidth - rect.width - margin))) + 'px';
    menu.style.top = String(Math.max(margin, Math.min(clientY, window.innerHeight - rect.height - margin))) + 'px';
}

document.addEventListener(
    'pointerdown',
    (event) => {
        if (pisiSheetContextMenu && !pisiSheetContextMenu.contains(event.target)) {
            closePisiSheetContextMenu();
        }
    },
    true
);

document.addEventListener(
    'keydown',
    (event) => {
        if (event.key === 'Escape') {
            closePisiSheetContextMenu();
        }
    },
    true
);

document.addEventListener(
    'scroll',
    () => {
        closePisiSheetContextMenu();
        closePisiSheetColumnMenu();
    },
    true
);

window.addEventListener('blur', () => {
    closePisiSheetContextMenu();
    closePisiSheetColumnMenu();
});

document.addEventListener(
    'mouseup',
    () => {
        finishPisiSheetFormulaReferencePick();

        if (pisiSheetDragSelection?.table) {
            pisiSheetDragSelection.table.classList.remove('pisi-sheet-drag-selecting');
        }

        pisiSheetDragSelection = null;
    },
    true
);

function cleanupPisiSheetTransientChrome(table) {
    const block = table?.closest?.('.pisi-sheet-block');

    if (!block) return false;

    const specs = [
        {
            className: 'pisi-sheet-section-header',
            selectors: [
                '[data-pisi-sheet-section-toggle]',
                '[data-pisi-sheet-section-title]',
                '[data-pisi-composite-copy]',
                '[data-pisi-composite-new-line]',
                '[data-pisi-sheet-section-delete]'
            ]
        },
        {
            className: 'pisi-sheet-search',
            selectors: ['[data-pisi-sheet-search-input]', '[data-pisi-sheet-search-status]', '[data-pisi-sheet-search-clear]']
        },
        {
            className: 'pisi-sheet-pagination',
            selectors: ['[data-pisi-sheet-page-previous]', '[data-pisi-sheet-page-next]', '[data-pisi-sheet-page-status]', '[data-pisi-sheet-page-size]']
        }
    ];
    let changed = false;

    for (const spec of specs) {
        const candidates = Array.from(block.children).filter((child) => child.classList?.contains(spec.className));
        const valid = candidates.find((candidate) => spec.selectors.every((selector) => candidate.querySelector(selector))) || null;

        for (const candidate of candidates) {
            if (candidate !== valid) {
                candidate.remove();
                changed = true;
            }
        }
    }

    return changed;
}

function hydratePisiSheets(root = document) {
    root.querySelectorAll('table[data-pisi-sheet]').forEach((table) => {
        table.removeAttribute('data-pisi-sheet-bound');

        cleanupPisiSheetTransientChrome(table);

        if (pisiBoundSheets.has(table)) {
            return;
        }

        if (!hydratePisiSheetDatabase(table)) return;
        renderPisiSheetDatabase(table);
        recalcPisiSheet(table);
        reconcilePisiSheetSelection(table);
        bindPisiSheetColumnReorder(table);
        pisiBoundSheets.add(table);

        table.addEventListener('focusin', (event) => {
            const cell = event.target.closest('td[data-cell]');

            if (!cell || !table.contains(cell)) return;
            if (isPisiSheetEditingCell(table, cell)) return;

            if (!isPisiSheetCellSelected(table, cell)) {
                selectPisiSheetCell(cell);
            } else {
                syncPisiSheetSelectionProjection(table);
            }
        });

        table.addEventListener('click', (/** @type {MouseEvent} */ event) => {
            const checkbox = event.target.closest('[data-pisi-sheet-checkbox]');
            const checkboxCell = checkbox?.closest('td[data-cell]');

            if (checkbox && checkboxCell && table.contains(checkboxCell)) {
                event.preventDefault();
                event.stopPropagation();
                togglePisiSheetCheckboxCell(checkboxCell);
                return;
            }

            const header = event.target.closest('thead th[data-col-header]');
            const resizer = event.target.closest('[data-pisi-sheet-col-resizer]');

            if (header && table.contains(header) && !resizer) {
                event.preventDefault();
                event.stopPropagation();
                openPisiSheetColumnMenu(table, header);
            }
        });

        table.addEventListener('dblclick', (/** @type {MouseEvent} */ event) => {
            const resizer = event.target.closest('[data-pisi-sheet-col-resizer]');

            if (resizer && table.contains(resizer)) {
                const colIndex = Number(resizer.dataset.pisiSheetColResizer);

                if (Number.isInteger(colIndex)) {
                    event.preventDefault();
                    event.stopPropagation();
                    autoFitPisiSheetColumn(table, colIndex);
                }
                return;
            }

            const cell = event.target.closest('td[data-cell]');

            if (!cell || !table.contains(cell)) return;

            if (isPisiSheetFormulaInputActive(table)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            if (!beginPisiSheetTypedCellEdit(cell)) {
                beginPisiSheetCellEdit(cell);
            }
        });

        table.addEventListener('contextmenu', (/** @type {MouseEvent} */ event) => {
            const rowHeader = event.target.closest('tbody th[data-row-header]');
            const colHeader = event.target.closest('thead th[data-col-header]');
            const cell = event.target.closest('td[data-cell]');

            if ((!rowHeader && !colHeader && !cell) || !(event.target instanceof Node) || !table.contains(event.target)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            finishPisiSheetCellEdit(table, {
                commit: true,
                refocus: false
            });

            if (rowHeader) {
                selectPisiSheetRow(table, Number(rowHeader.dataset.rowHeader), false);
            } else if (colHeader) {
                selectPisiSheetColumn(table, Number(colHeader.dataset.colHeader), false);
            } else if (cell && !isPisiSheetCellSelected(table, cell)) {
                selectPisiSheetCell(cell);
            }

            openPisiSheetContextMenu(table, event.clientX, event.clientY);
        });

        table.addEventListener('mousedown', (/** @type {MouseEvent} */ event) => {
            const resizer = event.target.closest('[data-pisi-sheet-col-resizer]');

            if (resizer && table.contains(resizer)) {
                if (event.button !== 0) return;

                event.preventDefault();
                event.stopPropagation();
                closePisiSheetColumnMenu();
                closePisiSheetContextMenu();
                startPisiSheetColumnResize(table, resizer, event);
                return;
            }

            const colHeader = event.target.closest('thead th[data-col-header]');

            if (colHeader && table.contains(colHeader)) {
                if (event.button === 0) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }

            const rowHeader = event.target.closest('tbody th[data-row-header]');
            const cornerHeader = event.target.closest('thead th[data-pisi-sheet-corner]');
            const cell = event.target.closest('td[data-cell]');

            if (cornerHeader && table.contains(cornerHeader)) {
                event.preventDefault();
                finishPisiSheetCellEdit(table, {
                    commit: true,
                    refocus: false
                });
                selectAllPisiSheetCells(table);
                return;
            }

            if (rowHeader && table.contains(rowHeader)) {
                event.preventDefault();
                finishPisiSheetCellEdit(table, {
                    commit: true,
                    refocus: false
                });
                selectPisiSheetRow(table, Number(rowHeader.dataset.rowHeader), event.shiftKey);
                return;
            }

            if (!cell || !table.contains(cell) || event.button !== 0) {
                return;
            }

            if (beginPisiSheetFormulaReferencePick(table, cell, event)) {
                pisiSheetDragSelection = null;
                return;
            }

            if (isPisiSheetEditingCell(table, cell)) {
                return;
            }

            finishPisiSheetCellEdit(table, {
                commit: true,
                refocus: false
            });
            closePisiSheetColumnMenu();
            closePisiSheetContextMenu();

            event.preventDefault();

            selectPisiSheetCell(cell, {
                extend: event.shiftKey,
                focus: false
            });

            const selection = getPisiSheetSelection(table);

            if (selection) {
                pisiSheetDragSelection = {
                    table,
                    anchor: { ...selection.anchor },
                    last: { ...selection.focus }
                };
            }
        });

        table.addEventListener('mouseover', (/** @type {MouseEvent} */ event) => {
            if (!(event.buttons & 1)) return;

            const cell = event.target.closest('td[data-cell]');

            if (!cell || !table.contains(cell)) return;

            if (updatePisiSheetFormulaReferencePick(table, cell, event)) {
                return;
            }

            const drag = pisiSheetDragSelection;

            if (!drag || drag.table !== table) return;

            const point = getPisiSheetCellPosition(cell);

            if (!point) return;
            if (drag.last.rowId === point.rowId && drag.last.colId === point.colId) {
                return;
            }

            event.preventDefault();
            drag.last = point;
            table.classList.add('pisi-sheet-drag-selecting');

            setPisiSheetRangeSelection(table, drag.anchor, point, {
                mode: 'range',
                active: point,
                ensureVisible: true
            });
        });

        table.addEventListener('keydown', (event) => {
            const cell = event.target.closest('td[data-cell]');

            if (!cell || !table.contains(cell) || !isPisiSheetEditingCell(table, cell)) {
                return;
            }

            if (
                ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) &&
                movePisiSheetFormulaReferenceByKeyboard(table, event.key, { extend: event.shiftKey })
            ) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                finishPisiSheetCellEdit(table, {
                    commit: false,
                    refocus: true
                });
                return;
            }

            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                finishPisiSheetCellEdit(table, {
                    commit: true,
                    refocus: false
                });
                movePisiSheetCellFocus(table, cell, event.shiftKey ? -1 : 1, 0);
                return;
            }

            if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                event.stopPropagation();
                finishPisiSheetCellEdit(table, {
                    commit: true,
                    refocus: false
                });
                movePisiSheetCellFocus(table, cell, 0, event.shiftKey ? -1 : 1, {
                    wrap: true,
                    addRowAtEnd: !event.shiftKey
                });
            }
        });

        table.addEventListener('input', (event) => {
            const cell = event.target.closest('td[data-cell]');

            if (!cell || !table.contains(cell) || !isPisiSheetEditingCell(table, cell)) {
                return;
            }

            pisiEditedSheetCells.add(cell);
            syncPisiSheetFormulaInput(cell);
        });

        table.addEventListener('focusout', (event) => {
            const cell = event.target.closest('td[data-cell]');

            if (!cell || !table.contains(cell) || !isPisiSheetEditingCell(table, cell)) {
                return;
            }

            if (isPisiSheetFormulaReferenceKeyboardNavigationActive(table)) {
                return;
            }

            finishPisiSheetCellEdit(table, {
                commit: true,
                refocus: false
            });
        });
    });
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    pisiSheetNotifyTimers: {
        enumerable: true,
        get() {
            return pisiSheetNotifyTimers;
        }
    },
    hydratePisiSheets: {
        enumerable: true,
        get() {
            return hydratePisiSheets;
        }
    }
});
registerModule('editor.sheetInteractions', moduleApi);
