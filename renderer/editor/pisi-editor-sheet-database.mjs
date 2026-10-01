import { registerModule } from "../core/module-registry.mjs";
import {
    transformPisiSheetFormulaReferences
} from "./pisi-editor-sheet-model.mjs";
import {
    isPisiSheetEmptyStoredValue,
    normalizePisiSheetFieldOptions,
    normalizePisiSheetFieldType,
    normalizePisiSheetNumberFormat,
    normalizePisiSheetStoredValue
} from "./pisi-editor-sheet-field-types-core.mjs";
import {
    normalizePisiSheetPaginationConfig
} from "./pisi-editor-sheet-pagination-core.mjs";
import {
    makePisiSheetEmptyFilterTree,
    normalizePisiSheetFilterTree,
    normalizePisiSheetConditionalColors,
    normalizePisiSheetSorts
} from "./pisi-editor-sheet-view-query-core.mjs";

const PISI_SHEET_DATABASE_VERSION = 1;
const PISI_SHEET_DEFAULT_COLUMN_WIDTH = 96;
const pisiSheetDatabases = new WeakMap();

const PISI_SHEET_FORMAT_PROPERTIES = [
    'fontWeight',
    'fontStyle',
    'textDecorationLine',
    'fontFamily',
    'fontSize',
    'textAlign',
    'verticalAlign',
    'whiteSpace',
    'overflowWrap',
    'border',
    'color',
    'backgroundColor'
];

function createPisiSheetDatabaseId(prefix) {
    const uuid = globalThis.crypto?.randomUUID?.();

    if (uuid) return prefix + '-' + uuid;

    return (
        prefix + '-' +
        Date.now().toString(36) + '-' +
        Math.random().toString(36).slice(2, 10)
    );
}

function pisiSheetDatabaseColumnName(index) {
    let name = '';
    let value = Number(index) + 1;

    while (value > 0) {
        const remainder = (value - 1) % 26;
        name = String.fromCharCode(65 + remainder) + name;
        value = Math.floor((value - 1) / 26);
    }

    return name;
}

function createPisiSheetField(index, options = {}) {
    return {
        id: String(
            options.id ||
            createPisiSheetDatabaseId('field')
        ),
        name: String(
            options.name ||
            pisiSheetDatabaseColumnName(index)
        ).slice(0, 80),
        type: normalizePisiSheetFieldType(
            options.type || 'text'
        ),
        description: String(options.description || '').slice(0, 240),
        icon: String(options.icon || '').trim().slice(0, 12),
        options: normalizePisiSheetFieldOptions(
            options.options
        ),
        numberFormat: normalizePisiSheetNumberFormat(
            options.numberFormat
        ),
        wrap: options.wrap === true,
        pin: options.pin === true,
        width:
            options.width !== null &&
            options.width !== undefined &&
            Number.isFinite(Number(options.width)) &&
            Number(options.width) > 0
                ? Math.max(
                    25,
                    Math.round(Number(options.width))
                )
                : PISI_SHEET_DEFAULT_COLUMN_WIDTH
    };
}

function createPisiSheetItem(options = {}) {
    return {
        id: String(
            options.id ||
            createPisiSheetDatabaseId('item')
        ),
        values:
            options.values &&
            typeof options.values === 'object'
                ? options.values
                : {}
    };
}

function createPisiSheetTableView(fields, options = {}) {
    const pagination =
        normalizePisiSheetPaginationConfig(options);

    return {
        id: String(
            options.id ||
            createPisiSheetDatabaseId('view')
        ),
        type: 'table',
        name: String(options.name || 'Table'),
        fieldOrder: fields.map((field) => field.id),
        hiddenFieldIds: [],
        filters: makePisiSheetEmptyFilterTree(),
        sorts: [],
        conditionalColors: [],
        searchQuery: String(
            options.searchQuery || ''
        ).slice(0, 240),
        page: pagination.page,
        pageSize: pagination.pageSize,
        virtualScroll: pagination.virtualScroll
    };
}

