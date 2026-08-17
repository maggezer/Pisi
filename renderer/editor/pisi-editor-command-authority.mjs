import { registerModule } from '../core/module-registry.mjs';
import {
    isPisiInlineTextCommand,
    resolvePisiInlineTextMutation
} from './pisi-editor-text-format-core.mjs';

const pisiAuthoritativeSelections = new WeakMap();
const pisiAuthorityTypingStyles = new WeakMap();

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

function getPisiAuthorityToolbarForEditor(editor) {
    if (!editor?.id) return null;
    return document.querySelector(
        `.pisi-editor-toolbar[data-editor-target="${CSS.escape(editor.id)}"], ` +
        `.pisi-word-toolbar[data-editor-target="${CSS.escape(editor.id)}"]`
    );
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

function getPisiAuthorityTypingStyle(editor, property = null) {
    const state = pisiAuthorityTypingStyles.get(editor) || null;
    if (!property) return state ? { ...state } : null;
    return state && Object.prototype.hasOwnProperty.call(state, property)
        ? state[property]
        : null;
}

function setPisiAuthorityTypingStyle(editor, property, value) {
    if (!editor || !property) return false;
    const state = {
        ...(pisiAuthorityTypingStyles.get(editor) || {})
    };
    state[property] = value;
    pisiAuthorityTypingStyles.set(editor, state);
    return true;
}

function clearPisiAuthorityTypingStyles(editor) {
    if (!editor) return false;
    return pisiAuthorityTypingStyles.delete(editor);
}

function notifyPisiAuthorityEditorChanged(editor, inputType = 'formatSet', data = null) {
    if (!editor) return;
    if (typeof window.notifyPisiEditorChanged === 'function') {
        window.notifyPisiEditorChanged(editor);
        return;
    }
    const event = typeof InputEvent === 'function'
        ? new InputEvent('input', { bubbles: true, inputType, data })
        : new Event('input', { bubbles: true });
    editor.dispatchEvent(event);
}

function getPisiAuthorityEffectiveStyle(editor, range) {
    const probe = getPisiAuthorityElementFromRange(editor, range);
    const computed = probe ? getComputedStyle(probe) : {};
    const typing = pisiAuthorityTypingStyles.get(editor) || {};
    return {
        fontWeight: typing.fontWeight ?? computed.fontWeight,
        fontStyle: typing.fontStyle ?? computed.fontStyle,
        textDecoration: typing.textDecoration ?? computed.textDecoration,
        textDecorationLine: typing.textDecoration ?? computed.textDecorationLine
    };
}

function applyPisiAuthorityMutationToRange(editor, range, mutation) {
    if (!editor || !range || !mutation?.property) return false;

    if (range.collapsed) {
        setPisiAuthorityTypingStyle(editor, mutation.property, mutation.value);
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

function getPisiAuthorityCommandActive(editor, command) {
    const state = pisiAuthorityTypingStyles.get(editor) || {};
    if (command === 'bold' && Object.hasOwn(state, 'fontWeight')) {
        return Number.parseInt(state.fontWeight, 10) >= 600;
    }
    if (command === 'italic' && Object.hasOwn(state, 'fontStyle')) {
        return state.fontStyle === 'italic';
    }
    if (
        ['underline', 'strikeThrough'].includes(command) &&
        Object.hasOwn(state, 'textDecoration')
    ) {
        const target = command === 'underline' ? 'underline' : 'line-through';
        return String(state.textDecoration || '').includes(target);
    }
    return null;
}

function syncPisiAuthorityToolbarTypingState(editor) {
    const toolbar = getPisiAuthorityToolbarForEditor(editor);
    if (!toolbar) return;
    ['bold', 'italic', 'underline', 'strikeThrough'].forEach((command) => {
        const active = getPisiAuthorityCommandActive(editor, command);
        if (active === null) return;
        const button = toolbar.querySelector(
            `button[data-pisi-unified-command="${command}"]`
        );
        if (!button) return;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
}

function applyPisiAuthoritativeInlineCommand(editor, range, command) {
    if (!editor || !range || !isPisiInlineTextCommand(command)) return false;
    const style = getPisiAuthorityEffectiveStyle(editor, range);
    const mutation = resolvePisiInlineTextMutation(command, style);
    if (!mutation) return false;

    const changed = applyPisiAuthorityMutationToRange(editor, range, mutation);
    if (!changed) return false;

    notifyPisiAuthorityEditorChanged(editor);
    rememberPisiAuthoritySelection(editor);
    queueMicrotask(() => {
        window.syncPisiWordToolbarState?.(getPisiAuthorityToolbarForEditor(editor));
        syncPisiAuthorityToolbarTypingState(editor);
    });
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

function makePisiAuthorityTypingSignature(styles) {
    return Object.entries(styles || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}:${value}`)
        .join(';');
}

function getPisiAuthorityTypingSpan(editor, range, signature) {
    if (!range?.collapsed || range.startContainer?.nodeType !== Node.TEXT_NODE) return null;
    const span = range.startContainer.parentElement?.closest?.(
        '.pisi-typing-style[data-pisi-authority-typing="1"]'
    );
    if (!span || !editor.contains(span)) return null;
    return span.dataset.pisiAuthoritySignature === signature ? span : null;
}

function handlePisiAuthorityBeforeInput(event) {
    const editor = getPisiAuthorityEditorFromTarget(event.target);
    if (!editor) return;
    const styles = pisiAuthorityTypingStyles.get(editor);
    if (!styles || !Object.keys(styles).length) return;
    if (!['insertText', 'insertCompositionText', 'insertReplacementText'].includes(event.inputType)) {
        return;
    }
    if (typeof event.data !== 'string' || !event.data) return;

    const range = getPisiAuthorityRangeInsideEditor(editor);
    if (!range?.collapsed) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const signature = makePisiAuthorityTypingSignature(styles);
    const activeSpan = getPisiAuthorityTypingSpan(editor, range, signature);
    let textNode = range.startContainer;
    let nextOffset = range.startOffset;

    if (activeSpan && textNode?.nodeType === Node.TEXT_NODE) {
        textNode.insertData(range.startOffset, event.data);
        nextOffset = range.startOffset + event.data.length;
    } else {
        const span = document.createElement('span');
        span.className = 'pisi-typing-style pisi-inline-command-style';
        span.dataset.pisiAuthorityTyping = '1';
        span.dataset.pisiAuthoritySignature = signature;
        Object.entries(styles).forEach(([property, value]) => {
            span.style[property] = value;
        });
        textNode = document.createTextNode(event.data);
        span.appendChild(textNode);
        range.insertNode(span);
        nextOffset = event.data.length;
    }

    const caret = document.createRange();
    caret.setStart(textNode, nextOffset);
    caret.collapse(true);
    selectPisiAuthorityRange(caret);
    rememberPisiAuthoritySelection(editor);
    notifyPisiAuthorityEditorChanged(editor, 'insertText', event.data);
    queueMicrotask(() => syncPisiAuthorityToolbarTypingState(editor));
}

function handlePisiAuthorityEditorPointerUp(event) {
    const editor = getPisiAuthorityEditorFromTarget(event.target);
    if (!editor) return;
    rememberPisiAuthoritySelection(editor);
}

function initializePisiEditorCommandAuthority() {
    window.addEventListener('mousedown', handlePisiAuthorityToolbarPointerDown, true);
    window.addEventListener('click', handlePisiAuthorityToolbarClick, true);
    window.addEventListener('beforeinput', handlePisiAuthorityBeforeInput, true);
    window.addEventListener('pointerup', handlePisiAuthorityEditorPointerUp, true);

    document.addEventListener('selectionchange', () => {
        [
            document.getElementById('center-node-editor-content'),
            document.getElementById('node-modal-content')
        ].filter(Boolean).forEach(rememberPisiAuthoritySelection);
    });
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
    clearPisiAuthorityTypingStyles,
    getPisiAuthorityTypingStyle,
    initializePisiEditorCommandAuthority,
    isPisiInlineTextCommand,
    runPisiAuthoritativeMenuInlineCommand,
    syncPisiAuthorityToolbarTypingState
});

export {
    applyPisiAuthoritativeInlineCommand,
    clearPisiAuthorityTypingStyles,
    getPisiAuthorityTypingStyle,
    initializePisiEditorCommandAuthority,
    isPisiInlineTextCommand,
    runPisiAuthoritativeMenuInlineCommand,
    syncPisiAuthorityToolbarTypingState
};
