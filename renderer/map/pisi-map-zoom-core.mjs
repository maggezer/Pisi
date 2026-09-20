const PISI_MAP_CONNECTION_BASE_METRICS = Object.freeze({
    plainLineGap: 6,
    arrowGap: 24,
    tempEndpointOffset: 14,
    connectionControlMin: 60,
    connectionControlMax: 190,
    tempControlMin: 60,
    tempControlMax: 170,
    edgeStrokeWidth: 2.5,
    edgeHoverStrokeWidth: 4,
    tempEdgeStrokeWidth: 2
});

function normalizePisiMapRenderZoom(value) {
    const zoom = Number(value);
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function getPisiMapSemanticZoomMode(value) {
    const zoom = normalizePisiMapRenderZoom(value);
    if (zoom < 0.48) return 'far';
    if (zoom < 0.78) return 'medium';
    return 'near';
}

function getPisiMapConnectionMetrics(zoomValue) {
    const zoom = normalizePisiMapRenderZoom(zoomValue);
    const metrics = { zoom };

    for (const [name, value] of Object.entries(PISI_MAP_CONNECTION_BASE_METRICS)) {
        metrics[name] = value * zoom;
    }

    return metrics;
}

export {
    getPisiMapConnectionMetrics,
    getPisiMapSemanticZoomMode,
    normalizePisiMapRenderZoom,
    PISI_MAP_CONNECTION_BASE_METRICS
};
