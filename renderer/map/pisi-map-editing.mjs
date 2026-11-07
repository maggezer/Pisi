import { registerModule } from '../core/module-registry.mjs';
import { registerPisiCommand } from '../core/pisi-command-registry.mjs';
import {
    PISI_MAP_GRID_STEP,
    PISI_MAP_SNAP_THRESHOLD,
    alignPisiMapRects,
    distributePisiMapRects,
    findPisiMapSnapGuides,
    snapPisiMapValueToGrid
} from './pisi-map-align-core.mjs';
import { layoutPisiMapAll, layoutPisiMapSubtree } from './pisi-map-auto-layout-core.mjs';
import { makePisiMapLayoutStep } from './pisi-map-history-core.mjs';

// Map layout editing: align, distribute, tree auto layout, snap guides and an
// optional grid while dragging, and the node/canvas context menu that offers
// these actions together with copy and paste (pisi-map-clipboard.mjs). Every
// action is saved through map.layout.save.v1 and recorded as one history step.

const PISI_MAP_GRID_STORAGE_KEY = 'pisi.map.snapToGrid';
const PISI_MAP_AUTO_LAYOUT_CONFIRM = 50;
const pisiMapEditingState = { snapToGrid: false, guideLayer: null, initialized: false };

function pisiMapEditingTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function readPisiMapBoxRect(box) {
    return {
        id: box.dataset.nodeId,
        x: parseFloat(box.style.left || '0'),
        y: parseFloat(box.style.top || '0'),
        width: box.offsetWidth || parseFloat(box.style.width || '220'),
        height: box.offsetHeight || parseFloat(box.style.height || '92')
    };
}

function getPisiMapBoxes() {
    return /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll('#map-board .map-node-box[data-node-id]')));
}

function getPisiMapBoxById(id) {
    return document.querySelector(`#map-board .map-node-box[data-node-id="${CSS.escape(String(id))}"]`);
}

/**
 * Moves boxes to new rectangles, saves the layout and records one step.
 * @param {any[]} nextRects
 * @param {string} label history label (align, distribute, auto-layout, nudge)
 */
async function applyPisiMapLayoutChange(nextRects, label) {
    const mapPath = window.activeMapPath;
    if (!mapPath || !nextRects.length) return false;
    // Nodes outside the viewport are not in the DOM: their layout lives in the model.
    const currentRects = new Map((window.getPisiMapAllNodeRects?.() || getPisiMapBoxes().map(readPisiMapBoxRect)).map((rect) => [rect.id, rect]));
    const before = nextRects.map((rect) => currentRects.get(rect.id)).filter(Boolean);
    const step = makePisiMapLayoutStep(mapPath, before, nextRects);
    if (!step) return false;
    const nodes = new Map((Array.isArray(window.activeMapNodes) ? window.activeMapNodes : []).map((node) => [node.id, node]));
    for (const rect of step.after) {
        const box = getPisiMapBoxById(rect.id);
        if (box) {
            box.style.left = `${Math.round(rect.x)}px`;
            box.style.top = `${Math.round(rect.y)}px`;
        }
        const node = nodes.get(rect.id);
        if (node) node.layout = { ...(node.layout || {}), x: rect.x, y: rect.y };
    }
    window.markPisiMapViewportDirty?.();
    window.drawMapConnections?.();
    await window.pisiProject?.saveMapLayout?.(mapPath, step.after);
    window.recordPisiMapStep?.({ ...step, label });
    window.announcePisiMap?.(pisiMapEditingTranslate('{count} düğüm taşındı').replace('{count}', String(step.after.length)));
    return true;
}

function getSelectedPisiMapRects() {
    return (window.getSelectedMapNodeBoxes?.() || []).map(readPisiMapBoxRect);
}

function alignSelectedPisiMapNodes(mode) {
    const rects = getSelectedPisiMapRects();
    if (rects.length < 2) return false;
    return applyPisiMapLayoutChange(alignPisiMapRects(rects, mode), 'align');
}

function distributeSelectedPisiMapNodes(axis) {
    const rects = getSelectedPisiMapRects();
    if (rects.length < 3) return false;
    return applyPisiMapLayoutChange(distributePisiMapRects(rects, axis), 'distribute');
}

