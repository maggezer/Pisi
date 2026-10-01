import {
    findPisiSheetFieldOption,
    normalizePisiSheetDateValue,
    normalizePisiSheetFieldOptions,
    normalizePisiSheetFieldType,
    normalizePisiSheetNumberValue
} from "./pisi-editor-sheet-field-types-core.mjs";

const PISI_SHEET_FILTER_LOGICS = Object.freeze([
    'and',
    'or'
]);

const PISI_SHEET_SORT_DIRECTIONS = Object.freeze([
    'asc',
    'desc'
]);

const PISI_SHEET_CONDITIONAL_COLOR_TARGETS = Object.freeze([
    'row',
    'cell'
]);

const PISI_SHEET_CONDITIONAL_COLOR_TONES = Object.freeze([
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'gray'
]);

const PISI_SHEET_FILTER_OPERATORS = Object.freeze({
    text: Object.freeze([
        'is',
        'isNot',
        'contains',
        'notContains',
        'isEmpty',
        'isNotEmpty'
    ]),
    number: Object.freeze([
        'eq',
        'neq',
        'gt',
        'gte',
        'lt',
        'lte',
        'isEmpty',
        'isNotEmpty'
    ]),
    date: Object.freeze([
        'eq',
        'neq',
        'before',
        'onOrBefore',
        'after',
        'onOrAfter',
        'isEmpty',
        'isNotEmpty'
    ]),
    select: Object.freeze([
        'is',
        'isNot',
        'isEmpty',
        'isNotEmpty'
    ]),
    mSelect: Object.freeze([
        'contains',
        'notContains',
        'isEmpty',
        'isNotEmpty'
    ]),
    checkbox: Object.freeze([
        'is'
    ]),
    formula: Object.freeze([
        'is',
        'isNot',
        'contains',
        'notContains',
        'isEmpty',
        'isNotEmpty'
    ])
});

function createPisiSheetViewRuleId(prefix = 'rule') {
    const uuid = globalThis.crypto?.randomUUID?.();

    if (uuid) return prefix + '-' + uuid;

    return (
        prefix + '-' +
        Date.now().toString(36) + '-' +
        Math.random().toString(36).slice(2, 9)
    );
}

function getPisiSheetFilterOperatorsForType(type) {
    const resolved = normalizePisiSheetFieldType(type);
    return [
        ...(
            PISI_SHEET_FILTER_OPERATORS[resolved] ||
            PISI_SHEET_FILTER_OPERATORS.text
        )
    ];
}

function makePisiSheetEmptyFilterTree(logic = 'and') {
    return {
        type: 'group',
        id: createPisiSheetViewRuleId('filter-group'),
        logic: PISI_SHEET_FILTER_LOGICS.includes(logic)
            ? logic
            : 'and',
        children: []
    };
}

function normalizePisiSheetFilterCondition(
    condition,
    fieldIds = new Set()
) {
    if (!condition || typeof condition !== 'object') {
        return null;
    }

    const fieldId = String(condition.fieldId || '');

    if (
        !fieldId ||
        (
            fieldIds.size > 0 &&
            !fieldIds.has(fieldId)
        )
    ) {
        return null;
    }

    return {
        type: 'condition',
        id: String(
            condition.id ||
            createPisiSheetViewRuleId('filter')
        ),
        fieldId,
        operator: String(condition.operator || 'is'),
        value: condition.value ?? ''
    };
}

function normalizePisiSheetFilterTree(
    node,
    fieldIds = new Set()
) {
    if (Array.isArray(node)) {
        return {
            ...makePisiSheetEmptyFilterTree('and'),
            children: node
                .map((condition) => (
                    normalizePisiSheetFilterCondition(
                        condition,
                        fieldIds
                    )
                ))
                .filter(Boolean)
        };
    }

    if (!node || typeof node !== 'object') {
        return makePisiSheetEmptyFilterTree();
    }

    if (node.type === 'condition') {
        return normalizePisiSheetFilterCondition(
            node,
            fieldIds
        );
    }

    const logic = PISI_SHEET_FILTER_LOGICS.includes(
        String(node.logic || '').toLowerCase()
    )
        ? String(node.logic).toLowerCase()
        : 'and';

    const children = Array.isArray(node.children)
        ? node.children
            .map((child) => (
                normalizePisiSheetFilterTree(
                    child,
                    fieldIds
                )
            ))
            .filter(Boolean)
        : [];

    return {
        type: 'group',
        id: String(
            node.id ||
            createPisiSheetViewRuleId('filter-group')
        ),
        logic,
        children
    };
}

