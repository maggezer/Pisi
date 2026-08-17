import { registerModule } from '../core/module-registry.mjs';

const PISI_LATEX_CURSOR = '__PISI_CURSOR__';

const PISI_LATEX_COMMANDS = Object.freeze([
    { id: 'math', category: 'LaTeX · Yapı', description: 'Satır içi matematik', template: `\\(${PISI_LATEX_CURSOR}\\)`, aliases: ['inline', 'equation'] },
    { id: 'displaymath', category: 'LaTeX · Yapı', description: 'Blok matematik', template: `\\[${PISI_LATEX_CURSOR}\\]`, aliases: ['display', 'equation'] },
    { id: 'frac', category: 'LaTeX · Yapı', description: 'Kesir', template: `\\frac{${PISI_LATEX_CURSOR}}{}`, aliases: ['fraction', 'kesir'] },
    { id: 'sqrt', category: 'LaTeX · Yapı', description: 'Karekök', template: `\\sqrt{${PISI_LATEX_CURSOR}}`, aliases: ['root', 'kok'] },
    { id: 'nthroot', category: 'LaTeX · Yapı', description: 'n. dereceden kök', template: `\\sqrt[]{${PISI_LATEX_CURSOR}}`, aliases: ['root'] },
    { id: 'power', category: 'LaTeX · Yapı', description: 'Üs', template: `^{${PISI_LATEX_CURSOR}}`, aliases: ['superscript', 'us'] },
    { id: 'subscript', category: 'LaTeX · Yapı', description: 'Alt indis', template: `_{${PISI_LATEX_CURSOR}}`, aliases: ['index', 'indis'] },
    { id: 'text', category: 'LaTeX · Yapı', description: 'Matematik içinde metin', template: `\\text{${PISI_LATEX_CURSOR}}`, aliases: [] },

    { id: 'sum', category: 'LaTeX · Operatör', description: 'Toplam', template: `\\sum_{${PISI_LATEX_CURSOR}}^{}`, aliases: ['sigma', 'toplam'] },
    { id: 'prod', category: 'LaTeX · Operatör', description: 'Çarpım', template: `\\prod_{${PISI_LATEX_CURSOR}}^{}`, aliases: ['product', 'carpim'] },
    { id: 'int', category: 'LaTeX · Operatör', description: 'İntegral', template: `\\int_{${PISI_LATEX_CURSOR}}^{}`, aliases: ['integral'] },
    { id: 'iint', category: 'LaTeX · Operatör', description: 'Çift integral', template: `\\iint_{${PISI_LATEX_CURSOR}}^{}`, aliases: ['integral'] },
    { id: 'oint', category: 'LaTeX · Operatör', description: 'Kapalı eğri integrali', template: `\\oint_{${PISI_LATEX_CURSOR}}^{}`, aliases: ['integral'] },
    { id: 'lim', category: 'LaTeX · Operatör', description: 'Limit', template: `\\lim_{${PISI_LATEX_CURSOR} \\to }`, aliases: ['limit'] },
    { id: 'partial', category: 'LaTeX · Operatör', description: 'Kısmi türev sembolü', template: `\\partial ${PISI_LATEX_CURSOR}`, aliases: ['derivative', 'turev'] },
    { id: 'nabla', category: 'LaTeX · Operatör', description: 'Nabla / gradyan', template: `\\nabla ${PISI_LATEX_CURSOR}`, aliases: ['gradient'] },

    { id: 'matrix', category: 'LaTeX · Matris', description: 'Matris', template: `\\begin{matrix} ${PISI_LATEX_CURSOR} &  \\\\  &  \\end{matrix}`, aliases: [] },
    { id: 'pmatrix', category: 'LaTeX · Matris', description: 'Parantezli matris', template: `\\begin{pmatrix} ${PISI_LATEX_CURSOR} &  \\\\  &  \\end{pmatrix}`, aliases: [] },
    { id: 'bmatrix', category: 'LaTeX · Matris', description: 'Köşeli parantezli matris', template: `\\begin{bmatrix} ${PISI_LATEX_CURSOR} &  \\\\  &  \\end{bmatrix}`, aliases: [] },
    { id: 'vmatrix', category: 'LaTeX · Matris', description: 'Determinant matrisi', template: `\\begin{vmatrix} ${PISI_LATEX_CURSOR} &  \\\\  &  \\end{vmatrix}`, aliases: ['determinant'] },
    { id: 'cases', category: 'LaTeX · Matris', description: 'Parçalı fonksiyon / cases', template: `\\begin{cases} ${PISI_LATEX_CURSOR} & \\text{} \\\\  & \\text{} \\end{cases}`, aliases: ['piecewise'] },
    { id: 'aligned', category: 'LaTeX · Matris', description: 'Hizalı denklemler', template: `\\begin{aligned} ${PISI_LATEX_CURSOR} &=  \\\\  &=  \\end{aligned}`, aliases: ['align'] },

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
    { id: 'underline', category: 'LaTeX · Vurgu', description: 'Alt çizgi', template: `\\underline{${PISI_LATEX_CURSOR}}`, aliases: [] }
].map((record) => Object.freeze(record)));

