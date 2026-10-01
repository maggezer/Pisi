const PISI_WORD_FONT_FAMILIES = Object.freeze([
    'Aptos',
    'Calibri',
    'Segoe UI',
    'Arial',
    'Times New Roman',
    'Georgia',
    'Consolas'
]);

const PISI_WORD_FONT_SIZES = Object.freeze([
    8, 9, 10, 11, 12, 14, 15, 16, 18, 20, 24, 28, 32, 36, 48, 72
]);

const PISI_WORD_BLOCK_TYPES = Object.freeze({
    div: 'paragraph',
    h1: 'heading1',
    h2: 'heading2',
    h3: 'heading3',
    blockquote: 'quote',
    pre: 'code'
});

const pisiWordToolbarSelections = new WeakMap();
const pisiWordBoundEditors = new WeakSet();
const pisiWordBoundToolbars = new WeakSet();
let pisiWordToolbarObserver = null;

function getPisiWordEditor(toolbar) {
    const targetId = toolbar?.dataset?.editorTarget;
    return targetId ? document.getElementById(targetId) : null;
}

function getPisiWordToolbarForEditor(editor) {
    if (!editor?.id) return null;
    return document.querySelector(
        `.pisi-editor-toolbar[data-editor-target="${CSS.escape(editor.id)}"], ` +
        `.pisi-word-toolbar[data-editor-target="${CSS.escape(editor.id)}"]`
    );
}

