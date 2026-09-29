import { registerModule } from "../core/module-registry.mjs";

const PISI_APP_MENU_LABELS = {
    tr: {
        menu: 'Pisi menüsü',
        settings: 'Ayarlar',
        preferences: 'Tercihler',
        import: 'İçe aktar',
        export: 'Dışa aktar',
        guide: 'Kullanma Kılavuzu',
        feedback: 'Geri Bildirim',
        quit: 'Kapat'
    },
    eng: {
        menu: 'Pisi menu',
        settings: 'Settings',
        preferences: 'Preferences',
        import: 'Import',
        export: 'Export',
        guide: 'User Guide',
        feedback: 'Feedback',
        quit: 'Quit'
    }
};

function getPisiAppMenuLabels() {
    const language = window.pisiI18n?.getLanguage?.() === 'eng' ? 'eng' : 'tr';
    return PISI_APP_MENU_LABELS[language];
}

function closePisiAppMenu() {
    const button = document.getElementById('pisi-app-menu-button');
    const menu = document.getElementById('pisi-app-menu-dropdown');

    if (!button || !menu) return;

    button.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
}

function setPisiAppMenuOpen(open) {
    const button = document.getElementById('pisi-app-menu-button');
    const menu = document.getElementById('pisi-app-menu-dropdown');

    if (!button || !menu) return;

    const shouldOpen = Boolean(open);
    button.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    menu.hidden = !shouldOpen;

    if (shouldOpen) {
        menu.querySelector('.pisi-app-menu-item')?.focus();
    }
}

function handlePisiAppMenuAction(action) {
    closePisiAppMenu();

    if (action === 'settings' || action === 'preferences') {
        window.openPisiCommandCenter?.(action);
        return;
    }

    if (action === 'import' || action === 'export') {
        document.dispatchEvent(new CustomEvent('pisi:portability-action', {
            detail: { action, source: 'app-menu' }
        }));
        return;
    }

    if (action === 'quit') {
        window.electronWindow?.close();
        return;
    }

    if (action === 'guide') {
        window.dispatchEvent(new CustomEvent('pisi:open-user-guide'));
        return;
    }

    if (action === 'feedback') {
        window.dispatchEvent(new CustomEvent('pisi:open-feedback'));
    }
}

function syncPisiAppMenuLabels() {
    const labels = getPisiAppMenuLabels();
    const button = document.getElementById('pisi-app-menu-button');

    if (button) {
        button.title = labels.menu;
        button.setAttribute('aria-label', labels.menu);
    }

    document.querySelectorAll('[data-pisi-app-menu-action]').forEach((item) => {
        const action = item.dataset.pisiAppMenuAction;
        if (labels[action]) item.textContent = labels[action];
    });
}

function setupPisiAppMenu() {
    const title = document.getElementById('window-title');
    const logo = document.getElementById('window-logo');

    if (!title || !logo) return;

    let host = document.getElementById('pisi-app-menu');

    if (!host) {
        host = document.createElement('div');
        host.id = 'pisi-app-menu';

        const button = document.createElement('button');
        button.id = 'pisi-app-menu-button';
        button.type = 'button';
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        button.appendChild(logo);

        const menu = document.createElement('div');
        menu.id = 'pisi-app-menu-dropdown';
        menu.setAttribute('role', 'menu');
        menu.hidden = true;

        for (const action of [
            'settings',
            'preferences',
            'import',
            'export',
            'guide',
            'feedback',
            'quit'
        ]) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'pisi-app-menu-item';
            item.dataset.pisiAppMenuAction = action;
            item.setAttribute('role', 'menuitem');
            item.addEventListener('click', () => handlePisiAppMenuAction(action));
            menu.appendChild(item);
        }

        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setPisiAppMenuOpen(menu.hidden);
        });

        host.append(button, menu);
        title.prepend(host);
    }

    syncPisiAppMenuLabels();

    if (host.dataset.bound !== '1') {
        host.dataset.bound = '1';

        document.addEventListener('pointerdown', (event) => {
            const target = event.target instanceof Node ? event.target : null;
            if (!target || !host.contains(target)) closePisiAppMenu();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            const menu = document.getElementById('pisi-app-menu-dropdown');
            if (menu?.hidden !== false) return;

            event.preventDefault();
            closePisiAppMenu();
            document.getElementById('pisi-app-menu-button')?.focus();
        });

        window.addEventListener('blur', closePisiAppMenu);
    }

    if (!setupPisiAppMenu.languageUnsubscribe) {
        setupPisiAppMenu.languageUnsubscribe =
            window.pisiI18n?.onLanguageChanged?.(() => {
                syncPisiAppMenuLabels();
            }) || null;
    }
}

