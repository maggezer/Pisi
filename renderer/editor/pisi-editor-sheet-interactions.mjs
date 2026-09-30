import { registerModule } from "../core/module-registry.mjs";

const pisiSheetNotifyTimers = new WeakMap();

let pisiSheetDragSelection = null;
let pisiSheetContextMenu = null;
let pisiSheetColumnMenu = null;
let pisiSheetColumnResize = null;

const PISI_SHEET_MIN_COLUMN_WIDTH = 25;
const PISI_SHEET_MAX_COLUMN_WIDTH = 640;
const PISI_SHEET_AUTO_FIT_MIN_WIDTH = 64;
const PISI_SHEET_AUTO_FIT_MAX_WIDTH = 480;
const PISI_SHEET_RESIZE_SNAP_PX = 4;

let pisiSheetMeasureCanvas = null;

function setPisiSheetColumnWidth(table, colIndex, width) {
    const nextWidth = Math.max(
        PISI_SHEET_MIN_COLUMN_WIDTH,
        Math.min(
            PISI_SHEET_MAX_COLUMN_WIDTH,
            Math.round(width)
        )
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

    setPisiSheetFieldWidth(
        table,
        colIndex,
        nextWidth
    );

    return nextWidth;
}

function measurePisiSheetText(element, text) {
    pisiSheetMeasureCanvas =
        pisiSheetMeasureCanvas ||
        document.createElement('canvas');

    const context =
        pisiSheetMeasureCanvas.getContext('2d');

    if (!context) {
        return String(text || '').length * 8;
    }

    const style = element
        ? getComputedStyle(element)
        : getComputedStyle(document.body);

    context.font = [
        style.fontStyle || 'normal',
        style.fontWeight || '400',
        style.fontSize || '12px',
        style.fontFamily || 'sans-serif'
    ].join(' ');

    return context.measureText(
        String(text || '')
    ).width;
}

function getPisiSheetColumnAutoFitWidth(table, colIndex) {
    const header = table.querySelector(
        'thead th[data-col-header="' + colIndex + '"]'
    );
    const label = header?.querySelector(
        '.pisi-sheet-col-label'
    );
    let required = label
        ? measurePisiSheetText(
            label,
            label.textContent || ''
        ) + 42
        : PISI_SHEET_AUTO_FIT_MIN_WIDTH;

    table.querySelectorAll(
        'tbody td[data-col="' + colIndex + '"]'
    ).forEach((cell) => {
        required = Math.max(
            required,
            measurePisiSheetText(
                cell,
                cell.textContent || ''
            ) + 18
        );
    });

    return Math.max(
        PISI_SHEET_AUTO_FIT_MIN_WIDTH,
        Math.min(
            PISI_SHEET_AUTO_FIT_MAX_WIDTH,
            Math.ceil(required)
        )
    );
}

function autoFitPisiSheetColumn(table, colIndex) {
    const width = getPisiSheetColumnAutoFitWidth(
        table,
        colIndex
    );

    setPisiSheetColumnWidth(
        table,
        colIndex,
        width
    );
    schedulePisiSheetEditorNotification(table);
    return width;
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

    const rawWidth =
        resize.startWidth +
        event.clientX -
        resize.startX;
    const snappedWidth =
        Math.abs(rawWidth - resize.startWidth) <=
        PISI_SHEET_RESIZE_SNAP_PX
            ? resize.startWidth
            : rawWidth;

    resize.width = setPisiSheetColumnWidth(
        resize.table,
        resize.colIndex,
        snappedWidth
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

function closePisiSheetColumnMenu() {
    if (!pisiSheetColumnMenu) return;

    const state = pisiSheetColumnMenu;
    pisiSheetColumnMenu = null;
    state.menu.remove();
}

function refreshPisiSheetAfterColumnPropertyChange(table) {
    renderPisiSheetDatabase(table);
    recalcPisiSheet(table);
    reconcilePisiSheetSelection(table);
    schedulePisiSheetEditorNotification(table);
}

function makePisiSheetColumnMenuRow(labelText, control) {
    const row = document.createElement('label');
    const label = document.createElement('span');

    row.className = 'pisi-sheet-column-property-row';
    label.className = 'pisi-sheet-column-property-label';
    label.textContent = labelText;

    row.append(label, control);
    return row;
}

function openPisiSheetColumnMenu(table, header) {
    closePisiSheetContextMenu();
    closePisiSheetColumnMenu();
    finishPisiSheetCellEdit(table, {
        commit: true,
        refocus: false
    });
    clearPisiSheetSelection(table);

    const colIndex = Number(header.dataset.colHeader);
    const field = getPisiSheetField(table, colIndex);

    if (!Number.isInteger(colIndex) || !field) return;

    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;
    const fields = database
        ? getPisiSheetOrderedFields(database)
        : [];
    const hiddenIds = new Set(
        view?.hiddenFieldIds || []
    );
    const menu = document.createElement('div');
    const heading = document.createElement('div');
    const icon = document.createElement('span');
    const input = document.createElement('input');
    const description = document.createElement('textarea');
    const typeSelect = document.createElement('select');
    const wrap = document.createElement('input');
    const widthInput = document.createElement('input');
    const pin = document.createElement('input');
    const autoFitButton = document.createElement('button');
    const hideButton = document.createElement('button');
    const deleteButton = document.createElement('button');

    menu.className = 'pisi-sheet-column-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute(
        'aria-label',
        window.pisiT?.('Sütun ayarları') ||
            'Sütun ayarları'
    );

    heading.className = 'pisi-sheet-column-menu-heading';
    icon.className = 'pisi-sheet-column-type-icon';
    icon.textContent =
        field.type === 'number'
            ? '123'
            : (field.type === 'formula' ? 'fx' : 'Aa');

    input.type = 'text';
    input.className = 'pisi-sheet-column-name-input';
    input.maxLength = 80;
    input.value = field.name;
    input.setAttribute('aria-label', 'Column name');

    heading.append(icon, input);
    menu.appendChild(heading);

    description.className =
        'pisi-sheet-column-description-input';
    description.maxLength = 240;
    description.rows = 2;
    description.placeholder =
        window.pisiT?.('Açıklama') || 'Açıklama';
    description.value = field.description || '';
    menu.appendChild(
        makePisiSheetColumnMenuRow(
            window.pisiT?.('Açıklama') || 'Açıklama',
            description
        )
    );

    [
        ['text', window.pisiT?.('Metin') || 'Text'],
        ['number', window.pisiT?.('Sayı') || 'Number'],
        ['formula', window.pisiT?.('Formül') || 'Formula']
    ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        typeSelect.appendChild(option);
    });
    typeSelect.value = field.type || 'text';
    typeSelect.className = 'pisi-sheet-column-select';
    menu.appendChild(
        makePisiSheetColumnMenuRow(
            window.pisiT?.('Tip') || 'Type',
            typeSelect
        )
    );

    wrap.type = 'checkbox';
    wrap.checked = field.wrap === true;
    menu.appendChild(
        makePisiSheetColumnMenuRow(
            window.pisiT?.('Metni kaydır') || 'Wrap',
            wrap
        )
    );

    widthInput.type = 'number';
    widthInput.min = String(PISI_SHEET_MIN_COLUMN_WIDTH);
    widthInput.max = String(PISI_SHEET_MAX_COLUMN_WIDTH);
    widthInput.step = '1';
    widthInput.value = String(
        Math.round(field.width || PISI_SHEET_DEFAULT_COLUMN_WIDTH)
    );
    widthInput.className = 'pisi-sheet-column-width-input';
    menu.appendChild(
        makePisiSheetColumnMenuRow(
            window.pisiT?.('Genişlik') || 'Width',
            widthInput
        )
    );

    pin.type = 'checkbox';
    pin.checked = field.pin === true;
    menu.appendChild(
        makePisiSheetColumnMenuRow(
            window.pisiT?.('Sabitle') || 'Pin',
            pin
        )
    );

    const actions = document.createElement('div');
    actions.className = 'pisi-sheet-column-menu-actions';

    autoFitButton.type = 'button';
    autoFitButton.textContent =
        window.pisiT?.('İçeriğe sığdır') || 'Fit width';
    autoFitButton.dataset.pisiSheetColumnAction = 'autoFit';

    hideButton.type = 'button';
    hideButton.textContent =
        window.pisiT?.('Sütunu gizle') || 'Hide column';
    hideButton.dataset.pisiSheetColumnAction = 'hide';

    const visibleFieldCount = fields.filter(
        (candidate) => !hiddenIds.has(candidate.id)
    ).length;
    hideButton.disabled = visibleFieldCount <= 1;

    deleteButton.type = 'button';
    deleteButton.textContent =
        window.pisiT?.('Sütunu sil') || 'Delete column';
    deleteButton.dataset.pisiSheetColumnAction = 'delete';
    deleteButton.className = 'danger';
    deleteButton.disabled = fields.length <= 1;

    actions.append(
        autoFitButton,
        hideButton,
        deleteButton
    );
    menu.appendChild(actions);

    const hiddenFields = fields.filter(
        (candidate) => hiddenIds.has(candidate.id)
    );

    if (hiddenFields.length) {
        const hiddenGroup = document.createElement('div');
        const hiddenTitle = document.createElement('div');

        hiddenGroup.className =
            'pisi-sheet-hidden-columns-group';
        hiddenTitle.className =
            'pisi-sheet-hidden-columns-title';
        hiddenTitle.textContent =
            window.pisiT?.('Gizli sütunlar') ||
            'Hidden columns';
        hiddenGroup.appendChild(hiddenTitle);

        hiddenFields.forEach((hiddenField) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent =
                (window.pisiT?.('Göster') || 'Show') +
                ': ' +
                hiddenField.name;
            button.dataset.pisiSheetShowFieldId =
                hiddenField.id;

            button.addEventListener('click', () => {
                const index = fields.findIndex(
                    (candidate) =>
                        candidate.id === hiddenField.id
                );

                if (index < 0) return;

                setPisiSheetFieldHidden(
                    table,
                    index,
                    false
                );
                refreshPisiSheetAfterColumnPropertyChange(
                    table
                );
                closePisiSheetColumnMenu();
            });

            hiddenGroup.appendChild(button);
        });

        menu.appendChild(hiddenGroup);
    }

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
        menu
    };

    const persistFieldPatch = (patch) => {
        updatePisiSheetField(
            table,
            colIndex,
            patch
        );
        refreshPisiSheetAfterColumnPropertyChange(table);
    };

    input.addEventListener('change', () => {
        persistFieldPatch({
            name: input.value
        });
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            persistFieldPatch({
                name: input.value
            });
            closePisiSheetColumnMenu();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closePisiSheetColumnMenu();
        }
    });

    description.addEventListener('change', () => {
        persistFieldPatch({
            description: description.value
        });
    });

    typeSelect.addEventListener('change', () => {
        persistFieldPatch({
            type: typeSelect.value
        });
    });

    wrap.addEventListener('change', () => {
        persistFieldPatch({
            wrap: wrap.checked
        });
    });

    widthInput.addEventListener('change', () => {
        const width = setPisiSheetColumnWidth(
            table,
            colIndex,
            Number(widthInput.value)
        );
        widthInput.value = String(width);
        schedulePisiSheetEditorNotification(table);
    });

    pin.addEventListener('change', () => {
        persistFieldPatch({
            pin: pin.checked
        });
    });

    autoFitButton.addEventListener('click', () => {
        widthInput.value = String(
            autoFitPisiSheetColumn(table, colIndex)
        );
    });

    hideButton.addEventListener('click', () => {
        setPisiSheetFieldHidden(
            table,
            colIndex,
            true
        );
        refreshPisiSheetAfterColumnPropertyChange(table);
        closePisiSheetColumnMenu();
    });

    deleteButton.addEventListener('click', () => {
        closePisiSheetColumnMenu();
        selectPisiSheetColumn(
            table,
            colIndex,
            false
        );

        if (deletePisiSheetColumns(table)) {
            syncPisiSheetToolbarForTable(table);
            schedulePisiSheetEditorNotification(table);
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
        closePisiSheetColumnMenu();
    }
}, true);

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closePisiSheetContextMenu();
    }
}, true);

