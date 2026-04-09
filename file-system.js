// ==========================================
// DOSYA SİSTEMİ VE KLASİK EDİTÖR MOTORU (file-system.js)
// ==========================================

// Global değişkenleri window üzerinden alıyoruz (app.js'de tanımlandılar)
const classicEditorContainer = document.getElementById('classic-editor-container');
const myEditor = document.getElementById('myEditor');
const tabsDivLeft = document.getElementById('tabs-left');
const contextMenu = document.getElementById('context-menu');
const ctxDeleteFile = document.getElementById('ctx-delete-file');

let openTabs = [];
let targetCreatePath = null;
let fileToDelete = null;

// Hafıza Değişkenleri - Sadece bu dosyaya özel
let currentSortMode = 'name'; 
let manualOrder = JSON.parse(localStorage.getItem('kedi_manual_order') || '{}');
let nodeToRename = null; 

function hideWelcome() { 
    const welcomeScreen = document.getElementById('welcome-screen');
    if(welcomeScreen) welcomeScreen.style.display = 'none'; 
}

function showClassicEditor() { 
    hideWelcome(); 
    const viewport = document.getElementById('canvas-viewport');
    if(viewport) viewport.style.display = 'none'; 
    if(classicEditorContainer) classicEditorContainer.style.display = 'flex'; 
    const saveStatus = document.getElementById('save-status');
    if(saveStatus) saveStatus.innerText = "Klasik Düzenleyici"; 
    window.currentCanvasFile = null; 
}

function showCanvasView() { 
    hideWelcome(); 
    if(classicEditorContainer) classicEditorContainer.style.display = 'none'; 
    const viewport = document.getElementById('canvas-viewport');
    if(viewport) viewport.style.display = 'block'; 
    if(typeof window.updateCanvas === 'function') window.updateCanvas(); 
    const saveStatus = document.getElementById('save-status');
    if(saveStatus) saveStatus.innerText = "Tuval Modu"; 
}

function loadFileToEditor(fullPath, fileName) {
    showClassicEditor();
    if (!openTabs.find(t => t.fullPath === fullPath)) { openTabs.push({ fullPath, fileName }); }
    if(myEditor) {
        myEditor.innerHTML = window.fs.readFileSync(fullPath, 'utf-8');
        myEditor.setAttribute('contenteditable', 'true'); myEditor.setAttribute('data-path', fullPath); 
    }
    renderClassicTabs();
}

function loadFileToCanvas(fullPath) {
    window.currentCanvasFile = fullPath; showCanvasView();
    const board = document.getElementById('canvas-board');
    const svgLayer = document.getElementById('canvas-lines');
    
    try {
        const content = window.fs.readFileSync(fullPath, 'utf-8');
        if (content && board) {
            const data = JSON.parse(content);
            board.innerHTML = data.board; 
            window.connections = data.connections || []; 
            window.camera = data.camera || {x:0,y:0,zoom:1}; 
            window.boxIdCounter = data.counter || 1;
            
            if(svgLayer) svgLayer.innerHTML = '<path id="temp-connection-line" class="connection-line temp-line" style="display: none; pointer-events: none;"></path>';
            board.querySelectorAll('.canvas-box').forEach(box => {
                if(typeof window.bindBoxEvents === 'function') window.bindBoxEvents(box);
            }); 

            board.querySelectorAll('.image-box-wrapper').forEach(wrapper => {
                const boxEl = wrapper.closest('.canvas-box');
                if (wrapper.querySelector('.draw-layer') && typeof initPaintEngine === 'function') {
                    initPaintEngine(boxEl);
                }
            });
        }
    } catch(e) { console.error("Canvas yükleme hatası:", e); }
    if(typeof window.updateCanvas === 'function') window.updateCanvas();
}

function renderClassicTabs() {
    if(!tabsDivLeft) return;
    tabsDivLeft.innerHTML = '';
    openTabs.forEach(tabData => {
        const tabDiv = document.createElement('div'); tabDiv.className = 'tab'; 
        if(myEditor && myEditor.getAttribute('data-path') === tabData.fullPath) tabDiv.classList.add('active');
        const titleSpan = document.createElement('span'); titleSpan.innerText = tabData.fileName.replace('.md', '');
        const closeBtn = document.createElement('button'); closeBtn.className = 'tab-close'; closeBtn.innerText = '✖';
        titleSpan.onclick = () => loadFileToEditor(tabData.fullPath, tabData.fileName);
        closeBtn.onclick = (e) => { e.stopPropagation(); closeClassicTab(tabData.fullPath); };
        tabDiv.appendChild(titleSpan); tabDiv.appendChild(closeBtn); tabsDivLeft.appendChild(tabDiv);
    });
}

