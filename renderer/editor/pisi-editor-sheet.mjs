import { registerModule } from "../core/module-registry.mjs";

function runPisiExcelAction(toolbar, action) {
    const editor = getPisiToolbarEditor(toolbar);
    if (!editor) return;

    if (action === 'insertTable') {
        const rows = Math.max(1, Math.min(80, getPisiToolbarNumber(toolbar, '[data-pisi-excel-rows]', 5)));
        const cols = Math.max(1, Math.min(26, getPisiToolbarNumber(toolbar, '[data-pisi-excel-cols]', 5)));
        insertPisiSheet(editor, rows, cols);
        return;
    }

    const table = getActivePisiSheetForEditor(editor);
    if (!table) return;

    if (action === 'addRow') {
        addPisiSheetRow(table);
    } else if (action === 'addCol') {
        addPisiSheetColumn(table);
    } else if (action === 'recalc') {
        recalcPisiSheet(table);
    } else if (action === 'applyFormula') {
        const input = toolbar.querySelector('[data-pisi-excel-formula]');
        applyPisiSheetFormula(table, input?.value || '');
    }

    notifyPisiEditorChanged(editor);
}

function insertPisiSheet(editor, rows = 5, cols = 5) {
    const html = `
        <div class="pisi-sheet-block" contenteditable="false" data-pisi-sheet-block="1">
            ${buildPisiSheetHtml(rows, cols)}
        </div>
        <div><br></div>
    `;

    insertHtmlIntoPisiEditor(editor, html);
    initializePisiAdvancedEditorContent(editor);
    notifyPisiEditorChanged(editor);
}

function buildPisiSheetHtml(rows, cols) {
    let head = '<thead><tr><th></th>';
    for (let col = 0; col < cols; col += 1) {
        head += `<th>${pisiColumnName(col)}</th>`;
    }
    head += '</tr></thead>';

    let body = '<tbody>';
    for (let row = 0; row < rows; row += 1) {
        body += `<tr><th>${row + 1}</th>`;
        for (let col = 0; col < cols; col += 1) {
            body += `<td contenteditable="true" data-row="${row}" data-col="${col}" data-cell="${pisiColumnName(col)}${row + 1}"></td>`;
        }
        body += '</tr>';
    }
    body += '</tbody>';

    return `<table class="pisi-sheet-table" data-pisi-sheet="1">${head}${body}</table>`;
}

const PISI_SHEET_MAX_ROWS = 80;

const PISI_SHEET_MAX_COLS = 26;

const PISI_SHEET_MAX_RANGE_CELLS =
    PISI_SHEET_MAX_ROWS * PISI_SHEET_MAX_COLS;

const pisiBoundSheets = new WeakSet();

const pisiEditedSheetCells = new WeakSet();

function hydratePisiSheets(root = document) {
    root.querySelectorAll('table[data-pisi-sheet]').forEach((table) => {
        table.removeAttribute('data-pisi-sheet-bound');
        refreshPisiSheetCellMetadata(table);

        if (pisiBoundSheets.has(table)) return;
        pisiBoundSheets.add(table);

        table.addEventListener('focusin', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell) return;
            selectPisiSheetCell(cell);
        });

        table.addEventListener('click', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell) return;
            selectPisiSheetCell(cell);
        });

        table.addEventListener('keydown', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell) return;

            if (event.key === 'Enter') {
                event.preventDefault();
                cell.blur();
            }
        });

        table.addEventListener('input', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell) return;
            pisiEditedSheetCells.add(cell);
        });

        table.addEventListener('blur', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell) return;

            commitPisiSheetCell(cell);
            recalcPisiSheet(table);
            notifyPisiEditorChanged(getEditorForPisiElement(table));
        }, true);
    });
}

function selectPisiSheetCell(cell) {
    document.querySelectorAll('.pisi-sheet-cell-selected').forEach((existing) => {
        existing.classList.remove('pisi-sheet-cell-selected');
    });

    cell.classList.add('pisi-sheet-cell-selected');
    window.__pisiActiveSheetCell = cell;

    const toolbar = document.querySelector(`.pisi-editor-toolbar[data-editor-target="${getEditorForPisiElement(cell)?.id}"]`);
    const formulaInput = toolbar?.querySelector('[data-pisi-excel-formula]');

    if (formulaInput) {
        formulaInput.value = cell.dataset.formula || cell.textContent.trim();
    }
}

function getActivePisiSheetForEditor(editor) {
    const activeCell = window.__pisiActiveSheetCell;

    if (activeCell && editor.contains(activeCell)) {
        return activeCell.closest('table[data-pisi-sheet]');
    }

    return editor.querySelector('table[data-pisi-sheet]');
}

