import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getPisiMapConnectionMetrics,
    getPisiMapSemanticZoomMode,
    normalizePisiMapRenderZoom,
    PISI_MAP_CONNECTION_BASE_METRICS
} from '../renderer/map/pisi-map-zoom-core.mjs';

test('semantic zoom yakın, orta ve uzak görünümü kararlı eşiklerle seçer', () => {
    assert.equal(getPisiMapSemanticZoomMode(1), 'near');
    assert.equal(getPisiMapSemanticZoomMode(0.77), 'medium');
    assert.equal(getPisiMapSemanticZoomMode(0.47), 'far');
});

test('zoom out bağlantı çizgisi, ok boşluğu ve eğri ölçülerini birlikte küçültür', () => {
    const metrics = getPisiMapConnectionMetrics(0.1);

    assert.equal(metrics.zoom, 0.1);
    assert.equal(metrics.edgeStrokeWidth, 0.25);
    assert.ok(Math.abs(metrics.arrowGap - 2.4) < Number.EPSILON * 4);
    assert.equal(metrics.connectionControlMin, 6);
    assert.equal(metrics.connectionControlMax, 19);
});

test('zoom in bağlantı ve ok ölçülerini node ölçeğiyle aynı oranda büyütür', () => {
    const metrics = getPisiMapConnectionMetrics(3);

    assert.equal(
        metrics.edgeStrokeWidth,
        PISI_MAP_CONNECTION_BASE_METRICS.edgeStrokeWidth * 3
    );
    assert.equal(
        metrics.arrowGap,
        PISI_MAP_CONNECTION_BASE_METRICS.arrowGap * 3
    );
    assert.equal(
        metrics.tempEndpointOffset,
        PISI_MAP_CONNECTION_BASE_METRICS.tempEndpointOffset * 3
    );
});

test('geçersiz kamera zoom değeri güvenli biçimde 1 kabul edilir', () => {
    assert.equal(normalizePisiMapRenderZoom(0), 1);
    assert.equal(normalizePisiMapRenderZoom(Number.NaN), 1);
    assert.deepEqual(
        getPisiMapConnectionMetrics(undefined),
        {
            zoom: 1,
            ...PISI_MAP_CONNECTION_BASE_METRICS
        }
    );
});
