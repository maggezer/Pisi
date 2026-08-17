import { registerModule } from '../core/module-registry.mjs';
import {
    isPisiInlineTextCommand,
    resolvePisiInlineTextMutation
} from './pisi-editor-text-format-core.mjs';

const pisiAuthoritativeSelections = new WeakMap();
let pisiLegacySlashObserver = null;

function getPisiAuthorityEditorFromTarget(target) {
    const editor = target?.closest?.('.pisi-rich-editor');
    return editor?.isContentEditable ? editor : null;
}

function getPisiAuthorityToolbarFromTarget(target) {
    return target?.closest?.('.pisi-editor-toolbar, .pisi-word-toolbar') || null;
}

function getPisiAuthorityEditorForToolbar(toolbar) {
    const targetId = toolbar?.dataset?.editorTarget;
    return targetId ? document.getElementById(targetId) : null;
}

function getPisiAuthorityRangeInsideEditor(editor, selection = window.getSelection?.()) {
    if (!editor || !selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
        return null;
    }
    return range;
}

function rememberPisiAuthoritySelection(editor) {
    const range = getPisiAuthorityRangeInsideEditor(editor);
    if (!range) return false;
    pisiAuthoritativeSelections.set(editor, range.cloneRange());
    return true;
}

function restorePisiAuthoritySelection(editor) {
    const saved = pisiAuthoritativeSelections.get(editor);
    if (!editor || !saved) return null;
    if (!saved.startContainer?.isConnected || !saved.endContainer?.isConnected) {
        pisiAuthoritativeSelections.delete(editor);
        return null;
    }
    const range = saved.cloneRange();
    editor.focus({ preventScroll: true });
    const selection = window.getSelection?.();
    if (!selection) return null;
    selection.removeAllRanges();
    selection.addRange(range);
    return range;
}

