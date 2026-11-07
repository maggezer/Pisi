import { registerModule } from '../core/module-registry.mjs';
import { isPisiHierarchyEdge } from './pisi-map-collapse-core.mjs';
import {
    getConnectionDataFromEvent,
    convertEdgeToStream,
    getConnectionClass,
    getPortDirection,
    offsetPoint,
    getDistance,
    getClientSelectionRect,
    rectsIntersect,
    rectContainsRect
} from './pisi-map-interaction-helpers.mjs';
import {
    getCollapsedHubPortSet,
    makeCollapsedHubPortKey,
    hasOutgoingHubEdgesFromPort,
    collectCollapsedHubNodeIds,
    syncCollapsedHubNodeVisibility,
    isHubEdgeCollapsed,
    syncHubPortCollapseVisuals,
    toggleHubConnectionsFromPort
} from './pisi-map-hub-interactions.mjs';
import {
    getPisiMapBoxWorldRect,
    getPortPoint,
    getMousePointInCanvas,
    getMapConnectionVisualMetrics,
    syncMapConnectionZoomStyles,
    makeConnectionPathFromBoxes,
    makeTempConnectionPath,
    ensureTempEdgePath,
    clearTempEdgePath
} from './pisi-map-connection-interactions.mjs';
import {
    applyMapCamera,
    clampMapZoom,
    zoomMapAtClientPoint,
    zoomMapFromCenter,
    saveActiveMapCameraSoon,
    scheduleMapCameraSave,
    flushActiveMapCameraSave,
    bindMapZoomEvents,
    bindMapZoomControls,
    bindHoldZoomButton
} from './pisi-map-camera-interactions.mjs';
import {
    clearSelectedMapNodes,
    getSelectedMapNodeBoxes,
    applyMapBoxSelection,
    updateMapSelectionBoxVisual,
    setupMapCanvasPan
} from './pisi-map-canvas-interactions.mjs';
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

