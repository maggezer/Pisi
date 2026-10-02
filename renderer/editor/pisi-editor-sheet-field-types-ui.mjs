import { registerModule } from '../core/module-registry.mjs';
import { getPisiSheetTypedDisplayParts, normalizePisiSheetFieldOptions } from './pisi-editor-sheet-field-types-core.mjs';

let pisiSheetTypedEditor = null;

function getPisiSheetTypedLocale() {
    return window.pisiI18n?.getLanguage?.() === 'eng' ? 'en-GB' : 'tr-TR';
}

function clearPisiSheetTypedCellClasses(cell) {
    cell?.classList?.remove(
        'pisi-sheet-cell-typed',
        'pisi-sheet-cell-select',
        'pisi-sheet-cell-mselect',
        'pisi-sheet-cell-date',
        'pisi-sheet-cell-checkbox',
        'pisi-sheet-cell-number'
    );
}

function renderPisiSheetTypedCell(table, cell, rowIndex, colIndex, displayValue = undefined) {
    if (!table || !cell) return false;

    const field = getPisiSheetField(table, colIndex);
    if (!field) return false;

    const source = getPisiSheetCellSource(table, rowIndex, colIndex);
    const value = displayValue !== undefined ? displayValue : source.value;
    const parts = getPisiSheetTypedDisplayParts(field, value, getPisiSheetTypedLocale());

    clearPisiSheetTypedCellClasses(cell);
    cell.dataset.pisiSheetFieldType = String(field.type || 'text');
    cell.replaceChildren();

    if (field.type === 'number') {
        cell.classList.add('pisi-sheet-cell-typed', 'pisi-sheet-cell-number');
    } else if (field.type === 'date') {
        cell.classList.add('pisi-sheet-cell-typed', 'pisi-sheet-cell-date');
    } else if (field.type === 'select') {
        cell.classList.add('pisi-sheet-cell-typed', 'pisi-sheet-cell-select');
    } else if (field.type === 'mSelect') {
        cell.classList.add('pisi-sheet-cell-typed', 'pisi-sheet-cell-mselect');
    } else if (field.type === 'checkbox') {
        cell.classList.add('pisi-sheet-cell-typed', 'pisi-sheet-cell-checkbox');
    }

    if (parts.kind === 'checkbox') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-sheet-checkbox-control';
        button.dataset.pisiSheetCheckbox = '1';
        button.setAttribute('role', 'checkbox');
        button.setAttribute('aria-checked', parts.checked ? 'true' : 'false');
        button.textContent = parts.checked ? '✓' : '';
        cell.appendChild(button);
        return true;
    }

    if (parts.kind === 'chips') {
        for (const chip of parts.chips || []) {
            const span = document.createElement('span');
            span.className = 'pisi-sheet-option-chip';
            span.textContent = chip.label;
            span.dataset.pisiSheetOptionId = chip.id;
            span.style.setProperty('--pisi-sheet-chip-color', chip.color);
            cell.appendChild(span);
        }

        return true;
    }

    cell.textContent = parts.text || '';
    return true;
}

function closePisiSheetTypedCellEditor() {
    if (!pisiSheetTypedEditor) return;

    pisiSheetTypedEditor.element.remove();
    pisiSheetTypedEditor = null;
}

function positionPisiSheetTypedEditor(element, cell) {
    const rect = cell.getBoundingClientRect();
    const margin = 8;

    document.body.appendChild(element);

    const popupRect = element.getBoundingClientRect();

    element.style.left = String(Math.max(margin, Math.min(rect.left, window.innerWidth - popupRect.width - margin))) + 'px';

    element.style.top = String(Math.max(margin, Math.min(rect.bottom + 4, window.innerHeight - popupRect.height - margin))) + 'px';
}

function commitPisiSheetTypedValue(table, cell, rowIndex, colIndex, value) {
    setPisiSheetCellSource(table, rowIndex, colIndex, {
        value,
        formula: null
    });
    renderPisiSheetTypedCell(table, cell, rowIndex, colIndex);
    selectPisiSheetCell(cell);
    syncPisiSheetFormulaInput(cell);
    schedulePisiSheetEditorNotification(table);
}

function togglePisiSheetCheckboxCell(cell) {
    const table = cell?.closest?.('table[data-pisi-sheet]');
    const position = getPisiSheetCellPosition(cell);

    if (!table || !position) return false;

    const field = getPisiSheetField(table, position.col);

    if (field?.type !== 'checkbox') {
        return false;
    }

    const source = getPisiSheetCellSource(table, position.row, position.col);
    const next = source.value !== true;

    commitPisiSheetTypedValue(table, cell, position.row, position.col, next);

    return true;
}

function makePisiSheetOptionChoice(option, selected) {
    const button = document.createElement('button');
    const dot = document.createElement('span');
    const label = document.createElement('span');

    button.type = 'button';
    button.className = 'pisi-sheet-option-choice';
    button.dataset.pisiSheetOptionId = option.id;
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');

    dot.className = 'pisi-sheet-option-dot';
    dot.style.setProperty('--pisi-sheet-option-color', option.color);
    label.textContent = option.label;

    button.append(dot, label);
    return button;
}

