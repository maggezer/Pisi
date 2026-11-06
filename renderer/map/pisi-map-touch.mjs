import { registerModule } from '../core/module-registry.mjs';

// Touch on the map through pointer events. One finger keeps the existing
// behaviour (Chromium sends compatibility mouse events: pan on the canvas,
// drag on a node). Two fingers pinch-zoom around their midpoint and pan; the
// camera is saved like any other camera move and never enters the history.
// A long press (500 ms within 8 px) opens the context menu at that point.

const PISI_MAP_LONG_PRESS_MS = 500;
const PISI_MAP_LONG_PRESS_TOLERANCE = 8;
const pisiMapTouchState = { pointers: new Map(), pinch: null, longPress: null, initialized: false };

function getPisiTouchCanvas() {
    return document.getElementById('map-canvas');
}

function cancelPisiMapLongPress() {
    if (pisiMapTouchState.longPress) clearTimeout(pisiMapTouchState.longPress.timer);
    pisiMapTouchState.longPress = null;
}

function startPisiMapLongPress(event) {
    cancelPisiMapLongPress();
    const target = event.target;
    const start = { x: event.clientX, y: event.clientY };
    pisiMapTouchState.longPress = {
        start,
        timer: window.setTimeout(() => {
            pisiMapTouchState.longPress = null;
            // End the compatibility mouse drag or pan before the menu opens.
            window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y }));
            const menuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: start.x, clientY: start.y });
            Object.defineProperty(menuEvent, 'pisiLongPress', { value: true });
            target.dispatchEvent(menuEvent);
        }, PISI_MAP_LONG_PRESS_MS)
    };
}

function getPinchGeometry() {
    const [a, b] = Array.from(pisiMapTouchState.pointers.values());
    return { midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
}

function startPisiMapPinch() {
    cancelPisiMapLongPress();
    const camera = window.activeMapCamera;
    if (!camera) return;
    // Stop the one-finger pan or drag the first finger started.
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    pisiMapTouchState.pinch = { ...getPinchGeometry(), camera: { x: camera.x, y: camera.y, zoom: camera.zoom || 1 } };
}

function updatePisiMapPinch() {
    const pinch = pisiMapTouchState.pinch;
    const canvas = getPisiTouchCanvas();
    const camera = window.activeMapCamera;
    if (!pinch || !canvas || !camera) return;
    const rect = canvas.getBoundingClientRect();
    const now = getPinchGeometry();
    const clamp = typeof window.clampMapZoom === 'function' ? window.clampMapZoom : (value) => Math.min(3, Math.max(0.2, value));
    const zoom = clamp(pinch.camera.zoom * (now.distance / pinch.distance));
    // The world point under the starting midpoint stays under the moving midpoint.
    const worldX = (pinch.midX - rect.left - pinch.camera.x) / pinch.camera.zoom;
    const worldY = (pinch.midY - rect.top - pinch.camera.y) / pinch.camera.zoom;
    camera.zoom = zoom;
    camera.x = now.midX - rect.left - worldX * zoom;
    camera.y = now.midY - rect.top - worldY * zoom;
    window.applyMapCamera?.();
}

function handlePisiMapPointerDown(event) {
    if (event.pointerType !== 'touch' || !window.activeMapPath) return;
    pisiMapTouchState.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pisiMapTouchState.pointers.size === 2) startPisiMapPinch();
    else if (pisiMapTouchState.pointers.size === 1) startPisiMapLongPress(event);
    else cancelPisiMapLongPress();
}

function handlePisiMapPointerMove(event) {
    if (event.pointerType !== 'touch' || !pisiMapTouchState.pointers.has(event.pointerId)) return;
    pisiMapTouchState.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const press = pisiMapTouchState.longPress;
    if (press && Math.hypot(event.clientX - press.start.x, event.clientY - press.start.y) > PISI_MAP_LONG_PRESS_TOLERANCE) cancelPisiMapLongPress();
    if (pisiMapTouchState.pinch && pisiMapTouchState.pointers.size >= 2) {
        event.preventDefault();
        updatePisiMapPinch();
    }
}

function handlePisiMapPointerEnd(event) {
    if (event.pointerType !== 'touch') return;
    pisiMapTouchState.pointers.delete(event.pointerId);
    cancelPisiMapLongPress();
    if (pisiMapTouchState.pinch && pisiMapTouchState.pointers.size < 2) {
        pisiMapTouchState.pinch = null;
        window.scheduleMapCameraSave?.();
    }
}

function initializePisiMapTouch() {
    if (pisiMapTouchState.initialized) return false;
    const canvas = getPisiTouchCanvas();
    if (!canvas) return false;
    pisiMapTouchState.initialized = true;
    canvas.addEventListener('pointerdown', handlePisiMapPointerDown);
    canvas.addEventListener('pointermove', handlePisiMapPointerMove, { passive: false });
    for (const name of ['pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(name, handlePisiMapPointerEnd);
    return true;
}

const moduleApi = { pisiMapTouchState, initializePisiMapTouch };

registerModule('map.touch', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiMapTouch, { once: true });
} else {
    initializePisiMapTouch();
}

export { initializePisiMapTouch, pisiMapTouchState };
