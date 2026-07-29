'use strict';

if (!window.kedi) {
    throw new Error('KEDI güvenli köprüsü yüklenemedi.');
}

const kediFs = window.kedi.fs;
const kediPath = window.kedi.path;

window.currentHivePath = null;
window.currentCanvasFile = null;
window.currentCalendarType = 'gregorian';
window.camera = { x: 0, y: 0, zoom: 1 };
window.boxIdCounter = 1;
window.connections = [];
window.focusedBox = null;
window.isDraggingPort = false;

const board = document.getElementById('canvas-board');
const viewport = document.getElementById('canvas-viewport');
const boundBoxes = new WeakSet();
let pendingCanvasSave = null;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;

const SAFE_TAGS = new Set([
    'A', 'B', 'BLOCKQUOTE', 'BR', 'BUTTON', 'CANVAS', 'CODE', 'DIV', 'EM',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'INPUT',
    'LABEL', 'LI', 'OL', 'P', 'PRE', 'S', 'SPAN', 'STRONG', 'TABLE',
    'TBODY', 'TD', 'TEXTAREA', 'TH', 'THEAD', 'TR', 'U', 'UL'
]);
const DROP_TAGS = new Set([
    'BASE', 'EMBED', 'FORM', 'FRAME', 'IFRAME', 'LINK', 'META', 'OBJECT',
    'SCRIPT', 'STYLE', 'TEMPLATE'
]);
const COMMON_ATTRIBUTES = new Set([
    'accept', 'class', 'contenteditable', 'height', 'href', 'id', 'max',
    'min', 'placeholder', 'spellcheck', 'src', 'style', 'tabindex', 'title',
    'type', 'value', 'width'
]);
const NOTE_ATTRIBUTES = new Set(['height', 'href', 'src', 'style', 'title', 'width']);
const BOARD_DATA_ATTRIBUTES = new Set(['data-file', 'data-pos', 'data-type']);

