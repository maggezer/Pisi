import { registerModule } from '../core/module-registry.mjs';
import { PISI_MAP_GRID_STEP, findPisiNearestMapRect, getPisiMapConnectedIds, getPisiMapTabTarget } from './pisi-map-align-core.mjs';
import { makePisiMapLayoutStep } from './pisi-map-history-core.mjs';

// Keyboard navigation on map nodes (docs/editor-keyboard-rules.md):
// arrows move focus and selection to the nearest node in that direction,
// Shift+arrows move the selection by one grid step (presses within 700 ms are
// one history step), Tab/Shift+Tab cycle through the nodes connected to the
// node where Tab navigation started, Mod+Enter starts or finishes a keyboard
// connection, Esc clears the selection. Enter, F2 and Delete stay on the node
// box itself. A polite live region announces focus and results.

const PISI_MAP_NUDGE_MERGE_MS = 700;
// History step label (PISI_MAP_STEP_LABELS in pisi-map-history-core.mjs).
const PISI_MAP_NUDGE_LABEL = 'nudge';
const PISI_MAP_ARROWS = Object.freeze({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' });
const pisiMapKeyboardState = { liveRegion: null, tabAnchor: null, nudge: null, connecting: false, initialized: false };

function pisiMapKeyboardTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function ensurePisiMapLiveRegion() {
    if (pisiMapKeyboardState.liveRegion?.isConnected) return pisiMapKeyboardState.liveRegion;
    const region = document.createElement('div');
    region.id = 'pisi-map-live-region';
    region.className = 'pisi-visually-hidden';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('role', 'status');
    document.body.appendChild(region);
    pisiMapKeyboardState.liveRegion = region;
    return region;
}

function announcePisiMap(message) {
    const region = ensurePisiMapLiveRegion();
    region.textContent = '';
    // A new text node is announced even when the message repeats.
    window.setTimeout(() => {
        region.textContent = String(message || '');
    }, 30);
}

function getPisiMapBoxTitle(box) {
    return box?.querySelector('.map-node-title-text')?.textContent?.trim() || pisiMapKeyboardTranslate('Adsız düğüm');
}

/** Connection count, read after the node's title (its aria-label) by screen readers. */
function describePisiMapBox(box) {
    const edges = Array.isArray(window.activeMapEdges) ? window.activeMapEdges : [];
    const count = getPisiMapConnectedIds(box.dataset.nodeId, edges).length;
    return pisiMapKeyboardTranslate('{count} bağlantı').replace('{count}', String(count));
}

function readRect(box) {
    return window.readPisiMapBoxRect?.(box) || { id: box.dataset.nodeId, x: 0, y: 0, width: 0, height: 0 };
}

function getVisiblePisiMapBoxes() {
    return /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll('#map-board .map-node-box[data-node-id]'))).filter(
        (box) => !box.hidden && box.offsetParent !== null
    );
}

function focusPisiMapBox(box, options = {}) {
    if (!box) return false;
    window.ensurePisiMapNodeMounted?.(box.dataset.nodeId);
    if (!options.keepSelection) {
        window.clearSelectedMapNodes?.();
        box.classList.add('selected');
    }
    box.focus({ preventScroll: false });
    box.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));
    return true;
}

// Navigation sees every node of the map, also those outside the viewport:
// the target is mounted and the camera follows it.
function getPisiMapNavigationRects() {
    const hidden = window.collectCollapsedHubNodeIds?.() || new Set();
    const rects = window.getPisiMapAllNodeRects?.() || getVisiblePisiMapBoxes().map(readRect);
    return rects.filter((rect) => !hidden.has(rect.id));
}

function focusPisiMapNodeById(id) {
    if (!id) return false;
    const box = window.revealPisiMapNode?.(id) || getVisiblePisiMapBoxes().find((item) => item.dataset.nodeId === id);
    return focusPisiMapBox(box);
}

function moveFocusToNeighbour(box, direction) {
    const targetId = findPisiNearestMapRect(readRect(box), getPisiMapNavigationRects(), direction);
    if (!targetId) return false;
    pisiMapKeyboardState.tabAnchor = null;
    return focusPisiMapNodeById(targetId);
}

function moveFocusAlongConnections(box, backwards) {
    const rects = getPisiMapNavigationRects();
    const remembered = pisiMapKeyboardState.tabAnchor;
    const anchor = remembered && rects.some((rect) => rect.id === remembered) ? remembered : box.dataset.nodeId;
    pisiMapKeyboardState.tabAnchor = anchor;
    const edges = Array.isArray(window.activeMapEdges) ? window.activeMapEdges : [];
    return focusPisiMapNodeById(getPisiMapTabTarget(anchor, box.dataset.nodeId, rects, edges, backwards));
}

