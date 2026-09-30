import { registerModule } from "../core/module-registry.mjs";

const PISI_TOOLBAR_COLORS = [
    '#000000', '#404040', '#737373', '#a6a6a6', '#d9d9d9', '#ffffff',
    '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050',
    '#00b0f0', '#0070c0', '#002060', '#7030a0', '#f4b183', '#ffd966',
    '#a9d18e', '#9dc3e6', '#8ea9db', '#b4a7d6', '#f8cbad', '#fff2cc'
];

const PISI_TOOLBAR_SYMBOLS = [
    '©', '®', '™', '°', '±', '×', '÷', '≠', '≈', '≤', '≥', '∞',
    '→', '←', '↑', '↓', '↔', '✓', '✕', '★', '☆', '•', '§', '¶',
    'α', 'β', 'γ', 'δ', 'π', 'Σ', '√', '€', '£', '¥', '₺', '₿'
];

let pisiToolbarPopover = null;
let pisiToolbarPopoverAnchor = null;

function closePisiToolbarPopover() {
    pisiToolbarPopover?.remove();
    pisiToolbarPopover = null;
    pisiToolbarPopoverAnchor = null;
}

function positionPisiToolbarPopover(popover, anchor) {
    if (!popover || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
        Math.max(margin, rect.left),
        Math.max(margin, window.innerWidth - popover.offsetWidth - margin)
    );
    let top = rect.bottom + 5;
    if (top + popover.offsetHeight > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - popover.offsetHeight - 5);
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

function createPisiToolbarPopover(anchor, className = '') {
    closePisiToolbarPopover();
    const popover = document.createElement('div');
    popover.className = `pisi-office-popover ${className}`.trim();
    popover.setAttribute('role', 'dialog');
    popover.addEventListener('mousedown', (event) => {
        if (!event.target.closest('input, select, textarea')) {
            event.preventDefault();
        }
    });
    document.body.appendChild(popover);
    pisiToolbarPopover = popover;
    pisiToolbarPopoverAnchor = anchor;
    requestAnimationFrame(() => positionPisiToolbarPopover(popover, anchor));
    return popover;
}

function openPisiToolbarColorPopover(toolbar, anchor, mode) {
    const popover = createPisiToolbarPopover(anchor, 'pisi-office-color-popover');
    popover.innerHTML = `
        <div class="pisi-office-popover-title">${mode === 'highlight' ? 'Vurgu / hücre rengi' : 'Yazı rengi'}</div>
        <div class="pisi-office-color-grid"></div>
        <label class="pisi-office-custom-color">Özel renk<input type="color" value="#f39c12"></label>
    `;
    const applyColor = (color) => {
        runPisiUnifiedTextCommand(
            toolbar,
            mode === 'highlight' ? 'hiliteColor' : 'foreColor',
            color
        );
        closePisiToolbarPopover();
    };
    const grid = popover.querySelector('.pisi-office-color-grid');
    PISI_TOOLBAR_COLORS.forEach((color) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-office-color-swatch';
        button.style.backgroundColor = color;
        button.title = color;
        button.setAttribute('aria-label', color);
        button.addEventListener('click', () => applyColor(color));
        grid.appendChild(button);
    });
    popover.querySelector('input').addEventListener('change', (event) => {
        applyColor(event.target.value);
    });
}

function openPisiToolbarSymbolPopover(toolbar, anchor) {
    const popover = createPisiToolbarPopover(anchor, 'pisi-office-symbol-popover');
    popover.innerHTML = '<div class="pisi-office-popover-title">Simge ekle</div><div class="pisi-office-symbol-grid"></div>';
    const grid = popover.querySelector('.pisi-office-symbol-grid');
    PISI_TOOLBAR_SYMBOLS.forEach((symbol) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-office-symbol-item';
        button.textContent = symbol;
        button.title = symbol;
        button.addEventListener('click', () => {
            insertPisiToolbarSymbol(toolbar, symbol);
            closePisiToolbarPopover();
        });
        grid.appendChild(button);
    });
}