function isSafeStyle(styleText) {
    if (typeof styleText !== 'string' || styleText.length > 4000) return false;
    return !/(?:url\s*\(|expression\s*\(|javascript\s*:|@import|-moz-binding|behavior\s*:)/i.test(styleText);
}

function isSafeLink(value) {
    if (typeof value !== 'string' || value.length > 2048) return false;
    return /^(?:https?:|mailto:|#)/i.test(value.trim());
}

function isSafeImage(value) {
    if (typeof value !== 'string' || value.length > 45 * 1024 * 1024) return false;
    return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
}

function sanitizeHtml(html, profile = 'note') {
    const template = document.createElement('template');
    template.innerHTML = typeof html === 'string' ? html : '';
    const elements = Array.from(template.content.querySelectorAll('*')).reverse();

    elements.forEach((element) => {
        if (!element.parentNode) return;
        if (DROP_TAGS.has(element.tagName)) {
            element.remove();
            return;
        }
        if (!SAFE_TAGS.has(element.tagName)) {
            element.replaceWith(...element.childNodes);
            return;
        }

        Array.from(element.attributes).forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            const value = attribute.value;
            const boardDataAllowed = profile === 'board' && BOARD_DATA_ATTRIBUTES.has(name);
            const attributeAllowed = profile === 'board'
                ? COMMON_ATTRIBUTES.has(name) || boardDataAllowed
                : NOTE_ATTRIBUTES.has(name);

            if (name.startsWith('on') || !attributeAllowed) {
                element.removeAttribute(attribute.name);
                return;
            }
            if (name === 'style' && !isSafeStyle(value)) {
                element.removeAttribute(attribute.name);
                return;
            }
            if (name === 'href' && !isSafeLink(value)) {
                element.removeAttribute(attribute.name);
                return;
            }
            if (name === 'src' && !isSafeImage(value)) {
                element.removeAttribute(attribute.name);
                return;
            }
            if (name === 'id') {
                const isValidBoxId = profile === 'board'
                    && element.classList.contains('canvas-box')
                    && /^box-[A-Za-z0-9_-]{1,90}$/.test(value);
                if (!isValidBoxId) {
                    element.removeAttribute(attribute.name);
                    return;
                }
            }
            if (name === 'class' && (value.length > 500 || !/^[A-Za-z0-9 _:-]*$/.test(value))) {
                element.removeAttribute(attribute.name);
                return;
            }
            if (name === 'contenteditable' && !/^(?:true|false)$/i.test(value)) {
                element.removeAttribute(attribute.name);
                return;
            }
            if ((name === 'width' || name === 'height' || name === 'min' || name === 'max' || name === 'tabindex')
                && !/^-?\d{1,6}$/.test(value)) {
                element.removeAttribute(attribute.name);
                return;
            }
            if (name === 'type' && !/^(?:color|file|range|text)$/i.test(value)) {
                element.removeAttribute(attribute.name);
                return;
            }
            if (name === 'accept' && value !== 'image/*') {
                element.removeAttribute(attribute.name);
                return;
            }
            if (name === 'data-pos' && !/^(?:top|right|bottom|left)$/.test(value)) {
                element.removeAttribute(attribute.name);
                return;
            }
            if (name === 'data-file' && !/^[A-Za-z0-9._-]{1,180}$/.test(value)) {
                element.removeAttribute(attribute.name);
            }
        });

        if (profile !== 'board') {
            BOARD_DATA_ATTRIBUTES.forEach((attribute) => element.removeAttribute(attribute));
            if (element.tagName === 'BUTTON' || element.tagName === 'CANVAS'
                || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.replaceWith(...element.childNodes);
            }
        }
    });

    return template.innerHTML;
}

window.sanitizeRichHtml = (html) => sanitizeHtml(html, 'note');
window.sanitizeBoardHtml = (html) => sanitizeHtml(html, 'board');

function setSaveStatus(text, color = '#888') {
    const saveStatus = document.getElementById('save-status');
    if (!saveStatus) return;
    saveStatus.textContent = text;
    saveStatus.style.color = color;
}

function getOpenModalSnapshot() {
    return typeof window.getOpenNodeSnapshot === 'function'
        ? window.getOpenNodeSnapshot()
        : null;
}

function copyFormState(sourceRoot, cloneRoot) {
    const sourceFields = sourceRoot.querySelectorAll('textarea, input');
    const cloneFields = cloneRoot.querySelectorAll('textarea, input');
    sourceFields.forEach((source, index) => {
        const clone = cloneFields[index];
        if (!clone) return;
        if (source.tagName === 'TEXTAREA') clone.textContent = source.value;
        else if (source.type !== 'file') clone.setAttribute('value', source.value);
        else clone.removeAttribute('value');
    });
}

function getSerializableBoardHtml() {
    if (!board) return '';
    const clone = board.cloneNode(true);
    copyFormState(board, clone);
    const modalSnapshot = getOpenModalSnapshot();

    if (modalSnapshot) {
        const targetNode = Array.from(clone.querySelectorAll('.canvas-box'))
            .find((node) => node.id === modalSnapshot.boxId);
        if (targetNode) {
            targetNode.querySelectorAll(':scope > .box-content').forEach((content) => content.remove());
            const contentTemplate = document.createElement('template');
            contentTemplate.innerHTML = window.sanitizeBoardHtml(modalSnapshot.contentHtml);
            const content = contentTemplate.content.querySelector('.box-content');
            if (content) targetNode.appendChild(content);
        }
    }

    clone.querySelectorAll('.draw-layer').forEach((canvas) => {
        canvas.removeAttribute('data-modified');
        canvas.removeAttribute('data-loaded');
    });
    clone.querySelectorAll('.active-port, .dragging').forEach((element) => {
        element.classList.remove('active-port', 'dragging');
    });

    return window.sanitizeBoardHtml(clone.innerHTML);
}

function normalizeConnectionsForSave() {
    const validPositions = new Set(['top', 'right', 'bottom', 'left']);
    const boxIds = new Set(board ? Array.from(board.querySelectorAll('.canvas-box')).map((box) => box.id) : []);
    return (Array.isArray(window.connections) ? window.connections : [])
        .filter((connection) => connection
            && boxIds.has(connection.sourceBox)
            && boxIds.has(connection.targetBox)
            && validPositions.has(connection.sourcePos)
            && validPositions.has(connection.targetPos))
        .map((connection, index) => ({
            id: typeof connection.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(connection.id)
                ? connection.id
                : `connection-${Date.now()}-${index}`,
            sourceBox: connection.sourceBox,
            sourcePos: connection.sourcePos,
            targetBox: connection.targetBox,
            targetPos: connection.targetPos
        }));
}

function saveModifiedImages() {
    if (!window.currentHivePath) return;
    const imageCanvases = Array.from(document.querySelectorAll('.draw-layer'));
    const imagesDir = kediPath.join(window.currentHivePath, 'images');

    imageCanvases.forEach((canvas) => {
        if (canvas.getAttribute('data-modified') !== 'true') return;
        if (!kediFs.exists(imagesDir)) kediFs.mkdir(imagesDir);

        let fileName = canvas.getAttribute('data-file');
        if (!fileName || !/^[A-Za-z0-9._-]{1,180}$/.test(fileName)) {
            fileName = `paint_${Date.now()}_${Math.floor(Math.random() * 100000)}.png`;
            canvas.setAttribute('data-file', fileName);
        }

        const base64Data = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
        kediFs.writeBase64(kediPath.join(imagesDir, fileName), base64Data);
        canvas.removeAttribute('data-modified');
    });
}

function saveCanvasNow(targetPath) {
    if (!targetPath || targetPath !== window.currentCanvasFile || !board) return false;

    try {
        saveModifiedImages();
        const connections = normalizeConnectionsForSave();
        window.connections = connections;
        const data = JSON.stringify({
            schemaVersion: 2,
            board: getSerializableBoardHtml(),
            connections,
            camera: {
                x: Number.isFinite(window.camera.x) ? window.camera.x : 0,
                y: Number.isFinite(window.camera.y) ? window.camera.y : 0,
                zoom: Number.isFinite(window.camera.zoom) ? window.camera.zoom : 1
            },
            counter: Number.isInteger(window.boxIdCounter) ? window.boxIdCounter : 1
        });
        kediFs.writeText(targetPath, data);
        setSaveStatus('Tuval Kaydedildi', '#2ecc71');
        window.setTimeout(() => {
            const status = document.getElementById('save-status');
            if (status && status.textContent === 'Tuval Kaydedildi') setSaveStatus('Tuval Modu');
        }, 2000);
        return true;
    } catch (error) {
        console.error('Tuval kaydedilemedi:', error);
        setSaveStatus('Kaydetme başarısız', '#e74c3c');
        window.alert(`Tuval kaydedilemedi: ${error.message}`);
        return false;
    }
}

function clearPendingCanvasSave() {
    if (!pendingCanvasSave) return;
    window.clearTimeout(pendingCanvasSave.timerId);
    pendingCanvasSave = null;
}

function triggerCanvasSave(isManual = false) {
    const targetPath = window.currentCanvasFile;
    if (!targetPath || !board) return;
    clearPendingCanvasSave();

    if (isManual === true) {
        saveCanvasNow(targetPath);
        return;
    }

    setSaveStatus('Oto. Kaydediliyor...', '#f39c12');
    const timerId = window.setTimeout(() => {
        pendingCanvasSave = null;
        if (window.currentCanvasFile === targetPath) saveCanvasNow(targetPath);
    }, 800);
    pendingCanvasSave = { targetPath, timerId };
}

function flushCanvasSave() {
    if (!pendingCanvasSave) return true;
    const { targetPath } = pendingCanvasSave;
    clearPendingCanvasSave();
    return targetPath === window.currentCanvasFile ? saveCanvasNow(targetPath) : true;
}

function cancelCanvasSave() {
    clearPendingCanvasSave();
}

window.triggerCanvasSave = triggerCanvasSave;
window.flushCanvasSave = flushCanvasSave;
window.cancelCanvasSave = cancelCanvasSave;

function closeApplication() {
    flushCanvasSave();
    window.kedi.window.close();
}

document.getElementById('win-min')?.addEventListener('click', () => window.kedi.window.minimize());
document.getElementById('win-max')?.addEventListener('click', () => window.kedi.window.maximize());
document.getElementById('win-close')?.addEventListener('click', closeApplication);
window.addEventListener('beforeunload', () => {
    try {
        flushCanvasSave();
    } catch (error) {
        console.error(error);
    }
});

const appMenu = document.getElementById('app-menu');
const appLogo = document.getElementById('app-logo');
if (appLogo && appMenu) {
    appLogo.addEventListener('click', (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        appMenu.style.display = appMenu.style.display === 'block' ? 'none' : 'block';
        appMenu.style.left = `${rect.left}px`;
        appMenu.style.top = `${rect.bottom}px`;
    });
    document.addEventListener('click', (event) => {
        if (!appLogo.contains(event.target) && !appMenu.contains(event.target)) {
            appMenu.style.display = 'none';
        }
    });
}

const preferencesModal = document.getElementById('preferences-modal');
const preferenceCalendar = document.getElementById('pref-cal-engine');
document.getElementById('menu-preferences')?.addEventListener('click', () => {
    if (appMenu) appMenu.style.display = 'none';
    if (preferencesModal) preferencesModal.style.display = 'flex';
    if (preferenceCalendar) preferenceCalendar.value = window.currentCalendarType;
});
document.getElementById('pref-close')?.addEventListener('click', () => {
    if (preferencesModal) preferencesModal.style.display = 'none';
});
preferenceCalendar?.addEventListener('change', (event) => {
    window.currentCalendarType = event.target.value;
    if (typeof window.renderCalendar === 'function') window.renderCalendar();
});

document.querySelectorAll('.ribbon-tab-btn').forEach((button) => {
    button.addEventListener('click', () => {
        document.querySelectorAll('.ribbon-tab-btn, .ribbon-panel')
            .forEach((element) => element.classList.remove('active'));
        button.classList.add('active');
        document.getElementById(button.dataset.target)?.classList.add('active');
    });
});

function closeAllDropdowns() {
    document.querySelectorAll('.dropdown-menu').forEach((menu) => menu.classList.remove('show'));
}

[
    ['hnBtn', 'hn-menu'],
    ['textColorBtn', 'text-color-menu'],
    ['highlightBtn', 'highlight-menu']
].forEach(([buttonId, menuId]) => {
    document.getElementById(buttonId)?.addEventListener('click', (event) => {
        event.stopPropagation();
        const targetMenu = document.getElementById(menuId);
        const shouldOpen = targetMenu && !targetMenu.classList.contains('show');
        closeAllDropdowns();
        if (shouldOpen) targetMenu.classList.add('show');
    });
});
document.addEventListener('click', closeAllDropdowns);

document.querySelectorAll('[data-format-command]').forEach((button) => {
    button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        document.execCommand(button.dataset.formatCommand, false, null);
    });
});
document.querySelectorAll('.hn-item, .color-swatch').forEach((button) => {
    button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const command = button.dataset.cmd;
        const color = button.dataset.color;
        if (command === 'foreColor' || command === 'backColor') {
            document.execCommand(command, false, color);
        } else if (command) {
            document.execCommand('formatBlock', false, command);
        }
        closeAllDropdowns();
    });
});

