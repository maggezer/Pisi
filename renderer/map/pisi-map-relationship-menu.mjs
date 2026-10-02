import { registerModule } from '../core/module-registry.mjs';

const relationshipMenuState = {
    button: null,
    menu: null,
    observer: null,
    handlersBound: false
};

const relationshipText = {
    tr: {
        title: 'İlişkiler',
        all: 'Tüm ilişkiler',
        hierarchy: 'Hierarchy',
        flow: 'Flow',
        peer: 'Peer'
    },
    eng: {
        title: 'Relationships',
        all: 'All relationships',
        hierarchy: 'Hierarchy',
        flow: 'Flow',
        peer: 'Peer'
    }
};

const relationshipOptions = [
    ['all', 'all'],
    ['down-hub', 'hierarchy'],
    ['stream', 'flow'],
    ['co-level', 'peer']
];

function t(key) {
    const language = window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
    return relationshipText[language]?.[key] || relationshipText.eng[key] || key;
}

function getRelationshipSelect() {
    return document.getElementById('pisi-map-operational-relation');
}

function getCurrentRelationshipValue() {
    const select = getRelationshipSelect();
    if (select?.value) return select.value;
    const types = window.Pisi?.modules?.['map.operational']?.operationalState?.scope?.relationshipTypes;
    return Array.isArray(types) && types[0] ? String(types[0]) : 'all';
}

function getRelationshipLabel(value) {
    const select = getRelationshipSelect();
    const nativeOption = Array.from(select?.options || []).find((option) => option.value === value);
    if (nativeOption?.textContent?.trim()) return nativeOption.textContent.trim();
    const fallback = relationshipOptions.find(([candidate]) => candidate === value)?.[1] || 'all';
    return t(fallback);
}

function closeRelationshipMenu() {
    if (relationshipMenuState.menu) relationshipMenuState.menu.hidden = true;
    if (relationshipMenuState.button) {
        relationshipMenuState.button.setAttribute('aria-expanded', 'false');
    }
}

