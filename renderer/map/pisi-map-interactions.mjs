import { registerModule } from "../core/module-registry.mjs";
import {
    collectPisiCollapsedHubNodeIds,
    isPisiHierarchyEdge,
    isPisiMapEdgeHiddenByCollapsedHub,
    makePisiCollapsedHubPortKey
} from "./pisi-map-collapse-core.mjs";
import { getPisiMapConnectionMetrics } from "./pisi-map-zoom-core.mjs";

function getTreeItemDisplayName(item) {
    if (!item) return '';

    if (item.metadata?.title) {
        return item.metadata.title;
    }

    if (item.displayName) {
        return item.displayName;
    }

    if (item.name?.toLowerCase().endsWith('.node')) {
        return item.name.slice(0, -'.node'.length);
    }

    if (item.name?.toLowerCase().endsWith('.map')) {
        return item.name.slice(0, -'.map'.length);
    }

    return item.name || '';
}

function getConnectionDataFromEvent(event) {
    // Ctrl / Cmd: denk bağlam
    if (event.ctrlKey || event.metaKey) {
        return {
            type: 'co-level',
            sourceRole: 'co-level',
            targetRole: 'co-level'
        };
    }

    // Alt: süreç ilişkisi
    if (event.altKey) {
        return {
            type: 'stream',
            sourceRole: 'downstream',
            targetRole: 'upstream'
        };
    }

    // Normal sürükleme: hiyerarşik ilişki
    return {
        type: 'down-hub',
        sourceRole: 'down-hub',
        targetRole: 'up-hub'
    };
}

function isHierarchyEdge(edge) {
    return isPisiHierarchyEdge(edge);
}

function getCollapsedHubPortSet() {
    if (!window.Pisi) {
        window.Pisi = { state: {} };
    }

    if (!window.Pisi.state) {
        window.Pisi.state = {};
    }

    if (!(window.Pisi.state.collapsedHubPorts instanceof Set)) {
        window.Pisi.state.collapsedHubPorts = new Set();
    }

    return window.Pisi.state.collapsedHubPorts;
}

function makeCollapsedHubPortKey(nodeId, port) {
    return makePisiCollapsedHubPortKey(nodeId, port);
}

function hasOutgoingHubEdgesFromPort(nodeId, port) {
    return Array.isArray(activeMapEdges) && activeMapEdges.some((edge) => {
        return isHierarchyEdge(edge) &&
            edge.sourceId === nodeId &&
            (edge.sourcePort || 'right') === (port || 'right');
    });
}

function collectCollapsedHubNodeIds() {
    return collectPisiCollapsedHubNodeIds(
        activeMapEdges,
        getCollapsedHubPortSet()
    );
}

function syncCollapsedHubNodeVisibility() {
    const hiddenNodeIds = collectCollapsedHubNodeIds();
    let selectionChanged = false;

    document.querySelectorAll('.map-node-box[data-node-id]').forEach((box) => {
        const shouldHide = hiddenNodeIds.has(String(box.dataset.nodeId || ''));
        box.classList.toggle('pisi-hub-descendant-hidden', shouldHide);

        if (shouldHide) {
            selectionChanged = selectionChanged || box.classList.contains('selected');
            box.classList.remove('selected', 'dragging');
            box.setAttribute('aria-hidden', 'true');
        } else {
            box.removeAttribute('aria-hidden');
        }
    });

    if (selectionChanged) {
        document.dispatchEvent(new CustomEvent(
            'pisi:map-customization-context-changed'
        ));
    }

    return hiddenNodeIds;
}

function isHubEdgeCollapsed(edge, hiddenNodeIds = collectCollapsedHubNodeIds()) {
    return isPisiMapEdgeHiddenByCollapsedHub(
        edge,
        hiddenNodeIds,
        getCollapsedHubPortSet()
    );
}

function syncHubPortCollapseVisuals() {
    document.querySelectorAll('.map-port.hub-collapsed').forEach((port) => {
        port.classList.remove('hub-collapsed');
        port.title = '';
    });

    for (const key of getCollapsedHubPortSet()) {
        const [nodeId, port] = String(key).split('::');
        if (!nodeId || !port) continue;

        const portEl = document.querySelector(
            `.map-node-box[data-node-id="${CSS.escape(nodeId)}"] .map-port.${CSS.escape(port)}`
        );

        if (portEl) {
            portEl.classList.add('hub-collapsed');
            portEl.title = 'Hub bağlantıları kapalı. Tekrar açmak için tıkla.';
        }
    }
}

