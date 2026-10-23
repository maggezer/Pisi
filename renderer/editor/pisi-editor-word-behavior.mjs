import {
    capturePisiSelectionBookmark,
    resolvePisiSelectionBookmark,
    restorePisiSelectionBookmark,
    isPisiSelectionBookmarkDisplaced
} from './pisi-selection-bookmarks.mjs';
import { getPisiBlockKeyboardContext, hasPisiKeyboardContent, isPisiKeyboardLineEmpty, insertPisiKeyboardLineBreak } from './pisi-block-keyboard-context.mjs';
import { normalizePisiWordFontFamily, normalizePisiWordFontSize, ensurePisiWordSelectOption } from './pisi-word-font-controls.mjs';
const PISI_WORD_FONT_FAMILIES = Object.freeze(['Aptos', 'Calibri', 'Segoe UI', 'Arial', 'Times New Roman', 'Georgia', 'Consolas']);
const PISI_WORD_FONT_SIZES = Object.freeze([8, 9, 10, 11, 12, 14, 15, 16, 18, 20, 24, 28, 32, 36, 48, 72]);
const PISI_WORD_STYLE_OPTIONS = Object.freeze([
    ['div', 'Normal'],
    ['h1', 'Heading 1'],
    ['h2', 'Heading 2'],
    ['h3', 'Heading 3'],
    ['h4', 'Heading 4'],
    ['h5', 'Heading 5'],
    ['blockquote', 'Quote'],
    ['pre', 'Code']
]);
const PISI_WORD_BLOCK_TYPES = Object.freeze({
    div: 'paragraph',
    h1: 'heading1',
    h2: 'heading2',
    h3: 'heading3',
    h4: 'heading4',
    h5: 'heading5',
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
    const id = CSS.escape(editor.id);
    return document.querySelector(`.pisi-editor-toolbar[data-editor-target="${id}"], .pisi-word-toolbar[data-editor-target="${id}"]`);
}
function getPisiWordRangeInsideEditor(editor, selection = window.getSelection?.()) {
    if (!editor || !selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range : null;
}
function rememberPisiWordSelection(toolbar, force = false) {
    const editor = getPisiWordEditor(toolbar);
    const range = getPisiWordRangeInsideEditor(editor);
    if (!range) return false;
    const saved = pisiWordToolbarSelections.get(toolbar);
    if (!force && isPisiSelectionBookmarkDisplaced(editor, saved)) return false;
    const bookmark = capturePisiSelectionBookmark(editor);
    if (!bookmark) return false;
    pisiWordToolbarSelections.set(toolbar, bookmark);
    return true;
}
function restorePisiWordSelection(toolbar) {
    const editor = getPisiWordEditor(toolbar);
    const saved = pisiWordToolbarSelections.get(toolbar);
    if (!editor || !saved) return false;
    if (!restorePisiSelectionBookmark(editor, saved)) {
        pisiWordToolbarSelections.delete(toolbar);
        return false;
    }
    rememberPisiWordSelection(toolbar, true);
    return true;
}
function getPisiWordRange(toolbar) {
    const editor = getPisiWordEditor(toolbar);
    if (!editor) return null;
    const liveRange = getPisiWordRangeInsideEditor(editor);
    const saved = pisiWordToolbarSelections.get(toolbar);
    if (liveRange && !isPisiSelectionBookmarkDisplaced(editor, saved)) return liveRange;
    return resolvePisiSelectionBookmark(editor, saved)?.range || null;
}
function getPisiWordElementFromRange(editor, range) {
    if (!editor || !range) return null;
    let node = range.startContainer;
    if (node === editor && node.nodeType === Node.ELEMENT_NODE) {
        node = node.childNodes[Math.min(range.startOffset, Math.max(0, node.childNodes.length - 1))] || editor;
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
    return getPisiWordActiveCell(editor) || getPisiWordElementFromRange(editor, getPisiWordRange(toolbar)) || editor;
}
function getPisiWordBlock(editor, node) {
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const block = element?.closest?.('.pisi-editor-block');
    return block && editor?.contains(block) ? block : null;
}
function setPisiWordCommandPressed(toolbar, command, pressed) {
    const button = toolbar?.querySelector(`button[data-pisi-unified-command="${command}"]`);
    if (!button) return;
    button.classList.toggle('active', Boolean(pressed));
    button.setAttribute('aria-pressed', String(Boolean(pressed)));
}
function getPisiWordBlockStyleValue(editor, probe) {
    const block = getPisiWordBlock(editor, probe);
    if (!block) return 'div';
    const type = typeof window.getPisiBlockType === 'function' ? window.getPisiBlockType(block) : block.dataset.pisiBlockType;
    return { heading1: 'h1', heading2: 'h2', heading3: 'h3', heading4: 'h4', heading5: 'h5', quote: 'blockquote', code: 'pre' }[type] || 'div';
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
    const bold = style.fontWeight === 'bold' || (Number.isFinite(numericWeight) && numericWeight >= 600);
    const decorations = String(style.textDecorationLine || '');
    const verticalAlign = String(style.verticalAlign || '').toLowerCase();
    const block = getPisiWordBlock(editor, probe);
    const blockType = block && typeof window.getPisiBlockType === 'function' ? window.getPisiBlockType(block) : block?.dataset?.pisiBlockType;
    setPisiWordCommandPressed(toolbar, 'bold', bold);
    setPisiWordCommandPressed(toolbar, 'italic', style.fontStyle === 'italic');
    setPisiWordCommandPressed(toolbar, 'underline', decorations.includes('underline'));
    setPisiWordCommandPressed(toolbar, 'strikeThrough', decorations.includes('line-through'));
    setPisiWordCommandPressed(toolbar, 'subscript', verticalAlign === 'sub');
    setPisiWordCommandPressed(toolbar, 'superscript', verticalAlign === 'super');
    setPisiWordCommandPressed(toolbar, 'insertUnorderedList', Boolean(probe.closest?.('ul')) || blockType === 'bullet');
    setPisiWordCommandPressed(toolbar, 'insertOrderedList', Boolean(probe.closest?.('ol')) || blockType === 'number');
    const alignTarget = block || probe;
    const align = String(getComputedStyle(alignTarget).textAlign || '').toLowerCase();
    const compositeOwnsAlignment = toolbar.classList.contains('pisi-composite-context');
    if (!compositeOwnsAlignment) {
        setPisiWordCommandPressed(toolbar, 'justifyLeft', ['left', 'start', ''].includes(align));
        setPisiWordCommandPressed(toolbar, 'justifyCenter', align === 'center');
        setPisiWordCommandPressed(toolbar, 'justifyRight', ['right', 'end'].includes(align));
        setPisiWordCommandPressed(toolbar, 'justifyFull', align === 'justify');
    }
}
function notifyPisiWordEditorChanged(editor) {
    if (!editor) return;
    if (typeof window.notifyPisiEditorChanged === 'function') return window.notifyPisiEditorChanged(editor);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatSet' }));
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
    if (!restorePisiWordSelection(toolbar)) return false;
    const selection = window.getSelection?.();
    const range = getPisiWordRangeInsideEditor(editor, selection);
    if (!range) return false;
    const bookmark = range.collapsed ? null : capturePisiSelectionBookmark(editor);
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
            // Format only the selected text, never entire intersecting blocks.
            // Snapshot text ranges before editing because DOM Ranges are live.
            const portions = [];
            const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (!node.nodeValue?.length || !node.parentElement?.closest('.pisi-editor-block')) continue;
                if (node.parentElement.closest('[contenteditable="false"]')) continue;
                if (!range.intersectsNode(node)) continue;
                const portion = document.createRange();
                portion.selectNodeContents(node);
                if (portion.compareBoundaryPoints(Range.START_TO_START, range) < 0) {
                    portion.setStart(range.startContainer, range.startOffset);
                }
                if (portion.compareBoundaryPoints(Range.END_TO_END, range) > 0) {
                    portion.setEnd(range.endContainer, range.endOffset);
                }
                if (!portion.collapsed) portions.push(portion);
            }
            if (!portions.length) return false;
            const styled = [];
            // Work backwards so changing a later text node does not change
            // the offsets of ranges targeting earlier selected text.
            for (let i = portions.length - 1; i >= 0; i--) {
                const portion = portions[i];
                const span = makePisiWordStyledSpan(property, value);
                span.appendChild(portion.extractContents());
                portion.insertNode(span);
                styled.unshift(span);
            }
            const selectedRange = document.createRange();
            selectedRange.setStartBefore(styled[0]);
            selectedRange.setEndAfter(styled[styled.length - 1]);
            selectPisiWordRange(selectedRange);
        }
    }
    if (bookmark) restorePisiSelectionBookmark(editor, bookmark);
    notifyPisiWordEditorChanged(editor);
    rememberPisiWordSelection(toolbar, true);
    syncPisiWordToolbarState(toolbar);
    return true;
}
function applyPisiWordBlockStyle(toolbar, tagName) {
    const editor = getPisiWordEditor(toolbar);
    if (!editor) return false;
    if (!restorePisiWordSelection(toolbar)) return false;
    const selection = window.getSelection?.();
    const range = getPisiWordRangeInsideEditor(editor, selection);
    if (!range) return false;
    const type = PISI_WORD_BLOCK_TYPES[String(tagName || '').toLowerCase()];
    const startBlock = getPisiWordBlock(editor, range.startContainer);
    if (!startBlock || !type || typeof window.applyPisiBlockType !== 'function') return false;

    const bookmark = capturePisiSelectionBookmark(editor);
    const collapsed = range.collapsed;
    const blocks = Array.from(editor.children).filter((block) => {
        if (!block.classList.contains('pisi-editor-block')) return false;
        if (collapsed) return block === startBlock;
        try {
            return range.intersectsNode(block) && range.toString().length > 0;
        } catch {
            return false;
        }
    });
    if (!blocks.length) blocks.push(startBlock);
    const converted = new Map();
    for (const block of blocks) {
        const next = window.applyPisiBlockType(block, type);
        if (next) converted.set(block, next);
    }
    if (!converted.size) return false;

    if (!restorePisiSelectionBookmark(editor, bookmark)) return false;
    rememberPisiWordSelection(toolbar, true);
    syncPisiWordToolbarState(toolbar);
    return true;
}
function applyPisiWordSheetFormat(toolbar, command, value) {
    const editor = getPisiWordEditor(toolbar);
    const cell = getPisiWordActiveCell(editor);
    const table = cell?.closest('table[data-pisi-sheet]');
    if (!table || typeof window.applyPisiSheetCellFormat !== 'function') return false;
    const action = command === 'fontName' ? 'fontFamily' : 'fontSize';
    const formattedValue = command === 'fontSize' ? `${normalizePisiWordFontSize(value)}px` : value;
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
        applyPisiWordInlineStyle(toolbar, 'fontSize', `${normalizePisiWordFontSize(select.value)}px`);
    }
}
function populatePisiWordSelect(select, pairs) {
    if (!select || select.dataset.pisiWordOptions === '1') return;
    select.dataset.pisiWordOptions = '1';
    select.replaceChildren(...pairs.map(([val, text]) => Object.assign(document.createElement('option'), { value: String(val), textContent: String(text) })));
}
function configurePisiWordToolbarControls(toolbar) {
    populatePisiWordSelect(
        toolbar.querySelector('.pisi-font-family-select'),
        PISI_WORD_FONT_FAMILIES.map((f) => [f, f])
    );
    populatePisiWordSelect(
        toolbar.querySelector('.pisi-font-size-select'),
        PISI_WORD_FONT_SIZES.map((s) => [s, s])
    );
    populatePisiWordSelect(toolbar.querySelector('.pisi-style-select'), PISI_WORD_STYLE_OPTIONS);
    syncPisiWordToolbarState(toolbar);
}
function getPisiWordHeadingLevel(block) {
    if (!block) return 0;
    const tagMatch = block.tagName?.toLowerCase().match(/^h([1-5])$/);
    if (tagMatch) return Number(tagMatch[1]);
    const type = typeof window.getPisiBlockType === 'function' ? window.getPisiBlockType(block) : block.dataset?.pisiBlockType;
    return { heading1: 1, heading2: 2, heading3: 3, heading4: 4, heading5: 5 }[type] || 0;
}
function getPisiSectionExitLevel(block) {
    if (!block?.classList?.contains('pisi-section-break') && block?.dataset?.pisiSectionBreak !== 'true') {
        return null;
    }
    const raw = block.dataset?.pisiSectionExit;
    if (raw == null || raw === '') return null;
    const level = Number(raw);
    return Number.isInteger(level) && level >= 1 && level <= 5 ? level : null;
}
function applyPisiHeadingSectionExit(stack, block) {
    if (!block?.classList?.contains('pisi-section-break') && block?.dataset?.pisiSectionBreak !== 'true') {
        return;
    }
    const exitLevel = getPisiSectionExitLevel(block);
    if (exitLevel === null) {
        stack.pop();
    } else {
        while (stack.length && stack[stack.length - 1].level >= exitLevel) stack.pop();
    }
}
function getPisiActiveHeadingForBlock(editor, targetBlock) {
    if (!editor || targetBlock?.parentElement !== editor) return null;
    const stack = [];
    for (const block of editor.children) {
        if (block === targetBlock) {
            applyPisiHeadingSectionExit(stack, block);
            return stack.length ? stack[stack.length - 1].block : null;
        }
        applyPisiHeadingSectionExit(stack, block);
        const level = getPisiWordHeadingLevel(block);
        if (level) {
            while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
            stack.push({ block, level });
        }
    }
    return null;
}
function getPisiHeadingSectionBlocks(editor, headingBlock) {
    if (!editor || headingBlock?.parentElement !== editor) return [];
    const level = getPisiWordHeadingLevel(headingBlock);
    if (!level) return [];
    const result = [];
    let current = headingBlock.nextElementSibling;
    while (current && current.parentElement === editor) {
        const currentLevel = getPisiWordHeadingLevel(current);
        if (currentLevel && currentLevel <= level) break;
        if (current.classList.contains('pisi-section-break') || current.dataset?.pisiSectionBreak === 'true') {
            const exitLevel = getPisiSectionExitLevel(current);
            if (exitLevel === null || exitLevel <= level) break;
        }
        result.push(current);
        current = current.nextElementSibling;
    }
    return result;
}
function isPisiCurrentLineEmpty(block, range) {
    return isPisiKeyboardLineEmpty(block, range);
}

