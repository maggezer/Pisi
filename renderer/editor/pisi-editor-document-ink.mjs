import { registerModule } from "../core/module-registry.mjs";

const PISI_DOCUMENT_INK_MAX_WIDTH = 4096;
const PISI_DOCUMENT_INK_MAX_HEIGHT = 4096;
const PISI_DOCUMENT_INK_TOOLS = new Set([
    'pencil',
    'brush',
    'eraser',
    'line',
    'rect',
    'ellipse'
]);

const pisiBoundDocumentInkCanvases = new WeakSet();
const pisiLoadedDocumentInkImages = new WeakMap();
const pisiPendingDocumentInkImages = new WeakMap();
const pisiDirtyDocumentInkCanvases = new WeakSet();
const pisiDocumentInkObservers = new WeakMap();

let pisiActiveDocumentInkEditor = null;
let pisiLastDocumentInkShapeToolbar = null;

function getPisiDocumentInkLayer(editor) {
    if (!editor) return null;
    return editor.querySelector('.pisi-document-ink-layer');
}

function getPisiDocumentInkCanvas(editor) {
    return getPisiDocumentInkLayer(editor)?.querySelector(
        'canvas[data-pisi-document-ink]'
    ) || null;
}

function getPisiDocumentInkToolbar(editor) {
    if (!editor?.id) return null;
    return document.querySelector(
        `.pisi-editor-toolbar[data-editor-target="${editor.id}"]`
    );
}

function hasPisiEmbeddedPaintCanvas(editor) {
    return Boolean(
        editor?.querySelector('canvas[data-pisi-canvas]')
    );
}

function clampPisiDocumentInkDimension(value, maximum) {
    return Math.max(
        1,
        Math.min(maximum, Math.ceil(Number(value) || 1))
    );
}

function getPisiDocumentInkExtent(editor) {
    const layer = getPisiDocumentInkLayer(editor);
    let width = Math.max(1, editor?.clientWidth || 1);
    let height = Math.max(1, editor?.clientHeight || 1);

    Array.from(editor?.children || []).forEach((child) => {
        if (child === layer) return;

        width = Math.max(
            width,
            Number(child.offsetLeft || 0) +
                Number(child.offsetWidth || 0) + 24
        );
        height = Math.max(
            height,
            Number(child.offsetTop || 0) +
                Number(child.offsetHeight || 0) + 24
        );
    });

    return {
        width: clampPisiDocumentInkDimension(
            width,
            PISI_DOCUMENT_INK_MAX_WIDTH
        ),
        height: clampPisiDocumentInkDimension(
            height,
            PISI_DOCUMENT_INK_MAX_HEIGHT
        )
    };
}

function resizePisiDocumentInkCanvas(editor, canvas = null) {
    const targetCanvas = canvas || getPisiDocumentInkCanvas(editor);
    const layer = targetCanvas?.closest('.pisi-document-ink-layer');
    if (!editor || !targetCanvas || !layer) return false;

    const dimensions = getPisiDocumentInkExtent(editor);
    layer.style.width = `${dimensions.width}px`;
    layer.style.height = `${dimensions.height}px`;
    targetCanvas.style.width = `${dimensions.width}px`;
    targetCanvas.style.height = `${dimensions.height}px`;

    if (
        targetCanvas.width === dimensions.width &&
        targetCanvas.height === dimensions.height
    ) {
        return false;
    }

    const previousWidth = Math.max(1, targetCanvas.width || 1);
    const previousHeight = Math.max(1, targetCanvas.height || 1);
    const snapshot = document.createElement('canvas');
    snapshot.width = previousWidth;
    snapshot.height = previousHeight;

    const snapshotContext = snapshot.getContext('2d');
    const targetContext = targetCanvas.getContext('2d');

    if (snapshotContext && targetContext) {
        snapshotContext.drawImage(targetCanvas, 0, 0);
    }

    targetCanvas.width = dimensions.width;
    targetCanvas.height = dimensions.height;

    if (targetContext && snapshotContext) {
        targetContext.drawImage(snapshot, 0, 0);
    }

    return true;
}

function ensurePisiDocumentInkLayer(editor) {
    if (!editor) return null;

    let layer = getPisiDocumentInkLayer(editor);
    let canvas = getPisiDocumentInkCanvas(editor);

    if (!layer) {
        layer = document.createElement('span');
        layer.className = 'pisi-document-ink-layer';
        layer.setAttribute('contenteditable', 'false');
        editor.insertBefore(layer, editor.firstChild);
    }

    if (!canvas) {
        const dimensions = getPisiDocumentInkExtent(editor);
        canvas = document.createElement('canvas');
        canvas.className = 'pisi-document-ink-canvas';
        canvas.dataset.pisiDocumentInk = '1';
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        layer.appendChild(canvas);
    }

    bindPisiDocumentInkCanvas(canvas);
    resizePisiDocumentInkCanvas(editor, canvas);
    return canvas;
}