function createPisiSheetDatabase(rows = 5, cols = 5, options = {}) {
    const rowCount = Math.max(1, Number(rows) || 1);
    const colCount = Math.max(1, Number(cols) || 1);
    const fields = Array.from(
        { length: colCount },
        (_, index) => createPisiSheetField(index)
    );
    const items = Array.from(
        { length: rowCount },
        () => createPisiSheetItem()
    );
    const view = createPisiSheetTableView(fields);

    return {
        version: PISI_SHEET_DATABASE_VERSION,
        databaseId: createPisiSheetDatabaseId('database'),
        title: String(options.title || 'Sheet').trim().slice(0, 80) || 'Sheet',
        collapsed: options.collapsed === true,
        fields,
        items,
        views: [view],
        activeViewId: view.id
    };
}

function normalizePisiSheetCellRecord(record) {
    if (!record || typeof record !== 'object') {
        return null;
    }

    const value = normalizePisiSheetStoredValue(
        record.value
    );
    const formula = record.formula
        ? String(record.formula)
        : null;
    const format = {};

    if (
        record.format &&
        typeof record.format === 'object'
    ) {
        for (const property of PISI_SHEET_FORMAT_PROPERTIES) {
            const styleValue = record.format[property];

            if (
                typeof styleValue === 'string' &&
                styleValue
            ) {
                format[property] = styleValue;
            }
        }
    }

    if (
        isPisiSheetEmptyStoredValue(value) &&
        !formula &&
        Object.keys(format).length === 0
    ) {
        return null;
    }

    return { value, formula, format };
}

function normalizePisiSheetDatabase(database) {
    if (!database || typeof database !== 'object') {
        return null;
    }

    const rawFields = Array.isArray(database.fields)
        ? database.fields
        : [];
    const fields = rawFields.map((field, index) => {
        return createPisiSheetField(index, {
            id: field?.id,
            name: field?.name,
            type: field?.type,
            description: field?.description,
            icon: field?.icon,
            options: field?.options,
            numberFormat: field?.numberFormat,
            wrap: field?.wrap,
            pin: field?.pin,
            width: field?.width
        });
    });

    if (!fields.length) {
        fields.push(createPisiSheetField(0));
    }

    const fieldIds = new Set(fields.map((field) => field.id));
    const rawItems = Array.isArray(database.items)
        ? database.items
        : [];
    const items = rawItems.map((item) => {
        const values = {};

        if (
            item?.values &&
            typeof item.values === 'object'
        ) {
            for (const [fieldId, record] of Object.entries(
                item.values
            )) {
                if (!fieldIds.has(fieldId)) continue;

                const normalized =
                    normalizePisiSheetCellRecord(record);

                if (normalized) {
                    values[fieldId] = normalized;
                }
            }
        }

        return createPisiSheetItem({
            id: item?.id,
            values
        });
    });

    if (!items.length) {
        items.push(createPisiSheetItem());
    }

    const rawViews = Array.isArray(database.views)
        ? database.views
        : [];
    const views = rawViews
        .filter((view) => view?.type === 'table')
        .map((view) => {
            const ordered = Array.isArray(view.fieldOrder)
                ? view.fieldOrder.filter(
                    (id) => fieldIds.has(id)
                )
                : [];
            const missing = fields
                .map((field) => field.id)
                .filter((id) => !ordered.includes(id));

            const pagination =
                normalizePisiSheetPaginationConfig(view);

            return {
                id: String(
                    view.id ||
                    createPisiSheetDatabaseId('view')
                ),
                type: 'table',
                name: String(view.name || 'Table'),
                fieldOrder: [...ordered, ...missing],
                hiddenFieldIds: Array.isArray(
                    view.hiddenFieldIds
                )
                    ? view.hiddenFieldIds.filter(
                        (id) => fieldIds.has(id)
                    )
                    : [],
                filters: normalizePisiSheetFilterTree(
                    view.filters,
                    fieldIds
                ),
                sorts: normalizePisiSheetSorts(
                    view.sorts,
                    fieldIds
                ),
                conditionalColors:
                    normalizePisiSheetConditionalColors(
                        view.conditionalColors,
                        fields
                    ),
                searchQuery: String(
                    view.searchQuery || ''
                ).slice(0, 240),
                page: pagination.page,
                pageSize: pagination.pageSize,
                virtualScroll:
                    pagination.virtualScroll
            };
        });

    if (!views.length) {
        views.push(createPisiSheetTableView(fields));
    }

    const activeView = views.find(
        (view) => view.id === database.activeViewId
    ) || views[0];

    return {
        version: PISI_SHEET_DATABASE_VERSION,
        databaseId: String(
            database.databaseId ||
            createPisiSheetDatabaseId('database')
        ),
        title: String(database.title || 'Sheet').trim().slice(0, 80) || 'Sheet',
        collapsed: database.collapsed === true,
        fields,
        items,
        views,
        activeViewId: activeView.id
    };
}

