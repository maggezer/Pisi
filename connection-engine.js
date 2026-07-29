'use strict';

let startPortInfo = null;
const boundPorts = new WeakSet();

function getSvgLayer() {
    return document.getElementById('canvas-lines');
}

function ensureTempLine() {
    const svg = getSvgLayer();
    if (!svg) return null;
    let tempLine = document.getElementById('temp-connection-line');
    if (!tempLine) {
        tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tempLine.id = 'temp-connection-line';
        tempLine.setAttribute('class', 'connection-line temp-line');
        tempLine.style.display = 'none';
        tempLine.style.pointerEvents = 'none';
        svg.appendChild(tempLine);
    }
    return tempLine;
}

function createConnectionId() {
    return `connection-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function drawAllConnections() {
    const svg = getSvgLayer();
    if (!svg) return;
    svg.querySelectorAll('[data-connection-id]').forEach((pathElement) => pathElement.remove());
    const tempLine = ensureTempLine();

    (Array.isArray(window.connections) ? window.connections : []).forEach((connection) => {
        const start = fastGetPortCenter(connection.sourceBox, connection.sourcePos);
        const end = fastGetPortCenter(connection.targetBox, connection.targetPos);
        if (!start || !end) return;

        if (!connection.id) connection.id = createConnectionId();
        const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathElement.setAttribute('class', 'connection-line');
        pathElement.dataset.connectionId = connection.id;
        pathElement.style.pointerEvents = 'stroke';
        pathElement.setAttribute(
            'd',
            getBezierPath(start.x, start.y, end.x, end.y, connection.sourcePos, connection.targetPos)
        );
        pathElement.addEventListener('mousedown', (event) => {
            event.stopPropagation();
            if (!window.confirm('Bağlantıyı koparmak istiyor musunuz?')) return;
            window.connections = window.connections.filter((item) => item.id !== connection.id);
            drawAllConnections();
            window.triggerCanvasSave?.();
        });
        svg.insertBefore(pathElement, tempLine);
    });
}

function drawSpecificConnections() {
    drawAllConnections();
}

function fastGetPortCenter(boxId, position) {
    const box = document.getElementById(boxId);
    if (!box) return null;

    const left = Number.parseFloat(box.style.left) || 0;
    const top = Number.parseFloat(box.style.top) || 0;
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    let localX = left;
    let localY = top;

    if (position === 'top') localX += width / 2;
    else if (position === 'bottom') {
        localX += width / 2;
        localY += height;
    } else if (position === 'left') localY += height / 2;
    else if (position === 'right') {
        localX += width;
        localY += height / 2;
    }

    return {
        x: localX * window.camera.zoom + window.camera.x,
        y: localY * window.camera.zoom + window.camera.y
    };
}

function attachPortListeners(boxElement) {
    boxElement.querySelectorAll('.box-port').forEach((port) => {
        if (boundPorts.has(port)) return;
        boundPorts.add(port);

        port.addEventListener('mousedown', (event) => {
            if (window.focusedBox || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            window.isDraggingPort = true;
            port.classList.add('active-port');
            startPortInfo = {
                boxId: boxElement.id,
                pos: port.dataset.pos,
                element: port
            };
            const tempLine = ensureTempLine();
            if (tempLine) tempLine.style.display = 'block';
            updateTempLine(event.clientX, event.clientY);
            document.body.classList.add('is-connecting');
        });

        port.addEventListener('mouseup', (event) => {
            if (!window.isDraggingPort || !startPortInfo || startPortInfo.boxId === boxElement.id) return;
            event.preventDefault();
            event.stopPropagation();
            const targetPosition = port.dataset.pos;
            const duplicate = window.connections.some((connection) =>
                (connection.sourceBox === startPortInfo.boxId && connection.targetBox === boxElement.id)
                || (connection.targetBox === startPortInfo.boxId && connection.sourceBox === boxElement.id));
            if (!duplicate) {
                window.connections.push({
                    id: createConnectionId(),
                    sourceBox: startPortInfo.boxId,
                    sourcePos: startPortInfo.pos,
                    targetBox: boxElement.id,
                    targetPos: targetPosition
                });
                drawAllConnections();
                window.triggerCanvasSave?.();
            }
        });
    });
}

function getBezierPath(startX, startY, endX, endY, startPosition, targetPosition) {
    const distance = Math.hypot(endX - startX, endY - startY);
    const curveOffset = Math.max(distance * 0.4, 40);
    let firstControlX = startX;
    let firstControlY = startY;
    let secondControlX = endX;
    let secondControlY = endY;

    if (startPosition === 'right') firstControlX += curveOffset;
    else if (startPosition === 'left') firstControlX -= curveOffset;
    else if (startPosition === 'bottom') firstControlY += curveOffset;
    else if (startPosition === 'top') firstControlY -= curveOffset;

    if (targetPosition === 'right') secondControlX += curveOffset;
    else if (targetPosition === 'left') secondControlX -= curveOffset;
    else if (targetPosition === 'bottom') secondControlY += curveOffset;
    else if (targetPosition === 'top') secondControlY -= curveOffset;

    return `M ${startX},${startY} C ${firstControlX},${firstControlY} ${secondControlX},${secondControlY} ${endX},${endY}`;
}

function updateTempLine(mouseX, mouseY) {
    if (!startPortInfo) return;
    const canvasViewport = document.getElementById('canvas-viewport');
    const start = fastGetPortCenter(startPortInfo.boxId, startPortInfo.pos);
    if (!canvasViewport || !start) return;
    const viewportRect = canvasViewport.getBoundingClientRect();
    const tempLine = ensureTempLine();
    tempLine?.setAttribute(
        'd',
        getBezierPath(
            start.x,
            start.y,
            mouseX - viewportRect.left,
            mouseY - viewportRect.top,
            startPortInfo.pos,
            null
        )
    );
}

function finishConnectionDrag() {
    if (!window.isDraggingPort) return;
    window.isDraggingPort = false;
    startPortInfo?.element.classList.remove('active-port');
    startPortInfo = null;
    const tempLine = ensureTempLine();
    if (tempLine) tempLine.style.display = 'none';
    document.body.classList.remove('is-connecting');
}

function removeBoxConnections(boxId) {
    window.connections = window.connections.filter((connection) =>
        connection.sourceBox !== boxId && connection.targetBox !== boxId);
    drawAllConnections();
}

function resetConnectionEngine() {
    finishConnectionDrag();
    const svg = getSvgLayer();
    svg?.querySelectorAll('[data-connection-id]').forEach((pathElement) => pathElement.remove());
    ensureTempLine();
}

document.addEventListener('mousemove', (event) => {
    if (window.isDraggingPort) updateTempLine(event.clientX, event.clientY);
});
window.addEventListener('mouseup', finishConnectionDrag);

window.drawAllConnections = drawAllConnections;
window.drawSpecificConnections = drawSpecificConnections;
window.attachPortListeners = attachPortListeners;
window.removeBoxConnections = removeBoxConnections;
window.resetConnectionEngine = resetConnectionEngine;
window.updateTempLine = updateTempLine;
