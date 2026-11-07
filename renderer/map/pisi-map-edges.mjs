import { registerModule } from '../core/module-registry.mjs';

async function persistPisiMapConnection(edgePayload) {
    suppressNextFileSystemRefresh(1500);
    const historyMapPath = activeMapPath;
    const previousEdges = Array.isArray(activeMapEdges) ? activeMapEdges.map((edge) => ({ ...edge })) : [];

    let result = await window.pisiProject?.upsertMapConnection?.(activeMapPath, edgePayload);

    if (result?.code === 'SECOND_PARENT_CONFIRM_REQUIRED') {
        const confirmed = await pisiConfirm('Bu notun zaten bir üst notu var. Bağlantı hiyerarşi yerine stream ilişkisi olarak kaydedilsin mi?', {
            title: 'İkinci üst not',
            confirmText: 'Stream olarak ekle'
        });

        if (!confirmed) {
            return {
                ok: false,
                cancelled: true
            };
        }

        result = await window.pisiProject?.upsertMapConnection?.(activeMapPath, {
            ...(result.suggestedEdge || edgePayload),
            confirmSecondParentAsStream: true
        });
    }

    if (!result?.ok) return result;

    activeMapEdges = result.edges || activeMapEdges;
    const previousEdge = edgePayload?.id ? previousEdges.find((edge) => edge.id === edgePayload.id) : null;
    const savedEdge = previousEdge
        ? activeMapEdges.find((edge) => edge.id === previousEdge.id)
        : activeMapEdges.find((edge) => !previousEdges.some((old) => old.id === edge.id));
    window.recordPisiMapHistoryEdge?.(historyMapPath, previousEdge ? 'edge-change' : 'edge-add', previousEdge, savedEdge);
    drawMapConnections();
    await refreshActiveMapTreeBranch();
    return result;
}

let pisiKeyboardConnectionSource = null;
let pisiMapEdgeMenu = null;
let pisiMapEdgeMenuAnchor = null;
let pisiMapEdgeMenuEdgeId = null;

const PISI_MAP_EDGE_TYPE_OPTIONS = Object.freeze([
    {
        type: 'down-hub',
        label: 'Hub bağlantı',
        sourceRole: 'down-hub',
        targetRole: 'up-hub'
    },
    {
        type: 'co-level',
        label: 'Co-level bağlantı',
        sourceRole: 'co-level',
        targetRole: 'co-level'
    },
    {
        type: 'stream',
        label: 'Stream bağlantı',
        sourceRole: 'downstream',
        targetRole: 'upstream'
    }
]);

function translatePisiMapEdgeMenuText(value) {
    return window.pisiI18n?.translate?.(value) || String(value || '');
}

function getPisiMapEdgeById(edgeId) {
    return Array.isArray(activeMapEdges) ? activeMapEdges.find((edge) => edge?.id === edgeId) || null : null;
}

function closePisiMapEdgeMenu() {
    pisiMapEdgeMenu?.remove?.();
    pisiMapEdgeMenu = null;
    pisiMapEdgeMenuEdgeId = null;
    if (pisiMapEdgeMenuAnchor) {
        pisiMapEdgeMenuAnchor.setAttribute('aria-expanded', 'false');
    }
    pisiMapEdgeMenuAnchor = null;
}

function positionPisiMapEdgeMenu(menu, anchor) {
    if (!menu || !anchor?.getBoundingClientRect) return;

    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const width = menu.offsetWidth || 190;
    const height = menu.offsetHeight || 170;

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(margin, Math.min(left, Math.max(margin, window.innerWidth - width - margin)));

    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - height - gap);
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function prunePisiStaleCollapsedHubPorts() {
    if (typeof getCollapsedHubPortSet !== 'function' || typeof hasOutgoingHubEdgesFromPort !== 'function') {
        return false;
    }

    const collapsed = getCollapsedHubPortSet();
    if (!(collapsed instanceof Set)) return false;

    let changed = false;
    for (const key of Array.from(collapsed)) {
        const [nodeId, port] = String(key || '').split('::');
        if (!nodeId || !port || hasOutgoingHubEdgesFromPort(nodeId, port)) {
            continue;
        }
        collapsed.delete(key);
        changed = true;
    }

    if (typeof syncHubPortCollapseVisuals === 'function') {
        syncHubPortCollapseVisuals();
    }
    if (changed && typeof saveActiveMapCameraSoon === 'function') {
        saveActiveMapCameraSoon();
    }
    return changed;
}