function setupWindowControls() {
    setupPisiAppMenu();

    const minBtn = document.getElementById('win-min');
    const maxBtn = document.getElementById('win-max');
    const closeBtn = document.getElementById('win-close');
    const maxIcon = document.getElementById('win-max-icon');

    function setMaximizedIcon(isMaximized) {
        if (!maxIcon) return;

        maxIcon.src = isMaximized
            ? 'assets/win-restore.png'
            : 'assets/win-max.png';

        maxIcon.alt = isMaximized ? 'Geri Al' : 'Büyüt';

        if (maxBtn) {
            maxBtn.title = isMaximized ? 'Geri Al' : 'Büyüt';
        }
    }

    minBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.electronWindow?.minimize();
    });

    maxBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.electronWindow?.toggleMaximize();
    });

    closeBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.electronWindow?.close();
    });

    window.electronWindow?.onMaximized?.(() => {
        setMaximizedIcon(true);
    });

    window.electronWindow?.onUnmaximized?.(() => {
        setMaximizedIcon(false);
    });

    window.electronWindow?.isMaximized?.().then((isMaximized) => {
        setMaximizedIcon(Boolean(isMaximized));
    });

    if (!setupWindowControls.closeUnsubscribe) {
        setupWindowControls.closeUnsubscribe =
            window.electronWindow?.onCloseRequested?.(async () => {
                if (typeof flushPisiPendingSaves !== 'function') {
                    return true;
                }

                const saved = await flushPisiPendingSaves();
                if (!saved) {
                    alert(
                        'PISI kapatılmadı: bekleyen değişikliklerden en az biri kaydedilemedi.'
                    );
                }
                return saved;
            }) || null;
    }
}

async function activatePisiRightPanelTab(button) {
    const target = button?.dataset.rightTab;
    if (
        !target ||
        button.disabled ||
        button.getAttribute('aria-disabled') === 'true'
    ) {
        return false;
    }

    document.querySelectorAll('.right-panel-tab[data-right-tab]')
        .forEach((item) => {
            const selected = item === button;
            item.classList.toggle('active', selected);
            item.setAttribute('aria-selected', selected ? 'true' : 'false');
        });

    document.querySelectorAll('.right-tab-page').forEach((page) => {
        page.classList.toggle(
            'active',
            page.id === `right-tab-${target}`
        );
    });

    const rightPanelContent = document.getElementById('right-panel-content');
    const activePage = document.getElementById(`right-tab-${target}`);

    if (rightPanelContent) rightPanelContent.scrollTop = 0;
    if (activePage) activePage.scrollTop = 0;

    if (target === 'missions') {
        if (typeof window.refreshPisiMissionIndex === 'function') {
            await window.refreshPisiMissionIndex({
                force: true,
                reason: 'right-panel-open'
            });
        } else if (typeof window.refreshPisiTagsPanel === 'function') {
            await window.refreshPisiTagsPanel();
        }
    } else if (
        target === 'tags' &&
        typeof window.refreshPisiTagsPanel === 'function'
    ) {
        await window.refreshPisiTagsPanel();
    }

    if (target === 'tags') {
        const resetRightPanelScroll = () => {
            const content = document.getElementById('right-panel-content');
            const tagsPage = document.getElementById('right-tab-tags');
            if (content) content.scrollTop = 0;
            if (tagsPage) tagsPage.scrollTop = 0;
        };
        resetRightPanelScroll();
        requestAnimationFrame(resetRightPanelScroll);
        setTimeout(resetRightPanelScroll, 50);
    }
    return Boolean(activePage);
}

function bindRightPanelTabs() {
    const tabButtons = Array.from(document.querySelectorAll(
        '.right-panel-tab[data-right-tab]'
    ));
    if (!tabButtons.length || !document.querySelector('.right-tab-page')) return;

    for (const button of tabButtons) {
        button.setAttribute('role', 'tab');
        button.setAttribute(
            'aria-selected',
            button.classList.contains('active') ? 'true' : 'false'
        );
        if (button.dataset.bound === '1') continue;
        button.dataset.bound = '1';
        button.addEventListener('click', () => {
            void activatePisiRightPanelTab(button);
        });
    }
}

function setupCenterFileTabs() {
    const toolbar = document.getElementById('center-toolbar');
    if (!toolbar) return;

    let tabsEl = document.getElementById('center-tabs');

    if (!tabsEl) {
        toolbar.innerHTML = '<div id="center-tabs" class="center-tabs"></div>';
        tabsEl = document.getElementById('center-tabs');
    }

    if (tabsEl.dataset.bound === '1') {
        renderPisiOpenTabs();
        return;
    }

    tabsEl.dataset.bound = '1';

    tabsEl.addEventListener('wheel', (event) => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            tabsEl.scrollLeft += event.deltaY;
        }
    });

    renderPisiOpenTabs();
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "setupPisiAppMenu": {
        enumerable: true,
        get() { return setupPisiAppMenu; }
    },
    "setupWindowControls": {
        enumerable: true,
        get() { return setupWindowControls; }
    },
    "bindRightPanelTabs": {
        enumerable: true,
        get() { return bindRightPanelTabs; }
    },
    "setupCenterFileTabs": {
        enumerable: true,
        get() { return setupCenterFileTabs; }
    }
});
registerModule("shell.window", moduleApi);