function applyPisiSheetFormula(table, formula) {
    const activeCell = window.__pisiActiveSheetCell;
    const cell = activeCell && table.contains(activeCell)
        ? activeCell
        : table.querySelector('td[data-cell]');

    if (!cell) return;

    const value = String(formula || '').trim();

    if (value.startsWith('=')) {
        cell.dataset.formula = value;
    } else {
        delete cell.dataset.formula;
        cell.textContent = value;
    }

    recalcPisiSheet(table);
    selectPisiSheetCell(cell);
}

function commitPisiSheetCell(cell) {
    const value = cell.textContent.trim();
    const wasEdited = pisiEditedSheetCells.has(cell);

    if (value.startsWith('=')) {
        cell.dataset.formula = value;
    } else if (wasEdited) {
        delete cell.dataset.formula;
        cell.textContent = value;
    } else if (!cell.dataset.formula) {
        cell.textContent = value;
    }

    pisiEditedSheetCells.delete(cell);
}

function recalcPisiSheet(table) {
    if (!table) return;

    refreshPisiSheetCellMetadata(table);

    const cells = Array.from(table.querySelectorAll('td[data-cell]'));

    for (const cell of cells) {
        if (cell.dataset.formula) {
            const value = evaluatePisiSheetFormula(table, cell.dataset.formula, new Set([cell.dataset.cell]));
            cell.textContent = Number.isFinite(value) ? formatPisiSheetNumber(value) : '#ERR';
        }
    }
}

function evaluatePisiSheetFormula(table, formula, stack = new Set()) {
    let expression = String(formula || '').trim();
    if (expression.startsWith('=')) expression = expression.slice(1);

    let formulaError = false;

    expression = expression.replace(/\b(SUM|AVG|MIN|MAX|COUNT)\(([A-Z]+\d+)(?::([A-Z]+\d+))?\)/gi, (_, fn, startRef, endRef) => {
        const range = getPisiSheetRangeValues(
            table,
            startRef,
            endRef || startRef,
            stack
        );

        if (range.error) {
            formulaError = true;
            return '0';
        }

        const values = range.values;
        const upper = fn.toUpperCase();

        if (upper === 'SUM') return String(values.reduce((a, b) => a + b, 0));
        if (upper === 'COUNT') return String(values.length);

        if (!values.length) {
            formulaError = true;
            return '0';
        }

        if (upper === 'AVG') return String(values.reduce((a, b) => a + b, 0) / values.length);
        if (upper === 'MIN') return String(Math.min(...values));
        if (upper === 'MAX') return String(Math.max(...values));
        return '0';
    });

    expression = expression.replace(/\b([A-Z]+\d+)\b/g, (_, ref) => {
        const value = getPisiSheetCellNumericValue(
            table,
            ref.toUpperCase(),
            stack
        );

        if (!Number.isFinite(value)) {
            formulaError = true;
            return '0';
        }

        return String(value);
    });

    if (
        formulaError ||
        !/^[0-9+\-*/().\s]+$/.test(expression)
    ) {
        return NaN;
    }

    return evaluatePisiArithmeticExpression(expression);
}

function evaluatePisiArithmeticExpression(expression) {
    const input = String(expression || '');
    let index = 0;

    function skipWhitespace() {
        while (/\s/.test(input[index] || '')) index += 1;
    }

    function parseNumber() {
        skipWhitespace();
        const match = input.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
        if (!match) return NaN;
        index += match[0].length;
        return Number(match[0]);
    }

    function parsePrimary() {
        skipWhitespace();

        if (input[index] === '(') {
            index += 1;
            const value = parseExpression();
            skipWhitespace();

            if (input[index] !== ')') return NaN;
            index += 1;
            return value;
        }

        return parseNumber();
    }

    function parseFactor() {
        skipWhitespace();

        if (input[index] === '+' || input[index] === '-') {
            const sign = input[index];
            index += 1;
            const value = parseFactor();
            return sign === '-' ? -value : value;
        }

        return parsePrimary();
    }

    function parseTerm() {
        let value = parseFactor();

        while (Number.isFinite(value)) {
            skipWhitespace();
            const operator = input[index];
            if (operator !== '*' && operator !== '/') break;
            index += 1;

            const right = parseFactor();
            if (!Number.isFinite(right)) return NaN;
            if (operator === '/' && right === 0) return NaN;
            value = operator === '*' ? value * right : value / right;
        }

        return value;
    }

    function parseExpression() {
        let value = parseTerm();

        while (Number.isFinite(value)) {
            skipWhitespace();
            const operator = input[index];
            if (operator !== '+' && operator !== '-') break;
            index += 1;

            const right = parseTerm();
            if (!Number.isFinite(right)) return NaN;
            value = operator === '+' ? value + right : value - right;
        }

        return value;
    }

    const result = parseExpression();
    skipWhitespace();

    return Number.isFinite(result) && index === input.length
        ? result
        : NaN;
}

