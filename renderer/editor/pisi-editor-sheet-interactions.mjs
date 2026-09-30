import { registerModule } from "../core/module-registry.mjs";

const pisiSheetNotifyTimers = new WeakMap();

let pisiSheetDragSelection = null;
let pisiSheetContextMenu = null;
let pisiSheetColumnMenu = null;
let pisiSheetColumnResize = null;

const PISI_SHEET_MIN_COLUMN_WIDTH = 48;
const PISI_SHEET_MAX_COLUMN_WIDTH = 640;

function getPisiSheetStoredColumnWidths(table) {
    try {
        const widths = JSON.parse(
            table?.dataset?.pisiColumnWidths || '[]'
        );
        return Array.isArray(widths) ? widths : [];
    } catch {
        return [];
    }
}

function storePisiSheetColumnWidth(table, colIndex, width) {
    const widths = getPisiSheetStoredColumnWidths(table);
    widths[colIndex] = width;
    table.dataset.pisiColumnWidths = JSON.stringify(widths);
}

function setPisiSheetColumnWidth(table, colIndex, width) {
    const nextWidth = Math.max(
        PISI_SHEET_MIN_COLUMN_WIDTH,
        Math.min(PISI_SHEET_MAX_COLUMN_WIDTH, Math.round(width))
    );
    const size = String(nextWidth) + 'px';
    const header = table.querySelector(
        'thead th[data-col-header="' + colIndex + '"]'
    );

    [header, ...Array.from(
        table.querySelectorAll(
            'tbody td[data-col="' + colIndex + '"]'
        )
    )]
        .filter(Boolean)
        .forEach((cell) => {
            cell.style.width = size;
            cell.style.minWidth = size;
            cell.style.maxWidth = size;
        });

    storePisiSheetColumnWidth(table, colIndex, nextWidth);
    return nextWidth;
}

function startPisiSheetColumnResize(table, resizer, event) {
    finishPisiSheetCellEdit(table, {
        commit: true,
        refocus: false
    });

    const colIndex = Number(resizer.dataset.pisiSheetColResizer);
    const header = table.querySelector(
        'thead th[data-col-header="' + colIndex + '"]'
    );
    if (!Number.isInteger(colIndex) || !header) return;

    const startWidth = header.getBoundingClientRect().width;

    pisiSheetColumnResize = {
        table,
        colIndex,
        startX: event.clientX,
        startWidth,
        width: startWidth
    };

    document.body.classList.add('pisi-sheet-column-resizing');
}

function movePisiSheetColumnResize(event) {
    const resize = pisiSheetColumnResize;
    if (!resize) return;

    event.preventDefault();

    resize.width = setPisiSheetColumnWidth(
        resize.table,
        resize.colIndex,
        resize.startWidth + event.clientX - resize.startX
    );
}

function finishPisiSheetColumnResize() {
    const resize = pisiSheetColumnResize;
    if (!resize) return;

    pisiSheetColumnResize = null;
    document.body.classList.remove('pisi-sheet-column-resizing');

    if (Math.abs(resize.width - resize.startWidth) >= 1) {
        schedulePisiSheetEditorNotification(resize.table);
    }
}

document.addEventListener('mousemove', movePisiSheetColumnResize, true);
document.addEventListener('mouseup', finishPisiSheetColumnResize, true);

function closePisiSheetColumnMenu(save = true) {
    if (!pisiSheetColumnMenu) return;

    const state = pisiSheetColumnMenu;
    pisiSheetColumnMenu = null;

    if (save) {
        const nextValue = String(state.input.value || '').trim();

        if (nextValue !== state.originalLabel) {
            setPisiSheetColumnLabel(
                state.table,
                state.colIndex,
                nextValue
            );
            schedulePisiSheetEditorNotification(state.table);
        }
    }

    state.menu.remove();
}

