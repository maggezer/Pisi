// ==========================================
// KEDI CANVAS CORE (Fiziksel Motor)
// ==========================================

function updateCanvas() {
    const board = document.getElementById('canvas-board');
    const bg = document.getElementById('canvas-bg');
    if (!board || !bg) return; 

    board.style.transform = `translate(${window.camera.x}px, ${window.camera.y}px) scale(${window.camera.zoom})`;
    bg.style.backgroundPosition = `${window.camera.x}px ${window.camera.y}px`;
    bg.style.backgroundSize = `${30 * window.camera.zoom}px ${30 * window.camera.zoom}px`;
    if (typeof drawAllConnections === 'function') drawAllConnections();
}

function makeBoxDraggable(boxElement) {
    let activeBox = null, boxOffsetX = 0, boxOffsetY = 0;

    boxElement.addEventListener('mousedown', (e) => {
        // Fokuslanmış kutu veya butonlara tıklandıysa sürüklemeyi engelle
        if (e.target.classList.contains('box-close') || 
            e.target.classList.contains('open-modal-btn') || 
            e.target.classList.contains('box-port') || 
            e.target.classList.contains('box-title')) return;
        
        activeBox = boxElement;
        activeBox.classList.add('dragging'); 
        
        document.querySelectorAll('.canvas-box').forEach(n => n.style.zIndex = 10);
        activeBox.style.zIndex = 20;

        const rect = activeBox.getBoundingClientRect();
        boxOffsetX = (e.clientX - rect.left) / window.camera.zoom;
        boxOffsetY = (e.clientY - rect.top) / window.camera.zoom;

        const onMouseMove = (moveE) => {
            if (!activeBox) return;
            const viewport = document.getElementById('canvas-viewport');
            const vRect = viewport.getBoundingClientRect();
            const x = (moveE.clientX - vRect.left - window.camera.x) / window.camera.zoom - boxOffsetX;
            const y = (moveE.clientY - vRect.top - window.camera.y) / window.camera.zoom - boxOffsetY;
            activeBox.style.left = `${x}px`;
            activeBox.style.top = `${y}px`;
            if (typeof drawSpecificConnections === 'function') drawSpecificConnections(activeBox.id);
        };

        const onMouseUp = () => {
            if (activeBox) {
                activeBox.classList.remove('dragging');
                activeBox = null;
                if (typeof triggerCanvasSave === 'function') triggerCanvasSave();
            }
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

// Global'e aç
window.updateCanvas = updateCanvas;
window.makeBoxDraggable = makeBoxDraggable;