function getPisiSheetCellNumericValue(table, ref, stack = new Set()) {
    const result = getPisiSheetCellValue(table, ref, stack);
    return result.error ? NaN : result.value;
}

function getPisiSheetCellValue(table, ref, stack = new Set()) {
    const cell = table.querySelector(`td[data-cell="${ref}"]`);
    if (!cell) {
        return {
            value: NaN,
            numeric: false,
            error: true
        };
    }

    if (cell.dataset.formula) {
        if (stack.has(ref)) {
            return {
                value: NaN,
                numeric: false,
                error: true
            };
        }

        const nextStack = new Set(stack);
        nextStack.add(ref);
        const value = evaluatePisiSheetFormula(
            table,
            cell.dataset.formula,
            nextStack
        );

        return {
            value,
            numeric: Number.isFinite(value),
            error: !Number.isFinite(value)
        };
    }

    const text = String(cell.textContent || '').trim();

    if (!text) {
        return {
            value: 0,
            numeric: false,
            error: false
        };
    }

    const numeric = Number(text.replace(',', '.'));

    return {
        value: Number.isFinite(numeric) ? numeric : 0,
        numeric: Number.isFinite(numeric),
        error: false
    };
}

function getPisiSheetRangeValues(table, startRef, endRef, stack = new Set()) {
    const start = parsePisiCellRef(startRef);
    const end = parsePisiCellRef(endRef);
    const rows = table.querySelectorAll('tbody tr');
    const rowCount = rows.length;
    const colCount = Math.max(
        0,
        ...Array.from(rows).map((row) => row.querySelectorAll('td').length)
    );

    if (
        !start ||
        !end ||
        start.row < 0 ||
        end.row < 0 ||
        start.col < 0 ||
        end.col < 0 ||
        start.row >= rowCount ||
        end.row >= rowCount ||
        start.col >= colCount ||
        end.col >= colCount
    ) {
        return {
            values: [],
            error: true
        };
    }

    const values = [];
    const rowMin = Math.min(start.row, end.row);
    const rowMax = Math.max(start.row, end.row);
    const colMin = Math.min(start.col, end.col);
    const colMax = Math.max(start.col, end.col);
    const rangeSize =
        (rowMax - rowMin + 1) *
        (colMax - colMin + 1);

    if (rangeSize > PISI_SHEET_MAX_RANGE_CELLS) {
        return {
            values: [],
            error: true
        };
    }

    for (let row = rowMin; row <= rowMax; row += 1) {
        for (let col = colMin; col <= colMax; col += 1) {
            const result = getPisiSheetCellValue(
                table,
                `${pisiColumnName(col)}${row + 1}`,
                stack
            );

            if (result.error) {
                return {
                    values: [],
                    error: true
                };
            }

            if (result.numeric) {
                values.push(result.value);
            }
        }
    }

    return {
        values,
        error: false
    };
}

function parsePisiCellRef(ref) {
    const match = String(ref || '').toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;

    return {
        col: pisiColumnIndex(match[1]),
        row: Number(match[2]) - 1
    };
}

function pisiColumnName(index) {
    let name = '';
    let n = Number(index) + 1;

    while (n > 0) {
        const rem = (n - 1) % 26;
        name = String.fromCharCode(65 + rem) + name;
        n = Math.floor((n - 1) / 26);
    }

    return name;
}

function pisiColumnIndex(name) {
    return String(name || '').toUpperCase().split('').reduce((sum, char) => {
        return sum * 26 + char.charCodeAt(0) - 64;
    }, 0) - 1;
}

function formatPisiSheetNumber(value) {
    if (!Number.isFinite(value)) return '#ERR';
    if (Math.abs(value - Math.round(value)) < 1e-10) return String(Math.round(value));
    return String(Math.round(value * 1000000) / 1000000);
}

function refreshPisiSheetCellMetadata(table) {
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    rows.forEach((row, rowIndex) => {
        let rowHeader = row.querySelector('th');
        if (!rowHeader) {
            rowHeader = document.createElement('th');
            row.prepend(rowHeader);
        }
        rowHeader.textContent = String(rowIndex + 1);

        Array.from(row.querySelectorAll('td')).forEach((cell, colIndex) => {
            cell.setAttribute('contenteditable', 'true');
            cell.dataset.row = String(rowIndex);
            cell.dataset.col = String(colIndex);
            cell.dataset.cell = `${pisiColumnName(colIndex)}${rowIndex + 1}`;
        });
    });

    const colCount = Math.max(0, ...rows.map((row) => row.querySelectorAll('td').length));
    let thead = table.querySelector('thead');
    if (!thead) {
        thead = document.createElement('thead');
        table.prepend(thead);
    }

    let headerRow = thead.querySelector('tr');
    if (!headerRow) {
        headerRow = document.createElement('tr');
        thead.appendChild(headerRow);
    }

    headerRow.innerHTML = '<th></th>' + Array.from({ length: colCount }, (_, index) => `<th>${pisiColumnName(index)}</th>`).join('');
}