function openPisiSheetSelectEditor(table, cell, position, field) {
    const source = getPisiSheetCellSource(table, position.row, position.col);
    const options = normalizePisiSheetFieldOptions(field.options);
    const popup = document.createElement('div');
    const list = document.createElement('div');
    const clear = document.createElement('button');

    popup.className = 'pisi-sheet-typed-editor pisi-sheet-select-editor';
    popup.setAttribute('role', 'dialog');
    list.className = 'pisi-sheet-option-choice-list';

    const isMulti = field.type === 'mSelect';
    const selected = new Set(isMulti && Array.isArray(source.value) ? source.value : source.value ? [String(source.value)] : []);

    if (!options.length) {
        const empty = document.createElement('div');
        empty.className = 'pisi-sheet-typed-editor-empty';
        empty.textContent = window.pisiT?.('Seçenek tanımlanmamış') || 'Seçenek tanımlanmamış';
        list.appendChild(empty);
    }

    for (const option of options) {
        const choice = makePisiSheetOptionChoice(option, selected.has(option.id));

        choice.addEventListener('click', () => {
            if (!isMulti) {
                commitPisiSheetTypedValue(table, cell, position.row, position.col, option.id);
                closePisiSheetTypedCellEditor();
                return;
            }

            if (selected.has(option.id)) {
                selected.delete(option.id);
            } else {
                selected.add(option.id);
            }

            choice.setAttribute('aria-pressed', selected.has(option.id) ? 'true' : 'false');

            commitPisiSheetTypedValue(table, cell, position.row, position.col, [...selected]);
        });

        list.appendChild(choice);
    }

    clear.type = 'button';
    clear.className = 'pisi-sheet-typed-editor-clear';
    clear.textContent = window.pisiT?.('Temizle') || 'Temizle';
    clear.addEventListener('click', () => {
        commitPisiSheetTypedValue(table, cell, position.row, position.col, isMulti ? [] : '');

        if (!isMulti) {
            closePisiSheetTypedCellEditor();
        } else {
            selected.clear();
            list.querySelectorAll('.pisi-sheet-option-choice').forEach((choice) => {
                choice.setAttribute('aria-pressed', 'false');
            });
        }
    });

    popup.append(list, clear);
    positionPisiSheetTypedEditor(popup, cell);

    pisiSheetTypedEditor = {
        table,
        cell,
        element: popup
    };

    popup.querySelector('button')?.focus();
}

function openPisiSheetDateEditor(table, cell, position) {
    const source = getPisiSheetCellSource(table, position.row, position.col);
    const popup = document.createElement('div');
    const input = document.createElement('input');
    const actions = document.createElement('div');
    const clear = document.createElement('button');
    const apply = document.createElement('button');

    popup.className = 'pisi-sheet-typed-editor pisi-sheet-date-editor';

    input.type = 'date';
    input.className = 'pisi-sheet-date-input';
    input.value = String(source.value || '');

    actions.className = 'pisi-sheet-typed-editor-actions';

    clear.type = 'button';
    clear.textContent = window.pisiT?.('Temizle') || 'Temizle';

    apply.type = 'button';
    apply.textContent = window.pisiT?.('Uygula') || 'Uygula';

    clear.addEventListener('click', () => {
        commitPisiSheetTypedValue(table, cell, position.row, position.col, '');
        closePisiSheetTypedCellEditor();
    });

    apply.addEventListener('click', () => {
        commitPisiSheetTypedValue(table, cell, position.row, position.col, input.value);
        closePisiSheetTypedCellEditor();
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            apply.click();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closePisiSheetTypedCellEditor();
        }
    });

    actions.append(clear, apply);
    popup.append(input, actions);

    positionPisiSheetTypedEditor(popup, cell);

    pisiSheetTypedEditor = {
        table,
        cell,
        element: popup
    };

    input.focus();
}

function beginPisiSheetTypedCellEdit(cell) {
    const table = cell?.closest?.('table[data-pisi-sheet]');
    const position = getPisiSheetCellPosition(cell);

    if (!table || !position) return false;

    const field = getPisiSheetField(table, position.col);
    const type = field?.type;

    if (!['date', 'select', 'mSelect', 'checkbox'].includes(type)) {
        return false;
    }

    closePisiSheetTypedCellEditor();
    selectPisiSheetCell(cell);

    if (type === 'checkbox') {
        togglePisiSheetCheckboxCell(cell);
        return true;
    }

    if (type === 'date') {
        openPisiSheetDateEditor(table, cell, position);
        return true;
    }

    openPisiSheetSelectEditor(table, cell, position, field);

    return true;
}

function isPisiSheetTypedEditorTarget(target) {
    return Boolean(target instanceof Element && target.closest('.pisi-sheet-typed-editor'));
}

document.addEventListener(
    'pointerdown',
    (event) => {
        if (!pisiSheetTypedEditor) return;
        if (isPisiSheetTypedEditorTarget(event.target)) {
            return;
        }

        if (event.target instanceof Node && pisiSheetTypedEditor.cell.contains(event.target)) {
            return;
        }

        closePisiSheetTypedCellEditor();
    },
    true
);

document.addEventListener(
    'keydown',
    (event) => {
        if (event.key === 'Escape' && pisiSheetTypedEditor) {
            closePisiSheetTypedCellEditor();
        }
    },
    true
);

const moduleApi = {};
Object.defineProperties(moduleApi, {
    renderPisiSheetTypedCell: {
        enumerable: true,
        get() {
            return renderPisiSheetTypedCell;
        }
    },
    beginPisiSheetTypedCellEdit: {
        enumerable: true,
        get() {
            return beginPisiSheetTypedCellEdit;
        }
    },
    togglePisiSheetCheckboxCell: {
        enumerable: true,
        get() {
            return togglePisiSheetCheckboxCell;
        }
    },
    closePisiSheetTypedCellEditor: {
        enumerable: true,
        get() {
            return closePisiSheetTypedCellEditor;
        }
    },
    isPisiSheetTypedEditorTarget: {
        enumerable: true,
        get() {
            return isPisiSheetTypedEditorTarget;
        }
    }
});
registerModule('editor.sheetFieldTypesUi', moduleApi);
