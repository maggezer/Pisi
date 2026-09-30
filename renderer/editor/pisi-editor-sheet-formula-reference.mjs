import { registerModule } from "../core/module-registry.mjs";

let pisiSheetFormulaReferenceSession = null;
let pisiActiveSheetFormulaInput = null;

function getPisiSheetFormulaInputEditor(input) {
    const toolbar = input?.closest?.(
        '.pisi-editor-toolbar, .pisi-word-toolbar'
    );
    const targetId = toolbar?.dataset?.editorTarget;

    return targetId
        ? document.getElementById(targetId)
        : null;
}

function isPisiSheetFormulaInputForTable(input, table) {
    if (
        !(input instanceof HTMLInputElement) ||
        !input.matches('[data-pisi-excel-formula]') ||
        !String(input.value || '').trimStart().startsWith('=')
    ) {
        return false;
    }

    const editor = getPisiSheetFormulaInputEditor(input);

    return Boolean(
        editor &&
        table &&
        editor.contains(table)
    );
}

function getPisiSheetFormulaInputForTable(table) {
    const focused = document.activeElement;

    if (isPisiSheetFormulaInputForTable(focused, table)) {
        pisiActiveSheetFormulaInput = focused;
        return focused;
    }

    return isPisiSheetFormulaInputForTable(
        pisiActiveSheetFormulaInput,
        table
    )
        ? pisiActiveSheetFormulaInput
        : null;
}

function trackPisiSheetFormulaInput(event) {
    const input = event.target;

    if (
        !(input instanceof HTMLInputElement) ||
        !input.matches('[data-pisi-excel-formula]')
    ) {
        return;
    }

    if (
        String(input.value || '').trimStart().startsWith('=')
    ) {
        pisiActiveSheetFormulaInput = input;
    } else if (pisiActiveSheetFormulaInput === input) {
        pisiActiveSheetFormulaInput = null;
    }
}

function clearPisiSheetFormulaInputSession(input = null) {
    if (
        !input ||
        pisiActiveSheetFormulaInput === input
    ) {
        pisiActiveSheetFormulaInput = null;
    }
}

document.addEventListener(
    'focusin',
    trackPisiSheetFormulaInput,
    true
);
document.addEventListener(
    'input',
    trackPisiSheetFormulaInput,
    true
);

function pisiSheetPointToReference(point) {
    if (!point) return '';

    return (
        pisiColumnName(point.col) +
        String(point.row + 1)
    );
}

function pisiSheetPointsToReference(anchor, focus) {
    const start = pisiSheetPointToReference(anchor);
    const end = pisiSheetPointToReference(focus);

    if (!start || !end) return '';
    return start === end ? start : start + ':' + end;
}

function getPisiSheetEditableCaretOffset(cell) {
    const text = String(cell?.textContent || '');
    const selection = window.getSelection?.();

    if (!cell || !selection || selection.rangeCount < 1) {
        return text.length;
    }

    const range = selection.getRangeAt(0);

    if (!cell.contains(range.startContainer)) {
        return text.length;
    }

    const before = document.createRange();
    before.selectNodeContents(cell);

    try {
        before.setEnd(
            range.startContainer,
            range.startOffset
        );
    } catch {
        return text.length;
    }

    return Math.max(
        0,
        Math.min(text.length, before.toString().length)
    );
}

function setPisiSheetEditableCaretOffset(cell, offset) {
    if (!cell) return;

    const text = String(cell.textContent || '');
    const safeOffset = Math.max(
        0,
        Math.min(text.length, Number(offset) || 0)
    );

    if (!cell.firstChild) {
        cell.appendChild(document.createTextNode(text));
    }

    const textNode = Array.from(cell.childNodes).find(
        (node) => node.nodeType === Node.TEXT_NODE
    );

    if (!textNode) return;

    cell.focus({ preventScroll: true });

    const range = document.createRange();
    const selection = window.getSelection?.();

    range.setStart(
        textNode,
        Math.min(safeOffset, textNode.textContent.length)
    );
    range.collapse(true);

    selection?.removeAllRanges();
    selection?.addRange(range);
}

