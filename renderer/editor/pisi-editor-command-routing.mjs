import { registerModule } from '../core/module-registry.mjs';
import { getPisiDoubleDotCommandsPreference, getPisiLatexCommandsPreference } from './pisi-editor-command-preferences.mjs';
import { buildPisiUnifiedCommandItems, closePisiUnifiedCommandMenu, pisiUnifiedCommandState } from './pisi-unified-command-menu.mjs';
import { buildPisiWritingCommandItems, comparePisiExtendedUnifiedItems, runPisiExtendedUnifiedCommandItem } from './pisi-unified-command-formatting.mjs';

const PISI_EDITOR_TOKEN_CHARS = 'A-Za-z0-9ğüşöçıİĞÜŞÖÇ_-';

function normalizePisiCommandId(value = '') {
    return String(value || '')
        .trim()
        .toLocaleLowerCase('tr-TR');
}

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
        const tagRegex = new RegExp(`(^|\\s)(#[${PISI_EDITOR_TOKEN_CHARS}]*(?:\\.[${PISI_EDITOR_TOKEN_CHARS}]*)*)$`);
        match = beforeText.match(tagRegex);
        if (match) trigger = '#';
    }

    if (!match && (mode === 'command' || mode === 'any')) {
        const commandRegex = new RegExp(`(^|\\s)((?:\\.\\.|/)[${PISI_EDITOR_TOKEN_CHARS}]*(?:\\.[${PISI_EDITOR_TOKEN_CHARS}]*)*)$`);
        match = beforeText.match(commandRegex);
        if (match) trigger = match[2].startsWith('..') ? '..' : '/';
    }

    if (!match) return null;

    const token = match[2];
    const body = trigger === '..' ? token.slice(2) : token.slice(1);

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
    const suggestions = typeof window.collectPisiUserTagSuggestions === 'function' ? window.collectPisiUserTagSuggestions(command.editor) : [];

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

    if (body && !exact && typeof window.isValidPisiUserTag === 'function' && window.isValidPisiUserTag(body) && !/^(?:todo(?:\.|$)|done$)/i.test(body)) {
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
    closePisiUnifiedCommandMenu();

    if (!items.length) {
        if (window.pisiTagMenuState?.mode === 'hash-tags') {
            window.closePisiTagMenu?.();
        }
        return false;
    }

    window.openPisiTagMenuForEditor?.(editor, {
        ...command,
        mode: 'hash-tags',
        items
    });
    return true;
}

function normalizePisiBlockCommandItem(item) {
    if (item?.kind === 'block' && item.id === 'bullet') {
        return {
            ...item,
            category: 'Formatting · Lists',
            description: 'Madde işaretli liste bloğu',
            aliases: [...(item.aliases || []), 'bullet list', 'madde', 'maddeleme']
        };
    }
    if (item?.kind === 'block' && item.id === 'number') {
        return {
            ...item,
            category: 'Formatting · Lists',
            description: 'Numaralı liste bloğu',
            aliases: [...(item.aliases || []), 'numbered list', 'numbering', 'numarali', 'numaralı']
        };
    }
    return item;
}

function isPisiEssentialCommandItem(item) {
    return item?.kind === 'todo-start' || item?.kind === 'todo-done';
}

function isPisiRoutedCommandAllowed(command, item) {
    if (!command || !item || !['/', '..'].includes(command.trigger)) return false;
    if (command.trigger === '..' && !getPisiDoubleDotCommandsPreference()) return false;
    if (getPisiLatexCommandsPreference()) return true;
    return isPisiEssentialCommandItem(item);
}