async function changePisiMapEdgeType(edgeId, nextType) {
    const edge = getPisiMapEdgeById(edgeId);
    const option = PISI_MAP_EDGE_TYPE_OPTIONS.find((candidate) => candidate.type === nextType);

    if (!activeMapPath || !edge || !option) {
        return {
            ok: false,
            error: 'Bağlantı tipi değiştirilemedi.'
        };
    }

    if (edge.type === option.type) {
        return {
            ok: true,
            unchanged: true,
            edge
        };
    }

    const wasSelected = selectedMapEdgeId === edgeId;
    const result = await persistPisiMapConnection({
        ...edge,
        id: edge.id,
        type: option.type,
        sourceRole: option.sourceRole,
        targetRole: option.targetRole
    });

    if (!result?.ok) {
        if (!result?.cancelled) {
            pisiNotifyError(result?.error || 'Bağlantı tipi değiştirilemedi.');
        }
        return result;
    }

    prunePisiStaleCollapsedHubPorts();

    if (wasSelected && getPisiMapEdgeById(edgeId)) {
        selectPisiMapEdge(edgeId);
    }

    return result;
}

function makePisiMapEdgeMenuOption(edge, option) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pisi-map-edge-menu-option pisi-map-edge-menu-type';
    button.dataset.edgeType = option.type;
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', edge.type === option.type ? 'true' : 'false');
    button.classList.toggle('current', edge.type === option.type);

    const swatch = document.createElement('span');
    swatch.className = `pisi-map-edge-menu-swatch ${option.type}`;
    swatch.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = translatePisiMapEdgeMenuText(option.label);

    button.append(swatch, label);
    button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        closePisiMapEdgeMenu();
        await changePisiMapEdgeType(edge.id, option.type);
    });
    return button;
}

function openPisiMapEdgeMenu(edgeId, anchor) {
    const edge = getPisiMapEdgeById(edgeId);
    if (!edge || !anchor) return false;

    closePisiMapEdgeMenu();
    selectPisiMapEdge(edgeId);

    const menu = document.createElement('div');
    menu.className = 'pisi-map-edge-menu';
    menu.dataset.edgeId = edgeId;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', translatePisiMapEdgeMenuText('Bağlantı seçenekleri'));

    const typeLabel = document.createElement('div');
    typeLabel.className = 'pisi-map-edge-menu-label';
    typeLabel.textContent = translatePisiMapEdgeMenuText('Bağlantı tipi');
    menu.appendChild(typeLabel);

    for (const option of PISI_MAP_EDGE_TYPE_OPTIONS) {
        menu.appendChild(makePisiMapEdgeMenuOption(edge, option));
    }

    const separator = document.createElement('div');
    separator.className = 'pisi-map-edge-menu-separator';
    separator.setAttribute('role', 'separator');
    menu.appendChild(separator);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'pisi-map-edge-menu-option pisi-map-edge-menu-delete';
    deleteButton.setAttribute('role', 'menuitem');
    deleteButton.textContent = translatePisiMapEdgeMenuText('Bağlantıyı sil');
    deleteButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        closePisiMapEdgeMenu();
        await deleteMapEdge(edgeId);
    });
    menu.appendChild(deleteButton);

    menu.addEventListener('mousedown', (event) => {
        event.stopPropagation();
    });

    document.body.appendChild(menu);
    pisiMapEdgeMenu = menu;
    pisiMapEdgeMenuAnchor = anchor;
    pisiMapEdgeMenuEdgeId = edgeId;
    anchor.setAttribute('aria-expanded', 'true');

    requestAnimationFrame(() => {
        if (pisiMapEdgeMenu !== menu) return;
        positionPisiMapEdgeMenu(menu, anchor);
        menu.querySelector('.pisi-map-edge-menu-type.current')?.focus?.();
    });
    return true;
}