function attachPisiSheetDatabase(table, database) {
    const normalized = normalizePisiSheetDatabase(database);
    if (!table || !normalized) return null;

    pisiSheetDatabases.set(table, normalized);
    return normalized;
}

function getPisiSheetDatabase(table) {
    return pisiSheetDatabases.get(table) || null;
}

function requirePisiSheetDatabase(table) {
    const database = getPisiSheetDatabase(table);

    if (!database) {
        throw new Error(
            '[PISI] Sheet database is not hydrated.'
        );
    }

    return database;
}

function persistPisiSheetDatabase(table) {
    const database = getPisiSheetDatabase(table);
    if (!table || !database) return false;

    table.dataset.pisiDatabaseId = database.databaseId;
    table.dataset.pisiSheetModel = JSON.stringify(database);

    delete table.dataset.pisiColumnIds;
    delete table.dataset.pisiColumnLabels;
    delete table.dataset.pisiColumnWidths;

    return true;
}

function getPisiSheetTableView(database) {
    return (
        database.views.find(
            (view) => view.id === database.activeViewId
        ) ||
        database.views.find(
            (view) => view.type === 'table'
        ) ||
        database.views[0]
    );
}

function getPisiSheetOrderedFields(database) {
    const view = getPisiSheetTableView(database);
    const byId = new Map(
        database.fields.map((field) => [field.id, field])
    );

    return view.fieldOrder
        .map((id) => byId.get(id))
        .filter(Boolean);
}

function getPisiSheetDatabaseDimensions(table) {
    const database = requirePisiSheetDatabase(table);

    return {
        rows: database.items.length,
        cols: getPisiSheetOrderedFields(database).length
    };
}

function getPisiSheetField(table, colIndex) {
    const database = requirePisiSheetDatabase(table);
    return getPisiSheetOrderedFields(database)[colIndex] || null;
}

function getPisiSheetItem(table, rowIndex) {
    const database = requirePisiSheetDatabase(table);
    return database.items[rowIndex] || null;
}

function getPisiSheetCellRecord(
    table,
    rowIndex,
    colIndex,
    create = false
) {
    const item = getPisiSheetItem(table, rowIndex);
    const field = getPisiSheetField(table, colIndex);

    if (!item || !field) return null;

    let record = item.values[field.id] || null;

    if (!record && create) {
        record = {
            value: '',
            formula: null,
            format: {}
        };
        item.values[field.id] = record;
    }

    return record;
}

function getPisiSheetCellSource(table, rowIndex, colIndex) {
    const record = getPisiSheetCellRecord(
        table,
        rowIndex,
        colIndex,
        false
    );

    return {
        value: normalizePisiSheetStoredValue(
            record?.value
        ),
        formula: record?.formula
            ? String(record.formula)
            : null,
        format: record?.format || {}
    };
}

function compactPisiSheetCellRecord(
    table,
    rowIndex,
    colIndex
) {
    const item = getPisiSheetItem(table, rowIndex);
    const field = getPisiSheetField(table, colIndex);
    if (!item || !field) return;

    const normalized = normalizePisiSheetCellRecord(
        item.values[field.id]
    );

    if (normalized) {
        item.values[field.id] = normalized;
    } else {
        delete item.values[field.id];
    }
}

