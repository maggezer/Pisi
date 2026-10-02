import { registerModule } from '../core/module-registry.mjs';
import { transformPisiSheetFormulaReferences } from './pisi-editor-sheet-model.mjs';

const pisiBoundSheetColumnReorder = new WeakSet();
let pisiSheetColumnDrag = null;

function movePisiSheetField(table, fromIndex, toIndex) {
    const database = getPisiSheetDatabase(table);
    const view = database ? getPisiSheetTableView(database) : null;
    const order = view?.fieldOrder || [];
    const from = Number(fromIndex);
    const requestedTo = Number(toIndex);

    if (!database || !view || !Number.isInteger(from) || !Number.isInteger(requestedTo) || from < 0 || from >= order.length) {
        return null;
    }

    const to = Math.max(0, Math.min(order.length - 1, requestedTo));

    if (from === to) {
        return {
            fieldId: order[from],
            fromIndex: from,
            toIndex: to,
            indexMap: order.map((_, index) => index)
        };
    }

    const previousOrder = [...order];
    const [fieldId] = order.splice(from, 1);
    order.splice(to, 0, fieldId);

    const nextIndexById = new Map(order.map((id, index) => [id, index]));
    const indexMap = previousOrder.map((id) => nextIndexById.get(id));

    for (const item of database.items) {
        for (const record of Object.values(item.values)) {
            if (!record?.formula) continue;

            record.formula = transformPisiSheetFormulaReferences(record.formula, {
                type: 'reorder-col',
                indexMap
            });
        }
    }

    persistPisiSheetDatabase(table);

    return {
        fieldId,
        fromIndex: from,
        toIndex: to,
        indexMap
    };
}

function movePisiSheetColumn(table, fromIndex, toIndex, options = {}) {
    finishPisiSheetCellEdit(table, {
        commit: true,
        refocus: false
    });

    const result = movePisiSheetField(table, fromIndex, toIndex);

    if (!result) return null;

    renderPisiSheetDatabase(table);
    recalcPisiSheet(table);
    reconcilePisiSheetSelection(table);

    if (options.select !== false) {
        selectPisiSheetColumn(table, result.toIndex, false);
    }

    schedulePisiSheetEditorNotification(table);
    return result;
}

function clearPisiSheetColumnDropIndicators(table) {
    table?.querySelectorAll('.pisi-sheet-col-drop-before, ' + '.pisi-sheet-col-drop-after').forEach((header) => {
        header.classList.remove('pisi-sheet-col-drop-before', 'pisi-sheet-col-drop-after');
    });
}

function getPisiSheetColumnDropTarget(header, event) {
    const rect = header.getBoundingClientRect();
    const after = event.clientX >= rect.left + rect.width / 2;

    return {
        colIndex: Number(header.dataset.colHeader),
        after
    };
}

function getPisiSheetColumnDropIndex(fromIndex, targetIndex, after, count) {
    let insertionIndex = targetIndex + (after ? 1 : 0);

    if (fromIndex < insertionIndex) {
        insertionIndex -= 1;
    }

    return Math.max(0, Math.min(count - 1, insertionIndex));
}

function bindPisiSheetColumnReorder(table) {
    if (!table || pisiBoundSheetColumnReorder.has(table)) {
        return;
    }

    pisiBoundSheetColumnReorder.add(table);

    table.addEventListener('dragstart', (event) => {
        const label = event.target.closest('.pisi-sheet-col-label');
        const header = label?.closest('th[data-col-header]');

        if (!label || !header || !table.contains(header)) {
            return;
        }

        const fromIndex = Number(header.dataset.colHeader);

        if (!Number.isInteger(fromIndex)) return;

        pisiSheetColumnDrag = {
            table,
            fromIndex,
            fieldId: header.dataset.pisiColId || ''
        };

        table.classList.add('pisi-sheet-column-dragging');
        header.classList.add('pisi-sheet-column-drag-source');

        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', pisiSheetColumnDrag.fieldId);
        }
    });

    table.addEventListener('dragover', (event) => {
        const drag = pisiSheetColumnDrag;
        const header = event.target.closest('th[data-col-header]');

        if (!drag || drag.table !== table || !header || !table.contains(header)) {
            return;
        }

        const target = getPisiSheetColumnDropTarget(header, event);

        if (!Number.isInteger(target.colIndex)) {
            return;
        }

        event.preventDefault();

        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }

        clearPisiSheetColumnDropIndicators(table);
        header.classList.add(target.after ? 'pisi-sheet-col-drop-after' : 'pisi-sheet-col-drop-before');
    });

    table.addEventListener('drop', (event) => {
        const drag = pisiSheetColumnDrag;
        const header = event.target.closest('th[data-col-header]');

        if (!drag || drag.table !== table || !header || !table.contains(header)) {
            return;
        }

        const target = getPisiSheetColumnDropTarget(header, event);
        const count = getPisiSheetDatabaseDimensions(table).cols;
        const toIndex = getPisiSheetColumnDropIndex(drag.fromIndex, target.colIndex, target.after, count);

        event.preventDefault();
        event.stopPropagation();

        clearPisiSheetColumnDropIndicators(table);
        pisiSheetColumnDrag = null;
        table.classList.remove('pisi-sheet-column-dragging');

        movePisiSheetColumn(table, drag.fromIndex, toIndex);
    });

    table.addEventListener('dragend', () => {
        clearPisiSheetColumnDropIndicators(table);
        table.classList.remove('pisi-sheet-column-dragging');
        table.querySelectorAll('.pisi-sheet-column-drag-source').forEach((header) => {
            header.classList.remove('pisi-sheet-column-drag-source');
        });

        if (pisiSheetColumnDrag?.table === table) {
            pisiSheetColumnDrag = null;
        }
    });
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    movePisiSheetField: {
        enumerable: true,
        get() {
            return movePisiSheetField;
        }
    },
    movePisiSheetColumn: {
        enumerable: true,
        get() {
            return movePisiSheetColumn;
        }
    },
    bindPisiSheetColumnReorder: {
        enumerable: true,
        get() {
            return bindPisiSheetColumnReorder;
        }
    },
    getPisiSheetColumnDropIndex: {
        enumerable: true,
        get() {
            return getPisiSheetColumnDropIndex;
        }
    }
});
registerModule('editor.sheetColumnReorder', moduleApi);
