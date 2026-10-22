import { registerModule } from '../core/module-registry.mjs';
import { parsePisiTodoTagValue } from './pisi-todo-utils.mjs';

function normalizePisiTodoBlockTag(value) {
    if (typeof window.normalizePisiUserTag === 'function') {
        return window.normalizePisiUserTag(value).toLowerCase();
    }
    return String(value || '')
        .trim()
        .replace(/^(?:\.\.|\/|#)/, '')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '')
        .toLowerCase();
}

function getPisiTodoTagElementsFromBlock(block) {
    return Array.from(block?.querySelectorAll?.('.pisi-user-tag[data-pisi-tag]') || []).filter((element) => {
        const value = element.dataset.pisiTag || element.textContent || '';
        return Boolean(parsePisiTodoTagValue(value));
    });
}

function getPisiTodoTagFromBlock(block) {
    const element = getPisiTodoTagElementsFromBlock(block)[0];
    return element ? normalizePisiTodoBlockTag(element.dataset.pisiTag || element.textContent) : '';
}

function markPisiTaskMetadataElement(element) {
    if (!element) return null;
    element.classList.add('pisi-task-metadata');
    element.contentEditable = 'false';
    element.setAttribute('aria-hidden', 'true');
    return element;
}

function getPisiDoneTagElementsFromBlock(block, todoTag = '') {
    const normalizedTodoTag = normalizePisiTodoBlockTag(todoTag);
    return Array.from(block?.querySelectorAll?.('.pisi-user-tag[data-pisi-tag]') || []).filter((element) => {
        if (normalizePisiTodoBlockTag(element.dataset.pisiTag || element.textContent) !== 'done') {
            return false;
        }
        const doneFor = normalizePisiTodoBlockTag(element.dataset.pisiDoneFor);
        return !normalizedTodoTag || !doneFor || doneFor === normalizedTodoTag;
    });
}

function isPisiTodoBlockCompleted(block, todoTag = getPisiTodoTagFromBlock(block)) {
    return getPisiDoneTagElementsFromBlock(block, todoTag).length > 0;
}

function ensurePisiTodoBlockMarker(block, todoTag = getPisiTodoTagFromBlock(block)) {
    const normalizedTodoTag = normalizePisiTodoBlockTag(todoTag);
    if (!block || !normalizedTodoTag) return null;

    getPisiTodoTagElementsFromBlock(block).forEach(markPisiTaskMetadataElement);
    getPisiDoneTagElementsFromBlock(block).forEach(markPisiTaskMetadataElement);

    block.classList.add('pisi-editor-block');
    block.dataset.pisiBlockType = 'task';

    const markers = Array.from(block.querySelectorAll('.pisi-block-task-marker'));
    const marker = markers.shift() || document.createElement('span');
    markers.forEach((duplicate) => duplicate.remove());
    marker.className = 'pisi-block-task-marker';
    marker.contentEditable = 'false';
    marker.dataset.pisiTodoCheckbox = normalizedTodoTag;

    if (marker.parentElement !== block || block.firstChild !== marker) {
        block.prepend(marker);
    }
    if (marker.nextSibling?.nodeType === Node.TEXT_NODE && !/\S/.test(marker.nextSibling.nodeValue || '')) {
        marker.nextSibling.remove();
    }

    const completed = isPisiTodoBlockCompleted(block, normalizedTodoTag);
    const nextText = completed ? '☑' : '☐';
    if (marker.textContent !== nextText) {
        marker.textContent = nextText;
    }
    marker.setAttribute('role', 'checkbox');
    marker.setAttribute('aria-checked', String(completed));
    marker.setAttribute('aria-label', completed ? 'Görevi yeniden aç' : 'Görevi tamamla');
    marker.tabIndex = 0;
    window.hydratePisiBlockTaskMarker?.(block, marker);
    return marker;
}

function cleanupOrphanPisiTodoBlock(block, doneElements = []) {
    if (!block || block.matches?.('.pisi-diary-managed-block') || block.closest?.('.pisi-diary-managed-block')) return;
    const orphanMarkers = Array.from(block.querySelectorAll?.('.pisi-block-task-marker') || []).filter(
        (marker) => !marker.closest?.('.pisi-diary-managed-block')
    );
    orphanMarkers.forEach((marker) => {
        if (marker.nextSibling?.nodeType === Node.TEXT_NODE && /^\s+$/.test(marker.nextSibling.nodeValue || '')) {
            marker.nextSibling.remove();
        }
        marker.remove();
    });
    doneElements.forEach((doneEl) => doneEl.remove());
    Array.from(block.querySelectorAll?.('.pisi-todo-source') || []).forEach((source) => {
        source.replaceWith(...Array.from(source.childNodes));
    });
    if (block.dataset?.pisiTaskId) {
        delete block.dataset.pisiTaskId;
    }
    if (block.dataset?.pisiBlockType === 'task' && !block.querySelector?.('.pisi-block-task-marker')) {
        block.dataset.pisiBlockType = 'paragraph';
        if (!block.textContent?.trim() && !block.querySelector?.('br')) {
            block.innerHTML = '<br>';
        }
    }
}

function removePisiTodoFromBlock(block) {
    if (!block || block.matches?.('.pisi-diary-managed-block') || block.closest?.('.pisi-diary-managed-block')) return false;
    block.querySelectorAll?.('.pisi-block-task-marker').forEach((el) => {
        if (el.closest?.('.pisi-diary-managed-block')) return;
        if (el.nextSibling?.nodeType === Node.TEXT_NODE && /^\s+$/.test(el.nextSibling.nodeValue || '')) {
            el.nextSibling.remove();
        }
        el.remove();
    });
    block.querySelectorAll?.('.pisi-user-tag[data-pisi-tag]').forEach((el) => {
        const tag = el.dataset?.pisiTag || el.textContent || '';
        if (/^(?:todo\.|done$)/i.test(tag) || el.classList.contains('pisi-task-metadata')) {
            el.remove();
        }
    });
    block.querySelectorAll?.('.pisi-task-metadata').forEach((el) => el.remove());
    Array.from(block.querySelectorAll?.('.pisi-todo-source') || []).forEach((source) => {
        source.replaceWith(...Array.from(source.childNodes));
    });
    if (block.dataset?.pisiTaskId) {
        delete block.dataset.pisiTaskId;
    }
    block.dataset.pisiBlockType = 'paragraph';
    if (!block.textContent?.trim() && !block.querySelector?.('*:not(br)')) {
        block.innerHTML = '<br>';
    }
    return true;
}

window.removePisiTodoFromBlock = removePisiTodoFromBlock;

function healSplitPisiTodoBlock(block) {
    if (!block) return false;
    const orphanMarker = block.querySelector?.('.pisi-block-task-marker[data-pisi-todo-checkbox]');
    if (!orphanMarker) return false;
    const nextBlock = block.nextElementSibling;
    if (!nextBlock || !nextBlock.matches?.('.pisi-editor-block')) return false;
    if (nextBlock.querySelector?.('.pisi-block-task-marker')) return false;

    const nextTodoElements = getPisiTodoTagElementsFromBlock(nextBlock);
    if (!nextTodoElements.length) return false;
    const nextDoneElements = getPisiDoneTagElementsFromBlock(nextBlock);

    nextTodoElements.forEach((el) => {
        markPisiTaskMetadataElement(el);
        block.append(el);
    });
    nextDoneElements.forEach((el) => {
        markPisiTaskMetadataElement(el);
        block.append(el);
    });

    if (nextBlock.dataset?.pisiTaskId) {
        if (!block.dataset?.pisiTaskId) {
            block.dataset.pisiTaskId = nextBlock.dataset.pisiTaskId;
        }
        delete nextBlock.dataset.pisiTaskId;
    }
    if (nextBlock.dataset?.pisiBlockId && nextBlock.dataset.pisiBlockId === block.dataset?.pisiBlockId) {
        nextBlock.dataset.pisiBlockId = window.makePisiBlockId?.() || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
    return true;
}

function syncPisiTodoBlockMarkers(container) {
    if (!container?.querySelectorAll) return 0;
    const blocks = [];
    if (container.matches?.('.pisi-editor-block')) blocks.push(container);
    blocks.push(...container.querySelectorAll('.pisi-editor-block'));

    let synced = 0;
    for (const block of new Set(blocks)) {
        if (block.matches?.('.pisi-diary-managed-block') || block.closest?.('.pisi-diary-managed-block')) continue;
        let todoElements = getPisiTodoTagElementsFromBlock(block);
        let doneElements = getPisiDoneTagElementsFromBlock(block);
        if (!todoElements.length && healSplitPisiTodoBlock(block)) {
            todoElements = getPisiTodoTagElementsFromBlock(block);
            doneElements = getPisiDoneTagElementsFromBlock(block);
        }
        todoElements.forEach(markPisiTaskMetadataElement);
        doneElements.forEach(markPisiTaskMetadataElement);
        if (!todoElements.length) {
            cleanupOrphanPisiTodoBlock(block, doneElements);
            continue;
        }
        const todoTag = getPisiTodoTagFromBlock(block);
        if (ensurePisiTodoBlockMarker(block, todoTag)) synced += 1;
        if (todoTag) {
            ensurePisiTodoSourceForBlock(block, todoTag);
        }
    }
    return synced;
}

function makePisiTodoTagElement(todoTag) {
    const element =
        typeof window.createPisiUserTagElement === 'function' ? window.createPisiUserTagElement(todoTag, { status: 'todo' }) : document.createElement('span');
    if (!element.dataset.pisiTag) {
        element.className = 'pisi-user-tag';
        element.dataset.pisiTag = todoTag;
        element.dataset.pisiTodoStatus = 'todo';
        element.dataset.pisiTodoRepeat = 'none';
        element.textContent = todoTag;
    }
    return markPisiTaskMetadataElement(element);
}

function upsertPisiTodoBlockMetadata(block, todoTag) {
    const normalizedTodoTag = normalizePisiTodoBlockTag(todoTag);
    const existing = getPisiTodoTagElementsFromBlock(block)[0];
    const previousTodoTag = existing ? normalizePisiTodoBlockTag(existing.dataset.pisiTag || existing.textContent) : '';
    const element = existing || makePisiTodoTagElement(normalizedTodoTag);

    element.dataset.pisiTag = normalizedTodoTag;
    element.dataset.pisiTodoStatus ||= 'todo';
    element.dataset.pisiTodoRepeat ||= 'none';
    element.textContent = normalizedTodoTag;
    markPisiTaskMetadataElement(element);

    if (!existing) {
        block.append(element);
    }

    block.querySelectorAll('.pisi-todo-source[data-pisi-todo-for]').forEach((source) => {
        const sourceFor = normalizePisiTodoBlockTag(source.dataset.pisiTodoFor);
        if (!sourceFor || !previousTodoTag || sourceFor === previousTodoTag) {
            source.dataset.pisiTodoFor = normalizedTodoTag;
        }
    });
    getPisiDoneTagElementsFromBlock(block, previousTodoTag).forEach((doneTag) => {
        doneTag.dataset.pisiDoneFor = normalizedTodoTag;
        markPisiTaskMetadataElement(doneTag);
    });
    return element;
}

function removePisiTodoCommandToken(command) {
    if (!command?.block || !Number.isFinite(command.tokenStartInText) || !Number.isFinite(command.tokenEndInText)) {
        return false;
    }
    const range = window.makeRangeInElementByTextOffsets?.(command.block, command.tokenStartInText, command.tokenEndInText);
    if (!range) return false;
    range.deleteContents();
    return true;
}

function wrapPisiTodoSelection(command, todoTag) {
    const range = window.makeRangeInElementByTextOffsets?.(command.block, command.selectionStartInText, command.selectionEndInText);
    if (!range || range.collapsed) return null;
    const source = document.createElement('span');
    source.className = 'pisi-todo-source';
    source.dataset.pisiTodoFor = todoTag;
    source.appendChild(range.extractContents());
    range.insertNode(source);
    return source;
}

function ensurePisiTodoSourceTextNode(source, position = 'end') {
    if (!source) return null;
    source.querySelectorAll?.('br').forEach((br) => br.remove());
    const target = position === 'start' ? source.firstChild : source.lastChild;
    if (target && target.nodeType === Node.TEXT_NODE) {
        return target;
    }
    const textNode = document.createTextNode('');
    if (position === 'start' && source.firstChild) {
        source.insertBefore(textNode, source.firstChild);
    } else {
        source.appendChild(textNode);
    }
    return textNode;
}

function absorbStrayNodesIntoPisiTodoSource(block, source) {
    if (!block || !source) return;
    const selection = window.getSelection?.();
    const activeRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const startContainer = activeRange?.startContainer || null;
    const startOffset = activeRange?.startOffset ?? 0;
    const selectionInsideBlock = Boolean(startContainer && (startContainer === block || block.contains?.(startContainer)));
    let restoreCaretNode = null;
    let restoreCaretOffset = 0;

    const initialChildren = Array.from(block.childNodes);
    const sourceIndex = initialChildren.indexOf(source);

    initialChildren.forEach((node, index) => {
        if (node === source) return;
        const isBeforeSource = sourceIndex === -1 || index < sourceIndex;

        if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches?.('.pisi-block-task-marker, .pisi-user-tag[data-pisi-tag]')) return;
            if (node.tagName === 'BR') {
                node.remove();
                return;
            }
            if (isBeforeSource && source.firstChild) {
                source.insertBefore(node, source.firstChild);
            } else {
                source.appendChild(node);
            }
            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            const raw = node.nodeValue || '';
            if (!/\S/.test(raw)) {
                const caretWasInWhitespaceNode = startContainer === node || (startContainer === block && (startOffset === index || startOffset === index + 1));
                node.remove();
                if (caretWasInWhitespaceNode && !restoreCaretNode) {
                    const targetText = ensurePisiTodoSourceTextNode(source, isBeforeSource ? 'start' : 'end');
                    if (targetText) {
                        restoreCaretNode = targetText;
                        restoreCaretOffset = isBeforeSource ? 0 : (targetText.nodeValue || '').length;
                    }
                }
                return;
            }

            let textToMove = raw;
            if (isBeforeSource && /^\s/.test(raw) && raw.length > 1) {
                textToMove = raw.slice(1);
            } else if (!isBeforeSource && /\s$/.test(raw) && raw.length > 1) {
                textToMove = raw.slice(0, -1);
            }
            node.remove();
            if (!textToMove) return;

            if (!(source.textContent || '')) {
                const targetText = ensurePisiTodoSourceTextNode(source, 'end');
                targetText.nodeValue = textToMove;
                if (selectionInsideBlock) {
                    restoreCaretNode = targetText;
                    restoreCaretOffset = textToMove.length;
                }
            } else if (isBeforeSource) {
                const firstText = ensurePisiTodoSourceTextNode(source, 'start');
                firstText.nodeValue = `${textToMove}${firstText.nodeValue || ''}`;
                if (selectionInsideBlock) {
                    restoreCaretNode = firstText;
                    restoreCaretOffset = textToMove.length;
                }
            } else {
                const lastText = ensurePisiTodoSourceTextNode(source, 'end');
                const previousLength = (lastText.nodeValue || '').length;
                lastText.nodeValue = `${lastText.nodeValue || ''}${textToMove}`;
                if (selectionInsideBlock) {
                    restoreCaretNode = lastText;
                    restoreCaretOffset = previousLength + textToMove.length;
                }
            }
        }
    });

    if (restoreCaretNode && selection && typeof document.createRange === 'function') {
        try {
            const nextRange = document.createRange();
            nextRange.setStart(restoreCaretNode, restoreCaretOffset);
            nextRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(nextRange);
        } catch {
            // Caret restore best-effort.
        }
    }
}

function ensurePisiTodoSourceForBlock(block, todoTag) {
    const existing = block.querySelector('.pisi-todo-source[data-pisi-todo-for]');
    if (existing) {
        existing.dataset.pisiTodoFor = todoTag;
        absorbStrayNodesIntoPisiTodoSource(block, existing);
        ensurePisiTodoSourceTextNode(existing, 'end');
        return existing;
    }

    const source = document.createElement('span');
    source.className = 'pisi-todo-source';
    source.dataset.pisiTodoFor = todoTag;
    const contentNodes = Array.from(block.childNodes).filter((node) => {
        return !(node.nodeType === Node.ELEMENT_NODE && node.matches('.pisi-block-task-marker, .pisi-user-tag[data-pisi-tag]'));
    });
    contentNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
            node.remove();
            return;
        }
        if (node.nodeType === Node.TEXT_NODE && !/\S/.test(node.nodeValue || '')) {
            node.remove();
            return;
        }
        source.appendChild(node);
    });
    ensurePisiTodoSourceTextNode(source, 'end');
    const metadata = Array.from(block.children).find((element) => {
        return element.matches('.pisi-user-tag[data-pisi-tag]');
    });
    block.insertBefore(source, metadata || null);
    return source;
}

