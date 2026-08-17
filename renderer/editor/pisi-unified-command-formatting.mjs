import { registerModule } from '../core/module-registry.mjs';
import {
    closePisiUnifiedCommandMenu,
    pisiUnifiedCommandState,
    runPisiUnifiedCommandItem
} from './pisi-unified-command-menu.mjs';

const PISI_WRITING_COMMANDS = Object.freeze([
    Object.freeze({
        id: 'bold',
        label: 'Bold',
        description: 'Kalın yazmayı aç / kapat',
        category: 'Formatting · Text',
        execCommand: 'bold',
        aliases: ['b', 'strong', 'kalin', 'kalın']
    }),
    Object.freeze({
        id: 'italic',
        label: 'Italic',
        description: 'İtalik yazmayı aç / kapat',
        category: 'Formatting · Text',
        execCommand: 'italic',
        aliases: ['i', 'em', 'italik']
    }),
    Object.freeze({
        id: 'underline',
        label: 'Underline',
        description: 'Altı çizili yazmayı aç / kapat',
        category: 'Formatting · Text',
        execCommand: 'underline',
        aliases: ['u', 'alticizili', 'altı çizili']
    }),
    Object.freeze({
        id: 'strike',
        label: 'Strikethrough',
        description: 'Üstü çizili yazmayı aç / kapat',
        category: 'Formatting · Text',
        execCommand: 'strikeThrough',
        aliases: ['strikethrough', 's', 'ustucizili', 'üstü çizili']
    }),
    Object.freeze({
        id: 'superscript',
        label: 'Superscript',
        description: 'Üst simge biçimini aç / kapat',
        category: 'Formatting · Text',
        execCommand: 'superscript',
        aliases: ['super', 'ustsimge', 'üst simge']
    }),
    Object.freeze({
        id: 'subscript',
        label: 'Subscript',
        description: 'Alt simge biçimini aç / kapat',
        category: 'Formatting · Text',
        execCommand: 'subscript',
        aliases: ['sub', 'altsimge', 'alt simge']
    }),
    Object.freeze({
        id: 'clearformat',
        label: 'Clear formatting',
        description: 'Aktif yazı biçimlendirmesini temizle',
        category: 'Formatting · Text',
        execCommand: 'removeFormat',
        aliases: ['clear', 'resetformat', 'bicimtemizle', 'biçim temizle']
    }),
    Object.freeze({
        id: 'indent',
        label: 'Indent',
        description: 'Paragrafı / liste öğesini içeri girintile',
        category: 'Formatting · Lists',
        execCommand: 'indent',
        aliases: ['girinti', 'tab']
    }),
    Object.freeze({
        id: 'outdent',
        label: 'Outdent',
        description: 'Paragrafın / liste öğesinin girintisini azalt',
        category: 'Formatting · Lists',
        execCommand: 'outdent',
        aliases: ['girintiazalt', 'girinti azalt', 'shift tab']
    }),
    Object.freeze({
        id: 'alignleft',
        label: 'Align left',
        description: 'Paragrafı sola hizala',
        category: 'Formatting · Paragraph',
        execCommand: 'justifyLeft',
        aliases: ['left', 'sola', 'sola hizala']
    }),
    Object.freeze({
        id: 'aligncenter',
        label: 'Align center',
        description: 'Paragrafı ortala',
        category: 'Formatting · Paragraph',
        execCommand: 'justifyCenter',
        aliases: ['center', 'centre', 'ortala']
    }),
    Object.freeze({
        id: 'alignright',
        label: 'Align right',
        description: 'Paragrafı sağa hizala',
        category: 'Formatting · Paragraph',
        execCommand: 'justifyRight',
        aliases: ['right', 'saga', 'sağa', 'sağa hizala']
    }),
    Object.freeze({
        id: 'justify',
        label: 'Justify',
        description: 'Paragrafı iki yana yasla',
        category: 'Formatting · Paragraph',
        execCommand: 'justifyFull',
        aliases: ['full', 'ikiyana', 'iki yana yasla']
    }),
    Object.freeze({
        id: 'horizontalrule',
        label: 'Horizontal rule',
        description: 'Yatay ayırıcı çizgi ekle',
        category: 'Formatting · Paragraph',
        execCommand: 'insertHorizontalRule',
        aliases: ['hr', 'divider', 'separator', 'ayirici', 'ayırıcı']
    })
]);