function closeClassicTab(fullPath) {
    openTabs = openTabs.filter(t => t.fullPath !== fullPath);
    if (myEditor && myEditor.getAttribute('data-path') === fullPath) { 
        myEditor.innerHTML = ''; myEditor.removeAttribute('data-path'); myEditor.setAttribute('contenteditable', 'false'); 
    }
    renderClassicTabs();
}

function refreshFileList() { 
    const fileListEl = document.getElementById('file-list');
    if(!fileListEl || !window.currentHivePath) return; 
    fileListEl.innerHTML = ''; 
    const sidebarControls = document.getElementById('sidebar-controls');
    if(sidebarControls) sidebarControls.style.display = 'flex';
    buildFileTree(window.currentHivePath, fileListEl); 
}

function createInstantFile(dirPath, ext = '.md') {
    if(!dirPath) return;
    let baseName = "New Note";
    let fileName = baseName + ext;
    let counter = 1;
    while(window.fs.existsSync(window.path.join(dirPath, fileName))) {
        fileName = `${baseName} (${counter})${ext}`;
        counter++;
    }
    const fullPath = window.path.join(dirPath, fileName);
    window.fs.writeFileSync(fullPath, ext === '.md' ? "<h1>Yeni Not</h1><br>" : "");
    nodeToRename = fullPath;
    refreshFileList();
}

function handleRename(oldPath, newName, isDir) {
    if (!newName.trim()) { nodeToRename = null; return refreshFileList(); }
    const dir = window.path.dirname(oldPath);
    const ext = isDir ? '' : window.path.extname(oldPath);
    let finalName = newName.endsWith(ext) ? newName : newName + ext;
    const newPath = window.path.join(dir, finalName);
    if (oldPath !== newPath && !window.fs.existsSync(newPath)) {
        window.fs.renameSync(oldPath, newPath);
    }
    nodeToRename = null;
    refreshFileList();
}

function buildFileTree(dirPath, containerElement) {
    let items;
    try { items = window.fs.readdirSync(dirPath, { withFileTypes: true }); } catch(e) { return; }
    
    let folders = items.filter(item => item.isDirectory() && item.name !== 'images' && item.name !== 'Journals');
    let validFiles = items.filter(item => item.isFile() && (item.name.endsWith('.md') || item.name.endsWith('.canvas')));
    
    folders.forEach(f => renderItem(f, dirPath, containerElement, true));
    validFiles.forEach(f => renderItem(f, dirPath, containerElement, false));
}

function renderItem(item, dirPath, containerElement, isFolder) {
    const fullPath = window.path.join(dirPath, item.name);
    const isCanvas = !isFolder && item.name.endsWith('.canvas');
    const baseName = item.name.replace(isFolder ? '' : (isCanvas ? '.canvas' : '.md'), '');
    const li = document.createElement('li'); li.className = 'tree-node';
    const itemDiv = document.createElement('div'); itemDiv.className = 'file-item'; 
    itemDiv.draggable = true;

    if (nodeToRename === fullPath) {
        const input = document.createElement('input');
        input.className = 'rename-input'; input.value = baseName;
        input.addEventListener('blur', () => handleRename(fullPath, input.value, isFolder));
        itemDiv.appendChild(input);
        setTimeout(() => { input.focus(); input.select(); }, 50);
    } else {
        itemDiv.innerHTML = `<div class="file-item-left"><span>${isFolder ? '▶' : (isCanvas ? '🌌' : '📄')}</span><span>${baseName}</span></div>`;
        itemDiv.addEventListener('click', () => {
            if (isFolder) { /* Klasör açma mantığı buraya */ }
            else if (isCanvas) loadFileToCanvas(fullPath);
            else loadFileToEditor(fullPath, item.name);
        });
    }
    li.appendChild(itemDiv);
    containerElement.appendChild(li);
}

// Window'a bağla ki app.js erişebilsin
window.refreshFileList = refreshFileList;
window.createInstantFile = createInstantFile;