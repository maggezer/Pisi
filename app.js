const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const moment = require('moment-hijri'); 
const { Lunar, LunarMonth } = require('lunar-javascript'); 

// ==========================================
// 0. GLOBAL DEĞİŞKENLER VE AYARLAR (KÖPRÜ)
// ==========================================
window.fs = fs;
window.path = path;
window.ipcRenderer = ipcRenderer;
window.currentHivePath = null;
window.currentCanvasFile = null;
window.camera = { x: 0, y: 0, zoom: 1 };
window.boxIdCounter = 1;
window.connections = [];

let autoSaveTimeout = null;
// TAKVİM DEĞİŞKENLERİ
const monthNames = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const hijriMonthNames = ["Muharrem", "Safer", "Rebiülevvel", "Rebiülahir", "Cemaziyelevvel", "Cemaziyelahir", "Recep", "Şaban", "Ramazan", "Şevval", "Zilkade", "Zilhicce"];
let currentCalendarType = 'gregorian'; let currentCustomPlugin = null; let customStates = {}; 

// ==========================================
// 1. BAŞLIK ÇUBUĞU VE MENÜLER
// ==========================================
const winMinBtn = document.getElementById('win-min');
if (winMinBtn) winMinBtn.addEventListener('click', () => ipcRenderer.send('window-min'));

const winMaxBtn = document.getElementById('win-max');
if (winMaxBtn) winMaxBtn.addEventListener('click', () => ipcRenderer.send('window-max'));

const winCloseBtn = document.getElementById('win-close');
if (winCloseBtn) winCloseBtn.addEventListener('click', () => ipcRenderer.send('window-close'));

const appMenu = document.getElementById('app-menu');
const appLogo = document.getElementById('app-logo');

if (appLogo && appMenu) {
    appLogo.addEventListener('click', (e) => {
        const rect = e.target.getBoundingClientRect();
        appMenu.style.display = appMenu.style.display === 'block' ? 'none' : 'block';
        appMenu.style.left = rect.left + 'px'; 
        appMenu.style.top = rect.bottom + 'px';
    });

    document.addEventListener('click', (e) => { 
        if (e.target.id !== 'app-logo' && !appMenu.contains(e.target)) {
            appMenu.style.display = 'none'; 
        }
    });
}

const prefModal = document.getElementById('preferences-modal');
const prefCalEngine = document.getElementById('pref-cal-engine');
const prefAddCustomCal = document.getElementById('pref-add-custom-cal');
const customCalStatus = document.getElementById('custom-cal-status');
const menuPreferences = document.getElementById('menu-preferences');
const prefCloseBtn = document.getElementById('pref-close');

if (menuPreferences && prefModal) {
    menuPreferences.addEventListener('click', () => {
        if (appMenu) appMenu.style.display = 'none';
        prefModal.style.display = 'flex';
        if (prefCalEngine) prefCalEngine.value = currentCalendarType;
    });
}

if (prefCloseBtn && prefModal) {
    prefCloseBtn.addEventListener('click', () => prefModal.style.display = 'none');
}

if (prefCalEngine) {
    prefCalEngine.addEventListener('change', (e) => {
        currentCalendarType = e.target.value; currentCustomPlugin = null; 
        if (customCalStatus) {
            customCalStatus.innerText = "Sistem Takvimi Kullanılıyor"; 
            customCalStatus.style.color = "#888";
        }
        if (typeof renderCalendar === 'function') renderCalendar();
    });
}

if (prefAddCustomCal) {
    prefAddCustomCal.addEventListener('click', async () => {
        const filePaths = await ipcRenderer.invoke('dialog:openFile', { filters: [{ name: 'JavaScript', extensions: ['js'] }] });
        if (filePaths && filePaths.length > 0) {
            try {
                currentCustomPlugin = require(filePaths[0]); currentCalendarType = 'custom';
                if (!customStates[currentCustomPlugin.id]) customStates[currentCustomPlugin.id] = currentCustomPlugin.getInitialState(); 
                if (customCalStatus) {
                    customCalStatus.innerText = `Aktif Eklenti: ${currentCustomPlugin.id}`; 
                    customCalStatus.style.color = "#2ecc71";
                }
                if (typeof renderCalendar === 'function') renderCalendar();
            } catch (err) { alert("Eklenti yüklenemedi."); console.error(err); }
        }
    });
}

