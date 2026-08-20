const PISI_MAP_EDGE_KEEP_SELECTION_SELECTOR = [
    '.map-edge-group[data-edge-id]',
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

function clearPisiMapEdgeSelectionFromOutsideClick() {
    if (!window.selectedMapEdgeId) return false;

    window.selectedMapEdgeId = null;
    document.querySelectorAll('.map-edge-group.selected').forEach((group) => {
        group.classList.remove('selected');
    });
    document.dispatchEvent(new CustomEvent(
        'pisi:map-customization-context-changed'
    ));
    return true;
}

function handlePisiMapEdgeOutsideMouseDown(event) {
    if (!window.selectedMapEdgeId) return;
    if (shouldKeepPisiMapEdgeSelection(event.target)) return;
    clearPisiMapEdgeSelectionFromOutsideClick();
}

document.addEventListener(
    'mousedown',
    handlePisiMapEdgeOutsideMouseDown,
    true
);

export {};
