import { registerModule } from '../core/module-registry.mjs';

const PISI_PROPERTY_BADGES_VISIBLE_STORAGE_KEY = 'pisi.map.propertyBadges.visible.v1';
const PISI_PROPERTY_BADGES_TOGGLE_ID = 'pisi-map-property-badges-toggle';

let propertyBadgesToggleObserver = null;

function getPisiPropertyBadgesVisible() {
    try {
        const value = String(localStorage.getItem(PISI_PROPERTY_BADGES_VISIBLE_STORAGE_KEY) || '').toLowerCase();
        return !['0', 'false', 'off', 'hidden'].includes(value);
    } catch {
        return true;
    }
}

function syncPisiPropertyBadgesVisibility() {
    const enabled = getPisiPropertyBadgesVisible();
    document.documentElement.dataset.pisiPropertyBadgesVisible = enabled ? 'true' : 'false';
    const button = document.getElementById(PISI_PROPERTY_BADGES_TOGGLE_ID);
    if (button) {
        button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        button.classList.toggle('active', enabled);
    }
    return enabled;
}

function setPisiPropertyBadgesVisible(enabled) {
    const normalized = enabled === true;
    try {
        localStorage.setItem(
            PISI_PROPERTY_BADGES_VISIBLE_STORAGE_KEY,
            normalized ? '1' : '0'
        );
    } catch (error) {
        console.warn('[PISI] Property badge visibility could not be saved:', error);
    }
    syncPisiPropertyBadgesVisibility();
    document.dispatchEvent(new CustomEvent('pisi:map-property-badges-visibility-changed', {
        detail: { enabled: normalized }
    }));
    return normalized;
}

function ensurePisiPropertyBadgesToggleStyle() {
    if (document.querySelector('link[data-pisi-property-badges-toggle-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/map/pisi-map-property-badges-toggle.css';
    link.dataset.pisiPropertyBadgesToggleStyle = '1';
    document.head.appendChild(link);
}

function ensurePisiPropertyBadgesToggleButton() {
    const actions = document.querySelector('#right-tab-mindmap .pisi-mindmap-icon-actions');
    if (!actions) return false;

    let button = document.getElementById(PISI_PROPERTY_BADGES_TOGGLE_ID);
    if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.id = PISI_PROPERTY_BADGES_TOGGLE_ID;
        button.className = 'pisi-mindmap-icon-button';
        button.dataset.pisiToolIcon = 'labels';
        button.title = 'Badges';
        button.setAttribute('aria-label', 'Badges');
        button.addEventListener('click', () => {
            setPisiPropertyBadgesVisible(!getPisiPropertyBadgesVisible());
        });
    }

    const workButton = document.getElementById('pisi-map-operational-work');
    if (workButton?.parentElement === actions) {
        if (workButton.nextElementSibling !== button) {
            workButton.insertAdjacentElement('afterend', button);
        }
    } else if (button.parentElement !== actions) {
        actions.appendChild(button);
    }

    syncPisiPropertyBadgesVisibility();
    return true;
}

function schedulePisiPropertyBadgesToggleInstall() {
    requestAnimationFrame(() => ensurePisiPropertyBadgesToggleButton());
}

function bindPisiPropertyBadgesToggle() {
    ensurePisiPropertyBadgesToggleStyle();
    syncPisiPropertyBadgesVisibility();
    schedulePisiPropertyBadgesToggleInstall();

    const panel = document.getElementById('right-tab-mindmap') || document.body;
    if (!propertyBadgesToggleObserver && panel) {
        propertyBadgesToggleObserver = new MutationObserver((mutations) => {
            const relevant = mutations.some((mutation) => (
                [...mutation.addedNodes, ...mutation.removedNodes].some((node) => (
                    node?.nodeType === Node.ELEMENT_NODE && (
                        node.id === 'pisi-map-operational-work' ||
                        node.id === PISI_PROPERTY_BADGES_TOGGLE_ID ||
                        node.matches?.('.pisi-mindmap-icon-actions') ||
                        node.querySelector?.('#pisi-map-operational-work, .pisi-mindmap-icon-actions')
                    )
                ))
            ));
            if (relevant) schedulePisiPropertyBadgesToggleInstall();
        });
        propertyBadgesToggleObserver.observe(panel, { childList: true, subtree: true });
    }

    document.addEventListener('pisi:map-customization-context-changed', schedulePisiPropertyBadgesToggleInstall);
    document.addEventListener('pisi:map-property-badges-changed', () => {
        syncPisiPropertyBadgesVisibility();
        schedulePisiPropertyBadgesToggleInstall();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPisiPropertyBadgesToggle, { once: true });
} else {
    bindPisiPropertyBadgesToggle();
}

registerModule('map.propertyBadgesToggle', {
    bindPisiPropertyBadgesToggle,
    ensurePisiPropertyBadgesToggleButton,
    getPisiPropertyBadgesVisible,
    setPisiPropertyBadgesVisible,
    syncPisiPropertyBadgesVisibility
});

export {
    bindPisiPropertyBadgesToggle,
    ensurePisiPropertyBadgesToggleButton,
    getPisiPropertyBadgesVisible,
    setPisiPropertyBadgesVisible,
    syncPisiPropertyBadgesVisibility
};