async function autoLayoutPisiMap(scope = 'hub') {
    const rects = window.getPisiMapAllNodeRects?.() || getPisiMapBoxes().map(readPisiMapBoxRect);
    const edges = Array.isArray(window.activeMapEdges) ? window.activeMapEdges : [];
    let next = [];
    if (scope === 'hub') {
        const root = (window.getSelectedMapNodeBoxes?.() || [])[0] || document.activeElement?.closest?.('.map-node-box');
        if (!root) return false;
        next = layoutPisiMapSubtree(rects, edges, root.dataset.nodeId);
    } else {
        next = layoutPisiMapAll(rects, edges);
    }
    if (next.length > PISI_MAP_AUTO_LAYOUT_CONFIRM) {
        const message = pisiMapEditingTranslate('{count} düğümün yeri değişecek. Devam edilsin mi?').replace('{count}', String(next.length));
        const ok = await pisiConfirm(message, { confirmText: pisiMapEditingTranslate('Düzenle') });
        if (!ok) return false;
    }
    return applyPisiMapLayoutChange(next, 'auto-layout');
}

function loadPisiMapGridPreference() {
    try {
        pisiMapEditingState.snapToGrid = localStorage.getItem(PISI_MAP_GRID_STORAGE_KEY) === '1';
    } catch {
        pisiMapEditingState.snapToGrid = false;
    }
}

function togglePisiMapSnapToGrid() {
    pisiMapEditingState.snapToGrid = !pisiMapEditingState.snapToGrid;
    try {
        localStorage.setItem(PISI_MAP_GRID_STORAGE_KEY, pisiMapEditingState.snapToGrid ? '1' : '0');
    } catch {}
    document.getElementById('map-canvas')?.classList.toggle('pisi-map-grid-visible', pisiMapEditingState.snapToGrid);
    window.announcePisiMap?.(pisiMapEditingTranslate(pisiMapEditingState.snapToGrid ? 'Izgaraya yapışma açık' : 'Izgaraya yapışma kapalı'));
    return pisiMapEditingState.snapToGrid;
}

function ensurePisiMapGuideLayer() {
    if (pisiMapEditingState.guideLayer?.isConnected) return pisiMapEditingState.guideLayer;
    const board = document.getElementById('map-board');
    if (!board) return null;
    const layer = document.createElement('div');
    layer.className = 'pisi-map-guide-layer';
    layer.setAttribute('aria-hidden', 'true');
    board.appendChild(layer);
    pisiMapEditingState.guideLayer = layer;
    return layer;
}

function clearPisiMapSnapGuides() {
    pisiMapEditingState.guideLayer?.replaceChildren();
}

function drawPisiMapSnapGuides(guides) {
    const layer = ensurePisiMapGuideLayer();
    if (!layer) return;
    layer.replaceChildren(
        ...guides.map((guide) => {
            const line = document.createElement('div');
            line.className = `pisi-map-guide pisi-map-guide-${guide.axis}`;
            if (guide.axis === 'x') Object.assign(line.style, { left: `${guide.position}px`, top: `${guide.from}px`, height: `${guide.to - guide.from}px` });
            else Object.assign(line.style, { top: `${guide.position}px`, left: `${guide.from}px`, width: `${guide.to - guide.from}px` });
            return line;
        })
    );
}

/**
 * Called by the node drag on every move with the drag start positions and the
 * raw offset. Returns the offset after snapping to guides or the grid. Alt
 * turns both off for the current move.
 * @param {{ box: HTMLElement, x: number, y: number }[]} items
 * @param {number} dx
 * @param {number} dy
 * @param {MouseEvent} [event]
 */
function snapPisiMapDrag(items, dx, dy, event) {
    if (!items.length || event?.altKey) {
        clearPisiMapSnapGuides();
        return { dx, dy };
    }
    const lead = items[0];
    const leadRect = { ...readPisiMapBoxRect(lead.box), x: lead.x + dx, y: lead.y + dy };
    if (pisiMapEditingState.snapToGrid) {
        clearPisiMapSnapGuides();
        return { dx: snapPisiMapValueToGrid(leadRect.x) - lead.x, dy: snapPisiMapValueToGrid(leadRect.y) - lead.y };
    }
    const moving = new Set(items.map((item) => item.box));
    const others = getPisiMapBoxes()
        .filter((box) => !moving.has(box) && !box.hidden && box.offsetParent !== null)
        .map(readPisiMapBoxRect);
    const zoom = window.activeMapCamera?.zoom || 1;
    const snapped = findPisiMapSnapGuides(leadRect, others, PISI_MAP_SNAP_THRESHOLD / zoom);
    drawPisiMapSnapGuides(snapped.guides);
    return { dx: snapped.x - lead.x, dy: snapped.y - lead.y };
}

