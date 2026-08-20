const PISI_MAP_EDGE_KEEP_SELECTION_SELECTOR = [
    '.map-edge-group[data-edge-id]',
    '.pisi-map-edge-menu',
    '#right-tab-customize',
    '[data-right-tab="customize"]'
].join(', ');

function shouldKeepPisiMapEdgeSelection(target) {
    return Boolean(
        target &&
        typeof target.closest === 'function' &&
        target.closest(PISI_MAP_EDGE_KEEP_SELECTION_SELECTOR)
    );
}

function blurFocusedPisiMapEdge() {
    const activeElement = document.activeElement;
    if (
        !activeElement ||
        typeof activeElement.closest !== 'function' ||
        !activeElement.closest('.map-edge-group[data-edge-id]')
    ) {
        return false;
    }

    activeElement.blur?.();
    return true;
}

function clearPisiMapEdgeSelectionFromOutsideClick() {
    const selectedGroups = Array.from(
        document.querySelectorAll('.map-edge-group.selected')
    );
    const hadSelection = Boolean(window.selectedMapEdgeId) || selectedGroups.length > 0;
    const focusCleared = blurFocusedPisiMapEdge();

    window.selectedMapEdgeId = null;
    selectedGroups.forEach((group) => {
        group.classList.remove('selected');
    });

    if (hadSelection) {
        document.dispatchEvent(new CustomEvent(
            'pisi:map-customization-context-changed'
        ));
    }

    return hadSelection || focusCleared;
}

function handlePisiMapEdgeOutsideMouseDown(event) {
    if (shouldKeepPisiMapEdgeSelection(event.target)) return;
    clearPisiMapEdgeSelectionFromOutsideClick();
}

document.addEventListener(
    'mousedown',
    handlePisiMapEdgeOutsideMouseDown,
    true
);

export {};