ipcRenderer.on('change-calendar', (event, type, customPath) => {
    currentCalendarType = type;
    if (customPath) { 
        currentCustomPlugin = require(customPath); 
        if (!customStates[currentCustomPlugin.id]) customStates[currentCustomPlugin.id] = currentCustomPlugin.getInitialState(); 
        if(customCalStatus) customCalStatus.innerText = `Aktif Eklenti: ${currentCustomPlugin.id}`;
    } else { 
        currentCustomPlugin = null; 
        if(customCalStatus) customCalStatus.innerText = "Sistem Takvimi Kullanılıyor"; 
    }
    if (typeof renderCalendar === 'function') renderCalendar();
});

// ŞERİT SEKME VE DROPDOWN
document.querySelectorAll('.ribbon-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.ribbon-tab-btn, .ribbon-panel').forEach(el => el.classList.remove('active'));
        btn.classList.add('active'); 
        const targetEl = document.getElementById(btn.getAttribute('data-target'));
        if(targetEl) targetEl.classList.add('active');
    });
});

function closeAllDropdowns() { document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show')); }

const hnBtn = document.getElementById('hnBtn');
if (hnBtn) hnBtn.addEventListener('click', (e) => { e.stopPropagation(); closeAllDropdowns(); document.getElementById('hn-menu').classList.toggle('show'); });

const textColorBtn = document.getElementById('textColorBtn');
if (textColorBtn) textColorBtn.addEventListener('click', (e) => { e.stopPropagation(); closeAllDropdowns(); document.getElementById('text-color-menu').classList.toggle('show'); });

const highlightBtn = document.getElementById('highlightBtn');
if (highlightBtn) highlightBtn.addEventListener('click', (e) => { e.stopPropagation(); closeAllDropdowns(); document.getElementById('highlight-menu').classList.toggle('show'); });

document.addEventListener('click', closeAllDropdowns);

document.querySelectorAll('.hn-item, .color-swatch').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
        e.preventDefault(); 
        const cmd = e.target.getAttribute('data-cmd'); const color = e.target.getAttribute('data-color');
        if (cmd === 'foreColor' || cmd === 'backColor') { document.execCommand(cmd, false, color === 'transparent' ? 'transparent' : color); } 
        else { document.execCommand('formatBlock', false, cmd); }
        closeAllDropdowns();
    });
});

// KAYDETME KISAYOLU (Ctrl+S)
document.addEventListener('keydown', (e) => { 
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { 
        e.preventDefault(); 
        if (window.currentCanvasFile) triggerCanvasSave(true); 
        else {
            const myEditor = document.getElementById('myEditor');
            if (myEditor && myEditor.getAttribute('data-path')) {
                fs.writeFileSync(myEditor.getAttribute('data-path'), myEditor.innerHTML); 
                const saveStatus = document.getElementById('save-status');
                if(saveStatus) {
                    saveStatus.innerText = "Elle Kaydedildi!"; saveStatus.style.color = "#2ecc71"; 
                    setTimeout(() => { saveStatus.innerText = "Klasik Düzenleyici"; saveStatus.style.color = "#888"; }, 2000); 
                }
            }
        }
    } 
});

// ==========================================
// 2. YÜKSEK PERFORMANSLI TUVAL (CANVAS) MOTORU
// ==========================================
const welcomeScreen = document.getElementById('welcome-screen');
const viewport = document.getElementById('canvas-viewport');
const board = document.getElementById('canvas-board');
const bg = document.getElementById('canvas-bg');
const svgLayer = document.getElementById('canvas-lines');
const tempLine = document.getElementById('temp-connection-line');

let isPanning = false, startPanX = 0, startPanY = 0;
let focusedBox = null;
let originalBoxParent = null;
let originalBoxNextSibling = null; 