function flushPisiMapNudge() {
    const nudge = pisiMapKeyboardState.nudge;
    if (!nudge) return;
    clearTimeout(nudge.timer);
    pisiMapKeyboardState.nudge = null;
    const after = nudge.boxes.filter((box) => box.isConnected).map(readRect);
    const step = makePisiMapLayoutStep(nudge.mapPath, nudge.before, after);
    if (step) window.recordPisiMapStep?.({ ...step, label: PISI_MAP_NUDGE_LABEL });
    window.saveCurrentMapLayout?.();
}

function nudgePisiMapSelection(box, direction) {
    const selected = window.getSelectedMapNodeBoxes?.() || [];
    const boxes = selected.includes(box) ? selected : [box];
    const ids = boxes
        .map((item) => item.dataset.nodeId)
        .sort()
        .join('|');
    let nudge = pisiMapKeyboardState.nudge;
    if (nudge && (nudge.ids !== ids || nudge.mapPath !== window.activeMapPath)) {
        flushPisiMapNudge();
        nudge = null;
    }
    if (!nudge) {
        nudge = { ids, boxes, mapPath: window.activeMapPath, before: boxes.map(readRect), timer: 0 };
        pisiMapKeyboardState.nudge = nudge;
    }
    const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
    for (const item of boxes) {
        item.style.left = `${parseFloat(item.style.left || '0') + delta[0] * PISI_MAP_GRID_STEP}px`;
        item.style.top = `${parseFloat(item.style.top || '0') + delta[1] * PISI_MAP_GRID_STEP}px`;
    }
    window.scheduleDrawPisiMapConnectionsForNodes?.(boxes.map((item) => item.dataset.nodeId));
    window.markPisiMapViewportDirty?.();
    clearTimeout(nudge.timer);
    nudge.timer = window.setTimeout(flushPisiMapNudge, PISI_MAP_NUDGE_MERGE_MS);
    return true;
}

function togglePisiMapKeyboardConnection(box) {
    const source = !pisiMapKeyboardState.connecting;
    const port = box.querySelector(source ? '.map-port.bottom' : '.map-port.top');
    if (!port || port.hidden) return false;
    // The port keydown handler (pisi-map-edges.mjs) owns the connection flow.
    port.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    pisiMapKeyboardState.connecting = source;
    announcePisiMap(pisiMapKeyboardTranslate(source ? 'Bağlantı başladı: hedef düğümde Mod+Enter' : 'Bağlantı tamamlandı'));
    return true;
}

function handlePisiMapKeyboard(event) {
    const box = event.target?.closest?.('#map-board .map-node-box');
    if (!box || event.target !== box || event.defaultPrevented || event.isComposing) return;
    const direction = PISI_MAP_ARROWS[event.key];
    const mod = event.ctrlKey || event.metaKey;
    let handled = false;
    if (direction && !mod && !event.altKey) {
        handled = event.shiftKey ? nudgePisiMapSelection(box, direction) : moveFocusToNeighbour(box, direction);
    } else if (event.key === 'Tab' && !mod && !event.altKey) {
        handled = moveFocusAlongConnections(box, event.shiftKey);
    } else if (event.key === 'Enter' && mod) {
        handled = togglePisiMapKeyboardConnection(box);
    } else if (event.key === 'Escape') {
        window.clearSelectedMapNodes?.();
        pisiMapKeyboardState.tabAnchor = null;
        handled = true;
    }
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
}

function handlePisiMapFocus(event) {
    const box = event.target?.closest?.('#map-board .map-node-box');
    if (!box || event.target !== box) return;
    // aria-label keeps the title (and task counts from pisi-map-operational-render.mjs).
    if (!box.getAttribute('aria-label')) box.setAttribute('aria-label', getPisiMapBoxTitle(box));
    box.setAttribute('aria-description', describePisiMapBox(box));
}

function initializePisiMapKeyboard() {
    if (pisiMapKeyboardState.initialized) return false;
    pisiMapKeyboardState.initialized = true;
    ensurePisiMapLiveRegion();
    document.addEventListener('keydown', handlePisiMapKeyboard);
    document.addEventListener('focusin', handlePisiMapFocus);
    return true;
}

const moduleApi = {
    pisiMapKeyboardState,
    announcePisiMap,
    focusPisiMapBox,
    flushPisiMapNudge,
    initializePisiMapKeyboard
};

registerModule('map.keyboard', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiMapKeyboard, { once: true });
} else {
    initializePisiMapKeyboard();
}

export { announcePisiMap, flushPisiMapNudge, focusPisiMapBox, initializePisiMapKeyboard, pisiMapKeyboardState };
