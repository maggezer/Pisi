import { registerModule } from "../core/module-registry.mjs";

const pisiSheetSelections = new Map();
const pisiSheetHeaderSelections = new Map();

let pisiActiveSheetGroupId = null;

function getPisiSheetSelectionGroupIdFromDatabase(database) {
    return String(database?.databaseId || '');
}

function storePisiSheetSelectionPoint(point) {
    if (
        !point?.groupId ||
        !point?.rowId ||
        !point?.colId
    ) {
        return null;
    }

    return {
        groupId: point.groupId,
        rowId: point.rowId,
        colId: point.colId
    };
}

function resolvePisiSheetSelectionPoint(database, point) {
    if (!database || !point) return null;

    const groupId =
        getPisiSheetSelectionGroupIdFromDatabase(database);

    if (
        !groupId ||
        point.groupId !== groupId ||
        !point.rowId ||
        !point.colId
    ) {
        return null;
    }

    const row = database.items.findIndex(
        (item) => item.id === point.rowId
    );
    const fields = getPisiSheetOrderedFields(database);
    const col = fields.findIndex(
        (field) => field.id === point.colId
    );

    if (row < 0 || col < 0) return null;

    return {
        groupId,
        rowId: point.rowId,
        colId: point.colId,
        row,
        col
    };
}

function getPisiSheetPointByIndexFromDatabase(
    database,
    row,
    col
) {
    if (
        !database ||
        !Number.isInteger(row) ||
        !Number.isInteger(col) ||
        row < 0 ||
        col < 0
    ) {
        return null;
    }

    const item = database.items[row];
    const field = getPisiSheetOrderedFields(database)[col];

    if (!item || !field) return null;

    return {
        groupId: database.databaseId,
        rowId: item.id,
        colId: field.id,
        row,
        col
    };
}

function getPisiSheetSelectionStateForDatabase(database) {
    const groupId =
        getPisiSheetSelectionGroupIdFromDatabase(database);

    return groupId
        ? pisiSheetSelections.get(groupId) || null
        : null;
}

function setPisiSheetSelectionStateForDatabase(
    database,
    selection
) {
    const groupId =
        getPisiSheetSelectionGroupIdFromDatabase(database);

    if (!groupId || !selection) return null;

    const anchor = resolvePisiSheetSelectionPoint(
        database,
        {
            ...selection.anchor,
            groupId
        }
    );
    const focus = resolvePisiSheetSelectionPoint(
        database,
        {
            ...selection.focus,
            groupId
        }
    );
    const active = resolvePisiSheetSelectionPoint(
        database,
        {
            ...(selection.active || selection.focus),
            groupId
        }
    );

    if (!anchor || !focus || !active) return null;

    const state = {
        groupId,
        mode: selection.mode || 'cell',
        anchor: storePisiSheetSelectionPoint(anchor),
        focus: storePisiSheetSelectionPoint(focus),
        active: storePisiSheetSelectionPoint(active)
    };

    pisiSheetHeaderSelections.delete(groupId);
    pisiSheetSelections.set(groupId, state);
    pisiActiveSheetGroupId = groupId;

    return state;
}

function clearPisiSheetSelectionStateForDatabase(database) {
    const groupId =
        getPisiSheetSelectionGroupIdFromDatabase(database);

    if (!groupId) return false;

    const removed = pisiSheetSelections.delete(groupId);

    if (
        pisiActiveSheetGroupId === groupId &&
        !pisiSheetHeaderSelections.has(groupId)
    ) {
        pisiActiveSheetGroupId = null;
    }

    return removed;
}

function getPisiSheetSelectionForDatabase(database) {
    const selection =
        getPisiSheetSelectionStateForDatabase(database);

    if (!selection) return null;

    const anchor = resolvePisiSheetSelectionPoint(
        database,
        selection.anchor
    );
    const focus = resolvePisiSheetSelectionPoint(
        database,
        selection.focus
    );
    const active = resolvePisiSheetSelectionPoint(
        database,
        selection.active || selection.focus
    );

    if (!anchor || !focus || !active) {
        clearPisiSheetSelectionStateForDatabase(database);
        return null;
    }

    return {
        groupId: selection.groupId,
        mode: selection.mode || 'cell',
        anchor,
        focus,
        active
    };
}

function getPisiSheetSelectionFocusForDatabase(database) {
    return (
        getPisiSheetSelectionForDatabase(database)
            ?.focus ||
        null
    );
}

