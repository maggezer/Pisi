import {
    ensurePisiCompositeAlignment,
    ensurePisiEditableLineAfter,
    normalizePisiCompositeBlockLayout,
    selectPisiCompositeAlignmentBlock
} from "./pisi-editor-composite-blocks.mjs";

const PISI_SHEET_DEFAULT_TITLE = 'Sheet';
const pisiBoundSheetSectionHeaders = new WeakSet();

function getPisiSheetSectionBlock(table) {
    return table?.closest?.(
        '.pisi-sheet-block'
    ) || null;
}

function normalizePisiSheetSectionTitle(value) {
    return String(
        value || PISI_SHEET_DEFAULT_TITLE
    ).trim().slice(0, 80) ||
        PISI_SHEET_DEFAULT_TITLE;
}

function isPisiSheetEmptyAdjacentBlock(element) {
    if (!(element instanceof Element)) return false;

    if (
        !['DIV', 'P'].includes(element.tagName) ||
        element.matches(
            '.pisi-sheet-block, ' +
            '.pisi-canvas-block, ' +
            '.pisi-rollup-block'
        )
    ) {
        return false;
    }

    if (
        element.querySelector(
            'table, canvas, img, input, button, ' +
            '[data-pisi-rollup-relation]'
        )
    ) {
        return false;
    }

    return !String(
        element.textContent || ''
    ).trim();
}

function normalizePisiSheetAdjacentSpacing(table) {
    const block = getPisiSheetSectionBlock(table);
    const editor = block?.closest?.(
        '.pisi-rich-editor'
    );

    if (!block || !editor) return;

    for (const direction of [
        'previousElementSibling',
        'nextElementSibling'
    ]) {
        let sibling = block[direction];

        while (
            sibling &&
            (
                sibling.matches?.(
                    '.pisi-sheet-caret-anchor'
                ) ||
                isPisiSheetEmptyAdjacentBlock(sibling)
            )
        ) {
            const remove = sibling;
            sibling = sibling[direction];
            remove.remove();
        }
    }
}

function clearPisiSheetDocumentSelection(block) {
    const selection = window.getSelection?.();

    if (!selection || !selection.rangeCount) return;

    const ranges = Array.from(
        { length: selection.rangeCount },
        (_, index) => selection.getRangeAt(index)
    );
    const intersectsSheet = ranges.some((range) => {
        try {
            return range.intersectsNode(block);
        } catch {
            return false;
        }
    });

    if (intersectsSheet) {
        selection.removeAllRanges();
    }
}

function syncPisiSheetSectionTitleWidth(input) {
    if (!input) return;

    const length = Math.max(
        5,
        String(input.value || '').length
    );

    input.style.width =
        String(
            Math.min(
                360,
                Math.max(92, length * 7.4 + 22)
            )
        ) + 'px';
}

function getPisiSheetSectionLabels(collapsed) {
    return {
        toggle: collapsed
            ? (
                window.pisiT?.("Sheet'i aç") ||
                "Sheet'i aç"
            )
            : (
                window.pisiT?.("Sheet'i kapat") ||
                "Sheet'i kapat"
            ),
        title:
            window.pisiT?.('Sheet başlığı') ||
            'Sheet başlığı',
        copy:
            window.pisiT?.("Sheet'i kopyala") ||
            "Sheet'i kopyala",
        newLine:
            window.pisiT?.('Sheet altına satır ekle') ||
            'Sheet altına satır ekle',
        delete:
            window.pisiT?.("Sheet'i sil") ||
            "Sheet'i sil"
    };
}

function syncPisiSheetSectionState(
    table,
    header
) {
    const database = getPisiSheetDatabase(table);
    const block = getPisiSheetSectionBlock(table);

    if (!database || !block || !header) {
        return null;
    }

    const collapsed =
        database.collapsed === true;
    const title = normalizePisiSheetSectionTitle(
        database.title
    );

    database.title = title;
    database.collapsed = collapsed;

    block.classList.toggle(
        'pisi-sheet-collapsed',
        collapsed
    );
    block.dataset.pisiSheetCollapsed =
        collapsed ? '1' : '0';

    const toggle = header.querySelector(
        '[data-pisi-sheet-section-toggle]'
    );
    const input = header.querySelector(
        '[data-pisi-sheet-section-title]'
    );
    const labels =
        getPisiSheetSectionLabels(collapsed);

    if (toggle) {
        toggle.setAttribute(
            'aria-expanded',
            collapsed ? 'false' : 'true'
        );
        toggle.setAttribute(
            'aria-label',
            labels.toggle
        );
        toggle.title = labels.toggle;
    }

    if (
        input &&
        document.activeElement !== input
    ) {
        input.value = title;
        input.setAttribute(
            'aria-label',
            labels.title
        );
        syncPisiSheetSectionTitleWidth(input);
    }

    return {
        title,
        collapsed
    };
}