function normalizePisiSheetSorts(
    sorts,
    fieldIds = new Set()
) {
    const result = [];
    const seen = new Set();

    for (const raw of Array.isArray(sorts) ? sorts : []) {
        if (!raw || typeof raw !== 'object') continue;

        const fieldId = String(raw.fieldId || '');
        const direction = String(
            raw.direction || 'asc'
        ).toLowerCase();

        if (
            !fieldId ||
            seen.has(fieldId) ||
            (
                fieldIds.size > 0 &&
                !fieldIds.has(fieldId)
            ) ||
            !PISI_SHEET_SORT_DIRECTIONS.includes(
                direction
            )
        ) {
            continue;
        }

        seen.add(fieldId);
        result.push({
            id: String(
                raw.id ||
                createPisiSheetViewRuleId('sort')
            ),
            fieldId,
            direction
        });

        if (result.length >= 20) break;
    }

    return result;
}

function normalizePisiSheetConditionalColors(
    rules,
    fields = []
) {
    const fieldsById = new Map(
        (Array.isArray(fields) ? fields : [])
            .map((field) => [field.id, field])
    );
    const validateFields = fieldsById.size > 0;
    const result = [];

    for (const raw of Array.isArray(rules) ? rules : []) {
        if (!raw || typeof raw !== 'object') continue;

        const fieldId = String(raw.fieldId || '');
        const field = fieldsById.get(fieldId);
        const operator = String(raw.operator || 'is');
        const target = String(raw.target || 'row');
        const tone = String(raw.tone || 'red');

        if (
            !fieldId ||
            (validateFields && !field) ||
            (
                field &&
                !getPisiSheetFilterOperatorsForType(
                    field.type
                ).includes(operator)
            ) ||
            !PISI_SHEET_CONDITIONAL_COLOR_TARGETS.includes(
                target
            ) ||
            !PISI_SHEET_CONDITIONAL_COLOR_TONES.includes(
                tone
            )
        ) {
            continue;
        }

        result.push({
            id: String(
                raw.id ||
                createPisiSheetViewRuleId(
                    'conditional-color'
                )
            ),
            fieldId,
            operator,
            value: raw.value ?? '',
            target,
            tone
        });

        if (result.length >= 50) break;
    }

    return result;
}

function isPisiSheetFilterValueEmpty(value) {
    return (
        value === '' ||
        value === null ||
        value === undefined ||
        (
            Array.isArray(value) &&
            value.length === 0
        )
    );
}

