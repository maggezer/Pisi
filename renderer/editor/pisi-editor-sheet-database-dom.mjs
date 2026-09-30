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
            : null;
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

        headers.push(header);
    });

    headerRow.replaceChildren(...headers);

    let tbody = table.querySelector('tbody');

    if (!tbody) {
        tbody = document.createElement('tbody');
        table.appendChild(tbody);
    }

    const rows = database.items.map(
        (item, rowIndex) => {
            const row = document.createElement('tr');
            const rowHeader = document.createElement('th');

            row.dataset.pisiRowId = item.id;
            rowHeader.dataset.rowHeader = String(rowIndex);
            rowHeader.dataset.pisiRowId = item.id;
            rowHeader.textContent = String(rowIndex + 1);
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

                if (!record?.formula) {
                    cell.textContent = String(
                        record?.value ?? ''
                    );
                }

                row.appendChild(cell);
            });

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
    const cell = table.tBodies?.[0]
        ?.rows?.[rowIndex]
        ?.cells?.[colIndex + 1];
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

    cell.textContent = displayValue === null
        ? (
            source.formula
                ? ''
                : source.value
        )
        : String(displayValue);

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
