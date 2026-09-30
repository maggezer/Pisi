import { registerModule } from "../core/module-registry.mjs";

let pisiSheetFormulaReferenceSession = null;

function getPisiSheetFormulaInputForTable(table) {
    const active = document.activeElement;

    if (
        !(active instanceof HTMLInputElement) ||
        !active.matches('[data-pisi-excel-formula]') ||
        !String(active.value || '').trimStart().startsWith('=')
    ) {
        return null;
    }

    const toolbar = active.closest(
        '.pisi-editor-toolbar, .pisi-word-toolbar'
    );
    const targetId = toolbar?.dataset?.editorTarget;
    const editor = targetId
        ? document.getElementById(targetId)
        : null;

    if (!editor || !editor.contains(table)) {
        return null;
    }

    return active;
}

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

function writePisiSheetFormulaReference(session, focus) {
    const reference = pisiSheetPointsToReference(
        session.anchor,
        focus
    );
    if (!reference) return false;

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
    const input = getPisiSheetFormulaInputForTable(table);
    const point = getPisiSheetCellPosition(cell);

    if (!input || !point) return false;

    event?.preventDefault?.();
    event?.stopPropagation?.();

    const start = Number.isInteger(input.selectionStart)
        ? input.selectionStart
        : input.value.length;
    const end = Number.isInteger(input.selectionEnd)
        ? input.selectionEnd
        : start;

    pisiSheetFormulaReferenceSession = {
        table,
        input,
        anchor: point,
        focus: point,
        start,
        end
    };

    table.classList.add(
        'pisi-sheet-formula-reference-mode'
    );

    setPisiSheetSelectionState(table, {
        mode: 'range',
        anchor: point,
        focus: point,
        active: point
    });
    syncPisiSheetSelectionProjection(table);
    writePisiSheetFormulaReference(
        pisiSheetFormulaReferenceSession,
        point
    );

    input.focus({ preventScroll: true });
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
        active: point
    });
    syncPisiSheetSelectionProjection(table);
    writePisiSheetFormulaReference(session, point);
    return true;
}

function finishPisiSheetFormulaReferencePick() {
    const session = pisiSheetFormulaReferenceSession;
    if (!session) return false;

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
    "isPisiSheetFormulaReferencePicking": {
        enumerable: true,
        get() { return isPisiSheetFormulaReferencePicking; }
    },
    "isPisiSheetFormulaInputActive": {
        enumerable: true,
        get() { return isPisiSheetFormulaInputActive; }
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
