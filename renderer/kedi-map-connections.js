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
    return (
        edge?.type === 'down-hub' &&
        edge?.sourceRole === 'down-hub' &&
        edge?.targetRole === 'up-hub'
    );
}

function getCollapsedHubPortSet() {
    if (!window.Kedi) {
        window.Kedi = { state: {} };
    }

    if (!window.Kedi.state) {
        window.Kedi.state = {};
    }

    if (!(window.Kedi.state.collapsedHubPorts instanceof Set)) {
        window.Kedi.state.collapsedHubPorts = new Set();
    }

    return window.Kedi.state.collapsedHubPorts;
}

function makeCollapsedHubPortKey(nodeId, port) {
    return `${nodeId || ''}::${port || 'right'}`;
}

function hasOutgoingHubEdgesFromPort(nodeId, port) {
    return Array.isArray(activeMapEdges) && activeMapEdges.some((edge) => {
        return isHierarchyEdge(edge) &&
            edge.sourceId === nodeId &&
            (edge.sourcePort || 'right') === (port || 'right');
    });
}

function isHubEdgeCollapsed(edge) {
    if (!isHierarchyEdge(edge)) return false;

    return getCollapsedHubPortSet().has(
        makeCollapsedHubPortKey(edge.sourceId, edge.sourcePort || 'right')
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
            '[KEDI] Hedef node zaten bir up-hub bağlantısına sahip. Yeni bağlantı stream olarak kaydedildi.'
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

function makeConnectionPathFromBoxes(sourceBox, sourcePort, targetBox, targetPort, edgeType = 'down-hub') {
    const hasStartArrow = edgeType === 'co-level';
    const hasEndArrow = true;

    // Ok olmayan çıkış tarafı kutuya yakın başlasın.
    // Ok olan taraflarda çizgi ok tabanında bitsin, ok kutuya doğru uzasın.
    const plainLineGap = 6;
    const arrowGap = 24;

    const sourceOffset = hasStartArrow ? arrowGap : plainLineGap;
    const targetOffset = hasEndArrow ? arrowGap : plainLineGap;

    const sourceBase = getPortPoint(sourceBox, sourcePort);
    const targetBase = getPortPoint(targetBox, targetPort);

    const sourceDir = getPortDirection(sourcePort);
    const targetDir = getPortDirection(targetPort);

    const start = offsetPoint(sourceBase, sourceDir, sourceOffset);
    const end = offsetPoint(targetBase, targetDir, targetOffset);

    const distance = getDistance(start, end);
    const control = Math.max(60, Math.min(190, distance * 0.38));

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
    const endpointOffset = 14;

    const sourceBase = getPortPoint(sourceBox, sourcePort);
    const sourceDir = getPortDirection(sourcePort);

    const start = offsetPoint(sourceBase, sourceDir, endpointOffset);
    const distance = getDistance(start, mousePoint);
    const control = Math.max(60, Math.min(170, distance * 0.35));

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

    drawMapConnections();
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

    mapCameraSaveTimer = setTimeout(() => {
        window.kediProject?.saveMapCamera?.(
            activeMapPath,
            activeMapCamera
        );
    }, 350);
}

function scheduleMapCameraSave() {
    clearTimeout(mapCameraSaveTimer);

    mapCameraSaveTimer = setTimeout(() => {
        if (!activeMapPath) return;

        window.kediProject?.saveMapCamera?.(activeMapPath, activeMapCamera);
    }, 500);
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
    document.querySelectorAll('.map-node-box.selected').forEach((box) => {
        box.classList.remove('selected');
    });
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

    const boxes = Array.from(document.querySelectorAll('.map-node-box'));

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
            event.target.closest('#map-zoom-controls')
        ) {
            return;
        }

        // Sol tık: mevcut pan davranışı aynen korunuyor.
        if (event.button === 0) {
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

function bindMapPortEvents(box) {
    const ports = box.querySelectorAll('.map-port');

    ports.forEach((portEl) => {
        portEl.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();

const sourcePort = portEl.dataset.port;
const sourceId = box.dataset.nodeId;
const connectionData = getConnectionDataFromEvent(event);

currentConnectionDrag = {
    sourceBox: box,
    sourceId,
    sourcePort,
    startClientX: event.clientX,
    startClientY: event.clientY,
    ...connectionData
};

            portEl.classList.add('connecting-source');

        const mouse = getMousePointInCanvas(event);
        const temp = ensureTempEdgePath();

        if (temp) {
            temp.setAttribute('d', makeTempConnectionPath(box, sourcePort, mouse));
        }
        });
    });
}

window.addEventListener('mousemove', (event) => {
    if (!currentConnectionDrag) return;

    const mouse = getMousePointInCanvas(event);
    const temp = ensureTempEdgePath();

    if (temp) {
    temp.setAttribute(
        'd',
        makeTempConnectionPath(
            currentConnectionDrag.sourceBox,
            currentConnectionDrag.sourcePort,
            mouse
        )
    );
    }
});

window.addEventListener('mouseup', async (event) => {
    if (!currentConnectionDrag) return;

    const targetPortEl = event.target.closest?.('.map-port');
    const sourcePortEl = currentConnectionDrag.sourceBox.querySelector(
        `.map-port.${currentConnectionDrag.sourcePort}`
    );

    sourcePortEl?.classList.remove('connecting-source');

    const clickDistance = Math.abs(event.clientX - (currentConnectionDrag.startClientX || event.clientX)) +
        Math.abs(event.clientY - (currentConnectionDrag.startClientY || event.clientY));

    if (targetPortEl === sourcePortEl && clickDistance <= 4 && currentConnectionDrag.type === 'down-hub') {
        toggleHubConnectionsFromPort(
            currentConnectionDrag.sourceId,
            currentConnectionDrag.sourcePort
        );

        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

    if (!targetPortEl) {
        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

    const targetBox = targetPortEl.closest('.map-node-box');

    if (!targetBox) {
        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

    const targetId = targetBox.dataset.nodeId;
    const targetPort = targetPortEl.dataset.port;

    if (targetId === currentConnectionDrag.sourceId) {
        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

let edgePayload = {
    sourceId: currentConnectionDrag.sourceId,
    targetId,
    sourcePort: currentConnectionDrag.sourcePort,
    targetPort,

    type: currentConnectionDrag.type,
    sourceRole: currentConnectionDrag.sourceRole,
    targetRole: currentConnectionDrag.targetRole
};

edgePayload = enforceSingleParentForTarget(edgePayload, activeMapEdges);

    suppressNextFileSystemRefresh(1500);

    const result = await window.kediProject?.upsertMapConnection?.(
        activeMapPath,
        edgePayload
    );

    if (!result || !result.ok) {
    alert(result?.error || 'Bağlantı kaydedilemedi.');
        currentConnectionDrag = null;
        clearTempEdgePath();
    return;
    }

    activeMapEdges = result.edges || activeMapEdges;

    currentConnectionDrag = null;
    clearTempEdgePath();

    drawMapConnections();
    await refreshActiveMapTreeBranch();

});

async function deleteMapEdge(edgeId) {
    if (!activeMapPath || !edgeId) return;

    const ok = confirm('Bu bağlantı silinsin mi?');

    if (!ok) return;

    try {
        suppressNextFileSystemRefresh(8000);

        const result = await window.kediProject?.deleteMapConnection?.(
            activeMapPath,
            edgeId
        );

        if (!result || !result.ok) {
            alert(result?.error || 'Bağlantı silinemedi.');
            return;
        }

        activeMapEdges = result.edges || activeMapEdges.filter((edge) => {
            return edge.id !== edgeId;
        });

        drawMapConnections();

        if (typeof refreshActiveMapTreeBranch === 'function') {
            await refreshActiveMapTreeBranch();
        }
    } catch (error) {
        console.error('[KEDI] Bağlantı silme hatası:', error);
        alert('Bağlantı silinirken hata oluştu: ' + error.message);
    }
}

function createMapEdgeDeleteButton(edge, pathData) {
    if (!edge?.id || !pathData) return null;

    const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.setAttribute('d', pathData);

    let point;

    try {
        const length = tempPath.getTotalLength();
        point = tempPath.getPointAtLength(length / 2);
    } catch (error) {
        console.warn('[KEDI] Bağlantı silme butonu konumu hesaplanamadı:', error);
        return null;
    }

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('map-edge-delete');
    group.dataset.edgeId = edge.id;

    // DİKKAT:
    // Bu transform SVG attribute olarak kalmalı.
    // CSS tarafında .map-edge-delete üzerine transform vermiyoruz.
    group.setAttribute('transform', `translate(${point.x}, ${point.y})`);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.classList.add('map-edge-delete-hit');
    circle.setAttribute('r', '10');

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.classList.add('map-edge-delete-x');
    text.textContent = '×';
    text.setAttribute('y', '-0.5');

    group.appendChild(circle);
    group.appendChild(text);

    group.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });

    group.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        await deleteMapEdge(edge.id);
    });

    return group;
}

function drawMapConnections() {
    const svg = document.getElementById('map-connections');

    if (!svg) return;

    svg.querySelectorAll('.map-edge-group').forEach((el) => el.remove());
    svg.querySelectorAll('.map-edge').forEach((el) => el.remove());
    svg.querySelectorAll('.map-edge-hit').forEach((el) => el.remove());
    svg.querySelectorAll('.map-edge-delete').forEach((el) => el.remove());

    for (const edge of activeMapEdges) {
        if (isHubEdgeCollapsed(edge)) {
            continue;
        }

        const sourceBox = document.querySelector(
            `.map-node-box[data-node-id="${CSS.escape(edge.sourceId)}"]`
        );

        const targetBox = document.querySelector(
            `.map-node-box[data-node-id="${CSS.escape(edge.targetId)}"]`
        );

        if (!sourceBox || !targetBox) continue;

        const sourcePort = edge.sourcePort || 'right';
        const targetPort = edge.targetPort || 'left';

        const pathData = makeConnectionPathFromBoxes(
            sourceBox,
            sourcePort,
            targetBox,
            targetPort,
            edge.type
        );

        const groupEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        groupEl.classList.add('map-edge-group');
        groupEl.dataset.edgeId = edge.id;

        // Görünmez kalın path: hover/click alanını büyütür.
        const hitPathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitPathEl.classList.add('map-edge-hit');
        hitPathEl.dataset.edgeId = edge.id;
        hitPathEl.setAttribute('d', pathData);

        // Görünen gerçek çizgi.
        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.classList.add('map-edge', getConnectionClass(edge));
        pathEl.dataset.edgeId = edge.id;
        pathEl.setAttribute('d', pathData);

        const deleteEl = createMapEdgeDeleteButton(edge, pathData);

        groupEl.appendChild(hitPathEl);
        groupEl.appendChild(pathEl);

        if (deleteEl) {
            groupEl.appendChild(deleteEl);
        }

        svg.appendChild(groupEl);
    }
}