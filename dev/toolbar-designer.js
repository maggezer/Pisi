'use strict';

const STORAGE_KEY = 'pisi-toolbar-designer-v1';

const controls = [
    {
        id: 'font-family',
        label: 'Yazı tipi',
        html: '<select class="pisi-word-select" data-pisi-toolbar-command="fontName"><option>Segoe UI</option><option>Arial</option><option>Times New Roman</option><option>Georgia</option><option>Consolas</option></select>'
    },
    {
        id: 'paragraph-style',
        label: 'Paragraf biçimi',
        html: '<select class="pisi-word-select" data-pisi-toolbar-command="formatBlock"><option value="div">Normal</option><option value="h2">Başlık 1</option><option value="h3">Başlık 2</option><option value="h4">Başlık 3</option><option value="h5">Alt başlık</option></select>'
    },
    {
        id: 'font-size',
        label: 'Yazı boyutu',
        html: '<select class="pisi-word-select pisi-word-size-select" data-pisi-toolbar-command="fontSize"><option value="2">Küçük</option><option value="3" selected>Normal</option><option value="4">Büyük</option><option value="5">Çok büyük</option><option value="6">Dev</option></select>'
    },
    {
        id: 'separator-1',
        label: 'Ayraç 1',
        html: '<span class="pisi-word-separator"></span>'
    },
    {
        id: 'bold',
        label: 'Kalın',
        html: '<button type="button" class="pisi-word-btn"><b>B</b></button>'
    },
    {
        id: 'italic',
        label: 'İtalik',
        html: '<button type="button" class="pisi-word-btn"><i>I</i></button>'
    },
    {
        id: 'underline',
        label: 'Altı çizili',
        html: '<button type="button" class="pisi-word-btn"><u>U</u></button>'
    },
    {
        id: 'text-color',
        label: 'Yazı rengi',
        html: '<label class="pisi-word-color">A<input type="color" value="#d4d4d4"></label>'
    },
    {
        id: 'separator-2',
        label: 'Ayraç 2',
        html: '<span class="pisi-word-separator"></span>'
    },
    {
        id: 'unordered-list',
        label: 'Madde listesi',
        html: '<button type="button" class="pisi-word-btn">• Liste</button>'
    },
    {
        id: 'ordered-list',
        label: 'Numaralı liste',
        html: '<button type="button" class="pisi-word-btn">1. Liste</button>'
    },
    {
        id: 'separator-3',
        label: 'Ayraç 3',
        html: '<span class="pisi-word-separator"></span>'
    },
    {
        id: 'align-left',
        label: 'Sola hizala',
        html: '<button type="button" class="pisi-word-btn">☰</button>'
    },
    {
        id: 'align-center',
        label: 'Ortala',
        html: '<button type="button" class="pisi-word-btn">☷</button>'
    },
    {
        id: 'align-right',
        label: 'Sağa hizala',
        html: '<button type="button" class="pisi-word-btn">☱</button>'
    }
];

const defaultState = {
    order: controls.map((control) => control.id),
    settings: {
        toolbarHeight: 86,
        controlHeight: 32,
        gap: 6,
        selectWidth: 108
    }
};

const controlMap = new Map(
    controls.map((control) => [control.id, control])
);
const list = document.querySelector('[data-designer-list]');
const exportArea = document.querySelector('[data-designer-export]');
let draggedItem = null;
let state = loadState();

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        const savedOrder = Array.isArray(saved?.order)
            ? saved.order.filter((id) => controlMap.has(id))
            : [];
        const missing = defaultState.order.filter(
            (id) => !savedOrder.includes(id)
        );

        return {
            order: [...savedOrder, ...missing],
            settings: {
                ...defaultState.settings,
                ...(saved?.settings || {})
            }
        };
    } catch {
        return structuredClone(defaultState);
    }
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    refreshExport();
}

function render() {
    list.innerHTML = state.order.map((id) => {
        const control = controlMap.get(id);
        return `
            <div class="toolbar-designer-item" data-control-id="${id}">
                <div class="toolbar-designer-item-head">
                    <button
                        type="button"
                        class="toolbar-designer-drag"
                        draggable="true"
                        data-drag-handle
                        title="Tut ve sürükle"
                        aria-label="${control.label} aracını sürükle"
                    >⠿</button>
                    <strong>${control.label}</strong>
                </div>
                <div class="toolbar-designer-control">${control.html}</div>
                <div class="toolbar-designer-move">
                    <button type="button" data-move="left" title="Sola taşı">←</button>
                    <button type="button" data-move="right" title="Sağa taşı">→</button>
                </div>
            </div>
        `;
    }).join('');

    applySettings();
    updateMoveButtons();
    refreshExport();
}

