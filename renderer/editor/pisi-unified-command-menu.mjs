import { registerModule } from '../core/module-registry.mjs';
import { getPisiLatexCommandsPreference } from './pisi-editor-command-preferences.mjs';

const PISI_LATEX_CURSOR = '__PISI_CURSOR__';

const PISI_LATEX_COMMANDS = Object.freeze(
    [
        { id: 'math', category: 'LaTeX · Yapı', description: 'Satır içi matematik', template: `\\(${PISI_LATEX_CURSOR}\\)`, aliases: ['inline', 'equation'] },
        {
            id: 'displaymath',
            category: 'LaTeX · Yapı',
            description: 'Blok matematik',
            template: `\\[${PISI_LATEX_CURSOR}\\]`,
            aliases: ['display', 'equation']
        },
        { id: 'frac', category: 'LaTeX · Yapı', description: 'Kesir', template: `\\frac{${PISI_LATEX_CURSOR}}{}`, aliases: ['fraction', 'kesir'] },
        { id: 'sqrt', category: 'LaTeX · Yapı', description: 'Karekök', template: `\\sqrt{${PISI_LATEX_CURSOR}}`, aliases: ['root', 'kok'] },
        { id: 'nthroot', category: 'LaTeX · Yapı', description: 'n. dereceden kök', template: `\\sqrt[]{${PISI_LATEX_CURSOR}}`, aliases: ['root'] },
        { id: 'power', category: 'LaTeX · Yapı', description: 'Üs', template: `^{${PISI_LATEX_CURSOR}}`, aliases: ['superscript', 'us'] },
        {
            id: 'texsubscript',
            category: 'LaTeX · Yapı',
            description: 'Alt indis',
            template: `_{${PISI_LATEX_CURSOR}}`,
            aliases: ['subscript', 'index', 'indis']
        },
        { id: 'text', category: 'LaTeX · Yapı', description: 'Matematik içinde metin', template: `\\text{${PISI_LATEX_CURSOR}}`, aliases: [] },

        { id: 'sum', category: 'LaTeX · Operatör', description: 'Toplam', template: `\\sum_{${PISI_LATEX_CURSOR}}^{}`, aliases: ['sigma', 'toplam'] },
        { id: 'prod', category: 'LaTeX · Operatör', description: 'Çarpım', template: `\\prod_{${PISI_LATEX_CURSOR}}^{}`, aliases: ['product', 'carpim'] },
        { id: 'int', category: 'LaTeX · Operatör', description: 'İntegral', template: `\\int_{${PISI_LATEX_CURSOR}}^{}`, aliases: ['integral'] },
        { id: 'iint', category: 'LaTeX · Operatör', description: 'Çift integral', template: `\\iint_{${PISI_LATEX_CURSOR}}^{}`, aliases: ['integral'] },
        { id: 'oint', category: 'LaTeX · Operatör', description: 'Kapalı eğri integrali', template: `\\oint_{${PISI_LATEX_CURSOR}}^{}`, aliases: ['integral'] },
        { id: 'lim', category: 'LaTeX · Operatör', description: 'Limit', template: `\\lim_{${PISI_LATEX_CURSOR} \\to }`, aliases: ['limit'] },
        {
            id: 'partial',
            category: 'LaTeX · Operatör',
            description: 'Kısmi türev sembolü',
            template: `\\partial ${PISI_LATEX_CURSOR}`,
            aliases: ['derivative', 'turev']
        },
        { id: 'nabla', category: 'LaTeX · Operatör', description: 'Nabla / gradyan', template: `\\nabla ${PISI_LATEX_CURSOR}`, aliases: ['gradient'] },

        {
            id: 'matrix',
            category: 'LaTeX · Matris',
            description: 'Matris',
            template: `\\begin{matrix} ${PISI_LATEX_CURSOR} &  \\\\  &  \\end{matrix}`,
            aliases: []
        },
        {
            id: 'pmatrix',
            category: 'LaTeX · Matris',
            description: 'Parantezli matris',
            template: `\\begin{pmatrix} ${PISI_LATEX_CURSOR} &  \\\\  &  \\end{pmatrix}`,
            aliases: []
        },
        {
            id: 'bmatrix',
            category: 'LaTeX · Matris',
            description: 'Köşeli parantezli matris',
            template: `\\begin{bmatrix} ${PISI_LATEX_CURSOR} &  \\\\  &  \\end{bmatrix}`,
            aliases: []
        },
        {
            id: 'vmatrix',
            category: 'LaTeX · Matris',
            description: 'Determinant matrisi',
            template: `\\begin{vmatrix} ${PISI_LATEX_CURSOR} &  \\\\  &  \\end{vmatrix}`,
            aliases: ['determinant']
        },
        {
            id: 'cases',
            category: 'LaTeX · Matris',
            description: 'Parçalı fonksiyon / cases',
            template: `\\begin{cases} ${PISI_LATEX_CURSOR} & \\text{} \\\\  & \\text{} \\end{cases}`,
            aliases: ['piecewise']
        },
        {
            id: 'aligned',
            category: 'LaTeX · Matris',
            description: 'Hizalı denklemler',
            template: `\\begin{aligned} ${PISI_LATEX_CURSOR} &=  \\\\  &=  \\end{aligned}`,
            aliases: ['align']
        },

        { id: 'alpha', category: 'LaTeX · Yunan', description: 'α alpha', template: `\\alpha ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'beta', category: 'LaTeX · Yunan', description: 'β beta', template: `\\beta ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'gamma', category: 'LaTeX · Yunan', description: 'γ gamma', template: `\\gamma ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'delta', category: 'LaTeX · Yunan', description: 'δ delta', template: `\\delta ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'epsilon', category: 'LaTeX · Yunan', description: 'ε epsilon', template: `\\epsilon ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'theta', category: 'LaTeX · Yunan', description: 'θ theta', template: `\\theta ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'lambda', category: 'LaTeX · Yunan', description: 'λ lambda', template: `\\lambda ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'mu', category: 'LaTeX · Yunan', description: 'μ mu', template: `\\mu ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'pi', category: 'LaTeX · Yunan', description: 'π pi', template: `\\pi ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'rho', category: 'LaTeX · Yunan', description: 'ρ rho', template: `\\rho ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'sigma', category: 'LaTeX · Yunan', description: 'σ sigma', template: `\\sigma ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'phi', category: 'LaTeX · Yunan', description: 'φ phi', template: `\\phi ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'psi', category: 'LaTeX · Yunan', description: 'ψ psi', template: `\\psi ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'omega', category: 'LaTeX · Yunan', description: 'ω omega', template: `\\omega ${PISI_LATEX_CURSOR}`, aliases: [] },

        { id: 'infty', category: 'LaTeX · Sembol', description: '∞ sonsuzluk', template: `\\infty ${PISI_LATEX_CURSOR}`, aliases: ['infinity', 'sonsuz'] },
        { id: 'times', category: 'LaTeX · Sembol', description: '× çarpma', template: `\\times ${PISI_LATEX_CURSOR}`, aliases: ['multiply'] },
        { id: 'cdot', category: 'LaTeX · Sembol', description: '· nokta çarpımı', template: `\\cdot ${PISI_LATEX_CURSOR}`, aliases: ['dot'] },
        { id: 'pm', category: 'LaTeX · Sembol', description: '± artı/eksi', template: `\\pm ${PISI_LATEX_CURSOR}`, aliases: ['plusminus'] },
        { id: 'neq', category: 'LaTeX · İlişki', description: '≠ eşit değil', template: `\\neq ${PISI_LATEX_CURSOR}`, aliases: ['notequal'] },
        { id: 'leq', category: 'LaTeX · İlişki', description: '≤ küçük eşit', template: `\\leq ${PISI_LATEX_CURSOR}`, aliases: ['lte'] },
        { id: 'geq', category: 'LaTeX · İlişki', description: '≥ büyük eşit', template: `\\geq ${PISI_LATEX_CURSOR}`, aliases: ['gte'] },
        { id: 'approx', category: 'LaTeX · İlişki', description: '≈ yaklaşık', template: `\\approx ${PISI_LATEX_CURSOR}`, aliases: ['approximately'] },
        { id: 'equiv', category: 'LaTeX · İlişki', description: '≡ denk', template: `\\equiv ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'in', category: 'LaTeX · İlişki', description: '∈ elemanıdır', template: `\\in ${PISI_LATEX_CURSOR}`, aliases: ['member'] },
        { id: 'notin', category: 'LaTeX · İlişki', description: '∉ elemanı değildir', template: `\\notin ${PISI_LATEX_CURSOR}`, aliases: [] },
        { id: 'subseteq', category: 'LaTeX · İlişki', description: '⊆ alt küme', template: `\\subseteq ${PISI_LATEX_CURSOR}`, aliases: ['subset'] },
        { id: 'supseteq', category: 'LaTeX · İlişki', description: '⊇ üst küme', template: `\\supseteq ${PISI_LATEX_CURSOR}`, aliases: ['superset'] },

        { id: 'rightarrow', category: 'LaTeX · Ok', description: '→ sağ ok', template: `\\rightarrow ${PISI_LATEX_CURSOR}`, aliases: ['arrow', 'to'] },
        { id: 'leftarrow', category: 'LaTeX · Ok', description: '← sol ok', template: `\\leftarrow ${PISI_LATEX_CURSOR}`, aliases: ['arrow'] },
        { id: 'leftrightarrow', category: 'LaTeX · Ok', description: '↔ çift yönlü ok', template: `\\leftrightarrow ${PISI_LATEX_CURSOR}`, aliases: ['arrow'] },
        { id: 'Rightarrow', category: 'LaTeX · Ok', description: '⇒ çıkarım oku', template: `\\Rightarrow ${PISI_LATEX_CURSOR}`, aliases: ['implies'] },

        { id: 'vec', category: 'LaTeX · Vurgu', description: 'Vektör oku', template: `\\vec{${PISI_LATEX_CURSOR}}`, aliases: ['vector'] },
        { id: 'hat', category: 'LaTeX · Vurgu', description: 'Şapka', template: `\\hat{${PISI_LATEX_CURSOR}}`, aliases: [] },
        { id: 'bar', category: 'LaTeX · Vurgu', description: 'Üst çizgi', template: `\\bar{${PISI_LATEX_CURSOR}}`, aliases: [] },
        { id: 'overline', category: 'LaTeX · Vurgu', description: 'Uzun üst çizgi', template: `\\overline{${PISI_LATEX_CURSOR}}`, aliases: [] },
        {
            id: 'texunderline',
            category: 'LaTeX · Vurgu',
            description: 'LaTeX alt çizgi',
            template: `\\underline{${PISI_LATEX_CURSOR}}`,
            aliases: ['latex underline']
        }
    ].map((record) => Object.freeze(record))
);