function buildPisiFinalCommandItems(command) {
    if (!command || !['/', '..'].includes(command.trigger)) return [];
    if (command.trigger === '..' && !getPisiDoubleDotCommandsPreference()) return [];

    const writingItems = buildPisiWritingCommandItems(command);
    const baseItems = buildPisiUnifiedCommandItems(command).map(normalizePisiBlockCommandItem);
    const candidates = [...writingItems, ...baseItems];
    const allowedItems = getPisiLatexCommandsPreference() ? candidates : candidates.filter(isPisiEssentialCommandItem);

    const seen = new Set();
    return allowedItems
        .filter((item) => {
            const key = `${item.kind}:${normalizePisiCommandId(item.id)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort(comparePisiExtendedUnifiedItems)
        .slice(0, 120);
}

async function runPisiRoutedCommandItem(editor, command, item) {
    if (!isPisiRoutedCommandAllowed(command, item)) {
        closePisiUnifiedCommandMenu();
        return false;
    }
    return runPisiExtendedUnifiedCommandItem(editor, command, item);
}

function getPisiCommandMenuElement() {
    return document.getElementById('pisi-tag-menu');
}

function syncPisiCommandMenuSelection() {
    const menu = getPisiCommandMenuElement();
    if (!menu || !pisiUnifiedCommandState.active) return;
    menu.querySelectorAll('.pisi-unified-command-option').forEach((option) => {
        option.classList.toggle('active', Number(option.dataset.pisiUnifiedIndex) === pisiUnifiedCommandState.selectedIndex);
    });
    menu.querySelector(`.pisi-unified-command-option[data-pisi-unified-index="${pisiUnifiedCommandState.selectedIndex}"]`)?.scrollIntoView?.({
        block: 'nearest'
    });
}

function movePisiCommandMenuSelection(delta) {
    const count = pisiUnifiedCommandState.items.length;
    if (!count) return false;
    pisiUnifiedCommandState.selectedIndex = (pisiUnifiedCommandState.selectedIndex + delta + count) % count;
    syncPisiCommandMenuSelection();
    return true;
}

function renderPisiRoutedUnifiedMenu(editor, command) {
    const menu = getPisiCommandMenuElement();
    if (!menu || !editor || !command) return false;

    const items = buildPisiFinalCommandItems(command);
    if (!items.length) {
        closePisiUnifiedCommandMenu();
        return false;
    }

    if (window.pisiTagMenuState?.active) {
        window.closePisiTagMenu?.();
    }

    const previousBody = pisiUnifiedCommandState.command?.body;
    const previousTrigger = pisiUnifiedCommandState.command?.trigger;
    if (pisiUnifiedCommandState.editor !== editor || previousBody !== command.body || previousTrigger !== command.trigger) {
        pisiUnifiedCommandState.selectedIndex = 0;
    }

    pisiUnifiedCommandState.active = true;
    pisiUnifiedCommandState.editor = editor;
    pisiUnifiedCommandState.command = command;
    pisiUnifiedCommandState.items = items;
    pisiUnifiedCommandState.selectedIndex = Math.min(pisiUnifiedCommandState.selectedIndex, items.length - 1);

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
        option.classList.toggle('active', index === pisiUnifiedCommandState.selectedIndex);
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
            void runPisiRoutedCommandItem(editor, command, item);
        });
        fragment.appendChild(option);
    });

    menu.replaceChildren(fragment);
    menu.classList.add('pisi-unified-command-menu');
    menu.hidden = false;
    window.positionPisiTagMenuAtSelection?.();
    return true;
}

function closePisiRoutedMenuForEditor(editor) {
    if (pisiUnifiedCommandState.active && pisiUnifiedCommandState.editor === editor) {
        closePisiUnifiedCommandMenu();
    }
}

function routePisiEditorToken(editor) {
    const tagCommand = getPisiTokenAtCaret(editor, 'tag');
    if (tagCommand) {
        openPisiHashTagMenu(editor, tagCommand);
        return 'tag';
    }

    if (window.pisiTagMenuState?.mode === 'hash-tags') {
        window.closePisiTagMenu?.();
    }

    const command = getPisiTokenAtCaret(editor, 'command');
    if (!command) {
        closePisiRoutedMenuForEditor(editor);
        return null;
    }

    if (command.trigger === '..' && !getPisiDoubleDotCommandsPreference()) {
        closePisiRoutedMenuForEditor(editor);
        return null;
    }

    renderPisiRoutedUnifiedMenu(editor, command);
    return 'command';
}

function schedulePisiEditorTokenRouting(editor) {
    queueMicrotask(() => routePisiEditorToken(editor));
}

function getExactPisiCommandMenuItem(command) {
    const body = normalizePisiCommandId(command?.body);
    if (!body) return null;
    return (
        pisiUnifiedCommandState.items.find((item) => {
            return normalizePisiCommandId(item.id) === body;
        }) || null
    );
}

function handlePisiEditorTokenKeydown(editor, event) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;

    if (pisiUnifiedCommandState.active && pisiUnifiedCommandState.editor === editor) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopImmediatePropagation();
            movePisiCommandMenuSelection(event.key === 'ArrowDown' ? 1 : -1);
            return;
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            const item = pisiUnifiedCommandState.items[pisiUnifiedCommandState.selectedIndex];
            if (!item) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            void runPisiRoutedCommandItem(editor, pisiUnifiedCommandState.command, item);
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closePisiUnifiedCommandMenu();
            return;
        }
    }

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
    if (command.trigger === '..' && !getPisiDoubleDotCommandsPreference()) return;

    if (!pisiUnifiedCommandState.active || pisiUnifiedCommandState.editor !== editor) {
        renderPisiRoutedUnifiedMenu(editor, command);
    }

    const exact = getExactPisiCommandMenuItem(command);
    if (!exact) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    void runPisiRoutedCommandItem(editor, command, exact);
}

function bindPisiEditorTokenRouting(editor) {
    if (!editor || editor.dataset.pisiTokenRoutingBound === '1') return false;
    editor.dataset.pisiTokenRoutingBound = '1';

    editor.addEventListener(
        'keydown',
        (event) => {
            handlePisiEditorTokenKeydown(editor, event);
        },
        true
    );
    editor.addEventListener('input', () => schedulePisiEditorTokenRouting(editor));
    editor.addEventListener('keyup', () => schedulePisiEditorTokenRouting(editor));
    editor.addEventListener('click', () => schedulePisiEditorTokenRouting(editor));
    return true;
}

function refreshPisiEditorTokenRouting() {
    [document.getElementById('center-node-editor-content'), document.getElementById('node-modal-content')].filter(Boolean).forEach((editor) => {
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
        const active = pisiUnifiedCommandState.editor;
        if (active) schedulePisiEditorTokenRouting(active);
        else refreshPisiEditorTokenRouting();
    });

    document.addEventListener('mousedown', (event) => {
        if (!pisiUnifiedCommandState.active) return;
        const menu = getPisiCommandMenuElement();
        const target = event.target instanceof Node ? event.target : null;
        if (target && menu?.contains(target)) return;
        if (target && pisiUnifiedCommandState.editor?.contains(target)) return;
        closePisiUnifiedCommandMenu();
    });
}

const moduleApi = {
    buildPisiFinalCommandItems,
    buildPisiHashTagItems,
    getPisiTokenAtCaret,
    initializePisiEditorTokenRouting,
    openPisiHashTagMenu,
    refreshPisiEditorTokenRouting,
    renderPisiRoutedUnifiedMenu,
    routePisiEditorToken
};

registerModule('editor.commandRouting', moduleApi);
initializePisiEditorTokenRouting();

export {
    buildPisiFinalCommandItems,
    buildPisiHashTagItems,
    getPisiTokenAtCaret,
    initializePisiEditorTokenRouting,
    openPisiHashTagMenu,
    refreshPisiEditorTokenRouting,
    renderPisiRoutedUnifiedMenu,
    routePisiEditorToken
};