function openPisiSheetColumnMenu(table, header) {
    closePisiSheetContextMenu();
    closePisiSheetColumnMenu(true);
    finishPisiSheetCellEdit(table, {
        commit: true,
        refocus: false
    });
    clearPisiSheetSelection(table);

    const colIndex = Number(header.dataset.colHeader);
    if (!Number.isInteger(colIndex)) return;

    const label = header.querySelector('.pisi-sheet-col-label');
    const originalLabel = String(label?.textContent || '').trim();
    const menu = document.createElement('div');
    const input = document.createElement('input');

    menu.className = 'pisi-sheet-column-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute(
        'aria-label',
        window.pisiT?.('Sütun adını değiştir') ||
            'Sütun adını değiştir'
    );

    input.type = 'text';
    input.className = 'pisi-sheet-column-name-input';
    input.maxLength = 80;
    input.value = originalLabel;
    input.setAttribute(
        'aria-label',
        window.pisiT?.('Sütun adını değiştir') ||
            'Sütun adını değiştir'
    );

    menu.appendChild(input);
    document.body.appendChild(menu);

    const rect = header.getBoundingClientRect();
    const margin = 8;
    const menuRect = menu.getBoundingClientRect();

    menu.style.left = String(Math.max(
        margin,
        Math.min(
            rect.left,
            window.innerWidth - menuRect.width - margin
        )
    )) + 'px';
    menu.style.top = String(Math.max(
        margin,
        Math.min(
            rect.bottom + 4,
            window.innerHeight - menuRect.height - margin
        )
    )) + 'px';

    pisiSheetColumnMenu = {
        table,
        colIndex,
        input,
        menu,
        originalLabel
    };

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            closePisiSheetColumnMenu(true);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closePisiSheetColumnMenu(false);
        }
    });

    input.focus();
    input.select();
}

function closePisiSheetContextMenu() {
    if (!pisiSheetContextMenu) return;
    pisiSheetContextMenu.remove();
    pisiSheetContextMenu = null;
}

function getPisiSheetContextToolbar(table) {
    const editor = getEditorForPisiElement(table);
    if (!editor) return null;

    return document.querySelector(
        '.pisi-editor-toolbar[data-editor-target="' +
        editor.id + '"]'
    );
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
    closePisiSheetColumnMenu(true);
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
    menu.setAttribute(
        'aria-label',
        window.pisiT?.('Tablo satır ve sütun işlemleri') ||
            'Tablo satır ve sütun işlemleri'
    );

    actions.forEach(({ action, label, disabled }) => {
        const button = document.createElement('button');

        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.setAttribute(
            'data-pisi-sheet-context-action',
            action
        );
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

    menu.style.left = String(Math.max(
        margin,
        Math.min(
            clientX,
            window.innerWidth - rect.width - margin
        )
    )) + 'px';
    menu.style.top = String(Math.max(
        margin,
        Math.min(
            clientY,
            window.innerHeight - rect.height - margin
        )
    )) + 'px';
}

document.addEventListener('pointerdown', (event) => {
    if (
        pisiSheetContextMenu &&
        !pisiSheetContextMenu.contains(event.target)
    ) {
        closePisiSheetContextMenu();
    }

    if (
        pisiSheetColumnMenu &&
        !pisiSheetColumnMenu.menu.contains(event.target)
    ) {
        closePisiSheetColumnMenu(true);
    }
}, true);

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closePisiSheetContextMenu();
    }
}, true);

document.addEventListener('scroll', () => {
    closePisiSheetContextMenu();
    closePisiSheetColumnMenu(true);
}, true);

window.addEventListener('blur', () => {
    closePisiSheetContextMenu();
    closePisiSheetColumnMenu(true);
});

document.addEventListener('mouseup', () => {
    if (pisiSheetDragSelection?.table) {
        pisiSheetDragSelection.table.classList.remove(
            'pisi-sheet-drag-selecting'
        );
    }

    pisiSheetDragSelection = null;
}, true);

function isPisiSheetPrintableKey(event) {
    return Boolean(
        event.key?.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
    );
}

