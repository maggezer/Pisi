const PISI_BADGE_PICKER_SELECTOR = '.pisi-badge-picker';
const PISI_BADGE_PICKER_PORTAL_CLASS = 'pisi-badge-picker-portal';
const PISI_BADGE_PICKER_ANCHOR_ID = 'pisi-add-map-property-badge';
const PISI_BADGE_PICKER_VIEWPORT_PADDING = 8;
const PISI_BADGE_PICKER_GAP = 6;
const PISI_BADGE_PICKER_TOP_LAYER_Z_INDEX = 2147483000;

let pisiBadgePickerPortalObserver = null;

function ensurePisiBadgePickerPortalStyles() {
    if (document.querySelector('link[data-pisi-badge-picker-portal-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/map/pisi-map-property-badge-portal.css';
    link.dataset.pisiBadgePickerPortalStyle = '1';
    document.head.appendChild(link);
}

function getPisiBadgePickerAnchor() {
    return document.getElementById(PISI_BADGE_PICKER_ANCHOR_ID);
}

function getPisiBadgePickerPortal() {
    return document.querySelector(`body > ${PISI_BADGE_PICKER_SELECTOR}.${PISI_BADGE_PICKER_PORTAL_CLASS}`);
}

function syncPisiBadgePickerPortalLayer(picker = getPisiBadgePickerPortal()) {
    if (!picker) return false;

    let zIndex = PISI_BADGE_PICKER_TOP_LAYER_Z_INDEX;
    const commandCenterOverlay = document.getElementById('pisi-command-center-overlay');
    if (commandCenterOverlay?.isConnected) {
        const overlayZIndex = Number.parseInt(window.getComputedStyle(commandCenterOverlay).zIndex, 10);
        if (Number.isFinite(overlayZIndex)) {
            zIndex = Math.max(zIndex, overlayZIndex + 1);
        }
    }

    picker.style.zIndex = String(zIndex);
    return true;
}

function positionPisiBadgePickerPortal(picker = getPisiBadgePickerPortal()) {
    if (!picker || picker.hidden) return false;

    const anchor = getPisiBadgePickerAnchor();
    if (!anchor?.isConnected) {
        picker.hidden = true;
        return false;
    }

    syncPisiBadgePickerPortalLayer(picker);

    const viewportWidth = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
    const viewportHeight = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0);
    const padding = PISI_BADGE_PICKER_VIEWPORT_PADDING;
    const gap = PISI_BADGE_PICKER_GAP;
    const anchorRect = anchor.getBoundingClientRect();

    const availableWidth = Math.max(160, viewportWidth - padding * 2);
    const initialRect = picker.getBoundingClientRect();
    const pickerWidth = Math.min(initialRect.width || 270, availableWidth);
    picker.style.width = `${Math.round(pickerWidth)}px`;

    const pickerRect = picker.getBoundingClientRect();
    const left = Math.min(Math.max(padding, anchorRect.left), Math.max(padding, viewportWidth - pickerRect.width - padding));

    const belowTop = anchorRect.bottom + gap;
    const belowSpace = viewportHeight - belowTop - padding;
    const aboveSpace = anchorRect.top - gap - padding;
    let top = belowTop;

    if (pickerRect.height > belowSpace && aboveSpace > belowSpace) {
        top = anchorRect.top - gap - Math.min(pickerRect.height, aboveSpace);
    }

    top = Math.min(Math.max(padding, top), Math.max(padding, viewportHeight - pickerRect.height - padding));

    picker.style.left = `${Math.round(left)}px`;
    picker.style.top = `${Math.round(top)}px`;
    return true;
}

function portalizePisiBadgePicker(picker) {
    if (!(picker instanceof Element) || !picker.matches(PISI_BADGE_PICKER_SELECTOR)) return false;

    document.querySelectorAll(`body > ${PISI_BADGE_PICKER_SELECTOR}.${PISI_BADGE_PICKER_PORTAL_CLASS}`).forEach((existing) => {
        if (existing !== picker) existing.remove();
    });

    picker.classList.add(PISI_BADGE_PICKER_PORTAL_CLASS);
    if (picker.parentElement !== document.body) document.body.appendChild(picker);
    syncPisiBadgePickerPortalLayer(picker);
    if (!picker.hidden) requestAnimationFrame(() => positionPisiBadgePickerPortal(picker));
    return true;
}

function portalizePisiBadgePickersWithin(node) {
    if (!(node instanceof Element)) return;
    if (node.matches(PISI_BADGE_PICKER_SELECTOR)) portalizePisiBadgePicker(node);
    node.querySelectorAll?.(PISI_BADGE_PICKER_SELECTOR).forEach(portalizePisiBadgePicker);
}

function installPisiBadgePickerPortal() {
    ensurePisiBadgePickerPortalStyles();
    document.querySelectorAll(PISI_BADGE_PICKER_SELECTOR).forEach(portalizePisiBadgePicker);

    if (!pisiBadgePickerPortalObserver && document.body) {
        pisiBadgePickerPortalObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node instanceof Element) {
                            portalizePisiBadgePickersWithin(node);
                        }
                    });
                    continue;
                }
                if (
                    mutation.type === 'attributes' &&
                    mutation.attributeName === 'hidden' &&
                    mutation.target instanceof Element &&
                    mutation.target.matches(`${PISI_BADGE_PICKER_SELECTOR}.${PISI_BADGE_PICKER_PORTAL_CLASS}`) &&
                    !mutation.target.hidden
                ) {
                    const target = mutation.target;
                    requestAnimationFrame(() => {
                        positionPisiBadgePickerPortal(/** @type {Element} */ (target));
                    });
                }
            }
        });
        pisiBadgePickerPortalObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['hidden']
        });
    }

    document.addEventListener(
        'mousedown',
        (event) => {
            const picker = getPisiBadgePickerPortal();
            if (!picker || picker.hidden) return;
            const anchor = getPisiBadgePickerAnchor();
            const target = event.target instanceof Node ? event.target : null;
            if (target && (picker.contains(target) || anchor?.contains(target))) return;
            picker.hidden = true;
        },
        true
    );

    document.addEventListener(
        'scroll',
        () => {
            positionPisiBadgePickerPortal();
        },
        true
    );

    window.addEventListener('resize', () => {
        positionPisiBadgePickerPortal();
    });

    document.addEventListener(
        'keydown',
        (event) => {
            if (event.key !== 'Escape') return;
            const picker = getPisiBadgePickerPortal();
            if (picker && !picker.hidden) picker.hidden = true;
        },
        true
    );
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPisiBadgePickerPortal, { once: true });
} else {
    installPisiBadgePickerPortal();
}

export { getPisiBadgePickerPortal, installPisiBadgePickerPortal, portalizePisiBadgePicker, positionPisiBadgePickerPortal, syncPisiBadgePickerPortalLayer };