const pisiUnifiedCommandState = {
    active: false,
    editor: null,
    command: null,
    items: [],
    selectedIndex: 0
};

function normalizePisiUnifiedSearch(value = '') {
    return String(value || '')
        .trim()
        .toLocaleLowerCase('tr-TR');
}

function matchesPisiUnifiedItem(item, query) {
    const clean = normalizePisiUnifiedSearch(query);
    if (!clean) return true;
    const haystack = [item.id, item.label, item.description, item.category, ...(Array.isArray(item.aliases) ? item.aliases : [])]
        .map(normalizePisiUnifiedSearch)
        .join(' ');
    return haystack.includes(clean);
}

function isPisiLatexCommandExecutionEnabled() {
    return getPisiLatexCommandsPreference() === true;
}

function makePisiUnifiedLatexItems(command) {
    if (!isPisiLatexCommandExecutionEnabled()) return [];
    return PISI_LATEX_COMMANDS.filter((record) => matchesPisiUnifiedItem(record, command?.body)).map((record) => ({
        ...record,
        kind: 'latex',
        label: record.id,
        typedToken: `${command.trigger}${record.id}`
    }));
}

function makePisiUnifiedBlockItems(command) {
    const records = Array.isArray(window.PISI_BLOCK_SLASH_COMMANDS) ? window.PISI_BLOCK_SLASH_COMMANDS : [];
    return records
        .map((record) => {
            const id = String(record.slash || record.id || '');
            const kind = record.action === 'todo' ? 'todo-start' : record.action === 'done' ? 'todo-done' : record.action === 'image' ? 'image' : 'block';
            return {
                kind,
                id,
                label: String(record.label || id),
                description:
                    kind === 'block'
                        ? 'Blok türünü değiştir'
                        : kind === 'image'
                          ? 'Görsel dosyası seç'
                          : kind === 'todo-start'
                            ? 'Görev oluştur'
                            : 'Görevi tamamla',
                category: kind.startsWith('todo-') ? 'Tasks' : 'Blocks',
                typedToken: `${command.trigger}${id}`,
                blockType: record.id,
                aliases: Array.isArray(record.aliases) ? [...record.aliases] : []
            };
        })
        .filter((item) => matchesPisiUnifiedItem(item, command?.body));
}