const PISI_WRITING_CATEGORY_ORDER = new Map([
    ['Formatting · Text', 10],
    ['Formatting · Lists', 11],
    ['Formatting · Paragraph', 12],
    ['Tasks', 20],
    ['Blocks', 30],
    ['LaTeX · Yapı', 40],
    ['LaTeX · Operatör', 41],
    ['LaTeX · Matris', 42],
    ['LaTeX · Yunan', 43],
    ['LaTeX · Sembol', 44],
    ['LaTeX · İlişki', 45],
    ['LaTeX · Ok', 46],
    ['LaTeX · Vurgu', 47],
    ['Tags · System', 60],
    ['Tags · User', 70]
]);

function normalizePisiWritingSearch(value = '') {
    return String(value || '').trim().toLocaleLowerCase('tr-TR');
}

function matchesPisiWritingCommand(item, query) {
    const clean = normalizePisiWritingSearch(query);
    if (!clean) return true;
    const haystack = [
        item.id,
        item.label,
        item.description,
        item.category,
        ...(Array.isArray(item.aliases) ? item.aliases : [])
    ].map(normalizePisiWritingSearch).join(' ');
    return haystack.includes(clean);
}

function buildPisiWritingCommandItems(command) {
    if (!command) return [];
    return PISI_WRITING_COMMANDS
        .filter((record) => matchesPisiWritingCommand(record, command.body))
        .map((record) => ({
            ...record,
            kind: 'format',
            typedToken: `${command.trigger}${record.id}`
        }));
}

function normalizePisiLegacyUnifiedItem(item, command) {
    if (!item) return item;

    if (item.kind === 'latex' && item.id === 'underline') {
        return {
            ...item,
            id: 'texunderline',
            label: 'texunderline',
            typedToken: `${command.trigger}texunderline`,
            aliases: [...(item.aliases || []), 'latex underline']
        };
    }

    if (item.kind === 'latex' && item.id === 'subscript') {
        return {
            ...item,
            id: 'texsubscript',
            label: 'texsubscript',
            typedToken: `${command.trigger}texsubscript`,
            aliases: [...(item.aliases || []), 'latex subscript']
        };
    }

    if (item.kind === 'block' && item.id === 'bullet') {
        return {
            ...item,
            category: 'Formatting · Lists',
            description: 'Madde işaretli liste bloğu',
            aliases: [...(item.aliases || []), 'bullet list', 'madde', 'maddeleme']
        };
    }

    if (item.kind === 'block' && item.id === 'number') {
        return {
            ...item,
            category: 'Formatting · Lists',
            description: 'Numaralı liste bloğu',
            aliases: [...(item.aliases || []), 'numbered list', 'numbering', 'numarali', 'numaralı']
        };
    }

    return item;
}

function comparePisiExtendedUnifiedItems(a, b) {
    const category =
        (PISI_WRITING_CATEGORY_ORDER.get(a.category) || 99) -
        (PISI_WRITING_CATEGORY_ORDER.get(b.category) || 99);
    if (category) return category;
    return String(a.id || a.label || '').localeCompare(
        String(b.id || b.label || ''),
        'tr'
    );
}

function getPisiUnifiedMenuElement() {
    return document.getElementById('pisi-tag-menu');
}

function renderPisiExtendedUnifiedMenu(editor, command) {
    const menu = getPisiUnifiedMenuElement();
    if (!menu || !command || !pisiUnifiedCommandState.active) return false;

    const writingItems = buildPisiWritingCommandItems(command);
    const writingIds = new Set(writingItems.map((item) => normalizePisiWritingSearch(item.id)));

    const existingItems = (Array.isArray(pisiUnifiedCommandState.items)
        ? pisiUnifiedCommandState.items
        : [])
        .map((item) => normalizePisiLegacyUnifiedItem(item, command))
        .filter((item) => {
            if (item.kind !== 'new-user') return true;
            return !writingIds.has(normalizePisiWritingSearch(item.id));
        });

    const itemKey = (item) => `${item.kind}:${normalizePisiWritingSearch(item.id)}`;
    const seen = new Set();
    const combined = [...writingItems, ...existingItems]
        .filter((item) => {
            const key = itemKey(item);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort(comparePisiExtendedUnifiedItems)
        .slice(0, 120);

    if (!combined.length) return false;

    pisiUnifiedCommandState.items = combined;
    pisiUnifiedCommandState.selectedIndex = Math.min(
        pisiUnifiedCommandState.selectedIndex,
        combined.length - 1
    );

    const fragment = document.createDocumentFragment();
    let previousCategory = '';

    combined.forEach((item, index) => {
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
            void runPisiExtendedUnifiedCommandItem(editor, command, item);
        });
        fragment.appendChild(option);
    });

    menu.replaceChildren(fragment);
    menu.classList.add('pisi-unified-command-menu');
    menu.hidden = false;
    window.positionPisiTagMenuAtSelection?.();
    return true;
}