function setPisiSheetCellSource(
    table,
    rowIndex,
    colIndex,
    source = {}
) {
    const record = getPisiSheetCellRecord(
        table,
        rowIndex,
        colIndex,
        true
    );
    if (!record) return false;

    record.value = normalizePisiSheetStoredValue(
        source.value
    );
    record.formula = source.formula
        ? String(source.formula)
        : null;

    compactPisiSheetCellRecord(table, rowIndex, colIndex);
    persistPisiSheetDatabase(table);
    return true;
}

export function setPisiSheetCellRecordsBatch(
    table,
    changes = []
) {
    const database = requirePisiSheetDatabase(table);
    const fields = getPisiSheetOrderedFields(database);
    let changed = false;

    for (const change of Array.isArray(changes) ? changes : []) {
        const rowIndex = Number(change?.row);
        const colIndex = Number(change?.col);
        const item = database.items[rowIndex];
        const field = fields[colIndex];

        if (
            !Number.isInteger(rowIndex) ||
            !Number.isInteger(colIndex) ||
            !item ||
            !field
        ) {
            continue;
        }

        const normalized = normalizePisiSheetCellRecord({
            value: change?.value,
            formula: change?.formula,
            format:
                change?.format &&
                typeof change.format === 'object'
                    ? structuredClone(change.format)
                    : {}
        });

        if (normalized) {
            item.values[field.id] = normalized;
        } else {
            delete item.values[field.id];
        }

        changed = true;
    }

    if (changed) {
        persistPisiSheetDatabase(table);
    }

    return changed;
}

function setPisiSheetCellFormat(
    table,
    rowIndex,
    colIndex,
    format = {}
) {
    const record = getPisiSheetCellRecord(
        table,
        rowIndex,
        colIndex,
        true
    );
    if (!record) return false;

    record.format = {};

    for (const property of PISI_SHEET_FORMAT_PROPERTIES) {
        const value = format[property];

        if (typeof value === 'string' && value) {
            record.format[property] = value;
        }
    }

    compactPisiSheetCellRecord(table, rowIndex, colIndex);
    persistPisiSheetDatabase(table);
    return true;
}

function clearPisiSheetCell(table, rowIndex, colIndex) {
    const item = getPisiSheetItem(table, rowIndex);
    const field = getPisiSheetField(table, colIndex);

    if (!item || !field) return false;

    const record = item.values[field.id];

    if (
        record?.format &&
        Object.keys(record.format).length
    ) {
        item.values[field.id] = {
            value: '',
            formula: null,
            format: record.format
        };
    } else {
        delete item.values[field.id];
    }

    persistPisiSheetDatabase(table);
    return true;
}

function renamePisiSheetField(table, colIndex, name) {
    const field = getPisiSheetField(table, colIndex);
    if (!field) return null;

    const fallback = pisiSheetDatabaseColumnName(colIndex);
    field.name =
        String(name || '').trim().slice(0, 80) ||
        fallback;

    persistPisiSheetDatabase(table);
    return field.name;
}

function setPisiSheetFieldWidth(table, colIndex, width) {
    const field = getPisiSheetField(table, colIndex);
    if (!field) return false;

    const numeric = Number(width);
    field.width =
        Number.isFinite(numeric) && numeric > 0
            ? Math.round(numeric)
            : null;

    persistPisiSheetDatabase(table);
    return true;
}

