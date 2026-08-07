import { registerModule } from "../core/module-registry.mjs";
import { parsePisiTodoTagValue } from "./pisi-todo-utils.mjs";

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
    return Array.from(
        block?.querySelectorAll?.('.pisi-user-tag[data-pisi-tag]') || []
    ).filter((element) => {
        const value = element.dataset.pisiTag || element.textContent || '';
        return Boolean(parsePisiTodoTagValue(value));
    });
}

function getPisiTodoTagFromBlock(block) {
    const element = getPisiTodoTagElementsFromBlock(block)[0];
    return element
        ? normalizePisiTodoBlockTag(element.dataset.pisiTag || element.textContent)
        : '';
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
    return Array.from(
        block?.querySelectorAll?.('.pisi-user-tag[data-pisi-tag]') || []
    ).filter((element) => {
        if (normalizePisiTodoBlockTag(
            element.dataset.pisiTag || element.textContent
        ) !== 'done') {
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
    if (
        !marker.nextSibling ||
        marker.nextSibling.nodeType !== Node.TEXT_NODE ||
        !/^\s/.test(marker.nextSibling.nodeValue || '')
    ) {
        marker.after(document.createTextNode(' '));
    }

    const completed = isPisiTodoBlockCompleted(block, normalizedTodoTag);
    marker.textContent = completed ? '☑' : '☐';
    marker.setAttribute('role', 'checkbox');
    marker.setAttribute('aria-checked', String(completed));
    marker.setAttribute(
        'aria-label',
        completed ? 'Görevi yeniden aç' : 'Görevi tamamla'
    );
    marker.tabIndex = 0;
    window.hydratePisiBlockTaskMarker?.(block, marker);
    return marker;
}

function syncPisiTodoBlockMarkers(container) {
    if (!container?.querySelectorAll) return 0;
    const blocks = [];
    if (container.matches?.('.pisi-editor-block')) blocks.push(container);
    blocks.push(...container.querySelectorAll('.pisi-editor-block'));

    let synced = 0;
    for (const block of new Set(blocks)) {
        const todoElements = getPisiTodoTagElementsFromBlock(block);
        const doneElements = getPisiDoneTagElementsFromBlock(block);
        todoElements.forEach(markPisiTaskMetadataElement);
        doneElements.forEach(markPisiTaskMetadataElement);
        if (!todoElements.length) continue;
        if (ensurePisiTodoBlockMarker(block)) synced += 1;
    }
    return synced;
}

function makePisiTodoTagElement(todoTag) {
    const element = typeof window.createPisiUserTagElement === 'function'
        ? window.createPisiUserTagElement(todoTag, { status: 'todo' })
        : document.createElement('span');
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
    const previousTodoTag = existing
        ? normalizePisiTodoBlockTag(existing.dataset.pisiTag || existing.textContent)
        : '';
    const element = existing || makePisiTodoTagElement(normalizedTodoTag);

    element.dataset.pisiTag = normalizedTodoTag;
    element.dataset.pisiTodoStatus ||= 'todo';
    element.dataset.pisiTodoRepeat ||= 'none';
    element.textContent = normalizedTodoTag;
    markPisiTaskMetadataElement(element);

    if (!existing) {
        block.append(document.createTextNode(' '), element, document.createTextNode(' '));
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
    if (
        !command?.block ||
        !Number.isFinite(command.tokenStartInText) ||
        !Number.isFinite(command.tokenEndInText)
    ) {
        return false;
    }
    const range = window.makeRangeInElementByTextOffsets?.(
        command.block,
        command.tokenStartInText,
        command.tokenEndInText
    );
    if (!range) return false;
    range.deleteContents();
    return true;
}

function wrapPisiTodoSelection(command, todoTag) {
    const range = window.makeRangeInElementByTextOffsets?.(
        command.block,
        command.selectionStartInText,
        command.selectionEndInText
    );
    if (!range || range.collapsed) return null;
    const source = document.createElement('span');
    source.className = 'pisi-todo-source';
    source.dataset.pisiTodoFor = todoTag;
    source.appendChild(range.extractContents());
    range.insertNode(source);
    return source;
}

function ensurePisiTodoSourceForBlock(block, todoTag) {
    const existing = block.querySelector('.pisi-todo-source[data-pisi-todo-for]');
    if (existing) {
        existing.dataset.pisiTodoFor = todoTag;
        return existing;
    }

    const source = document.createElement('span');
    source.className = 'pisi-todo-source';
    source.dataset.pisiTodoFor = todoTag;
    const contentNodes = Array.from(block.childNodes).filter((node) => {
        return !(
            node.nodeType === Node.ELEMENT_NODE &&
            node.matches('.pisi-block-task-marker, .pisi-user-tag[data-pisi-tag]')
        );
    });
    contentNodes.forEach((node) => source.appendChild(node));
    if (!source.textContent && !source.querySelector('*')) {
        source.appendChild(document.createElement('br'));
    }
    const metadata = Array.from(block.children).find((element) => {
        return element.matches('.pisi-user-tag[data-pisi-tag]');
    });
    block.insertBefore(source, metadata || null);
    return source;
}

function setPisiTodoBlockCompletion(block, completed, options = {}) {
    const todoTag = normalizePisiTodoBlockTag(
        options.todoTag || getPisiTodoTagFromBlock(block)
    );
    if (!block || !todoTag) return false;

    const wasCompleted = isPisiTodoBlockCompleted(block, todoTag);
    let changed = false;
    if (Boolean(completed) !== wasCompleted) {
        changed = completed
            ? Boolean(window.appendPisiDoneTagToBlock?.(block, todoTag))
            : Boolean(window.removePisiDoneTagFromBlock?.(block, todoTag));
    }
    syncPisiTodoBlockMarkers(block);
    if (changed && options.dispatch !== false) {
        block.closest('.pisi-rich-editor')?.dispatchEvent(
            new Event('input', { bubbles: true })
        );
    }
    return changed;
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
    if (command.completeAfterApply === true) {
        setPisiTodoBlockCompletion(block, true, { todoTag, dispatch: false });
    }

    window.PISI_USER_TAG_CACHE?.add?.(todoTag);
    window.closePisiTagMenu?.();
    editor.focus({ preventScroll: true });
    window.placeCaretAtEnd?.(source);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

function getPisiTodoCommandBlock(editor, preferredBlock = null) {
    if (preferredBlock && editor.contains(preferredBlock)) return preferredBlock;
    const selection = window.getSelection?.();
    if (selection?.anchorNode && editor.contains(selection.anchorNode)) {
        const selectedBlock = window.getPisiCurrentEditorBlock?.(
            editor,
            selection.anchorNode
        );
        if (selectedBlock && selectedBlock !== editor) return selectedBlock;
    }
    const activeBlock = window.getPisiActiveBlock?.();
    if (activeBlock && editor.contains(activeBlock)) return activeBlock;
    return editor.querySelector('.pisi-editor-block');
}

function createPisiTodoBlockCommand(editor, options = {}) {
    if (!editor) return null;
    const selectionCommand = options.captureSelection === false
        ? null
        : window.capturePisiTodoSelection?.(editor);
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
    window.placeCaretAtEnd?.(
        block.querySelector('.pisi-todo-source') || block
    );
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