function selectPisiAuthorityRange(range) {
    const selection = window.getSelection?.();
    if (!selection || !range) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

function getPisiAuthorityElementFromRange(editor, range) {
    if (!editor || !range) return null;
    let node = range.startContainer;
    if (node === editor && node.nodeType === Node.ELEMENT_NODE) {
        node = node.childNodes[Math.min(
            range.startOffset,
            Math.max(0, node.childNodes.length - 1)
        )] || editor;
    }
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    return node?.nodeType === Node.ELEMENT_NODE && editor.contains(node)
        ? node
        : editor;
}

function getPisiAuthorityBlock(editor, node) {
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const block = element?.closest?.('.pisi-editor-block');
    return block && editor?.contains(block) ? block : null;
}

function notifyPisiAuthorityEditorChanged(editor) {
    if (!editor) return;
    if (typeof window.notifyPisiEditorChanged === 'function') {
        window.notifyPisiEditorChanged(editor);
        return;
    }
    const event = typeof InputEvent === 'function'
        ? new InputEvent('input', { bubbles: true, inputType: 'formatSet' })
        : new Event('input', { bubbles: true });
    editor.dispatchEvent(event);
}

function applyPisiAuthorityMutationToRange(editor, range, mutation) {
    if (!editor || !range || !mutation?.property) return false;

    if (range.collapsed) {
        const span = document.createElement('span');
        span.className = 'pisi-typing-style pisi-inline-command-style';
        span.style[mutation.property] = mutation.value;
        const textNode = document.createTextNode('');
        span.appendChild(textNode);
        range.insertNode(span);
        range.setStart(textNode, 0);
        range.collapse(true);
        selectPisiAuthorityRange(range);
        return true;
    }

    const startBlock = getPisiAuthorityBlock(editor, range.startContainer);
    const endBlock = getPisiAuthorityBlock(editor, range.endContainer);

    if (startBlock && endBlock && startBlock !== endBlock) {
        const blocks = Array.from(editor.querySelectorAll('.pisi-editor-block'))
            .filter((block) => {
                try {
                    return range.intersectsNode(block);
                } catch {
                    return false;
                }
            });
        blocks.forEach((block) => {
            block.style[mutation.property] = mutation.value;
        });
        return blocks.length > 0;
    }

    const span = document.createElement('span');
    span.className = 'pisi-inline-command-style';
    span.style[mutation.property] = mutation.value;
    const fragment = range.extractContents();
    span.appendChild(fragment);
    range.insertNode(span);
    range.selectNodeContents(span);
    selectPisiAuthorityRange(range);
    return true;
}

function applyPisiAuthoritativeInlineCommand(editor, range, command) {
    if (!editor || !range || !isPisiInlineTextCommand(command)) return false;
    const probe = getPisiAuthorityElementFromRange(editor, range);
    if (!probe) return false;
    const mutation = resolvePisiInlineTextMutation(command, getComputedStyle(probe));
    if (!mutation) return false;

    const changed = applyPisiAuthorityMutationToRange(editor, range, mutation);
    if (!changed) return false;

    notifyPisiAuthorityEditorChanged(editor);
    rememberPisiAuthoritySelection(editor);
    const toolbar = document.querySelector(
        `.pisi-editor-toolbar[data-editor-target="${CSS.escape(editor.id)}"], ` +
        `.pisi-word-toolbar[data-editor-target="${CSS.escape(editor.id)}"]`
    );
    queueMicrotask(() => window.syncPisiWordToolbarState?.(toolbar));
    return true;
}

function makePisiAuthorityCommandRange(command) {
    if (!command?.block || typeof window.makeRangeInElementByTextOffsets !== 'function') {
        return null;
    }
    const range = window.makeRangeInElementByTextOffsets(
        command.block,
        command.tokenStartInText,
        command.tokenEndInText
    );
    if (!range) return null;
    range.deleteContents();
    range.collapse(true);
    return range;
}

function runPisiAuthoritativeMenuInlineCommand(editor, command, item) {
    if (!editor || !command || !isPisiInlineTextCommand(item?.execCommand)) return false;
    const range = makePisiAuthorityCommandRange(command);
    if (!range) return false;

    window.closePisiUnifiedCommandMenu?.();
    editor.focus({ preventScroll: true });
    selectPisiAuthorityRange(range);
    return applyPisiAuthoritativeInlineCommand(editor, range, item.execCommand);
}

function getPisiAuthorityUnifiedItem(index = null) {
    const state = window.pisiUnifiedCommandState;
    if (!state?.active || !Array.isArray(state.items)) return null;
    const resolvedIndex = index === null ? state.selectedIndex : Number(index);
    return state.items[resolvedIndex] || null;
}

function handlePisiAuthorityToolbarPointerDown(event) {
    const toolbar = getPisiAuthorityToolbarFromTarget(event.target);
    if (!toolbar) return;
    const editor = getPisiAuthorityEditorForToolbar(toolbar);
    if (editor) rememberPisiAuthoritySelection(editor);
}

function handlePisiAuthorityToolbarClick(event) {
    const button = event.target?.closest?.('button[data-pisi-unified-command]');
    if (!button) return false;
    const command = button.dataset.pisiUnifiedCommand;
    if (!isPisiInlineTextCommand(command)) return false;

    const toolbar = getPisiAuthorityToolbarFromTarget(button);
    const editor = getPisiAuthorityEditorForToolbar(toolbar);
    if (!editor) return false;

    const activeCell = window.__pisiActiveSheetCell;
    if (activeCell && editor.contains(activeCell)) return false;

    event.preventDefault();
    event.stopImmediatePropagation();

    let range = restorePisiAuthoritySelection(editor);
    if (!range) {
        editor.focus({ preventScroll: true });
        range = getPisiAuthorityRangeInsideEditor(editor);
    }
    if (!range) return false;
    return applyPisiAuthoritativeInlineCommand(editor, range, command);
}

function handlePisiAuthorityMenuPointerDown(event) {
    const option = event.target?.closest?.('.pisi-unified-command-option');
    if (!option) return false;
    const item = getPisiAuthorityUnifiedItem(option.dataset.pisiUnifiedIndex);
    if (!isPisiInlineTextCommand(item?.execCommand)) return false;

    const state = window.pisiUnifiedCommandState;
    const editor = state?.editor;
    const command = state?.command;
    if (!editor || !command) return false;

    event.preventDefault();
    event.stopImmediatePropagation();
    return runPisiAuthoritativeMenuInlineCommand(editor, command, item);
}

function isPisiAuthorityCommandTriggerPosition(editor) {
    const selection = window.getSelection?.();
    const range = getPisiAuthorityRangeInsideEditor(editor, selection);
    if (!range || !range.collapsed) return false;
    const block = window.getPisiCurrentEditorBlock?.(editor, range.startContainer);
    if (!block) return false;
    const before = range.cloneRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    const text = before.toString();
    return !text || /\s$/.test(text);
}

function handlePisiAuthorityWindowKeydown(event) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const editor = getPisiAuthorityEditorFromTarget(event.target);
    if (!editor) return;

    if (event.key === '/' && isPisiAuthorityCommandTriggerPosition(editor)) {
        removePisiLegacyBlockSlashMenus();
        event.stopImmediatePropagation();
        return;
    }

    const state = window.pisiUnifiedCommandState;
    if (!state?.active || state.editor !== editor) return;

    if (event.key === 'Enter' || event.key === 'Tab') {
        const item = getPisiAuthorityUnifiedItem();
        if (!isPisiInlineTextCommand(item?.execCommand)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        runPisiAuthoritativeMenuInlineCommand(editor, state.command, item);
        return;
    }

    if (event.key === ' ') {
        const command = window.getPisiTokenAtCaret?.(editor, 'command') ||
            window.getPisiEditorCommandAtCaret?.(editor);
        const body = String(command?.body || '').trim().toLocaleLowerCase('tr-TR');
        if (!body) return;
        const item = state.items.find((candidate) => {
            return String(candidate?.id || '').toLocaleLowerCase('tr-TR') === body;
        });
        if (!isPisiInlineTextCommand(item?.execCommand)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        runPisiAuthoritativeMenuInlineCommand(editor, command, item);
    }
}

function removePisiLegacyBlockSlashMenus() {
    document.querySelectorAll('.pisi-block-slash-menu').forEach((menu) => menu.remove());
}

function schedulePisiLegacyCommandMenuCleanup(editor) {
    if (!editor) return;
    queueMicrotask(() => {
        removePisiLegacyBlockSlashMenus();
        const command = window.getPisiTokenAtCaret?.(editor, 'command') ||
            window.getPisiEditorCommandAtCaret?.(editor);
        if (!command) return;

        const legacyState = window.pisiTagMenuState;
        if (legacyState?.editor === editor && legacyState.mode !== 'hash-tags') {
            window.closePisiTagMenu?.();
        }
    });
}

function handlePisiAuthorityEditorActivity(event) {
    const editor = getPisiAuthorityEditorFromTarget(event.target);
    if (!editor) return;
    rememberPisiAuthoritySelection(editor);
    schedulePisiLegacyCommandMenuCleanup(editor);
}

function initializePisiEditorCommandAuthority() {
    removePisiLegacyBlockSlashMenus();

    window.addEventListener('keydown', handlePisiAuthorityWindowKeydown, true);
    window.addEventListener('mousedown', (event) => {
        handlePisiAuthorityToolbarPointerDown(event);
        if (handlePisiAuthorityMenuPointerDown(event)) return;
    }, true);
    window.addEventListener('click', (event) => {
        handlePisiAuthorityToolbarClick(event);
    }, true);
    window.addEventListener('input', handlePisiAuthorityEditorActivity, true);
    window.addEventListener('keyup', handlePisiAuthorityEditorActivity, true);
    window.addEventListener('pointerup', handlePisiAuthorityEditorActivity, true);

    document.addEventListener('selectionchange', () => {
        [
            document.getElementById('center-node-editor-content'),
            document.getElementById('node-modal-content')
        ].filter(Boolean).forEach(rememberPisiAuthoritySelection);
    });

    if (!pisiLegacySlashObserver && document.body) {
        pisiLegacySlashObserver = new MutationObserver(() => {
            removePisiLegacyBlockSlashMenus();
        });
        pisiLegacySlashObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiEditorCommandAuthority, {
        once: true
    });
} else {
    initializePisiEditorCommandAuthority();
}

registerModule('editor.commandAuthority', {
    applyPisiAuthoritativeInlineCommand,
    initializePisiEditorCommandAuthority,
    removePisiLegacyBlockSlashMenus,
    runPisiAuthoritativeMenuInlineCommand
});

export {
    applyPisiAuthoritativeInlineCommand,
    initializePisiEditorCommandAuthority,
    removePisiLegacyBlockSlashMenus,
    runPisiAuthoritativeMenuInlineCommand
};
