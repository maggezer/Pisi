import { registerModule } from "../core/module-registry.mjs";
import {
    createPisiSheetViewRuleId,
    getPisiSheetViewItemRecords,
    makePisiSheetEmptyFilterTree,
    normalizePisiSheetFilterTree,
    normalizePisiSheetSorts
} from "./pisi-editor-sheet-view-query-core.mjs";

function getPisiSheetActiveViewFilters(table) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;

    return view?.filters || makePisiSheetEmptyFilterTree();
}

function getPisiSheetActiveViewSorts(table) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;

    return Array.isArray(view?.sorts)
        ? view.sorts
        : [];
}

function getPisiSheetViewRecords(table) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;

    return database
        ? getPisiSheetViewItemRecords(
            database,
            view
        )
        : [];
}

function getPisiSheetVisibleRowIndices(table) {
    return getPisiSheetViewRecords(table)
        .map((record) => record.modelIndex);
}

function getPisiSheetNextVisibleRowIndex(
    table,
    currentRow,
    direction
) {
    const visible = getPisiSheetVisibleRowIndices(table);
    if (!visible.length) return currentRow;

    const currentIndex = visible.indexOf(currentRow);

    if (currentIndex < 0) {
        return direction < 0
            ? visible.at(-1)
            : visible[0];
    }

    const nextIndex = Math.max(
        0,
        Math.min(
            visible.length - 1,
            currentIndex + (
                direction < 0 ? -1 : 1
            )
        )
    );

    return visible[nextIndex];
}

function refreshPisiSheetViewQuery(table) {
    renderPisiSheetDatabase(table);
    recalcPisiSheet(table);

    const active = getPisiSheetActivePoint(table);
    const visibleRows =
        new Set(getPisiSheetVisibleRowIndices(table));

    if (
        active &&
        !visibleRows.has(active.row)
    ) {
        clearPisiSheetSelection(table);

        const firstRow =
            getPisiSheetVisibleRowIndices(table)[0];
        const firstCol =
            getPisiSheetVisibleColumnIndices(table)[0];

        if (
            Number.isInteger(firstRow) &&
            Number.isInteger(firstCol)
        ) {
            const cell = getPisiSheetCell(
                table,
                firstRow,
                firstCol
            );
            if (cell) {
                selectPisiSheetCell(cell);
            }
        }
    } else {
        reconcilePisiSheetSelection(table);
    }

    persistPisiSheetDatabase(table);
    schedulePisiSheetEditorNotification(table);

    return getPisiSheetTableView(
        getPisiSheetDatabase(table)
    );
}

function setPisiSheetViewFilters(table, filters) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;

    if (!database || !view) return null;

    view.filters = normalizePisiSheetFilterTree(
        filters,
        new Set(
            database.fields.map((field) => field.id)
        )
    );

    refreshPisiSheetViewQuery(table);
    return view.filters;
}

function setPisiSheetViewSorts(table, sorts) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;

    if (!database || !view) return null;

    view.sorts = normalizePisiSheetSorts(
        sorts,
        new Set(
            database.fields.map((field) => field.id)
        )
    );

    refreshPisiSheetViewQuery(table);
    return view.sorts;
}

function findPisiSheetFilterNode(
    node,
    id
) {
    if (!node || !id) return null;
    if (node.id === id) return node;

    for (const child of node.children || []) {
        const match = findPisiSheetFilterNode(
            child,
            id
        );
        if (match) return match;
    }

    return null;
}

function findPisiSheetFilterParent(
    node,
    id
) {
    if (!node?.children || !id) return null;

    if (
        node.children.some(
            (child) => child.id === id
        )
    ) {
        return node;
    }

    for (const child of node.children) {
        const match = findPisiSheetFilterParent(
            child,
            id
        );
        if (match) return match;
    }

    return null;
}

function addPisiSheetViewFilterCondition(
    table,
    groupId,
    condition = {}
) {
    const tree = structuredClone(
        getPisiSheetActiveViewFilters(table)
    );
    const group =
        findPisiSheetFilterNode(
            tree,
            groupId
        ) ||
        tree;

    if (group?.type !== 'group') return null;

    const database = getPisiSheetDatabase(table);
    const firstField = database?.fields?.[0];

    group.children.push({
        type: 'condition',
        id: createPisiSheetViewRuleId('filter'),
        fieldId: String(
            condition.fieldId ||
            firstField?.id ||
            ''
        ),
        operator: String(
            condition.operator || 'is'
        ),
        value: condition.value ?? ''
    });

    return setPisiSheetViewFilters(
        table,
        tree
    );
}

function addPisiSheetViewFilterGroup(
    table,
    parentId,
    logic = 'and'
) {
    const tree = structuredClone(
        getPisiSheetActiveViewFilters(table)
    );
    const parent =
        findPisiSheetFilterNode(
            tree,
            parentId
        ) ||
        tree;

    if (parent?.type !== 'group') return null;

    parent.children.push({
        ...makePisiSheetEmptyFilterTree(logic),
        id: createPisiSheetViewRuleId(
            'filter-group'
        )
    });

    return setPisiSheetViewFilters(
        table,
        tree
    );
}