document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (window.currentCanvasFile) {
            triggerCanvasSave(true);
            return;
        }
        const editor = document.getElementById('myEditor');
        const editorPath = editor?.getAttribute('data-path');
        if (!editorPath) return;
        try {
            const cleanHtml = window.sanitizeRichHtml(editor.innerHTML);
            editor.innerHTML = cleanHtml;
            kediFs.writeText(editorPath, cleanHtml);
            setSaveStatus('Elle Kaydedildi!', '#2ecc71');
        } catch (error) {
            setSaveStatus('Kaydetme başarısız', '#e74c3c');
            window.alert(`Not kaydedilemedi: ${error.message}`);
        }
    }
});

if (viewport) {
    viewport.addEventListener('pointerdown', (event) => {
        if (event.button !== 0
            || window.focusedBox
            || window.isDraggingPort
            || event.target.closest('.canvas-box')
            || event.target.closest('button, input, textarea')) {
            return;
        }
        isPanning = true;
        startPanX = event.clientX - window.camera.x;
        startPanY = event.clientY - window.camera.y;
        viewport.setPointerCapture(event.pointerId);
    });

    viewport.addEventListener('pointermove', (event) => {
        if (!isPanning) return;
        window.camera.x = event.clientX - startPanX;
        window.camera.y = event.clientY - startPanY;
        window.updateCanvas?.();
    });

    viewport.addEventListener('pointerup', (event) => {
        if (!isPanning) return;
        isPanning = false;
        if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
        triggerCanvasSave();
    });

    viewport.addEventListener('wheel', (event) => {
        if ((!event.ctrlKey && !event.metaKey) || window.focusedBox) return;
        event.preventDefault();
        const nextZoom = Math.min(3, Math.max(0.2, window.camera.zoom + (event.deltaY > 0 ? -0.1 : 0.1)));
        const rect = viewport.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        window.camera.x = mouseX - (mouseX - window.camera.x) * (nextZoom / window.camera.zoom);
        window.camera.y = mouseY - (mouseY - window.camera.y) * (nextZoom / window.camera.zoom);
        window.camera.zoom = nextZoom;
        window.updateCanvas?.();
        triggerCanvasSave();
    }, { passive: false });
}

