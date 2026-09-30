import { registerModule } from "../core/module-registry.mjs";
import {
    createPisiSheetViewRuleId,
    getPisiSheetFilterOperatorsForType
} from "./pisi-editor-sheet-view-query-core.mjs";
import {
    normalizePisiSheetFieldOptions
} from "./pisi-editor-sheet-field-types-core.mjs";

let pisiSheetViewRulesPanel = null;

const PISI_SHEET_FILTER_OPERATOR_LABELS = Object.freeze({
    is: 'Eşittir',
    isNot: 'Eşit değildir',
    contains: 'İçerir',
    notContains: 'İçermez',
    isEmpty: 'Boş',
    isNotEmpty: 'Boş değil',
    eq: 'Eşittir',
    neq: 'Eşit değildir',
    gt: 'Büyüktür',
    gte: 'Büyük veya eşit',
    lt: 'Küçüktür',
    lte: 'Küçük veya eşit',
    before: 'Önce',
    onOrBefore: 'Önce veya aynı gün',
    after: 'Sonra',
    onOrAfter: 'Sonra veya aynı gün'
});

function pisiSheetRulesTranslate(value) {
    return window.pisiT?.(value) || value;
}

function closePisiSheetViewRulesPanel() {
    if (!pisiSheetViewRulesPanel) return;

    pisiSheetViewRulesPanel.element.remove();
    pisiSheetViewRulesPanel = null;
}

function positionPisiSheetViewRulesPanel(
    panel,
    anchor
) {
    const rect = anchor?.getBoundingClientRect?.() || {
        left: 12,
        bottom: 12
    };
    const margin = 8;
    const panelRect = panel.getBoundingClientRect();

    panel.style.left = String(Math.max(
        margin,
        Math.min(
            rect.left,
            window.innerWidth -
                panelRect.width -
                margin
        )
    )) + 'px';

    panel.style.top = String(Math.max(
        margin,
        Math.min(
            rect.bottom + 4,
            window.innerHeight -
                panelRect.height -
                margin
        )
    )) + 'px';
}

function getPisiSheetFilterConditionCount(node) {
    if (!node) return 0;
    if (node.type === 'condition') return 1;

    return (node.children || []).reduce(
        (sum, child) => (
            sum +
            getPisiSheetFilterConditionCount(child)
        ),
        0
    );
}

function getPisiSheetFilterDefaultOperator(field) {
    return getPisiSheetFilterOperatorsForType(
        field?.type
    )[0] || 'is';
}

function makePisiSheetRulesButton(
    label,
    className = ''
) {
    const button = document.createElement('button');

    button.type = 'button';
    button.className = [
        'pisi-sheet-view-rules-button',
        className
    ].filter(Boolean).join(' ');
    button.textContent =
        pisiSheetRulesTranslate(label);

    return button;
}

function makePisiSheetFieldSelect(
    fields,
    fieldId
) {
    const select = document.createElement('select');
    select.className =
        'pisi-sheet-view-rules-select pisi-sheet-filter-field';

    fields.forEach((field) => {
        const option = document.createElement('option');
        option.value = field.id;
        option.textContent = field.name;
        select.appendChild(option);
    });

    select.value = fieldId || fields[0]?.id || '';
    return select;
}

function makePisiSheetOperatorSelect(
    field,
    operator
) {
    const select = document.createElement('select');
    select.className =
        'pisi-sheet-view-rules-select pisi-sheet-filter-operator';

    const operators =
        getPisiSheetFilterOperatorsForType(field?.type);

    operators.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent =
            pisiSheetRulesTranslate(
                PISI_SHEET_FILTER_OPERATOR_LABELS[value] ||
                value
            );
        select.appendChild(option);
    });

    select.value = operators.includes(operator)
        ? operator
        : operators[0] || 'is';

    return select;
}