function isPisiSheetCellReferenceExpression(editState) {
    const text = String(
        editState?.cell?.textContent || ''
    );

    if (editState?.forceFormula === true) {
        return true;
    }

    const trimmed = text.trimStart();

    return (
        trimmed.startsWith('=') ||
        /[+\-*/^(:,;=<>]\s*$/.test(text)
    );
}

function createPisiSheetCellReferenceTarget(
    table,
    clickedCell
) {
    const editState = getPisiSheetCellEditState(table);

    if (
        !editState ||
        editState.cell === clickedCell ||
        !isPisiSheetCellReferenceExpression(editState)
    ) {
        return null;
    }

    const activePoint = getPisiSheetCellPosition(
        editState.cell
    );

    if (!activePoint) return null;

    const start = getPisiSheetEditableCaretOffset(
        editState.cell
    );

    return {
        kind: 'cell',
        editCell: editState.cell,
        activePoint,
        start,
        end: start
    };
}

function createPisiSheetInputReferenceTarget(table) {
    const input = getPisiSheetFormulaInputForTable(table);

    if (!input) return null;

    const start = Number.isInteger(input.selectionStart)
        ? input.selectionStart
        : input.value.length;
    const end = Number.isInteger(input.selectionEnd)
        ? input.selectionEnd
        : start;

    return {
        kind: 'input',
        input,
        activePoint:
            getPisiSheetActivePoint(table),
        start,
        end
    };
}

function writePisiSheetFormulaReference(session, focus) {
    const reference = pisiSheetPointsToReference(
        session.anchor,
        focus
    );
    if (!reference) return false;

    if (session.kind === 'cell') {
        const cell = session.editCell;
        const text = String(cell.textContent || '');
        const before = text.slice(0, session.start);
        const after = text.slice(session.end);

        cell.textContent = before + reference + after;
        session.end = session.start + reference.length;

        markPisiSheetCellEditFormulaReference(
            session.table
        );
        setPisiSheetEditableCaretOffset(
            cell,
            session.end
        );
        return true;
    }

    const input = session.input;
    const before = input.value.slice(0, session.start);
    const after = input.value.slice(session.end);

    input.value = before + reference + after;
    session.end = session.start + reference.length;

    input.setSelectionRange(
        session.end,
        session.end
    );
    input.dispatchEvent(
        new Event('input', { bubbles: true })
    );

    return true;
}

function beginPisiSheetFormulaReferencePick(
    table,
    cell,
    event
) {
    const point = getPisiSheetCellPosition(cell);
    if (!point) return false;

    const currentSession =
        pisiSheetFormulaReferenceSession;
    const editState = getPisiSheetCellEditState(table);
    const reusableCellTarget =
        currentSession?.kind === 'cell' &&
        currentSession.table === table &&
        editState?.cell === currentSession.editCell &&
        currentSession.editCell !== cell
            ? {
                kind: 'cell',
                editCell: currentSession.editCell,
                activePoint: currentSession.activePoint,
                start: currentSession.start,
                end: currentSession.end
            }
            : null;

    const target =
        reusableCellTarget ||
        createPisiSheetCellReferenceTarget(
            table,
            cell
        ) ||
        createPisiSheetInputReferenceTarget(table);

    if (!target) return false;

    event?.preventDefault?.();
    event?.stopPropagation?.();

    pisiSheetFormulaReferenceSession = {
        table,
        ...target,
        anchor: point,
        focus: point,
        pointerActive: true
    };

    table.classList.add(
        'pisi-sheet-formula-reference-mode'
    );

    const activePoint = target.activePoint || point;

    setPisiSheetSelectionState(table, {
        mode: 'range',
        anchor: point,
        focus: point,
        active: activePoint
    });
    syncPisiSheetSelectionProjection(table);

    writePisiSheetFormulaReference(
        pisiSheetFormulaReferenceSession,
        point
    );

    if (target.kind === 'cell') {
        setPisiSheetEditableCaretOffset(
            target.editCell,
            pisiSheetFormulaReferenceSession.end
        );
    } else {
        target.input.focus({ preventScroll: true });
    }

    return true;
}

function updatePisiSheetFormulaReferencePick(
    table,
    cell,
    event
) {
    const session = pisiSheetFormulaReferenceSession;

    if (
        !session ||
        session.table !== table ||
        !(event?.buttons & 1)
    ) {
        return false;
    }

    const point = getPisiSheetCellPosition(cell);
    if (!point) return false;

    if (
        session.focus.rowId === point.rowId &&
        session.focus.colId === point.colId
    ) {
        return true;
    }

    event.preventDefault();
    session.focus = point;

    setPisiSheetSelectionState(table, {
        mode: 'range',
        anchor: session.anchor,
        focus: point,
        active: session.activePoint || point
    });
    syncPisiSheetSelectionProjection(table);
    writePisiSheetFormulaReference(session, point);
    return true;
}

function movePisiSheetFormulaReferenceByKeyboard(
    table,
    key,
    options = {}
) {
    const session = pisiSheetFormulaReferenceSession;

    if (
        !session ||
        session.kind !== 'cell' ||
        session.table !== table
    ) {
        return false;
    }

    const deltas = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1]
    };
    const delta = deltas[key];

    if (!delta) return false;

    const dimensions = getPisiSheetDimensions(table);
    const current = session.focus;
    const next = getPisiSheetPointByIndex(
        table,
        Math.max(
            0,
            Math.min(
                dimensions.rows - 1,
                current.row + delta[0]
            )
        ),
        Math.max(
            0,
            Math.min(
                dimensions.cols - 1,
                current.col + delta[1]
            )
        )
    );

    if (!next) return false;

    session.keyboardNavigating = true;

    try {
        if (options.extend !== true) {
            session.anchor = next;
        }

        session.focus = next;

        setPisiSheetRangeSelection(
            table,
            session.anchor,
            next,
            {
                mode: 'range',
                active: session.activePoint || next,
                ensureVisible: true
            }
        );

        writePisiSheetFormulaReference(session, next);
        setPisiSheetEditableCaretOffset(
            session.editCell,
            session.end
        );
    } finally {
        session.keyboardNavigating = false;
    }

    return true;
}