function updatePisiSheetField(table, colIndex, patch = {}) {
    const field = getPisiSheetField(table, colIndex);
    if (!field || !patch || typeof patch !== 'object') {
        return null;
    }

    const nextPatch =
        /** @type {Record<string, any>} */ (patch);

    if (Object.hasOwn(nextPatch, 'name')) {
        field.name =
            String(nextPatch.name || '').trim().slice(0, 80) ||
            pisiSheetDatabaseColumnName(colIndex);
    }

    if (Object.hasOwn(nextPatch, 'description')) {
        field.description = String(
            nextPatch.description || ''
        ).slice(0, 240);
    }

    if (Object.hasOwn(nextPatch, 'icon')) {
        field.icon = String(
            nextPatch.icon || ''
        ).trim().slice(0, 12);
    }

    if (Object.hasOwn(nextPatch, 'type')) {
        field.type = normalizePisiSheetFieldType(
            nextPatch.type
        );
    }

    if (Object.hasOwn(nextPatch, 'options')) {
        field.options = normalizePisiSheetFieldOptions(
            nextPatch.options
        );
    }

    if (Object.hasOwn(nextPatch, 'numberFormat')) {
        field.numberFormat = normalizePisiSheetNumberFormat(
            nextPatch.numberFormat
        );
    }

    if (Object.hasOwn(nextPatch, 'wrap')) {
        field.wrap = nextPatch.wrap === true;
    }

    if (Object.hasOwn(nextPatch, 'pin')) {
        field.pin = nextPatch.pin === true;
    }

    persistPisiSheetDatabase(table);
    return field;
}

function isPisiSheetFieldHidden(table, colIndex) {
    const database = requirePisiSheetDatabase(table);
    const field = getPisiSheetField(table, colIndex);
    const view = getPisiSheetTableView(database);

    return Boolean(
        field &&
        view?.hiddenFieldIds?.includes(field.id)
    );
}

function setPisiSheetFieldHidden(
    table,
    colIndex,
    hidden = true
) {
    const database = requirePisiSheetDatabase(table);
    const field = getPisiSheetField(table, colIndex);
    const view = getPisiSheetTableView(database);

    if (!field || !view) return false;

    const next = new Set(view.hiddenFieldIds || []);

    if (hidden) {
        next.add(field.id);
    } else {
        next.delete(field.id);
    }

    view.hiddenFieldIds = [...next];
    persistPisiSheetDatabase(table);
    return true;
}


function insertPisiSheetItem(table, index) {
    const database = requirePisiSheetDatabase(table);
    const insertIndex = Math.max(
        0,
        Math.min(
            database.items.length,
            Number(index) || 0
        )
    );

    database.items.splice(
        insertIndex,
        0,
        createPisiSheetItem()
    );

    persistPisiSheetDatabase(table);
    return database.items[insertIndex];
}

function deletePisiSheetItems(table, index, count = 1) {
    const database = requirePisiSheetDatabase(table);
    const start = Math.max(0, Number(index) || 0);
    const amount = Math.max(1, Number(count) || 1);

    database.items.splice(start, amount);

    if (!database.items.length) {
        database.items.push(createPisiSheetItem());
    }

    persistPisiSheetDatabase(table);
    return true;
}

function insertPisiSheetField(table, index) {
    const database = requirePisiSheetDatabase(table);
    const view = getPisiSheetTableView(database);
    const insertIndex = Math.max(
        0,
        Math.min(
            view.fieldOrder.length,
            Number(index) || 0
        )
    );
    const field = createPisiSheetField(insertIndex);

    database.fields.push(field);
    view.fieldOrder.splice(insertIndex, 0, field.id);

    persistPisiSheetDatabase(table);
    return field;
}

function deletePisiSheetFields(table, index, count = 1) {
    const database = requirePisiSheetDatabase(table);
    const view = getPisiSheetTableView(database);
    const start = Math.max(0, Number(index) || 0);
    const amount = Math.max(1, Number(count) || 1);
    const removedIds = view.fieldOrder.splice(
        start,
        amount
    );
    const removed = new Set(removedIds);

    view.hiddenFieldIds = (view.hiddenFieldIds || [])
        .filter((fieldId) => !removed.has(fieldId));

    database.fields = database.fields.filter(
        (field) => !removed.has(field.id)
    );

    for (const tableView of database.views) {
        tableView.conditionalColors =
            normalizePisiSheetConditionalColors(
                tableView.conditionalColors,
                database.fields
            );
    }

    for (const item of database.items) {
        for (const fieldId of removedIds) {
            delete item.values[fieldId];
        }
    }

    if (!view.fieldOrder.length) {
        const field = createPisiSheetField(0);
        database.fields.push(field);
        view.fieldOrder.push(field.id);
    }

    persistPisiSheetDatabase(table);
    return true;
}

