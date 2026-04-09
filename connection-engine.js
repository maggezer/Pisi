// 3. BAĞLANTI MOTORU (YÜKSEK PERFORMANS)
// ==========================================
let connections = []; 
let isDraggingPort = false; let startPortInfo = null; 
let pathElements = []; 

function drawAllConnections() {
    connections.forEach((conn, index) => {
        const start = fastGetPortCenter(conn.sourceBox, conn.sourcePos); 
        const end = fastGetPortCenter(conn.targetBox, conn.targetPos);
        if (!start || !end) return;

        const pathData = getBezierPath(start.x, start.y, end.x, end.y, conn.sourcePos, conn.targetPos);

        let pathEl = pathElements[index];
        if (!pathEl) {
            pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            pathEl.setAttribute('class', 'connection-line');
            pathEl.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                if(confirm("Bağlantıyı koparmak istiyor musunuz?")) { 
                    connections.splice(index, 1); 
                    pathElements.splice(index, 1);
                    e.target.remove();
                    drawAllConnections(); 
                    triggerCanvasSave(); 
                }
            });
            if(svgLayer) svgLayer.appendChild(pathEl);
            pathElements[index] = pathEl;
        }
        pathEl.setAttribute('d', pathData);
    });

    while (pathElements.length > connections.length) {
        const popped = pathElements.pop();
        if (popped && popped.parentNode) popped.parentNode.removeChild(popped);
    }
}

function drawSpecificConnections(boxId) {
    connections.forEach((conn, index) => {
        if (conn.sourceBox === boxId || conn.targetBox === boxId) {
            const start = fastGetPortCenter(conn.sourceBox, conn.sourcePos); 
            const end = fastGetPortCenter(conn.targetBox, conn.targetPos);
            if (!start || !end) return;

            const pathData = getBezierPath(start.x, start.y, end.x, end.y, conn.sourcePos, conn.targetPos);
            if (pathElements[index]) {
                pathElements[index].setAttribute('d', pathData);
            }
        }
    });
}   

function fastGetPortCenter(boxId, posStr) {
    const boxEl = document.getElementById(boxId); if (!boxEl) return null;

    const left = parseFloat(boxEl.style.left) || 0;
    const top = parseFloat(boxEl.style.top) || 0;
    const width = boxEl.offsetWidth;
    const height = boxEl.offsetHeight;

    let localX = left; let localY = top;

    if (posStr === 'top') { localX += width / 2; }
    else if (posStr === 'bottom') { localX += width / 2; localY += height; }
    else if (posStr === 'left') { localY += height / 2; }
    else if (posStr === 'right') { localX += width; localY += height / 2; }

    return {
        x: (localX * camera.zoom) + camera.x,
        y: (localY * camera.zoom) + camera.y
    };
}

function attachPortListeners(boxEl) {
    boxEl.querySelectorAll('.box-port').forEach(port => {
      port.addEventListener('mousedown', (e) => {
            if (focusedBox) return; 
            e.stopPropagation(); isDraggingPort = true; port.classList.add('active-port');
            startPortInfo = { boxId: boxEl.id, pos: port.getAttribute('data-pos'), element: port };
            
            const currentTempLine = document.getElementById('temp-connection-line');
            if (currentTempLine) currentTempLine.style.display = 'block'; 
            
            updateTempLine(e.clientX, e.clientY);
            document.body.classList.add('is-connecting');
        });
        
        port.addEventListener('mouseup', (e) => {
            if (isDraggingPort && startPortInfo && startPortInfo.boxId !== boxEl.id) {
                const targetPos = port.getAttribute('data-pos');
                const exists = connections.some(c => (c.sourceBox === startPortInfo.boxId && c.targetBox === boxEl.id) || (c.targetBox === startPortInfo.boxId && c.sourceBox === boxEl.id));
                if (!exists) {
                    connections.push({ sourceBox: startPortInfo.boxId, sourcePos: startPortInfo.pos, targetBox: boxEl.id, targetPos: targetPos });
                    drawAllConnections(); triggerCanvasSave();
                }
            }
        });
    });
}

if(viewport) {
    viewport.addEventListener('mousemove', (e) => { if (isDraggingPort) updateTempLine(e.clientX, e.clientY); });
}

window.addEventListener('mouseup', () => {
    if (isDraggingPort) {
        isDraggingPort = false; 
        if(startPortInfo) startPortInfo.element.classList.remove('active-port');
        startPortInfo = null; 
        
        const currentTempLine = document.getElementById('temp-connection-line');
        if (currentTempLine) currentTempLine.style.display = 'none';
        
        document.body.classList.remove('is-connecting');
    }
});

function getBezierPath(startX, startY, endX, endY, startPos, targetPos) {
    const distance = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
    const curveOffset = Math.max(distance * 0.4, 40); 
    let cp1x = startX, cp1y = startY; let cp2x = endX, cp2y = endY;

    if (startPos === 'right') cp1x += curveOffset; else if (startPos === 'left') cp1x -= curveOffset;
    else if (startPos === 'bottom') cp1y += curveOffset; else if (startPos === 'top') cp1y -= curveOffset;

    if (targetPos === 'right') cp2x += curveOffset; else if (targetPos === 'left') cp2x -= curveOffset;
    else if (targetPos === 'bottom') cp2y += curveOffset; else if (targetPos === 'top') cp2y -= curveOffset;

    return `M ${startX},${startY} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${endX},${endY}`;
}

function updateTempLine(mouseX, mouseY) {
    if (!startPortInfo || !viewport) return;
    const start = fastGetPortCenter(startPortInfo.boxId, startPortInfo.pos); if (!start) return;
    const vRect = viewport.getBoundingClientRect(); 
    const endX = mouseX - vRect.left; const endY = mouseY - vRect.top;
    
    const currentTempLine = document.getElementById('temp-connection-line');
    if (currentTempLine) {
        currentTempLine.setAttribute('d', getBezierPath(start.x, start.y, endX, endY, startPortInfo.pos, null));
    }
}

function removeBoxConnections(boxId) { 
    connections = connections.filter(c => c.sourceBox !== boxId && c.targetBox !== boxId); 
    pathElements.forEach(p => { if (p && p.parentNode) p.parentNode.removeChild(p); });
    pathElements = [];
}