document.addEventListener('scroll', () => {
    closePisiSheetContextMenu();
    closePisiSheetColumnMenu();
}, true);

window.addEventListener('blur', () => {
    closePisiSheetContextMenu();
    closePisiSheetColumnMenu();
});

document.addEventListener('mouseup', () => {
    finishPisiSheetFormulaReferencePick();

    if (pisiSheetDragSelection?.table) {
        pisiSheetDragSelection.table.classList.remove(
            'pisi-sheet-drag-selecting'
        );
    }

    pisiSheetDragSelection = null;
}, true);

function hydratePisiSheets(root = document) {
    root.querySelectorAll('table[data-pisi-sheet]').forEach((table) => {
        table.removeAttribute('data-pisi-sheet-bound');

        if (pisiBoundSheets.has(table)) return;

        hydratePisiSheetDatabase(table);
        renderPisiSheetDatabase(table);
        recalcPisiSheet(table);
        reconcilePisiSheetSelection(table);
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
            const resizer = event.target.closest(
                '[data-pisi-sheet-col-resizer]'
            );

            if (resizer && table.contains(resizer)) {
                const colIndex = Number(
                    resizer.dataset.pisiSheetColResizer
                );

                if (Number.isInteger(colIndex)) {
                    event.preventDefault();
                    event.stopPropagation();
                    autoFitPisiSheetColumn(
                        table,
                        colIndex
                    );
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
                closePisiSheetColumnMenu();
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

            if (
                beginPisiSheetFormulaReferencePick(
                    table,
                    cell,
                    event
                )
            ) {
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

            if (
                updatePisiSheetFormulaReferencePick(
                    table,
                    cell,
                    event
                )
            ) {
                return;
            }

            const drag = pisiSheetDragSelection;

            if (!drag || drag.table !== table) return;

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

            setPisiSheetRangeSelection(
                table,
                drag.anchor,
                point,
                {
                    mode: 'range',
                    active: point,
                    ensureVisible: true
                }
            );
        });

        table.addEventListener('keydown', (event) => {
            const cell = event.target.closest('td[data-cell]');

            if (
                !cell ||
                !table.contains(cell) ||
                !isPisiSheetEditingCell(table, cell)
            ) {
                return;
            }

            if (
                [
                    'ArrowUp',
                    'ArrowDown',
                    'ArrowLeft',
                    'ArrowRight'
                ].includes(event.key) &&
                movePisiSheetFormulaReferenceByKeyboard(
                    table,
                    event.key,
                    { extend: event.shiftKey }
                )
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

            if (
                isPisiSheetFormulaReferenceKeyboardNavigationActive(
                    table
                )
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