function isPisiSheetFormulaReferenceKeyboardNavigationActive(
    table
) {
    return Boolean(
        pisiSheetFormulaReferenceSession &&
        pisiSheetFormulaReferenceSession.table === table &&
        pisiSheetFormulaReferenceSession.keyboardNavigating === true
    );
}

function closePisiSheetFormulaReferenceSession(
    table = null
) {
    const session = pisiSheetFormulaReferenceSession;

    if (
        !session ||
        (table && session.table !== table)
    ) {
        return false;
    }

    pisiSheetFormulaReferenceSession = null;
    session.table.classList.remove(
        'pisi-sheet-formula-reference-mode'
    );

    return true;
}

function finishPisiSheetFormulaReferencePick() {
    const session = pisiSheetFormulaReferenceSession;
    if (!session) return false;

    if (session.kind === 'cell') {
        session.pointerActive = false;

        setPisiSheetEditableCaretOffset(
            session.editCell,
            session.end
        );
        return true;
    }

    pisiSheetFormulaReferenceSession = null;
    session.table.classList.remove(
        'pisi-sheet-formula-reference-mode'
    );

    session.input.focus({ preventScroll: true });
    session.input.setSelectionRange(
        session.end,
        session.end
    );

    return true;
}

function isPisiSheetFormulaReferencePicking(table) {
    return Boolean(
        pisiSheetFormulaReferenceSession &&
        pisiSheetFormulaReferenceSession.table === table
    );
}

