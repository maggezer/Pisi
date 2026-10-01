import { registerModule } from "../core/module-registry.mjs";

function getPisiToolbarEditor(toolbar) {
    if (!toolbar) return null;

    const targetId = toolbar.dataset.editorTarget;
    return targetId ? document.getElementById(targetId) : null;
}

function notifyPisiEditorChanged(editor, rehydrate = true) {
    if (!editor) return;

    if (rehydrate && typeof ensurePisiEditorBlocks === 'function') {
        ensurePisiEditorBlocks(editor);
    }

    if (
        rehydrate &&
        typeof initializePisiAdvancedEditorContent === 'function'
    ) {
        initializePisiAdvancedEditorContent(editor);
    }

    editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'formatSet'
    }));

    if (typeof refreshPisiTagsPanelSoon === 'function') {
        refreshPisiTagsPanelSoon();
    }
}

function runPisiEditorCommand(toolbar, command, value = null) {
    const editor = getPisiToolbarEditor(toolbar);
    if (!editor) return;

    const activeElement = document.activeElement;
    if (!activeElement || !editor.contains(activeElement)) {
        editor.focus({ preventScroll: true });
    }
    document.execCommand(command, false, value);
    notifyPisiEditorChanged(editor);
}

function buildPisiRichToolbarControls(controls) {
    if (!controls || controls.dataset.rendered === '1') return;

    controls.dataset.rendered = '1';
    controls.innerHTML = `
        <select class="pisi-word-select" data-pisi-toolbar-command="fontName" title="Yazı tipi">
            <option value="Segoe UI">Segoe UI</option>
            <option value="Arial">Arial</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Georgia">Georgia</option>
            <option value="Consolas">Consolas</option>
        </select>

        <select class="pisi-word-select" data-pisi-toolbar-command="formatBlock" title="Başlık / paragraf">
            <option value="div">Normal</option>
            <option value="h2">Başlık 1</option>
            <option value="h3">Başlık 2</option>
            <option value="h4">Başlık 3</option>
            <option value="h5">Alt başlık</option>
        </select>

        <select class="pisi-word-select pisi-word-size-select" data-pisi-toolbar-command="fontSize" title="Yazı boyutu">
            <option value="2">Küçük</option>
            <option value="3" selected>Normal</option>
            <option value="4">Büyük</option>
            <option value="5">Çok büyük</option>
            <option value="6">Dev</option>
        </select>

        <span class="pisi-word-separator"></span>

        <button type="button" class="pisi-word-btn" data-pisi-toolbar-command="bold" title="Kalın"><b>B</b></button>
        <button type="button" class="pisi-word-btn" data-pisi-toolbar-command="italic" title="İtalik"><i>I</i></button>
        <button type="button" class="pisi-word-btn" data-pisi-toolbar-command="underline" title="Altı çizili"><u>U</u></button>

        <label class="pisi-word-color" title="Yazı rengi">
            A
            <input type="color" data-pisi-toolbar-command="foreColor" value="#d4d4d4">
        </label>

        <span class="pisi-word-separator"></span>

        <button type="button" class="pisi-word-btn" data-pisi-toolbar-command="insertUnorderedList" title="Madde işaretleri">• Liste</button>
        <button type="button" class="pisi-word-btn" data-pisi-toolbar-command="insertOrderedList" title="Numaralı liste">1. Liste</button>

        <span class="pisi-word-separator"></span>

        <button type="button" class="pisi-word-btn" data-pisi-toolbar-command="justifyLeft" title="Sola hizala">☰</button>
        <button type="button" class="pisi-word-btn" data-pisi-toolbar-command="justifyCenter" title="Ortala">☷</button>
        <button type="button" class="pisi-word-btn" data-pisi-toolbar-command="justifyRight" title="Sağa hizala">☱</button>
    `;
}