function makePisiMapMenuItem(label, handler, options = {}) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'pisi-map-context-menu-item';
    item.textContent = pisiMapEditingTranslate(label);
    if (options.disabled) item.disabled = true;
    if (options.checked !== undefined) item.setAttribute('aria-checked', options.checked ? 'true' : 'false');
    if (options.shortcut) item.dataset.shortcut = options.shortcut;
    item.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.hidePisiMapContextMenu?.();
        await handler();
    });
    return item;
}

function makePisiMapMenuSeparator() {
    const separator = document.createElement('div');
    separator.className = 'pisi-map-context-menu-separator';
    separator.setAttribute('role', 'separator');
    return separator;
}

/** Adds editing actions to the map context menu (canvas or node). */
function appendPisiMapEditingMenuItems(menu, { onNode = false } = {}) {
    const selected = window.getSelectedMapNodeBoxes?.() || [];
    const clipboard = window.pisiMapClipboardState?.clip;
    const items = [];
    if (onNode) {
        items.push(
            makePisiMapMenuItem('Kopyala', () => window.copyPisiMapSelection?.(), { shortcut: 'Mod+C' }),
            makePisiMapMenuItem('Çoğalt', () => window.duplicatePisiMapSelection?.(), { shortcut: 'Mod+D' })
        );
    }
    items.push(
        makePisiMapMenuItem('Yapıştır', () => window.pastePisiMapClipboard?.({ copy: false }), { disabled: !clipboard, shortcut: 'Mod+V' }),
        makePisiMapMenuItem('Kopya not olarak yapıştır', () => window.pastePisiMapClipboard?.({ copy: true }), { disabled: !clipboard, shortcut: 'Mod+Alt+V' }),
        makePisiMapMenuSeparator()
    );
    if (selected.length >= 2) {
        for (const [mode, label] of [
            ['left', 'Sola hizala'],
            ['center', 'Ortaya hizala'],
            ['right', 'Sağa hizala'],
            ['top', 'Üste hizala'],
            ['middle', 'Dikey ortaya hizala'],
            ['bottom', 'Alta hizala']
        ]) {
            items.push(makePisiMapMenuItem(label, () => alignSelectedPisiMapNodes(mode)));
        }
        items.push(
            makePisiMapMenuItem('Yatay eşit dağıt', () => distributeSelectedPisiMapNodes('horizontal'), { disabled: selected.length < 3 }),
            makePisiMapMenuItem('Dikey eşit dağıt', () => distributeSelectedPisiMapNodes('vertical'), { disabled: selected.length < 3 }),
            makePisiMapMenuSeparator()
        );
    }
    if (onNode) items.push(makePisiMapMenuItem("Hub'ı otomatik yerleştir", () => autoLayoutPisiMap('hub')));
    items.push(
        makePisiMapMenuItem('Haritayı otomatik yerleştir', () => autoLayoutPisiMap('all')),
        makePisiMapMenuItem('Izgaraya yapış', togglePisiMapSnapToGrid, { checked: pisiMapEditingState.snapToGrid })
    );
    menu.append(...items);
    return menu;
}

