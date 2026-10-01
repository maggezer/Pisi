import { registerModule } from "../core/module-registry.mjs";

function capturePisiSheetCellFormat(cell) {
    const format = {};

    for (const property of PISI_SHEET_FORMAT_PROPERTIES) {
        const value = cell?.style?.[property];

        if (typeof value === 'string' && value) {
            format[property] = value;
        }
    }

    return format;
}

function applyPisiSheetCellFormatToDom(cell, format = {}) {
    if (!cell) return;

    for (const property of PISI_SHEET_FORMAT_PROPERTIES) {
        cell.style[property] =
            typeof format[property] === 'string'
                ? format[property]
                : '';
    }
}

function applyPisiSheetConditionalColorsToRow(
    table,
    row,
    item,
    fields
) {
    if (!row || !item) return;

    const matches =
        getPisiSheetConditionalColorMatchesForItem(
            table,
            item
        );
    const rowHeader = row.querySelector(
        'th[data-row-header]'
    );
    let rowTone = '';

    for (const rule of matches) {
        if (rule.target === 'row') {
            rowTone = rule.tone;
        }
    }

    if (rowTone) {
        row.dataset.pisiConditionalColor = rowTone;
        if (rowHeader) {
            rowHeader.dataset.pisiConditionalColor =
                rowTone;
        }
    } else {
        delete row.dataset.pisiConditionalColor;
        if (rowHeader) {
            delete rowHeader.dataset.pisiConditionalColor;
        }
    }

    for (const field of fields) {
        const cell = row.querySelector(
            'td[data-pisi-col-id="' +
            field.id +
            '"]'
        );
        if (!cell) continue;

        let tone = '';

        for (const rule of matches) {
            if (
                rule.target === 'row' ||
                (
                    rule.target === 'cell' &&
                    rule.fieldId === field.id
                )
            ) {
                tone = rule.tone;
            }
        }

        if (tone) {
            cell.dataset.pisiConditionalColor = tone;
        } else {
            delete cell.dataset.pisiConditionalColor;
        }
    }
}