function transformPisiSheetDatabaseFormulas(table, change) {
    const database = requirePisiSheetDatabase(table);

    for (const item of database.items) {
        for (const record of Object.values(item.values)) {
            if (!record?.formula) continue;

            record.formula =
                transformPisiSheetFormulaReferences(
                    record.formula,
                    change
                );
        }
    }

    persistPisiSheetDatabase(table);
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "PISI_SHEET_DATABASE_VERSION": {
        enumerable: true,
        get() { return PISI_SHEET_DATABASE_VERSION; }
    },
    "PISI_SHEET_DEFAULT_COLUMN_WIDTH": {
        enumerable: true,
        get() { return PISI_SHEET_DEFAULT_COLUMN_WIDTH; }
    },
    "PISI_SHEET_FORMAT_PROPERTIES": {
        enumerable: true,
        get() { return PISI_SHEET_FORMAT_PROPERTIES; }
    },
    "pisiSheetDatabases": {
        enumerable: true,
        get() { return pisiSheetDatabases; }
    },
    "createPisiSheetDatabase": {
        enumerable: true,
        get() { return createPisiSheetDatabase; }
    },
    "normalizePisiSheetDatabase": {
        enumerable: true,
        get() { return normalizePisiSheetDatabase; }
    },
    "attachPisiSheetDatabase": {
        enumerable: true,
        get() { return attachPisiSheetDatabase; }
    },
    "getPisiSheetDatabase": {
        enumerable: true,
        get() { return getPisiSheetDatabase; }
    },
    "persistPisiSheetDatabase": {
        enumerable: true,
        get() { return persistPisiSheetDatabase; }
    },
    "getPisiSheetTableView": {
        enumerable: true,
        get() { return getPisiSheetTableView; }
    },
    "getPisiSheetOrderedFields": {
        enumerable: true,
        get() { return getPisiSheetOrderedFields; }
    },
    "getPisiSheetDatabaseDimensions": {
        enumerable: true,
        get() { return getPisiSheetDatabaseDimensions; }
    },
    "getPisiSheetField": {
        enumerable: true,
        get() { return getPisiSheetField; }
    },
    "getPisiSheetItem": {
        enumerable: true,
        get() { return getPisiSheetItem; }
    },
    "getPisiSheetCellSource": {
        enumerable: true,
        get() { return getPisiSheetCellSource; }
    },
    "setPisiSheetCellSource": {
        enumerable: true,
        get() { return setPisiSheetCellSource; }
    },
    "setPisiSheetCellFormat": {
        enumerable: true,
        get() { return setPisiSheetCellFormat; }
    },
    "clearPisiSheetCell": {
        enumerable: true,
        get() { return clearPisiSheetCell; }
    },
    "renamePisiSheetField": {
        enumerable: true,
        get() { return renamePisiSheetField; }
    },
    "setPisiSheetFieldWidth": {
        enumerable: true,
        get() { return setPisiSheetFieldWidth; }
    },
    "updatePisiSheetField": {
        enumerable: true,
        get() { return updatePisiSheetField; }
    },
    "isPisiSheetFieldHidden": {
        enumerable: true,
        get() { return isPisiSheetFieldHidden; }
    },
    "setPisiSheetFieldHidden": {
        enumerable: true,
        get() { return setPisiSheetFieldHidden; }
    },
    "insertPisiSheetItem": {
        enumerable: true,
        get() { return insertPisiSheetItem; }
    },
    "deletePisiSheetItems": {
        enumerable: true,
        get() { return deletePisiSheetItems; }
    },
    "insertPisiSheetField": {
        enumerable: true,
        get() { return insertPisiSheetField; }
    },
    "deletePisiSheetFields": {
        enumerable: true,
        get() { return deletePisiSheetFields; }
    },
    "transformPisiSheetDatabaseFormulas": {
        enumerable: true,
        get() { return transformPisiSheetDatabaseFormulas; }
    }
});
registerModule("editor.sheetDatabase", moduleApi);
