import { PISI_SHEET_CONDITIONAL_COLOR_TONES } from './pisi-editor-sheet-view-query-core.mjs';
import {
    addPisiSheetViewConditionalColor,
    movePisiSheetViewConditionalColor,
    removePisiSheetViewConditionalColor,
    setPisiSheetViewConditionalColors,
    updatePisiSheetViewConditionalColor
} from './pisi-editor-sheet-view-query.mjs';

const PISI_SHEET_CONDITIONAL_COLOR_TONE_LABELS = Object.freeze({
    red: 'Kırmızı',
    orange: 'Turuncu',
    yellow: 'Sarı',
    green: 'Yeşil',
    blue: 'Mavi',
    purple: 'Mor',
    gray: 'Gri'
});

function renderPisiSheetConditionalColorRow(options) {
    const { table, rule, fields, index, count, rerender, helpers } = options;
    const { translate, makeButton, makeFieldSelect, makeOperatorSelect, makeValueControl, getDefaultOperator } = helpers;
    const row = document.createElement('div');
    const field = fields.find((candidate) => candidate.id === rule.fieldId) || fields[0];
    const fieldSelect = makeFieldSelect(fields, field?.id);
    const operatorSelect = makeOperatorSelect(field, rule.operator);
    const target = document.createElement('select');
    const tone = document.createElement('select');
    const up = makeButton('↑', 'icon');
    const down = makeButton('↓', 'icon');
    const remove = makeButton('Sil', 'icon danger');

    row.className = 'pisi-sheet-conditional-color-row';
    row.dataset.pisiSheetConditionalColorId = rule.id;

    target.className = 'pisi-sheet-view-rules-select pisi-sheet-conditional-target';
    [
        ['row', 'Satır'],
        ['cell', 'Hücre']
    ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = translate(label);
        target.appendChild(option);
    });
    target.value = rule.target || 'row';

    tone.className = 'pisi-sheet-view-rules-select pisi-sheet-conditional-tone';
    PISI_SHEET_CONDITIONAL_COLOR_TONES.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = translate(PISI_SHEET_CONDITIONAL_COLOR_TONE_LABELS[value] || value);
        tone.appendChild(option);
    });
    tone.value = rule.tone || 'red';

    up.disabled = index === 0;
    down.disabled = index === count - 1;

    fieldSelect.addEventListener('change', () => {
        const nextField = fields.find((candidate) => candidate.id === fieldSelect.value);

        updatePisiSheetViewConditionalColor(table, rule.id, {
            fieldId: fieldSelect.value,
            operator: getDefaultOperator(nextField),
            value: ''
        });
        rerender();
    });

    operatorSelect.addEventListener('change', () => {
        updatePisiSheetViewConditionalColor(table, rule.id, { operator: operatorSelect.value });
        rerender();
    });

    const valueControl = makeValueControl(
        field,
        {
            ...rule,
            operator: operatorSelect.value
        },
        (value) => {
            updatePisiSheetViewConditionalColor(table, rule.id, { value });
            rerender();
        }
    );

    target.addEventListener('change', () => {
        updatePisiSheetViewConditionalColor(table, rule.id, { target: target.value });
        rerender();
    });

    tone.addEventListener('change', () => {
        updatePisiSheetViewConditionalColor(table, rule.id, { tone: tone.value });
        rerender();
    });

    up.addEventListener('click', () => {
        movePisiSheetViewConditionalColor(table, rule.id, -1);
        rerender();
    });

    down.addEventListener('click', () => {
        movePisiSheetViewConditionalColor(table, rule.id, 1);
        rerender();
    });

    remove.addEventListener('click', () => {
        removePisiSheetViewConditionalColor(table, rule.id);
        rerender();
    });

    row.append(fieldSelect, operatorSelect, valueControl, target, tone, up, down, remove);

    return row;
}

function renderPisiSheetConditionalColorsSection(options) {
    const { table, fields, rules, rerender, helpers } = options;
    const { translate, makeButton, getDefaultOperator } = helpers;
    const section = document.createElement('section');
    const title = document.createElement('h4');
    const add = makeButton('+ Renk kuralı', 'compact');
    const clear = makeButton('Renk kurallarını temizle', 'compact');

    section.className = 'pisi-sheet-view-rules-section';
    title.textContent = translate('Koşullu renkler');

    add.disabled = !fields.length || rules.length >= 50;

    add.addEventListener('click', () => {
        const field = fields[0];
        if (!field) return;

        addPisiSheetViewConditionalColor(table, {
            fieldId: field.id,
            operator: getDefaultOperator(field),
            target: 'row',
            tone: 'red'
        });
        rerender();
    });

    clear.disabled = rules.length === 0;
    clear.addEventListener('click', () => {
        setPisiSheetViewConditionalColors(table, []);
        rerender();
    });

    const header = document.createElement('div');
    header.className = 'pisi-sheet-view-rules-section-heading';
    header.append(title, add, clear);
    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'pisi-sheet-conditional-color-list';

    rules.forEach((rule, index) => {
        list.appendChild(
            renderPisiSheetConditionalColorRow({
                table,
                rule,
                fields,
                index,
                count: rules.length,
                rerender,
                helpers
            })
        );
    });

    if (!rules.length) {
        const empty = document.createElement('div');
        empty.className = 'pisi-sheet-view-rules-empty';
        empty.textContent = translate('Renk kuralı yok');
        list.appendChild(empty);
    }

    section.appendChild(list);
    return section;
}

export { renderPisiSheetConditionalColorsSection };