function buildPisiUnifiedCommandItems(command) {
    if (!command || !['/', '..'].includes(command.trigger)) return [];
    return [...makePisiUnifiedBlockItems(command), ...makePisiUnifiedLatexItems(command)];
}

function getPisiUnifiedMenu() {
    return document.getElementById('pisi-tag-menu');
}

function closePisiUnifiedCommandMenu() {
    const menu = getPisiUnifiedMenu();
    if (menu && pisiUnifiedCommandState.active) {
        menu.hidden = true;
        menu.replaceChildren();
        menu.classList.remove('pisi-unified-command-menu');
    }
    pisiUnifiedCommandState.active = false;
    pisiUnifiedCommandState.editor = null;
    pisiUnifiedCommandState.command = null;
    pisiUnifiedCommandState.items = [];
    pisiUnifiedCommandState.selectedIndex = 0;
}

function makePisiCommandRange(command) {
    if (!command?.block || typeof window.makeRangeInElementByTextOffsets !== 'function') {
        return null;
    }
    return window.makeRangeInElementByTextOffsets(command.block, command.tokenStartInText, command.tokenEndInText);
}

function insertPisiLatexTemplate(editor, command, template) {
    if (!isPisiLatexCommandExecutionEnabled()) {
        closePisiUnifiedCommandMenu();
        return false;
    }

    const range = makePisiCommandRange(command);
    if (!range) return false;

    const raw = String(template || '');
    const cursorIndex = raw.indexOf(PISI_LATEX_CURSOR);
    const text = raw.replace(PISI_LATEX_CURSOR, '');

    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);

    const selection = window.getSelection?.();
    if (selection) {
        const caret = document.createRange();
        const offset = cursorIndex >= 0 ? Math.min(cursorIndex, textNode.nodeValue?.length || 0) : textNode.nodeValue?.length || 0;
        caret.setStart(textNode, offset);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);
    }

    closePisiUnifiedCommandMenu();
    editor.focus({ preventScroll: true });
    const input =
        typeof InputEvent === 'function'
            ? new InputEvent('input', {
                  bubbles: true,
                  inputType: 'insertText',
                  data: text
              })
            : new Event('input', { bubbles: true });
    editor.dispatchEvent(input);
    return true;
}