function buildPisiPaintToolbarControls(controls) {
    if (!controls || controls.dataset.rendered === '1') return;

    controls.dataset.rendered = '1';
    controls.innerHTML = `
        <button type="button" class="pisi-word-btn pisi-paint-create" data-pisi-paint-action="createCanvas" draggable="true" title="Tuval oluştur; istersen bu butonu editöre sürükle">🎨 Tuval</button>
        <label class="pisi-toolbar-field">En <input class="pisi-toolbar-number" type="number" min="80" max="1600" step="10" value="520" data-pisi-paint-width></label>
        <label class="pisi-toolbar-field">Boy <input class="pisi-toolbar-number" type="number" min="60" max="1200" step="10" value="320" data-pisi-paint-height></label>
        <span class="pisi-word-separator"></span>
        <button type="button" class="pisi-word-btn active" data-pisi-paint-tool="pencil" title="Kalem">Kalem</button>
        <button type="button" class="pisi-word-btn" data-pisi-paint-tool="eraser" title="Silgi">Silgi</button>
        <button type="button" class="pisi-word-btn" data-pisi-paint-tool="line" title="Çizgi">Çizgi</button>
        <button type="button" class="pisi-word-btn" data-pisi-paint-tool="rect" title="Dikdörtgen">▭</button>
        <button type="button" class="pisi-word-btn" data-pisi-paint-tool="ellipse" title="Elips">◯</button>
        <label class="pisi-word-color" title="Çizim rengi">R<input type="color" value="#f39c12" data-pisi-paint-color></label>
        <label class="pisi-toolbar-field">Fırça <input class="pisi-toolbar-number" type="number" min="1" max="80" step="1" value="4" data-pisi-paint-size></label>
        <button type="button" class="pisi-word-btn" data-pisi-paint-action="clearCanvas" title="Seçili tuvali temizle">Temizle</button>
    `;
}

function buildPisiExcelToolbarControls(controls) {
    if (!controls || controls.dataset.rendered === '1') return;

    controls.dataset.rendered = '1';
    controls.innerHTML = `
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="insertTable" title="Tablo ekle">▦ Tablo</button>
        <label class="pisi-toolbar-field">Satır <input class="pisi-toolbar-number" type="number" min="1" max="10000" step="1" value="5" data-pisi-excel-rows></label>
        <label class="pisi-toolbar-field">Sütun <input class="pisi-toolbar-number" type="number" min="1" max="80" step="1" value="5" data-pisi-excel-cols></label>
        <span class="pisi-word-separator"></span>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="addRow" title="Seçili satırın altına satır ekle">+ Satır</button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="deleteRow" title="Seçili satırları sil">− Satır</button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="addCol" title="Seçili sütunun sağına sütun ekle">+ Sütun</button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="deleteCol" title="Seçili sütunları sil">− Sütun</button>
        <span class="pisi-sheet-toolbar-status" data-pisi-sheet-status>0 × 0</span>
        <span class="pisi-word-separator"></span>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="toggleBold" title="Kalın"><b>B</b></button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="toggleItalic" title="İtalik"><i>I</i></button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="toggleUnderline" title="Altı çizili"><u>U</u></button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="toggleStrikeThrough" title="Üstü çizili"><s>S</s></button>
        <select class="pisi-word-select" data-pisi-excel-format-select="fontFamily" title="Hücre yazı tipi">
            <option value="Segoe UI">Segoe UI</option>
            <option value="Arial">Arial</option>
            <option value="Calibri">Calibri</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Georgia">Georgia</option>
            <option value="Consolas">Consolas</option>
        </select>
        <select class="pisi-word-select" data-pisi-excel-format-select="fontSize" title="Hücre yazı boyutu">
            <option value="2">10</option>
            <option value="3" selected>12</option>
            <option value="4">14</option>
            <option value="5">18</option>
            <option value="6">24</option>
        </select>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="alignLeft" title="Sola hizala">☰</button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="alignCenter" title="Ortala">☷</button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="alignRight" title="Sağa hizala">☱</button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="alignJustify" title="İki yana yasla">≡</button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="verticalTop" title="Dikey üst">⇈</button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="verticalMiddle" title="Dikey orta">↕</button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="verticalBottom" title="Dikey alt">⇊</button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="toggleWrap" title="Metni kaydır">↩</button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="borderAll" title="Kenarlık ekle">▦</button>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="borderNone" title="Kenarlığı kaldır">□</button>
        <label class="pisi-word-color" title="Hücre yazı rengi">A<input type="color" value="#d4d4d4" data-pisi-excel-format="textColor"></label>
        <label class="pisi-word-color pisi-sheet-fill-color" title="Hücre dolgu rengi">■<input type="color" value="#1f1f20" data-pisi-excel-format="fillColor"></label>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="clearFormat" title="Biçimi temizle">Temizle</button>
        <span class="pisi-word-separator"></span>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="recalc">Hesapla</button>
        <input class="pisi-excel-formula-input" type="text" placeholder="=SUM(A1:B2), =A1+B1" data-pisi-excel-formula>
        <button type="button" class="pisi-word-btn" data-pisi-excel-action="applyFormula">Uygula</button>
    `;
}

