import { registerModule } from "../core/module-registry.mjs";
import {
    getPisiThemePreference,
    setPisiThemePreference
} from "./pisi-customizations.mjs";

const pisiCommandCenterState = {
    pages: new Map(),
    activePage: '',
    overlay: null,
    dialog: null,
    tabs: null,
    body: null
};

const PISI_APPLICATION_PAGE_LABELS = {
    tr: {
        settings: 'Ayarlar',
        preferences: 'Tercihler',
        appearance: 'Görünüm',
        appearanceDescription: 'Pisi arayüzü için kullanmak istediğiniz renk paletini seçin.',
        dark: 'Koyu',
        darkDescription: 'Mevcut koyu Pisi paleti.',
        light: 'Açık',
        lightDescription: 'Açık yüzeyler ve koyu metinlerle aydınlık Pisi paleti.'
    },
    eng: {
        settings: 'Settings',
        preferences: 'Preferences',
        appearance: 'Appearance',
        appearanceDescription: 'Choose the color palette used by the Pisi interface.',
        dark: 'Dark',
        darkDescription: 'The current dark Pisi palette.',
        light: 'Light',
        lightDescription: 'A bright Pisi palette with light surfaces and dark text.'
    }
};

function pisiCommandTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function getPisiApplicationText(key) {
    const language = window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
    return PISI_APPLICATION_PAGE_LABELS[language]?.[key] || key;
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
        requiresProject: page.requiresProject !== false,
        render: page.render
    });
    if (pisiCommandCenterState.tabs) renderPisiCommandCenterNavigation();
}

function getVisiblePisiCommandCenterPages() {
    return Array.from(pisiCommandCenterState.pages.values())
        .filter((page) => window.currentProjectFolder || !page.requiresProject)
        .sort((a, b) => a.order - b.order);
}

function renderPisiCommandCenterNavigation() {
    const tabs = pisiCommandCenterState.tabs;
    if (!tabs) return;
    tabs.replaceChildren();
    const pages = getVisiblePisiCommandCenterPages();
    const activePageIsVisible = pages.some((page) => page.id === pisiCommandCenterState.activePage);
    if (!activePageIsVisible) {
        pisiCommandCenterState.activePage = pages[0]?.id || '';
    }
    for (const page of pages) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-command-center-tab';
        button.dataset.page = page.id;
        button.classList.toggle('active', page.id === pisiCommandCenterState.activePage);
        button.setAttribute('aria-pressed', page.id === pisiCommandCenterState.activePage ? 'true' : 'false');
        const rawLabel = typeof page.label === 'function' ? page.label() : page.label;
        button.textContent = pisiCommandTranslate(rawLabel);
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
    const requestedPage = pageId ? pisiCommandCenterState.pages.get(pageId) : null;
    if (!window.currentProjectFolder && requestedPage?.requiresProject !== false) {
        alert(pisiCommandTranslate('Önce bir proje açın.'));
        return false;
    }
    if (!window.currentProjectFolder && !requestedPage) {
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

function makePisiThemeOption(theme, label, description, activeTheme, onSelect) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pisi-theme-option';
    button.dataset.theme = theme;
    button.setAttribute('aria-pressed', theme === activeTheme ? 'true' : 'false');

    const preview = document.createElement('span');
    preview.className = `pisi-theme-preview ${theme}`;
    preview.setAttribute('aria-hidden', 'true');
    preview.append(
        document.createElement('span'),
        document.createElement('span'),
        document.createElement('span')
    );

    const copy = document.createElement('span');
    copy.className = 'pisi-theme-option-copy';
    const title = document.createElement('strong');
    title.textContent = label;
    const detail = document.createElement('span');
    detail.textContent = description;
    copy.append(title, detail);
    button.append(preview, copy);
    button.addEventListener('click', () => onSelect(theme));
    return button;
}

function renderPisiPreferencesPage(container) {
    const page = document.createElement('section');
    page.className = 'pisi-preferences-page';

    const heading = document.createElement('div');
    heading.className = 'pisi-preferences-heading';
    const title = document.createElement('h2');
    title.textContent = getPisiApplicationText('appearance');
    const description = document.createElement('p');
    description.textContent = getPisiApplicationText('appearanceDescription');
    heading.append(title, description);

    const options = document.createElement('div');
    options.className = 'pisi-theme-options';

    const syncThemeOptions = (activeTheme) => {
        options.querySelectorAll('.pisi-theme-option').forEach((button) => {
            button.setAttribute(
                'aria-pressed',
                button.dataset.theme === activeTheme ? 'true' : 'false'
            );
        });
    };

    const selectTheme = (theme) => {
        const activeTheme = setPisiThemePreference(theme);
        syncThemeOptions(activeTheme);
    };

    const activeTheme = getPisiThemePreference();
    options.append(
        makePisiThemeOption(
            'dark',
            getPisiApplicationText('dark'),
            getPisiApplicationText('darkDescription'),
            activeTheme,
            selectTheme
        ),
        makePisiThemeOption(
            'light',
            getPisiApplicationText('light'),
            getPisiApplicationText('lightDescription'),
            activeTheme,
            selectTheme
        )
    );

    page.append(heading, options);
    container.appendChild(page);
}

function registerPisiApplicationPages() {
    registerPisiCommandCenterPage({
        id: 'settings',
        label: () => getPisiApplicationText('settings'),
        order: 900,
        requiresProject: false,
        render: async () => {}
    });

    registerPisiCommandCenterPage({
        id: 'preferences',
        label: () => getPisiApplicationText('preferences'),
        order: 910,
        requiresProject: false,
        render: async (container) => renderPisiPreferencesPage(container)
    });
}

function initializePisiCommandCenter() {
    installPisiCommandCenterButton();

    if (!initializePisiCommandCenter.languageUnsubscribe) {
        initializePisiCommandCenter.languageUnsubscribe =
            window.pisiI18n?.onLanguageChanged?.(() => {
                if (!pisiCommandCenterState.overlay?.isConnected) return;
                renderPisiCommandCenterNavigation();
                pisiCommandCenterState.dialog?.setAttribute(
                    'aria-label',
                    pisiCommandTranslate('Pisi çalışma merkezi')
                );
                if (!pisiCommandCenterState.overlay?.hidden) {
                    renderPisiCommandCenterPage();
                }
            }) || null;
    }

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

registerPisiApplicationPages();
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