function toggleHubConnectionsFromPort(nodeId, port) {
    if (!hasOutgoingHubEdgesFromPort(nodeId, port)) {
        return false;
    }

    const set = getCollapsedHubPortSet();
    const key = makeCollapsedHubPortKey(nodeId, port);

    if (set.has(key)) {
        set.delete(key);
    } else {
        set.add(key);
    }

    drawMapConnections();
    syncHubPortCollapseVisuals();
    saveActiveMapCameraSoon();
    return true;
}

function convertEdgeToStream(edge) {
    return {
        ...edge,
        type: 'stream',
        sourceRole: 'downstream',
        targetRole: 'upstream'
    };
}

function targetAlreadyHasUpHub(targetId, edges = [], ignoreSourceId = null) {
    return edges.some((edge) => {
        if (!isHierarchyEdge(edge)) return false;
        if (edge.targetId !== targetId) return false;

        // Aynı source-target bağlantısını güncelliyorsak bunu engel sayma.
        if (ignoreSourceId && edge.sourceId === ignoreSourceId) return false;

        return true;
    });
}

function enforceSingleParentForTarget(edge, edges = []) {
    if (!isHierarchyEdge(edge)) {
        return edge;
    }

    if (targetAlreadyHasUpHub(edge.targetId, edges, edge.sourceId)) {
        console.warn(
            '[PISI] Hedef node zaten bir up-hub bağlantısına sahip. Yeni bağlantı stream olarak kaydedildi.'
        );

        return convertEdgeToStream(edge);
    }

    return edge;
}

function getConnectionClass(edgeOrType) {
    const type = typeof edgeOrType === 'string'
        ? edgeOrType
        : edgeOrType?.type;

    if (type === 'co-level' || type === 'colevel') return 'co-level';
    if (type === 'stream' || type === 'upstream' || type === 'downstream') return 'stream';

    return 'down-hub';
}

function getPortPoint(box, port) {
    const canvas = document.getElementById('map-canvas');
    const boxRect = box.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    const x = boxRect.left - canvasRect.left;
    const y = boxRect.top - canvasRect.top;
    const w = boxRect.width;
    const h = boxRect.height;

    if (port === 'top') return { x: x + w / 2, y };
    if (port === 'right') return { x: x + w, y: y + h / 2 };
    if (port === 'bottom') return { x: x + w / 2, y: y + h };
    return { x, y: y + h / 2 };
}

function getMousePointInCanvas(event) {
    const canvas = document.getElementById('map-canvas');
    const rect = canvas.getBoundingClientRect();

    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
}

function getPortDirection(port) {
    if (port === 'top') return { x: 0, y: -1 };
    if (port === 'right') return { x: 1, y: 0 };
    if (port === 'bottom') return { x: 0, y: 1 };
    if (port === 'left') return { x: -1, y: 0 };

    return { x: 1, y: 0 };
}

function offsetPoint(point, direction, distance) {
    return {
        x: point.x + direction.x * distance,
        y: point.y + direction.y * distance
    };
}

function getDistance(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    return Math.sqrt(dx * dx + dy * dy);
}

function getMapConnectionVisualMetrics() {
    return getPisiMapConnectionMetrics(activeMapCamera?.zoom);
}

function syncMapConnectionZoomStyles(svg = document.getElementById('map-connections')) {
    const metrics = getMapConnectionVisualMetrics();
    if (!svg) return metrics;

    svg.style.setProperty(
        '--pisi-map-edge-stroke-width',
        `${metrics.edgeStrokeWidth}px`
    );
    svg.style.setProperty(
        '--pisi-map-edge-hover-stroke-width',
        `${metrics.edgeHoverStrokeWidth}px`
    );
    svg.style.setProperty(
        '--pisi-map-temp-edge-stroke-width',
        `${metrics.tempEdgeStrokeWidth}px`
    );

    return metrics;
}