function schedulePisiExtendedUnifiedMenu(editor) {
    queueMicrotask(() => {
        const command = window.getPisiEditorCommandAtCaret?.(editor);
        if (!command) return;
        if (!pisiUnifiedCommandState.active || pisiUnifiedCommandState.editor !== editor) return;
        renderPisiExtendedUnifiedMenu(editor, command);
    });
}

function makePisiWritingRange(command) {
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

function applyPisiWritingCommand(editor, command, item) {
    const range = makePisiWritingRange(command);
    if (!range) return false;

    closePisiUnifiedCommandMenu();
    editor.focus({ preventScroll: true });

    const selection = window.getSelection?.();
    if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
    }

    const changed = document.execCommand(
        item.execCommand,
        false,
        item.value ?? null
    );

    editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'formatSet'
    }));
    return changed !== false;
}

async function runPisiExtendedUnifiedCommandItem(editor, command, item) {
    if (item?.kind === 'format') {
        return applyPisiWritingCommand(editor, command, item);
    }
    return runPisiUnifiedCommandItem(editor, command, item);
}

function syncPisiExtendedSelectionUi() {
    const menu = getPisiUnifiedMenuElement();
    if (!menu) return;
    menu.querySelectorAll('.pisi-unified-command-option').forEach((option) => {
        option.classList.toggle(
            'active',
            Number(option.dataset.pisiUnifiedIndex) === pisiUnifiedCommandState.selectedIndex
        );
    });
    menu.querySelector(
        `.pisi-unified-command-option[data-pisi-unified-index="${pisiUnifiedCommandState.selectedIndex}"]`
    )?.scrollIntoView?.({ block: 'nearest' });
}

function movePisiExtendedSelection(delta) {
    const count = pisiUnifiedCommandState.items.length;
    if (!count) return;
    pisiUnifiedCommandState.selectedIndex = (
        pisiUnifiedCommandState.selectedIndex + delta + count
    ) % count;
    syncPisiExtendedSelectionUi();
}

function getExactPisiExtendedItem(command) {
    const body = normalizePisiWritingSearch(command?.body);
    if (!body) return null;
    return pisiUnifiedCommandState.items.find((item) => {
        return normalizePisiWritingSearch(item.id) === body;
    }) || null;
}

function handlePisiExtendedUnifiedKeydown(event) {
    if (!pisiUnifiedCommandState.active) return;
    const editor = pisiUnifiedCommandState.editor;
    if (!editor || !editor.contains(event.target)) return;
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        movePisiExtendedSelection(event.key === 'ArrowDown' ? 1 : -1);
        return;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
        const item = pisiUnifiedCommandState.items[pisiUnifiedCommandState.selectedIndex];
        if (!item) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void runPisiExtendedUnifiedCommandItem(
            editor,
            pisiUnifiedCommandState.command,
            item
        );
        return;
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closePisiUnifiedCommandMenu();
        return;
    }

    if (event.key === ' ') {
        const command = window.getPisiEditorCommandAtCaret?.(editor);
        const exact = getExactPisiExtendedItem(command);
        if (!command || !exact) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void runPisiExtendedUnifiedCommandItem(editor, command, exact);
    }
}

function bindPisiExtendedUnifiedEditor(editor) {
    if (!editor || editor.dataset.pisiUnifiedFormattingBound === '1') return false;
    editor.dataset.pisiUnifiedFormattingBound = '1';
    editor.addEventListener('input', () => schedulePisiExtendedUnifiedMenu(editor));
    editor.addEventListener('click', () => {
        if (pisiUnifiedCommandState.active) schedulePisiExtendedUnifiedMenu(editor);
    });
    return true;
}

function initializePisiUnifiedCommandFormatting() {
    const bindAll = () => [
        document.getElementById('center-node-editor-content'),
        document.getElementById('node-modal-content')
    ].forEach(bindPisiExtendedUnifiedEditor);

    document.addEventListener('keydown', handlePisiExtendedUnifiedKeydown, true);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindAll, { once: true });
    } else {
        bindAll();
    }

    document.addEventListener('pisi:active-node-changed', bindAll);
}

const moduleApi = {
    PISI_WRITING_COMMANDS,
    applyPisiWritingCommand,
    buildPisiWritingCommandItems,
    initializePisiUnifiedCommandFormatting,
    renderPisiExtendedUnifiedMenu,
    runPisiExtendedUnifiedCommandItem
};

registerModule('editor.unifiedCommandFormatting', moduleApi);
initializePisiUnifiedCommandFormatting();

export {
    PISI_WRITING_COMMANDS,
    applyPisiWritingCommand,
    buildPisiWritingCommandItems,
    initializePisiUnifiedCommandFormatting,
    renderPisiExtendedUnifiedMenu,
    runPisiExtendedUnifiedCommandItem
};
