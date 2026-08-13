import { registerModule } from "../core/module-registry.mjs";
import { renderPisiBases } from "./pisi-structured-views.mjs";

const pisiBasesDialogState = {
    body: null,
    bound: false,
    closeButton: null,
    dialog: null,
    generation: 0,
    languageUnsubscribe: null,
    overlay: null,
    title: null,
    trigger: null
};

function pisiBasesTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function isPisiBasesMapAvailable() {
    const canvas = document.getElementById('map-canvas');
    return Boolean(
        window.activeMapPath &&
        canvas &&
        !canvas.hidden &&
        canvas.style.display !== 'none'
    );
}

function updatePisiBasesDialogLabels() {
    const openLabel = pisiBasesTranslate("Bases-lite'ı aç");
    if (pisiBasesDialogState.trigger) {
        pisiBasesDialogState.trigger.title = openLabel;
        pisiBasesDialogState.trigger.setAttribute('aria-label', openLabel);
    }
    if (pisiBasesDialogState.title) {
        pisiBasesDialogState.title.textContent = pisiBasesTranslate('Bases-lite');
    }
    if (pisiBasesDialogState.dialog) {
        pisiBasesDialogState.dialog.setAttribute(
            'aria-label',
            pisiBasesTranslate('Bases-lite')
        );
    }
    if (pisiBasesDialogState.closeButton) {
        const closeLabel = pisiBasesTranslate('Kapat');
        pisiBasesDialogState.closeButton.title = closeLabel;
        pisiBasesDialogState.closeButton.setAttribute('aria-label', closeLabel);
    }
}

function installPisiBasesMapTrigger() {
    const canvas = document.getElementById('map-canvas');
    if (!canvas) return null;
    const existing = document.getElementById('pisi-bases-map-control');
    if (existing) {
        pisiBasesDialogState.trigger = existing.querySelector('button');
        return pisiBasesDialogState.trigger;
    }

    const control = document.createElement('div');
    control.id = 'pisi-bases-map-control';
    control.className = 'pisi-map-overlay-control';
    const button = document.createElement('button');
    button.id = 'pisi-bases-map-trigger';
    button.type = 'button';
    button.className = 'pisi-map-bases-trigger';
    const icon = document.createElement('span');
    icon.className = 'pisi-map-bases-icon';
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
    control.appendChild(button);
    canvas.appendChild(control);

    control.addEventListener('pointerdown', (event) => event.stopPropagation());
    control.addEventListener('mousedown', (event) => event.stopPropagation());
    control.addEventListener('dblclick', (event) => event.stopPropagation());
    control.addEventListener('contextmenu', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        void openPisiBasesDialog();
    });
    pisiBasesDialogState.trigger = button;
    updatePisiBasesDialogLabels();
    return button;
}

function syncPisiBasesMapTrigger() {
    const trigger = pisiBasesDialogState.trigger || installPisiBasesMapTrigger();
    if (!trigger) return false;
    const available = isPisiBasesMapAvailable();
    trigger.closest('#pisi-bases-map-control').hidden = !available;
    trigger.disabled = !available;
    trigger.setAttribute('aria-disabled', available ? 'false' : 'true');
    if (!available && pisiBasesDialogState.overlay && !pisiBasesDialogState.overlay.hidden) {
        closePisiBasesDialog({ restoreFocus: false });
    }
    return available;
}

function ensurePisiBasesDialog() {
    if (pisiBasesDialogState.overlay?.isConnected) {
        return pisiBasesDialogState.overlay;
    }
    const overlay = document.createElement('div');
    overlay.id = 'pisi-bases-dialog-overlay';
    overlay.className = 'pisi-bases-dialog-overlay';
    overlay.hidden = true;
    const dialog = document.createElement('section');
    dialog.className = 'pisi-bases-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const header = document.createElement('header');
    header.className = 'pisi-bases-dialog-header';
    const heading = document.createElement('div');
    const icon = document.createElement('span');
    icon.className = 'pisi-map-bases-icon';
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong');
    heading.append(icon, title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pisi-bases-dialog-close';
    close.textContent = '×';
    close.addEventListener('click', () => closePisiBasesDialog());
    header.append(heading, close);
    const body = document.createElement('div');
    body.className = 'pisi-bases-dialog-body';
    dialog.append(header, body);
    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) closePisiBasesDialog();
    });
    document.body.appendChild(overlay);

    pisiBasesDialogState.overlay = overlay;
    pisiBasesDialogState.dialog = dialog;
    pisiBasesDialogState.body = body;
    pisiBasesDialogState.title = title;
    pisiBasesDialogState.closeButton = close;
    updatePisiBasesDialogLabels();
    return overlay;
}