function makePisiSheetFilterValueControl(
    field,
    condition,
    onChange
) {
    const operator = condition.operator;

    if (
        operator === 'isEmpty' ||
        operator === 'isNotEmpty'
    ) {
        const spacer = document.createElement('span');
        spacer.className =
            'pisi-sheet-filter-value-empty';
        return spacer;
    }

    if (field?.type === 'checkbox') {
        const select = document.createElement('select');
        select.className =
            'pisi-sheet-view-rules-select pisi-sheet-filter-value';

        [
            ['true', 'İşaretli'],
            ['false', 'İşaretsiz']
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent =
                pisiSheetRulesTranslate(label);
            select.appendChild(option);
        });

        select.value =
            condition.value === false ||
            String(condition.value) === 'false'
                ? 'false'
                : 'true';

        select.addEventListener('change', () => {
            onChange(select.value === 'true');
        });

        return select;
    }

    if (
        field?.type === 'select' ||
        field?.type === 'mSelect'
    ) {
        const select = document.createElement('select');
        select.className =
            'pisi-sheet-view-rules-select pisi-sheet-filter-value';
        const options = normalizePisiSheetFieldOptions(
            field.options
        );

        options.forEach((item) => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.label;
            select.appendChild(option);
        });

        select.value =
            options.some(
                (item) => item.id === condition.value
            )
                ? condition.value
                : options[0]?.id || '';

        select.addEventListener('change', () => {
            onChange(select.value);
        });

        return select;
    }

    if (field?.type === 'date') {
        const wrap = document.createElement('div');
        const input = document.createElement('input');
        const today = makePisiSheetRulesButton(
            'Bugün',
            'compact'
        );

        wrap.className =
            'pisi-sheet-filter-date-value';

        input.type = 'date';
        input.className =
            'pisi-sheet-view-rules-input pisi-sheet-filter-value';
        input.value =
            condition.value === '@today'
                ? ''
                : String(condition.value || '');

        if (condition.value === '@today') {
            today.classList.add('active');
        }

        input.addEventListener('change', () => {
            onChange(input.value);
        });

        today.addEventListener('click', () => {
            onChange('@today');
        });

        wrap.append(input, today);
        return wrap;
    }

    const input = document.createElement('input');
    input.className =
        'pisi-sheet-view-rules-input pisi-sheet-filter-value';
    input.type =
        field?.type === 'number'
            ? 'number'
            : 'text';
    input.value = String(condition.value ?? '');

    input.addEventListener('change', () => {
        onChange(
            field?.type === 'number'
                ? (
                    input.value === ''
                        ? ''
                        : Number(input.value)
                )
                : input.value
        );
    });

    return input;
}

function renderPisiSheetFilterCondition(
    table,
    condition,
    fields,
    rerender
) {
    const row = document.createElement('div');
    const field = fields.find(
        (candidate) => (
            candidate.id === condition.fieldId
        )
    ) || fields[0];

    row.className =
        'pisi-sheet-filter-condition';
    row.dataset.pisiSheetFilterId = condition.id;

    const fieldSelect = makePisiSheetFieldSelect(
        fields,
        field?.id
    );
    const operatorSelect =
        makePisiSheetOperatorSelect(
            field,
            condition.operator
        );
    const remove = makePisiSheetRulesButton(
        'Sil',
        'icon danger'
    );

    fieldSelect.addEventListener('change', () => {
        const nextField = fields.find(
            (candidate) => (
                candidate.id === fieldSelect.value
            )
        );

        updatePisiSheetViewFilterNode(
            table,
            condition.id,
            {
                fieldId: fieldSelect.value,
                operator:
                    getPisiSheetFilterDefaultOperator(
                        nextField
                    ),
                value: ''
            }
        );
        rerender();
    });

    operatorSelect.addEventListener('change', () => {
        updatePisiSheetViewFilterNode(
            table,
            condition.id,
            {
                operator: operatorSelect.value
            }
        );
        rerender();
    });

    const valueControl =
        makePisiSheetFilterValueControl(
            field,
            {
                ...condition,
                operator: operatorSelect.value
            },
            (value) => {
                updatePisiSheetViewFilterNode(
                    table,
                    condition.id,
                    { value }
                );
                rerender();
            }
        );

    remove.addEventListener('click', () => {
        removePisiSheetViewFilterNode(
            table,
            condition.id
        );
        rerender();
    });

    row.append(
        fieldSelect,
        operatorSelect,
        valueControl,
        remove
    );

    return row;
}