function positionRelationshipMenu() {
    const button = relationshipMenuState.button;
    const menu = relationshipMenuState.menu;
    if (!button || !menu || menu.hidden) return;
    const rect = button.getBoundingClientRect();
    const menuWidth = Math.max(150, menu.offsetWidth || 150);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - menuWidth - 8));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(rect.bottom + 6)}px`;
}

function syncRelationshipMenu() {
    const value = getCurrentRelationshipValue();
    const button = relationshipMenuState.button;
    const menu = relationshipMenuState.menu;
    const selectedLabel = getRelationshipLabel(value);

    if (button) {
        const title = `${t('title')}: ${selectedLabel}`;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.setAttribute('aria-pressed', value === 'all' ? 'false' : 'true');
    }

    menu?.querySelectorAll('[data-pisi-relationship-value]').forEach((option) => {
        const optionValue = option.dataset.pisiRelationshipValue;
        option.textContent = getRelationshipLabel(optionValue);
        option.setAttribute('aria-checked', optionValue === value ? 'true' : 'false');
    });
}

function applyRelationship(value) {
    const select = getRelationshipSelect();
    if (!select) return;
    const allowed = new Set(relationshipOptions.map(([candidate]) => candidate));
    const normalized = allowed.has(value) ? value : 'all';
    select.value = normalized;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncRelationshipMenu();
    closeRelationshipMenu();
}

function ensureRelationshipMenu() {
    if (relationshipMenuState.menu?.isConnected) return relationshipMenuState.menu;

    const menu = document.createElement('div');
    menu.id = 'pisi-map-relationship-menu';
    menu.className = 'pisi-map-focus-degree-menu pisi-map-relationship-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;

    for (const [value] of relationshipOptions) {
        const option = document.createElement('button');
        option.type = 'button';
        option.dataset.pisiRelationshipValue = value;
        option.setAttribute('role', 'menuitemradio');
        option.setAttribute('aria-checked', 'false');
        option.addEventListener('click', () => applyRelationship(value));
        menu.appendChild(option);
    }

    document.body.appendChild(menu);
    relationshipMenuState.menu = menu;
    syncRelationshipMenu();
    return menu;
}

function ensureRelationshipButton() {
    let button = document.getElementById('pisi-map-operational-relationship-button');
    if (!button) {
        button = document.createElement('button');
        button.id = 'pisi-map-operational-relationship-button';
        button.type = 'button';
        button.className = 'pisi-mindmap-icon-button';
        button.dataset.pisiToolIcon = 'relationship';
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-controls', 'pisi-map-relationship-menu');
        button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const menu = ensureRelationshipMenu();
            const opening = menu.hidden;
            closeRelationshipMenu();
            menu.hidden = !opening;
            button.setAttribute('aria-expanded', opening ? 'true' : 'false');
            if (opening) {
                syncRelationshipMenu();
                positionRelationshipMenu();
            }
        });
    }
    relationshipMenuState.button = button;
    return button;
}

function placeRelationshipButton() {
    const select = getRelationshipSelect();
    if (select) select.hidden = true;

    const focus = document.getElementById('pisi-map-operational-focus');
    const actions = focus?.closest('.pisi-mindmap-icon-actions');
    if (!focus || !actions) return false;

    const button = ensureRelationshipButton();
    if (button.parentElement !== actions || focus.nextElementSibling !== button) {
        focus.insertAdjacentElement('afterend', button);
    }
    ensureRelationshipMenu();
    syncRelationshipMenu();
    return true;
}

function scheduleRelationshipPlacement() {
    requestAnimationFrame(() => {
        requestAnimationFrame(placeRelationshipButton);
    });
}

function bindRelationshipMenuHandlers() {
    if (relationshipMenuState.handlersBound) return;
    relationshipMenuState.handlersBound = true;

    document.addEventListener(
        'mousedown',
        (event) => {
            const menu = relationshipMenuState.menu;
            const button = relationshipMenuState.button;
            if (!menu || menu.hidden) return;
            if (menu.contains(event.target) || button?.contains(event.target)) return;
            closeRelationshipMenu();
        },
        true
    );

    document.addEventListener(
        'keydown',
        (event) => {
            if (event.key !== 'Escape' || relationshipMenuState.menu?.hidden) return;
            event.preventDefault();
            closeRelationshipMenu();
            relationshipMenuState.button?.focus();
        },
        true
    );

    document.addEventListener('pisi:language-changed', scheduleRelationshipPlacement);
    document.addEventListener('pisi:map-customization-context-changed', scheduleRelationshipPlacement);
    window.addEventListener('resize', positionRelationshipMenu);
    window.addEventListener('scroll', positionRelationshipMenu, true);
}

function installRelationshipMenu() {
    bindRelationshipMenuHandlers();
    placeRelationshipButton();

    const host = document.getElementById('right-panel-content') || document.body;
    if (!relationshipMenuState.observer && host) {
        relationshipMenuState.observer = new MutationObserver(() => {
            const select = getRelationshipSelect();
            const focus = document.getElementById('pisi-map-operational-focus');
            const button = document.getElementById('pisi-map-operational-relationship-button');
            if (select && (!select.hidden || (focus && focus.nextElementSibling !== button))) {
                scheduleRelationshipPlacement();
            }
        });
        relationshipMenuState.observer.observe(host, { childList: true, subtree: true });
    }

    scheduleRelationshipPlacement();
}

registerModule('map.relationshipMenu', {
    applyRelationship,
    closeRelationshipMenu,
    installRelationshipMenu,
    placeRelationshipButton,
    syncRelationshipMenu
});

installRelationshipMenu();

export { applyRelationship, closeRelationshipMenu, installRelationshipMenu, placeRelationshipButton, syncRelationshipMenu };