function setupPisiRichToolbars() {
    document.querySelectorAll('.pisi-editor-toolbar, .pisi-word-toolbar').forEach((toolbar) => {
        setupPisiUnifiedToolbar(toolbar);
    });

    bindPisiAdvancedEditorDropTargets();
}

function switchPisiToolbarTab(toolbar, tabName) {
    toolbar.querySelectorAll('[data-pisi-toolbar-tab]').forEach((button) => {
        const isActive = button.dataset.pisiToolbarTab === tabName;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    toolbar.querySelectorAll('[data-pisi-toolbar-panel]').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.pisiToolbarPanel === tabName);
    });
}

function getPisiPaintState() {
    if (!window.__pisiPaintState) {
        window.__pisiPaintState = {
            tool: 'pencil',
            color: '#f39c12',
            size: 4,
            activeCanvas: null
        };
    }

    return window.__pisiPaintState;
}

function updatePisiPaintStateFromToolbar(toolbar) {
    const state = getPisiPaintState();
    const color = toolbar.querySelector('[data-pisi-paint-color]')?.value;
    const size = Number(toolbar.querySelector('[data-pisi-paint-size]')?.value || 4);

    if (color) state.color = color;
    if (Number.isFinite(size) && size > 0) state.size = size;
}

function setPisiPaintTool(toolbar, tool) {
    const state = getPisiPaintState();
    state.tool = tool || 'pencil';
    updatePisiPaintStateFromToolbar(toolbar);

    toolbar.querySelectorAll('[data-pisi-paint-tool]').forEach((button) => {
        button.classList.toggle('active', button.dataset.pisiPaintTool === state.tool);
    });
}

