const PISI_SHEET_DEFAULT_TITLE = 'Sheet';

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

function makePisiSheetCaretAnchor(
    position
) {
    const anchor = document.createElement('div');

    anchor.className =
        'pisi-sheet-caret-anchor pisi-editor-block';
    anchor.dataset.pisiSheetCaretAnchor = position;
    anchor.innerHTML = '<br>';

    return anchor;
}

function normalizePisiSheetAdjacentSpacing(table) {
    const block = getPisiSheetSectionBlock(table);
    const editor = block?.closest?.(
        '.pisi-rich-editor'
    );

    if (!block || !editor) return;

    const normalizeSide = (
        position,
        direction
    ) => {
        let sibling = block[direction];
        const empty = [];

        while (
            sibling &&
            isPisiSheetEmptyAdjacentBlock(sibling)
        ) {
            empty.push(sibling);
            sibling = sibling[direction];
        }

        const anchor = empty.shift() ||
            makePisiSheetCaretAnchor(position);

        anchor.classList.add(
            'pisi-sheet-caret-anchor'
        );
        anchor.dataset.pisiSheetCaretAnchor =
            position;

        for (const extra of empty) {
            extra.remove();
        }

        if (!anchor.isConnected) {
            if (position === 'before') {
                block.before(anchor);
            } else {
                block.after(anchor);
            }
        }
    };

    normalizeSide(
        'before',
        'previousElementSibling'
    );
    normalizeSide(
        'after',
        'nextElementSibling'
    );
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
            'Sheet başlığı'
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
    const changed = database.title !== next;

    database.title = next;
    input.value = next;
    syncPisiSheetSectionTitleWidth(input);

    if (changed) {
        persistPisiSheetDatabase(table);
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

function createPisiSheetSectionHeader(table) {
    const header = document.createElement('div');
    const toggle = document.createElement('button');
    const title = document.createElement('input');

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

    toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

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

    title.addEventListener('focus', () => {
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

    title.addEventListener('keydown', (event) => {
        event.stopPropagation();

        if (event.key === 'Enter') {
            event.preventDefault();
            title.blur();
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

    header.append(toggle, title);
    return header;
}

function ensurePisiSheetSectionHeader(table) {
    const block = getPisiSheetSectionBlock(table);
    const database = getPisiSheetDatabase(table);

    if (!block || !database) return null;

    let header = Array.from(
        block.children
    ).find((child) => (
        child.dataset?.pisiSheetSectionHeader === '1'
    ));

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

export {
    ensurePisiSheetSectionHeader,
    normalizePisiSheetSectionTitle
};
