import {
    getPisiSheetActiveViewSearchQuery,
    setPisiSheetViewSearchQuery
} from "./pisi-editor-sheet-view-query.mjs";

const pisiSheetSearchTimers = new WeakMap();

function clearPisiSheetSearchTimer(table) {
    const timer = pisiSheetSearchTimers.get(table);

    if (timer) {
        clearTimeout(timer);
        pisiSheetSearchTimers.delete(table);
    }
}

function commitPisiSheetSearch(
    table,
    value
) {
    clearPisiSheetSearchTimer(table);
    setPisiSheetViewSearchQuery(
        table,
        value
    );
}

function schedulePisiSheetSearch(
    table,
    value
) {
    clearPisiSheetSearchTimer(table);

    const timer = setTimeout(() => {
        pisiSheetSearchTimers.delete(table);
        setPisiSheetViewSearchQuery(
            table,
            value
        );
    }, 120);

    pisiSheetSearchTimers.set(table, timer);
}

function ensurePisiSheetSearchControl(
    table,
    info = {}
) {
    const block = table?.closest?.(
        '.pisi-sheet-block'
    );

    if (!block) return null;

    let control = Array.from(
        block.children
    ).find((child) => (
        child.classList?.contains(
            'pisi-sheet-search'
        )
    ));

    if (!control) {
        control = document.createElement('div');
        control.className = 'pisi-sheet-search';
        control.setAttribute(
            'contenteditable',
            'false'
        );

        const icon = document.createElement('span');
        const input = document.createElement('input');
        const status = document.createElement('span');
        const clear = document.createElement('button');

        icon.className = 'pisi-sheet-search-icon';
        icon.textContent = '⌕';
        icon.setAttribute('aria-hidden', 'true');

        input.type = 'search';
        input.className = 'pisi-sheet-search-input';
        input.dataset.pisiSheetSearchInput = '1';
        input.maxLength = 240;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder =
            window.pisiT?.('Sheet içinde ara') ||
            'Sheet içinde ara';
        input.setAttribute(
            'aria-label',
            window.pisiT?.('Sheet içinde ara') ||
            'Sheet içinde ara'
        );

        status.className =
            'pisi-sheet-search-status';
        status.dataset.pisiSheetSearchStatus = '1';

        clear.type = 'button';
        clear.className =
            'pisi-sheet-search-clear';
        clear.dataset.pisiSheetSearchClear = '1';
        clear.textContent = '×';
        clear.setAttribute(
            'aria-label',
            window.pisiT?.('Aramayı temizle') ||
            'Aramayı temizle'
        );

        input.addEventListener('input', () => {
            clear.hidden = !input.value;
            schedulePisiSheetSearch(
                table,
                input.value
            );
        });

        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;

            event.preventDefault();

            if (input.value) {
                input.value = '';
                clear.hidden = true;
                commitPisiSheetSearch(
                    table,
                    ''
                );
            } else {
                input.blur();
            }
        });

        clear.addEventListener('click', () => {
            input.value = '';
            clear.hidden = true;
            commitPisiSheetSearch(
                table,
                ''
            );
            input.focus();
        });

        control.append(
            icon,
            input,
            status,
            clear
        );
        block.insertBefore(control, table);
    }

    const input = control.querySelector(
        '[data-pisi-sheet-search-input]'
    );
    const status = control.querySelector(
        '[data-pisi-sheet-search-status]'
    );
    const clear = control.querySelector(
        '[data-pisi-sheet-search-clear]'
    );
    const query =
        getPisiSheetActiveViewSearchQuery(table);

    if (
        input &&
        document.activeElement !== input &&
        input.value !== query
    ) {
        input.value = query;
    }

    if (clear) {
        clear.hidden = !query;
    }

    if (status) {
        status.textContent = query
            ? String(Number(info.total) || 0) +
                ' ' +
                (
                    window.pisiT?.('sonuç') ||
                    'sonuç'
                )
            : '';
    }

    control.classList.toggle(
        'active',
        Boolean(query)
    );

    return control;
}

export {
    ensurePisiSheetSearchControl
};