function handlePisiSheetFormulaReferenceKeydown(event) {
    const session = pisiSheetFormulaReferenceSession;

    if (
        !session ||
        session.kind !== 'cell' ||
        event.defaultPrevented ||
        ![
            'ArrowUp',
            'ArrowDown',
            'ArrowLeft',
            'ArrowRight'
        ].includes(event.key)
    ) {
        return;
    }

    const target = event.target;

    if (
        !(target instanceof Node) ||
        !session.editCell.contains(target)
    ) {
        return;
    }

    if (
        !movePisiSheetFormulaReferenceByKeyboard(
            session.table,
            event.key,
            { extend: event.shiftKey }
        )
    ) {
        return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
}

window.addEventListener(
    'keydown',
    handlePisiSheetFormulaReferenceKeydown,
    true
);


function isPisiSheetFormulaInputActive(table) {
    return Boolean(
        getPisiSheetFormulaInputForTable(table)
    );
}

function applyPisiSheetFormulaInputOnEnter(event) {
    const input = event.target;

    if (
        event.key !== 'Enter' ||
        !(input instanceof HTMLInputElement) ||
        !input.matches('[data-pisi-excel-formula]')
    ) {
        return;
    }

    const toolbar = input.closest(
        '.pisi-editor-toolbar, .pisi-word-toolbar'
    );
    const targetId = toolbar?.dataset?.editorTarget;
    const editor = targetId
        ? document.getElementById(targetId)
        : null;
    const table = editor
        ? getPisiSheetActiveTable(editor)
        : null;

    if (!table) return;

    event.preventDefault();
    finishPisiSheetFormulaReferencePick();
    applyPisiSheetFormula(table, input.value);
    schedulePisiSheetEditorNotification(table);
    table.classList.remove(
        'pisi-sheet-formula-reference-mode'
    );
    clearPisiSheetFormulaInputSession(input);
}

document.addEventListener(
    'keydown',
    applyPisiSheetFormulaInputOnEnter,
    true
);

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "beginPisiSheetFormulaReferencePick": {
        enumerable: true,
        get() { return beginPisiSheetFormulaReferencePick; }
    },
    "updatePisiSheetFormulaReferencePick": {
        enumerable: true,
        get() { return updatePisiSheetFormulaReferencePick; }
    },
    "finishPisiSheetFormulaReferencePick": {
        enumerable: true,
        get() { return finishPisiSheetFormulaReferencePick; }
    },
    "movePisiSheetFormulaReferenceByKeyboard": {
        enumerable: true,
        get() {
            return movePisiSheetFormulaReferenceByKeyboard;
        }
    },
    "isPisiSheetFormulaReferenceKeyboardNavigationActive": {
        enumerable: true,
        get() {
            return isPisiSheetFormulaReferenceKeyboardNavigationActive;
        }
    },
    "closePisiSheetFormulaReferenceSession": {
        enumerable: true,
        get() {
            return closePisiSheetFormulaReferenceSession;
        }
    },
    "isPisiSheetFormulaReferencePicking": {
        enumerable: true,
        get() { return isPisiSheetFormulaReferencePicking; }
    },
    "handlePisiSheetFormulaReferenceKeydown": {
        enumerable: true,
        get() { return handlePisiSheetFormulaReferenceKeydown; }
    },
    "isPisiSheetFormulaInputActive": {
        enumerable: true,
        get() { return isPisiSheetFormulaInputActive; }
    },
    "trackPisiSheetFormulaInput": {
        enumerable: true,
        get() { return trackPisiSheetFormulaInput; }
    },
    "clearPisiSheetFormulaInputSession": {
        enumerable: true,
        get() { return clearPisiSheetFormulaInputSession; }
    },
    "pisiSheetPointToReference": {
        enumerable: true,
        get() { return pisiSheetPointToReference; }
    },
    "pisiSheetPointsToReference": {
        enumerable: true,
        get() { return pisiSheetPointsToReference; }
    },
    "applyPisiSheetFormulaInputOnEnter": {
        enumerable: true,
        get() { return applyPisiSheetFormulaInputOnEnter; }
    }
});
registerModule("editor.sheetFormulaReference", moduleApi);