function savePisiDocumentInkData(canvas) {
    if (!canvas) return '';

    const editor = canvas.closest('.pisi-rich-editor');
    if (editor) {
        resizePisiDocumentInkCanvas(editor, canvas);
    }

    try {
        const imageData = canvas.toDataURL('image/png');
        canvas.dataset.image = imageData;
        pisiLoadedDocumentInkImages.set(canvas, imageData);
        pisiPendingDocumentInkImages.delete(canvas);
        pisiDirtyDocumentInkCanvases.delete(canvas);
        return imageData;
    } catch (error) {
        console.warn('[PISI] Belge çizimi kaydedilemedi:', error);
        return canvas.dataset.image || '';
    }
}

function savePisiDocumentInkForEditor(editor) {
    const canvas = getPisiDocumentInkCanvas(editor);
    return canvas ? savePisiDocumentInkData(canvas) : '';
}

function hydratePisiDocumentInk(editor) {
    if (!editor) return;

    editor
        .querySelectorAll('canvas[data-pisi-document-ink]')
        .forEach((canvas) => {
            canvas.removeAttribute('data-image-loaded');
            bindPisiDocumentInkCanvas(canvas);
            resizePisiDocumentInkCanvas(editor, canvas);

            const storedImage = canvas.dataset.image || '';
            if (!storedImage) {
                const context = canvas.getContext('2d');
                context?.clearRect(0, 0, canvas.width, canvas.height);
                pisiLoadedDocumentInkImages.delete(canvas);
                pisiPendingDocumentInkImages.delete(canvas);
                return;
            }

            if (
                pisiLoadedDocumentInkImages.get(canvas) === storedImage ||
                pisiPendingDocumentInkImages.get(canvas) === storedImage
            ) {
                return;
            }

            const image = new Image();
            pisiPendingDocumentInkImages.set(canvas, storedImage);

            image.onload = () => {
                if (
                    pisiPendingDocumentInkImages.get(canvas) !==
                    storedImage
                ) {
                    return;
                }

                resizePisiDocumentInkCanvas(editor, canvas);
                const context = canvas.getContext('2d');
                context?.clearRect(0, 0, canvas.width, canvas.height);
                context?.drawImage(
                    image,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                pisiLoadedDocumentInkImages.set(canvas, storedImage);
                pisiPendingDocumentInkImages.delete(canvas);
                pisiDirtyDocumentInkCanvases.delete(canvas);
            };

            image.onerror = () => {
                if (
                    pisiPendingDocumentInkImages.get(canvas) ===
                    storedImage
                ) {
                    pisiPendingDocumentInkImages.delete(canvas);
                }
            };

            image.src = storedImage;
        });
}

function getPisiDocumentInkPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) *
            (canvas.width / Math.max(1, rect.width)),
        y: (event.clientY - rect.top) *
            (canvas.height / Math.max(1, rect.height))
    };
}

function drawPisiDocumentInkDot(context, state, point) {
    const brushScale = state.tool === 'brush' ? 1.6 : 1;
    const radius = Math.max(0.5, Number(state.size || 1) * brushScale / 2);

    context.save();
    context.globalAlpha = state.tool === 'brush' ? 0.55 : 1;
    context.fillStyle = state.color;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
}

function drawPisiDocumentInkSegment(context, state, from, to) {
    const brushScale = state.tool === 'brush' ? 1.6 : 1;

    context.save();
    context.globalAlpha = state.tool === 'brush' ? 0.55 : 1;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(
        1,
        Number(state.size || 1) * brushScale
    );
    context.strokeStyle = state.color;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();
}

function erasePisiDocumentInkSegment(context, from, to, size) {
    const eraseSize = Math.max(2, Number(size || 2));
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, eraseSize / 3)));

    for (let index = 0; index <= steps; index += 1) {
        const progress = index / steps;
        const x = from.x + (to.x - from.x) * progress;
        const y = from.y + (to.y - from.y) * progress;

        context.clearRect(
            x - eraseSize / 2,
            y - eraseSize / 2,
            eraseSize,
            eraseSize
        );
    }
}