function bindPisiMapEdgeMenuDismissal() {
    document.addEventListener(
        'pointerdown',
        (event) => {
            if (!pisiMapEdgeMenu) return;
            if (pisiMapEdgeMenu.contains(event.target) || pisiMapEdgeMenuAnchor?.contains?.(event.target)) {
                return;
            }
            closePisiMapEdgeMenu();
        },
        true
    );

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closePisiMapEdgeMenu();
        }
    });

    window.addEventListener('resize', closePisiMapEdgeMenu);
    window.addEventListener('blur', closePisiMapEdgeMenu);
}

bindPisiMapEdgeMenuDismissal();

function notifyPisiMapCustomizationContextChanged() {
    document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));
}

function selectPisiMapEdge(edgeId) {
    if (!edgeId) return false;
    const edgeExists = Array.isArray(activeMapEdges) && activeMapEdges.some((edge) => edge?.id === edgeId);
    if (!edgeExists) return false;

    clearSelectedMapNodes();
    selectedMapEdgeId = edgeId;
    document.querySelectorAll('.map-edge-group[data-edge-id]').forEach((group) => {
        group.classList.toggle('selected', group.dataset.edgeId === edgeId);
    });
    notifyPisiMapCustomizationContextChanged();
    return true;
}

function resetPisiMapConnectionInteractions() {
    closePisiMapEdgeMenu();
    pisiKeyboardConnectionSource?.portEl?.classList.remove('connecting-source');
    pisiKeyboardConnectionSource = null;

    const sourcePort = currentConnectionDrag?.sourcePort;
    if (sourcePort) {
        currentConnectionDrag.sourceBox?.querySelector?.(`.map-port.${CSS.escape(sourcePort)}`)?.classList?.remove('connecting-source');
    }
    currentConnectionDrag = null;

    currentMapBoxSelection?.element?.remove?.();
    currentMapBoxSelection = null;
    clearTempEdgePath();
    const hadSelectedEdge = Boolean(selectedMapEdgeId);
    selectedMapEdgeId = null;
    document.querySelectorAll('.map-edge-group.selected').forEach((group) => {
        group.classList.remove('selected');
    });
    if (hadSelectedEdge) notifyPisiMapCustomizationContextChanged();
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

        portEl.addEventListener('keydown', async (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();

            if (!pisiKeyboardConnectionSource) {
                pisiKeyboardConnectionSource = {
                    box,
                    portEl,
                    sourceId: box.dataset.nodeId,
                    sourcePort: portEl.dataset.port,
                    ...getConnectionDataFromEvent(event)
                };
                portEl.classList.add('connecting-source');
                portEl.setAttribute('aria-label', 'Bağlantı kaynağı seçildi; hedef portta Enter’a bas');
                return;
            }

            const source = pisiKeyboardConnectionSource;
            source.portEl.classList.remove('connecting-source');
            source.portEl.setAttribute('aria-label', `${source.sourcePort} bağlantı portu`);
            pisiKeyboardConnectionSource = null;

            if (source.box === box && source.portEl === portEl) {
                toggleHubConnectionsFromPort(source.sourceId, source.sourcePort);
                return;
            }

            if (source.sourceId === box.dataset.nodeId) return;

            const result = await persistPisiMapConnection({
                sourceId: source.sourceId,
                targetId: box.dataset.nodeId,
                sourcePort: source.sourcePort,
                targetPort: portEl.dataset.port,
                type: source.type,
                sourceRole: source.sourceRole,
                targetRole: source.targetRole
            });

            if (!result?.ok && !result?.cancelled) {
                pisiNotifyError(result?.error || 'Bağlantı kaydedilemedi.');
            }
        });
    });
}