function renderPisiSheetFilterGroup(
    table,
    group,
    fields,
    rerender,
    isRoot = false
) {
    const block = document.createElement('div');
    const header = document.createElement('div');
    const logic = document.createElement('select');
    const addCondition = makePisiSheetRulesButton(
        '+ Koşul',
        'compact'
    );
    const addGroup = makePisiSheetRulesButton(
        '+ Grup',
        'compact'
    );

    block.className =
        'pisi-sheet-filter-group' +
        (isRoot ? ' root' : '');
    block.dataset.pisiSheetFilterGroupId = group.id;
    header.className =
        'pisi-sheet-filter-group-header';

    logic.className =
        'pisi-sheet-view-rules-select pisi-sheet-filter-logic';

    [
        ['and', 'VE'],
        ['or', 'VEYA']
    ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent =
            pisiSheetRulesTranslate(label);
        logic.appendChild(option);
    });

    logic.value = group.logic || 'and';

    logic.addEventListener('change', () => {
        updatePisiSheetViewFilterNode(
            table,
            group.id,
            {
                logic: logic.value
            }
        );
        rerender();
    });

    addCondition.addEventListener('click', () => {
        addPisiSheetViewFilterCondition(
            table,
            group.id,
            {
                fieldId: fields[0]?.id || '',
                operator:
                    getPisiSheetFilterDefaultOperator(
                        fields[0]
                    )
            }
        );
        rerender();
    });

    addGroup.addEventListener('click', () => {
        addPisiSheetViewFilterGroup(
            table,
            group.id,
            'and'
        );
        rerender();
    });

    header.append(
        logic,
        addCondition,
        addGroup
    );

    if (!isRoot) {
        const remove = makePisiSheetRulesButton(
            'Sil',
            'compact danger'
        );

        remove.addEventListener('click', () => {
            removePisiSheetViewFilterNode(
                table,
                group.id
            );
            rerender();
        });

        header.appendChild(remove);
    }

    block.appendChild(header);

    const children = document.createElement('div');
    children.className =
        'pisi-sheet-filter-group-children';

    (group.children || []).forEach((child) => {
        children.appendChild(
            child.type === 'group'
                ? renderPisiSheetFilterGroup(
                    table,
                    child,
                    fields,
                    rerender,
                    false
                )
                : renderPisiSheetFilterCondition(
                    table,
                    child,
                    fields,
                    rerender
                )
        );
    });

    if (!group.children?.length) {
        const empty = document.createElement('div');
        empty.className =
            'pisi-sheet-view-rules-empty';
        empty.textContent =
            pisiSheetRulesTranslate(
                'Filtre yok'
            );
        children.appendChild(empty);
    }

    block.appendChild(children);
    return block;
}

function renderPisiSheetSortRow(
    table,
    sort,
    fields,
    index,
    count,
    rerender
) {
    const row = document.createElement('div');
    const field = makePisiSheetFieldSelect(
        fields,
        sort.fieldId
    );
    const direction = document.createElement('select');
    const up = makePisiSheetRulesButton(
        '↑',
        'icon'
    );
    const down = makePisiSheetRulesButton(
        '↓',
        'icon'
    );
    const remove = makePisiSheetRulesButton(
        'Sil',
        'icon danger'
    );

    row.className = 'pisi-sheet-sort-row';

    direction.className =
        'pisi-sheet-view-rules-select pisi-sheet-sort-direction';

    [
        ['asc', 'Artan'],
        ['desc', 'Azalan']
    ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent =
            pisiSheetRulesTranslate(label);
        direction.appendChild(option);
    });

    direction.value = sort.direction || 'asc';
    up.disabled = index === 0;
    down.disabled = index === count - 1;

    field.addEventListener('change', () => {
        updatePisiSheetViewSort(
            table,
            sort.id,
            { fieldId: field.value }
        );
        rerender();
    });

    direction.addEventListener('change', () => {
        updatePisiSheetViewSort(
            table,
            sort.id,
            { direction: direction.value }
        );
        rerender();
    });

    up.addEventListener('click', () => {
        movePisiSheetViewSort(
            table,
            sort.id,
            -1
        );
        rerender();
    });

    down.addEventListener('click', () => {
        movePisiSheetViewSort(
            table,
            sort.id,
            1
        );
        rerender();
    });

    remove.addEventListener('click', () => {
        removePisiSheetViewSort(
            table,
            sort.id
        );
        rerender();
    });

    row.append(
        field,
        direction,
        up,
        down,
        remove
    );
    return row;
}