function updatePisiSheetSectionTitleDraft(
    table,
    input
) {
    const database = getPisiSheetDatabase(table);

    if (!database || !input) return;

    database.title = String(
        input.value || ''
    ).slice(0, 80);
}

function commitPisiSheetSectionTitle(
    table,
    input
) {
    const database = getPisiSheetDatabase(table);
    if (!database || !input) return false;

    const next = normalizePisiSheetSectionTitle(
        input.value
    );
    const original =
        normalizePisiSheetSectionTitle(
            input.dataset.pisiSheetOriginalTitle ||
            database.title
        );
    const changed = original !== next;

    database.title = next;
    input.value = next;
    input.dataset.pisiSheetOriginalTitle = next;
    syncPisiSheetSectionTitleWidth(input);

    persistPisiSheetDatabase(table);

    if (changed) {
        schedulePisiSheetEditorNotification(table);
    }

    return changed;
}

function togglePisiSheetSection(
    table,
    header
) {
    const database = getPisiSheetDatabase(table);
    const block = getPisiSheetSectionBlock(table);

    if (!database || !block) return false;

    if (
        typeof isPisiSheetEditingCell === 'function' &&
        isPisiSheetEditingCell(table)
    ) {
        finishPisiSheetCellEdit(table, {
            commit: true,
            refocus: false
        });
    }

    database.collapsed =
        database.collapsed !== true;

    persistPisiSheetDatabase(table);
    syncPisiSheetSectionState(
        table,
        header
    );
    schedulePisiSheetEditorNotification(table);

    if (!database.collapsed) {
        requestAnimationFrame(() => {
            block.dispatchEvent(
                new Event('scroll')
            );
            reconcilePisiSheetSelection(table);
        });
    }

    return true;
}

function deletePisiSheetSection(table) {
    const block = getPisiSheetSectionBlock(table);
    const editor =
        block?.closest?.('.pisi-rich-editor') ||
        block?.parentElement ||
        null;

    if (!block || !editor) return false;

    try {
        if (
            typeof isPisiSheetEditingCell === 'function' &&
            isPisiSheetEditingCell(table)
        ) {
            finishPisiSheetCellEdit(table, {
                commit: true,
                refocus: false
            });
        }

        if (typeof clearPisiSheetSelection === 'function') {
            clearPisiSheetSelection(table);
        } else {
            window.getSelection?.()?.removeAllRanges?.();
        }
    } catch {
        window.getSelection?.()?.removeAllRanges?.();
    }

    block.remove();

    editor.dispatchEvent(
        new InputEvent('input', {
            bubbles: true,
            inputType: 'deleteContent'
        })
    );

    return true;
}