async function deleteMapEdge(edgeId) {
    if (!activeMapPath || !edgeId) return;

    closePisiMapEdgeMenu();

    // Bağlantı sürükleme/seçim durumunu temizle; global focus'u body'ye
    // taşımıyoruz. Confirm diyaloğu kendi focus yaşam döngüsünü yönetiyor.
    resetPisiMapConnectionInteractions();

    const ok = await pisiConfirm('Bu bağlantı silinsin mi?', {
        title: 'Bağlantıyı sil',
        confirmText: 'Sil',
        danger: true
    });

    if (!ok) {
        resetPisiMapConnectionInteractions();
        return;
    }

    try {
        suppressNextFileSystemRefresh(8000);

        const deletedEdge = Array.isArray(activeMapEdges) ? activeMapEdges.find((edge) => edge.id === edgeId) : null;
        const result = await window.pisiProject?.deleteMapConnection?.(activeMapPath, edgeId);

        if (!result || !result.ok) {
            pisiNotifyError(result?.error || 'Bağlantı silinemedi.');
            return;
        }

        window.recordPisiMapHistoryEdge?.(activeMapPath, 'edge-delete', deletedEdge ? { ...deletedEdge } : null, null);

        activeMapEdges =
            result.edges ||
            activeMapEdges.filter((edge) => {
                return edge.id !== edgeId;
            });

        prunePisiStaleCollapsedHubPorts();
        drawMapConnections();

        if (typeof refreshActiveMapTreeBranch === 'function') {
            await refreshActiveMapTreeBranch();
        }
    } catch (error) {
        console.error('[PISI] Bağlantı silme hatası:', error);
        pisiNotifyError('Bağlantı silinirken hata oluştu.', { detail: error?.message });
    } finally {
        // Burada yalnızca map bağlantı etkileşim durumunu temizliyoruz.
        // Gecikmeli refocus, yeni açılan rename input/editor odağını çalıyordu.
        resetPisiMapConnectionInteractions();
    }
}

function createMapEdgeDeleteButton(edge, pathData) {
    if (!edge?.id || !pathData) return null;

    const point = getMapEdgePathMidpoint(pathData);
    if (!point) return null;

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('map-edge-menu-trigger');
    group.dataset.edgeId = edge.id;
    group.setAttribute('transform', `translate(${point.x}, ${point.y})`);
    group.setAttribute('role', 'button');
    group.setAttribute('tabindex', '0');
    group.setAttribute('aria-haspopup', 'menu');
    group.setAttribute('aria-expanded', 'false');
    group.setAttribute('aria-label', 'Bağlantı seçenekleri');

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.classList.add('map-edge-menu-hit');
    circle.setAttribute('r', '10');

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.classList.add('map-edge-menu-dots');
    text.textContent = '⋯';
    text.setAttribute('y', '-1');

    group.appendChild(circle);
    group.appendChild(text);

    group.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });

    const toggleMenu = (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (pisiMapEdgeMenu && pisiMapEdgeMenuEdgeId === edge.id && pisiMapEdgeMenuAnchor === group) {
            closePisiMapEdgeMenu();
            return;
        }
        openPisiMapEdgeMenu(edge.id, group);
    };

    group.addEventListener('click', toggleMenu);
    group.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        toggleMenu(event);
    });

    return group;
}

function getMapEdgePathMidpoint(pathData) {
    const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.setAttribute('d', pathData);

    try {
        const length = tempPath.getTotalLength();
        return tempPath.getPointAtLength(length / 2);
    } catch (error) {
        console.warn('[PISI] Bağlantı menüsü konumu hesaplanamadı:', error);
        return null;
    }
}