function readLegacyPisiSheetColumnArray(table, key) {
    try {
        const value = JSON.parse(
            table?.dataset?.[key] || '[]'
        );
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

function legacyPisiSheetColumnName(index) {
    let name = '';
    let value = Number(index) + 1;

    while (value > 0) {
        const remainder = (value - 1) % 26;
        name = String.fromCharCode(65 + remainder) + name;
        value = Math.floor((value - 1) / 26);
    }

    return name;
}

function migratePisiSheetDatabaseFromDom(table) {
    const rows = Array.from(
        table.querySelectorAll('tbody tr')
    );
    const colCount = Math.max(
        1,
        ...rows.map((row) => (
            row.querySelectorAll('td').length
        ))
    );
    const legacyIds = readLegacyPisiSheetColumnArray(
        table,
        'pisiColumnIds'
    );
    const legacyLabels = readLegacyPisiSheetColumnArray(
        table,
        'pisiColumnLabels'
    );
    const legacyWidths = readLegacyPisiSheetColumnArray(
        table,
        'pisiColumnWidths'
    );

    const seed = createPisiSheetDatabase(
        Math.max(1, rows.length),
        colCount
    );

    seed.fields.forEach((field, colIndex) => {
        const header = table.querySelector(
            'thead th[data-col-header="' +
            colIndex + '"]'
        );
        const label = header?.querySelector(
            '.pisi-sheet-col-label'
        )?.textContent?.trim();
        const width = Number(
            legacyWidths[colIndex] ||
            header?.style?.width?.replace('px', '') ||
            0
        );

        field.id = String(
            legacyIds[colIndex] ||
            header?.dataset?.pisiColId ||
            field.id
        );
        field.name = String(
            legacyLabels[colIndex] ||
            label ||
            legacyPisiSheetColumnName(colIndex)
        ).slice(0, 80);
        field.width = width > 0
            ? Math.round(width)
            : PISI_SHEET_DEFAULT_COLUMN_WIDTH;
        field.wrap = false;
        field.pin = false;
        field.description = '';
    });

    const view = seed.views[0];
    view.fieldOrder = seed.fields.map(
        (field) => field.id
    );

    seed.items.forEach((item, rowIndex) => {
        const row = rows[rowIndex];

        if (!row) return;

        const cells = Array.from(
            row.querySelectorAll('td')
        );

        item.id = String(
            row.dataset.pisiRowId ||
            cells[0]?.dataset?.pisiRowId ||
            item.id
        );

        cells.forEach((cell, colIndex) => {
            const field = seed.fields[colIndex];
            if (!field) return;

            const value = cell.dataset.formula
                ? ''
                : String(cell.textContent || '').trim();
            const formula = cell.dataset.formula || null;
            const format = capturePisiSheetCellFormat(cell);

            if (
                value ||
                formula ||
                Object.keys(format).length
            ) {
                item.values[field.id] = {
                    value,
                    formula,
                    format
                };
            }
        });
    });

    seed.databaseId = String(
        table.dataset.pisiDatabaseId ||
        seed.databaseId
    );

    return normalizePisiSheetDatabase(seed);
}

function hydratePisiSheetDatabase(table) {
    if (!table) return null;

    const existing = getPisiSheetDatabase(table);
    if (existing) return existing;

    let database = null;
    const serialized = table.dataset.pisiSheetModel;

    if (serialized) {
        try {
            database = normalizePisiSheetDatabase(
                JSON.parse(serialized)
            );
        } catch {
            database = null;
        }
    }

    if (!database) {
        database = migratePisiSheetDatabaseFromDom(table);
    }

    attachPisiSheetDatabase(table, database);
    persistPisiSheetDatabase(table);
    return database;
}

function renderPisiSheetDatabase(table) {
    const database =
        getPisiSheetDatabase(table) ||
        hydratePisiSheetDatabase(table);
    if (!database) return null;

    const fields = getPisiSheetOrderedFields(database);
    const view = getPisiSheetTableView(database);
    const hiddenFieldIds = new Set(
        view?.hiddenFieldIds || []
    );
    const pinLeftByFieldId = new Map();
    const visiblePinnedFieldIds = fields
        .filter((field) => (
            field.pin &&
            !hiddenFieldIds.has(field.id)
        ))
        .map((field) => field.id);
    const lastPinnedFieldId =
        visiblePinnedFieldIds.at(-1) || '';
    let pinnedLeft = 36;

    fields.forEach((field) => {
        if (hiddenFieldIds.has(field.id)) return;

        if (field.pin) {
            pinLeftByFieldId.set(
                field.id,
                pinnedLeft
            );
            pinnedLeft += Number(
                field.width ||
                PISI_SHEET_DEFAULT_COLUMN_WIDTH
            );
        }
    });

    let thead = table.querySelector('thead');

    if (!thead) {
        thead = document.createElement('thead');
        table.prepend(thead);
    }

    let headerRow = thead.querySelector('tr');

    if (!headerRow) {
        headerRow = document.createElement('tr');
        thead.appendChild(headerRow);
    }

    const corner = document.createElement('th');
    corner.dataset.pisiSheetCorner = '1';
    const headers = [corner];

    fields.forEach((field, colIndex) => {
        const header = document.createElement('th');
        const label = document.createElement('span');
        const resizer = document.createElement('span');

        header.dataset.colHeader = String(colIndex);
        header.dataset.pisiColId = field.id;

        label.className = 'pisi-sheet-col-label';
        label.textContent = field.name;
        label.draggable = true;
        label.dataset.pisiSheetColDrag = '1';

        resizer.className = 'pisi-sheet-col-resizer';
        resizer.dataset.pisiSheetColResizer =
            String(colIndex);
        resizer.setAttribute('aria-hidden', 'true');

        header.append(label, resizer);

        if (field.width) {
            const size = String(field.width) + 'px';
            header.style.width = size;
            header.style.minWidth = size;
            header.style.maxWidth = size;
        }

        if (field.description) {
            header.title = field.description;
        }

        if (hiddenFieldIds.has(field.id)) {
            header.hidden = true;
        }

        if (field.pin && !header.hidden) {
            header.classList.add(
                'pisi-sheet-column-pinned'
            );
            header.dataset.pisiSheetPinned = '1';
            header.style.left =
                String(
                    pinLeftByFieldId.get(field.id) || 36
                ) + 'px';

            if (field.id === lastPinnedFieldId) {
                header.classList.add(
                    'pisi-sheet-column-pinned-last'
                );
            }
        }

        headers.push(header);
    });

    headerRow.replaceChildren(...headers);

    let tbody = table.querySelector('tbody');

    if (!tbody) {
        tbody = document.createElement('tbody');
        table.appendChild(tbody);
    }

    const rows = getPisiSheetViewRecords(table).map(
        ({ item, modelIndex: rowIndex }, viewIndex) => {
            const row = document.createElement('tr');
            const rowHeader = document.createElement('th');

            row.dataset.pisiRowId = item.id;
            rowHeader.dataset.rowHeader = String(rowIndex);
            rowHeader.dataset.pisiRowId = item.id;
            rowHeader.textContent = String(rowIndex + 1);
            rowHeader.dataset.pisiViewRow = String(viewIndex);
            row.appendChild(rowHeader);

            fields.forEach((field, colIndex) => {
                const cell = document.createElement('td');
                const record = item.values[field.id] || null;

                cell.setAttribute(
                    'contenteditable',
                    'false'
                );
                cell.setAttribute('tabindex', '-1');
                cell.dataset.row = String(rowIndex);
                cell.dataset.col = String(colIndex);
                cell.dataset.pisiRowId = item.id;
                cell.dataset.pisiColId = field.id;
                cell.dataset.cell =
                    legacyPisiSheetColumnName(colIndex) +
                    String(rowIndex + 1);

                if (field.width) {
                    const size = String(field.width) + 'px';
                    cell.style.width = size;
                    cell.style.minWidth = size;
                    cell.style.maxWidth = size;
                }

                applyPisiSheetCellFormatToDom(
                    cell,
                    record?.format || {}
                );

                cell.style.whiteSpace =
                    field.wrap ? 'normal' : 'nowrap';
                cell.style.overflowWrap =
                    field.wrap ? 'anywhere' : '';

                if (hiddenFieldIds.has(field.id)) {
                    cell.hidden = true;
                }

                if (field.pin && !cell.hidden) {
                    cell.classList.add(
                        'pisi-sheet-column-pinned'
                    );
                    cell.dataset.pisiSheetPinned = '1';
                    cell.style.left =
                        String(
                            pinLeftByFieldId.get(field.id) || 36
                        ) + 'px';

                    if (field.id === lastPinnedFieldId) {
                        cell.classList.add(
                            'pisi-sheet-column-pinned-last'
                        );
                    }
                }

                if (!record?.formula) {
                    renderPisiSheetTypedCell(
                        table,
                        cell,
                        rowIndex,
                        colIndex
                    );
                }

                row.appendChild(cell);
            });

            applyPisiSheetConditionalColorsToRow(
                table,
                row,
                item,
                fields
            );

            return row;
        }
    );

    tbody.replaceChildren(...rows);
    persistPisiSheetDatabase(table);
    return database;
}

function renderPisiSheetCellFromDatabase(
    table,
    rowIndex,
    colIndex,
    displayValue = null
) {
    const database = getPisiSheetDatabase(table);
    const item = database?.items?.[rowIndex];
    const field = database
        ? getPisiSheetOrderedFields(database)[colIndex]
        : null;

    if (!item || !field) return false;

    const cell = table.querySelector(
        'tbody tr[data-pisi-row-id="' +
        item.id +
        '"] td[data-pisi-col-id="' +
        field.id +
        '"]'
    );
    if (!cell) return false;

    const source = getPisiSheetCellSource(
        table,
        rowIndex,
        colIndex
    );

    applyPisiSheetCellFormatToDom(
        cell,
        source.format
    );

    renderPisiSheetTypedCell(
        table,
        cell,
        rowIndex,
        colIndex,
        displayValue === null
            ? (
                source.formula
                    ? ''
                    : source.value
            )
            : displayValue
    );

    const row = cell.closest('tr');
    if (row) {
        applyPisiSheetConditionalColorsToRow(
            table,
            row,
            item,
            getPisiSheetOrderedFields(database)
        );
    }

    return true;
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "capturePisiSheetCellFormat": {
        enumerable: true,
        get() { return capturePisiSheetCellFormat; }
    },
    "applyPisiSheetCellFormatToDom": {
        enumerable: true,
        get() { return applyPisiSheetCellFormatToDom; }
    },
    "hydratePisiSheetDatabase": {
        enumerable: true,
        get() { return hydratePisiSheetDatabase; }
    },
    "renderPisiSheetDatabase": {
        enumerable: true,
        get() { return renderPisiSheetDatabase; }
    },
    "renderPisiSheetCellFromDatabase": {
        enumerable: true,
        get() { return renderPisiSheetCellFromDatabase; }
    }
});
registerModule("editor.sheetDatabaseDom", moduleApi);