const pisiUnifiedCommandState = {
    active: false,
    editor: null,
    command: null,
    items: [],
    selectedIndex: 0,
    updateToken: 0
};

function normalizePisiUnifiedSearch(value = '') {
    return String(value || '').trim().toLocaleLowerCase('tr-TR');
}

function matchesPisiUnifiedItem(item, query) {
    const clean = normalizePisiUnifiedSearch(query);
    if (!clean) return true;
    const haystack = [
        item.id,
        item.label,
        item.description,
        item.category,
        ...(Array.isArray(item.aliases) ? item.aliases : [])
    ].map(normalizePisiUnifiedSearch).join(' ');
    return haystack.includes(clean);
}

function makePisiUnifiedLatexItems(command) {
    return PISI_LATEX_COMMANDS
        .filter((record) => matchesPisiUnifiedItem(record, command.body))
        .map((record) => ({
            ...record,
            kind: 'latex',
            label: record.id,
            typedToken: `${command.trigger}${record.id}`
        }));
}

function makePisiUnifiedBlockItems(command) {
    const records = Array.isArray(window.PISI_BLOCK_SLASH_COMMANDS)
        ? window.PISI_BLOCK_SLASH_COMMANDS
        : [];
    return records
        .map((record) => {
            const id = String(record.slash || record.id || '');
            const kind = record.action === 'todo'
                ? 'todo-start'
                : record.action === 'done'
                    ? 'todo-done'
                    : 'block';
            return {
                kind,
                id,
                label: String(record.label || id),
                description: kind === 'block' ? 'Blok türünü değiştir' : kind === 'todo-start' ? 'Görev oluştur' : 'Görevi tamamla',
                category: kind.startsWith('todo-') ? 'Tasks' : 'Blocks',
                typedToken: `${command.trigger}${id}`,
                blockType: record.id,
                aliases: []
            };
        })
        .filter((item) => matchesPisiUnifiedItem(item, command.body));
}

function makePisiUnifiedSystemTagItems(command) {
    const records = Array.isArray(window.PISI_SYSTEM_TAGS) ? window.PISI_SYSTEM_TAGS : [];
    return records
        .map((record) => ({
            kind: 'system',
            id: record.id,
            label: record.label,
            description: record.description || 'Başlık etiketi',
            category: 'Tags · System',
            typedToken: `${command.trigger}${record.label}`,
            headingLevel: record.headingLevel,
            aliases: []
        }))
        .filter((item) => matchesPisiUnifiedItem(item, command.body));
}

