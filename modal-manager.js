// ==========================================
// KEDI MODAL MANAGER (Editör Yönetimi)
// ==========================================

let activeSuperNode = null;

function openNodeEditor(boxEl) {
    activeSuperNode = boxEl;
    const overlay = document.getElementById('super-node-modal-overlay');
    const modalBody = document.getElementById('super-node-modal-body');
    const titleInput = document.getElementById('super-modal-title');
    
    const titleEl = boxEl.querySelector('.box-title');
    const contentEl = boxEl.querySelector('.text-content');
    
    titleInput.value = titleEl.innerText;
    
    // SiYuan/Blok Mantığı: Eğer içerik boşsa ilk bloğu oluştur
    if (contentEl.children.length === 0 && contentEl.innerText.trim() === "") {
        contentEl.innerHTML = '';
        if (window.NodeEngine) {
            contentEl.appendChild(window.NodeEngine.createBlock('text'));
        }
    }

    modalBody.appendChild(contentEl);
    contentEl.style.display = 'flex';
    contentEl.style.flexDirection = 'column';
    overlay.style.display = 'flex'; 
}

function closeNodeEditor() {
    if (!activeSuperNode) return;
    const overlay = document.getElementById('super-node-modal-overlay');
    const modalBody = document.getElementById('super-node-modal-body');
    const contentEl = modalBody.querySelector('.text-content');
    const titleInput = document.getElementById('super-modal-title');
    
    activeSuperNode.querySelector('.box-title').innerText = titleInput.value;
    contentEl.style.display = 'none'; 
    activeSuperNode.appendChild(contentEl);
    
    overlay.style.display = 'none'; 
    activeSuperNode = null;
    
    if (typeof window.triggerCanvasSave === 'function') window.triggerCanvasSave();
}

// Global'e aç
window.openNodeEditor = openNodeEditor;
window.closeNodeEditor = closeNodeEditor;