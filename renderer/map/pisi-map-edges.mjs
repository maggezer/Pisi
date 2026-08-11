import { registerModule } from "../core/module-registry.mjs";

async function persistPisiMapConnection(edgePayload) {
    suppressNextFileSystemRefresh(1500);

    let result = await window.pisiProject?.upsertMapConnection?.(
        activeMapPath,
        edgePayload
    );

    if (result?.code === 'SECOND_PARENT_CONFIRM_REQUIRED') {
        const confirmed = typeof pisiConfirm === 'function'
            ? await pisiConfirm(
                'Bu node zaten bir parent’a sahip. Yeni bağlantı hiyerarşi yerine stream ilişkisi olarak kaydedilsin mi?',
                {
                    title: 'İkinci parent',
                    confirmText: 'Stream olarak ekle',
                    cancelText: 'Vazgeç'
                }
            )
            : confirm(
                'Bu node zaten bir parent’a sahip. Yeni bağlantı stream olarak kaydedilsin mi?'
            );

        if (!confirmed) {
            return {
                ok: false,
                cancelled: true
            };
        }

        result = await window.pisiProject?.upsertMapConnection?.(
            activeMapPath,
            {
                ...(result.suggestedEdge || edgePayload),
                confirmSecondParentAsStream: true
            }
        );
    }

    if (!result?.ok) return result;

    activeMapEdges = result.edges || activeMapEdges;
    drawMapConnections();
    await refreshActiveMapTreeBranch();
    return result;
}

let pisiKeyboardConnectionSource = null;

function resetPisiMapConnectionInteractions() {
    pisiKeyboardConnectionSource?.portEl?.classList.remove(
        'connecting-source'
    );
    pisiKeyboardConnectionSource = null;

    const sourcePort = currentConnectionDrag?.sourcePort;
    if (sourcePort) {
        currentConnectionDrag.sourceBox
            ?.querySelector?.(`.map-port.${CSS.escape(sourcePort)}`)
            ?.classList?.remove('connecting-source');
    }
    currentConnectionDrag = null;

    currentMapBoxSelection?.element?.remove?.();
    currentMapBoxSelection = null;
    clearTempEdgePath();
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
                portEl.setAttribute(
                    'aria-label',
                    'Bağlantı kaynağı seçildi; hedef portta Enter’a bas'
                );
                return;
            }

            const source = pisiKeyboardConnectionSource;
            source.portEl.classList.remove('connecting-source');
            source.portEl.setAttribute(
                'aria-label',
                `${source.sourcePort} bağlantı portu`
            );
            pisiKeyboardConnectionSource = null;

            if (source.box === box && source.portEl === portEl) {
                toggleHubConnectionsFromPort(
                    source.sourceId,
                    source.sourcePort
                );
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
                alert(result?.error || 'Bağlantı kaydedilemedi.');
            }
        });
    });
}

