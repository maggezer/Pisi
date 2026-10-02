import { registerModule } from '../core/module-registry.mjs';

let centerDividerObserver = null;
let centerDividerResizeObserver = null;
let centerDividerFrame = null;

function updatePisiCenterTabDivider() {
    const toolbar = document.getElementById('center-toolbar');
    const tabs = document.getElementById('center-tabs');
    if (!toolbar || !tabs) return 0;

    const openTabs = Array.from(tabs.querySelectorAll('.center-tab')).filter((tab) => !tab.hidden && tab.getClientRects().length > 0);
    const lastTab = openTabs.at(-1) || null;

    if (!lastTab) {
        toolbar.style.setProperty('--pisi-center-divider-width', '0px');
        return 0;
    }

    const toolbarRect = toolbar.getBoundingClientRect();
    const lastTabRect = lastTab.getBoundingClientRect();
    const tabsStyle = getComputedStyle(tabs);
    const trailingGap = Math.max(0, Number.parseFloat(tabsStyle.paddingLeft) || 0);
    const width = Math.max(0, Math.min(toolbar.clientWidth, lastTabRect.right - toolbarRect.left + trailingGap));

    toolbar.style.setProperty('--pisi-center-divider-width', `${Math.ceil(width)}px`);
    return width;
}

function schedulePisiCenterTabDividerUpdate() {
    if (centerDividerFrame !== null) return;
    centerDividerFrame = requestAnimationFrame(() => {
        centerDividerFrame = null;
        updatePisiCenterTabDivider();
    });
}

function bindPisiCenterTabDivider() {
    const toolbar = document.getElementById('center-toolbar');
    const tabs = document.getElementById('center-tabs');
    if (!toolbar || !tabs) return false;

    schedulePisiCenterTabDividerUpdate();

    if (!centerDividerObserver) {
        centerDividerObserver = new MutationObserver(schedulePisiCenterTabDividerUpdate);
        centerDividerObserver.observe(tabs, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'hidden']
        });
    }

    if (!centerDividerResizeObserver && typeof ResizeObserver === 'function') {
        centerDividerResizeObserver = new ResizeObserver(schedulePisiCenterTabDividerUpdate);
        centerDividerResizeObserver.observe(toolbar);
        centerDividerResizeObserver.observe(tabs);
    }

    window.addEventListener('resize', schedulePisiCenterTabDividerUpdate);
    tabs.addEventListener('scroll', schedulePisiCenterTabDividerUpdate, {
        passive: true
    });
    return true;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPisiCenterTabDivider, {
        once: true
    });
} else {
    bindPisiCenterTabDivider();
}

registerModule('shell.centerTabDivider', {
    bindPisiCenterTabDivider,
    schedulePisiCenterTabDividerUpdate,
    updatePisiCenterTabDivider
});

export { bindPisiCenterTabDivider, schedulePisiCenterTabDividerUpdate, updatePisiCenterTabDivider };