function makePisiUnifiedUserTagItems(command, staticItems) {
    const tags = typeof window.collectPisiUserTagSuggestions === 'function'
        ? window.collectPisiUserTagSuggestions(command.editor)
        : [];
    const cleanBody = normalizePisiUnifiedSearch(command.body);
    const items = (Array.isArray(tags) ? tags : [])
        .filter((tag) => !/^(?:todo(?:\.|$)|done$)/i.test(tag))
        .map((tag) => ({
            kind: 'user',
            id: tag,
            label: tag,
            description: 'Kullanıcı etiketi',
            category: 'Tags · User',
            typedToken: `${command.trigger}${tag}`,
            aliases: []
        }))
        .filter((item) => matchesPisiUnifiedItem(item, command.body));

    const validNewTag = cleanBody &&
        typeof window.isValidPisiUserTag === 'function' &&
        window.isValidPisiUserTag(command.body);
    const exactStatic = staticItems.some((item) => normalizePisiUnifiedSearch(item.id) === cleanBody);
    const exactUser = items.some((item) => normalizePisiUnifiedSearch(item.id) === cleanBody);
    if (validNewTag && !exactStatic && !exactUser) {
        items.push({
            kind: 'new-user',
            id: command.body,
            label: command.body,
            description: 'Yeni kullanıcı etiketi',
            category: 'Tags · User',
            typedToken: `${command.trigger}${command.body}`,
            aliases: []
        });
    }
    return items;
}

function buildPisiUnifiedCommandItems(command) {
    if (!command) return [];
    const latex = makePisiUnifiedLatexItems(command);
    const blocks = makePisiUnifiedBlockItems(command);
    const system = makePisiUnifiedSystemTagItems(command);
    const staticItems = [...latex, ...blocks, ...system];
    const users = makePisiUnifiedUserTagItems(command, staticItems);
    const categoryOrder = new Map([
        ['LaTeX · Yapı', 10],
        ['LaTeX · Operatör', 11],
        ['LaTeX · Matris', 12],
        ['LaTeX · Yunan', 13],
        ['LaTeX · Sembol', 14],
        ['LaTeX · İlişki', 15],
        ['LaTeX · Ok', 16],
        ['LaTeX · Vurgu', 17],
        ['Tasks', 20],
        ['Blocks', 30],
        ['Tags · System', 40],
        ['Tags · User', 50]
    ]);
    return [...staticItems, ...users]
        .sort((a, b) => {
            const order = (categoryOrder.get(a.category) || 99) - (categoryOrder.get(b.category) || 99);
            if (order) return order;
            return String(a.id).localeCompare(String(b.id), 'tr');
        })
        .slice(0, 90);
}

function getPisiUnifiedMenu() {
    return document.getElementById('pisi-tag-menu');
}

function hideLegacyPisiBlockSlashMenu() {
    const menu = document.querySelector('.pisi-block-slash-menu');
    if (menu) menu.hidden = true;
}

function closePisiUnifiedCommandMenu(options = {}) {
    pisiUnifiedCommandState.active = false;
    pisiUnifiedCommandState.editor = null;
    pisiUnifiedCommandState.command = null;
    pisiUnifiedCommandState.items = [];
    pisiUnifiedCommandState.selectedIndex = 0;
    const menu = getPisiUnifiedMenu();
    menu?.classList.remove('pisi-unified-command-menu');
    if (options.keepSharedMenu !== true) {
        if (typeof window.closePisiTagMenu === 'function') window.closePisiTagMenu();
        else if (menu) {
            menu.hidden = true;
            menu.replaceChildren();
        }
    }
}