async function deleteMapEdge(edgeId) {
    if (!activeMapPath || !edgeId) return;

    if (typeof resetPisiKeyboardAndPointerState === 'function') {
        resetPisiKeyboardAndPointerState();
    }

    const ok = typeof pisiConfirm === 'function'
        ? await pisiConfirm('Bu bağlantı silinsin mi?', {
            title: 'Bağlantıyı sil',
            confirmText: 'Sil',
            cancelText: 'Vazgeç',
            danger: true
        })
        : confirm('Bu bağlantı silinsin mi?');

    if (typeof resetPisiKeyboardAndPointerState === 'function') {
        resetPisiKeyboardAndPointerState();
    }

    if (!ok) {
        if (typeof refocusPisiRenderer === 'function') {
            refocusPisiRenderer();
        }
        return;
    }

    try {
        suppressNextFileSystemRefresh(8000);

        const result = await window.pisiProject?.deleteMapConnection?.(
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
        console.error('[PISI] Bağlantı silme hatası:', error);
        alert('Bağlantı silinirken hata oluştu: ' + error.message);
    } finally {
        if (typeof resetPisiKeyboardAndPointerState === 'function') {
            resetPisiKeyboardAndPointerState();
        }

        if (typeof refocusPisiRenderer === 'function') {
            refocusPisiRenderer();
            setTimeout(() => {
                refocusPisiRenderer();
            }, 80);
        }
    }
}

function createMapEdgeDeleteButton(edge, pathData) {
    if (!edge?.id || !pathData) return null;

    const point = getMapEdgePathMidpoint(pathData);
    if (!point) return null;

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('map-edge-delete');
    group.dataset.edgeId = edge.id;
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

function getMapEdgePathMidpoint(pathData) {
    const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.setAttribute('d', pathData);

    try {
        const length = tempPath.getTotalLength();
        return tempPath.getPointAtLength(length / 2);
    } catch (error) {
        console.warn('[PISI] Bağlantı silme butonu konumu hesaplanamadı:', error);
        return null;
    }
}

function updateMapEdgeDeleteButtonPosition(group, pathData) {
    if (!group) return;
    const point = getMapEdgePathMidpoint(pathData);
    if (!point) return;
    group.setAttribute('transform', `translate(${point.x}, ${point.y})`);
}

let pisiConnectionDrawFrame = null;

function scheduleDrawMapConnections() {
    if (pisiConnectionDrawFrame !== null) return;

    pisiConnectionDrawFrame = requestAnimationFrame(() => {
        pisiConnectionDrawFrame = null;
        drawMapConnections();
    });
}

function drawMapConnections() {
    const hiddenNodeIds = syncCollapsedHubNodeVisibility();
    const svg = document.getElementById('map-connections');

    if (!svg) return;

    syncMapConnectionZoomStyles(svg);
    const liveEdgeIds = new Set();

    for (const edge of activeMapEdges) {
        if (isHubEdgeCollapsed(edge, hiddenNodeIds)) {
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

        liveEdgeIds.add(edge.id);
        let groupEl = svg.querySelector(
            `.map-edge-group[data-edge-id="${CSS.escape(edge.id)}"]`
        );
        let hitPathEl = groupEl?.querySelector('.map-edge-hit') || null;
        let pathEl = groupEl?.querySelector('.map-edge') || null;
        let deleteEl = groupEl?.querySelector('.map-edge-delete') || null;

        if (!groupEl) {
            groupEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            groupEl.classList.add('map-edge-group');
            groupEl.dataset.edgeId = edge.id;

            hitPathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hitPathEl.classList.add('map-edge-hit');
            hitPathEl.dataset.edgeId = edge.id;

            pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            pathEl.dataset.edgeId = edge.id;

            deleteEl = createMapEdgeDeleteButton(edge, pathData);

            groupEl.appendChild(hitPathEl);
            groupEl.appendChild(pathEl);

            if (deleteEl) {
                groupEl.appendChild(deleteEl);
            }

            svg.appendChild(groupEl);
        }

        hitPathEl.setAttribute('d', pathData);
        pathEl.setAttribute(
            'class',
            `map-edge ${getConnectionClass(edge)}`
        );
        pathEl.setAttribute('d', pathData);

        if (deleteEl) {
            updateMapEdgeDeleteButtonPosition(deleteEl, pathData);
        }
    }

    svg.querySelectorAll('.map-edge-group').forEach((group) => {
        if (!liveEdgeIds.has(group.dataset.edgeId)) {
            group.remove();
        }
    });
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "persistPisiMapConnection": {
        enumerable: true,
        get() { return persistPisiMapConnection; }
    },
    "pisiKeyboardConnectionSource": {
        enumerable: true,
        get() { return pisiKeyboardConnectionSource; },
        set(value) { pisiKeyboardConnectionSource = value; }
    },
    "resetPisiMapConnectionInteractions": {
        enumerable: true,
        get() { return resetPisiMapConnectionInteractions; }
    },
    "bindMapPortEvents": {
        enumerable: true,
        get() { return bindMapPortEvents; }
    },
    "deleteMapEdge": {
        enumerable: true,
        get() { return deleteMapEdge; }
    },
    "createMapEdgeDeleteButton": {
        enumerable: true,
        get() { return createMapEdgeDeleteButton; }
    },
    "getMapEdgePathMidpoint": {
        enumerable: true,
        get() { return getMapEdgePathMidpoint; }
    },
    "updateMapEdgeDeleteButtonPosition": {
        enumerable: true,
        get() { return updateMapEdgeDeleteButtonPosition; }
    },
    "pisiConnectionDrawFrame": {
        enumerable: true,
        get() { return pisiConnectionDrawFrame; },
        set(value) { pisiConnectionDrawFrame = value; }
    },
    "scheduleDrawMapConnections": {
        enumerable: true,
        get() { return scheduleDrawMapConnections; }
    },
    "drawMapConnections": {
        enumerable: true,
        get() { return drawMapConnections; }
    }
});
registerModule("map.edges", moduleApi);
