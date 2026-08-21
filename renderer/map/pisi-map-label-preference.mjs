import { registerModule } from '../core/module-registry.mjs';
import {
    getPisiRelationshipLabelsPreference,
    setPisiRelationshipLabelsPreference
} from './pisi-map-operational-render.mjs';

let labelsPreferenceObserver = null;
let labelsPreferenceHandlersBound = false;

function ensureLabelsPreferenceStyle() {
    if (document.querySelector('link[data-pisi-map-label-preference-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/map/pisi-map-label-preference.css';
    link.dataset.pisiMapLabelPreferenceStyle = '1';
    document.head.appendChild(link);
}

function syncOperationalLabelsPreference() {
    const enabled = getPisiRelationshipLabelsPreference();
    const operational = window.Pisi?.modules?.['map.operational'];
    if (operational?.operationalState?.display) {
        operational.operationalState.display.showRelationshipLabels = enabled;
    }
    operational?.schedulePisiOperationalRender?.();
    return enabled;
}

function syncPreferenceButton(button) {
    if (!button) return;
    const enabled = getPisiRelationshipLabelsPreference();
    button.textContent = enabled ? 'On' : 'Off';
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.classList.toggle('active', enabled);
}

function syncPreferenceFromOperationalButton() {
    const operational = window.Pisi?.modules?.['map.operational'];
    const display = operational?.operationalState?.display;
    if (!display) return getPisiRelationshipLabelsPreference();

    const enabled = display.showRelationshipLabels !== false;
    setPisiRelationshipLabelsPreference(enabled);
    syncPreferenceButton(document.querySelector('#pisi-preference-map-labels button'));
    document.dispatchEvent(new CustomEvent('pisi:relationship-labels-preference-changed', {
        detail: { enabled }
    }));
    return enabled;
}

function installLabelsPreferenceRow() {
    const commandCenter = window.Pisi?.modules?.['shell.commandCenter']?.pisiCommandCenterState;
    if (!commandCenter || commandCenter.activePage !== 'preferences') return false;

    const page = commandCenter.body?.querySelector('.pisi-preferences-page');
    if (!page) return false;

    let row = page.querySelector('#pisi-preference-map-labels');
    if (row) {
        syncPreferenceButton(row.querySelector('button'));
        return true;
    }

    row = document.createElement('div');
    row.id = 'pisi-preference-map-labels';
    row.className = 'pisi-preference-toggle-row';

    const label = document.createElement('span');
    label.className = 'pisi-preference-toggle-label';
    label.textContent = 'Labels';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pisi-preference-toggle-button';
    button.setAttribute('aria-label', 'Labels');
    syncPreferenceButton(button);
    button.addEventListener('click', () => {
        const enabled = setPisiRelationshipLabelsPreference(
            !getPisiRelationshipLabelsPreference()
        );
        const operational = window.Pisi?.modules?.['map.operational'];
        if (operational?.operationalState?.display) {
            operational.operationalState.display.showRelationshipLabels = enabled;
        }
        syncPreferenceButton(button);
        const mapButton = document.getElementById('pisi-map-operational-labels');
        mapButton?.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        operational?.schedulePisiOperationalRender?.();
        document.dispatchEvent(new CustomEvent('pisi:relationship-labels-preference-changed', {
            detail: { enabled }
        }));
    });

    row.append(label, button);
    const appearanceOptions = page.querySelector('.pisi-theme-options');
    if (appearanceOptions) appearanceOptions.insertAdjacentElement('afterend', row);
    else page.appendChild(row);
    return true;
}

function refreshLabelsPreferenceUi() {
    syncOperationalLabelsPreference();
    installLabelsPreferenceRow();
}

function bindLabelsPreferenceHandlers() {
    if (labelsPreferenceHandlersBound) return;
    labelsPreferenceHandlersBound = true;

    document.addEventListener('click', (event) => {
        if (!event.target?.closest?.('#pisi-map-operational-labels')) return;
        queueMicrotask(syncPreferenceFromOperationalButton);
    });
}

function bindLabelsPreference() {
    ensureLabelsPreferenceStyle();
    bindLabelsPreferenceHandlers();
    syncOperationalLabelsPreference();
    installLabelsPreferenceRow();

    if (!labelsPreferenceObserver && document.body) {
        labelsPreferenceObserver = new MutationObserver((mutations) => {
            const relevant = mutations.some((mutation) => {
                return [...mutation.addedNodes].some((node) => {
                    return node?.nodeType === Node.ELEMENT_NODE && (
                        node.id === 'pisi-map-operational-labels' ||
                        node.matches?.('.pisi-preferences-page, .pisi-command-center-body') ||
                        node.querySelector?.('#pisi-map-operational-labels, .pisi-preferences-page, .pisi-command-center-body')
                    );
                });
            });
            if (relevant) requestAnimationFrame(refreshLabelsPreferenceUi);
        });
        labelsPreferenceObserver.observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener('pisi:map-customization-context-changed', () => {
        requestAnimationFrame(refreshLabelsPreferenceUi);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindLabelsPreference, { once: true });
} else {
    bindLabelsPreference();
}

registerModule('map.labelPreference', {
    bindLabelsPreference,
    installLabelsPreferenceRow,
    syncOperationalLabelsPreference,
    syncPreferenceFromOperationalButton
});

export {
    bindLabelsPreference,
    installLabelsPreferenceRow,
    syncOperationalLabelsPreference,
    syncPreferenceFromOperationalButton
};