function updatePisiSheetViewFilterNode(
    table,
    nodeId,
    patch = {}
) {
    const tree = structuredClone(
        getPisiSheetActiveViewFilters(table)
    );
    const node = findPisiSheetFilterNode(
        tree,
        nodeId
    );

    if (!node) return null;

    Object.assign(
        node,
        /** @type {Record<string, any>} */ (patch)
    );

    return setPisiSheetViewFilters(
        table,
        tree
    );
}

function removePisiSheetViewFilterNode(
    table,
    nodeId
) {
    const tree = structuredClone(
        getPisiSheetActiveViewFilters(table)
    );

    if (tree.id === nodeId) {
        return setPisiSheetViewFilters(
            table,
            makePisiSheetEmptyFilterTree()
        );
    }

    const parent = findPisiSheetFilterParent(
        tree,
        nodeId
    );
    if (!parent) return null;

    parent.children = parent.children.filter(
        (child) => child.id !== nodeId
    );

    return setPisiSheetViewFilters(
        table,
        tree
    );
}

function addPisiSheetViewSort(
    table,
    fieldId,
    direction = 'asc'
) {
    const sorts = structuredClone(
        getPisiSheetActiveViewSorts(table)
    );

    const existing = sorts.find(
        (sort) => sort.fieldId === fieldId
    );

    if (existing) {
        existing.direction = direction;
    } else {
        sorts.push({
            id: createPisiSheetViewRuleId('sort'),
            fieldId,
            direction
        });
    }

    return setPisiSheetViewSorts(
        table,
        sorts
    );
}

function updatePisiSheetViewSort(
    table,
    sortId,
    patch = {}
) {
    const sorts = structuredClone(
        getPisiSheetActiveViewSorts(table)
    );
    const sort = sorts.find(
        (candidate) => candidate.id === sortId
    );

    if (!sort) return null;

    Object.assign(
        sort,
        /** @type {Record<string, any>} */ (patch)
    );

    return setPisiSheetViewSorts(
        table,
        sorts
    );
}

function removePisiSheetViewSort(
    table,
    sortId
) {
    return setPisiSheetViewSorts(
        table,
        getPisiSheetActiveViewSorts(table)
            .filter(
                (sort) => sort.id !== sortId
            )
    );
}

function movePisiSheetViewSort(
    table,
    sortId,
    delta
) {
    const sorts = structuredClone(
        getPisiSheetActiveViewSorts(table)
    );
    const index = sorts.findIndex(
        (sort) => sort.id === sortId
    );

    if (index < 0) return null;

    const next = Math.max(
        0,
        Math.min(
            sorts.length - 1,
            index + Number(delta || 0)
        )
    );

    if (next === index) return sorts;

    const [sort] = sorts.splice(index, 1);
    sorts.splice(next, 0, sort);

    return setPisiSheetViewSorts(
        table,
        sorts
    );
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "getPisiSheetActiveViewFilters": {
        enumerable: true,
        get() { return getPisiSheetActiveViewFilters; }
    },
    "getPisiSheetActiveViewSorts": {
        enumerable: true,
        get() { return getPisiSheetActiveViewSorts; }
    },
    "getPisiSheetViewRecords": {
        enumerable: true,
        get() { return getPisiSheetViewRecords; }
    },
    "getPisiSheetVisibleRowIndices": {
        enumerable: true,
        get() { return getPisiSheetVisibleRowIndices; }
    },
    "getPisiSheetNextVisibleRowIndex": {
        enumerable: true,
        get() { return getPisiSheetNextVisibleRowIndex; }
    },
    "refreshPisiSheetViewQuery": {
        enumerable: true,
        get() { return refreshPisiSheetViewQuery; }
    },
    "setPisiSheetViewFilters": {
        enumerable: true,
        get() { return setPisiSheetViewFilters; }
    },
    "setPisiSheetViewSorts": {
        enumerable: true,
        get() { return setPisiSheetViewSorts; }
    },
    "addPisiSheetViewFilterCondition": {
        enumerable: true,
        get() { return addPisiSheetViewFilterCondition; }
    },
    "addPisiSheetViewFilterGroup": {
        enumerable: true,
        get() { return addPisiSheetViewFilterGroup; }
    },
    "updatePisiSheetViewFilterNode": {
        enumerable: true,
        get() { return updatePisiSheetViewFilterNode; }
    },
    "removePisiSheetViewFilterNode": {
        enumerable: true,
        get() { return removePisiSheetViewFilterNode; }
    },
    "addPisiSheetViewSort": {
        enumerable: true,
        get() { return addPisiSheetViewSort; }
    },
    "updatePisiSheetViewSort": {
        enumerable: true,
        get() { return updatePisiSheetViewSort; }
    },
    "removePisiSheetViewSort": {
        enumerable: true,
        get() { return removePisiSheetViewSort; }
    },
    "movePisiSheetViewSort": {
        enumerable: true,
        get() { return movePisiSheetViewSort; }
    }
});
registerModule("editor.sheetViewQuery", moduleApi);
