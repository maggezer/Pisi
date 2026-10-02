import { registerModule } from '../core/module-registry.mjs';
import { closePisiUnifiedCommandMenu, runPisiUnifiedCommandItem } from './pisi-unified-command-menu.mjs';

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

const PISI_WRITING_CATEGORY_ORDER = Object.freeze({
    'Formatting · Text': 10,
    'Formatting · Lists': 11,
    'Formatting · Paragraph': 12,
    Tasks: 20,
    Blocks: 30,
    'LaTeX · Yapı': 40,
    'LaTeX · Operatör': 41,
    'LaTeX · Matris': 42,
    'LaTeX · Yunan': 43,
    'LaTeX · Sembol': 44,
    'LaTeX · İlişki': 45,
    'LaTeX · Ok': 46,
    'LaTeX · Vurgu': 47
});

function normalizePisiWritingSearch(value = '') {
    return String(value || '')
        .trim()
        .toLocaleLowerCase('tr-TR');
}

function matchesPisiWritingCommand(item, query) {
    const clean = normalizePisiWritingSearch(query);
    if (!clean) return true;
    const haystack = [item.id, item.label, item.description, item.category, ...(Array.isArray(item.aliases) ? item.aliases : [])]
        .map(normalizePisiWritingSearch)
        .join(' ');
    return haystack.includes(clean);
}

function buildPisiWritingCommandItems(command) {
    if (!command || !['/', '..'].includes(command.trigger)) return [];
    return PISI_WRITING_COMMANDS.filter((record) => matchesPisiWritingCommand(record, command.body)).map((record) => ({
        ...record,
        kind: 'format',
        typedToken: `${command.trigger}${record.id}`
    }));
}

function comparePisiExtendedUnifiedItems(a, b) {
    const category = (PISI_WRITING_CATEGORY_ORDER[a.category] || 99) - (PISI_WRITING_CATEGORY_ORDER[b.category] || 99);
    if (category) return category;
    return String(a.id || a.label || '').localeCompare(String(b.id || b.label || ''), 'tr');
}

function makePisiWritingRange(command) {
    if (!command?.block || typeof window.makeRangeInElementByTextOffsets !== 'function') {
        return null;
    }
    const range = window.makeRangeInElementByTextOffsets(command.block, command.tokenStartInText, command.tokenEndInText);
    if (!range) return null;
    range.deleteContents();
    range.collapse(true);
    return range;
}

function applyPisiNativeWritingCommand(editor, command, item) {
    const range = makePisiWritingRange(command);
    if (!range) return false;

    closePisiUnifiedCommandMenu();
    editor.focus({ preventScroll: true });
    const selection = window.getSelection?.();
    if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
    }

    const changed = document.execCommand(item.execCommand, false, item.value ?? null);
    const input = typeof InputEvent === 'function' ? new InputEvent('input', { bubbles: true, inputType: 'formatSet' }) : new Event('input', { bubbles: true });
    editor.dispatchEvent(input);
    return changed !== false;
}

function applyPisiWritingCommand(editor, command, item) {
    if (!editor || !command || !item) return false;

    if (
        typeof window.isPisiInlineTextCommand === 'function' &&
        window.isPisiInlineTextCommand(item.execCommand) &&
        typeof window.runPisiAuthoritativeMenuInlineCommand === 'function'
    ) {
        return window.runPisiAuthoritativeMenuInlineCommand(editor, command, item);
    }

    return applyPisiNativeWritingCommand(editor, command, item);
}

async function runPisiExtendedUnifiedCommandItem(editor, command, item) {
    if (item?.kind === 'format') {
        return applyPisiWritingCommand(editor, command, item);
    }
    return runPisiUnifiedCommandItem(editor, command, item);
}

const moduleApi = {
    PISI_WRITING_COMMANDS,
    PISI_WRITING_CATEGORY_ORDER,
    applyPisiNativeWritingCommand,
    applyPisiWritingCommand,
    buildPisiWritingCommandItems,
    comparePisiExtendedUnifiedItems,
    runPisiExtendedUnifiedCommandItem
};

registerModule('editor.unifiedCommandFormatting', moduleApi);

export {
    PISI_WRITING_COMMANDS,
    PISI_WRITING_CATEGORY_ORDER,
    applyPisiNativeWritingCommand,
    applyPisiWritingCommand,
    buildPisiWritingCommandItems,
    comparePisiExtendedUnifiedItems,
    runPisiExtendedUnifiedCommandItem
};