function updateMapEdgeDeleteButtonPosition(group, pathData) {
    if (!group) return;
    const point = getMapEdgePathMidpoint(pathData);
    if (!point) return;
    group.setAttribute('transform', `translate(${point.x}, ${point.y})`);

    if (pisiMapEdgeMenu && pisiMapEdgeMenuAnchor === group) {
        positionPisiMapEdgeMenu(pisiMapEdgeMenu, group);
    }
}

let pisiConnectionDrawFrame = null;

function getPisiMapEdgeMarkerId(edgeId, role) {
    return `pisi-edge-marker-${edgeId}-${role}`;
}

function ensurePisiMapEdgeMarker(svg, edge, baseMarkerId, role, color, liveMarkerIds) {
    const markerId = getPisiMapEdgeMarkerId(edge.id, role);
    let marker = svg.querySelector(`#${CSS.escape(markerId)}`);
    if (!marker) {
        const baseMarker = svg.querySelector(`#${CSS.escape(baseMarkerId)}`);
        if (!baseMarker) return '';
        marker = baseMarker.cloneNode(true);
        marker.id = markerId;
        marker.dataset.pisiEdgeMarker = 'true';
        svg.querySelector('defs')?.appendChild(marker);
    }
    marker.querySelectorAll('path').forEach((path) => {
        path.setAttribute('fill', color);
        path.style.fill = color;
    });
    liveMarkerIds.add(markerId);
    return markerId;
}

function applyPisiMapEdgeCustomization(svg, pathEl, edge, liveMarkerIds) {
    const color = typeof getPisiMapEdgeCustomizationColor === 'function' ? getPisiMapEdgeCustomizationColor(edge) : '';
    pathEl.style.removeProperty('stroke');
    pathEl.style.removeProperty('marker-start');
    pathEl.style.removeProperty('marker-end');
    if (!color) return;

    pathEl.style.stroke = color;
    if (edge.type === 'co-level') {
        const startId = ensurePisiMapEdgeMarker(svg, edge, 'arrow-colevel-start', 'start', color, liveMarkerIds);
        const endId = ensurePisiMapEdgeMarker(svg, edge, 'arrow-colevel', 'end', color, liveMarkerIds);
        if (startId) pathEl.style.markerStart = `url(#${startId})`;
        if (endId) pathEl.style.markerEnd = `url(#${endId})`;
        return;
    }

    const baseMarkerId = edge.type === 'stream' ? 'arrow-stream' : 'arrow-downhub';
    const markerId = ensurePisiMapEdgeMarker(svg, edge, baseMarkerId, 'end', color, liveMarkerIds);
    if (markerId) pathEl.style.markerEnd = `url(#${markerId})`;
}

function bindPisiMapEdgeSelection(groupEl, hitPathEl) {
    if (groupEl.dataset.pisiSelectionBound === '1') return;
    groupEl.dataset.pisiSelectionBound = '1';
    hitPathEl.setAttribute('role', 'button');
    hitPathEl.setAttribute('tabindex', '0');
    hitPathEl.setAttribute('aria-label', 'Bağlantı');

    groupEl.addEventListener('click', (event) => {
        if (event.target.closest?.('.map-edge-menu-trigger')) return;
        event.preventDefault();
        event.stopPropagation();
        selectPisiMapEdge(groupEl.dataset.edgeId);
    });
    hitPathEl.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        selectPisiMapEdge(groupEl.dataset.edgeId);
    });
}

function scheduleDrawMapConnections() {
    if (pisiConnectionDrawFrame !== null) return;

    pisiConnectionDrawFrame = requestAnimationFrame(() => {
        pisiConnectionDrawFrame = null;
        drawMapConnections();
    });
}