function makeConnectionPathFromBoxes(sourceBox, sourcePort, targetBox, targetPort, edgeType = 'down-hub') {
    const hasStartArrow = edgeType === 'co-level';
    const hasEndArrow = true;
    const metrics = getMapConnectionVisualMetrics();

    // Ok olmayan çıkış tarafı kutuya yakın başlasın.
    // Ok olan taraflarda çizgi ok tabanında bitsin, ok kutuya doğru uzasın.
    const plainLineGap = metrics.plainLineGap;
    const arrowGap = metrics.arrowGap;

    const sourceOffset = hasStartArrow ? arrowGap : plainLineGap;
    const targetOffset = hasEndArrow ? arrowGap : plainLineGap;

    const sourceBase = getPortPoint(sourceBox, sourcePort);
    const targetBase = getPortPoint(targetBox, targetPort);

    const sourceDir = getPortDirection(sourcePort);
    const targetDir = getPortDirection(targetPort);

    const start = offsetPoint(sourceBase, sourceDir, sourceOffset);
    const end = offsetPoint(targetBase, targetDir, targetOffset);

    const distance = getDistance(start, end);
    const control = Math.max(
        metrics.connectionControlMin,
        Math.min(metrics.connectionControlMax, distance * 0.38)
    );

    const c1 = {
        x: start.x + sourceDir.x * control,
        y: start.y + sourceDir.y * control
    };

    const c2 = {
        x: end.x + targetDir.x * control,
        y: end.y + targetDir.y * control
    };

    return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}

