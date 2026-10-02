import { registerModule } from '../core/module-registry.mjs';

const PISI_MAP_OVERLAY_PREFERENCES = Object.freeze([
    {
        buttonId: 'pisi-map-operational-deps',
        stateKey: 'showTaskDependencies',
        storageKey: 'pisi.map.taskDependencies.visible.v1'
    },
    {
        buttonId: 'pisi-map-operational-work',
        stateKey: 'showWorkBadges',
        storageKey: 'pisi.map.workBadges.visible.v1'
    }
]);

let overlayVisibilityObserver = null;
let overlayVisibilityHandlersBound = false;
let overlayVisibilityFrame = null;

function getPisiStoredOverlayVisibility(storageKey) {
    try {
        const value = String(localStorage.getItem(storageKey) || '')
            .trim()
            .toLowerCase();
        if (!value) return false;
        return ['1', 'true', 'on', 'visible'].includes(value);
    } catch {
        return false;
    }
}

function setPisiStoredOverlayVisibility(storageKey, enabled) {
    try {
        localStorage.setItem(storageKey, enabled === true ? '1' : '0');
    } catch (error) {
        console.warn('[PISI] Mind Map overlay visibility could not be saved:', error);
    }
    return enabled === true;
}

function getPisiOperationalModule() {
    return window.Pisi?.modules?.['map.operational'] || null;
}

function syncPisiOverlayButton(button, enabled) {
    if (!button) return;
    const pressed = enabled ? 'true' : 'false';
    if (button.getAttribute('aria-pressed') !== pressed) {
        button.setAttribute('aria-pressed', pressed);
    }
    if (button.classList.contains('active') !== enabled) {
        button.classList.toggle('active', enabled);
    }
}

function applyPisiMindMapOverlayPreferences() {
    const operational = getPisiOperationalModule();
    const display = operational?.operationalState?.display;
    if (!display) return false;

    let changed = false;
    for (const preference of PISI_MAP_OVERLAY_PREFERENCES) {
        const enabled = getPisiStoredOverlayVisibility(preference.storageKey);
        if (display[preference.stateKey] !== enabled) {
            display[preference.stateKey] = enabled;
            changed = true;
        }
        syncPisiOverlayButton(document.getElementById(preference.buttonId), enabled);
    }

    if (changed) operational?.schedulePisiOperationalRender?.();
    return true;
}

function capturePisiMindMapOverlayPreference(preference) {
    queueMicrotask(() => {
        const display = getPisiOperationalModule()?.operationalState?.display;
        if (!display) return;
        const enabled = display[preference.stateKey] === true;
        setPisiStoredOverlayVisibility(preference.storageKey, enabled);
        applyPisiMindMapOverlayPreferences();
    });
}

function schedulePisiMindMapOverlayPreferenceSync() {
    if (overlayVisibilityFrame !== null) return;
    overlayVisibilityFrame = requestAnimationFrame(() => {
        overlayVisibilityFrame = null;
        applyPisiMindMapOverlayPreferences();
    });
}

function bindPisiMindMapOverlayVisibilityHandlers() {
    if (overlayVisibilityHandlersBound) return;
    overlayVisibilityHandlersBound = true;

    document.addEventListener('click', (event) => {
        for (const preference of PISI_MAP_OVERLAY_PREFERENCES) {
            if (event.target?.closest?.(`#${preference.buttonId}`)) {
                capturePisiMindMapOverlayPreference(preference);
                return;
            }
        }
    });

    document.addEventListener('pisi:map-customization-context-changed', schedulePisiMindMapOverlayPreferenceSync);
}

function mutationTouchesPisiMindMapOverlayControls(mutation) {
    if (mutation.type === 'attributes') {
        return PISI_MAP_OVERLAY_PREFERENCES.some((preference) => mutation.target?.id === preference.buttonId);
    }

    return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
        if (node?.nodeType !== Node.ELEMENT_NODE) return false;
        return PISI_MAP_OVERLAY_PREFERENCES.some((preference) => node.id === preference.buttonId || node.querySelector?.(`#${preference.buttonId}`));
    });
}

function bindPisiMindMapOverlayVisibilityDefaults() {
    bindPisiMindMapOverlayVisibilityHandlers();
    schedulePisiMindMapOverlayPreferenceSync();

    if (!overlayVisibilityObserver && document.body) {
        overlayVisibilityObserver = new MutationObserver((mutations) => {
            if (mutations.some(mutationTouchesPisiMindMapOverlayControls)) {
                schedulePisiMindMapOverlayPreferenceSync();
            }
        });
        overlayVisibilityObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-pressed']
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPisiMindMapOverlayVisibilityDefaults, { once: true });
} else {
    bindPisiMindMapOverlayVisibilityDefaults();
}

registerModule('map.overlayVisibilityDefaults', {
    applyPisiMindMapOverlayPreferences,
    bindPisiMindMapOverlayVisibilityDefaults,
    getPisiStoredOverlayVisibility,
    setPisiStoredOverlayVisibility,
    syncPisiOverlayButton
});

export {
    applyPisiMindMapOverlayPreferences,
    bindPisiMindMapOverlayVisibilityDefaults,
    getPisiStoredOverlayVisibility,
    setPisiStoredOverlayVisibility,
    syncPisiOverlayButton
};