function renderPisiSheetViewRulesPanel() {
    const state = pisiSheetViewRulesPanel;
    if (!state) return;

    const { table, element } = state;
    const database = getPisiSheetDatabase(table);
    const fields = database
        ? getPisiSheetOrderedFields(database)
        : [];
    const filters =
        getPisiSheetActiveViewFilters(table);
    const sorts =
        getPisiSheetActiveViewSorts(table);

    element.replaceChildren();

    const heading = document.createElement('div');
    const title = document.createElement('strong');
    const close = makePisiSheetRulesButton(
        '×',
        'icon'
    );

    heading.className =
        'pisi-sheet-view-rules-heading';
    title.textContent =
        pisiSheetRulesTranslate(
            'View filtreleri ve sıralama'
        );
    close.setAttribute(
        'aria-label',
        pisiSheetRulesTranslate('Kapat')
    );
    close.addEventListener(
        'click',
        closePisiSheetViewRulesPanel
    );
    heading.append(title, close);
    element.appendChild(heading);

    const summary = document.createElement('div');
    summary.className =
        'pisi-sheet-view-rules-summary';
    summary.textContent = [
        getPisiSheetFilterConditionCount(filters),
        pisiSheetRulesTranslate('filtre'),
        '·',
        sorts.length,
        pisiSheetRulesTranslate('sıralama')
    ].join(' ');
    element.appendChild(summary);

    const filterSection = document.createElement('section');
    const filterTitle = document.createElement('h4');
    const clearFilters = makePisiSheetRulesButton(
        'Filtreleri temizle',
        'compact'
    );

    filterSection.className =
        'pisi-sheet-view-rules-section';
    filterTitle.textContent =
        pisiSheetRulesTranslate('Filtreler');

    clearFilters.disabled =
        getPisiSheetFilterConditionCount(filters) === 0;
    clearFilters.addEventListener('click', () => {
        setPisiSheetViewFilters(
            table,
            {
                type: 'group',
                id: createPisiSheetViewRuleId(
                    'filter-group'
                ),
                logic: 'and',
                children: []
            }
        );
        renderPisiSheetViewRulesPanel();
    });

    const filterHeader = document.createElement('div');
    filterHeader.className =
        'pisi-sheet-view-rules-section-heading';
    filterHeader.append(filterTitle, clearFilters);
    filterSection.appendChild(filterHeader);

    filterSection.appendChild(
        renderPisiSheetFilterGroup(
            table,
            filters,
            fields,
            renderPisiSheetViewRulesPanel,
            true
        )
    );

    element.appendChild(filterSection);

    const sortSection = document.createElement('section');
    const sortTitle = document.createElement('h4');
    const addSort = makePisiSheetRulesButton(
        '+ Sıralama ekle',
        'compact'
    );
    const clearSorts = makePisiSheetRulesButton(
        'Sıralamayı temizle',
        'compact'
    );

    sortSection.className =
        'pisi-sheet-view-rules-section';
    sortTitle.textContent =
        pisiSheetRulesTranslate('Sıralama');

    addSort.disabled =
        !fields.length ||
        sorts.length >= fields.length;

    addSort.addEventListener('click', () => {
        const used = new Set(
            getPisiSheetActiveViewSorts(table)
                .map((sort) => sort.fieldId)
        );
        const field = fields.find(
            (candidate) => !used.has(candidate.id)
        );

        if (!field) return;

        addPisiSheetViewSort(
            table,
            field.id,
            'asc'
        );
        renderPisiSheetViewRulesPanel();
    });

    clearSorts.disabled = sorts.length === 0;
    clearSorts.addEventListener('click', () => {
        setPisiSheetViewSorts(table, []);
        renderPisiSheetViewRulesPanel();
    });

    const sortHeader = document.createElement('div');
    sortHeader.className =
        'pisi-sheet-view-rules-section-heading';
    sortHeader.append(
        sortTitle,
        addSort,
        clearSorts
    );
    sortSection.appendChild(sortHeader);

    const sortList = document.createElement('div');
    sortList.className =
        'pisi-sheet-sort-list';

    sorts.forEach((sort, index) => {
        sortList.appendChild(
            renderPisiSheetSortRow(
                table,
                sort,
                fields,
                index,
                sorts.length,
                renderPisiSheetViewRulesPanel
            )
        );
    });

    if (!sorts.length) {
        const empty = document.createElement('div');
        empty.className =
            'pisi-sheet-view-rules-empty';
        empty.textContent =
            pisiSheetRulesTranslate(
                'Sıralama yok'
            );
        sortList.appendChild(empty);
    }

    sortSection.appendChild(sortList);
    element.appendChild(sortSection);

    positionPisiSheetViewRulesPanel(
        element,
        state.anchor
    );
}

