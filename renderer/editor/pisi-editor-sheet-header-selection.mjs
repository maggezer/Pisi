import { getPisiSheetViewAxes, getPisiSheetViewSelectionIndices } from './pisi-editor-sheet-view-selection.mjs';
import { registerModule } from '../core/module-registry.mjs';

function getPisiSheetHeaderSelection(table) {
    return getPisiSheetHeaderSelectionForDatabase(getPisiSheetDatabase(table));
}

function getPisiSheetSelection(table) {
    const database = getPisiSheetDatabase(table);

    return getPisiSheetSelectionForDatabase(database) || getPisiSheetHeaderSelectionForDatabase(database);
}

function getPisiSelectedSheetPoints(table) {
    const database = getPisiSheetDatabase(table);
    const selection = getPisiSheetSelection(table);
    return getPisiSheetViewSelectionIndices(getPisiSheetViewAxes(table), selection)
        .map(({ row, col }) => getPisiSheetPointByIndexFromDatabase(database, row, col))
        .filter(Boolean);
}

function selectPisiSheetRow(table, rowIndex, extend = false) {
    const database = getPisiSheetDatabase(table);
    const item = database?.items?.[rowIndex];

    if (!database || !item) return;

    const previous = getPisiSheetHeaderSelectionForDatabase(database);
    const anchorId = extend && previous?.mode === 'row' ? previous.anchorId : item.id;

    setPisiSheetHeaderSelectionStateForDatabase(database, {
        mode: 'row',
        anchorId,
        focusId: item.id
    });

    syncPisiSheetSelectionProjection(table);
}

function selectPisiSheetColumn(table, colIndex, extend = false) {
    const database = getPisiSheetDatabase(table);
    const field = getPisiSheetField(table, colIndex);

    if (!database || !field) return;

    const previous = getPisiSheetHeaderSelectionForDatabase(database);
    const anchorId = extend && previous?.mode === 'column' ? previous.anchorId : field.id;

    setPisiSheetHeaderSelectionStateForDatabase(database, {
        mode: 'column',
        anchorId,
        focusId: field.id
    });

    syncPisiSheetSelectionProjection(table);
}

function getPisiSheetVisibleColumnIndices(table) {
    const dimensions = getPisiSheetDatabaseDimensions(table);
    const indices = [];

    for (let col = 0; col < dimensions.cols; col += 1) {
        if (!isPisiSheetFieldHidden(table, col)) {
            indices.push(col);
        }
    }

    return indices;
}

function getPisiSheetNextVisibleColumn(table, startCol, direction) {
    const visible = getPisiSheetVisibleColumnIndices(table);
    if (!visible.length) return startCol;

    if (direction > 0) {
        return visible.find((col) => col > startCol) ?? visible[visible.length - 1];
    }

    if (direction < 0) {
        return [...visible].reverse().find((col) => col < startCol) ?? visible[0];
    }

    return visible.includes(startCol) ? startCol : visible[0];
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    getPisiSheetHeaderSelection: {
        enumerable: true,
        get() {
            return getPisiSheetHeaderSelection;
        }
    },
    getPisiSheetSelection: {
        enumerable: true,
        get() {
            return getPisiSheetSelection;
        }
    },
    getPisiSelectedSheetPoints: {
        enumerable: true,
        get() {
            return getPisiSelectedSheetPoints;
        }
    },
    selectPisiSheetRow: {
        enumerable: true,
        get() {
            return selectPisiSheetRow;
        }
    },
    selectPisiSheetColumn: {
        enumerable: true,
        get() {
            return selectPisiSheetColumn;
        }
    },
    getPisiSheetVisibleColumnIndices: {
        enumerable: true,
        get() {
            return getPisiSheetVisibleColumnIndices;
        }
    },
    getPisiSheetNextVisibleColumn: {
        enumerable: true,
        get() {
            return getPisiSheetNextVisibleColumn;
        }
    }
});
registerModule('editor.sheetHeaderSelection', moduleApi);
