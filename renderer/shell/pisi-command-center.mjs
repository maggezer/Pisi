import { registerModule } from "../core/module-registry.mjs";

const pisiCommandCenterState = {
    pages: new Map(),
    activePage: 'tasks',
    overlay: null,
    dialog: null,
    tabs: null,
    body: null
};

function pisiCommandTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function ensurePisiCommandCenter() {
    if (pisiCommandCenterState.overlay?.isConnected) return pisiCommandCenterState.overlay;
    const overlay = document.createElement('div');
    overlay.id = 'pisi-command-center-overlay';
    overlay.className = 'pisi-command-center-overlay';
    overlay.hidden = true;

    const dialog = document.createElement('section');
    dialog.className = 'pisi-command-center-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', pisiCommandTranslate('Pisi çalışma merkezi'));

    const header = document.createElement('header');
    header.className = 'pisi-command-center-header';
    const title = document.createElement('strong');
    title.textContent = pisiCommandTranslate('Pisi çalışma merkezi');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pisi-command-center-close';
    close.textContent = '×';
    close.title = pisiCommandTranslate('Kapat');
    close.addEventListener('click', closePisiCommandCenter);
    header.append(title, close);

    const tabs = document.createElement('nav');
    tabs.className = 'pisi-command-center-tabs';
    const body = document.createElement('div');
    body.className = 'pisi-command-center-body';
    dialog.append(header, tabs, body);
    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) closePisiCommandCenter();
    });
    document.body.appendChild(overlay);

    pisiCommandCenterState.overlay = overlay;
    pisiCommandCenterState.dialog = dialog;
    pisiCommandCenterState.tabs = tabs;
    pisiCommandCenterState.body = body;
    renderPisiCommandCenterNavigation();
    return overlay;
}

function registerPisiCommandCenterPage(page) {
    if (!page?.id || typeof page.render !== 'function') {
        throw new TypeError('Çalışma merkezi sayfası id ve render gerektirir.');
    }
    pisiCommandCenterState.pages.set(page.id, {
        id: page.id,
        label: page.label || page.id,
        order: Number(page.order) || 0,
        render: page.render
    });
    if (pisiCommandCenterState.tabs) renderPisiCommandCenterNavigation();
}

function renderPisiCommandCenterNavigation() {
    const tabs = pisiCommandCenterState.tabs;
    if (!tabs) return;
    tabs.replaceChildren();
    const pages = Array.from(pisiCommandCenterState.pages.values())
        .sort((a, b) => a.order - b.order);
    if (!pisiCommandCenterState.pages.has(pisiCommandCenterState.activePage)) {
        pisiCommandCenterState.activePage = pages[0]?.id || '';
    }
    for (const page of pages) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-command-center-tab';
        button.dataset.page = page.id;
        button.classList.toggle('active', page.id === pisiCommandCenterState.activePage);
        button.setAttribute('aria-pressed', page.id === pisiCommandCenterState.activePage ? 'true' : 'false');
        button.textContent = pisiCommandTranslate(page.label);
        button.addEventListener('click', () => {
            pisiCommandCenterState.activePage = page.id;
            renderPisiCommandCenterNavigation();
            renderPisiCommandCenterPage();
        });
        tabs.appendChild(button);
    }
}

async function renderPisiCommandCenterPage() {
    const body = pisiCommandCenterState.body;
    const page = pisiCommandCenterState.pages.get(pisiCommandCenterState.activePage);
    if (!body || !page) return;
    body.replaceChildren();
    body.setAttribute('aria-busy', 'true');
    try {
        await page.render(body);
    } catch (error) {
        const message = document.createElement('div');
        message.className = 'pisi-command-center-error';
        message.textContent = error.message || pisiCommandTranslate('Sayfa yüklenemedi.');
        body.replaceChildren(message);
    } finally {
        body.removeAttribute('aria-busy');
    }
}

async function openPisiCommandCenter(pageId = null) {
    if (!window.currentProjectFolder) {
        alert(pisiCommandTranslate('Önce bir proje açın.'));
        return false;
    }
    ensurePisiCommandCenter();
    if (pageId && pisiCommandCenterState.pages.has(pageId)) {
        pisiCommandCenterState.activePage = pageId;
    }
    renderPisiCommandCenterNavigation();
    pisiCommandCenterState.overlay.hidden = false;
    document.body.classList.add('pisi-command-center-open');
    await renderPisiCommandCenterPage();
    pisiCommandCenterState.dialog.querySelector('input, button, select')?.focus();
    return true;
}

function closePisiCommandCenter() {
    if (pisiCommandCenterState.overlay) pisiCommandCenterState.overlay.hidden = true;
    document.body.classList.remove('pisi-command-center-open');
}

function installPisiCommandCenterButton() {
    const actions = document.getElementById('project-actions');
    if (!actions || document.getElementById('pisi-command-center-button')) return;
    const button = document.createElement('button');
    button.id = 'pisi-command-center-button';
    button.type = 'button';
    button.className = 'project-action-btn';
    button.textContent = '🧭';
    button.title = pisiCommandTranslate('Pisi çalışma merkezi');
    button.addEventListener('click', () => openPisiCommandCenter());
    actions.prepend(button);
}

function initializePisiCommandCenter() {
    installPisiCommandCenterButton();
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !pisiCommandCenterState.overlay?.hidden) {
            event.preventDefault();
            closePisiCommandCenter();
        }
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
            event.preventDefault();
            openPisiCommandCenter();
        }
    });
}

const moduleApi = {
    pisiCommandCenterState,
    ensurePisiCommandCenter,
    registerPisiCommandCenterPage,
    renderPisiCommandCenterPage,
    openPisiCommandCenter,
    closePisiCommandCenter,
    initializePisiCommandCenter
};

registerModule('shell.commandCenter', moduleApi);
initializePisiCommandCenter();

export {
    closePisiCommandCenter,
    ensurePisiCommandCenter,
    openPisiCommandCenter,
    pisiCommandCenterState,
    registerPisiCommandCenterPage,
    renderPisiCommandCenterPage
};