function renderPisiUnifiedCommandMenu(editor, command) {
    const menu = getPisiUnifiedMenu();
    if (!menu || !command) return false;
    hideLegacyPisiBlockSlashMenu();
    if (typeof window.closePisiTagMenu === 'function') window.closePisiTagMenu();

    const items = buildPisiUnifiedCommandItems(command);
    if (!items.length) {
        closePisiUnifiedCommandMenu();
        return false;
    }

    pisiUnifiedCommandState.active = true;
    pisiUnifiedCommandState.editor = editor;
    pisiUnifiedCommandState.command = command;
    pisiUnifiedCommandState.items = items;
    pisiUnifiedCommandState.selectedIndex = Math.min(
        pisiUnifiedCommandState.selectedIndex,
        Math.max(0, items.length - 1)
    );

    menu.classList.add('pisi-unified-command-menu');
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
            void runPisiUnifiedCommandItem(editor, command, item);
        });
        fragment.appendChild(option);
    });

    menu.replaceChildren(fragment);
    menu.hidden = false;
    window.positionPisiTagMenuAtSelection?.();
    return true;
}

function schedulePisiUnifiedCommandMenuUpdate(editor) {
    const token = ++pisiUnifiedCommandState.updateToken;
    queueMicrotask(() => {
        if (token !== pisiUnifiedCommandState.updateToken) return;
        const command = window.getPisiEditorCommandAtCaret?.(editor);
        if (!command) {
            if (pisiUnifiedCommandState.editor === editor) closePisiUnifiedCommandMenu();
            return;
        }
        const previousBody = pisiUnifiedCommandState.command?.body;
        if (previousBody !== command.body || pisiUnifiedCommandState.editor !== editor) {
            pisiUnifiedCommandState.selectedIndex = 0;
        }
        renderPisiUnifiedCommandMenu(editor, command);
    });
}

function removePisiUnifiedToken(command) {
    if (!command?.block || typeof window.makeRangeInElementByTextOffsets !== 'function') return null;
    const range = window.makeRangeInElementByTextOffsets(
        command.block,
        command.tokenStartInText,
        command.tokenEndInText
    );
    if (!range) return null;
    range.deleteContents();
    return range;
}

function insertPisiLatexTemplate(editor, command, template) {
    const range = removePisiUnifiedToken(command);
    if (!range) return false;
    const raw = String(template || '');
    const cursorIndex = raw.indexOf(PISI_LATEX_CURSOR);
    const text = raw.replace(PISI_LATEX_CURSOR, '');
    const node = document.createTextNode(text);
    range.insertNode(node);

    const selection = window.getSelection?.();
    if (selection) {
        const next = document.createRange();
        const offset = cursorIndex >= 0 ? Math.min(cursorIndex, node.nodeValue.length) : node.nodeValue.length;
        next.setStart(node, offset);
        next.collapse(true);
        selection.removeAllRanges();
        selection.addRange(next);
    }
    closePisiUnifiedCommandMenu();
    editor.focus({ preventScroll: true });
    editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text
    }));
    return true;
}

function applyPisiUnifiedBlock(editor, command, item) {
    const range = removePisiUnifiedToken(command);
    if (!range) return false;
    const next = window.applyPisiBlockType?.(command.block, item.blockType);
    closePisiUnifiedCommandMenu();
    if (next) {
        if (!next.textContent && !next.querySelector('br')) next.innerHTML = '<br>';
        window.placeCaretAtEnd?.(next);
        next.focus?.();
    }
    editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'formatBlock'
    }));
    return Boolean(next);
}