function applyPisiUnifiedBlock(editor, command, item) {
    const range = makePisiCommandRange(command);
    if (!range) return false;
    range.deleteContents();
    if (command.block && !command.block.textContent && !command.block.querySelector?.('br')) {
        command.block.innerHTML = item.blockType === 'task' ? '' : '<br>';
    }
    const next = window.applyPisiBlockType?.(command.block, item.blockType);
    closePisiUnifiedCommandMenu();
    if (next) {
        editor?.focus?.({ preventScroll: true });
        const isEmpty = !next.textContent?.trim() && !next.querySelector?.('*:not(br)');
        if (isEmpty && typeof window.placeCaretAtStartOfPisiBlock === 'function') {
            window.placeCaretAtStartOfPisiBlock(window.getSelection?.(), next);
        } else {
            window.placeCaretAtEnd?.(next);
        }
    }
    return Boolean(next);
}

async function runPisiUnifiedCommandItem(editor, command, item) {
    if (!editor || !command || !item) return false;

    if (item.kind === 'latex') {
        if (!isPisiLatexCommandExecutionEnabled()) {
            closePisiUnifiedCommandMenu();
            return false;
        }
        return insertPisiLatexTemplate(editor, command, item.template);
    }

    if (item.kind === 'todo-start') {
        closePisiUnifiedCommandMenu();
        window.openPisiTodoPriorityMenu?.(editor, command);
        return true;
    }

    if (item.kind === 'todo-done') {
        closePisiUnifiedCommandMenu();
        return Boolean(window.applyPisiDoneCommandToEditor?.(editor, command));
    }

    if (item.kind === 'block') {
        return applyPisiUnifiedBlock(editor, command, item);
    }

    if (item.kind === 'image') {
        makePisiCommandRange(command)?.deleteContents();
        closePisiUnifiedCommandMenu();
        document.dispatchEvent(new CustomEvent('pisi:image-insert-request', { detail: { editor } }));
        return true;
    }

    return false;
}

const moduleApi = {
    PISI_LATEX_COMMANDS,
    buildPisiUnifiedCommandItems,
    closePisiUnifiedCommandMenu,
    insertPisiLatexTemplate,
    isPisiLatexCommandExecutionEnabled,
    makePisiUnifiedBlockItems,
    makePisiUnifiedLatexItems,
    pisiUnifiedCommandState,
    runPisiUnifiedCommandItem
};

registerModule('editor.unifiedCommandMenu', moduleApi);

export {
    PISI_LATEX_COMMANDS,
    buildPisiUnifiedCommandItems,
    closePisiUnifiedCommandMenu,
    insertPisiLatexTemplate,
    isPisiLatexCommandExecutionEnabled,
    makePisiUnifiedBlockItems,
    makePisiUnifiedLatexItems,
    pisiUnifiedCommandState,
    runPisiUnifiedCommandItem
};