// Connections are drawn in world coordinates inside #map-edge-layer, which
// carries the same transform as #map-board, so panning and zooming never
// recompute them. The SVG covers the bounds of all nodes so every path stays
// hit-testable. Paths come from layout numbers (box style, or the model for
// nodes that are not in the DOM), never from DOM measurement.
const PISI_MAP_EDGE_LAYER_PAD = 600;
const pisiMapEdgeIndex = { edges: null, byNode: new Map() };
const pisiMapPartialDraw = { ids: new Set(), frame: null };

function ensurePisiMapEdgeLayer() {
    const svg = document.getElementById('map-connections');
    if (!svg) return null;
    let layer = document.getElementById('map-edge-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'map-edge-layer';
        svg.parentNode.insertBefore(layer, svg);
        layer.appendChild(svg);
    }
    return svg;
}

function getPisiMapEdgesByNode() {
    const edges = Array.isArray(activeMapEdges) ? activeMapEdges : [];
    if (pisiMapEdgeIndex.edges !== edges) {
        pisiMapEdgeIndex.edges = edges;
        pisiMapEdgeIndex.byNode = new Map();
        for (const edge of edges) {
            for (const id of [edge.sourceId, edge.targetId]) {
                if (!pisiMapEdgeIndex.byNode.has(id)) pisiMapEdgeIndex.byNode.set(id, []);
                pisiMapEdgeIndex.byNode.get(id).push(edge);
            }
        }
    }
    return pisiMapEdgeIndex.byNode;
}

/** World rects of every node: mounted boxes win over the model's saved layout. */
function getPisiMapNodeRectLookup() {
    const boxes = new Map();
    document.querySelectorAll('#map-board .map-node-box[data-node-id]').forEach((box) => boxes.set(box.dataset.nodeId, box));
    const layouts = new Map((Array.isArray(activeMapNodes) ? activeMapNodes : []).map((node) => [node.id, node.layout]));
    return {
        boxes,
        rect(id) {
            const box = boxes.get(id);
            if (box) return getPisiMapBoxWorldRect(box);
            const layout = layouts.get(id);
            return layout
                ? { x: Number(layout.x) || 0, y: Number(layout.y) || 0, width: Number(layout.width) || 220, height: Number(layout.height) || 92 }
                : null;
        }
    };
}

function syncPisiMapEdgeLayerBounds(svg, lookup) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of Array.isArray(activeMapNodes) ? activeMapNodes : []) {
        const rect = lookup.rect(node.id);
        if (!rect) continue;
        minX = Math.min(minX, rect.x);
        minY = Math.min(minY, rect.y);
        maxX = Math.max(maxX, rect.x + rect.width);
        maxY = Math.max(maxY, rect.y + rect.height);
    }
    if (!Number.isFinite(minX)) {
        minX = 0;
        minY = 0;
        maxX = 1;
        maxY = 1;
    }
    const left = Math.floor(minX - PISI_MAP_EDGE_LAYER_PAD);
    const top = Math.floor(minY - PISI_MAP_EDGE_LAYER_PAD);
    const width = Math.ceil(maxX - minX + PISI_MAP_EDGE_LAYER_PAD * 2);
    const height = Math.ceil(maxY - minY + PISI_MAP_EDGE_LAYER_PAD * 2);
    const viewBox = `${left} ${top} ${width} ${height}`;
    if (svg.getAttribute('viewBox') === viewBox) return;
    svg.setAttribute('viewBox', viewBox);
    svg.style.left = `${left}px`;
    svg.style.top = `${top}px`;
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
}

function isPisiMapEdgeDrawable(edge, hiddenNodeIds) {
    if (isHubEdgeCollapsed(edge, hiddenNodeIds)) return false;
    const filter = window.isPisiMapEdgeInViewport;
    return typeof filter === 'function' ? filter(edge) : true;
}

