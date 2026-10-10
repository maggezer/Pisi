import { getClientSelectionRect, rectsIntersect, rectContainsRect } from './pisi-map-interaction-helpers.mjs';
import { applyMapCamera, scheduleMapCameraSave } from './pisi-map-camera-interactions.mjs';

export function clearSelectedMapNodes() {
    let changed = false;
    document.querySelectorAll('.map-node-box.selected').forEach((box) => {
        changed = true;
        box.classList.remove('selected');
    });
    if (changed) {
        document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));
    }
}

export function getSelectedMapNodeBoxes() {
    return Array.from(document.querySelectorAll('.map-node-box.selected'));
}

export function applyMapBoxSelection(selectionRect) {
    clearSelectedMapNodes();
    selectedMapEdgeId = null;
    document.querySelectorAll('.map-edge-group.selected').forEach((group) => {
        group.classList.remove('selected');
    });

    const boxes = Array.from(document.querySelectorAll('.map-node-box:not(.pisi-hub-descendant-hidden)'));

    for (const box of boxes) {
        const boxRect = box.getBoundingClientRect();

        const normalizedBoxRect = {
            left: boxRect.left,
            right: boxRect.right,
            top: boxRect.top,
            bottom: boxRect.bottom
        };

        const shouldSelect =
            selectionRect.direction === 'left-to-right' ? rectsIntersect(selectionRect, normalizedBoxRect) : rectContainsRect(selectionRect, normalizedBoxRect);

        if (shouldSelect) {
            box.classList.add('selected');
        }
    }
    document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));
}

export function updateMapSelectionBoxVisual(selectionState, event) {
    const canvas = document.getElementById('map-canvas');

    if (!canvas || !selectionState?.element) return;

    const canvasRect = canvas.getBoundingClientRect();

    const selectionRect = getClientSelectionRect(selectionState.startX, selectionState.startY, event.clientX, event.clientY);

    selectionState.direction = selectionRect.direction;

    selectionState.element.style.left = `${selectionRect.left - canvasRect.left}px`;
    selectionState.element.style.top = `${selectionRect.top - canvasRect.top}px`;
    selectionState.element.style.width = `${selectionRect.width}px`;
    selectionState.element.style.height = `${selectionRect.height}px`;

    selectionState.element.classList.toggle('right-to-left', selectionRect.direction === 'right-to-left');

    selectionState.element.classList.toggle('left-to-right', selectionRect.direction === 'left-to-right');
}

export function setupMapCanvasPan() {
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
            document.querySelectorAll('.map-edge-group.selected').forEach((group) => group.classList.remove('selected'));
            document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));
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

            const moveDistance = Math.abs(event.clientX - currentMapBoxSelection.startX) + Math.abs(event.clientY - currentMapBoxSelection.startY);

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

            const selectionRect = getClientSelectionRect(selectionState.startX, selectionState.startY, event.clientX, event.clientY);

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
