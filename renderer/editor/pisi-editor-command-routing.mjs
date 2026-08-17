import { registerModule } from '../core/module-registry.mjs';
import {
    getPisiDoubleDotCommandsPreference,
    getPisiLatexCommandsPreference
} from './pisi-editor-command-preferences.mjs';
import { runPisiExtendedUnifiedCommandItem } from './pisi-unified-command-formatting.mjs';

const PISI_EDITOR_TOKEN_CHARS = 'A-Za-z0-9ğüşöçıİĞÜŞÖÇ_-';

function getPisiTokenAtCaret(editor, mode = 'any') {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;

    const range = selection.getRangeAt(0);
    if (!editor?.contains?.(range.startContainer)) return null;

    const block = window.getPisiCurrentEditorBlock?.(editor, range.startContainer);
    if (!block) return null;

    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(block);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const beforeText = beforeRange.toString();

    let match = null;
    let trigger = '';

    if (mode === 'tag' || mode === 'any') {
        const tagRegex = new RegExp(
            `(^|\\s)(#[${PISI_EDITOR_TOKEN_CHARS}]*(?:\\.[${PISI_EDITOR_TOKEN_CHARS}]*)*)$`
        );
        match = beforeText.match(tagRegex);
        if (match) trigger = '#';
    }

    if (!match && (mode === 'command' || mode === 'any')) {
        const commandRegex = new RegExp(
            `(^|\\s)((?:\\.\\.|/)[${PISI_EDITOR_TOKEN_CHARS}]*(?:\\.[${PISI_EDITOR_TOKEN_CHARS}]*)*)$`
        );
        match = beforeText.match(commandRegex);
        if (match) trigger = match[2].startsWith('..') ? '..' : '/';
    }

    if (!match) return null;

    const token = match[2];
    const body = trigger === '..'
        ? token.slice(2)
        : token.slice(1);

    return {
        editor,
        block,
        range,
        token,
        trigger,
        body,
        tokenStartInText: beforeText.length - token.length,
        tokenEndInText: beforeText.length
    };
}

function buildPisiHashTagItems(command) {
    if (!command || command.trigger !== '#') return [];

    const body = String(command.body || '').trim();
    const lowerBody = body.toLocaleLowerCase('tr-TR');
    const suggestions = typeof window.collectPisiUserTagSuggestions === 'function'
        ? window.collectPisiUserTagSuggestions(command.editor)
        : [];

    const items = (Array.isArray(suggestions) ? suggestions : [])
        .filter((tag) => !/^(?:todo(?:\.|$)|done$)/i.test(String(tag || '')))
        .filter((tag) => {
            if (!body) return true;
            return String(tag).toLocaleLowerCase('tr-TR').startsWith(lowerBody);
        })
        .map((tag) => ({
            kind: 'user',
            id: String(tag),
            label: String(tag),
            typedToken: `#${tag}`,
            description: 'Kullanıcı etiketi'
        }));

    const exact = items.some((item) => {
        return item.label.toLocaleLowerCase('tr-TR') === lowerBody;
    });

    if (
        body &&
        !exact &&
        typeof window.isValidPisiUserTag === 'function' &&
        window.isValidPisiUserTag(body) &&
        !/^(?:todo(?:\.|$)|done$)/i.test(body)
    ) {
        items.unshift({
            kind: 'new-user',
            id: body,
            label: body,
            typedToken: `#${body}`,
            description: 'Yeni kullanıcı etiketi'
        });
    }

    return items.slice(0, 60);
}

function openPisiHashTagMenu(editor, command) {
    const items = buildPisiHashTagItems(command);
    if (!items.length) {
        if (window.pisiTagMenuState?.mode === 'hash-tags') {
            window.closePisiTagMenu?.();
        }
        return false;
    }

    window.closePisiUnifiedCommandMenu?.();
    window.openPisiTagMenuForEditor?.(editor, {
        ...command,
        mode: 'hash-tags',
        items
    });
    return true;
}

function closePisiCommandMenusForDisabledDoubleDot(editor) {
    const command = getPisiTokenAtCaret(editor, 'command');
    if (command?.trigger !== '..') return false;
    if (getPisiDoubleDotCommandsPreference()) return false;

    window.closePisiUnifiedCommandMenu?.();
    if (window.pisiTagMenuState?.editor === editor) {
        window.closePisiTagMenu?.();
    }
    return true;
}

function isPisiAllowedUnifiedItem(item) {
    if (!item) return false;
    if (item.kind === 'user' || item.kind === 'new-user' || item.kind === 'system') {
        return false;
    }
    if (item.kind === 'latex' && !getPisiLatexCommandsPreference()) {
        return false;
    }
    return true;
}