function getPisiSheetActivePointForDatabase(database) {
    return (
        getPisiSheetSelectionForDatabase(database)
            ?.active ||
        null
    );
}

function getPisiSheetSelectionRect(anchor, focus) {
    if (!anchor || !focus) return null;

    return {
        rowStart: Math.min(anchor.row, focus.row),
        rowEnd: Math.max(anchor.row, focus.row),
        colStart: Math.min(anchor.col, focus.col),
        colEnd: Math.max(anchor.col, focus.col)
    };
}

function getPisiSelectedSheetPointsForDatabase(database) {
    const selection =
        getPisiSheetSelectionForDatabase(database);

    if (!selection) return [];

    const rect = getPisiSheetSelectionRect(
        selection.anchor,
        selection.focus
    );

    if (!rect) return [];

    const points = [];

    for (
        let row = rect.rowStart;
        row <= rect.rowEnd;
        row += 1
    ) {
        for (
            let col = rect.colStart;
            col <= rect.colEnd;
            col += 1
        ) {
            const point =
                getPisiSheetPointByIndexFromDatabase(
                    database,
                    row,
                    col
                );

            if (point) {
                points.push(point);
            }
        }
    }

    return points;
}

function getPisiSheetHeaderSelectionStateForDatabase(
    database
) {
    const groupId =
        getPisiSheetSelectionGroupIdFromDatabase(database);

    return groupId
        ? pisiSheetHeaderSelections.get(groupId) || null
        : null;
}

function setPisiSheetHeaderSelectionStateForDatabase(
    database,
    selection
) {
    const groupId =
        getPisiSheetSelectionGroupIdFromDatabase(database);

    if (
        !groupId ||
        !selection ||
        !['row', 'column'].includes(selection.mode)
    ) {
        return null;
    }

    const mode = selection.mode;
    let anchorId = '';
    let focusId = '';

    if (mode === 'row') {
        anchorId = String(selection.anchorId || '');
        focusId = String(selection.focusId || '');

        if (
            !database.items.some((item) => item.id === anchorId) ||
            !database.items.some((item) => item.id === focusId)
        ) {
            return null;
        }
    } else {
        const fields = getPisiSheetOrderedFields(database);
        anchorId = String(selection.anchorId || '');
        focusId = String(selection.focusId || '');

        if (
            !fields.some((field) => field.id === anchorId) ||
            !fields.some((field) => field.id === focusId)
        ) {
            return null;
        }
    }

    const state = {
        groupId,
        mode,
        anchorId,
        focusId
    };

    pisiSheetSelections.delete(groupId);
    pisiSheetHeaderSelections.set(groupId, state);
    pisiActiveSheetGroupId = groupId;

    return state;
}

function clearPisiSheetHeaderSelectionStateForDatabase(database) {
    const groupId =
        getPisiSheetSelectionGroupIdFromDatabase(database);

    if (!groupId) return false;

    const removed = pisiSheetHeaderSelections.delete(groupId);

    if (
        removed &&
        pisiActiveSheetGroupId === groupId &&
        !pisiSheetSelections.has(groupId)
    ) {
        pisiActiveSheetGroupId = null;
    }

    return removed;
}

function getPisiSheetHeaderSelectionForDatabase(database) {
    const state =
        getPisiSheetHeaderSelectionStateForDatabase(database);

    if (!state) return null;

    if (state.mode === 'row') {
        const anchorRow = database.items.findIndex(
            (item) => item.id === state.anchorId
        );
        const focusRow = database.items.findIndex(
            (item) => item.id === state.focusId
        );
        const fields = getPisiSheetOrderedFields(database);

        if (
            anchorRow < 0 ||
            focusRow < 0 ||
            !fields.length
        ) {
            clearPisiSheetHeaderSelectionStateForDatabase(
                database
            );
            return null;
        }

        return {
            groupId: state.groupId,
            mode: 'row',
            anchor: getPisiSheetPointByIndexFromDatabase(
                database,
                anchorRow,
                0
            ),
            focus: getPisiSheetPointByIndexFromDatabase(
                database,
                focusRow,
                fields.length - 1
            ),
            active: getPisiSheetPointByIndexFromDatabase(
                database,
                focusRow,
                fields.length - 1
            ),
            anchorId: state.anchorId,
            focusId: state.focusId
        };
    }

    const fields = getPisiSheetOrderedFields(database);
    const anchorCol = fields.findIndex(
        (field) => field.id === state.anchorId
    );
    const focusCol = fields.findIndex(
        (field) => field.id === state.focusId
    );

    if (
        anchorCol < 0 ||
        focusCol < 0 ||
        !database.items.length
    ) {
        clearPisiSheetHeaderSelectionStateForDatabase(
            database
        );
        return null;
    }

    return {
        groupId: state.groupId,
        mode: 'column',
        anchor: getPisiSheetPointByIndexFromDatabase(
            database,
            0,
            anchorCol
        ),
        focus: getPisiSheetPointByIndexFromDatabase(
            database,
            database.items.length - 1,
            focusCol
        ),
        active: getPisiSheetPointByIndexFromDatabase(
            database,
            database.items.length - 1,
            focusCol
        ),
        anchorId: state.anchorId,
        focusId: state.focusId
    };
}