function createPisiSheetSectionHeader(table) {
    const header = document.createElement('div');
    const toggle = document.createElement('button');
    const title = document.createElement('input');
    const copy = document.createElement('button');
    const newLine = document.createElement('button');
    const remove = document.createElement('button');

    header.className =
        'pisi-sheet-section-header';
    header.dataset.pisiSheetSectionHeader = '1';
    header.setAttribute(
        'contenteditable',
        'false'
    );

    toggle.type = 'button';
    toggle.className =
        'pisi-sheet-section-toggle';
    toggle.dataset.pisiSheetSectionToggle = '1';

    title.type = 'text';
    title.className =
        'pisi-sheet-section-title';
    title.dataset.pisiSheetSectionTitle = '1';
    title.maxLength = 80;
    title.autocomplete = 'off';
    title.spellcheck = false;

    copy.type = 'button';
    copy.className = 'pisi-section-copy';
    copy.dataset.pisiCompositeCopy = '1';
    copy.setAttribute('contenteditable', 'false');

    newLine.type = 'button';
    newLine.className = 'pisi-section-new-line';
    newLine.dataset.pisiCompositeNewLine = '1';
    newLine.setAttribute('contenteditable', 'false');

    remove.type = 'button';
    remove.className = 'pisi-section-delete';
    remove.dataset.pisiSheetSectionDelete = '1';
    remove.setAttribute('contenteditable', 'false');

    toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearPisiSheetDocumentSelection(
            getPisiSheetSectionBlock(table)
        );

        togglePisiSheetSection(
            table,
            header
        );
    });

    const stopTitleEditorEvent = (event) => {
        event.stopPropagation();
    };

    [
        'pointerdown',
        'pointerup',
        'mousedown',
        'mouseup',
        'click',
        'dblclick',
        'focusin',
        'focusout',
        'keyup',
        'compositionstart',
        'compositionupdate',
        'compositionend'
    ].forEach((type) => {
        title.addEventListener(
            type,
            stopTitleEditorEvent
        );
    });

    const selectSheetBlock = () => {
        const block =
            getPisiSheetSectionBlock(table);

        selectPisiCompositeAlignmentBlock(block);
    };

    title.addEventListener(
        'pointerdown',
        selectSheetBlock
    );

    title.addEventListener('focus', () => {
        const block =
            getPisiSheetSectionBlock(table);

        clearPisiSheetDocumentSelection(block);
        selectPisiCompositeAlignmentBlock(block);

        const database =
            getPisiSheetDatabase(table);

        title.dataset.pisiSheetOriginalTitle =
            String(
                database?.title ||
                PISI_SHEET_DEFAULT_TITLE
            );
    });

    title.addEventListener('beforeinput', (event) => {
        event.stopPropagation();
    });

    title.addEventListener('input', (event) => {
        event.stopPropagation();
        updatePisiSheetSectionTitleDraft(
            table,
            title
        );
        syncPisiSheetSectionTitleWidth(title);
    });

    title.addEventListener('change', (event) => {
        event.stopPropagation();
        commitPisiSheetSectionTitle(
            table,
            title
        );
    });

    remove.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        deletePisiSheetSection(table);
    });

    title.addEventListener('keydown', (event) => {
        event.stopPropagation();

        if (event.key === 'Enter') {
            event.preventDefault();
            commitPisiSheetSectionTitle(
                table,
                title
            );
            const block =
                getPisiSheetSectionBlock(table);
            title.blur();
            ensurePisiEditableLineAfter(block);
            return;
        }

        if (event.key !== 'Escape') return;

        event.preventDefault();

        const database =
            getPisiSheetDatabase(table);
        const original =
            title.dataset.pisiSheetOriginalTitle ||
            PISI_SHEET_DEFAULT_TITLE;

        if (database) {
            database.title = original;
        }

        title.value =
            normalizePisiSheetSectionTitle(
                original
            );
        syncPisiSheetSectionTitleWidth(title);
        title.blur();
    });

    header.append(
        toggle,
        title,
        copy,
        newLine,
        remove
    );
    pisiBoundSheetSectionHeaders.add(header);

    const labels = getPisiSheetSectionLabels(
        getPisiSheetDatabase(table)?.collapsed === true
    );
    copy.setAttribute(
        'aria-label',
        labels.copy
    );
    copy.title = labels.copy;

    newLine.setAttribute(
        'aria-label',
        labels.newLine
    );
    newLine.title = labels.newLine;

    remove.setAttribute(
        'aria-label',
        labels.delete
    );
    remove.title = labels.delete;

    return header;
}

function ensurePisiSheetSectionHeader(table) {
    const block = getPisiSheetSectionBlock(table);
    const database = getPisiSheetDatabase(table);

    if (!block || !database) return null;

    ensurePisiCompositeAlignment(block);
    normalizePisiCompositeBlockLayout(block);

    block.classList.remove(
        'pisi-editor-block',
        'pisi-block-active'
    );
    delete block.dataset.pisiBlockId;
    delete block.dataset.pisiBlockType;

    const headers = Array.from(
        block.children
    ).filter((child) => (
        child.classList?.contains(
            'pisi-sheet-section-header'
        )
    ));
    let header = headers.find((child) => (
        pisiBoundSheetSectionHeaders.has(child) &&
        child.dataset?.pisiSheetSectionHeader === '1' &&
        child.querySelector(
            '[data-pisi-sheet-section-toggle]'
        ) &&
        child.querySelector(
            '[data-pisi-sheet-section-title]'
        ) &&
        child.querySelector(
            '[data-pisi-composite-copy]'
        ) &&
        child.querySelector(
            '[data-pisi-composite-new-line]'
        ) &&
        child.querySelector(
            '[data-pisi-sheet-section-delete]'
        )
    )) || null;

    for (const candidate of headers) {
        if (candidate !== header) {
            candidate.remove();
        }
    }

    if (!header) {
        header = createPisiSheetSectionHeader(
            table
        );
        block.prepend(header);
    }

    normalizePisiSheetAdjacentSpacing(table);
    syncPisiSheetSectionState(
        table,
        header
    );

    return header;
}

if (typeof document !== 'undefined') {
    document.addEventListener(
        'click',
        (event) => {
            const target = event.target;
            const button = target instanceof Element
                ? target.closest(
                    '[data-pisi-sheet-section-delete]'
                )
                : null;

            if (!button) return;

            const block = button.closest(
                '.pisi-sheet-block'
            );
            const table = block?.querySelector(
                'table[data-pisi-sheet]'
            );

            if (!table) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            deletePisiSheetSection(table);
        },
        true
    );
}

export {
    ensurePisiSheetSectionHeader,
    normalizePisiSheetSectionTitle
};