function addPisiSheetRow(table) {
    const tbody = table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));
    if (tbody.querySelectorAll('tr').length >= PISI_SHEET_MAX_ROWS) return false;

    const colCount = Math.max(1, table.querySelector('tbody tr')?.querySelectorAll('td').length || 1);
    const row = document.createElement('tr');
    row.innerHTML = '<th></th>' + Array.from({ length: colCount }, () => '<td contenteditable="true"></td>').join('');
    tbody.appendChild(row);
    refreshPisiSheetCellMetadata(table);
    return true;
}

function addPisiSheetColumn(table) {
    const tbody = table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));
    const currentColCount =
        tbody.querySelector('tr')?.querySelectorAll('td').length || 0;

    if (currentColCount >= PISI_SHEET_MAX_COLS) return false;

    if (!tbody.querySelector('tr')) {
        addPisiSheetRow(table);
        return true;
    }

    tbody.querySelectorAll('tr').forEach((row) => {
        const cell = document.createElement('td');
        cell.setAttribute('contenteditable', 'true');
        row.appendChild(cell);
    });

    refreshPisiSheetCellMetadata(table);
    return true;
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "runPisiExcelAction": {
        enumerable: true,
        get() { return runPisiExcelAction; }
    },
    "insertPisiSheet": {
        enumerable: true,
        get() { return insertPisiSheet; }
    },
    "buildPisiSheetHtml": {
        enumerable: true,
        get() { return buildPisiSheetHtml; }
    },
    "PISI_SHEET_MAX_ROWS": {
        enumerable: true,
        get() { return PISI_SHEET_MAX_ROWS; }
    },
    "PISI_SHEET_MAX_COLS": {
        enumerable: true,
        get() { return PISI_SHEET_MAX_COLS; }
    },
    "PISI_SHEET_MAX_RANGE_CELLS": {
        enumerable: true,
        get() { return PISI_SHEET_MAX_RANGE_CELLS; }
    },
    "pisiBoundSheets": {
        enumerable: true,
        get() { return pisiBoundSheets; }
    },
    "pisiEditedSheetCells": {
        enumerable: true,
        get() { return pisiEditedSheetCells; }
    },
    "hydratePisiSheets": {
        enumerable: true,
        get() { return hydratePisiSheets; }
    },
    "selectPisiSheetCell": {
        enumerable: true,
        get() { return selectPisiSheetCell; }
    },
    "getActivePisiSheetForEditor": {
        enumerable: true,
        get() { return getActivePisiSheetForEditor; }
    },
    "applyPisiSheetFormula": {
        enumerable: true,
        get() { return applyPisiSheetFormula; }
    },
    "commitPisiSheetCell": {
        enumerable: true,
        get() { return commitPisiSheetCell; }
    },
    "recalcPisiSheet": {
        enumerable: true,
        get() { return recalcPisiSheet; }
    },
    "evaluatePisiSheetFormula": {
        enumerable: true,
        get() { return evaluatePisiSheetFormula; }
    },
    "evaluatePisiArithmeticExpression": {
        enumerable: true,
        get() { return evaluatePisiArithmeticExpression; }
    },
    "getPisiSheetCellNumericValue": {
        enumerable: true,
        get() { return getPisiSheetCellNumericValue; }
    },
    "getPisiSheetCellValue": {
        enumerable: true,
        get() { return getPisiSheetCellValue; }
    },
    "getPisiSheetRangeValues": {
        enumerable: true,
        get() { return getPisiSheetRangeValues; }
    },
    "parsePisiCellRef": {
        enumerable: true,
        get() { return parsePisiCellRef; }
    },
    "pisiColumnName": {
        enumerable: true,
        get() { return pisiColumnName; }
    },
    "pisiColumnIndex": {
        enumerable: true,
        get() { return pisiColumnIndex; }
    },
    "formatPisiSheetNumber": {
        enumerable: true,
        get() { return formatPisiSheetNumber; }
    },
    "refreshPisiSheetCellMetadata": {
        enumerable: true,
        get() { return refreshPisiSheetCellMetadata; }
    },
    "addPisiSheetRow": {
        enumerable: true,
        get() { return addPisiSheetRow; }
    },
    "addPisiSheetColumn": {
        enumerable: true,
        get() { return addPisiSheetColumn; }
    }
});
registerModule("editor.sheet", moduleApi);