if (viewport) {
    viewport.addEventListener('mousedown', (e) => {
        if (focusedBox) return; 
        if (e.target.closest('.canvas-box') || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || (typeof isDraggingPort !== 'undefined' && isDraggingPort)) return; 
        if (e.offsetX > e.target.clientWidth || e.offsetY > e.target.clientHeight) return;
        
        isPanning = true; startPanX = e.clientX - window.camera.x; startPanY = e.clientY - window.camera.y;
    });

    viewport.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey || focusedBox) return; 
        e.preventDefault();
        const zoomSpeed = 0.1; const direction = e.deltaY > 0 ? -1 : 1;
        let newZoom = window.camera.zoom + (direction * zoomSpeed);
        if (newZoom < 0.2) newZoom = 0.2; if (newZoom > 3) newZoom = 3;
        const rect = viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
        window.camera.x = mouseX - (mouseX - window.camera.x) * (newZoom / window.camera.zoom);
        window.camera.y = mouseY - (mouseY - window.camera.y) * (newZoom / window.camera.zoom);
        window.camera.zoom = newZoom; updateCanvas();
        clearTimeout(autoSaveTimeout); autoSaveTimeout = setTimeout(triggerCanvasSave, 1000);
    }, { passive: false });
}

// KUTU SÜRÜKLEME
let activeBox = null, boxOffsetX = 0, boxOffsetY = 0;


let animationFrameId = null;

window.addEventListener('mousemove', (e) => {
    if (!isPanning && !activeBox && !(typeof isDraggingPort !== 'undefined' && isDraggingPort)) return;
    if (focusedBox) return;

    if (animationFrameId) cancelAnimationFrame(animationFrameId);

    animationFrameId = requestAnimationFrame(() => {
        if (isPanning && viewport) {
            window.camera.x = e.clientX - startPanX;
            window.camera.y = e.clientY - startPanY;
            updateCanvas();
        }

        if (activeBox && viewport) {
            const rect = viewport.getBoundingClientRect();
            const x = (e.clientX - rect.left - window.camera.x) / window.camera.zoom - boxOffsetX;
            const y = (e.clientY - rect.top - window.camera.y) / window.camera.zoom - boxOffsetY;
            activeBox.style.left = `${x}px`;
            activeBox.style.top = `${y}px`;
            if (typeof drawSpecificConnections === 'function') drawSpecificConnections(activeBox.id);
        }

        if (typeof isDraggingPort !== 'undefined' && isDraggingPort && typeof updateTempLine === 'function') {
            updateTempLine(e.clientX, e.clientY);
        }
    });
});

window.addEventListener('mouseup', () => { 
    if(isPanning) { isPanning = false; triggerCanvasSave(); } 
    if(activeBox) { 
        activeBox.classList.remove('dragging'); 
        activeBox = null; 
        triggerCanvasSave(); 
    } 
});

// TAM EKRAN MOTORU
async function toggleFocusMode(boxEl) {
    const isFS = await ipcRenderer.invoke('is-fullscreen');

    if (isFS && focusedBox === boxEl) {
        ipcRenderer.send('exit-fullscreen');
        boxEl.classList.remove('fullscreen-box');
        if (originalBoxNextSibling) { originalBoxParent.insertBefore(boxEl, originalBoxNextSibling); } 
        else if (originalBoxParent) { originalBoxParent.appendChild(boxEl); }
        const focusBtn = boxEl.querySelector('.box-focus'); if (focusBtn) focusBtn.innerHTML = '⛶';
        if(svgLayer) svgLayer.style.display = 'block'; 
        focusedBox = null; updateCanvas();
    } else {
        if (focusedBox) toggleFocusMode(focusedBox); 
        originalBoxParent = boxEl.parentNode; originalBoxNextSibling = boxEl.nextSibling;
        document.body.appendChild(boxEl); boxEl.classList.add('fullscreen-box');
        const focusBtn = boxEl.querySelector('.box-focus'); if (focusBtn) focusBtn.innerHTML = '🗗';
        if(svgLayer) svgLayer.style.display = 'none'; focusedBox = boxEl;
        ipcRenderer.send('enter-fullscreen');
    }
}

document.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape' && focusedBox) { e.preventDefault(); toggleFocusMode(focusedBox); }
});