function drawPisiMapEdge(svg, edge, lookup, liveMarkerIds, groups = null) {
    const sourceRect = lookup.rect(edge.sourceId);
    const targetRect = lookup.rect(edge.targetId);
    if (!sourceRect || !targetRect) return false;
    const pathData = makeConnectionPathFromBoxes(sourceRect, edge.sourcePort || 'right', targetRect, edge.targetPort || 'left', edge.type);
    let groupEl = groups ? groups.get(edge.id) || null : svg.querySelector(`.map-edge-group[data-edge-id="${CSS.escape(edge.id)}"]`);
    let hitPathEl = groupEl?.querySelector('.map-edge-hit') || null;
    let pathEl = groupEl?.querySelector('.map-edge') || null;
    let menuTriggerEl = groupEl?.querySelector('.map-edge-menu-trigger') || null;

    if (!groupEl) {
        groupEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        groupEl.classList.add('map-edge-group');
        groupEl.dataset.edgeId = edge.id;

        hitPathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitPathEl.classList.add('map-edge-hit');
        hitPathEl.dataset.edgeId = edge.id;

        pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.dataset.edgeId = edge.id;

        menuTriggerEl = createMapEdgeDeleteButton(edge, pathData);

        groupEl.appendChild(hitPathEl);
        groupEl.appendChild(pathEl);

        if (menuTriggerEl) {
            groupEl.appendChild(menuTriggerEl);
        }

        svg.appendChild(groupEl);
    }

    bindPisiMapEdgeSelection(groupEl, hitPathEl);

    if (hitPathEl.getAttribute('d') !== pathData) {
        hitPathEl.setAttribute('d', pathData);
        pathEl.setAttribute('d', pathData);
        if (menuTriggerEl) updateMapEdgeDeleteButtonPosition(menuTriggerEl, pathData);
    }
    const className = `map-edge ${getConnectionClass(edge)}`;
    if (pathEl.getAttribute('class') !== className) pathEl.setAttribute('class', className);
    applyPisiMapEdgeCustomization(svg, pathEl, edge, liveMarkerIds);
    groupEl.classList.toggle('selected', edge.id === selectedMapEdgeId);
    return true;
}

function drawMapConnections() {
    const hiddenNodeIds = syncCollapsedHubNodeVisibility();
    const svg = ensurePisiMapEdgeLayer();

    if (!svg) return;

    syncMapConnectionZoomStyles(svg);
    const lookup = getPisiMapNodeRectLookup();
    syncPisiMapEdgeLayerBounds(svg, lookup);
    const liveEdgeIds = new Set();
    const liveMarkerIds = new Set();
    const groups = new Map(Array.from(svg.querySelectorAll('.map-edge-group')).map((group) => [group.dataset.edgeId, group]));

    for (const edge of activeMapEdges) {
        if (!isPisiMapEdgeDrawable(edge, hiddenNodeIds)) continue;
        if (drawPisiMapEdge(svg, edge, lookup, liveMarkerIds, groups)) liveEdgeIds.add(edge.id);
    }

    svg.querySelectorAll('.map-edge-group').forEach((group) => {
        if (!liveEdgeIds.has(group.dataset.edgeId)) {
            if (pisiMapEdgeMenuEdgeId === group.dataset.edgeId) {
                closePisiMapEdgeMenu();
            }
            group.remove();
        }
    });

    svg.querySelectorAll('marker[data-pisi-edge-marker="true"]').forEach((marker) => {
        if (!liveMarkerIds.has(marker.id)) marker.remove();
    });

    if (selectedMapEdgeId && !liveEdgeIds.has(selectedMapEdgeId)) {
        selectedMapEdgeId = null;
        notifyPisiMapCustomizationContextChanged();
    }
}