function bindPisiDocumentInkCanvas(canvas) {
    if (!canvas || pisiBoundDocumentInkCanvases.has(canvas)) return;

    pisiBoundDocumentInkCanvases.add(canvas);
    let drawing = false;
    let start = null;
    let previous = null;
    let snapshot = null;

    canvas.addEventListener('pointerdown', (event) => {
        const editor = canvas.closest('.pisi-rich-editor');
        const state = getPisiPaintState();

        if (
            !editor?.classList.contains('pisi-document-ink-active') ||
            !PISI_DOCUMENT_INK_TOOLS.has(state.tool) ||
            pisiPendingDocumentInkImages.has(canvas)
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        resizePisiDocumentInkCanvas(editor, canvas);

        const context = canvas.getContext('2d');
        if (!context) return;

        drawing = true;
        start = getPisiDocumentInkPoint(canvas, event);
        previous = start;
        snapshot = ['line', 'rect', 'ellipse'].includes(state.tool)
            ? context.getImageData(0, 0, canvas.width, canvas.height)
            : null;
        pisiDirtyDocumentInkCanvases.add(canvas);

        if (canvas.setPointerCapture) {
            canvas.setPointerCapture(event.pointerId);
        }

        if (state.tool === 'eraser') {
            erasePisiDocumentInkSegment(
                context,
                start,
                start,
                state.size
            );
        } else if (['pencil', 'brush'].includes(state.tool)) {
            drawPisiDocumentInkDot(context, state, start);
        }
    });

    canvas.addEventListener('pointermove', (event) => {
        if (!drawing || !start || !previous) return;

        event.preventDefault();
        event.stopPropagation();

        const state = getPisiPaintState();
        const context = canvas.getContext('2d');
        const point = getPisiDocumentInkPoint(canvas, event);
        if (!context) return;

        if (state.tool === 'eraser') {
            erasePisiDocumentInkSegment(
                context,
                previous,
                point,
                state.size
            );
        } else if (['pencil', 'brush'].includes(state.tool)) {
            drawPisiDocumentInkSegment(
                context,
                state,
                previous,
                point
            );
        } else {
            if (snapshot) {
                context.putImageData(snapshot, 0, 0);
            }
            drawPisiCanvasShape(context, state, start, point);
        }

        previous = point;
    });

    const finish = (event) => {
        if (!drawing) return;

        event?.preventDefault();
        event?.stopPropagation();
        drawing = false;
        start = null;
        previous = null;
        snapshot = null;

        savePisiDocumentInkData(canvas);
        notifyPisiEditorChanged(
            canvas.closest('.pisi-rich-editor')
        );
    };

    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
}

function clearPisiDocumentInkToolHighlight(editor) {
    const toolbar = getPisiDocumentInkToolbar(editor);
    toolbar
        ?.querySelectorAll('[data-pisi-paint-tool].active')
        .forEach((button) => button.classList.remove('active'));
}

function deactivatePisiDocumentInk(editor = null, options = {}) {
    const targetEditor = editor || pisiActiveDocumentInkEditor;
    if (!targetEditor) return;

    targetEditor.classList.remove('pisi-document-ink-active');

    if (options.clearToolHighlight === true) {
        clearPisiDocumentInkToolHighlight(targetEditor);
    }

    if (pisiActiveDocumentInkEditor === targetEditor) {
        pisiActiveDocumentInkEditor = null;
    }
}

function activatePisiDocumentInk(toolbar) {
    const editor = getPisiToolbarEditor(toolbar);
    const state = getPisiPaintState();

    if (
        !editor ||
        hasPisiEmbeddedPaintCanvas(editor) ||
        !PISI_DOCUMENT_INK_TOOLS.has(state.tool)
    ) {
        deactivatePisiDocumentInk(editor);
        return false;
    }

    if (
        pisiActiveDocumentInkEditor &&
        pisiActiveDocumentInkEditor !== editor
    ) {
        deactivatePisiDocumentInk(
            pisiActiveDocumentInkEditor,
            { clearToolHighlight: true }
        );
    }

    const canvas = ensurePisiDocumentInkLayer(editor);
    if (!canvas) return false;

    getPisiPaintState().activeCanvas = null;
    hydratePisiDocumentInk(editor);
    resizePisiDocumentInkCanvas(editor, canvas);
    editor.classList.add('pisi-document-ink-active');
    pisiActiveDocumentInkEditor = editor;
    return true;
}

function syncPisiDocumentInkForPaintTool(toolbar) {
    const editor = getPisiToolbarEditor(toolbar);
    if (!editor) return false;

    if (hasPisiEmbeddedPaintCanvas(editor)) {
        deactivatePisiDocumentInk(editor);
        return false;
    }

    return activatePisiDocumentInk(toolbar);
}

function bindPisiDocumentInkEditor(editor) {
    if (!editor || pisiDocumentInkObservers.has(editor)) return;

    const observer = new MutationObserver(() => {
        hydratePisiDocumentInk(editor);
        const canvas = getPisiDocumentInkCanvas(editor);
        if (canvas) {
            resizePisiDocumentInkCanvas(editor, canvas);
        }
    });

    observer.observe(editor, {
        childList: true,
        subtree: true,
        characterData: true
    });

    pisiDocumentInkObservers.set(editor, observer);
    hydratePisiDocumentInk(editor);
}

function bindPisiDocumentInkEditors() {
    document
        .querySelectorAll('.pisi-rich-editor')
        .forEach((editor) => bindPisiDocumentInkEditor(editor));
}

function handlePisiDocumentInkToolbarClick(event) {
    const shapeItem = event.target.closest('.pisi-office-shape-item');
    if (shapeItem && pisiLastDocumentInkShapeToolbar) {
        queueMicrotask(() => {
            syncPisiDocumentInkForPaintTool(
                pisiLastDocumentInkShapeToolbar
            );
        });
        return;
    }

    const toolbar = event.target.closest('.pisi-editor-toolbar');
    if (!toolbar) return;

    const editor = getPisiToolbarEditor(toolbar);
    if (!editor) return;

    if (event.target.closest('[data-pisi-shape-menu]')) {
        pisiLastDocumentInkShapeToolbar = toolbar;
        return;
    }

    if (
        event.target.closest(
            '[data-pisi-paint-action="createCanvas"]'
        )
    ) {
        deactivatePisiDocumentInk(editor);
        return;
    }

    if (
        event.target.closest('[data-pisi-paint-tool]') ||
        event.target.closest('[data-pisi-size-trigger]')
    ) {
        queueMicrotask(() => {
            syncPisiDocumentInkForPaintTool(toolbar);
        });
        return;
    }

    if (event.target.closest('[data-pisi-paint-action]')) {
        return;
    }

    deactivatePisiDocumentInk(
        editor,
        { clearToolHighlight: true }
    );
}

function setupPisiDocumentInkRuntime() {
    bindPisiDocumentInkEditors();

    document.addEventListener(
        'click',
        handlePisiDocumentInkToolbarClick
    );

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        deactivatePisiDocumentInk(
            pisiActiveDocumentInkEditor,
            { clearToolHighlight: true }
        );
    });

    window.addEventListener('resize', () => {
        document
            .querySelectorAll('.pisi-rich-editor')
            .forEach((editor) => {
                const canvas = getPisiDocumentInkCanvas(editor);
                if (canvas) {
                    resizePisiDocumentInkCanvas(editor, canvas);
                }
            });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener(
        'DOMContentLoaded',
        setupPisiDocumentInkRuntime,
        { once: true }
    );
} else {
    setupPisiDocumentInkRuntime();
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    PISI_DOCUMENT_INK_MAX_WIDTH: {
        enumerable: true,
        get() { return PISI_DOCUMENT_INK_MAX_WIDTH; }
    },
    PISI_DOCUMENT_INK_MAX_HEIGHT: {
        enumerable: true,
        get() { return PISI_DOCUMENT_INK_MAX_HEIGHT; }
    },
    getPisiDocumentInkLayer: {
        enumerable: true,
        get() { return getPisiDocumentInkLayer; }
    },
    getPisiDocumentInkCanvas: {
        enumerable: true,
        get() { return getPisiDocumentInkCanvas; }
    },
    hasPisiEmbeddedPaintCanvas: {
        enumerable: true,
        get() { return hasPisiEmbeddedPaintCanvas; }
    },
    getPisiDocumentInkExtent: {
        enumerable: true,
        get() { return getPisiDocumentInkExtent; }
    },
    resizePisiDocumentInkCanvas: {
        enumerable: true,
        get() { return resizePisiDocumentInkCanvas; }
    },
    ensurePisiDocumentInkLayer: {
        enumerable: true,
        get() { return ensurePisiDocumentInkLayer; }
    },
    savePisiDocumentInkData: {
        enumerable: true,
        get() { return savePisiDocumentInkData; }
    },
    savePisiDocumentInkForEditor: {
        enumerable: true,
        get() { return savePisiDocumentInkForEditor; }
    },
    hydratePisiDocumentInk: {
        enumerable: true,
        get() { return hydratePisiDocumentInk; }
    },
    bindPisiDocumentInkCanvas: {
        enumerable: true,
        get() { return bindPisiDocumentInkCanvas; }
    },
    deactivatePisiDocumentInk: {
        enumerable: true,
        get() { return deactivatePisiDocumentInk; }
    },
    activatePisiDocumentInk: {
        enumerable: true,
        get() { return activatePisiDocumentInk; }
    },
    syncPisiDocumentInkForPaintTool: {
        enumerable: true,
        get() { return syncPisiDocumentInkForPaintTool; }
    },
    bindPisiDocumentInkEditors: {
        enumerable: true,
        get() { return bindPisiDocumentInkEditors; }
    }
});
registerModule('editor.documentInk', moduleApi);