function getPisiWordRangeInsideEditor(editor, selection = window.getSelection?.()) {
    if (!editor || !selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (
        !editor.contains(range.startContainer) ||
        !editor.contains(range.endContainer)
    ) {
        return null;
    }
    return range;
}

function rememberPisiWordSelection(toolbar) {
    const editor = getPisiWordEditor(toolbar);
    const range = getPisiWordRangeInsideEditor(editor);
    if (!range) return false;
    pisiWordToolbarSelections.set(toolbar, range.cloneRange());
    return true;
}

function restorePisiWordSelection(toolbar) {
    const editor = getPisiWordEditor(toolbar);
    const savedRange = pisiWordToolbarSelections.get(toolbar);
    if (!editor || !savedRange) return false;
    if (
        !savedRange.startContainer?.isConnected ||
        !savedRange.endContainer?.isConnected
    ) {
        pisiWordToolbarSelections.delete(toolbar);
        return false;
    }

    editor.focus({ preventScroll: true });
    const selection = window.getSelection?.();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(savedRange.cloneRange());
    return true;
}

function getPisiWordRange(toolbar) {
    const editor = getPisiWordEditor(toolbar);
    const liveRange = getPisiWordRangeInsideEditor(editor);
    if (liveRange) return liveRange;
    const savedRange = pisiWordToolbarSelections.get(toolbar);
    return savedRange?.startContainer?.isConnected
        ? savedRange
        : null;
}

function getPisiWordElementFromRange(editor, range) {
    if (!editor || !range) return null;
    let node = range.startContainer;

    if (node === editor && node.nodeType === Node.ELEMENT_NODE) {
        node = node.childNodes[Math.min(
            range.startOffset,
            Math.max(0, node.childNodes.length - 1)
        )] || editor;
    }

    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (node?.nodeType !== Node.ELEMENT_NODE) return editor;
    return editor.contains(node) ? node : editor;
}

function getPisiWordActiveCell(editor) {
    const activeCell = window.__pisiActiveSheetCell;
    if (!editor || !activeCell || !editor.contains(activeCell)) return null;
    return activeCell.closest('td, th');
}

function getPisiWordProbeElement(toolbar) {
    const editor = getPisiWordEditor(toolbar);
    if (!editor) return null;
    return getPisiWordActiveCell(editor) ||
        getPisiWordElementFromRange(editor, getPisiWordRange(toolbar)) ||
        editor;
}

function getPisiWordBlock(editor, node) {
    const element = node?.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : node;
    const block = element?.closest?.('.pisi-editor-block');
    return block && editor?.contains(block) ? block : null;
}

function normalizePisiWordFontFamily(value = '') {
    const first = String(value || '')
        .split(',')[0]
        .trim()
        .replace(/^['"]|['"]$/g, '');
    return first || 'Segoe UI';
}

function normalizePisiWordFontSize(value = '') {
    const parsed = Number.parseFloat(String(value || '').replace('px', ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
}

function ensurePisiWordSelectOption(select, value, label = value) {
    if (!select) return;
    const normalized = String(value);
    let option = Array.from(select.options).find((item) => {
        return item.value === normalized;
    });

    select.querySelectorAll('option[data-pisi-word-dynamic="1"]').forEach((item) => {
        if (item.value !== normalized) item.remove();
    });

    if (!option) {
        option = document.createElement('option');
        option.value = normalized;
        option.textContent = String(label);
        option.dataset.pisiWordDynamic = '1';
        select.appendChild(option);
    }

    select.value = normalized;
}

function setPisiWordCommandPressed(toolbar, command, pressed) {
    const button = toolbar?.querySelector(
        `button[data-pisi-unified-command="${command}"]`
    );
    if (!button) return;
    button.classList.toggle('active', Boolean(pressed));
    button.setAttribute('aria-pressed', String(Boolean(pressed)));
}

function getPisiWordBlockStyleValue(editor, probe) {
    const block = getPisiWordBlock(editor, probe);
    if (!block) return 'div';
    const type = typeof window.getPisiBlockType === 'function'
        ? window.getPisiBlockType(block)
        : block.dataset.pisiBlockType;
    return {
        heading1: 'h1',
        heading2: 'h2',
        heading3: 'h3',
        quote: 'blockquote',
        code: 'pre'
    }[type] || 'div';
}

function syncPisiWordToolbarState(toolbar) {
    const editor = getPisiWordEditor(toolbar);
    const probe = getPisiWordProbeElement(toolbar);
    if (!editor || !probe) return;

    const style = getComputedStyle(probe);
    const familySelect = toolbar.querySelector('.pisi-font-family-select');
    const sizeSelect = toolbar.querySelector('.pisi-font-size-select');
    const styleSelect = toolbar.querySelector('.pisi-style-select');

    const family = normalizePisiWordFontFamily(style.fontFamily);
    ensurePisiWordSelectOption(familySelect, family, family);

    const size = normalizePisiWordFontSize(style.fontSize);
    const sizeLabel = Number.isInteger(size) ? String(size) : size.toFixed(1);
    ensurePisiWordSelectOption(sizeSelect, sizeLabel, sizeLabel);

    if (styleSelect) {
        styleSelect.value = getPisiWordBlockStyleValue(editor, probe);
        styleSelect.disabled = Boolean(getPisiWordActiveCell(editor));
    }

    const numericWeight = Number.parseInt(style.fontWeight, 10);
    const bold = style.fontWeight === 'bold' ||
        (Number.isFinite(numericWeight) && numericWeight >= 600);
    const decorations = String(style.textDecorationLine || '');
    const verticalAlign = String(style.verticalAlign || '').toLowerCase();
    const block = getPisiWordBlock(editor, probe);
    const blockType = block && typeof window.getPisiBlockType === 'function'
        ? window.getPisiBlockType(block)
        : block?.dataset?.pisiBlockType;

    setPisiWordCommandPressed(toolbar, 'bold', bold);
    setPisiWordCommandPressed(toolbar, 'italic', style.fontStyle === 'italic');
    setPisiWordCommandPressed(toolbar, 'underline', decorations.includes('underline'));
    setPisiWordCommandPressed(toolbar, 'strikeThrough', decorations.includes('line-through'));
    setPisiWordCommandPressed(toolbar, 'subscript', verticalAlign === 'sub');
    setPisiWordCommandPressed(toolbar, 'superscript', verticalAlign === 'super');
    setPisiWordCommandPressed(
        toolbar,
        'insertUnorderedList',
        Boolean(probe.closest?.('ul')) || blockType === 'bullet'
    );
    setPisiWordCommandPressed(
        toolbar,
        'insertOrderedList',
        Boolean(probe.closest?.('ol')) || blockType === 'number'
    );

    const alignTarget = block || probe;
    const align = String(getComputedStyle(alignTarget).textAlign || '').toLowerCase();
    const compositeOwnsAlignment =
        toolbar.classList.contains(
            'pisi-composite-context'
        );

    if (!compositeOwnsAlignment) {
        setPisiWordCommandPressed(
            toolbar,
            'justifyLeft',
            ['left', 'start', ''].includes(align)
        );
        setPisiWordCommandPressed(
            toolbar,
            'justifyCenter',
            align === 'center'
        );
        setPisiWordCommandPressed(
            toolbar,
            'justifyRight',
            ['right', 'end'].includes(align)
        );
        setPisiWordCommandPressed(
            toolbar,
            'justifyFull',
            align === 'justify'
        );
    }
}

function notifyPisiWordEditorChanged(editor) {
    if (!editor) return;
    if (typeof window.notifyPisiEditorChanged === 'function') {
        window.notifyPisiEditorChanged(editor);
        return;
    }
    editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'formatSet'
    }));
}

function selectPisiWordRange(range) {
    const selection = window.getSelection?.();
    if (!selection || !range) return;
    selection.removeAllRanges();
    selection.addRange(range);
}

function getPisiWordTypingSpan(editor, range) {
    const element = getPisiWordElementFromRange(editor, range);
    const span = element?.closest?.('.pisi-typing-style');
    return span && editor.contains(span) ? span : null;
}

function makePisiWordStyledSpan(property, value) {
    const span = document.createElement('span');
    span.className = 'pisi-typing-style';
    span.style[property] = value;
    return span;
}

function applyPisiWordInlineStyle(toolbar, property, value) {
    const editor = getPisiWordEditor(toolbar);
    if (!editor) return false;
    restorePisiWordSelection(toolbar);

    const selection = window.getSelection?.();
    const range = getPisiWordRangeInsideEditor(editor, selection);
    if (!range) return false;

    if (range.collapsed) {
        let span = getPisiWordTypingSpan(editor, range);
        if (!span) {
            span = makePisiWordStyledSpan(property, value);
            const textNode = document.createTextNode('');
            span.appendChild(textNode);
            range.insertNode(span);
            range.setStart(textNode, 0);
            range.collapse(true);
        } else {
            span.style[property] = value;
        }
        selectPisiWordRange(range);
    } else {
        const startBlock = getPisiWordBlock(editor, range.startContainer);
        const endBlock = getPisiWordBlock(editor, range.endContainer);

        if (startBlock && startBlock === endBlock) {
            const span = makePisiWordStyledSpan(property, value);
            const fragment = range.extractContents();
            span.appendChild(fragment);
            range.insertNode(span);
            range.selectNodeContents(span);
            selectPisiWordRange(range);
        } else {
            const blocks = Array.from(editor.querySelectorAll('.pisi-editor-block'))
                .filter((block) => {
                    try {
                        return range.intersectsNode(block);
                    } catch {
                        return false;
                    }
                });
            blocks.forEach((block) => {
                block.style[property] = value;
            });
        }
    }

    notifyPisiWordEditorChanged(editor);
    rememberPisiWordSelection(toolbar);
    syncPisiWordToolbarState(toolbar);
    return true;
}

function applyPisiWordBlockStyle(toolbar, tagName) {
    const editor = getPisiWordEditor(toolbar);
    if (!editor) return false;
    restorePisiWordSelection(toolbar);
    const range = getPisiWordRange(toolbar);
    const block = getPisiWordBlock(editor, range?.startContainer);
    const type = PISI_WORD_BLOCK_TYPES[String(tagName || '').toLowerCase()];
    if (!block || !type || typeof window.applyPisiBlockType !== 'function') {
        document.execCommand('formatBlock', false, tagName || 'div');
        notifyPisiWordEditorChanged(editor);
        return true;
    }

    const next = window.applyPisiBlockType(block, type);
    if (next) {
        const nextRange = document.createRange();
        nextRange.selectNodeContents(next);
        nextRange.collapse(false);
        selectPisiWordRange(nextRange);
    }
    rememberPisiWordSelection(toolbar);
    syncPisiWordToolbarState(toolbar);
    return Boolean(next);
}

function applyPisiWordSheetFormat(toolbar, command, value) {
    const editor = getPisiWordEditor(toolbar);
    const cell = getPisiWordActiveCell(editor);
    const table = cell?.closest('table[data-pisi-sheet]');
    if (!table || typeof window.applyPisiSheetCellFormat !== 'function') return false;

    const action = command === 'fontName' ? 'fontFamily' : 'fontSize';
    const formattedValue = command === 'fontSize'
        ? `${normalizePisiWordFontSize(value)}px`
        : value;
    const changed = window.applyPisiSheetCellFormat(table, action, formattedValue);
    if (changed) {
        window.schedulePisiSheetEditorNotification?.(table);
        window.syncPisiSheetToolbarState?.(toolbar, table);
        syncPisiWordToolbarState(toolbar);
    }
    return changed;
}

function handlePisiWordToolbarChange(event, toolbar) {
    const select = event.target?.closest?.('select[data-pisi-unified-command]');
    if (!select) return;
    const command = select.dataset.pisiUnifiedCommand;
    if (!['fontName', 'fontSize', 'formatBlock'].includes(command)) return;

    event.stopImmediatePropagation();

    if (command === 'formatBlock') {
        if (!getPisiWordActiveCell(getPisiWordEditor(toolbar))) {
            applyPisiWordBlockStyle(toolbar, select.value);
        }
        queueMicrotask(() => syncPisiWordToolbarState(toolbar));
        return;
    }

    if (getPisiWordActiveCell(getPisiWordEditor(toolbar))) {
        applyPisiWordSheetFormat(toolbar, command, select.value);
        return;
    }

    if (command === 'fontName') {
        applyPisiWordInlineStyle(toolbar, 'fontFamily', select.value);
    } else {
        applyPisiWordInlineStyle(
            toolbar,
            'fontSize',
            `${normalizePisiWordFontSize(select.value)}px`
        );
    }
}

function configurePisiWordToolbarControls(toolbar) {
    const fontSelect = toolbar.querySelector('.pisi-font-family-select');
    const sizeSelect = toolbar.querySelector('.pisi-font-size-select');
    const styleSelect = toolbar.querySelector('.pisi-style-select');

    if (fontSelect && fontSelect.dataset.pisiWordOptions !== '1') {
        fontSelect.dataset.pisiWordOptions = '1';
        fontSelect.replaceChildren(...PISI_WORD_FONT_FAMILIES.map((family) => {
            const option = document.createElement('option');
            option.value = family;
            option.textContent = family;
            return option;
        }));
    }

    if (sizeSelect && sizeSelect.dataset.pisiWordOptions !== '1') {
        sizeSelect.dataset.pisiWordOptions = '1';
        sizeSelect.replaceChildren(...PISI_WORD_FONT_SIZES.map((size) => {
            const option = document.createElement('option');
            option.value = String(size);
            option.textContent = String(size);
            return option;
        }));
    }

    if (styleSelect && styleSelect.dataset.pisiWordOptions !== '1') {
        styleSelect.dataset.pisiWordOptions = '1';
        const records = [
            ['div', 'Normal'],
            ['h1', 'Heading 1'],
            ['h2', 'Heading 2'],
            ['h3', 'Heading 3'],
            ['blockquote', 'Quote'],
            ['pre', 'Code']
        ];
        styleSelect.replaceChildren(...records.map(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            return option;
        }));
    }

    syncPisiWordToolbarState(toolbar);
}

function getPisiWordHeadingLevel(block) {
    if (!block) return 0;
    const type = typeof window.getPisiBlockType === 'function'
        ? window.getPisiBlockType(block)
        : block.dataset.pisiBlockType;
    return {
        heading1: 1,
        heading2: 2,
        heading3: 3
    }[type] || 0;
}

function syncPisiWordHeadingCollapse(editor) {
    if (!editor) return;
    const blocks = Array.from(editor.querySelectorAll('.pisi-editor-block'));
    blocks.forEach((block) => block.classList.remove('pisi-heading-section-hidden'));

    const collapsedLevels = [];
    for (const block of blocks) {
        const level = getPisiWordHeadingLevel(block);
        if (level) {
            while (
                collapsedLevels.length &&
                collapsedLevels[collapsedLevels.length - 1] >= level
            ) {
                collapsedLevels.pop();
            }

            block.classList.toggle(
                'pisi-heading-section-hidden',
                collapsedLevels.length > 0
            );

            if (block.classList.contains('pisi-heading-collapsed')) {
                collapsedLevels.push(level);
            }
            continue;
        }

        block.classList.remove('pisi-heading-collapsed');
        block.classList.toggle(
            'pisi-heading-section-hidden',
            collapsedLevels.length > 0
        );
    }
}

function togglePisiWordHeading(block) {
    const editor = block?.closest?.('.pisi-rich-editor');
    if (!editor || !getPisiWordHeadingLevel(block)) return false;
    block.classList.toggle('pisi-heading-collapsed');
    syncPisiWordHeadingCollapse(editor);
    notifyPisiWordEditorChanged(editor);
    return true;
}

function bindPisiWordEditor(editor) {
    if (!editor || pisiWordBoundEditors.has(editor)) return;
    pisiWordBoundEditors.add(editor);

    const sync = () => {
        syncPisiWordHeadingCollapse(editor);
        const toolbar = getPisiWordToolbarForEditor(editor);
        if (toolbar) {
            rememberPisiWordSelection(toolbar);
            syncPisiWordToolbarState(toolbar);
        }
    };

    editor.addEventListener('focusin', () => queueMicrotask(sync));
    editor.addEventListener('pointerup', () => queueMicrotask(sync));
    editor.addEventListener('keyup', () => queueMicrotask(sync));
    editor.addEventListener('input', () => queueMicrotask(sync));

    editor.addEventListener('pointerdown', (event) => {
        const block = event.target?.closest?.('.pisi-editor-block');
        const level = getPisiWordHeadingLevel(block);
        if (!level || !editor.contains(block)) return;
        const rect = block.getBoundingClientRect();
        if (event.clientX > rect.left + 26) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        togglePisiWordHeading(block);
        const toolbar = getPisiWordToolbarForEditor(editor);
        if (toolbar) syncPisiWordToolbarState(toolbar);
    }, true);

    syncPisiWordHeadingCollapse(editor);
}

function bindPisiWordToolbar(toolbar) {
    if (!toolbar || pisiWordBoundToolbars.has(toolbar)) return;
    pisiWordBoundToolbars.add(toolbar);

    toolbar.addEventListener('pointerdown', () => {
        rememberPisiWordSelection(toolbar);
    }, true);

    toolbar.addEventListener('change', (event) => {
        handlePisiWordToolbarChange(event, toolbar);
    }, true);

    toolbar.addEventListener('click', (event) => {
        const textControl = event.target?.closest?.(
            'button[data-pisi-unified-command], [data-pisi-color-trigger], [data-pisi-symbol-trigger], [data-pisi-todo-trigger]'
        );
        if (!textControl) return;

        const command =
            textControl.dataset?.pisiUnifiedCommand || '';
        const compositeAlignmentCommand =
            toolbar.classList.contains(
                'pisi-composite-context'
            ) &&
            [
                'justifyLeft',
                'justifyCenter',
                'justifyRight'
            ].includes(command);

        if (compositeAlignmentCommand) {
            return;
        }

        restorePisiWordSelection(toolbar);
        queueMicrotask(() => {
            rememberPisiWordSelection(toolbar);
            syncPisiWordToolbarState(toolbar);
        });
    }, true);

    const observer = new MutationObserver(() => {
        configurePisiWordToolbarControls(toolbar);
    });
    observer.observe(toolbar, { childList: true, subtree: true });
    configurePisiWordToolbarControls(toolbar);
}

function bindAllPisiWordBehavior() {
    document.querySelectorAll('.pisi-editor-toolbar, .pisi-word-toolbar')
        .forEach(bindPisiWordToolbar);
    document.querySelectorAll('.pisi-rich-editor')
        .forEach(bindPisiWordEditor);
}

function installPisiWordBehavior() {
    bindAllPisiWordBehavior();

    if (!pisiWordToolbarObserver && document.body) {
        pisiWordToolbarObserver = new MutationObserver(() => {
            bindAllPisiWordBehavior();
        });
        pisiWordToolbarObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    document.addEventListener('selectionchange', () => {
        document.querySelectorAll('.pisi-editor-toolbar, .pisi-word-toolbar')
            .forEach((toolbar) => {
                if (rememberPisiWordSelection(toolbar)) {
                    syncPisiWordToolbarState(toolbar);
                }
            });
    });

    document.addEventListener('pisi:active-node-changed', () => {
        queueMicrotask(bindAllPisiWordBehavior);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPisiWordBehavior, {
        once: true
    });
} else {
    installPisiWordBehavior();
}

export {};
