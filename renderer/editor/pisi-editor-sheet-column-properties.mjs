import { registerModule } from "../core/module-registry.mjs";

let pisiSheetColumnMenu = null;
let pisiSheetColumnResize = null;
let pisiSheetMeasureCanvas = null;

const PISI_SHEET_MIN_COLUMN_WIDTH = 25;
const PISI_SHEET_MAX_COLUMN_WIDTH = 640;
const PISI_SHEET_AUTO_FIT_MIN_WIDTH = 64;
const PISI_SHEET_AUTO_FIT_MAX_WIDTH = 480;
const PISI_SHEET_RESIZE_SNAP_PX = 4;

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

    const colIndex = Number(
        resizer.dataset.pisiSheetColResizer
    );
    const header = table.querySelector(
        'thead th[data-col-header="' + colIndex + '"]'
    );

    if (!Number.isInteger(colIndex) || !header) return;

    const startWidth =
        header.getBoundingClientRect().width;

    pisiSheetColumnResize = {
        table,
        colIndex,
        startX: event.clientX,
        startWidth,
        width: startWidth
    };

    document.body.classList.add(
        'pisi-sheet-column-resizing'
    );
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
    document.body.classList.remove(
        'pisi-sheet-column-resizing'
    );

    if (
        Math.abs(
            resize.width -
            resize.startWidth
        ) >= 1
    ) {
        schedulePisiSheetEditorNotification(
            resize.table
        );
    }
}

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
    label.className =
        'pisi-sheet-column-property-label';
    label.textContent = labelText;

    row.append(label, control);
    return row;
}

function positionPisiSheetColumnMenu(menu, header) {
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
}

function openPisiSheetColumnMenu(table, header) {
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
    menu.setAttribute('aria-label', 'Column properties');

    heading.className =
        'pisi-sheet-column-menu-heading';
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
    description.placeholder = 'Description';
    description.value = field.description || '';
    menu.appendChild(
        makePisiSheetColumnMenuRow(
            'Description',
            description
        )
    );

    [
        ['text', 'Text'],
        ['number', 'Number'],
        ['formula', 'Formula']
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
            'Type',
            typeSelect
        )
    );

    wrap.type = 'checkbox';
    wrap.checked = field.wrap === true;
    menu.appendChild(
        makePisiSheetColumnMenuRow(
            'Wrap',
            wrap
        )
    );

    widthInput.type = 'number';
    widthInput.min = String(
        PISI_SHEET_MIN_COLUMN_WIDTH
    );
    widthInput.max = String(
        PISI_SHEET_MAX_COLUMN_WIDTH
    );
    widthInput.step = '1';
    widthInput.value = String(
        Math.round(
            field.width ||
            PISI_SHEET_DEFAULT_COLUMN_WIDTH
        )
    );
    widthInput.className =
        'pisi-sheet-column-width-input';
    menu.appendChild(
        makePisiSheetColumnMenuRow(
            'Width',
            widthInput
        )
    );

    pin.type = 'checkbox';
    pin.checked = field.pin === true;
    menu.appendChild(
        makePisiSheetColumnMenuRow(
            'Pin',
            pin
        )
    );

    const actions = document.createElement('div');
    actions.className =
        'pisi-sheet-column-menu-actions';

    autoFitButton.type = 'button';
    autoFitButton.textContent = 'Fit width';
    autoFitButton.dataset.pisiSheetColumnAction =
        'autoFit';

    hideButton.type = 'button';
    hideButton.textContent = 'Hide column';
    hideButton.dataset.pisiSheetColumnAction =
        'hide';

    const visibleFieldCount = fields.filter(
        (candidate) => !hiddenIds.has(candidate.id)
    ).length;
    hideButton.disabled = visibleFieldCount <= 1;

    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete column';
    deleteButton.dataset.pisiSheetColumnAction =
        'delete';
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
        const hiddenGroup =
            document.createElement('div');
        const hiddenTitle =
            document.createElement('div');

        hiddenGroup.className =
            'pisi-sheet-hidden-columns-group';
        hiddenTitle.className =
            'pisi-sheet-hidden-columns-title';
        hiddenTitle.textContent = 'Hidden columns';
        hiddenGroup.appendChild(hiddenTitle);

        hiddenFields.forEach((hiddenField) => {
            const button =
                document.createElement('button');

            button.type = 'button';
            button.textContent =
                'Show: ' + hiddenField.name;
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
    positionPisiSheetColumnMenu(menu, header);

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
        refreshPisiSheetAfterColumnPropertyChange(
            table
        );
    };

    input.addEventListener('change', () => {
        persistFieldPatch({ name: input.value });
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
            autoFitPisiSheetColumn(
                table,
                colIndex
            )
        );
    });

    hideButton.addEventListener('click', () => {
        setPisiSheetFieldHidden(
            table,
            colIndex,
            true
        );
        refreshPisiSheetAfterColumnPropertyChange(
            table
        );
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

document.addEventListener(
    'mousemove',
    movePisiSheetColumnResize,
    true
);
document.addEventListener(
    'mouseup',
    finishPisiSheetColumnResize,
    true
);
document.addEventListener('pointerdown', (event) => {
    if (
        pisiSheetColumnMenu &&
        !pisiSheetColumnMenu.menu.contains(event.target)
    ) {
        closePisiSheetColumnMenu();
    }
}, true);
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closePisiSheetColumnMenu();
    }
}, true);
document.addEventListener('scroll', () => {
    closePisiSheetColumnMenu();
}, true);
window.addEventListener('blur', () => {
    closePisiSheetColumnMenu();
});

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "PISI_SHEET_MIN_COLUMN_WIDTH": {
        enumerable: true,
        get() { return PISI_SHEET_MIN_COLUMN_WIDTH; }
    },
    "PISI_SHEET_MAX_COLUMN_WIDTH": {
        enumerable: true,
        get() { return PISI_SHEET_MAX_COLUMN_WIDTH; }
    },
    "PISI_SHEET_AUTO_FIT_MIN_WIDTH": {
        enumerable: true,
        get() { return PISI_SHEET_AUTO_FIT_MIN_WIDTH; }
    },
    "PISI_SHEET_AUTO_FIT_MAX_WIDTH": {
        enumerable: true,
        get() { return PISI_SHEET_AUTO_FIT_MAX_WIDTH; }
    },
    "PISI_SHEET_RESIZE_SNAP_PX": {
        enumerable: true,
        get() { return PISI_SHEET_RESIZE_SNAP_PX; }
    },
    "setPisiSheetColumnWidth": {
        enumerable: true,
        get() { return setPisiSheetColumnWidth; }
    },
    "getPisiSheetColumnAutoFitWidth": {
        enumerable: true,
        get() { return getPisiSheetColumnAutoFitWidth; }
    },
    "autoFitPisiSheetColumn": {
        enumerable: true,
        get() { return autoFitPisiSheetColumn; }
    },
    "startPisiSheetColumnResize": {
        enumerable: true,
        get() { return startPisiSheetColumnResize; }
    },
    "closePisiSheetColumnMenu": {
        enumerable: true,
        get() { return closePisiSheetColumnMenu; }
    },
    "openPisiSheetColumnMenu": {
        enumerable: true,
        get() { return openPisiSheetColumnMenu; }
    }
});
registerModule("editor.sheetColumnProperties", moduleApi);