function openPisiSheetViewRulesPanel(
    table,
    anchor = null,
    options = {}
) {
    closePisiSheetViewRulesPanel();

    const element = document.createElement('div');
    element.className =
        'pisi-sheet-view-rules-panel';
    element.setAttribute('role', 'dialog');
    element.setAttribute(
        'aria-label',
        pisiSheetRulesTranslate(
            'View filtreleri ve sıralama'
        )
    );

    document.body.appendChild(element);

    pisiSheetViewRulesPanel = {
        table,
        anchor: anchor || table,
        element
    };

    if (
        options.fieldId &&
        getPisiSheetFilterConditionCount(
            getPisiSheetActiveViewFilters(table)
        ) === 0 &&
        options.addFilter === true
    ) {
        const database = getPisiSheetDatabase(table);
        const field = database?.fields?.find(
            (candidate) => (
                candidate.id === options.fieldId
            )
        );

        addPisiSheetViewFilterCondition(
            table,
            getPisiSheetActiveViewFilters(table).id,
            {
                fieldId: options.fieldId,
                operator:
                    getPisiSheetFilterDefaultOperator(
                        field
                    )
            }
        );
    }

    renderPisiSheetViewRulesPanel();
    return element;
}

document.addEventListener('pointerdown', (event) => {
    const state = pisiSheetViewRulesPanel;
    if (!state) return;

    if (
        event.target instanceof Node &&
        state.element.contains(event.target)
    ) {
        return;
    }

    if (
        event.target instanceof Node &&
        state.anchor?.contains?.(event.target)
    ) {
        return;
    }

    closePisiSheetViewRulesPanel();
}, true);

document.addEventListener('keydown', (event) => {
    if (
        event.key === 'Escape' &&
        pisiSheetViewRulesPanel
    ) {
        closePisiSheetViewRulesPanel();
    }
}, true);

window.addEventListener(
    'blur',
    closePisiSheetViewRulesPanel
);

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "openPisiSheetViewRulesPanel": {
        enumerable: true,
        get() { return openPisiSheetViewRulesPanel; }
    },
    "closePisiSheetViewRulesPanel": {
        enumerable: true,
        get() { return closePisiSheetViewRulesPanel; }
    },
    "renderPisiSheetViewRulesPanel": {
        enumerable: true,
        get() { return renderPisiSheetViewRulesPanel; }
    }
});
registerModule("editor.sheetViewRulesUi", moduleApi);