function placePisiMapMenu(menu, clientX, clientY) {
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(clientX, Math.max(8, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.min(clientY, Math.max(8, window.innerHeight - rect.height - 8))}px`;
}

function showPisiMapNodeContextMenu(box, clientX, clientY) {
    window.hidePisiMapContextMenu?.();
    if (!box.classList.contains('selected')) {
        window.clearSelectedMapNodes?.();
        box.classList.add('selected');
    }
    const menu = document.createElement('div');
    menu.id = 'pisi-map-context-menu';
    menu.className = 'pisi-map-context-menu';
    menu.setAttribute('role', 'menu');
    appendPisiMapEditingMenuItems(menu, { onNode: true });
    placePisiMapMenu(menu, clientX, clientY);
    menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}

function handlePisiMapNodeContextMenu(event) {
    const box = event.target?.closest?.('#map-board .map-node-box');
    if (!box || !window.activeMapPath) return;
    if (event.target.closest('input, textarea, [contenteditable="true"], .map-port')) return;
    // Title cards use a right double-click of their own.
    if (document.getElementById('map-canvas')?.dataset.nodeView === 'title' && !event.pisiLongPress) return;
    event.preventDefault();
    event.stopPropagation();
    showPisiMapNodeContextMenu(box, event.clientX, event.clientY);
}

function registerPisiMapEditingCommands() {
    const when = () => Boolean(window.isPisiMapHistoryContext?.());
    const selectionWhen = (count) => () => when() && (window.getSelectedMapNodeBoxes?.() || []).length >= count;
    for (const [mode, label] of [
        ['left', 'Seçili düğümleri sola hizala'],
        ['center', 'Seçili düğümleri ortaya hizala'],
        ['right', 'Seçili düğümleri sağa hizala'],
        ['top', 'Seçili düğümleri üste hizala'],
        ['middle', 'Seçili düğümleri dikey ortaya hizala'],
        ['bottom', 'Seçili düğümleri alta hizala']
    ]) {
        registerPisiCommand({
            id: `pisi.map.align-${mode}`,
            label,
            category: 'Harita',
            when: selectionWhen(2),
            handler: () => alignSelectedPisiMapNodes(mode)
        });
    }
    registerPisiCommand({
        id: 'pisi.map.distribute-horizontal',
        label: 'Seçili düğümleri yatay eşit dağıt',
        category: 'Harita',
        when: selectionWhen(3),
        handler: () => distributeSelectedPisiMapNodes('horizontal')
    });
    registerPisiCommand({
        id: 'pisi.map.distribute-vertical',
        label: 'Seçili düğümleri dikey eşit dağıt',
        category: 'Harita',
        when: selectionWhen(3),
        handler: () => distributeSelectedPisiMapNodes('vertical')
    });
    registerPisiCommand({
        id: 'pisi.map.auto-layout-hub',
        label: "Seçili hub'ı otomatik yerleştir",
        category: 'Harita',
        when: selectionWhen(1),
        handler: () => autoLayoutPisiMap('hub')
    });
    registerPisiCommand({
        id: 'pisi.map.auto-layout-all',
        label: 'Haritayı otomatik yerleştir',
        category: 'Harita',
        when,
        handler: () => autoLayoutPisiMap('all')
    });
    registerPisiCommand({ id: 'pisi.map.snap-to-grid', label: 'Izgaraya yapışmayı aç/kapat', category: 'Harita', when, handler: togglePisiMapSnapToGrid });
}

function ensurePisiMapEditingStyle() {
    if (document.querySelector('link[data-pisi-map-editing-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/map/pisi-map-editing.css';
    link.dataset.pisiMapEditingStyle = '1';
    document.head.appendChild(link);
}

function initializePisiMapEditing() {
    if (pisiMapEditingState.initialized) return false;
    pisiMapEditingState.initialized = true;
    ensurePisiMapEditingStyle();
    loadPisiMapGridPreference();
    document.getElementById('map-canvas')?.classList.toggle('pisi-map-grid-visible', pisiMapEditingState.snapToGrid);
    document.addEventListener('contextmenu', handlePisiMapNodeContextMenu, true);
    document.addEventListener('pisi:map-context-menu', (event) => appendPisiMapEditingMenuItems(event.detail?.menu, { onNode: false }));
    window.addEventListener('mouseup', clearPisiMapSnapGuides);
    registerPisiMapEditingCommands();
    return true;
}

const moduleApi = {
    pisiMapEditingState,
    PISI_MAP_GRID_STEP,
    readPisiMapBoxRect,
    applyPisiMapLayoutChange,
    alignSelectedPisiMapNodes,
    distributeSelectedPisiMapNodes,
    autoLayoutPisiMap,
    togglePisiMapSnapToGrid,
    snapPisiMapDrag,
    clearPisiMapSnapGuides,
    showPisiMapNodeContextMenu,
    initializePisiMapEditing
};

registerModule('map.editing', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiMapEditing, { once: true });
} else {
    initializePisiMapEditing();
}

export {
    alignSelectedPisiMapNodes,
    applyPisiMapLayoutChange,
    autoLayoutPisiMap,
    distributeSelectedPisiMapNodes,
    initializePisiMapEditing,
    pisiMapEditingState,
    readPisiMapBoxRect,
    snapPisiMapDrag,
    togglePisiMapSnapToGrid
};
