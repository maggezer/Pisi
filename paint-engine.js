'use strict';

const paintCreationControlsBound = new WeakSet();
const configuredCanvases = new WeakSet();
const loadedCanvases = new WeakSet();
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_EDGE = 8192;
const MAX_IMAGE_PIXELS = 40_000_000;

function createDrawingCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.className = 'draw-layer';
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.background = '#fff';
    return canvas;
}

function markCanvasModified(canvas) {
    canvas.setAttribute('data-modified', 'true');
}

function installCanvas(boxElement, wrapper, toolRoot, width, height, drawInitialContent) {
    const canvas = createDrawingCanvas(width, height);
    wrapper.replaceChildren(canvas);
    const context = canvas.getContext('2d', { willReadFrequently: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    if (drawInitialContent) drawInitialContent(context, canvas);
    markCanvasModified(canvas);
    setupImageTools(boxElement, toolRoot);
    window.triggerCanvasSave?.();
    return canvas;
}

function initPaintEngine(boxElement) {
    const wrapper = boxElement.querySelector('.image-box-wrapper');
    if (!wrapper) return;
    const toolRoot = wrapper.closest('.box-content') || boxElement;

    const existingCanvas = wrapper.querySelector('.draw-layer');
    if (existingCanvas) setupImageTools(boxElement, toolRoot);

    if (paintCreationControlsBound.has(wrapper)) return;
    paintCreationControlsBound.add(wrapper);

    boxElement.querySelector('.blank-canvas-btn')?.addEventListener('click', (event) => {
        event.stopPropagation();
        const width = wrapper.clientWidth > 50 ? Math.round(wrapper.clientWidth) : 600;
        const height = wrapper.clientHeight > 50 ? Math.round(wrapper.clientHeight) : 400;
        installCanvas(boxElement, wrapper, toolRoot, width, height);
    });

    boxElement.querySelector('.image-file-input')?.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!/^image\/(?:png|jpeg|gif|webp)$/i.test(file.type) || file.size > MAX_UPLOAD_BYTES) {
            window.alert('Yalnızca PNG, JPEG, GIF veya WebP (en fazla 20 MB) yüklenebilir.');
            return;
        }

        const reader = new FileReader();
        reader.onerror = () => window.alert('Görsel okunamadı.');
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => window.alert('Görsel çözümlenemedi.');
            image.onload = () => {
                if (image.width > MAX_IMAGE_EDGE
                    || image.height > MAX_IMAGE_EDGE
                    || image.width * image.height > MAX_IMAGE_PIXELS) {
                    window.alert('Görsel boyutları çok büyük.');
                    return;
                }
                installCanvas(boxElement, wrapper, toolRoot, image.width, image.height, (context) => {
                    context.drawImage(image, 0, 0);
                });
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function loadSavedImage(canvas, context) {
    if (loadedCanvases.has(canvas)) return;
    loadedCanvases.add(canvas);
    const savedFile = canvas.getAttribute('data-file');
    if (!savedFile || !/^[A-Za-z0-9._-]{1,180}$/.test(savedFile) || !window.currentHivePath) return;

    const filePath = window.kedi.path.join(window.currentHivePath, 'images', savedFile);
    if (!window.kedi.fs.exists(filePath)) return;
    try {
        const image = new Image();
        image.onerror = () => console.error(`Kayıtlı görsel çözümlenemedi: ${savedFile}`);
        image.onload = () => {
            if (canvas.getAttribute('data-modified') === 'true') return;
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
        };
        image.src = `data:image/png;base64,${window.kedi.fs.readBase64(filePath)}`;
    } catch (error) {
        console.error('Kayıtlı görsel yüklenemedi:', error);
    }
}

function pointerPosition(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
}

function setupImageTools(boxElement, toolRoot = boxElement) {
    const canvas = toolRoot.querySelector('.draw-layer');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    loadSavedImage(canvas, context);
    if (configuredCanvases.has(canvas)) return;
    configuredCanvases.add(canvas);

    let isDrawing = false;
    let drawMode = false;
    const drawButton = toolRoot.querySelector('.draw-btn');
    const colorPicker = toolRoot.querySelector('.color-picker');
    const brushSize = toolRoot.querySelector('.brush-size');
    const rotateButton = toolRoot.querySelector('.rotate-btn');
    const clearButton = toolRoot.querySelector('.clear-draw-btn');

    canvas.style.pointerEvents = 'none';
    if (drawButton) {
        drawButton.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            drawMode = !drawMode;
            drawButton.classList.toggle('active', drawMode);
            drawButton.style.background = drawMode ? '#f39c12' : 'transparent';
            drawButton.style.color = drawMode ? '#000' : '#d4d4d4';
            canvas.style.cursor = drawMode ? 'crosshair' : 'default';
            canvas.style.pointerEvents = drawMode ? 'auto' : 'none';
        };
    }

    canvas.addEventListener('pointerdown', (event) => {
        if (!drawMode || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        isDrawing = true;
        canvas.setPointerCapture(event.pointerId);
        const point = pointerPosition(canvas, event);
        context.beginPath();
        context.moveTo(point.x, point.y);
    });

    canvas.addEventListener('pointermove', (event) => {
        if (!isDrawing || !drawMode) return;
        const point = pointerPosition(canvas, event);
        context.strokeStyle = colorPicker?.value || '#ff5252';
        context.lineWidth = Number(brushSize?.value) || 3;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.lineTo(point.x, point.y);
        context.stroke();
        markCanvasModified(canvas);
    });

    const finishDrawing = (event) => {
        if (!isDrawing) return;
        isDrawing = false;
        context.closePath();
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        window.triggerCanvasSave?.();
    };
    canvas.addEventListener('pointerup', finishDrawing);
    canvas.addEventListener('pointercancel', finishDrawing);

    if (rotateButton) {
        rotateButton.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const snapshot = document.createElement('canvas');
            snapshot.width = canvas.width;
            snapshot.height = canvas.height;
            snapshot.getContext('2d').drawImage(canvas, 0, 0);
            const previousWidth = canvas.width;
            const previousHeight = canvas.height;
            canvas.width = previousHeight;
            canvas.height = previousWidth;
            const rotatedContext = canvas.getContext('2d');
            rotatedContext.translate(canvas.width, 0);
            rotatedContext.rotate(Math.PI / 2);
            rotatedContext.drawImage(snapshot, 0, 0);
            markCanvasModified(canvas);
            window.triggerCanvasSave?.();
        };
    }

    if (clearButton) {
        clearButton.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!window.confirm('Çizim temizlensin mi?')) return;
            context.save();
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.restore();
            markCanvasModified(canvas);
            window.triggerCanvasSave?.();
        };
    }
}

window.initPaintEngine = initPaintEngine;