function isHierarchyEdge(edge) {
    return isPisiHierarchyEdge(edge);
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
        console.warn('[PISI] Hedef node zaten bir up-hub bağlantısına sahip. Yeni bağlantı stream olarak kaydedildi.');

        return convertEdgeToStream(edge);
    }

    return edge;
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    getTreeItemDisplayName: {
        enumerable: true,
        get() {
            return getTreeItemDisplayName;
        }
    },
    getConnectionDataFromEvent: {
        enumerable: true,
        get() {
            return getConnectionDataFromEvent;
        }
    },
    isHierarchyEdge: {
        enumerable: true,
        get() {
            return isHierarchyEdge;
        }
    },
    getCollapsedHubPortSet: {
        enumerable: true,
        get() {
            return getCollapsedHubPortSet;
        }
    },
    makeCollapsedHubPortKey: {
        enumerable: true,
        get() {
            return makeCollapsedHubPortKey;
        }
    },
    hasOutgoingHubEdgesFromPort: {
        enumerable: true,
        get() {
            return hasOutgoingHubEdgesFromPort;
        }
    },
    collectCollapsedHubNodeIds: {
        enumerable: true,
        get() {
            return collectCollapsedHubNodeIds;
        }
    },
    syncCollapsedHubNodeVisibility: {
        enumerable: true,
        get() {
            return syncCollapsedHubNodeVisibility;
        }
    },
    isHubEdgeCollapsed: {
        enumerable: true,
        get() {
            return isHubEdgeCollapsed;
        }
    },
    syncHubPortCollapseVisuals: {
        enumerable: true,
        get() {
            return syncHubPortCollapseVisuals;
        }
    },
    toggleHubConnectionsFromPort: {
        enumerable: true,
        get() {
            return toggleHubConnectionsFromPort;
        }
    },
    convertEdgeToStream: {
        enumerable: true,
        get() {
            return convertEdgeToStream;
        }
    },
    targetAlreadyHasUpHub: {
        enumerable: true,
        get() {
            return targetAlreadyHasUpHub;
        }
    },
    enforceSingleParentForTarget: {
        enumerable: true,
        get() {
            return enforceSingleParentForTarget;
        }
    },
    getConnectionClass: {
        enumerable: true,
        get() {
            return getConnectionClass;
        }
    },
    getPisiMapBoxWorldRect: {
        enumerable: true,
        get() {
            return getPisiMapBoxWorldRect;
        }
    },
    getPortPoint: {
        enumerable: true,
        get() {
            return getPortPoint;
        }
    },
    getMousePointInCanvas: {
        enumerable: true,
        get() {
            return getMousePointInCanvas;
        }
    },
    getPortDirection: {
        enumerable: true,
        get() {
            return getPortDirection;
        }
    },
    offsetPoint: {
        enumerable: true,
        get() {
            return offsetPoint;
        }
    },
    getDistance: {
        enumerable: true,
        get() {
            return getDistance;
        }
    },
    getMapConnectionVisualMetrics: {
        enumerable: true,
        get() {
            return getMapConnectionVisualMetrics;
        }
    },
    syncMapConnectionZoomStyles: {
        enumerable: true,
        get() {
            return syncMapConnectionZoomStyles;
        }
    },
    makeConnectionPathFromBoxes: {
        enumerable: true,
        get() {
            return makeConnectionPathFromBoxes;
        }
    },
    makeTempConnectionPath: {
        enumerable: true,
        get() {
            return makeTempConnectionPath;
        }
    },
    ensureTempEdgePath: {
        enumerable: true,
        get() {
            return ensureTempEdgePath;
        }
    },
    clearTempEdgePath: {
        enumerable: true,
        get() {
            return clearTempEdgePath;
        }
    },
    applyMapCamera: {
        enumerable: true,
        get() {
            return applyMapCamera;
        }
    },
    clampMapZoom: {
        enumerable: true,
        get() {
            return clampMapZoom;
        }
    },
    zoomMapAtClientPoint: {
        enumerable: true,
        get() {
            return zoomMapAtClientPoint;
        }
    },
    zoomMapFromCenter: {
        enumerable: true,
        get() {
            return zoomMapFromCenter;
        }
    },
    saveActiveMapCameraSoon: {
        enumerable: true,
        get() {
            return saveActiveMapCameraSoon;
        }
    },
    scheduleMapCameraSave: {
        enumerable: true,
        get() {
            return scheduleMapCameraSave;
        }
    },
    flushActiveMapCameraSave: {
        enumerable: true,
        get() {
            return flushActiveMapCameraSave;
        }
    },
    bindMapZoomEvents: {
        enumerable: true,
        get() {
            return bindMapZoomEvents;
        }
    },
    bindMapZoomControls: {
        enumerable: true,
        get() {
            return bindMapZoomControls;
        }
    },
    bindHoldZoomButton: {
        enumerable: true,
        get() {
            return bindHoldZoomButton;
        }
    },
    clearSelectedMapNodes: {
        enumerable: true,
        get() {
            return clearSelectedMapNodes;
        }
    },
    getSelectedMapNodeBoxes: {
        enumerable: true,
        get() {
            return getSelectedMapNodeBoxes;
        }
    },
    getClientSelectionRect: {
        enumerable: true,
        get() {
            return getClientSelectionRect;
        }
    },
    rectsIntersect: {
        enumerable: true,
        get() {
            return rectsIntersect;
        }
    },
    rectContainsRect: {
        enumerable: true,
        get() {
            return rectContainsRect;
        }
    },
    applyMapBoxSelection: {
        enumerable: true,
        get() {
            return applyMapBoxSelection;
        }
    },
    updateMapSelectionBoxVisual: {
        enumerable: true,
        get() {
            return updateMapSelectionBoxVisual;
        }
    },
    setupMapCanvasPan: {
        enumerable: true,
        get() {
            return setupMapCanvasPan;
        }
    }
});
registerModule('map.interactions', moduleApi);