function getPisiToolbarNumber(toolbar, selector, fallback) {
    const value = Number(toolbar.querySelector(selector)?.value || fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function runPisiPaintAction(toolbar, action) {
    updatePisiPaintStateFromToolbar(toolbar);

    if (action === 'createCanvas') {
        insertPisiCanvasFromToolbar(toolbar);
        return;
    }

    if (action === 'clearCanvas') {
        const canvas = getPisiPaintState().activeCanvas;
        if (!canvas) return;
        if (pisiPendingPaintImages.has(canvas)) return;

        resetPisiCanvasToWhite(canvas);
        pisiDirtyPaintCanvases.add(canvas);
        savePisiCanvasData(canvas);
        notifyPisiEditorChanged(getEditorForPisiElement(canvas));
    }
}

function insertPisiCanvasFromToolbar(toolbar) {
    const editor = getPisiToolbarEditor(toolbar);
    if (!editor) return;

    const width = Math.max(80, Math.min(1600, getPisiToolbarNumber(toolbar, '[data-pisi-paint-width]', 520)));
    const height = Math.max(60, Math.min(1200, getPisiToolbarNumber(toolbar, '[data-pisi-paint-height]', 320)));

    insertPisiCanvas(editor, width, height);
}

function insertPisiCanvas(editor, width = 520, height = 320) {
    if (!editor) return;

    const html = `
        <div class="pisi-canvas-block" contenteditable="false" data-pisi-canvas-block="1">
            <div class="pisi-canvas-toolbar-hint">Paint tuvali · çizmek için tuvale tıkla</div>
            <canvas class="pisi-paint-canvas" data-pisi-canvas="1" width="${Number(width)}" height="${Number(height)}"></canvas>
        </div>
        <div><br></div>
    `;

    insertHtmlIntoPisiEditor(editor, html);
    initializePisiAdvancedEditorContent(editor);
    notifyPisiEditorChanged(editor);
}

function insertHtmlIntoPisiEditor(editor, html) {
    editor.focus({ preventScroll: true });

    const selection = window.getSelection();
    const canInsertAtSelection = selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode);

    if (canInsertAtSelection) {
        document.execCommand('insertHTML', false, html);
        return;
    }

    editor.insertAdjacentHTML('beforeend', html);
}

function bindPisiAdvancedEditorDropTargets() {
    document.querySelectorAll('.pisi-rich-editor').forEach((editor) => {
        if (editor.dataset.pisiAdvancedDropBound === '1') return;

        editor.dataset.pisiAdvancedDropBound = '1';

        editor.addEventListener('dragover', (event) => {
            if (event.dataTransfer?.types?.includes('text/x-pisi-paint-canvas')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
            }
        });

        editor.addEventListener('drop', (event) => {
            if (!event.dataTransfer?.types?.includes('text/x-pisi-paint-canvas')) return;

            event.preventDefault();
            movePisiCaretToPoint(editor, event.clientX, event.clientY);

            const toolbar = document.querySelector(`.pisi-editor-toolbar[data-editor-target="${editor.id}"]`);
            const width = toolbar ? getPisiToolbarNumber(toolbar, '[data-pisi-paint-width]', 520) : 520;
            const height = toolbar ? getPisiToolbarNumber(toolbar, '[data-pisi-paint-height]', 320) : 320;

            insertPisiCanvas(editor, width, height);
        });
    });
}

function movePisiCaretToPoint(editor, x, y) {
    let range = null;

    if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
        const position = document.caretPositionFromPoint(x, y);
        if (position) {
            range = document.createRange();
            range.setStart(position.offsetNode, position.offset);
            range.collapse(true);
        }
    }

    if (!range || !editor.contains(range.startContainer)) {
        editor.focus({ preventScroll: true });
        return;
    }

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
}

function initializePisiAdvancedEditorContent(editor) {
    if (!editor) return;

    bindPisiAdvancedEditorDropTargets();
    hydratePisiPaintCanvases(editor);
    hydratePisiSheets(editor);
}

const pisiBoundPaintCanvases = new WeakSet();

const pisiLoadedPaintImages = new WeakMap();

const pisiPendingPaintImages = new WeakMap();

const pisiDirtyPaintCanvases = new WeakSet();

function resetPisiCanvasToWhite(canvas) {
    const context = canvas?.getContext?.('2d');
    if (!context) return;

    context.save();
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
}

function ensurePisiCanvasWhiteBackground(canvas) {
    const context = canvas?.getContext?.('2d');
    if (!context) return;

    context.save();
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
}

function hydratePisiPaintCanvases(root = document) {
    root.querySelectorAll('canvas[data-pisi-canvas]').forEach((canvas) => {
        canvas.removeAttribute('data-pisi-canvas-bound');
        canvas.removeAttribute('data-image-loaded');

        if (!pisiBoundPaintCanvases.has(canvas)) {
            bindPisiCanvas(canvas);
        }

        const storedImage = canvas.dataset.image || '';

        if (!storedImage) {
            pisiLoadedPaintImages.delete(canvas);
            pisiPendingPaintImages.delete(canvas);
            resetPisiCanvasToWhite(canvas);
            return;
        }

        if (
            pisiLoadedPaintImages.get(canvas) === storedImage ||
            pisiPendingPaintImages.get(canvas) === storedImage
        ) {
            return;
        }

        const image = new Image();
        pisiPendingPaintImages.set(canvas, storedImage);

        image.onload = () => {
            if (pisiPendingPaintImages.get(canvas) !== storedImage) return;

            const context = canvas.getContext('2d');
            resetPisiCanvasToWhite(canvas);
            context.save();
            context.globalCompositeOperation = 'source-over';
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            context.restore();

            pisiLoadedPaintImages.set(canvas, storedImage);
            pisiPendingPaintImages.delete(canvas);
            pisiDirtyPaintCanvases.delete(canvas);
        };

        image.onerror = () => {
            if (pisiPendingPaintImages.get(canvas) === storedImage) {
                pisiPendingPaintImages.delete(canvas);
            }
        };

        image.src = storedImage;
    });
}