function bindBoxEvents(boxEl) {
    makeBoxDraggable(boxEl); 
    if(typeof attachPortListeners === 'function') attachPortListeners(boxEl); 
    
    const openBtn = boxEl.querySelector('.open-modal-btn');
    const previewDiv = boxEl.querySelector('.node-preview');

    if (openBtn) {
        openBtn.addEventListener('mouseenter', () => {
            const textContent = boxEl.querySelector('.text-content');
            if (textContent && previewDiv) {
                let text = textContent.innerText.trim();
                if (!text) text = "📝 Henüz not eklenmedi...";
                if (text.length > 180) text = text.substring(0, 180) + "..."; 
                previewDiv.innerText = text;
            }
        });

        openBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            if(typeof openNodeEditor === 'function') openNodeEditor(boxEl);
            document.querySelectorAll('.canvas-box').forEach(b => b.style.borderColor = '#444');
            boxEl.style.borderColor = '#f39c12'; 
        });
    }
    
    const closeBtn = boxEl.querySelector('.box-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            
            const canvasLayer = boxEl.querySelector('.draw-layer');
            if (canvasLayer && window.currentHivePath) {
                const savedFile = canvasLayer.getAttribute('data-file');
                if (savedFile) {
                    const filePath = path.join(window.currentHivePath, 'images', savedFile);
                    if (fs.existsSync(filePath)) {
                        try { fs.unlinkSync(filePath); } catch(err) { console.error("Resim dosyası silinemedi: ", err); }
                    }
                }
            }

            if(typeof removeBoxConnections === 'function') removeBoxConnections(boxEl.id); 
            boxEl.remove(); 
            if(typeof drawAllConnections === 'function') drawAllConnections(); 
            triggerCanvasSave();
        });
    }
    
    const titleEl = boxEl.querySelector('.box-title');
    if (titleEl) {
        titleEl.addEventListener('input', () => triggerCanvasSave());
        titleEl.addEventListener('mousedown', (e) => e.stopPropagation());
        titleEl.addEventListener('click', (e) => e.stopPropagation());
    }

    const runBtn = boxEl.querySelector('.run-code-btn');
    if (runBtn) {
        runBtn.addEventListener('click', () => {
            const codeInput = boxEl.querySelector('.code-input').value;
            const outputDiv = boxEl.querySelector('.code-output');
            let logs = []; const originalLog = console.log;
            console.log = function(...args) { logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')); originalLog.apply(console, args); };
            try {
                let result = new Function(codeInput)();
                if (logs.length > 0) { outputDiv.innerHTML = logs.join('<br>'); outputDiv.style.color = "#d4d4d4"; } 
                else if (result !== undefined) { outputDiv.innerHTML = result; outputDiv.style.color = "#2ecc71"; } 
                else { outputDiv.innerHTML = "<i>Çıktı yok (Sadece tanımlandı)</i>"; outputDiv.style.color = "#888"; }
            } catch (err) { outputDiv.innerHTML = `Hata: ${err.message}`; outputDiv.style.color = "#e74c3c"; }
            console.log = originalLog; triggerCanvasSave();
        });
    }

    // Resim motorunu sadece kutu içinde tuval alanı varsa başlat
    if (boxEl.querySelector('.draw-layer') || boxEl.querySelector('.image-drop-zone')) {
        if (typeof initPaintEngine === 'function') {
            initPaintEngine(boxEl);
        }
    }
}

// Dosyaların yüklenirken veya yeni düğüm eklenirken bunu çağırması için
window.bindBoxEvents = bindBoxEvents;


