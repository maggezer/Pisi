import { registerModule } from "../core/module-registry.mjs";
import {
    makePisiSheetEmptyFilterTree
} from "./pisi-editor-sheet-view-query-core.mjs";

function createPisiSheetViewId() {
    const uuid = globalThis.crypto?.randomUUID?.();

    return uuid
        ? 'view-' + uuid
        : (
            'view-' +
            Date.now().toString(36) + '-' +
            Math.random().toString(36).slice(2, 10)
        );
}

function clonePisiSheetTableView(
    table,
    name = ''
) {
    const database = getPisiSheetDatabase(table);
    const active = database
        ? getPisiSheetTableView(database)
        : null;

    if (!database || !active) return null;

    const view = {
        id: createPisiSheetViewId(),
        type: 'table',
        name: String(
            name ||
            active.name ||
            'Table'
        ).slice(0, 80),
        fieldOrder: [...active.fieldOrder],
        hiddenFieldIds: [
            ...(active.hiddenFieldIds || [])
        ],
        filters: structuredClone(
            active.filters || makePisiSheetEmptyFilterTree()
        ),
        sorts: Array.isArray(active.sorts)
            ? structuredClone(active.sorts)
            : []
    };

    database.views.push(view);
    persistPisiSheetDatabase(table);
    return view;
}

function setPisiSheetActiveView(table, viewId) {
    const database = getPisiSheetDatabase(table);
    if (!database) return null;

    const view = database.views.find(
        (candidate) => (
            candidate.type === 'table' &&
            candidate.id === viewId
        )
    );

    if (!view) return null;

    database.activeViewId = view.id;
    persistPisiSheetDatabase(table);
    return view;
}

function refreshPisiSheetActiveView(table) {
    return refreshPisiSheetViewQuery(table);
}

function activatePisiSheetView(table, viewId) {
    const view = setPisiSheetActiveView(
        table,
        viewId
    );

    if (!view) return null;

    refreshPisiSheetActiveView(table);
    return view;
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "clonePisiSheetTableView": {
        enumerable: true,
        get() { return clonePisiSheetTableView; }
    },
    "setPisiSheetActiveView": {
        enumerable: true,
        get() { return setPisiSheetActiveView; }
    },
    "refreshPisiSheetActiveView": {
        enumerable: true,
        get() { return refreshPisiSheetActiveView; }
    },
    "activatePisiSheetView": {
        enumerable: true,
        get() { return activatePisiSheetView; }
    }
});
registerModule("editor.sheetViewState", moduleApi);
