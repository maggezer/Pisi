import { registerModule } from "../core/module-registry.mjs";
import {
    ensurePisiSheetModelCellRendered
} from "./pisi-editor-sheet-virtual-scroll.mjs";

function shouldIgnorePisiSheetSelectionKey(event) {
    const target = event.target;

    if (!(target instanceof Element)) {
        return false;
    }

    if (
        target.matches(
            'input, textarea, select, [data-pisi-excel-formula]'
        ) ||
        target.closest(
            '.pisi-editor-toolbar, .pisi-word-toolbar, ' +
            '.pisi-sheet-typed-editor'
        )
    ) {
        return true;
    }

    return Boolean(
        target.closest('td.pisi-sheet-cell-editing')
    );
}

function handlePisiSheetSelectionKeydown(event) {
    if (
        event.defaultPrevented ||
        shouldIgnorePisiSheetSelectionKey(event)
    ) {
        return;
    }

    const table = getPisiSheetActiveTable(document);
    if (!table) return;

    const activePoint = getPisiSheetActivePoint(table);
    if (!activePoint) return;

    const cell =
        getPisiSheetCell(
            table,
            activePoint.row,
            activePoint.col
        ) ||
        ensurePisiSheetModelCellRendered(
            table,
            activePoint.row,
            activePoint.col
        );
    if (!cell) return;

    const arrows = [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight'
    ];

    if (event.key === 'Enter' || event.key === 'F2') {
        event.preventDefault();

        if (!beginPisiSheetTypedCellEdit(cell)) {
            beginPisiSheetCellEdit(cell);
        }
        return;
    }

    if (event.key === 'Tab') {
        event.preventDefault();
        movePisiSheetCellFocus(
            table,
            cell,
            0,
            event.shiftKey ? -1 : 1,
            {
                wrap: true,
                addRowAtEnd: !event.shiftKey
            }
        );
        return;
    }

    if (
        event.shiftKey &&
        arrows.includes(event.key)
    ) {
        event.preventDefault();
        extendPisiSheetSelectionByKeyboard(
            table,
            cell,
            event.key
        );
        return;
    }

    if (arrows.includes(event.key)) {
        event.preventDefault();

        const deltas = {
            ArrowUp: [-1, 0],
            ArrowDown: [1, 0],
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1]
        };
        const delta = deltas[event.key];

        movePisiSheetCellFocus(
            table,
            cell,
            delta[0],
            delta[1]
        );
        return;
    }

    if (
        event.key === 'Delete' ||
        event.key === 'Backspace'
    ) {
        event.preventDefault();
        clearPisiSheetSelectedCells(table);
        return;
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        clearPisiSheetSelection(table);
        return;
    }

    if (
        event.key?.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
    ) {
        event.preventDefault();

        if (!beginPisiSheetTypedCellEdit(cell)) {
            beginPisiSheetCellEdit(cell, {
                replace: true,
                initialText: event.key
            });
        }
    }
}

function handlePisiSheetOutsidePointerDown(event) {
    const table = getPisiSheetActiveTable(document);
    if (!table) return;

    const target = event.target;

    if (!(target instanceof Node)) return;
    if (
        target instanceof Element &&
        isPisiSheetTypedEditorTarget(target)
    ) {
        return;
    }
    if (table.contains(target)) return;

    const block = table.closest(
        '.pisi-sheet-block'
    );
    if (block?.contains(target)) return;

    const editor = getEditorForPisiElement(table);
    const toolbar = editor
        ? document.querySelector(
            '.pisi-editor-toolbar[data-editor-target="' +
            editor.id + '"]'
        )
        : null;

    if (toolbar?.contains(target)) return;

    clearPisiSheetSelection(table);
}

document.addEventListener(
    'keydown',
    handlePisiSheetSelectionKeydown,
    true
);
document.addEventListener(
    'pointerdown',
    handlePisiSheetOutsidePointerDown,
    true
);

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "handlePisiSheetSelectionKeydown": {
        enumerable: true,
        get() { return handlePisiSheetSelectionKeydown; }
    },
    "handlePisiSheetOutsidePointerDown": {
        enumerable: true,
        get() { return handlePisiSheetOutsidePointerDown; }
    }
});
registerModule("editor.sheetKeyboard", moduleApi);
