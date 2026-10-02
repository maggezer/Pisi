import { registerModule } from '../core/module-registry.mjs';
import { PISI_FORMULA_CATALOG } from './pisi-editor-sheet-formula-core.mjs';

const PISI_TOOLBAR_FORMULA_GROUPS = PISI_FORMULA_CATALOG;

const PISI_PERSONAL_FORMULAS_KEY = 'pisi.personalFormulas.v1';

function getPisiPersonalFormulas() {
    try {
        const parsed = JSON.parse(localStorage.getItem(PISI_PERSONAL_FORMULAS_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((item) => item?.name && item?.formula) : [];
    } catch {
        return [];
    }
}

function savePisiPersonalFormula(name, formula) {
    const safeName = String(name || '').trim();
    const safeFormula = String(formula || '').trim();
    if (!safeName || !safeFormula.startsWith('=')) return false;
    const formulas = getPisiPersonalFormulas();
    const existing = formulas.find((item) => item.name === safeName);
    if (existing) existing.formula = safeFormula;
    else formulas.push({ name: safeName, formula: safeFormula });
    localStorage.setItem(PISI_PERSONAL_FORMULAS_KEY, JSON.stringify(formulas.slice(-30)));
    return true;
}

function applyPisiToolbarFormula(toolbar, formula) {
    const editor = getPisiToolbarEditor(toolbar);
    if (!editor) return false;
    const table = getActivePisiSheetForEditor(editor);
    if (!table) {
        setPisiSheetToolbarStatus(toolbar, 'Önce bir tablo hücresi seç.');
        return false;
    }
    applyPisiSheetFormula(table, formula);
    schedulePisiSheetEditorNotification(table);
    syncPisiSheetToolbarState(toolbar, table);
    return true;
}

function openPisiToolbarFormulaPopover(toolbar, anchor, groupName) {
    const popover = createPisiToolbarPopover(anchor, 'pisi-office-formula-popover');
    const titles = {
        logical: 'Logical formulas',
        text: 'Text formulas',
        math: 'Math formulas',
        financial: 'Financial formulas',
        personal: 'Personal formulas'
    };
    popover.innerHTML = `
        <div class="pisi-office-popover-title">${titles[groupName] || 'Formulas'}</div>
        <div class="pisi-office-formula-list"></div>
    `;
    const list = popover.querySelector('.pisi-office-formula-list');
    const formulas = groupName === 'personal' ? getPisiPersonalFormulas() : PISI_TOOLBAR_FORMULA_GROUPS[groupName] || [];

    formulas.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-office-formula-item';
        button.innerHTML = `
            <strong>${item.label || item.name}</strong>
            <span>${item.formula}</span>
        `;
        button.addEventListener('click', () => {
            applyPisiToolbarFormula(toolbar, item.formula);
            closePisiToolbarPopover();
        });
        list.appendChild(button);
    });

    if (groupName === 'personal') {
        if (!formulas.length) {
            const empty = document.createElement('div');
            empty.className = 'pisi-office-formula-empty';
            empty.textContent = 'Henüz kişisel formül yok.';
            list.appendChild(empty);
        }
        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'pisi-office-formula-save';
        saveButton.textContent = 'Seçili hücrenin formülünü kaydet';
        saveButton.addEventListener('click', () => {
            const formula = window.__pisiActiveSheetCell?.dataset?.formula || '';
            if (!formula) {
                setPisiSheetToolbarStatus(toolbar, 'Seçili hücrede kaydedilecek formül yok.');
                closePisiToolbarPopover();
                return;
            }
            const name = window.prompt('Formül adı:', 'My Formula');
            if (savePisiPersonalFormula(name, formula)) {
                setPisiSheetToolbarStatus(toolbar, 'Kişisel formül kaydedildi.');
            }
            closePisiToolbarPopover();
        });
        popover.appendChild(saveButton);
    }
}

function openPisiToolbarSizePopover(toolbar, anchor, tool) {
    const popover = createPisiToolbarPopover(anchor, 'pisi-office-size-popover');
    const state = getPisiPaintState();
    const value = Math.max(1, Math.min(80, Number(state.size) || 4));
    popover.innerHTML = `
        <div class="pisi-office-popover-title">${tool} boyutu</div>
        <label class="pisi-office-size-control">
            <input type="range" min="1" max="80" step="1" value="${value}">
            <output>${value} px</output>
        </label>
    `;
    const input = popover.querySelector('input');
    const output = popover.querySelector('output');
    input.addEventListener('input', () => {
        state.size = Number(input.value);
        output.textContent = `${input.value} px`;
        const hiddenSize = toolbar.querySelector('[data-pisi-paint-size]');
        if (hiddenSize) hiddenSize.value = input.value;
    });
}

function openPisiToolbarShapePopover(toolbar, anchor) {
    const popover = createPisiToolbarPopover(anchor, 'pisi-office-shape-popover');
    const shapes = [
        { tool: 'line', label: 'Çizgi', glyph: '╱' },
        { tool: 'rect', label: 'Dikdörtgen', glyph: '▭' },
        { tool: 'ellipse', label: 'Elips', glyph: '◯' }
    ];
    popover.innerHTML = '<div class="pisi-office-popover-title">Shape</div><div class="pisi-office-shape-grid"></div>';
    const grid = popover.querySelector('.pisi-office-shape-grid');
    shapes.forEach((shape) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-office-shape-item';
        button.innerHTML = `<span>${shape.glyph}</span>${shape.label}`;
        button.addEventListener('click', () => {
            setPisiPaintTool(toolbar, shape.tool);
            const trigger = toolbar.querySelector('[data-pisi-shape-trigger]');
            if (trigger) {
                trigger.dataset.pisiPaintTool = shape.tool;
                trigger.title = `Shape: ${shape.label}`;
            }
            closePisiToolbarPopover();
        });
        grid.appendChild(button);
    });
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    PISI_TOOLBAR_FORMULA_GROUPS: {
        enumerable: true,
        get() {
            return PISI_TOOLBAR_FORMULA_GROUPS;
        }
    },
    getPisiPersonalFormulas: {
        enumerable: true,
        get() {
            return getPisiPersonalFormulas;
        }
    },
    savePisiPersonalFormula: {
        enumerable: true,
        get() {
            return savePisiPersonalFormula;
        }
    },
    applyPisiToolbarFormula: {
        enumerable: true,
        get() {
            return applyPisiToolbarFormula;
        }
    },
    openPisiToolbarFormulaPopover: {
        enumerable: true,
        get() {
            return openPisiToolbarFormulaPopover;
        }
    },
    openPisiToolbarSizePopover: {
        enumerable: true,
        get() {
            return openPisiToolbarSizePopover;
        }
    },
    openPisiToolbarShapePopover: {
        enumerable: true,
        get() {
            return openPisiToolbarShapePopover;
        }
    }
});
registerModule('editor.toolbarMenus', moduleApi);