function renderPisiRoutedUnifiedMenu(editor, command) {
    const state = window.pisiUnifiedCommandState;
    const menu = document.getElementById('pisi-tag-menu');
    if (!state?.active || state.editor !== editor || !menu) return false;

    const activeCommand = command || state.command;
    if (!activeCommand) return false;

    if (activeCommand.trigger === '..' && !getPisiDoubleDotCommandsPreference()) {
        window.closePisiUnifiedCommandMenu?.();
        return false;
    }

    const items = (Array.isArray(state.items) ? state.items : [])
        .filter(isPisiAllowedUnifiedItem);

    if (!items.length) {
        window.closePisiUnifiedCommandMenu?.();
        return false;
    }

    state.command = activeCommand;
    state.items = items;
    state.selectedIndex = Math.min(state.selectedIndex, items.length - 1);

    const fragment = document.createDocumentFragment();
    let previousCategory = '';

    items.forEach((item, index) => {
        if (item.category !== previousCategory) {
            const heading = document.createElement('div');
            heading.className = 'pisi-unified-command-category';
            heading.textContent = item.category;
            fragment.appendChild(heading);
            previousCategory = item.category;
        }

        const option = document.createElement('button');
        option.type = 'button';
        option.className = `pisi-tag-option pisi-unified-command-option ${item.kind}`;
        option.classList.toggle('active', index === state.selectedIndex);
        option.dataset.pisiUnifiedIndex = String(index);

        const code = document.createElement('span');
        code.className = 'pisi-tag-option-code';
        code.textContent = item.typedToken;

        const description = document.createElement('span');
        description.className = 'pisi-tag-option-desc';
        description.textContent = item.description || item.label || item.id;

        option.append(code, description);
        option.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void runPisiExtendedUnifiedCommandItem(editor, activeCommand, item);
        });
        fragment.appendChild(option);
    });

    menu.replaceChildren(fragment);
    menu.classList.add('pisi-unified-command-menu');
    menu.hidden = false;
    window.positionPisiTagMenuAtSelection?.();
    return true;
}

function routePisiEditorToken(editor) {
    const tagCommand = getPisiTokenAtCaret(editor, 'tag');
    if (tagCommand) {
        openPisiHashTagMenu(editor, tagCommand);
        return;
    }

    if (window.pisiTagMenuState?.mode === 'hash-tags') {
        window.closePisiTagMenu?.();
    }

    const command = getPisiTokenAtCaret(editor, 'command');
    if (!command) return;

    if (command.trigger === '..' && !getPisiDoubleDotCommandsPreference()) {
        closePisiCommandMenusForDisabledDoubleDot(editor);
        return;
    }

    renderPisiRoutedUnifiedMenu(editor, command);
}

function schedulePisiEditorTokenRouting(editor) {
    queueMicrotask(() => routePisiEditorToken(editor));
}

function handlePisiEditorTokenKeydown(editor, event) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== ' ') return;

    const tagCommand = getPisiTokenAtCaret(editor, 'tag');
    if (tagCommand?.body) {
        if (
            typeof window.isValidPisiUserTag === 'function' &&
            window.isValidPisiUserTag(tagCommand.body) &&
            !/^(?:todo(?:\.|$)|done$)/i.test(tagCommand.body)
        ) {
            event.preventDefault();
            event.stopImmediatePropagation();
            window.applyPisiUserTagToEditor?.(editor, tagCommand.body, tagCommand);
        }
        return;
    }

    const command = getPisiTokenAtCaret(editor, 'command');
    if (!command) return;

    if (command.trigger === '..' && !getPisiDoubleDotCommandsPreference()) {
        // Keep ".." as normal text when the alternative command trigger is disabled.
        // Stop the legacy tag listener from converting it into a tag, but allow the
        // browser to insert the requested space.
        event.stopImmediatePropagation();
        return;
    }

    const body = String(command.body || '').trim().toLowerCase();
    if (body === 'todo') {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.openPisiTodoPriorityMenu?.(editor, command);
        return;
    }

    if (body === 'done') {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.applyPisiDoneCommandToEditor?.(editor, command);
        return;
    }

    // Slash and double-dot tokens are commands, never user tags. Let the browser
    // insert a normal space for unknown text, but block the legacy tag shortcut.
    event.stopImmediatePropagation();
}

function bindPisiEditorTokenRouting(editor) {
    if (!editor || editor.dataset.pisiTokenRoutingBound === '1') return false;
    editor.dataset.pisiTokenRoutingBound = '1';

    editor.addEventListener('keydown', (event) => {
        handlePisiEditorTokenKeydown(editor, event);
    }, true);
    editor.addEventListener('input', () => schedulePisiEditorTokenRouting(editor));
    editor.addEventListener('keyup', () => schedulePisiEditorTokenRouting(editor));
    editor.addEventListener('click', () => schedulePisiEditorTokenRouting(editor));
    return true;
}

function refreshPisiEditorTokenRouting() {
    [
        document.getElementById('center-node-editor-content'),
        document.getElementById('node-modal-content')
    ].filter(Boolean).forEach((editor) => {
        bindPisiEditorTokenRouting(editor);
        schedulePisiEditorTokenRouting(editor);
    });
}

function initializePisiEditorTokenRouting() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', refreshPisiEditorTokenRouting, { once: true });
    } else {
        refreshPisiEditorTokenRouting();
    }

    document.addEventListener('pisi:active-node-changed', refreshPisiEditorTokenRouting);
    document.addEventListener('pisi:editor-command-preferences-changed', () => {
        const active = window.pisiUnifiedCommandState?.editor;
        if (active) schedulePisiEditorTokenRouting(active);
        else refreshPisiEditorTokenRouting();
    });
}

const moduleApi = {
    buildPisiHashTagItems,
    getPisiTokenAtCaret,
    initializePisiEditorTokenRouting,
    openPisiHashTagMenu,
    refreshPisiEditorTokenRouting,
    renderPisiRoutedUnifiedMenu
};

registerModule('editor.commandRouting', moduleApi);
initializePisiEditorTokenRouting();

export {
    buildPisiHashTagItems,
    getPisiTokenAtCaret,
    initializePisiEditorTokenRouting,
    openPisiHashTagMenu,
    refreshPisiEditorTokenRouting,
    renderPisiRoutedUnifiedMenu
};