function makeTempConnectionPath(sourceBox, sourcePort, mousePoint) {
    const metrics = getMapConnectionVisualMetrics();
    const endpointOffset = metrics.tempEndpointOffset;

    const sourceBase = getPortPoint(sourceBox, sourcePort);
    const sourceDir = getPortDirection(sourcePort);

    const start = offsetPoint(sourceBase, sourceDir, endpointOffset);
    const distance = getDistance(start, mousePoint);
    const control = Math.max(
        metrics.tempControlMin,
        Math.min(metrics.tempControlMax, distance * 0.35)
    );

    const c1 = {
        x: start.x + sourceDir.x * control,
        y: start.y + sourceDir.y * control
    };

    return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${mousePoint.x} ${mousePoint.y}, ${mousePoint.x} ${mousePoint.y}`;
}

function ensureTempEdgePath() {
    const svg = document.getElementById('map-connections');
    if (!svg) return null;

    let path = document.getElementById('map-temp-edge');

    if (!path) {
        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.id = 'map-temp-edge';
        path.classList.add('map-temp-edge');
        svg.appendChild(path);
    }

    return path;
}

function clearTempEdgePath() {
    const path = document.getElementById('map-temp-edge');
    if (path) path.remove();
}

function applyMapCamera() {
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

function clampMapZoom(zoom) {
    return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, zoom));
}

function zoomMapAtClientPoint(clientX, clientY, direction) {
    const canvas = document.getElementById('map-canvas');

    if (!canvas || !activeMapPath) return;

    const rect = canvas.getBoundingClientRect();

    const oldZoom = activeMapCamera.zoom || 1;
    const zoomFactor = direction > 0
        ? MAP_ZOOM_STEP
        : 1 / MAP_ZOOM_STEP;

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

function zoomMapFromCenter(direction) {
    const canvas = document.getElementById('map-canvas');

    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    zoomMapAtClientPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        direction
    );
}

function saveActiveMapCameraSoon() {
    if (!activeMapPath) return;

    clearTimeout(mapCameraSaveTimer);
    const mapPath = activeMapPath;
    const camera = {
        ...activeMapCamera,
        collapsedHubs: Array.from(getCollapsedHubPortSet())
    };

    mapCameraSaveTimer = setTimeout(async () => {
        mapCameraSaveTimer = null;
        window.pisiProject?.saveMapCamera?.(
            mapPath,
            camera
        );
    }, 350);
}

function scheduleMapCameraSave() {
    saveActiveMapCameraSoon();
}

async function flushActiveMapCameraSave() {
    clearTimeout(mapCameraSaveTimer);
    mapCameraSaveTimer = null;

    if (!activeMapPath) return true;

    try {
        const result = await window.pisiProject?.saveMapCamera?.(
            activeMapPath,
            {
                ...activeMapCamera,
                collapsedHubs: Array.from(getCollapsedHubPortSet())
            }
        );

        return Boolean(result?.ok);
    } catch (error) {
        console.error('[PISI] Map kamerası kaydedilemedi:', error);
        return false;
    }
}

function bindMapZoomEvents() {
    if (mapZoomEventsBound) return;

    const canvas = document.getElementById('map-canvas');

    if (!canvas) return;

    mapZoomEventsBound = true;

    canvas.addEventListener('wheel', (event) => {
        if (!activeMapPath) return;

        event.preventDefault();
        event.stopPropagation();

        const direction = event.deltaY < 0 ? 1 : -1;

        zoomMapAtClientPoint(
            event.clientX,
            event.clientY,
            direction
        );
    }, { passive: false });
}

function bindMapZoomControls() {
    if (mapZoomControlsBound) return;

    const zoomInBtn = document.getElementById('map-zoom-in');
    const zoomOutBtn = document.getElementById('map-zoom-out');

    bindHoldZoomButton(zoomInBtn, 1);
    bindHoldZoomButton(zoomOutBtn, -1);

    mapZoomControlsBound = true;
}

function bindHoldZoomButton(button, direction) {
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

function clearSelectedMapNodes() {
    let changed = false;
    document.querySelectorAll('.map-node-box.selected').forEach((box) => {
        changed = true;
        box.classList.remove('selected');
    });
    if (changed) {
        document.dispatchEvent(new CustomEvent(
            'pisi:map-customization-context-changed'
        ));
    }
}

function getSelectedMapNodeBoxes() {
    return Array.from(document.querySelectorAll('.map-node-box.selected'));
}

function getClientSelectionRect(startX, startY, currentX, currentY) {
    return {
        left: Math.min(startX, currentX),
        right: Math.max(startX, currentX),
        top: Math.min(startY, currentY),
        bottom: Math.max(startY, currentY),
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
        direction: currentX >= startX ? 'left-to-right' : 'right-to-left'
    };
}

function rectsIntersect(a, b) {
    return (
        a.left <= b.right &&
        a.right >= b.left &&
        a.top <= b.bottom &&
        a.bottom >= b.top
    );
}

function rectContainsRect(outer, inner) {
    return (
        inner.left >= outer.left &&
        inner.right <= outer.right &&
        inner.top >= outer.top &&
        inner.bottom <= outer.bottom
    );
}

function applyMapBoxSelection(selectionRect) {
    clearSelectedMapNodes();
    selectedMapEdgeId = null;
    document.querySelectorAll('.map-edge-group.selected').forEach((group) => {
        group.classList.remove('selected');
    });

    const boxes = Array.from(document.querySelectorAll(
        '.map-node-box:not(.pisi-hub-descendant-hidden)'
    ));

    for (const box of boxes) {
        const boxRect = box.getBoundingClientRect();

        const normalizedBoxRect = {
            left: boxRect.left,
            right: boxRect.right,
            top: boxRect.top,
            bottom: boxRect.bottom
        };

        const shouldSelect =
            selectionRect.direction === 'left-to-right'
                ? rectsIntersect(selectionRect, normalizedBoxRect)
                : rectContainsRect(selectionRect, normalizedBoxRect);

        if (shouldSelect) {
            box.classList.add('selected');
        }
    }
    document.dispatchEvent(new CustomEvent(
        'pisi:map-customization-context-changed'
    ));
}

function updateMapSelectionBoxVisual(selectionState, event) {
    const canvas = document.getElementById('map-canvas');

    if (!canvas || !selectionState?.element) return;

    const canvasRect = canvas.getBoundingClientRect();

    const selectionRect = getClientSelectionRect(
        selectionState.startX,
        selectionState.startY,
        event.clientX,
        event.clientY
    );

    selectionState.direction = selectionRect.direction;

    selectionState.element.style.left = `${selectionRect.left - canvasRect.left}px`;
    selectionState.element.style.top = `${selectionRect.top - canvasRect.top}px`;
    selectionState.element.style.width = `${selectionRect.width}px`;
    selectionState.element.style.height = `${selectionRect.height}px`;

    selectionState.element.classList.toggle(
        'right-to-left',
        selectionRect.direction === 'right-to-left'
    );

    selectionState.element.classList.toggle(
        'left-to-right',
        selectionRect.direction === 'left-to-right'
    );
}

function setupMapCanvasPan() {
    if (mapCanvasPanBound) return;
    mapCanvasPanBound = true;

    const canvas = document.getElementById('map-canvas');
    if (!canvas) return;

    let isPanning = false;
    let startX = 0;
    let startY = 0;
    let startCameraX = 0;
    let startCameraY = 0;

    canvas.addEventListener('contextmenu', (event) => {
        if (currentMapBoxSelection) {
            event.preventDefault();
        }
    });

    canvas.addEventListener('mousedown', (event) => {
        if (
            event.target.closest('.map-node-box') ||
            event.target.closest('.map-edge') ||
            event.target.closest('.map-edge-hit') ||
            event.target.closest('.map-edge-delete') ||
            event.target.closest('.map-port') ||
            event.target.closest('#map-zoom-controls') ||
            event.target.closest('.pisi-map-overlay-control')
        ) {
            return;
        }

        // Sol tık: mevcut pan davranışı aynen korunuyor.
        if (event.button === 0) {
            clearSelectedMapNodes();
            selectedMapEdgeId = null;
            document.querySelectorAll('.map-edge-group.selected')
                .forEach((group) => group.classList.remove('selected'));
            document.dispatchEvent(new CustomEvent(
                'pisi:map-customization-context-changed'
            ));
            isPanning = true;

            startX = event.clientX;
            startY = event.clientY;
            startCameraX = activeMapCamera.x;
            startCameraY = activeMapCamera.y;

            canvas.classList.add('panning');

            event.preventDefault();
            return;
        }

        // Sağ tık basılı tutup sürükleme: toplu seçim çerçevesi.
        if (event.button === 2) {
            const selectionEl = document.createElement('div');
            selectionEl.className = 'map-selection-box left-to-right';

            canvas.appendChild(selectionEl);

            currentMapBoxSelection = {
                startX: event.clientX,
                startY: event.clientY,
                lastX: event.clientX,
                lastY: event.clientY,
                hasMoved: false,
                direction: 'left-to-right',
                element: selectionEl
            };

            updateMapSelectionBoxVisual(currentMapBoxSelection, event);

            event.preventDefault();
        }
    });

    window.addEventListener('mousemove', (event) => {
        if (currentMapBoxSelection) {
            currentMapBoxSelection.lastX = event.clientX;
            currentMapBoxSelection.lastY = event.clientY;

            const moveDistance =
                Math.abs(event.clientX - currentMapBoxSelection.startX) +
                Math.abs(event.clientY - currentMapBoxSelection.startY);

            if (moveDistance > 4) {
                currentMapBoxSelection.hasMoved = true;
            }

            updateMapSelectionBoxVisual(currentMapBoxSelection, event);
            return;
        }

        if (!isPanning) return;

        activeMapCamera.x = startCameraX + (event.clientX - startX);
        activeMapCamera.y = startCameraY + (event.clientY - startY);

        applyMapCamera();
    });

    window.addEventListener('mouseup', (event) => {
        if (currentMapBoxSelection) {
            const selectionState = currentMapBoxSelection;

            const selectionRect = getClientSelectionRect(
                selectionState.startX,
                selectionState.startY,
                event.clientX,
                event.clientY
            );

            if (selectionState.hasMoved) {
                applyMapBoxSelection(selectionRect);
                canvas.dataset.skipNextContextMenu = '1';
            }

            selectionState.element?.remove();
            currentMapBoxSelection = null;

            event.preventDefault();
            return;
        }

        if (!isPanning) return;

        isPanning = false;
        canvas.classList.remove('panning');

        scheduleMapCameraSave();
    });
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "getTreeItemDisplayName": {
        enumerable: true,
        get() { return getTreeItemDisplayName; }
    },
    "getConnectionDataFromEvent": {
        enumerable: true,
        get() { return getConnectionDataFromEvent; }
    },
    "isHierarchyEdge": {
        enumerable: true,
        get() { return isHierarchyEdge; }
    },
    "getCollapsedHubPortSet": {
        enumerable: true,
        get() { return getCollapsedHubPortSet; }
    },
    "makeCollapsedHubPortKey": {
        enumerable: true,
        get() { return makeCollapsedHubPortKey; }
    },
    "hasOutgoingHubEdgesFromPort": {
        enumerable: true,
        get() { return hasOutgoingHubEdgesFromPort; }
    },
    "collectCollapsedHubNodeIds": {
        enumerable: true,
        get() { return collectCollapsedHubNodeIds; }
    },
    "syncCollapsedHubNodeVisibility": {
        enumerable: true,
        get() { return syncCollapsedHubNodeVisibility; }
    },
    "isHubEdgeCollapsed": {
        enumerable: true,
        get() { return isHubEdgeCollapsed; }
    },
    "syncHubPortCollapseVisuals": {
        enumerable: true,
        get() { return syncHubPortCollapseVisuals; }
    },
    "toggleHubConnectionsFromPort": {
        enumerable: true,
        get() { return toggleHubConnectionsFromPort; }
    },
    "convertEdgeToStream": {
        enumerable: true,
        get() { return convertEdgeToStream; }
    },
    "targetAlreadyHasUpHub": {
        enumerable: true,
        get() { return targetAlreadyHasUpHub; }
    },
    "enforceSingleParentForTarget": {
        enumerable: true,
        get() { return enforceSingleParentForTarget; }
    },
    "getConnectionClass": {
        enumerable: true,
        get() { return getConnectionClass; }
    },
    "getPortPoint": {
        enumerable: true,
        get() { return getPortPoint; }
    },
    "getMousePointInCanvas": {
        enumerable: true,
        get() { return getMousePointInCanvas; }
    },
    "getPortDirection": {
        enumerable: true,
        get() { return getPortDirection; }
    },
    "offsetPoint": {
        enumerable: true,
        get() { return offsetPoint; }
    },
    "getDistance": {
        enumerable: true,
        get() { return getDistance; }
    },
    "getMapConnectionVisualMetrics": {
        enumerable: true,
        get() { return getMapConnectionVisualMetrics; }
    },
    "syncMapConnectionZoomStyles": {
        enumerable: true,
        get() { return syncMapConnectionZoomStyles; }
    },
    "makeConnectionPathFromBoxes": {
        enumerable: true,
        get() { return makeConnectionPathFromBoxes; }
    },
    "makeTempConnectionPath": {
        enumerable: true,
        get() { return makeTempConnectionPath; }
    },
    "ensureTempEdgePath": {
        enumerable: true,
        get() { return ensureTempEdgePath; }
    },
    "clearTempEdgePath": {
        enumerable: true,
        get() { return clearTempEdgePath; }
    },
    "applyMapCamera": {
        enumerable: true,
        get() { return applyMapCamera; }
    },
    "clampMapZoom": {
        enumerable: true,
        get() { return clampMapZoom; }
    },
    "zoomMapAtClientPoint": {
        enumerable: true,
        get() { return zoomMapAtClientPoint; }
    },
    "zoomMapFromCenter": {
        enumerable: true,
        get() { return zoomMapFromCenter; }
    },
    "saveActiveMapCameraSoon": {
        enumerable: true,
        get() { return saveActiveMapCameraSoon; }
    },
    "scheduleMapCameraSave": {
        enumerable: true,
        get() { return scheduleMapCameraSave; }
    },
    "flushActiveMapCameraSave": {
        enumerable: true,
        get() { return flushActiveMapCameraSave; }
    },
    "bindMapZoomEvents": {
        enumerable: true,
        get() { return bindMapZoomEvents; }
    },
    "bindMapZoomControls": {
        enumerable: true,
        get() { return bindMapZoomControls; }
    },
    "bindHoldZoomButton": {
        enumerable: true,
        get() { return bindHoldZoomButton; }
    },
    "clearSelectedMapNodes": {
        enumerable: true,
        get() { return clearSelectedMapNodes; }
    },
    "getSelectedMapNodeBoxes": {
        enumerable: true,
        get() { return getSelectedMapNodeBoxes; }
    },
    "getClientSelectionRect": {
        enumerable: true,
        get() { return getClientSelectionRect; }
    },
    "rectsIntersect": {
        enumerable: true,
        get() { return rectsIntersect; }
    },
    "rectContainsRect": {
        enumerable: true,
        get() { return rectContainsRect; }
    },
    "applyMapBoxSelection": {
        enumerable: true,
        get() { return applyMapBoxSelection; }
    },
    "updateMapSelectionBoxVisual": {
        enumerable: true,
        get() { return updateMapSelectionBoxVisual; }
    },
    "setupMapCanvasPan": {
        enumerable: true,
        get() { return setupMapCanvasPan; }
    }
});
registerModule("map.interactions", moduleApi);