function hydratePisiSheets(root = document) {
    root.querySelectorAll('table[data-pisi-sheet]').forEach((table) => {
        table.removeAttribute('data-pisi-sheet-bound');

        if (pisiBoundSheets.has(table)) return;

        refreshPisiSheetCellMetadata(table);
        pisiBoundSheets.add(table);

        table.addEventListener('focusin', (event) => {
            const cell = event.target.closest('td[data-cell]');

            if (!cell || !table.contains(cell)) return;
            if (isPisiSheetEditingCell(table, cell)) return;

            if (!isPisiSheetCellSelected(table, cell)) {
                selectPisiSheetCell(cell);
            } else {
                window.__pisiActiveSheetCell = cell;
                syncPisiSheetFormulaInput(cell);
            }
        });

        table.addEventListener('click', (/** @type {MouseEvent} */ event) => {
            const header = event.target.closest(
                'thead th[data-col-header]'
            );
            const resizer = event.target.closest(
                '[data-pisi-sheet-col-resizer]'
            );

            if (header && table.contains(header) && !resizer) {
                event.preventDefault();
                event.stopPropagation();
                openPisiSheetColumnMenu(table, header);
            }
        });

        table.addEventListener('dblclick', (/** @type {MouseEvent} */ event) => {
            const cell = event.target.closest('td[data-cell]');

            if (!cell || !table.contains(cell)) return;

            event.preventDefault();
            event.stopPropagation();
            beginPisiSheetCellEdit(cell);
        });

        table.addEventListener('contextmenu', (/** @type {MouseEvent} */ event) => {
            const rowHeader = event.target.closest(
                'tbody th[data-row-header]'
            );
            const colHeader = event.target.closest(
                'thead th[data-col-header]'
            );
            const cell = event.target.closest('td[data-cell]');

            if (
                (!rowHeader && !colHeader && !cell) ||
                !(event.target instanceof Node) ||
                !table.contains(event.target)
            ) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            finishPisiSheetCellEdit(table, {
                commit: true,
                refocus: false
            });

            if (rowHeader) {
                selectPisiSheetRow(
                    table,
                    Number(rowHeader.dataset.rowHeader),
                    false
                );
            } else if (colHeader) {
                selectPisiSheetColumn(
                    table,
                    Number(colHeader.dataset.colHeader),
                    false
                );
            } else if (
                cell &&
                !isPisiSheetCellSelected(table, cell)
            ) {
                selectPisiSheetCell(cell);
            }

            openPisiSheetContextMenu(
                table,
                event.clientX,
                event.clientY
            );
        });

        table.addEventListener('mousedown', (/** @type {MouseEvent} */ event) => {
            const resizer = event.target.closest(
                '[data-pisi-sheet-col-resizer]'
            );

            if (resizer && table.contains(resizer)) {
                if (event.button !== 0) return;

                event.preventDefault();
                event.stopPropagation();
                closePisiSheetColumnMenu(true);
                closePisiSheetContextMenu();
                startPisiSheetColumnResize(
                    table,
                    resizer,
                    event
                );
                return;
            }

            const colHeader = event.target.closest(
                'thead th[data-col-header]'
            );

            if (colHeader && table.contains(colHeader)) {
                if (event.button === 0) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }

            const rowHeader = event.target.closest(
                'tbody th[data-row-header]'
            );
            const cornerHeader = event.target.closest(
                'thead th[data-pisi-sheet-corner]'
            );
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
                selectPisiSheetRow(
                    table,
                    Number(rowHeader.dataset.rowHeader),
                    event.shiftKey
                );
                return;
            }

            if (
                !cell ||
                !table.contains(cell) ||
                event.button !== 0
            ) {
                return;
            }

            if (isPisiSheetEditingCell(table, cell)) {
                return;
            }

            finishPisiSheetCellEdit(table, {
                commit: true,
                refocus: false
            });
            closePisiSheetColumnMenu(true);
            closePisiSheetContextMenu();

            event.preventDefault();

            selectPisiSheetCell(cell, {
                extend: event.shiftKey,
                focus: true
            });

            const selection = pisiSheetSelections.get(table);

            if (selection) {
                pisiSheetDragSelection = {
                    table,
                    anchor: { ...selection.anchor },
                    last: { ...selection.focus }
                };
            }
        });

        table.addEventListener('mouseover', (/** @type {MouseEvent} */ event) => {
            const drag = pisiSheetDragSelection;

            if (!drag || drag.table !== table) return;
            if (!(event.buttons & 1)) return;

            const cell = event.target.closest('td[data-cell]');

            if (!cell || !table.contains(cell)) return;

            const point = getPisiSheetCellPosition(cell);

            if (!point) return;
            if (
                drag.last.rowId === point.rowId &&
                drag.last.colId === point.colId
            ) {
                return;
            }

            event.preventDefault();
            drag.last = point;
            table.classList.add('pisi-sheet-drag-selecting');

            pisiSheetSelections.set(table, {
                mode: 'range',
                anchor: drag.anchor,
                focus: point
            });

            window.__pisiActiveSheetCell = cell;
            renderPisiSheetSelection(table);
            syncPisiSheetFormulaInput(cell);
            syncPisiSheetToolbarForTable(table);
        });

        table.addEventListener('keydown', (event) => {
            const cell = event.target.closest('td[data-cell]');

            if (!cell || !table.contains(cell)) return;

            if (isPisiSheetEditingCell(table, cell)) {
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
                    movePisiSheetCellFocus(
                        table,
                        cell,
                        event.shiftKey ? -1 : 1,
                        0
                    );
                    return;
                }

                if (event.key === 'Tab') {
                    event.preventDefault();
                    event.stopPropagation();
                    finishPisiSheetCellEdit(table, {
                        commit: true,
                        refocus: false
                    });
                    movePisiSheetCellFocus(
                        table,
                        cell,
                        0,
                        event.shiftKey ? -1 : 1,
                        {
                            wrap: true,
                            addRowAtEnd: !event.shiftKey
                        }
                    );
                }

                return;
            }

            const arrows = [
                'ArrowUp',
                'ArrowDown',
                'ArrowLeft',
                'ArrowRight'
            ];

            if (event.key === 'Enter' || event.key === 'F2') {
                event.preventDefault();
                beginPisiSheetCellEdit(cell);
                return;
            }

            if (event.key === 'Tab') {
                event.preventDefault();
                movePisiSheetCellFocus(
                    table,
                    cell,
                    0,
                    event.shiftKey ? -1 : 1,
                    {
                        wrap: true,
                        addRowAtEnd: !event.shiftKey
                    }
                );
                return;
            }

            if (
                event.shiftKey &&
                arrows.includes(event.key)
            ) {
                event.preventDefault();
                extendPisiSheetSelectionByKeyboard(
                    table,
                    cell,
                    event.key
                );
                return;
            }

            if (arrows.includes(event.key)) {
                event.preventDefault();

                const deltas = {
                    ArrowUp: [-1, 0],
                    ArrowDown: [1, 0],
                    ArrowLeft: [0, -1],
                    ArrowRight: [0, 1]
                };
                const delta = deltas[event.key];

                movePisiSheetCellFocus(
                    table,
                    cell,
                    delta[0],
                    delta[1]
                );
                return;
            }

            if (
                event.key === 'Delete' ||
                event.key === 'Backspace'
            ) {
                event.preventDefault();
                clearPisiSheetSelectedCells(table);
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                clearPisiSheetSelection(table);
                return;
            }

            if (isPisiSheetPrintableKey(event)) {
                event.preventDefault();
                beginPisiSheetCellEdit(cell, {
                    replace: true,
                    initialText: event.key
                });
            }
        });

        table.addEventListener('input', (event) => {
            const cell = event.target.closest('td[data-cell]');

            if (
                !cell ||
                !table.contains(cell) ||
                !isPisiSheetEditingCell(table, cell)
            ) {
                return;
            }

            pisiEditedSheetCells.add(cell);
            syncPisiSheetFormulaInput(cell);
        });

        table.addEventListener('focusout', (event) => {
            const cell = event.target.closest('td[data-cell]');

            if (
                !cell ||
                !table.contains(cell) ||
                !isPisiSheetEditingCell(table, cell)
            ) {
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
    "pisiSheetNotifyTimers": {
        enumerable: true,
        get() { return pisiSheetNotifyTimers; }
    },
    "hydratePisiSheets": {
        enumerable: true,
        get() { return hydratePisiSheets; }
    }
});
registerModule("editor.sheetInteractions", moduleApi);