function handlePisiHeadingSectionKeydown(editor, event, blockOverride = null) {
    if (event.defaultPrevented || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
    if (window.pisiTagMenuState?.active) return false;
    const tagMenu = document.getElementById('pisi-tag-menu');
    if (tagMenu && !tagMenu.hidden) return false;
    const context = getPisiBlockKeyboardContext(editor, event, blockOverride);
    if (!context) return false;
    const { range, block } = context;
    const isEmpty = !hasPisiKeyboardContent(block);
    const headingLevel = getPisiWordHeadingLevel(block);
    if (event.key === 'Backspace' && (!range || range.collapsed)) {
        if ((block.classList.contains('pisi-section-break') || block.dataset?.pisiSectionBreak === 'true') && isEmpty) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            block.classList.remove('pisi-section-break');
            delete block.dataset.pisiSectionBreak;
            delete block.dataset.pisiSectionExit;
            syncPisiWordHeadingCollapse(editor);
            notifyPisiWordEditorChanged(editor);
            return true;
        }
        if ((headingLevel > 0 || ['quote', 'code'].includes(block.dataset?.pisiBlockType)) && isEmpty && typeof window.applyPisiBlockType === 'function') {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            const next = window.applyPisiBlockType(block, 'paragraph') || block;
            placePisiWordCaretAtBlockStart(editor, next);
            syncPisiWordHeadingCollapse(editor);
            notifyPisiWordEditorChanged(editor);
            return true;
        }
        return false;
    }
    if (event.key === 'Enter') {
        if (headingLevel > 0) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            block.classList.remove('pisi-heading-collapsed');
            if (isEmpty && typeof window.applyPisiBlockType === 'function') {
                const next = window.applyPisiBlockType(block, 'paragraph') || block;
                placePisiWordCaretAtBlockStart(editor, next);
                syncPisiWordHeadingCollapse(editor);
                notifyPisiWordEditorChanged(editor);
                return true;
            }
            const nextBlock = document.createElement('div');
            nextBlock.className = 'pisi-editor-block';
            nextBlock.dataset.pisiBlockId = window.makePisiBlockId?.() || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            nextBlock.dataset.pisiBlockType = 'paragraph';
            if (range && block.contains(range.startContainer) && typeof document.createRange === 'function') {
                if (!range.collapsed && block.contains(range.endContainer)) range.deleteContents();
                const afterRange = document.createRange();
                afterRange.selectNodeContents(block);
                afterRange.setStart(range.startContainer, range.startOffset);
                const fragment = afterRange.extractContents();
                if (fragment.textContent?.trim() || fragment.querySelector?.('*:not(br)')) nextBlock.appendChild(fragment);
            }
            if (!nextBlock.childNodes.length) nextBlock.innerHTML = '<br>';
            if (!block.textContent?.trim() && !block.querySelector?.('*:not(br)')) block.innerHTML = '<br>';
            block.after(nextBlock);
            placePisiWordCaretAtBlockStart(editor, nextBlock);
            syncPisiWordHeadingCollapse(editor);
            notifyPisiWordEditorChanged(editor);
            placePisiWordCaretAtBlockStart(editor, nextBlock);
            return true;
        }
        if (block.dataset?.pisiBlockType === 'bullet' || block.dataset?.pisiBlockType === 'task' || block.dataset?.pisiBlockType === 'number') {
            return false;
        }
        if (!range.collapsed) range.deleteContents();
        const isLineEmpty = isPisiCurrentLineEmpty(block, range);

        // 1. Enter: Satırda metin varken entera basıldığında yeni blok yapmaz, aynı blok içinde alt satıra geçer
        if (!isLineEmpty) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            insertPisiKeyboardLineBreak(editor, block, range);
            syncPisiWordHeadingCollapse(editor);
            notifyPisiWordEditorChanged(editor);
            return true;
        }

        // 2. Enter: Boş satırda entera basıldığında (2 kez enter) bloktan çıkılır ve yeni blok oluşturulur
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();

        let trailingFragment = null;
        if (range && block.contains(range.startContainer) && typeof document.createRange === 'function') {
            const afterRange = document.createRange();
            afterRange.selectNodeContents(block);
            afterRange.setStart(range.startContainer, range.startOffset);
            trailingFragment = afterRange.extractContents();
            while (trailingFragment.firstChild && trailingFragment.firstChild?.nodeName === 'BR') trailingFragment.firstChild.remove();
        }

        while (block.lastChild && block.lastChild?.nodeName === 'BR') block.lastChild.remove();
        if (!block.textContent?.trim() && !block.querySelector?.('*:not(br)')) block.innerHTML = '<br>';

        const nextBlock = document.createElement('div');
        nextBlock.className = 'pisi-editor-block';
        nextBlock.dataset.pisiBlockId = window.makePisiBlockId?.() || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        nextBlock.dataset.pisiBlockType = 'paragraph';

        if (trailingFragment && (trailingFragment.textContent?.trim() || trailingFragment.querySelector?.('*:not(br)'))) {
            nextBlock.appendChild(trailingFragment);
        } else {
            nextBlock.innerHTML = '<br>';
        }

        block.after(nextBlock);
        placePisiWordCaretAtBlockStart(editor, nextBlock);
        syncPisiWordHeadingCollapse(editor);
        notifyPisiWordEditorChanged(editor);
        return true;
    }
    return false;
}
function syncPisiWordHeadingCollapse(editor) {
    if (!editor) return;
    const elements = Array.from(editor.children).filter((el) => el.nodeType === Node.ELEMENT_NODE);
    elements.forEach((el) => el.classList.remove('pisi-heading-section-hidden'));
    const activeHeadingStack = [];
    for (const el of elements) {
        applyPisiHeadingSectionExit(activeHeadingStack, el);
        const level = getPisiWordHeadingLevel(el);
        if (level > 0) {
            while (activeHeadingStack.length && activeHeadingStack[activeHeadingStack.length - 1].level >= level) {
                activeHeadingStack.pop();
            }
            const isParentCollapsed = activeHeadingStack.some((item) => item.collapsed);
            el.classList.toggle('pisi-heading-section-hidden', isParentCollapsed);
            const isCollapsed = el.classList.contains('pisi-heading-collapsed');
            activeHeadingStack.push({
                element: el,
                level,
                collapsed: isCollapsed
            });
            el.dataset.pisiSectionLevel = String(level);
            continue;
        }
        el.classList.remove('pisi-heading-collapsed');
        const isHidden = activeHeadingStack.some((item) => item.collapsed);
        el.classList.toggle('pisi-heading-section-hidden', isHidden);
        const activeHeading = activeHeadingStack.length ? activeHeadingStack[activeHeadingStack.length - 1] : null;
        if (activeHeading) {
            el.dataset.pisiHeadingParent = activeHeading.element.dataset?.pisiBlockId || '';
            el.dataset.pisiSectionLevel = String(activeHeading.level);
        } else {
            delete el.dataset.pisiHeadingParent;
            el.dataset.pisiSectionLevel = '0';
        }
    }
    syncPisiBulletCollapse(editor);
}
function getPisiBulletIndent(block) {
    if (!block) return 0;
    const raw = block.dataset?.pisiBulletIndent || block.style?.getPropertyValue('--pisi-bullet-indent');
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
function setPisiBulletIndent(block, indent = 0) {
    if (!block) return;
    const cleanIndent = Math.max(0, Math.min(indent, 6));
    if (cleanIndent > 0) {
        block.dataset.pisiBulletIndent = String(cleanIndent);
        block.style.setProperty('--pisi-bullet-indent', String(cleanIndent));
    } else {
        delete block.dataset.pisiBulletIndent;
        block.style.removeProperty('--pisi-bullet-indent');
    }
}
function getPisiBulletDescendants(editor, bulletBlock) {
    if (!editor || !bulletBlock || bulletBlock.dataset?.pisiBlockType !== 'bullet') return [];
    const baseIndent = getPisiBulletIndent(bulletBlock);
    const descendants = [];
    let next = bulletBlock.nextElementSibling;
    while (next && next.classList.contains('pisi-editor-block')) {
        if (next.dataset?.pisiBlockType !== 'bullet') break;
        const nextIndent = getPisiBulletIndent(next);
        if (nextIndent <= baseIndent) break;
        descendants.push(next);
        next = next.nextElementSibling;
    }
    return descendants;
}
function hasPisiBulletChildren(editor, bulletBlock) {
    return getPisiBulletDescendants(editor, bulletBlock).length > 0;
}
function togglePisiBulletCollapse(block) {
    const editor = block?.closest?.('.pisi-rich-editor');
    if (!editor || block.dataset?.pisiBlockType !== 'bullet') return false;
    block.classList.toggle('pisi-bullet-collapsed');
    block.dataset.pisiBulletCollapsed = block.classList.contains('pisi-bullet-collapsed') ? 'true' : 'false';
    syncPisiBulletCollapse(editor);
    const sel = window.getSelection?.();
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !block.contains(range.startContainer)) placePisiWordCaretAtBlockStart(editor, block, true);
    else window.selectPisiBlock?.(editor, block);
    notifyPisiWordEditorChanged(editor);
    return true;
}
function syncPisiBulletCollapse(editor) {
    if (!editor) return;
    const blocks = Array.from(editor.querySelectorAll('.pisi-editor-block'));
    blocks.forEach((block) => {
        if (block.dataset?.pisiBlockType === 'bullet') {
            block.classList.remove('pisi-bullet-hidden');
            if (block.dataset.pisiBulletCollapsed === 'true') block.classList.add('pisi-bullet-collapsed');
            const hasChildren = hasPisiBulletChildren(editor, block);
            block.classList.toggle('pisi-bullet-has-children', hasChildren);
            block.dataset.pisiBulletHasChildren = hasChildren ? 'true' : 'false';
            if (!hasChildren && block.classList.contains('pisi-bullet-collapsed')) {
                block.classList.remove('pisi-bullet-collapsed');
                delete block.dataset.pisiBulletCollapsed;
            }
        }
    });
    const collapsedIndentStack = [];
    for (const block of blocks) {
        if (block.dataset?.pisiBlockType !== 'bullet') {
            collapsedIndentStack.length = 0;
            continue;
        }
        const indent = getPisiBulletIndent(block);
        while (collapsedIndentStack.length > 0 && collapsedIndentStack[collapsedIndentStack.length - 1] >= indent) {
            collapsedIndentStack.pop();
        }
        if (collapsedIndentStack.length > 0) {
            block.classList.add('pisi-bullet-hidden');
        } else if (block.classList.contains('pisi-bullet-collapsed')) {
            collapsedIndentStack.push(indent);
        }
    }
}
function placePisiWordCaretAtBlockStart(editor, targetBlock, atEnd = false) {
    if (!targetBlock) return;
    if (!targetBlock.textContent && !targetBlock.querySelector?.('br')) targetBlock.innerHTML = '<br>';
    editor?.focus?.({ preventScroll: true });
    const sel = window.getSelection?.();
    if (sel && typeof document.createRange === 'function') {
        const caret = document.createRange();
        if (atEnd && targetBlock.textContent) {
            caret.selectNodeContents(targetBlock);
            caret.collapse(false);
        } else if (targetBlock.firstChild && targetBlock.firstChild.nodeType === Node.TEXT_NODE && targetBlock.firstChild.nodeValue?.length) {
            caret.setStart(targetBlock.firstChild, 0);
            caret.collapse(true);
        } else {
            caret.setStart(targetBlock, 0);
            caret.collapse(true);
        }
        sel.removeAllRanges();
        sel.addRange(caret);
    }
    window.selectPisiBlock?.(editor, targetBlock);
}
function isPisiCaretAtBlockStart(block, range) {
    if (!range || !range.collapsed || !block?.contains?.(range.startContainer) || typeof document.createRange !== 'function') return false;
    const testRange = document.createRange();
    testRange.selectNodeContents(block);
    testRange.setEnd(range.startContainer, range.startOffset);
    return testRange.toString().replace(/\u200B/g, '').length === 0;
}
function handlePisiBulletKeydown(editor, event, blockOverride = null) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
    if (window.pisiTagMenuState?.active) return false;
    const tagMenu = document.getElementById('pisi-tag-menu');
    if (tagMenu && !tagMenu.hidden) return false;
    const context = getPisiBlockKeyboardContext(editor, event, blockOverride);
    if (!context) return false;
    const { range, block } = context;
    const blockType = block.dataset?.pisiBlockType;
    if (blockType !== 'bullet' && blockType !== 'number') return false;
    const indent = blockType === 'bullet' ? getPisiBulletIndent(block) : 0;
    const isEmpty = !hasPisiKeyboardContent(block);
    const isAtStart = isEmpty || isPisiCaretAtBlockStart(block, range);
    if (event.key === 'Tab' && blockType === 'bullet') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        const nextIndent = event.shiftKey ? Math.max(indent - 1, 0) : Math.min(indent + 1, 6);
        setPisiBulletIndent(block, nextIndent);
        let prev = block.previousElementSibling;
        while (prev && prev.dataset?.pisiBlockType === 'bullet') {
            if (getPisiBulletIndent(prev) < nextIndent) {
                prev.classList.remove('pisi-bullet-collapsed');
                prev.dataset.pisiBulletCollapsed = 'false';
                break;
            }
            prev = prev.previousElementSibling;
        }
        syncPisiWordHeadingCollapse(editor);
        if (isEmpty || !range || !block.contains(range.startContainer)) placePisiWordCaretAtBlockStart(editor, block);
        else {
            editor?.focus?.({ preventScroll: true });
            window.selectPisiBlock?.(editor, block);
        }
        notifyPisiWordEditorChanged(editor);
        return true;
    }
    if (((event.key === 'Backspace' && isAtStart) || (event.key === 'Enter' && isEmpty)) && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        let targetBlock = block;
        if (blockType === 'bullet' && indent > 0) {
            setPisiBulletIndent(block, indent - 1);
        } else {
            targetBlock = (typeof window.applyPisiBlockType === 'function' ? window.applyPisiBlockType(block, 'paragraph') : block) || block;
            targetBlock.dataset.pisiBlockType = 'paragraph';
            delete targetBlock.dataset.pisiBulletIndent;
            targetBlock.style?.removeProperty?.('--pisi-bullet-indent');
        }
        placePisiWordCaretAtBlockStart(editor, targetBlock);
        syncPisiWordHeadingCollapse(editor);
        notifyPisiWordEditorChanged(editor);
        return true;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        const isCollapsedParent = blockType === 'bullet' && block.classList.contains('pisi-bullet-collapsed');
        const descendants = blockType === 'bullet' ? getPisiBulletDescendants(editor, block) : [];
        const nextBlock = document.createElement('div');
        nextBlock.className = 'pisi-editor-block';
        nextBlock.dataset.pisiBlockId = window.makePisiBlockId?.() || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        nextBlock.dataset.pisiBlockType = blockType;
        let extractedTrailing = false;
        if (range && block.contains(range.startContainer) && typeof document.createRange === 'function') {
            if (!range.collapsed && block.contains(range.endContainer)) range.deleteContents();
            const afterRange = document.createRange();
            afterRange.selectNodeContents(block);
            afterRange.setStart(range.startContainer, range.startOffset);
            const fragment = afterRange.extractContents();
            if (fragment.textContent?.trim() || fragment.querySelector?.('*:not(br)')) {
                nextBlock.appendChild(fragment);
                extractedTrailing = true;
            }
        }
        if (!nextBlock.childNodes.length) nextBlock.innerHTML = '<br>';
        if (!block.textContent?.trim() && !block.querySelector?.('*:not(br)')) block.innerHTML = '<br>';
        if (blockType === 'bullet') {
            const nextIndent = !isCollapsedParent && !extractedTrailing && descendants.length > 0 ? Math.min(indent + 1, 6) : indent;
            if (nextIndent > 0) setPisiBulletIndent(nextBlock, nextIndent);
        }
        const insertAnchor = isCollapsedParent && !extractedTrailing && descendants.length > 0 ? descendants[descendants.length - 1] : block;
        insertAnchor.after(nextBlock);
        placePisiWordCaretAtBlockStart(editor, nextBlock);
        syncPisiWordHeadingCollapse(editor);
        notifyPisiWordEditorChanged(editor);
        return true;
    }
    return false;
}
function isClickOnPisiBulletMarker(block, clientX, clientY) {
    if (block?.dataset?.pisiBlockType !== 'bullet') return false;
    const indent = getPisiBulletIndent(block);
    const rect = block.getBoundingClientRect();
    const bulletLeft = rect.left + indent * 22;
    return clientX >= bulletLeft - 6 && clientX <= bulletLeft + 26 && clientY >= rect.top && clientY <= rect.top + 32;
}
function togglePisiWordHeading(block) {
    const editor = block?.closest?.('.pisi-rich-editor');
    if (!editor || !getPisiWordHeadingLevel(block)) return false;
    block.classList.toggle('pisi-heading-collapsed');
    syncPisiWordHeadingCollapse(editor);
    const sel = window.getSelection?.();
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !block.contains(range.startContainer)) placePisiWordCaretAtBlockStart(editor, block, true);
    notifyPisiWordEditorChanged(editor);
    return true;
}
function bindPisiWordEditor(editor) {
    if (!editor || pisiWordBoundEditors.has(editor)) return;
    pisiWordBoundEditors.add(editor);
    const sync = (force = false) => {
        syncPisiWordHeadingCollapse(editor);
        const toolbar = getPisiWordToolbarForEditor(editor);
        if (toolbar) {
            rememberPisiWordSelection(toolbar, force);
            syncPisiWordToolbarState(toolbar);
        }
    };
    editor.addEventListener('focusin', () => queueMicrotask(sync));
    editor.addEventListener('pointerup', () => queueMicrotask(() => sync(true)));
    editor.addEventListener('keydown', (event) => {
        if (editor.dataset.pisiBlocksEditorBound === '1') return;
        if (!handlePisiBulletKeydown(editor, event)) handlePisiHeadingSectionKeydown(editor, event);
    });
    editor.addEventListener('keyup', () => queueMicrotask(() => sync(true)));
    editor.addEventListener('input', () => queueMicrotask(() => sync(true)));
    editor.addEventListener(
        'pointerdown',
        (event) => {
            if (event.button !== 0) return;
            const block = event.target?.closest?.('.pisi-editor-block');
            if (!block || !editor.contains(block)) return;
            if (isClickOnPisiBulletMarker(block, event.clientX, event.clientY)) {
                if (hasPisiBulletChildren(editor, block) || block.classList.contains('pisi-bullet-collapsed')) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    togglePisiBulletCollapse(block);
                    return;
                }
            }
            const level = getPisiWordHeadingLevel(block);
            if (!level) return;
            const rect = block.getBoundingClientRect();
            if (event.clientX < rect.left - 28 || event.clientX > rect.left + 6) return;
            if (event.clientY < rect.top - 4 || event.clientY > rect.top + 36) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            togglePisiWordHeading(block);
            const toolbar = getPisiWordToolbarForEditor(editor);
            if (toolbar) syncPisiWordToolbarState(toolbar);
        },
        true
    );
    editor.addEventListener(
        'click',
        (event) => {
            if (event.button !== 0) return;
            const block = event.target?.closest?.('.pisi-editor-block');
            if (!block || !editor.contains(block)) return;
            if (isClickOnPisiBulletMarker(block, event.clientX, event.clientY)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const level = getPisiWordHeadingLevel(block);
            if (!level) return;
            const rect = block.getBoundingClientRect();
            if (event.clientX >= rect.left - 28 && event.clientX <= rect.left + 6 && event.clientY >= rect.top - 4 && event.clientY <= rect.top + 36) {
                event.preventDefault();
                event.stopPropagation();
            }
        },
        true
    );
    syncPisiWordHeadingCollapse(editor);
}
function bindPisiWordToolbar(toolbar) {
    if (!toolbar || pisiWordBoundToolbars.has(toolbar)) return;
    pisiWordBoundToolbars.add(toolbar);
    toolbar.addEventListener('pointerdown', () => rememberPisiWordSelection(toolbar, true), true);
    toolbar.addEventListener('change', (event) => handlePisiWordToolbarChange(event, toolbar), true);
    toolbar.addEventListener(
        'click',
        (event) => {
            const textControl = event.target?.closest?.(
                'button[data-pisi-unified-command], [data-pisi-color-trigger], [data-pisi-symbol-trigger], [data-pisi-todo-trigger]'
            );
            if (!textControl) return;
            const command = textControl.dataset?.pisiUnifiedCommand || '';
            const compositeAlignmentCommand =
                toolbar.classList.contains('pisi-composite-context') && ['justifyLeft', 'justifyCenter', 'justifyRight'].includes(command);
            if (compositeAlignmentCommand) {
                return;
            }
            if (getPisiWordActiveCell(getPisiWordEditor(toolbar))) return;
            if (!restorePisiWordSelection(toolbar)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            queueMicrotask(() => {
                rememberPisiWordSelection(toolbar, true);
                syncPisiWordToolbarState(toolbar);
            });
        },
        true
    );
    const observer = new MutationObserver(() => {
        configurePisiWordToolbarControls(toolbar);
    });
    observer.observe(toolbar, { childList: true, subtree: true });
    configurePisiWordToolbarControls(toolbar);
}
function bindAllPisiWordBehavior() {
    document.querySelectorAll('.pisi-editor-toolbar, .pisi-word-toolbar').forEach(bindPisiWordToolbar);
    document.querySelectorAll('.pisi-rich-editor').forEach((editor) => {
        bindPisiWordEditor(editor);
        syncPisiWordHeadingCollapse(editor);
    });
}
function installPisiWordBehavior() {
    bindAllPisiWordBehavior();
    if (!pisiWordToolbarObserver && document.body) {
        pisiWordToolbarObserver = new MutationObserver(() => bindAllPisiWordBehavior());
        pisiWordToolbarObserver.observe(document.body, { childList: true, subtree: true });
    }
    document.addEventListener('selectionchange', () => {
        document.querySelectorAll('.pisi-editor-toolbar, .pisi-word-toolbar').forEach((toolbar) => {
            if (rememberPisiWordSelection(toolbar)) syncPisiWordToolbarState(toolbar);
        });
    });
    document.addEventListener('pisi:active-node-changed', () => {
        queueMicrotask(bindAllPisiWordBehavior);
    });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installPisiWordBehavior, { once: true });
else installPisiWordBehavior();
if (typeof window !== 'undefined') {
    Object.assign(window, {
        syncPisiWordToolbarState,
        syncPisiWordHeadingCollapse,
        togglePisiWordHeading,
        getPisiWordHeadingLevel,
        getPisiActiveHeadingForBlock,
        getPisiHeadingSectionBlocks,
        handlePisiHeadingSectionKeydown,
        getPisiBulletIndent,
        setPisiBulletIndent,
        getPisiBulletDescendants,
        hasPisiBulletChildren,
        togglePisiBulletCollapse,
        syncPisiBulletCollapse,
        handlePisiBulletKeydown
    });
}
export {};