function bindPisiCanvas(canvas) {
    if (pisiBoundPaintCanvases.has(canvas)) return;

    pisiBoundPaintCanvases.add(canvas);
    let drawing = false;
    let start = null;
    let snapshot = null;

    canvas.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();

        selectPisiCanvas(canvas);
        if (pisiPendingPaintImages.has(canvas)) return;

        const context = canvas.getContext('2d');
        drawing = true;
        start = getPisiCanvasPoint(canvas, event);
        const paintTool = getPisiPaintState().tool;
        snapshot = ['line', 'rect', 'ellipse'].includes(paintTool)
            ? context.getImageData(0, 0, canvas.width, canvas.height)
            : null;
        pisiDirtyPaintCanvases.add(canvas);

        if (canvas.setPointerCapture) {
            canvas.setPointerCapture(event.pointerId);
        }

        if (['pencil', 'brush', 'eraser'].includes(getPisiPaintState().tool)) {
            context.beginPath();
            context.moveTo(start.x, start.y);
        }
    });

    canvas.addEventListener('pointermove', (event) => {
        if (!drawing || !start) return;

        event.preventDefault();
        const state = getPisiPaintState();
        const context = canvas.getContext('2d');
        const point = getPisiCanvasPoint(canvas, event);

        if (['pencil', 'brush', 'eraser'].includes(state.tool)) {
            context.lineCap = 'round';
            context.lineJoin = 'round';
            context.lineWidth = state.size;
            context.strokeStyle = state.tool === 'eraser' ? '#ffffff' : state.color;
            context.globalCompositeOperation = 'source-over';
            context.lineTo(point.x, point.y);
            context.stroke();
            context.globalCompositeOperation = 'source-over';
            return;
        }

        if (snapshot) {
            context.putImageData(snapshot, 0, 0);
        }
        drawPisiCanvasShape(context, state, start, point);
    });

    function finish(event) {
        if (!drawing) return;

        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        drawing = false;
        start = null;
        snapshot = null;
        savePisiCanvasData(canvas);
        notifyPisiEditorChanged(getEditorForPisiElement(canvas));
    }

    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    canvas.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectPisiCanvas(canvas);
    });
}

function selectPisiCanvas(canvas) {
    document.querySelectorAll('.pisi-paint-canvas.selected').forEach((existing) => {
        existing.classList.remove('selected');
    });

    canvas.classList.add('selected');
    getPisiPaintState().activeCanvas = canvas;
}

function getPisiCanvasPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);

    return { x, y };
}

function drawPisiCanvasShape(context, state, start, point) {
    context.lineWidth = state.size;
    context.strokeStyle = state.color;
    context.fillStyle = 'transparent';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();

    if (state.tool === 'line') {
        context.moveTo(start.x, start.y);
        context.lineTo(point.x, point.y);
    } else if (state.tool === 'rect') {
        context.rect(start.x, start.y, point.x - start.x, point.y - start.y);
    } else if (state.tool === 'ellipse') {
        const centerX = (start.x + point.x) / 2;
        const centerY = (start.y + point.y) / 2;
        const radiusX = Math.abs(point.x - start.x) / 2;
        const radiusY = Math.abs(point.y - start.y) / 2;
        context.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    }

    context.stroke();
}

function savePisiCanvasData(canvas) {
    canvas.removeAttribute('data-pisi-canvas-bound');
    canvas.removeAttribute('data-image-loaded');

    try {
        const storedImage = canvas.dataset.image || '';
        const loadedImage = pisiLoadedPaintImages.get(canvas) || '';

        if (
            storedImage &&
            loadedImage !== storedImage &&
            !pisiDirtyPaintCanvases.has(canvas)
        ) {
            return storedImage;
        }

        ensurePisiCanvasWhiteBackground(canvas);
        const imageData = canvas.toDataURL('image/png');
        canvas.dataset.image = imageData;

        pisiLoadedPaintImages.set(canvas, imageData);
        pisiPendingPaintImages.delete(canvas);
        pisiDirtyPaintCanvases.delete(canvas);

        return imageData;
    } catch (error) {
        console.warn('[PISI] Tuval görüntüsü kaydedilemedi:', error);
        return canvas.dataset.image || '';
    }
}