function normalizePisiSheetTextCompare(value) {
    return String(value ?? '')
        .toLocaleLowerCase('tr-TR')
        .replace(/[ıİ]/g, 'i')
        .replace(/[şŞ]/g, 's')
        .replace(/[ğĞ]/g, 'g')
        .replace(/[üÜ]/g, 'u')
        .replace(/[öÖ]/g, 'o')
        .replace(/[çÇ]/g, 'c')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

function resolvePisiSheetDateFilterValue(
    value,
    now = new Date()
) {
    if (String(value || '') === '@today') {
        return [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0')
        ].join('-');
    }

    return normalizePisiSheetDateValue(value);
}

function getPisiSheetItemFieldRawValue(item, field) {
    const record = item?.values?.[field?.id] || null;

    if (!record) return '';

    if (
        field?.type === 'formula' &&
        record.formula
    ) {
        return record.value !== '' &&
            record.value !== null &&
            record.value !== undefined
            ? record.value
            : record.formula;
    }

    return record.value ?? '';
}

function getPisiSheetComparableValue(field, value) {
    const type = normalizePisiSheetFieldType(
        field?.type
    );

    if (type === 'number') {
        const numeric = normalizePisiSheetNumberValue(
            value
        );

        return numeric === ''
            ? null
            : numeric;
    }

    if (type === 'date') {
        return normalizePisiSheetDateValue(value) || null;
    }

    if (type === 'checkbox') {
        return value === true ? 1 : 0;
    }

    if (type === 'select') {
        const option = findPisiSheetFieldOption(
            field,
            value
        );

        return normalizePisiSheetTextCompare(
            option?.label || value
        );
    }

    if (type === 'mSelect') {
        const ids = Array.isArray(value)
            ? value
            : [];
        const options = normalizePisiSheetFieldOptions(
            field?.options
        );
        const labels = ids.map((id) => (
            options.find(
                (option) => option.id === id
            )?.label || id
        ));

        return normalizePisiSheetTextCompare(
            labels.join(' ')
        );
    }

    return normalizePisiSheetTextCompare(value);
}

function evaluatePisiSheetFilterCondition(
    database,
    item,
    condition,
    now = new Date()
) {
    const field = database?.fields?.find(
        (candidate) => (
            candidate.id === condition?.fieldId
        )
    );

    if (!field) return false;

    const operator = String(
        condition.operator || 'is'
    );
    const allowed =
        getPisiSheetFilterOperatorsForType(field.type);

    if (!allowed.includes(operator)) {
        return false;
    }

    const actual = getPisiSheetItemFieldRawValue(
        item,
        field
    );

    if (operator === 'isEmpty') {
        return isPisiSheetFilterValueEmpty(actual);
    }

    if (operator === 'isNotEmpty') {
        return !isPisiSheetFilterValueEmpty(actual);
    }

    const type = normalizePisiSheetFieldType(
        field.type
    );

    if (type === 'number') {
        const left = normalizePisiSheetNumberValue(
            actual
        );
        const right = normalizePisiSheetNumberValue(
            condition.value
        );

        if (left === '' || right === '') return false;

        if (operator === 'eq') return left === right;
        if (operator === 'neq') return left !== right;
        if (operator === 'gt') return left > right;
        if (operator === 'gte') return left >= right;
        if (operator === 'lt') return left < right;
        if (operator === 'lte') return left <= right;
        return false;
    }

    if (type === 'date') {
        const left = normalizePisiSheetDateValue(
            actual
        );
        const right = resolvePisiSheetDateFilterValue(
            condition.value,
            now
        );

        if (!left || !right) return false;

        if (operator === 'eq') return left === right;
        if (operator === 'neq') return left !== right;
        if (operator === 'before') return left < right;
        if (operator === 'onOrBefore') return left <= right;
        if (operator === 'after') return left > right;
        if (operator === 'onOrAfter') return left >= right;
        return false;
    }

    if (type === 'checkbox') {
        const right =
            condition.value === true ||
            String(condition.value) === 'true';

        return actual === true === right;
    }

    if (type === 'select') {
        const expected = findPisiSheetFieldOption(
            field,
            condition.value
        )?.id || String(condition.value || '');

        if (operator === 'is') {
            return String(actual || '') === expected;
        }

        if (operator === 'isNot') {
            return String(actual || '') !== expected;
        }

        return false;
    }

    if (type === 'mSelect') {
        const selected = new Set(
            Array.isArray(actual)
                ? actual.map(String)
                : []
        );
        const expected = findPisiSheetFieldOption(
            field,
            condition.value
        )?.id || String(condition.value || '');

        if (operator === 'contains') {
            return selected.has(expected);
        }

        if (operator === 'notContains') {
            return !selected.has(expected);
        }

        return false;
    }

    const left = normalizePisiSheetTextCompare(
        actual
    );
    const right = normalizePisiSheetTextCompare(
        condition.value
    );

    if (operator === 'is') return left === right;
    if (operator === 'isNot') return left !== right;
    if (operator === 'contains') {
        return left.includes(right);
    }
    if (operator === 'notContains') {
        return !left.includes(right);
    }

    return false;
}

function evaluatePisiSheetFilterTree(
    database,
    item,
    node,
    now = new Date()
) {
    if (!node) return true;

    if (node.type === 'condition') {
        return evaluatePisiSheetFilterCondition(
            database,
            item,
            node,
            now
        );
    }

    const children = Array.isArray(node.children)
        ? node.children
        : [];

    if (!children.length) return true;

    if (node.logic === 'or') {
        return children.some((child) => (
            evaluatePisiSheetFilterTree(
                database,
                item,
                child,
                now
            )
        ));
    }

    return children.every((child) => (
        evaluatePisiSheetFilterTree(
            database,
            item,
            child,
            now
        )
    ));
}

function getPisiSheetConditionalColorMatches(
    database,
    item,
    rules,
    now = new Date()
) {
    if (!database || !item) return [];

    return normalizePisiSheetConditionalColors(
        rules,
        database.fields
    ).filter((rule) => (
        evaluatePisiSheetFilterCondition(
            database,
            item,
            rule,
            now
        )
    ));
}

function comparePisiSheetSortValues(left, right) {
    const leftEmpty =
        left === null ||
        left === undefined ||
        left === '';
    const rightEmpty =
        right === null ||
        right === undefined ||
        right === '';

    if (leftEmpty && rightEmpty) return 0;
    if (leftEmpty) return 1;
    if (rightEmpty) return -1;

    if (
        typeof left === 'number' &&
        typeof right === 'number'
    ) {
        return left - right;
    }

    return String(left).localeCompare(
        String(right),
        'tr-TR',
        {
            numeric: true,
            sensitivity: 'base'
        }
    );
}

function getPisiSheetViewItemRecords(
    database,
    view,
    now = new Date()
) {
    if (!database) return [];

    const filterTree = normalizePisiSheetFilterTree(
        view?.filters,
        new Set(
            database.fields.map((field) => field.id)
        )
    );
    const sorts = normalizePisiSheetSorts(
        view?.sorts,
        new Set(
            database.fields.map((field) => field.id)
        )
    );

    const fieldsById = new Map(
        database.fields.map((field) => [
            field.id,
            field
        ])
    );

    const records = database.items
        .map((item, modelIndex) => ({
            item,
            modelIndex
        }))
        .filter(({ item }) => (
            evaluatePisiSheetFilterTree(
                database,
                item,
                filterTree,
                now
            )
        ));

    if (!sorts.length) return records;

    return records
        .map((record, stableIndex) => ({
            ...record,
            stableIndex
        }))
        .sort((a, b) => {
            for (const sort of sorts) {
                const field = fieldsById.get(
                    sort.fieldId
                );
                if (!field) continue;

                const left = getPisiSheetComparableValue(
                    field,
                    getPisiSheetItemFieldRawValue(
                        a.item,
                        field
                    )
                );
                const right = getPisiSheetComparableValue(
                    field,
                    getPisiSheetItemFieldRawValue(
                        b.item,
                        field
                    )
                );
                const compared =
                    comparePisiSheetSortValues(
                        left,
                        right
                    );

                if (compared !== 0) {
                    return sort.direction === 'desc'
                        ? -compared
                        : compared;
                }
            }

            return a.stableIndex - b.stableIndex;
        });
}

export {
    PISI_SHEET_FILTER_LOGICS,
    PISI_SHEET_FILTER_OPERATORS,
    PISI_SHEET_SORT_DIRECTIONS,
    PISI_SHEET_CONDITIONAL_COLOR_TARGETS,
    PISI_SHEET_CONDITIONAL_COLOR_TONES,
    comparePisiSheetSortValues,
    createPisiSheetViewRuleId,
    evaluatePisiSheetFilterCondition,
    evaluatePisiSheetFilterTree,
    getPisiSheetConditionalColorMatches,
    getPisiSheetComparableValue,
    getPisiSheetFilterOperatorsForType,
    getPisiSheetViewItemRecords,
    makePisiSheetEmptyFilterTree,
    normalizePisiSheetFilterCondition,
    normalizePisiSheetFilterTree,
    normalizePisiSheetConditionalColors,
    normalizePisiSheetSorts,
    resolvePisiSheetDateFilterValue
};