function triggerCanvasSave(isManual = false) {
    if (!window.currentCanvasFile || !board) return;
    clearTimeout(autoSaveTimeout);
    
    const saveData = () => {
        const imagesDir = path.join(window.currentHivePath, 'images');
        if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

        board.querySelectorAll('.draw-layer').forEach(canvas => {
            if (canvas.getAttribute('data-modified') === 'true') { 
                const dataUrl = canvas.toDataURL('image/png');
                const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");

                let fileName = canvas.getAttribute('data-file');
                if (!fileName) {
                    fileName = `paint_${Date.now()}_${Math.floor(Math.random()*1000)}.png`;
                    canvas.setAttribute('data-file', fileName);
                }

                fs.writeFileSync(path.join(imagesDir, fileName), base64Data, 'base64');
                canvas.removeAttribute('data-modified');
            }
        });

        const data = JSON.stringify({ board: board.innerHTML, connections: window.connections, camera: window.camera, counter: window.boxIdCounter });
        fs.writeFileSync(window.currentCanvasFile, data);
        
        const saveStatus = document.getElementById('save-status');
        if(saveStatus) {
            saveStatus.innerText = "Tuval Kaydedildi"; saveStatus.style.color = "#2ecc71";
            setTimeout(() => { if(saveStatus.innerText === "Tuval Kaydedildi") { saveStatus.innerText = "Tuval Modu"; saveStatus.style.color = "#888"; } }, 2000);
        }
    };

    const saveStatus = document.getElementById('save-status');
    if (isManual) { saveData(); } 
    else { 
        if(saveStatus) { saveStatus.innerText = "Oto. Kaydediliyor..."; saveStatus.style.color = "#f39c12"; }
        autoSaveTimeout = setTimeout(saveData, 800); 
    }
}
window.triggerCanvasSave = triggerCanvasSave;