async function renderPisiBasesDialogBody() {
    const body = pisiBasesDialogState.body;
    if (!body) return false;
    const generation = ++pisiBasesDialogState.generation;
    body.setAttribute('aria-busy', 'true');
    const loading = document.createElement('div');
    loading.className = 'pisi-bases-dialog-loading';
    loading.textContent = pisiBasesTranslate('Yükleniyor…');
    body.replaceChildren(loading);
    try {
        const content = document.createElement('div');
        content.className = 'pisi-bases-dialog-content';
        await renderPisiBases(content, { showTitle: false });
        if (generation !== pisiBasesDialogState.generation) return false;
        body.replaceChildren(content);
        return true;
    } catch (error) {
        if (generation !== pisiBasesDialogState.generation) return false;
        console.error('[PISI] Bases-lite dialog could not be rendered:', error);
        const message = document.createElement('div');
        message.className = 'pisi-bases-dialog-error';
        message.textContent = error?.message || pisiBasesTranslate('Bases-lite yüklenemedi.');
        body.replaceChildren(message);
        return false;
    } finally {
        if (generation === pisiBasesDialogState.generation) {
            body.removeAttribute('aria-busy');
        }
    }
}

async function openPisiBasesDialog() {
    if (!syncPisiBasesMapTrigger()) return false;
    ensurePisiBasesDialog();
    pisiBasesDialogState.overlay.hidden = false;
    document.body.classList.add('pisi-bases-dialog-open');
    const rendered = await renderPisiBasesDialogBody();
    if (rendered) {
        pisiBasesDialogState.body.querySelector('input, button, select')?.focus();
    }
    return rendered;
}

function closePisiBasesDialog(options = {}) {
    pisiBasesDialogState.generation += 1;
    if (pisiBasesDialogState.overlay) pisiBasesDialogState.overlay.hidden = true;
    document.body.classList.remove('pisi-bases-dialog-open');
    if (options.restoreFocus !== false && isPisiBasesMapAvailable()) {
        pisiBasesDialogState.trigger?.focus?.();
    }
    return true;
}

function initializePisiBasesDialog() {
    if (pisiBasesDialogState.bound) return false;
    pisiBasesDialogState.bound = true;
    installPisiBasesMapTrigger();
    syncPisiBasesMapTrigger();
    document.addEventListener('pisi:map-customization-context-changed', () => {
        syncPisiBasesMapTrigger();
    });
    document.addEventListener('pisi:active-node-changed', () => {
        syncPisiBasesMapTrigger();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !pisiBasesDialogState.overlay?.hidden) {
            event.preventDefault();
            closePisiBasesDialog();
        }
    });
    pisiBasesDialogState.languageUnsubscribe =
        window.pisiI18n?.onLanguageChanged?.(() => {
            updatePisiBasesDialogLabels();
            if (!pisiBasesDialogState.overlay?.hidden) {
                void renderPisiBasesDialogBody();
            }
        }) || null;
    return true;
}

const moduleApi = {
    pisiBasesDialogState,
    closePisiBasesDialog,
    ensurePisiBasesDialog,
    initializePisiBasesDialog,
    installPisiBasesMapTrigger,
    openPisiBasesDialog,
    renderPisiBasesDialogBody,
    syncPisiBasesMapTrigger
};

registerModule('data.basesDialog', moduleApi);
initializePisiBasesDialog();

export {
    closePisiBasesDialog,
    ensurePisiBasesDialog,
    initializePisiBasesDialog,
    installPisiBasesMapTrigger,
    openPisiBasesDialog,
    pisiBasesDialogState,
    renderPisiBasesDialogBody,
    syncPisiBasesMapTrigger
};