function setPisiTodoBlockCompletion(block, completed, options = {}) {
    const todoTag = normalizePisiTodoBlockTag(options.todoTag || getPisiTodoTagFromBlock(block));
    if (!block || !todoTag) return false;

    const wasCompleted = isPisiTodoBlockCompleted(block, todoTag);
    let changed = false;
    if (Boolean(completed) !== wasCompleted) {
        changed = completed ? Boolean(window.appendPisiDoneTagToBlock?.(block, todoTag)) : Boolean(window.removePisiDoneTagFromBlock?.(block, todoTag));
    }
    syncPisiTodoBlockMarkers(block);
    if (changed && options.dispatch !== false) {
        block.closest('.pisi-rich-editor')?.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return changed;
}

function placeCaretInPisiTodoSource(source) {
    if (!source) return;
    const textNode = ensurePisiTodoSourceTextNode(source, 'end');
    window.placeCaretAtEnd?.(source);
    const selection = window.getSelection?.();
    if (textNode && selection && typeof document.createRange === 'function') {
        try {
            const range = document.createRange();
            const offset = textNode.nodeValue?.length || 0;
            range.setStart(textNode, offset);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        } catch {
            // Fallback to placeCaretAtEnd above.
        }
    }
}

function applyPisiTodoTagToEditor(editor, rawTodoTag, command) {
    const parsed = parsePisiTodoTagValue(rawTodoTag);
    const block = command?.block;
    if (!editor || !block || !parsed) return false;
    const todoTag = parsed.tag;

    let source = null;
    if (command.sourceSelection === true) {
        source = wrapPisiTodoSelection(command, todoTag);
        if (!source) return false;
    } else {
        removePisiTodoCommandToken(command);
        source = ensurePisiTodoSourceForBlock(block, todoTag);
    }

    upsertPisiTodoBlockMetadata(block, todoTag);
    source.dataset.pisiTodoFor = todoTag;
    ensurePisiTodoBlockMarker(block, todoTag);
    ensurePisiTodoSourceForBlock(block, todoTag);
    if (command.completeAfterApply === true) {
        setPisiTodoBlockCompletion(block, true, { todoTag, dispatch: false });
    }

    window.PISI_USER_TAG_CACHE?.add?.(todoTag);
    window.closePisiTagMenu?.();
    editor.focus({ preventScroll: true });
    placeCaretInPisiTodoSource(source);
    window.selectPisiBlock?.(editor, block);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    placeCaretInPisiTodoSource(source);
    window.selectPisiBlock?.(editor, block);
    return true;
}

function getPisiTodoCommandBlock(editor, preferredBlock = null) {
    if (preferredBlock && editor.contains(preferredBlock)) return preferredBlock;
    const selection = window.getSelection?.();
    if (selection?.anchorNode && editor.contains(selection.anchorNode)) {
        const selectedBlock = window.getPisiCurrentEditorBlock?.(editor, selection.anchorNode);
        if (selectedBlock && selectedBlock !== editor) return selectedBlock;
    }
    const activeBlock = window.getPisiActiveBlock?.();
    if (activeBlock && editor.contains(activeBlock)) return activeBlock;
    return editor.querySelector('.pisi-editor-block');
}

function createPisiTodoBlockCommand(editor, options = {}) {
    if (!editor) return null;
    const selectionCommand = options.captureSelection === false ? null : window.capturePisiTodoSelection?.(editor);
    if (selectionCommand) {
        return {
            ...selectionCommand,
            completeAfterApply: options.completeAfterApply === true
        };
    }
    const block = getPisiTodoCommandBlock(editor, options.block);
    if (!block) return null;
    return {
        editor,
        block,
        sourceSelection: false,
        completeAfterApply: options.completeAfterApply === true
    };
}

function openPisiTodoPickerForEditor(editor, options = {}) {
    const command = options.command || createPisiTodoBlockCommand(editor, options);
    if (!command || typeof window.openPisiTodoPriorityMenu !== 'function') {
        return false;
    }
    window.openPisiTodoPriorityMenu(editor, command);
    return true;
}

function applyPisiDoneCommandToEditor(editor, commandOverride = null) {
    const command = commandOverride || window.getPisiEditorCommandAtCaret?.(editor);
    const block = command?.block;
    if (!editor || !block) return false;
    const todoTag = getPisiTodoTagFromBlock(block);
    if (!todoTag) {
        return openPisiTodoPickerForEditor(editor, {
            command: { ...command, completeAfterApply: true }
        });
    }

    removePisiTodoCommandToken(command);
    setPisiTodoBlockCompletion(block, true, { todoTag, dispatch: false });
    window.closePisiTagMenu?.();
    editor.focus({ preventScroll: true });
    window.placeCaretAtEnd?.(block.querySelector('.pisi-todo-source') || block);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

const moduleApi = {
    normalizePisiTodoBlockTag,
    getPisiTodoTagFromBlock,
    isPisiTodoBlockCompleted,
    ensurePisiTodoBlockMarker,
    syncPisiTodoBlockMarkers,
    setPisiTodoBlockCompletion,
    applyPisiTodoTagToEditor,
    createPisiTodoBlockCommand,
    openPisiTodoPickerForEditor,
    applyPisiDoneCommandToEditor
};

registerModule('tags.todoBlocks', moduleApi);

export {
    applyPisiDoneCommandToEditor,
    applyPisiTodoTagToEditor,
    createPisiTodoBlockCommand,
    ensurePisiTodoBlockMarker,
    getPisiTodoTagFromBlock,
    isPisiTodoBlockCompleted,
    normalizePisiTodoBlockTag,
    openPisiTodoPickerForEditor,
    setPisiTodoBlockCompletion,
    syncPisiTodoBlockMarkers
};
