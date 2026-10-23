import { getPisiBlockKeyboardContext } from './pisi-block-keyboard-context.mjs';
import { mergePisiKeyboardBlocks } from './pisi-block-keyboard-boundaries.mjs';

export function createPisiTaskBlockKeyboard({ getPisiBlockType, selectPisiBlock, placeCaretAtStartOfPisiBlock }) {
    function splitPisiTaskBlockOnEnter(editor, block, event) {
        if (event.defaultPrevented || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
            return false;
        }
        if (window.pisiTagMenuState?.active) return false;
        const tagMenu = document.getElementById('pisi-tag-menu');
        if (tagMenu && !tagMenu.hidden) return false;
        const isTaskBlock = getPisiBlockType(block) === 'task' || Boolean(window.getPisiTodoTagFromBlock?.(block));
        if (!isTaskBlock) return false;
        const context = getPisiBlockKeyboardContext(editor, event, block);
        if (!context) return false;
        event.preventDefault();
        event.stopImmediatePropagation();
        window.syncPisiTodoBlockMarkers?.(block);
        const { selection, range } = context;
        if (!range.collapsed) range.deleteContents();
        if (isPisiTaskBlockEmpty(block)) return revertPisiTaskBlockToParagraph(editor, block, selection);
        const nextBlock = document.createElement('div');
        nextBlock.className = 'pisi-editor-block';
        nextBlock.dataset.pisiBlockId = window.makePisiBlockId?.() || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        nextBlock.dataset.pisiBlockType = 'paragraph';
        const source = block.querySelector?.('.pisi-todo-source[data-pisi-todo-for]') || block;
        let trailingMoved = false;
        if (range && source && source.contains?.(range.startContainer) && typeof document.createRange === 'function') {
            const afterRange = document.createRange();
            afterRange.selectNodeContents(source);
            afterRange.setStart(range.startContainer, range.startOffset);
            const hasTrailingText = Boolean(afterRange.toString().trim());
            if (hasTrailingText) {
                const fragment = afterRange.extractContents();
                fragment.querySelectorAll?.('.pisi-user-tag, .pisi-block-task-marker').forEach((el) => el.remove());
                if (fragment.textContent?.trim() || fragment.querySelector?.('*:not(br)')) {
                    nextBlock.appendChild(fragment);
                    trailingMoved = true;
                }
                if (!source.childNodes?.length) {
                    source.appendChild(document.createTextNode(''));
                }
            }
        }
        if (!trailingMoved) {
            nextBlock.innerHTML = '<br>';
        }
        block.after(nextBlock);
        window.syncPisiTodoBlockMarkers?.(block);
        placeCaretAtStartOfPisiBlock(selection, nextBlock);
        selectPisiBlock(editor, nextBlock);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }
    function placeCaretAtEndOfPisiBlock(selection, block) {
        if (!selection || !block || typeof document.createRange !== 'function') return null;
        const caret = document.createRange();
        caret.selectNodeContents(block);
        caret.collapse(false);
        selection.removeAllRanges();
        selection.addRange(caret);
        return { node: caret.startContainer, offset: caret.startOffset };
    }
    function isCaretBeforePisiTaskMarker(block, range) {
        if (!range?.collapsed) return false;
        const marker = block.querySelector?.('.pisi-block-task-marker');
        if (!marker) return false;
        if (range.startContainer === block) return range.startOffset <= Array.prototype.indexOf.call(block.childNodes, marker);
        if (marker.contains(range.startContainer)) return false;
        if (block.contains(range.startContainer) && range.startContainer.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING) {
            const testRange = document.createRange();
            testRange.selectNodeContents(block);
            testRange.setEnd(range.startContainer, range.startOffset);
            return testRange.toString().replace(/\u200B/g, '').length === 0;
        }
        return false;
    }
    function isCaretAfterPisiTaskMarkerAtStart(block, source, range) {
        if (!range?.collapsed || isCaretBeforePisiTaskMarker(block, range)) return false;
        if (range.startContainer === block) {
            const marker = block.querySelector?.('.pisi-block-task-marker');
            return range.startOffset === (marker ? Array.prototype.indexOf.call(block.childNodes, marker) : 0) + 1;
        }
        const target = source && (range.startContainer === source || source.contains(range.startContainer)) ? source : block;
        const testRange = document.createRange();
        testRange.selectNodeContents(target);
        testRange.setEnd(range.startContainer, range.startOffset);
        return testRange.toString().replace(/[☐☑\u200B]/g, '').length === 0;
    }
    function isCaretAtStartOfPisiBlock(block, range) {
        if (!range?.collapsed || !block?.contains(range.startContainer)) return false;
        const testRange = document.createRange();
        testRange.selectNodeContents(block);
        testRange.setEnd(range.startContainer, range.startOffset);
        return !testRange.toString().replace(/\u200B/g, '').length;
    }
    function isCaretAtEndOfPisiBlock(block, range) {
        if (!range?.collapsed || !block?.contains(range.startContainer)) return false;
        const testRange = document.createRange();
        testRange.selectNodeContents(block);
        testRange.setStart(range.startContainer, range.startOffset);
        return !testRange.toString().replace(/\u200B/g, '').length;
    }
    function removePisiTaskMetadataAndMarkerFromBlock(block) {
        if (!block) return;
        if (typeof window.removePisiTodoFromBlock === 'function') {
            window.removePisiTodoFromBlock(block);
            return;
        }
        block.querySelectorAll?.('.pisi-block-task-marker').forEach((el) => {
            if (el.nextSibling?.nodeType === Node.TEXT_NODE && /^\s+$/.test(el.nextSibling.nodeValue || '')) {
                el.nextSibling.remove();
            }
            el.remove();
        });
        block.querySelectorAll?.('.pisi-user-tag[data-pisi-tag], .pisi-task-metadata').forEach((el) => el.remove());
        Array.from(block.querySelectorAll?.('.pisi-todo-source') || []).forEach((source) => {
            source.replaceWith(...Array.from(source.childNodes));
        });
        if (block.dataset?.pisiTaskId) delete block.dataset.pisiTaskId;
        block.dataset.pisiBlockType = 'paragraph';
        if (!block.textContent?.trim() && !block.querySelector?.('*:not(br)')) block.innerHTML = '<br>';
    }
    function revertPisiTaskBlockToParagraph(editor, block, selection) {
        removePisiTaskMetadataAndMarkerFromBlock(block);
        placeCaretAtStartOfPisiBlock(selection, block);
        selectPisiBlock(editor, block);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }
    function isPisiTaskBlockEmpty(block) {
        if (!block?.matches?.('.pisi-editor-block')) return false;
        const isTask =
            getPisiBlockType(block) === 'task' || Boolean(window.getPisiTodoTagFromBlock?.(block)) || Boolean(block.querySelector?.('.pisi-block-task-marker'));
        if (!isTask) return false;
        const source = block.querySelector?.('.pisi-todo-source');
        return !((source ? source.textContent : block.textContent) || '').replace(/[☐☑\s\u00A0\u200B]/g, '');
    }
    function handlePisiTaskBlockBackspace(editor, block, event) {
        if (event.defaultPrevented || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
            return false;
        }
        if (event.key !== 'Backspace' && event.key !== 'Delete') {
            return false;
        }
        if (window.pisiTagMenuState?.active) return false;
        const tagMenu = document.getElementById('pisi-tag-menu');
        if (tagMenu && !tagMenu.hidden) return false;
        const context = getPisiBlockKeyboardContext(editor, event, block);
        if (!context) return false;
        const { selection, range } = context;
        const isTask =
            getPisiBlockType(block) === 'task' || Boolean(window.getPisiTodoTagFromBlock?.(block)) || Boolean(block.querySelector?.('.pisi-block-task-marker'));
        const source = isTask ? block.querySelector?.('.pisi-todo-source') : null;
        const rawText = (source ? source.textContent : block.textContent) || '';
        const cleanText = rawText.replace(/[☐☑\s\u00A0\u200B]/g, '');
        const coversAll = isTask && !range.collapsed && Boolean(cleanText) && range.toString().replace(/[☐☑\s\u00A0\u200B]/g, '') === cleanText;
        if (coversAll) {
            event.preventDefault();
            event.stopImmediatePropagation();
            range.deleteContents();
            return revertPisiTaskBlockToParagraph(editor, block, selection);
        }
        // --- CASE 1: BACKSPACE ---
        if (event.key === 'Backspace') {
            if (isTask && (editor.contains(range.startContainer) || block.contains(range.startContainer))) {
                const isBeforeMarker = isCaretBeforePisiTaskMarker(block, range);
                // Subcase 1A: Caret is to the LEFT of the checkbox (|☐)
                // Backspace looks LEFT! Do NOT delete the checkbox on the right.
                if (range.collapsed && isBeforeMarker) {
                    const prevBlock = block.previousElementSibling;
                    if (prevBlock) {
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        mergePisiKeyboardBlocks(editor, prevBlock, block, removePisiTaskMetadataAndMarkerFromBlock);
                        return true;
                    }
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    return true;
                }
                if (!cleanText || (range.collapsed && isCaretAfterPisiTaskMarkerAtStart(block, source, range))) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    return revertPisiTaskBlockToParagraph(editor, block, selection);
                }
            }
            // Caret at start of a normal block, and previous block is an empty task block
            if (range.collapsed && isCaretAtStartOfPisiBlock(block, range)) {
                const prevBlock = block.previousElementSibling;
                if (isPisiTaskBlockEmpty(prevBlock)) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    prevBlock.remove();
                    placeCaretAtStartOfPisiBlock(selection, block);
                    selectPisiBlock(editor, block);
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                }
            }
        }
        // --- CASE 2: DELETE ---
        if (event.key === 'Delete') {
            if (isTask && range.collapsed) {
                // Subcase 2A (|☐ Text) or Subcase 2B (empty task)
                if (isCaretBeforePisiTaskMarker(block, range) || !cleanText) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    return revertPisiTaskBlockToParagraph(editor, block, selection);
                }
            }
            // Caret at end of block, and next block is an empty task block
            if (range.collapsed && isCaretAtEndOfPisiBlock(block, range)) {
                const nextBlock = block.nextElementSibling;
                if (isPisiTaskBlockEmpty(nextBlock)) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    nextBlock.remove();
                    selectPisiBlock(editor, block);
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                }
            }
        }
        return false;
    }
    return { splitPisiTaskBlockOnEnter, handlePisiTaskBlockBackspace, removePisiTaskMetadataAndMarkerFromBlock, placeCaretAtEndOfPisiBlock };
}