function bindBoxEvents(boxElement) {
    if (!boxElement || boundBoxes.has(boxElement)) return;
    boundBoxes.add(boxElement);

    window.makeBoxDraggable?.(boxElement);
    window.attachPortListeners?.(boxElement);

    const openButton = boxElement.querySelector('.open-modal-btn');
    const preview = boxElement.querySelector('.node-preview');
    openButton?.addEventListener('mouseenter', () => {
        const note = boxElement.querySelector('.text-content');
        if (!preview) return;
        const plainText = note?.innerText.trim() || '📝 Henüz not eklenmedi...';
        preview.textContent = plainText.length > 180 ? `${plainText.slice(0, 180)}...` : plainText;
    });
    openButton?.addEventListener('click', (event) => {
        event.stopPropagation();
        window.openNodeEditor?.(boxElement);
    });

    boxElement.querySelector('.box-close')?.addEventListener('click', (event) => {
        event.stopPropagation();
        if (window.getOpenNodeSnapshot?.()?.boxId === boxElement.id) {
            window.closeNodeEditor?.({ save: false });
        }

        const savedFile = boxElement.querySelector('.draw-layer')?.getAttribute('data-file');
        if (savedFile && /^[A-Za-z0-9._-]{1,180}$/.test(savedFile) && window.currentHivePath) {
            const imagePath = kediPath.join(window.currentHivePath, 'images', savedFile);
            try {
                if (kediFs.exists(imagePath)) kediFs.removeFile(imagePath);
            } catch (error) {
                console.error('Görsel dosyası silinemedi:', error);
            }
        }

        window.removeBoxConnections?.(boxElement.id);
        boxElement.remove();
        window.drawAllConnections?.();
        triggerCanvasSave();
    });

    const title = boxElement.querySelector('.box-title');
    title?.addEventListener('input', () => triggerCanvasSave());
    title?.addEventListener('pointerdown', (event) => event.stopPropagation());

    const runButton = boxElement.querySelector('.run-code-btn');
    if (runButton) {
        const runOutput = boxElement.querySelector('.code-output');
        runButton.textContent = 'Çalıştırma kapalı';
        runButton.setAttribute('aria-disabled', 'true');
        runButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (runOutput) {
                runOutput.textContent = 'Güvenlik nedeniyle tuval içinden JavaScript çalıştırma devre dışıdır.';
                runOutput.style.color = '#f39c12';
            }
        });
    }

    window.NodeEngine?.bindContainer?.(boxElement);
    if (boxElement.querySelector('.draw-layer, .image-drop-zone')) {
        window.initPaintEngine?.(boxElement);
    }
}

