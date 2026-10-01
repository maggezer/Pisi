import { registerModule } from "../core/module-registry.mjs";
import {
    createPisiSheetViewRuleId,
    getPisiSheetConditionalColorMatches,
    getPisiSheetViewItemRecords,
    makePisiSheetEmptyFilterTree,
    normalizePisiSheetConditionalColors,
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

function getPisiSheetActiveViewSearchQuery(table) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;

    return String(view?.searchQuery || '');
}

function getPisiSheetActiveViewConditionalColors(table) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;

    return Array.isArray(view?.conditionalColors)
        ? view.conditionalColors
        : [];
}

function getPisiSheetConditionalColorMatchesForItem(
    table,
    item
) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;

    return database
        ? getPisiSheetConditionalColorMatches(
            database,
            item,
            view?.conditionalColors
        )
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

function setPisiSheetViewSearchQuery(
    table,
    query
) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;

    if (!database || !view) return null;

    const next = String(query || '').slice(0, 240);

    if (view.searchQuery === next) {
        return next;
    }

    view.searchQuery = next;
    view.page = 1;

    const block = table.closest(
        '.pisi-sheet-block'
    );

    if (block) block.scrollTop = 0;

    refreshPisiSheetViewQuery(table);
    return view.searchQuery;
}

function setPisiSheetViewFilters(table, filters) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;

    if (!database || !view) return null;

    view.page = 1;
    const filterBlock =
        table.closest('.pisi-sheet-block');
    if (filterBlock) filterBlock.scrollTop = 0;

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

    view.page = 1;
    const sortBlock =
        table.closest('.pisi-sheet-block');
    if (sortBlock) sortBlock.scrollTop = 0;

    view.sorts = normalizePisiSheetSorts(
        sorts,
        new Set(
            database.fields.map((field) => field.id)
        )
    );

    refreshPisiSheetViewQuery(table);
    return view.sorts;
}

function setPisiSheetViewConditionalColors(
    table,
    rules
) {
    const database = getPisiSheetDatabase(table);
    const view = database
        ? getPisiSheetTableView(database)
        : null;

    if (!database || !view) return null;

    view.conditionalColors =
        normalizePisiSheetConditionalColors(
            rules,
            database.fields
        );

    refreshPisiSheetViewQuery(table);
    return view.conditionalColors;
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

function addPisiSheetViewConditionalColor(
    table,
    rule = {}
) {
    const database = getPisiSheetDatabase(table);
    const firstField = database?.fields?.[0];
    const rules = structuredClone(
        getPisiSheetActiveViewConditionalColors(
            table
        )
    );

    rules.push({
        id: createPisiSheetViewRuleId(
            'conditional-color'
        ),
        fieldId: String(
            rule.fieldId ||
            firstField?.id ||
            ''
        ),
        operator: String(
            rule.operator || 'is'
        ),
        value: rule.value ?? '',
        target: String(rule.target || 'row'),
        tone: String(rule.tone || 'red')
    });

    return setPisiSheetViewConditionalColors(
        table,
        rules
    );
}

function updatePisiSheetViewConditionalColor(
    table,
    ruleId,
    patch = {}
) {
    const rules = structuredClone(
        getPisiSheetActiveViewConditionalColors(
            table
        )
    );
    const rule = rules.find(
        (candidate) => candidate.id === ruleId
    );

    if (!rule) return null;

    Object.assign(
        rule,
        /** @type {Record<string, any>} */ (patch)
    );

    return setPisiSheetViewConditionalColors(
        table,
        rules
    );
}

function removePisiSheetViewConditionalColor(
    table,
    ruleId
) {
    return setPisiSheetViewConditionalColors(
        table,
        getPisiSheetActiveViewConditionalColors(
            table
        ).filter(
            (rule) => rule.id !== ruleId
        )
    );
}

function movePisiSheetViewConditionalColor(
    table,
    ruleId,
    delta
) {
    const rules = structuredClone(
        getPisiSheetActiveViewConditionalColors(
            table
        )
    );
    const index = rules.findIndex(
        (rule) => rule.id === ruleId
    );

    if (index < 0) return null;

    const next = Math.max(
        0,
        Math.min(
            rules.length - 1,
            index + Number(delta || 0)
        )
    );

    if (next === index) return rules;

    const [rule] = rules.splice(index, 1);
    rules.splice(next, 0, rule);

    return setPisiSheetViewConditionalColors(
        table,
        rules
    );
}

export {
    addPisiSheetViewConditionalColor,
    getPisiSheetViewRecords,
    getPisiSheetActiveViewConditionalColors,
    getPisiSheetActiveViewSearchQuery,
    getPisiSheetConditionalColorMatchesForItem,
    movePisiSheetViewConditionalColor,
    removePisiSheetViewConditionalColor,
    setPisiSheetViewConditionalColors,
    setPisiSheetViewSearchQuery,
    updatePisiSheetViewConditionalColor
};

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