async function runPisiUnifiedCommandItem(editor, command, item) {
    if (!editor || !command || !item) return false;
    if (item.kind === 'latex') {
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
    if (item.kind === 'system') {
        closePisiUnifiedCommandMenu();
        window.applyPisiSystemTagToEditor?.(editor, item, command);
        return true;
    }
    if (item.kind === 'user' || item.kind === 'new-user') {
        closePisiUnifiedCommandMenu();
        window.applyPisiUserTagToEditor?.(editor, item.label, command);
        return true;
    }
    return false;
}

function movePisiUnifiedSelection(delta) {
    const count = pisiUnifiedCommandState.items.length;
    if (!pisiUnifiedCommandState.active || !count) return;
    pisiUnifiedCommandState.selectedIndex = (
        pisiUnifiedCommandState.selectedIndex + delta + count
    ) % count;
    getPisiUnifiedMenu()?.querySelectorAll('.pisi-unified-command-option').forEach((option) => {
        option.classList.toggle(
            'active',
            Number(option.dataset.pisiUnifiedIndex) === pisiUnifiedCommandState.selectedIndex
        );
    });
    getPisiUnifiedMenu()?.querySelector(
        `.pisi-unified-command-option[data-pisi-unified-index="${pisiUnifiedCommandState.selectedIndex}"]`
    )?.scrollIntoView?.({ block: 'nearest' });
}

function findExactPisiUnifiedItem(command) {
    const body = normalizePisiUnifiedSearch(command?.body);
    if (!body) return null;
    return pisiUnifiedCommandState.items.find((item) => {
        return normalizePisiUnifiedSearch(item.id) === body;
    }) || null;
}

function handlePisiUnifiedKeydown(editor, event) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === '/') {
        // The old block slash listener prevents '/' from being typed on an empty block.
        // Capture the key first, keep the browser's default text insertion, and let the
        // shared command parser open the unified menu from the subsequent input event.
        event.stopImmediatePropagation();
        return;
    }

    if (!pisiUnifiedCommandState.active || pisiUnifiedCommandState.editor !== editor) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        movePisiUnifiedSelection(event.key === 'ArrowDown' ? 1 : -1);
        return;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
        const item = pisiUnifiedCommandState.items[pisiUnifiedCommandState.selectedIndex];
        if (!item) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void runPisiUnifiedCommandItem(
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
        const exact = findExactPisiUnifiedItem(command);
        if (!command || !exact) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void runPisiUnifiedCommandItem(editor, command, exact);
    }
}

function bindPisiUnifiedEditor(editor) {
    if (!editor || editor.dataset.pisiUnifiedCommandBound === '1') return false;
    editor.dataset.pisiUnifiedCommandBound = '1';
    editor.addEventListener('keydown', (event) => handlePisiUnifiedKeydown(editor, event), true);
    editor.addEventListener('input', () => schedulePisiUnifiedCommandMenuUpdate(editor));
    editor.addEventListener('click', () => {
        if (pisiUnifiedCommandState.active) schedulePisiUnifiedCommandMenuUpdate(editor);
    });
    return true;
}

function initializePisiUnifiedEditorCommandMenu() {
    const bindAll = () => [
        document.getElementById('center-node-editor-content'),
        document.getElementById('node-modal-content')
    ].forEach(bindPisiUnifiedEditor);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindAll, { once: true });
    } else {
        bindAll();
    }
    document.addEventListener('pisi:active-node-changed', bindAll);
    document.addEventListener('mousedown', (event) => {
        if (!pisiUnifiedCommandState.active) return;
        if (event.target?.closest?.('#pisi-tag-menu')) return;
        if (pisiUnifiedCommandState.editor?.contains?.(event.target)) return;
        closePisiUnifiedCommandMenu();
    });
}

const moduleApi = {
    PISI_LATEX_COMMANDS,
    pisiUnifiedCommandState,
    buildPisiUnifiedCommandItems,
    closePisiUnifiedCommandMenu,
    initializePisiUnifiedEditorCommandMenu,
    insertPisiLatexTemplate,
    renderPisiUnifiedCommandMenu,
    runPisiUnifiedCommandItem
};

registerModule('editor.unifiedCommandMenu', moduleApi);
initializePisiUnifiedEditorCommandMenu();

export {
    PISI_LATEX_COMMANDS,
    buildPisiUnifiedCommandItems,
    closePisiUnifiedCommandMenu,
    initializePisiUnifiedEditorCommandMenu,
    insertPisiLatexTemplate,
    pisiUnifiedCommandState,
    renderPisiUnifiedCommandMenu,
    runPisiUnifiedCommandItem
};