/** Redraws only the connections touching these nodes (one drag or resize frame). */
function drawPisiMapConnectionsForNodes(nodeIds = []) {
    const svg = ensurePisiMapEdgeLayer();
    if (!svg) return;
    const byNode = getPisiMapEdgesByNode();
    const lookup = getPisiMapNodeRectLookup();
    const hiddenNodeIds = collectCollapsedHubNodeIds();
    const markers = new Set(Array.from(svg.querySelectorAll('marker[data-pisi-edge-marker="true"]')).map((marker) => marker.id));
    const done = new Set();
    for (const id of nodeIds) {
        for (const edge of byNode.get(id) || []) {
            if (done.has(edge.id)) continue;
            done.add(edge.id);
            if (isPisiMapEdgeDrawable(edge, hiddenNodeIds)) drawPisiMapEdge(svg, edge, lookup, markers);
        }
    }
}

function scheduleDrawPisiMapConnectionsForNodes(nodeIds = []) {
    for (const id of nodeIds) pisiMapPartialDraw.ids.add(id);
    if (pisiMapPartialDraw.frame !== null) return;
    pisiMapPartialDraw.frame = requestAnimationFrame(() => {
        pisiMapPartialDraw.frame = null;
        const ids = Array.from(pisiMapPartialDraw.ids);
        pisiMapPartialDraw.ids.clear();
        drawPisiMapConnectionsForNodes(ids);
    });
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    persistPisiMapConnection: {
        enumerable: true,
        get() {
            return persistPisiMapConnection;
        }
    },
    pisiKeyboardConnectionSource: {
        enumerable: true,
        get() {
            return pisiKeyboardConnectionSource;
        },
        set(value) {
            pisiKeyboardConnectionSource = value;
        }
    },
    notifyPisiMapCustomizationContextChanged: {
        enumerable: true,
        get() {
            return notifyPisiMapCustomizationContextChanged;
        }
    },
    selectPisiMapEdge: {
        enumerable: true,
        get() {
            return selectPisiMapEdge;
        }
    },
    resetPisiMapConnectionInteractions: {
        enumerable: true,
        get() {
            return resetPisiMapConnectionInteractions;
        }
    },
    bindMapPortEvents: {
        enumerable: true,
        get() {
            return bindMapPortEvents;
        }
    },
    deleteMapEdge: {
        enumerable: true,
        get() {
            return deleteMapEdge;
        }
    },
    createMapEdgeDeleteButton: {
        enumerable: true,
        get() {
            return createMapEdgeDeleteButton;
        }
    },
    getMapEdgePathMidpoint: {
        enumerable: true,
        get() {
            return getMapEdgePathMidpoint;
        }
    },
    updateMapEdgeDeleteButtonPosition: {
        enumerable: true,
        get() {
            return updateMapEdgeDeleteButtonPosition;
        }
    },
    pisiConnectionDrawFrame: {
        enumerable: true,
        get() {
            return pisiConnectionDrawFrame;
        },
        set(value) {
            pisiConnectionDrawFrame = value;
        }
    },
    getPisiMapEdgeMarkerId: {
        enumerable: true,
        get() {
            return getPisiMapEdgeMarkerId;
        }
    },
    ensurePisiMapEdgeMarker: {
        enumerable: true,
        get() {
            return ensurePisiMapEdgeMarker;
        }
    },
    applyPisiMapEdgeCustomization: {
        enumerable: true,
        get() {
            return applyPisiMapEdgeCustomization;
        }
    },
    bindPisiMapEdgeSelection: {
        enumerable: true,
        get() {
            return bindPisiMapEdgeSelection;
        }
    },
    scheduleDrawMapConnections: {
        enumerable: true,
        get() {
            return scheduleDrawMapConnections;
        }
    },
    drawMapConnections: {
        enumerable: true,
        get() {
            return drawMapConnections;
        }
    },
    drawPisiMapConnectionsForNodes: {
        enumerable: true,
        get() {
            return drawPisiMapConnectionsForNodes;
        }
    },
    scheduleDrawPisiMapConnectionsForNodes: {
        enumerable: true,
        get() {
            return scheduleDrawPisiMapConnectionsForNodes;
        }
    }
});
registerModule('map.edges', moduleApi);
