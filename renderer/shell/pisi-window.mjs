import { registerModule } from "../core/module-registry.mjs";

function setupWindowControls() {
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

function bindRightPanelTabs() {
    const tabButtons = Array.from(document.querySelectorAll('.right-panel-tab'));
    const tabPages = Array.from(document.querySelectorAll('.right-tab-page'));

    if (!tabButtons.length || !tabPages.length) return;

    for (const button of tabButtons) {
        if (button.dataset.bound === '1') continue;
        button.dataset.bound = '1';

        button.addEventListener('click', async () => {
    const target = button.dataset.rightTab;

    tabButtons.forEach((item) => {
        item.classList.toggle('active', item === button);
    });

    tabPages.forEach((page) => {
        page.classList.toggle(
            'active',
            page.id === `right-tab-${target}`
        );
    });

    const rightPanelContent = document.getElementById('right-panel-content');

    if (rightPanelContent) {
        rightPanelContent.scrollTop = 0;
    }

    const activePage = document.getElementById(`right-tab-${target}`);

    if (activePage) {
        activePage.scrollTop = 0;
    }

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
        const rightPanelContent = document.getElementById('right-panel-content');
        const tagsPage = document.getElementById('right-tab-tags');

        if (rightPanelContent) {
            rightPanelContent.scrollTop = 0;
        }

        if (tagsPage) {
            tagsPage.scrollTop = 0;
        }
    };

    resetRightPanelScroll();
    requestAnimationFrame(resetRightPanelScroll);
    setTimeout(resetRightPanelScroll, 50);
}
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