function openPisiToolbarTablePopover(toolbar, anchor) {
    const table = getPisiUnifiedToolbarActiveTable(toolbar);
    const dimensions = table
        ? getPisiSheetDimensions(table)
        : null;
    const popover = createPisiToolbarPopover(
        anchor,
        'pisi-office-table-popover'
    );

    popover.innerHTML = `
        ${table ? `
            <div class="pisi-office-popover-title">
                Sheet ${dimensions.rows} × ${dimensions.cols}
            </div>
            <div class="pisi-office-sheet-action-grid">
                <button type="button" data-pisi-sheet-popover-action="addRow">+ Satır</button>
                <button type="button" data-pisi-sheet-popover-action="deleteRow">− Satır</button>
                <button type="button" data-pisi-sheet-popover-action="addCol">+ Sütun</button>
                <button type="button" data-pisi-sheet-popover-action="deleteCol">− Sütun</button>
            </div>
            <div class="pisi-office-sheet-format-grid">
                <button type="button" data-pisi-sheet-popover-action="verticalTop">Üst</button>
                <button type="button" data-pisi-sheet-popover-action="verticalMiddle">Orta</button>
                <button type="button" data-pisi-sheet-popover-action="verticalBottom">Alt</button>
                <button type="button" data-pisi-sheet-popover-action="toggleWrap">Kaydır</button>
                <button type="button" data-pisi-sheet-popover-action="borderAll">Kenarlık</button>
                <button type="button" data-pisi-sheet-popover-action="borderNone">Kenarlıksız</button>
            </div>
        ` : ''}
        <div class="pisi-office-popover-title" data-pisi-table-grid-label>
            Yeni tablo
        </div>
        <div class="pisi-office-table-grid"></div>
        <div class="pisi-office-table-custom">
            <label>
                Satır
                <input type="number" min="1" max="${PISI_SHEET_MAX_ROWS}" value="12" data-pisi-table-custom-rows>
            </label>
            <label>
                Sütun
                <input type="number" min="1" max="${PISI_SHEET_MAX_COLS}" value="8" data-pisi-table-custom-cols>
            </label>
            <button type="button" data-pisi-table-custom-insert>Oluştur</button>
        </div>
        <div class="pisi-office-sheet-capacity">
            Maksimum ${PISI_SHEET_MAX_ROWS} × ${PISI_SHEET_MAX_COLS}
        </div>
    `;

    popover
        .querySelectorAll('[data-pisi-sheet-popover-action]')
        .forEach((button) => {
            button.addEventListener('click', () => {
                runPisiExcelAction(
                    toolbar,
                    button.dataset.pisiSheetPopoverAction
                );
                closePisiToolbarPopover();
            });
        });

    const grid = popover.querySelector('.pisi-office-table-grid');
    const label = popover.querySelector('[data-pisi-table-grid-label]');
    const cells = [];

    for (let row = 1; row <= 8; row += 1) {
        for (let col = 1; col <= 10; col += 1) {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'pisi-office-table-cell';
            cell.dataset.row = String(row);
            cell.dataset.col = String(col);
            cell.setAttribute(
                'aria-label',
                `${row} satır, ${col} sütun`
            );
            cell.addEventListener('mouseenter', () => {
                label.textContent = `${row} × ${col} tablo`;
                cells.forEach((candidate) => {
                    candidate.classList.toggle(
                        'selected',
                        Number(candidate.dataset.row) <= row &&
                        Number(candidate.dataset.col) <= col
                    );
                });
            });
            cell.addEventListener('click', () => {
                const editor = getPisiToolbarEditor(toolbar);
                if (editor) insertPisiSheet(editor, row, col);
                closePisiToolbarPopover();
            });
            cells.push(cell);
            grid.appendChild(cell);
        }
    }

    popover
        .querySelector('[data-pisi-table-custom-insert]')
        ?.addEventListener('click', () => {
            const editor = getPisiToolbarEditor(toolbar);
            if (!editor) return;

            const rows = Math.max(
                1,
                Math.min(
                    PISI_SHEET_MAX_ROWS,
                    Number(
                        popover.querySelector(
                            '[data-pisi-table-custom-rows]'
                        )?.value
                    ) || 1
                )
            );
            const cols = Math.max(
                1,
                Math.min(
                    PISI_SHEET_MAX_COLS,
                    Number(
                        popover.querySelector(
                            '[data-pisi-table-custom-cols]'
                        )?.value
                    ) || 1
                )
            );

            insertPisiSheet(editor, rows, cols);
            closePisiToolbarPopover();
        });
}

function bindPisiToolbarPopoverDismissal() {
    document.addEventListener('pointerdown', (event) => {
        if (!pisiToolbarPopover) return;
        if (pisiToolbarPopover.contains(event.target) || pisiToolbarPopoverAnchor?.contains?.(event.target)) return;
        closePisiToolbarPopover();
    }, true);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closePisiToolbarPopover();
    });
    window.addEventListener('resize', closePisiToolbarPopover);
    window.addEventListener('blur', closePisiToolbarPopover);
}

bindPisiToolbarPopoverDismissal();

const moduleApi = {};
Object.defineProperties(moduleApi, {
    PISI_TOOLBAR_COLORS: { enumerable: true, get() { return PISI_TOOLBAR_COLORS; } },
    PISI_TOOLBAR_SYMBOLS: { enumerable: true, get() { return PISI_TOOLBAR_SYMBOLS; } },
    closePisiToolbarPopover: { enumerable: true, get() { return closePisiToolbarPopover; } },
    positionPisiToolbarPopover: { enumerable: true, get() { return positionPisiToolbarPopover; } },
    createPisiToolbarPopover: { enumerable: true, get() { return createPisiToolbarPopover; } },
    openPisiToolbarColorPopover: { enumerable: true, get() { return openPisiToolbarColorPopover; } },
    openPisiToolbarSymbolPopover: { enumerable: true, get() { return openPisiToolbarSymbolPopover; } },
    openPisiToolbarTablePopover: { enumerable: true, get() { return openPisiToolbarTablePopover; } }
});
registerModule('editor.toolbarPopovers', moduleApi);
