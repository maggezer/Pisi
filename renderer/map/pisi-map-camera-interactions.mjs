import { syncMapConnectionZoomStyles } from './pisi-map-connection-interactions.mjs';
import { getCollapsedHubPortSet } from './pisi-map-hub-interactions.mjs';

export function applyMapCamera() {
    const board = document.getElementById('map-board');
    const canvas = document.getElementById('map-canvas');

    if (!board) return;

    board.style.transform = `translate(${activeMapCamera.x}px, ${activeMapCamera.y}px) scale(${activeMapCamera.zoom})`;

    if (canvas) {
        canvas.style.backgroundPosition = `${activeMapCamera.x}px ${activeMapCamera.y}px`;
    }

    syncMapConnectionZoomStyles();
    scheduleDrawMapConnections();
}

export function clampMapZoom(zoom) {
    return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, zoom));
}

export function zoomMapAtClientPoint(clientX, clientY, direction) {
    const canvas = document.getElementById('map-canvas');

    if (!canvas || !activeMapPath) return;

    const rect = canvas.getBoundingClientRect();

    const oldZoom = activeMapCamera.zoom || 1;
    const zoomFactor = direction > 0 ? MAP_ZOOM_STEP : 1 / MAP_ZOOM_STEP;

    const newZoom = clampMapZoom(oldZoom * zoomFactor);

    if (newZoom === oldZoom) {
        return;
    }

    // Mouse'un işaret ettiği canvas noktasını dünya koordinatına çeviriyoruz.
    const worldX = (clientX - rect.left - activeMapCamera.x) / oldZoom;
    const worldY = (clientY - rect.top - activeMapCamera.y) / oldZoom;

    activeMapCamera.zoom = newZoom;

    // Zoom sonrası aynı dünya noktası mouse altında kalsın diye kamerayı kaydırıyoruz.
    activeMapCamera.x = clientX - rect.left - worldX * newZoom;
    activeMapCamera.y = clientY - rect.top - worldY * newZoom;

    applyMapCamera();
    saveActiveMapCameraSoon();
}

export function zoomMapFromCenter(direction) {
    const canvas = document.getElementById('map-canvas');

    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    zoomMapAtClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, direction);
}

export function saveActiveMapCameraSoon() {
    if (!activeMapPath) return;

    clearTimeout(mapCameraSaveTimer);
    const mapPath = activeMapPath;
    const camera = {
        ...activeMapCamera,
        collapsedHubs: Array.from(getCollapsedHubPortSet())
    };

    mapCameraSaveTimer = setTimeout(async () => {
        mapCameraSaveTimer = null;
        window.pisiProject?.saveMapCamera?.(mapPath, camera);
    }, 350);
}

export function scheduleMapCameraSave() {
    saveActiveMapCameraSoon();
}

export async function flushActiveMapCameraSave() {
    clearTimeout(mapCameraSaveTimer);
    mapCameraSaveTimer = null;

    if (!activeMapPath) return true;

    try {
        const result = await window.pisiProject?.saveMapCamera?.(activeMapPath, {
            ...activeMapCamera,
            collapsedHubs: Array.from(getCollapsedHubPortSet())
        });

        return Boolean(result?.ok);
    } catch (error) {
        console.error('[PISI] Map kamerası kaydedilemedi:', error);
        return false;
    }
}

export function bindMapZoomEvents() {
    if (mapZoomEventsBound) return;

    const canvas = document.getElementById('map-canvas');

    if (!canvas) return;

    mapZoomEventsBound = true;

    canvas.addEventListener(
        'wheel',
        (event) => {
            if (!activeMapPath) return;

            event.preventDefault();
            event.stopPropagation();

            const direction = event.deltaY < 0 ? 1 : -1;

            zoomMapAtClientPoint(event.clientX, event.clientY, direction);
        },
        { passive: false }
    );
}

export function bindMapZoomControls() {
    if (mapZoomControlsBound) return;

    const zoomInBtn = document.getElementById('map-zoom-in');
    const zoomOutBtn = document.getElementById('map-zoom-out');

    bindHoldZoomButton(zoomInBtn, 1);
    bindHoldZoomButton(zoomOutBtn, -1);

    mapZoomControlsBound = true;
}

export function bindHoldZoomButton(button, direction) {
    if (!button) return;

    let holdTimer = null;

    const stopHolding = () => {
        if (holdTimer) {
            clearInterval(holdTimer);
            holdTimer = null;
        }
    };

    button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();

        // İlk basışta hemen %10 değiştir.
        zoomMapFromCenter(direction);

        // Basılı tutulursa her 0.5 saniyede bir %10 devam et.
        stopHolding();

        holdTimer = setInterval(() => {
            zoomMapFromCenter(direction);
        }, MAP_ZOOM_HOLD_INTERVAL);
    });

    button.addEventListener('mouseup', stopHolding);
    button.addEventListener('mouseleave', stopHolding);

    window.addEventListener('mouseup', stopHolding);

    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });
}