function getEditorForPisiElement(element) {
    return element?.closest?.('.pisi-rich-editor') || null;
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "getPisiToolbarEditor": {
        enumerable: true,
        get() { return getPisiToolbarEditor; }
    },
    "notifyPisiEditorChanged": {
        enumerable: true,
        get() { return notifyPisiEditorChanged; }
    },
    "runPisiEditorCommand": {
        enumerable: true,
        get() { return runPisiEditorCommand; }
    },
    "buildPisiRichToolbarControls": {
        enumerable: true,
        get() { return buildPisiRichToolbarControls; }
    },
    "buildPisiPaintToolbarControls": {
        enumerable: true,
        get() { return buildPisiPaintToolbarControls; }
    },
    "buildPisiExcelToolbarControls": {
        enumerable: true,
        get() { return buildPisiExcelToolbarControls; }
    },
    "setupPisiRichToolbars": {
        enumerable: true,
        get() { return setupPisiRichToolbars; }
    },
    "switchPisiToolbarTab": {
        enumerable: true,
        get() { return switchPisiToolbarTab; }
    },
    "getPisiPaintState": {
        enumerable: true,
        get() { return getPisiPaintState; }
    },
    "updatePisiPaintStateFromToolbar": {
        enumerable: true,
        get() { return updatePisiPaintStateFromToolbar; }
    },
    "setPisiPaintTool": {
        enumerable: true,
        get() { return setPisiPaintTool; }
    },
    "getPisiToolbarNumber": {
        enumerable: true,
        get() { return getPisiToolbarNumber; }
    },
    "runPisiPaintAction": {
        enumerable: true,
        get() { return runPisiPaintAction; }
    },
    "insertPisiCanvasFromToolbar": {
        enumerable: true,
        get() { return insertPisiCanvasFromToolbar; }
    },
    "insertPisiCanvas": {
        enumerable: true,
        get() { return insertPisiCanvas; }
    },
    "insertHtmlIntoPisiEditor": {
        enumerable: true,
        get() { return insertHtmlIntoPisiEditor; }
    },
    "bindPisiAdvancedEditorDropTargets": {
        enumerable: true,
        get() { return bindPisiAdvancedEditorDropTargets; }
    },
    "movePisiCaretToPoint": {
        enumerable: true,
        get() { return movePisiCaretToPoint; }
    },
    "initializePisiAdvancedEditorContent": {
        enumerable: true,
        get() { return initializePisiAdvancedEditorContent; }
    },
    "pisiBoundPaintCanvases": {
        enumerable: true,
        get() { return pisiBoundPaintCanvases; }
    },
    "pisiLoadedPaintImages": {
        enumerable: true,
        get() { return pisiLoadedPaintImages; }
    },
    "pisiPendingPaintImages": {
        enumerable: true,
        get() { return pisiPendingPaintImages; }
    },
    "pisiDirtyPaintCanvases": {
        enumerable: true,
        get() { return pisiDirtyPaintCanvases; }
    },
    "resetPisiCanvasToWhite": {
        enumerable: true,
        get() { return resetPisiCanvasToWhite; }
    },
    "ensurePisiCanvasWhiteBackground": {
        enumerable: true,
        get() { return ensurePisiCanvasWhiteBackground; }
    },
    "hydratePisiPaintCanvases": {
        enumerable: true,
        get() { return hydratePisiPaintCanvases; }
    },
    "bindPisiCanvas": {
        enumerable: true,
        get() { return bindPisiCanvas; }
    },
    "selectPisiCanvas": {
        enumerable: true,
        get() { return selectPisiCanvas; }
    },
    "getPisiCanvasPoint": {
        enumerable: true,
        get() { return getPisiCanvasPoint; }
    },
    "drawPisiCanvasShape": {
        enumerable: true,
        get() { return drawPisiCanvasShape; }
    },
    "savePisiCanvasData": {
        enumerable: true,
        get() { return savePisiCanvasData; }
    },
    "getEditorForPisiElement": {
        enumerable: true,
        get() { return getEditorForPisiElement; }
    }
});
registerModule("editor.paint", moduleApi);