function applySettings() {
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty(
        '--designer-toolbar-height',
        `${state.settings.toolbarHeight}px`
    );
    rootStyle.setProperty(
        '--designer-control-height',
        `${state.settings.controlHeight}px`
    );
    rootStyle.setProperty(
        '--designer-gap',
        `${state.settings.gap}px`
    );
    rootStyle.setProperty(
        '--designer-select-width',
        `${state.settings.selectWidth}px`
    );

    document.querySelectorAll('[data-setting]').forEach((input) => {
        const key = input.dataset.setting;
        input.value = String(state.settings[key]);
        const output = document.querySelector(`[data-output="${key}"]`);
        if (output) output.textContent = `${state.settings[key]} px`;
    });
}

function updateMoveButtons() {
    const items = Array.from(list.children);
    items.forEach((item, index) => {
        item.querySelector('[data-move="left"]').disabled = index === 0;
        item.querySelector('[data-move="right"]').disabled =
            index === items.length - 1;
    });
}

function syncOrderFromDom() {
    state.order = Array.from(list.children).map(
        (item) => item.dataset.controlId
    );
    updateMoveButtons();
    saveState();
}

function getDropSide(event, target) {
    const rect = target.getBoundingClientRect();
    const rowDistance = Math.abs(
        event.clientY - (rect.top + rect.height / 2)
    );

    if (rowDistance > rect.height / 2) {
        return event.clientY < rect.top ? 'before' : 'after';
    }

    return event.clientX < rect.left + rect.width / 2
        ? 'before'
        : 'after';
}

list.addEventListener('dragstart', (event) => {
    const handle = event.target.closest('[data-drag-handle]');
    if (!handle) {
        event.preventDefault();
        return;
    }

    draggedItem = handle.closest('.toolbar-designer-item');
    draggedItem.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(
        'text/plain',
        draggedItem.dataset.controlId
    );
});

list.addEventListener('dragover', (event) => {
    if (!draggedItem) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const target = event.target.closest('.toolbar-designer-item');
    if (!target || target === draggedItem) {
        if (!target) list.appendChild(draggedItem);
        return;
    }

    if (getDropSide(event, target) === 'before') {
        list.insertBefore(draggedItem, target);
    } else {
        list.insertBefore(draggedItem, target.nextSibling);
    }
});

list.addEventListener('drop', (event) => {
    event.preventDefault();
    syncOrderFromDom();
});

list.addEventListener('dragend', () => {
    draggedItem?.classList.remove('dragging');
    draggedItem = null;
    syncOrderFromDom();
});

list.addEventListener('click', (event) => {
    const moveButton = event.target.closest('[data-move]');
    if (!moveButton) return;

    const item = moveButton.closest('.toolbar-designer-item');
    const sibling = moveButton.dataset.move === 'left'
        ? item.previousElementSibling
        : item.nextElementSibling;

    if (!sibling) return;

    if (moveButton.dataset.move === 'left') {
        list.insertBefore(item, sibling);
    } else {
        list.insertBefore(sibling, item);
    }

    syncOrderFromDom();
});

document.querySelectorAll('[data-setting]').forEach((input) => {
    input.addEventListener('input', () => {
        const key = input.dataset.setting;
        state.settings[key] = Number(input.value);
        applySettings();
        saveState();
    });
});

document.querySelector('[data-designer-reset]').addEventListener(
    'click',
    () => {
        state = structuredClone(defaultState);
        localStorage.removeItem(STORAGE_KEY);
        render();
    }
);

document.querySelector('[data-designer-copy]').addEventListener(
    'click',
    async (event) => {
        const text = exportArea.value;
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            exportArea.select();
            document.execCommand('copy');
        }

        const button = event.currentTarget;
        const original = button.textContent;
        button.textContent = 'Kopyalandı';
        setTimeout(() => {
            button.textContent = original;
        }, 1200);
    }
);

function refreshExport() {
    exportArea.value = JSON.stringify(
        {
            type: 'pisi-text-toolbar-layout',
            version: 1,
            order: state.order,
            settings: state.settings
        },
        null,
        2
    );
}

render();