window.bindBoxEvents = bindBoxEvents;

function createNodeMarkup() {
    return `
        <div class="box-port port-top" data-pos="top"></div>
        <div class="box-port port-right" data-pos="right"></div>
        <div class="box-port port-bottom" data-pos="bottom"></div>
        <div class="box-port port-left" data-pos="left"></div>
        <span class="box-title" contenteditable="true" placeholder="Yeni Fikir...">Yeni Düğüm</span>
        <button class="open-modal-btn" type="button">⛶</button>
        <div class="node-preview"></div>
        <div class="box-actions"><button class="box-close" type="button" title="Sil">✖</button></div>
        <div class="box-content super-content" style="display:none; flex-direction:column; width:100%; height:100%;">
            <div class="super-box-section">
                <div class="super-box-section-title">📝 Düğüm Notları</div>
                <div class="text-content" contenteditable="true" placeholder="Bu fikri detaylandırın..." style="padding:15px; min-height:80px; outline:none;"></div>
            </div>
            <div class="super-box-section">
                <div class="super-box-section-title">🖼️ Çizim &amp; Resim</div>
                <div class="box-toolbar" style="display:flex;">
                    <button class="box-tool-btn draw-btn" type="button">✏️ Kalem</button>
                    <input type="color" class="box-tool-color color-picker" value="#ff5252" style="width:24px; height:24px; padding:0; border:none; cursor:pointer; background:transparent;">
                    <input type="range" class="box-tool-size brush-size" min="1" max="20" value="3" style="width:50px;">
                    <div style="width:1px; background:#444; margin:0 5px;"></div>
                    <button class="box-tool-btn rotate-btn" type="button">🔄 Döndür</button>
                    <button class="box-tool-btn clear-draw-btn" type="button">🧹 Temizle</button>
                </div>
                <div class="image-box-wrapper" tabindex="0" style="min-height:250px; background-color:#1e1e1e; display:flex; flex-direction:column; outline:none;">
                    <div class="image-drop-zone" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; border:2px dashed #444; padding:20px; box-sizing:border-box;">
                        <div style="display:flex; gap:10px;">
                            <button class="btn-main blank-canvas-btn" type="button" style="padding:8px 12px; font-size:12px; background:#2ecc71;">🎨 Boş Tahta Aç</button>
                            <label class="btn-main" style="padding:8px 12px; font-size:12px; background:#34ace0;">
                                🖼️ Resim Yükle
                                <input type="file" accept="image/*" class="image-file-input" style="display:none;">
                            </label>
                        </div>
                    </div>
                </div>
            </div>
            <div class="super-box-section">
                <div class="super-box-section-title">💻 Kod Notu</div>
                <div class="box-body" style="display:flex; flex-direction:column;">
                    <div style="background:#1e1e1e; padding:5px; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:11px; color:#888; margin-left:10px;">JavaScript metni (çalıştırılmaz)</span>
                        <button class="run-code-btn" type="button" style="background:#555; color:#ddd; border:none; padding:4px 12px; border-radius:4px; font-size:11px;">Çalıştırma kapalı</button>
                    </div>
                    <textarea class="code-input" spellcheck="false" placeholder="// Kod notunuzu buraya yazın" style="width:100%; box-sizing:border-box; border:none; background:transparent; resize:vertical; color:#9cdcfe; outline:none; font-family:Consolas, monospace; min-height:80px; padding:15px;"></textarea>
                    <div class="code-output" style="background:#000; color:#888; font-family:Consolas, monospace; font-size:12px; padding:10px; min-height:40px; border-top:1px solid #333;">Kod çalıştırma güvenlik nedeniyle kapalıdır.</div>
                </div>
            </div>
        </div>`;
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('clearCanvasBtn')?.addEventListener('click', () => {
        if (!window.currentCanvasFile || !board) return;
        if (!window.confirm('Tuvaldeki her şey silinecek. Emin misin?')) return;
        window.closeNodeEditor?.({ save: false });
        board.replaceChildren();
        window.connections = [];
        window.resetConnectionEngine?.();
        triggerCanvasSave(true);
    });

    document.querySelector('.add-node-btn')?.addEventListener('click', () => {
        if (!window.currentCanvasFile || !board) {
            window.alert('Önce sol menüden bir Tuval (.canvas) açmalısınız!');
            return;
        }

        window.boxIdCounter += 1;
        const newBox = document.createElement('div');
        newBox.className = 'canvas-box super-box';
        newBox.id = `box-${window.boxIdCounter}`;
        const rect = viewport?.getBoundingClientRect() || { width: 800, height: 600 };
        newBox.style.left = `${(rect.width / 2 - window.camera.x) / window.camera.zoom - 50}px`;
        newBox.style.top = `${(rect.height / 2 - window.camera.y) / window.camera.zoom - 20}px`;
        newBox.innerHTML = createNodeMarkup();
        board.appendChild(newBox);
        bindBoxEvents(newBox);
        newBox.querySelector('.box-title')?.focus();
        triggerCanvasSave();
    });

    document.getElementById('createHiveBtn')?.addEventListener('click', async () => {
        if (flushCanvasSave() === false) return;
        let folderPath;
        try {
            folderPath = await window.kedi.workspace.openDirectory();
        } catch (error) {
            window.alert(`Çalışma alanı açılamadı: ${error.message}`);
            return;
        }
        if (!folderPath) return;

        window.closeNodeEditor?.({ save: false });
        cancelCanvasSave();
        window.currentCanvasFile = null;
        window.currentHivePath = folderPath;
        if (board) board.replaceChildren();
        window.connections = [];
        window.resetConnectionEngine?.();

        const hiveName = document.getElementById('hive-name');
        if (hiveName) hiveName.textContent = kediPath.basename(folderPath);
        document.getElementById('createHiveBtn').style.display = 'none';
        const headerActions = document.getElementById('header-actions');
        if (headerActions) headerActions.style.display = 'flex';
        window.refreshFileList?.();
        window.restoreCalendarState?.();
    });

    document.getElementById('addMdBtn')?.addEventListener('click', () => {
        window.createInstantFile?.(window.currentHivePath, '.md');
    });
    document.getElementById('addCanvasBtn')?.addEventListener('click', () => {
        window.createInstantFile?.(window.currentHivePath, '.canvas');
    });
});