function clearPisiSheetAllSelectionStateForDatabase(database) {
    const cellCleared =
        clearPisiSheetSelectionStateForDatabase(database);
    const headerCleared =
        clearPisiSheetHeaderSelectionStateForDatabase(database);

    return cellCleared || headerCleared;
}

function getPisiSheetActiveGroupId() {
    return pisiActiveSheetGroupId;
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "pisiSheetSelections": {
        enumerable: true,
        get() { return pisiSheetSelections; }
    },
    "pisiSheetHeaderSelections": {
        enumerable: true,
        get() { return pisiSheetHeaderSelections; }
    },
    "getPisiSheetSelectionGroupIdFromDatabase": {
        enumerable: true,
        get() {
            return getPisiSheetSelectionGroupIdFromDatabase;
        }
    },
    "resolvePisiSheetSelectionPoint": {
        enumerable: true,
        get() { return resolvePisiSheetSelectionPoint; }
    },
    "getPisiSheetPointByIndexFromDatabase": {
        enumerable: true,
        get() {
            return getPisiSheetPointByIndexFromDatabase;
        }
    },
    "getPisiSheetSelectionStateForDatabase": {
        enumerable: true,
        get() {
            return getPisiSheetSelectionStateForDatabase;
        }
    },
    "setPisiSheetSelectionStateForDatabase": {
        enumerable: true,
        get() {
            return setPisiSheetSelectionStateForDatabase;
        }
    },
    "clearPisiSheetSelectionStateForDatabase": {
        enumerable: true,
        get() {
            return clearPisiSheetSelectionStateForDatabase;
        }
    },
    "getPisiSheetSelectionForDatabase": {
        enumerable: true,
        get() { return getPisiSheetSelectionForDatabase; }
    },
    "getPisiSheetSelectionFocusForDatabase": {
        enumerable: true,
        get() {
            return getPisiSheetSelectionFocusForDatabase;
        }
    },
    "getPisiSheetActivePointForDatabase": {
        enumerable: true,
        get() {
            return getPisiSheetActivePointForDatabase;
        }
    },
    "getPisiSheetSelectionRect": {
        enumerable: true,
        get() { return getPisiSheetSelectionRect; }
    },
    "getPisiSelectedSheetPointsForDatabase": {
        enumerable: true,
        get() {
            return getPisiSelectedSheetPointsForDatabase;
        }
    },
    "getPisiSheetHeaderSelectionStateForDatabase": {
        enumerable: true,
        get() {
            return getPisiSheetHeaderSelectionStateForDatabase;
        }
    },
    "setPisiSheetHeaderSelectionStateForDatabase": {
        enumerable: true,
        get() {
            return setPisiSheetHeaderSelectionStateForDatabase;
        }
    },
    "clearPisiSheetHeaderSelectionStateForDatabase": {
        enumerable: true,
        get() {
            return clearPisiSheetHeaderSelectionStateForDatabase;
        }
    },
    "getPisiSheetHeaderSelectionForDatabase": {
        enumerable: true,
        get() {
            return getPisiSheetHeaderSelectionForDatabase;
        }
    },
    "clearPisiSheetAllSelectionStateForDatabase": {
        enumerable: true,
        get() {
            return clearPisiSheetAllSelectionStateForDatabase;
        }
    },
    "getPisiSheetActiveGroupId": {
        enumerable: true,
        get() { return getPisiSheetActiveGroupId; }
    }
});
registerModule("editor.sheetSelectionState", moduleApi);