// ==========================================
// TIKLAMA OLAYLARI (DOM YÜKLENDİKTEN SONRA)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {

    const clearCanvasBtn = document.getElementById('clearCanvasBtn');
    if (clearCanvasBtn) {
        clearCanvasBtn.addEventListener('click', () => {
            if(!window.currentCanvasFile) return;
            if(confirm("Tuvaldeki her şey silinecek. Emin misin?")) {
                if(board) board.innerHTML = ''; window.connections = []; 
                if (typeof drawAllConnections === 'function') drawAllConnections(); 
                triggerCanvasSave();
            }
        });
    }

    const addNodeBtn = document.querySelector('.add-node-btn');
    if(addNodeBtn) {
        addNodeBtn.addEventListener('click', (e) => {
            if(!window.currentCanvasFile) return alert("Önce sol menüden bir Tuval (.canvas) açmalısınız!");
            
            window.boxIdCounter++;
            const newBox = document.createElement('div');
            newBox.className = `canvas-box super-box`; newBox.id = `box-${window.boxIdCounter}`;
            
            const rect = viewport ? viewport.getBoundingClientRect() : {width: 800, height: 600};
            const centerX = (rect.width / 2 - window.camera.x) / window.camera.zoom - 50; 
            const centerY = (rect.height / 2 - window.camera.y) / window.camera.zoom - 20;
            newBox.style.left = `${centerX}px`; newBox.style.top = `${centerY}px`;
            
            const contentHtml = `
                <div class="box-content super-content" style="display:none; flex-direction:column; width:100%; height:100%;">
                    
                    <div class="super-box-section">
                        <div class="super-box-section-title">📝 Düğüm Notları</div>
                        <div class="text-content" contenteditable="true" placeholder="Bu fikri detaylandırın..." style="padding:15px; min-height:80px; outline:none;"></div>
                    </div>

                    <div class="super-box-section">
                        <div class="super-box-section-title">🖼️ Çizim & Resim</div>
                        <div class="box-toolbar" style="display:flex;">
                            <button class="box-tool-btn draw-btn" onmousedown="event.preventDefault();">✏️ Kalem</button>
                            <input type="color" class="box-tool-color color-picker" value="#ff5252" style="width:24px; height:24px; padding:0; border:none; cursor:pointer; background:transparent;">
                            <input type="range" class="box-tool-size brush-size" min="1" max="20" value="3" style="width: 50px;">
                            <div style="width:1px; background:#444; margin:0 5px;"></div>
                            <button class="box-tool-btn rotate-btn" onmousedown="event.preventDefault();">🔄 Döndür</button>
                            <button class="box-tool-btn clear-draw-btn" onmousedown="event.preventDefault();">🧹 Temizle</button>
                        </div>
                        <div class="image-box-wrapper" tabindex="0" style="min-height:250px; background-color:#1e1e1e; display:flex; flex-direction:column; outline:none;">
                            <div class="image-drop-zone" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; border:2px dashed #444; padding:20px; box-sizing:border-box;">
                                <div style="display:flex; gap:10px;">
                                    <button class="btn-main blank-canvas-btn" style="padding: 8px 12px; font-size: 12px; background: #2ecc71; border:none; border-radius:4px; font-weight:bold; cursor:pointer; color:#000;">🎨 Boş Tahta Aç</button>
                                    <label class="btn-main" style="padding: 8px 12px; font-size: 12px; background: #34ace0; border:none; border-radius:4px; font-weight:bold; cursor:pointer; color:#000;">
                                        🖼️ Resim Yükle <input type="file" accept="image/*" class="image-file-input" style="display:none;">
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="super-box-section">
                         <div class="super-box-section-title">💻 Kod Konsolu</div>
                         <div class="box-body" style="display:flex; flex-direction:column;">
                            <div style="background:#1e1e1e; padding:5px; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:11px; color:#888; margin-left:10px;">JavaScript</span>
                                <button class="run-code-btn" style="background:#2ecc71; color:#000; border:none; padding:4px 12px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:11px;">▶ Çalıştır</button>
                            </div>
                            <textarea class="code-input" spellcheck="false" placeholder="console.log('KEDI');" style="width:100%; box-sizing:border-box; border:none; background:transparent; resize:vertical; color:#9cdcfe; outline:none; font-family:Consolas, monospace; min-height:80px; padding:15px;"></textarea>
                            <div class="code-output" style="background:#000; color:#2ecc71; font-family:Consolas, monospace; font-size:12px; padding:10px; min-height:40px; border-top:1px solid #333; word-wrap: break-word;"></div>
                        </div>
                    </div>

                </div>`;
            
            newBox.innerHTML = `
                <div class="box-port port-top" data-pos="top"></div><div class="box-port port-right" data-pos="right"></div>
                <div class="box-port port-bottom" data-pos="bottom"></div><div class="box-port port-left" data-pos="left"></div>
                
                <span class="box-title" contenteditable="true" placeholder="Yeni Fikir...">Yeni Düğüm</span>
                
                <button class="open-modal-btn">⛶</button>
                <div class="node-preview"></div>
                
                <div class="box-actions">
                    <button class="box-close" title="Sil">✖</button>
                </div>
                ${contentHtml}
            `;
            
            if(board) board.appendChild(newBox); 
            bindBoxEvents(newBox); 
            
            setTimeout(() => { 
                const titleEl = newBox.querySelector('.box-title');
                if(titleEl) { titleEl.focus(); document.execCommand('selectAll', false, null); }
            }, 50);
            
            triggerCanvasSave();
        });
    }

    // KLASÖR AÇMA VE YENİ DOSYA OLUŞTURMA BUTONLARI
    const createHiveBtn = document.getElementById('createHiveBtn');
    if (createHiveBtn) {
        createHiveBtn.addEventListener('click', async () => {
            const folderPath = await ipcRenderer.invoke('dialog:openDirectory');
            if (folderPath) {
                window.currentHivePath = folderPath; 
                const hiveName = document.getElementById('hive-name');
                if(hiveName) hiveName.innerText = path.basename(folderPath);
                
                createHiveBtn.style.display = 'none'; 
                const headerActions = document.getElementById('header-actions');
                if(headerActions) headerActions.style.display = 'flex'; 
                
                if(typeof refreshFileList === 'function') refreshFileList(); 
                if(typeof restoreCalendarState === 'function') restoreCalendarState(); 
            }
        });
    }

    const addMdBtn = document.getElementById('addMdBtn');
    if(addMdBtn) {
        addMdBtn.addEventListener('click', () => { 
            if(typeof createInstantFile === 'function') createInstantFile(window.currentHivePath, '.md'); 
        });
    }

    const addCanvasBtn = document.getElementById('addCanvasBtn');
    if(addCanvasBtn) {
        addCanvasBtn.addEventListener('click', () => { 
            if(typeof createInstantFile === 'function') createInstantFile(window.currentHivePath, '.canvas'); 
        });
    }
});