(function initKediNamespace() {
    const previousKedi = window.Kedi || {};
    const previousState = previousKedi.state || {};

    window.Kedi = {
        state: {


            activeCenterNode: previousState.activeCenterNode ?? null,
            centerNodeSaveTimer: previousState.centerNodeSaveTimer ?? null,
            
            activeMapPath: previousState.activeMapPath ?? null,
            activeMapNodes: previousState.activeMapNodes ?? [],
            activeMapEdges: previousState.activeMapEdges ?? [],
            activeMapCamera: previousState.activeMapCamera ?? { x: 0, y: 0, zoom: 1 },

            activeModalNode: previousState.activeModalNode ?? null,

            mapSaveTimer: previousState.mapSaveTimer ?? null,
            mapCameraSaveTimer: previousState.mapCameraSaveTimer ?? null,

            mapCanvasPanBound: previousState.mapCanvasPanBound ?? false,
            mapZoomEventsBound: previousState.mapZoomEventsBound ?? false,
            mapZoomControlsBound: previousState.mapZoomControlsBound ?? false,

            currentConnectionDrag: previousState.currentConnectionDrag ?? null,
            currentMapBoxSelection: previousState.currentMapBoxSelection ?? null,

            collapsedHubPorts:
                previousState.collapsedHubPorts instanceof Set
                    ? previousState.collapsedHubPorts
                    : new Set(),

            projectRefreshTimer: previousState.projectRefreshTimer ?? null,
            selectedTreeItem: previousState.selectedTreeItem ?? null,

            expandedTreePaths:
                previousState.expandedTreePaths instanceof Set
                    ? previousState.expandedTreePaths
                    : new Set(),

            suppressFileSystemRefreshUntil:
                previousState.suppressFileSystemRefreshUntil ?? 0,

            kediTagsPanelState:
                previousState.kediTagsPanelState ?? {
                    selectedTag: null,
                    index: []
                },

            kediTagsPanelRefreshTimer:
                previousState.kediTagsPanelRefreshTimer ?? null,

            KEDI_USER_TAG_CACHE:
                previousState.KEDI_USER_TAG_CACHE instanceof Set
                    ? previousState.KEDI_USER_TAG_CACHE
                    : new Set(),

            kediTagMenuState:
                previousState.kediTagMenuState ?? {
                    active: false,
                    command: '',
                    range: null,
                    items: [],
                    selectedIndex: 0
                },

            openTabs: Array.isArray(previousState.openTabs)
            ? previousState.openTabs
            : [],

            activeTabPath: previousState.activeTabPath ?? null,

            kediCalendarState: previousState.kediCalendarState ?? null,
        },

        

        api: window.kediProject,

        ui: previousKedi.ui || {},
        tree: previousKedi.tree || {},
        map: previousKedi.map || {},
        tags: previousKedi.tags || {},
        connections: previousKedi.connections || {},
        calendar: previousKedi.calendar || {}
    };

    function defineKediStateBridge(name) {
        if (Object.prototype.hasOwnProperty.call(window, name)) {
            return;
        }

        Object.defineProperty(window, name, {
            configurable: true,
            get() {
                return window.Kedi.state[name];
            },
            set(value) {
                window.Kedi.state[name] = value;
            }
        });
    }

    [
        'activeMapPath',
        'activeMapNodes',
        'activeMapEdges',
        'activeMapCamera',
        'activeModalNode',

        'mapSaveTimer',
        'mapCameraSaveTimer',

        'mapCanvasPanBound',
        'mapZoomEventsBound',
        'mapZoomControlsBound',

        'currentConnectionDrag',
        'currentMapBoxSelection',
        'collapsedHubPorts',

        'projectRefreshTimer',
        'selectedTreeItem',
        'expandedTreePaths',
        'suppressFileSystemRefreshUntil',

        'kediTagsPanelState',
        'kediTagsPanelRefreshTimer',
        'KEDI_USER_TAG_CACHE',
        'kediTagMenuState',

        'openTabs',
        'activeTabPath',
        'kediCalendarState',

        'activeCenterNode',
        'centerNodeSaveTimer',

    ].forEach(defineKediStateBridge);
})();

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[KEDI] Temiz arayüz yüklendi.');

    setupWindowControls();
    setupCenterFileTabs();
    bindRightPanelTabs();
    setupKediCustomizations();
    setupKediRichToolbars();
    
    bindKediTagControls();
    bindKediBlockIndexControls();

    await setupProjectStartup();

    if (typeof refreshKediCalendarDates === 'function') {
        await refreshKediCalendarDates();
    }
});


function getKediToolbarEditor(toolbar) {
    if (!toolbar) return null;

    const targetId = toolbar.dataset.editorTarget;
    return targetId ? document.getElementById(targetId) : null;
}

function notifyKediEditorChanged(editor) {
    if (!editor) return;

    if (typeof ensureKediEditorBlocks === 'function') {
        ensureKediEditorBlocks(editor);
    }

    if (typeof initializeKediAdvancedEditorContent === 'function') {
        initializeKediAdvancedEditorContent(editor);
    }

    editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'formatSet'
    }));

    if (typeof refreshKediTagsPanelSoon === 'function') {
        refreshKediTagsPanelSoon();
    }
}

function runKediEditorCommand(toolbar, command, value = null) {
    const editor = getKediToolbarEditor(toolbar);
    if (!editor) return;

    editor.focus({ preventScroll: true });
    document.execCommand(command, false, value);
    notifyKediEditorChanged(editor);
}

function buildKediRichToolbarControls(controls) {
    if (!controls || controls.dataset.rendered === '1') return;

    controls.dataset.rendered = '1';
    controls.innerHTML = `
        <select class="kedi-word-select" data-kedi-toolbar-command="fontName" title="Yazı tipi">
            <option value="Segoe UI">Segoe UI</option>
            <option value="Arial">Arial</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Georgia">Georgia</option>
            <option value="Consolas">Consolas</option>
        </select>

        <select class="kedi-word-select" data-kedi-toolbar-command="formatBlock" title="Başlık / paragraf">
            <option value="div">Normal</option>
            <option value="h2">Başlık 1</option>
            <option value="h3">Başlık 2</option>
            <option value="h4">Başlık 3</option>
            <option value="h5">Alt başlık</option>
        </select>

        <select class="kedi-word-select kedi-word-size-select" data-kedi-toolbar-command="fontSize" title="Yazı boyutu">
            <option value="2">Küçük</option>
            <option value="3" selected>Normal</option>
            <option value="4">Büyük</option>
            <option value="5">Çok büyük</option>
            <option value="6">Dev</option>
        </select>

        <span class="kedi-word-separator"></span>

        <button type="button" class="kedi-word-btn" data-kedi-toolbar-command="bold" title="Kalın"><b>B</b></button>
        <button type="button" class="kedi-word-btn" data-kedi-toolbar-command="italic" title="İtalik"><i>I</i></button>
        <button type="button" class="kedi-word-btn" data-kedi-toolbar-command="underline" title="Altı çizili"><u>U</u></button>

        <label class="kedi-word-color" title="Yazı rengi">
            A
            <input type="color" data-kedi-toolbar-command="foreColor" value="#d4d4d4">
        </label>

        <span class="kedi-word-separator"></span>

        <button type="button" class="kedi-word-btn" data-kedi-toolbar-command="insertUnorderedList" title="Madde işaretleri">• Liste</button>
        <button type="button" class="kedi-word-btn" data-kedi-toolbar-command="insertOrderedList" title="Numaralı liste">1. Liste</button>

        <span class="kedi-word-separator"></span>

        <button type="button" class="kedi-word-btn" data-kedi-toolbar-command="justifyLeft" title="Sola hizala">☰</button>
        <button type="button" class="kedi-word-btn" data-kedi-toolbar-command="justifyCenter" title="Ortala">☷</button>
        <button type="button" class="kedi-word-btn" data-kedi-toolbar-command="justifyRight" title="Sağa hizala">☱</button>
    `;
}

function buildKediPaintToolbarControls(controls) {
    if (!controls || controls.dataset.rendered === '1') return;

    controls.dataset.rendered = '1';
    controls.innerHTML = `
        <button type="button" class="kedi-word-btn kedi-paint-create" data-kedi-paint-action="createCanvas" draggable="true" title="Tuval oluştur; istersen bu butonu editöre sürükle">🎨 Tuval</button>
        <label class="kedi-toolbar-field">En <input class="kedi-toolbar-number" type="number" min="80" max="1600" step="10" value="520" data-kedi-paint-width></label>
        <label class="kedi-toolbar-field">Boy <input class="kedi-toolbar-number" type="number" min="60" max="1200" step="10" value="320" data-kedi-paint-height></label>
        <span class="kedi-word-separator"></span>
        <button type="button" class="kedi-word-btn active" data-kedi-paint-tool="pencil" title="Kalem">Kalem</button>
        <button type="button" class="kedi-word-btn" data-kedi-paint-tool="eraser" title="Silgi">Silgi</button>
        <button type="button" class="kedi-word-btn" data-kedi-paint-tool="line" title="Çizgi">Çizgi</button>
        <button type="button" class="kedi-word-btn" data-kedi-paint-tool="rect" title="Dikdörtgen">▭</button>
        <button type="button" class="kedi-word-btn" data-kedi-paint-tool="ellipse" title="Elips">◯</button>
        <label class="kedi-word-color" title="Çizim rengi">R<input type="color" value="#f39c12" data-kedi-paint-color></label>
        <label class="kedi-toolbar-field">Fırça <input class="kedi-toolbar-number" type="number" min="1" max="80" step="1" value="4" data-kedi-paint-size></label>
        <button type="button" class="kedi-word-btn" data-kedi-paint-action="clearCanvas" title="Seçili tuvali temizle">Temizle</button>
    `;
}

function buildKediExcelToolbarControls(controls) {
    if (!controls || controls.dataset.rendered === '1') return;

    controls.dataset.rendered = '1';
    controls.innerHTML = `
        <button type="button" class="kedi-word-btn" data-kedi-excel-action="insertTable" title="Tablo ekle">📊 Tablo</button>
        <label class="kedi-toolbar-field">Satır <input class="kedi-toolbar-number" type="number" min="1" max="80" step="1" value="5" data-kedi-excel-rows></label>
        <label class="kedi-toolbar-field">Sütun <input class="kedi-toolbar-number" type="number" min="1" max="26" step="1" value="5" data-kedi-excel-cols></label>
        <span class="kedi-word-separator"></span>
        <button type="button" class="kedi-word-btn" data-kedi-excel-action="addRow">+ Satır</button>
        <button type="button" class="kedi-word-btn" data-kedi-excel-action="addCol">+ Sütun</button>
        <button type="button" class="kedi-word-btn" data-kedi-excel-action="recalc">Hesapla</button>
        <span class="kedi-word-separator"></span>
        <input class="kedi-excel-formula-input" type="text" placeholder="=SUM(A1:B2), =A1+B1" data-kedi-excel-formula>
        <button type="button" class="kedi-word-btn" data-kedi-excel-action="applyFormula">Uygula</button>
    `;
}

function setupKediRichToolbars() {
    document.querySelectorAll('.kedi-editor-toolbar, .kedi-word-toolbar').forEach((toolbar) => {
        if (toolbar.dataset.bound === '1') return;

        buildKediRichToolbarControls(toolbar.querySelector('.kedi-word-toolbar-controls'));
        buildKediPaintToolbarControls(toolbar.querySelector('.kedi-paint-toolbar-controls'));
        buildKediExcelToolbarControls(toolbar.querySelector('.kedi-excel-toolbar-controls'));

        toolbar.addEventListener('mousedown', (event) => {
            if (event.target.closest('button')) {
                event.preventDefault();
            }
        });

        toolbar.addEventListener('click', (event) => {
            const tabButton = event.target.closest('[data-kedi-toolbar-tab]');
            if (tabButton) {
                event.preventDefault();
                event.stopPropagation();
                switchKediToolbarTab(toolbar, tabButton.dataset.kediToolbarTab);
                return;
            }

            const wordButton = event.target.closest('button[data-kedi-toolbar-command]');
            if (wordButton) {
                event.preventDefault();
                event.stopPropagation();
                runKediEditorCommand(toolbar, wordButton.dataset.kediToolbarCommand);
                return;
            }

            const paintTool = event.target.closest('[data-kedi-paint-tool]');
            if (paintTool) {
                event.preventDefault();
                event.stopPropagation();
                setKediPaintTool(toolbar, paintTool.dataset.kediPaintTool);
                return;
            }

            const paintAction = event.target.closest('[data-kedi-paint-action]');
            if (paintAction) {
                event.preventDefault();
                event.stopPropagation();
                runKediPaintAction(toolbar, paintAction.dataset.kediPaintAction);
                return;
            }

            const excelAction = event.target.closest('[data-kedi-excel-action]');
            if (excelAction) {
                event.preventDefault();
                event.stopPropagation();
                runKediExcelAction(toolbar, excelAction.dataset.kediExcelAction);
            }
        });

        toolbar.addEventListener('change', (event) => {
            const wordControl = event.target.closest('[data-kedi-toolbar-command]');
            if (wordControl) {
                event.preventDefault();
                event.stopPropagation();
                runKediEditorCommand(toolbar, wordControl.dataset.kediToolbarCommand, wordControl.value);
                return;
            }

            if (event.target.matches('[data-kedi-paint-color], [data-kedi-paint-size]')) {
                updateKediPaintStateFromToolbar(toolbar);
            }
        });

        const createBtn = toolbar.querySelector('[data-kedi-paint-action="createCanvas"]');
        if (createBtn) {
            createBtn.addEventListener('dragstart', (event) => {
                event.dataTransfer?.setData('text/x-kedi-paint-canvas', '1');
                event.dataTransfer?.setData('text/plain', 'KEDI_CANVAS');
                event.dataTransfer.effectAllowed = 'copy';
            });
        }

        toolbar.dataset.bound = '1';
    });

    bindKediAdvancedEditorDropTargets();
}

function switchKediToolbarTab(toolbar, tabName) {
    toolbar.querySelectorAll('[data-kedi-toolbar-tab]').forEach((button) => {
        button.classList.toggle('active', button.dataset.kediToolbarTab === tabName);
    });

    toolbar.querySelectorAll('[data-kedi-toolbar-panel]').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.kediToolbarPanel === tabName);
    });
}

function getKediPaintState() {
    if (!window.__kediPaintState) {
        window.__kediPaintState = {
            tool: 'pencil',
            color: '#f39c12',
            size: 4,
            activeCanvas: null
        };
    }

    return window.__kediPaintState;
}

function updateKediPaintStateFromToolbar(toolbar) {
    const state = getKediPaintState();
    const color = toolbar.querySelector('[data-kedi-paint-color]')?.value;
    const size = Number(toolbar.querySelector('[data-kedi-paint-size]')?.value || 4);

    if (color) state.color = color;
    if (Number.isFinite(size) && size > 0) state.size = size;
}

function setKediPaintTool(toolbar, tool) {
    const state = getKediPaintState();
    state.tool = tool || 'pencil';
    updateKediPaintStateFromToolbar(toolbar);

    toolbar.querySelectorAll('[data-kedi-paint-tool]').forEach((button) => {
        button.classList.toggle('active', button.dataset.kediPaintTool === state.tool);
    });
}

function getKediToolbarNumber(toolbar, selector, fallback) {
    const value = Number(toolbar.querySelector(selector)?.value || fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function runKediPaintAction(toolbar, action) {
    updateKediPaintStateFromToolbar(toolbar);

    if (action === 'createCanvas') {
        insertKediCanvasFromToolbar(toolbar);
        return;
    }

    if (action === 'clearCanvas') {
        const canvas = getKediPaintState().activeCanvas;
        if (!canvas) return;
        if (kediPendingPaintImages.has(canvas)) return;

        resetKediCanvasToWhite(canvas);
        kediDirtyPaintCanvases.add(canvas);
        saveKediCanvasData(canvas);
        notifyKediEditorChanged(getEditorForKediElement(canvas));
    }
}

function insertKediCanvasFromToolbar(toolbar) {
    const editor = getKediToolbarEditor(toolbar);
    if (!editor) return;

    const width = Math.max(80, Math.min(1600, getKediToolbarNumber(toolbar, '[data-kedi-paint-width]', 520)));
    const height = Math.max(60, Math.min(1200, getKediToolbarNumber(toolbar, '[data-kedi-paint-height]', 320)));

    insertKediCanvas(editor, width, height);
}

function insertKediCanvas(editor, width = 520, height = 320) {
    if (!editor) return;

    const html = `
        <div class="kedi-canvas-block" contenteditable="false" data-kedi-canvas-block="1">
            <div class="kedi-canvas-toolbar-hint">Paint tuvali · çizmek için tuvale tıkla</div>
            <canvas class="kedi-paint-canvas" data-kedi-canvas="1" width="${Number(width)}" height="${Number(height)}"></canvas>
        </div>
        <div><br></div>
    `;

    insertHtmlIntoKediEditor(editor, html);
    initializeKediAdvancedEditorContent(editor);
    notifyKediEditorChanged(editor);
}

function insertHtmlIntoKediEditor(editor, html) {
    editor.focus({ preventScroll: true });

    const selection = window.getSelection();
    const canInsertAtSelection = selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode);

    if (canInsertAtSelection) {
        document.execCommand('insertHTML', false, html);
        return;
    }

    editor.insertAdjacentHTML('beforeend', html);
}

function bindKediAdvancedEditorDropTargets() {
    document.querySelectorAll('.kedi-rich-editor').forEach((editor) => {
        if (editor.dataset.kediAdvancedDropBound === '1') return;

        editor.dataset.kediAdvancedDropBound = '1';

        editor.addEventListener('dragover', (event) => {
            if (event.dataTransfer?.types?.includes('text/x-kedi-paint-canvas')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
            }
        });

        editor.addEventListener('drop', (event) => {
            if (!event.dataTransfer?.types?.includes('text/x-kedi-paint-canvas')) return;

            event.preventDefault();
            moveKediCaretToPoint(editor, event.clientX, event.clientY);

            const toolbar = document.querySelector(`.kedi-editor-toolbar[data-editor-target="${editor.id}"]`);
            const width = toolbar ? getKediToolbarNumber(toolbar, '[data-kedi-paint-width]', 520) : 520;
            const height = toolbar ? getKediToolbarNumber(toolbar, '[data-kedi-paint-height]', 320) : 320;

            insertKediCanvas(editor, width, height);
        });
    });
}

function moveKediCaretToPoint(editor, x, y) {
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

function initializeKediAdvancedEditorContent(editor) {
    if (!editor) return;

    bindKediAdvancedEditorDropTargets();
    hydrateKediPaintCanvases(editor);
    hydrateKediSheets(editor);
}

const kediBoundPaintCanvases = new WeakSet();
const kediLoadedPaintImages = new WeakMap();
const kediPendingPaintImages = new WeakMap();
const kediDirtyPaintCanvases = new WeakSet();

function resetKediCanvasToWhite(canvas) {
    const context = canvas?.getContext?.('2d');
    if (!context) return;

    context.save();
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
}

function ensureKediCanvasWhiteBackground(canvas) {
    const context = canvas?.getContext?.('2d');
    if (!context) return;

    context.save();
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
}

function hydrateKediPaintCanvases(root = document) {
    root.querySelectorAll('canvas[data-kedi-canvas]').forEach((canvas) => {
        canvas.removeAttribute('data-kedi-canvas-bound');
        canvas.removeAttribute('data-image-loaded');

        if (!kediBoundPaintCanvases.has(canvas)) {
            bindKediCanvas(canvas);
        }

        const storedImage = canvas.dataset.image || '';

        if (!storedImage) {
            kediLoadedPaintImages.delete(canvas);
            kediPendingPaintImages.delete(canvas);
            resetKediCanvasToWhite(canvas);
            return;
        }

        if (
            kediLoadedPaintImages.get(canvas) === storedImage ||
            kediPendingPaintImages.get(canvas) === storedImage
        ) {
            return;
        }

        const image = new Image();
        kediPendingPaintImages.set(canvas, storedImage);

        image.onload = () => {
            if (kediPendingPaintImages.get(canvas) !== storedImage) return;

            const context = canvas.getContext('2d');
            resetKediCanvasToWhite(canvas);
            context.save();
            context.globalCompositeOperation = 'source-over';
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            context.restore();

            kediLoadedPaintImages.set(canvas, storedImage);
            kediPendingPaintImages.delete(canvas);
            kediDirtyPaintCanvases.delete(canvas);
        };

        image.onerror = () => {
            if (kediPendingPaintImages.get(canvas) === storedImage) {
                kediPendingPaintImages.delete(canvas);
            }
        };

        image.src = storedImage;
    });
}

function bindKediCanvas(canvas) {
    if (kediBoundPaintCanvases.has(canvas)) return;

    kediBoundPaintCanvases.add(canvas);
    let drawing = false;
    let start = null;
    let snapshot = null;

    canvas.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();

        selectKediCanvas(canvas);
        if (kediPendingPaintImages.has(canvas)) return;

        const context = canvas.getContext('2d');
        drawing = true;
        start = getKediCanvasPoint(canvas, event);
        const paintTool = getKediPaintState().tool;
        snapshot = ['line', 'rect', 'ellipse'].includes(paintTool)
            ? context.getImageData(0, 0, canvas.width, canvas.height)
            : null;
        kediDirtyPaintCanvases.add(canvas);

        if (canvas.setPointerCapture) {
            canvas.setPointerCapture(event.pointerId);
        }

        if (['pencil', 'eraser'].includes(getKediPaintState().tool)) {
            context.beginPath();
            context.moveTo(start.x, start.y);
        }
    });

    canvas.addEventListener('pointermove', (event) => {
        if (!drawing || !start) return;

        event.preventDefault();
        const state = getKediPaintState();
        const context = canvas.getContext('2d');
        const point = getKediCanvasPoint(canvas, event);

        if (state.tool === 'pencil' || state.tool === 'eraser') {
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
        drawKediCanvasShape(context, state, start, point);
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
        saveKediCanvasData(canvas);
        notifyKediEditorChanged(getEditorForKediElement(canvas));
    }

    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    canvas.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectKediCanvas(canvas);
    });
}

function selectKediCanvas(canvas) {
    document.querySelectorAll('.kedi-paint-canvas.selected').forEach((existing) => {
        existing.classList.remove('selected');
    });

    canvas.classList.add('selected');
    getKediPaintState().activeCanvas = canvas;
}

function getKediCanvasPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);

    return { x, y };
}

function drawKediCanvasShape(context, state, start, point) {
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

function saveKediCanvasData(canvas) {
    canvas.removeAttribute('data-kedi-canvas-bound');
    canvas.removeAttribute('data-image-loaded');

    try {
        const storedImage = canvas.dataset.image || '';
        const loadedImage = kediLoadedPaintImages.get(canvas) || '';

        if (
            storedImage &&
            loadedImage !== storedImage &&
            !kediDirtyPaintCanvases.has(canvas)
        ) {
            return storedImage;
        }

        ensureKediCanvasWhiteBackground(canvas);
        const imageData = canvas.toDataURL('image/png');
        canvas.dataset.image = imageData;

        kediLoadedPaintImages.set(canvas, imageData);
        kediPendingPaintImages.delete(canvas);
        kediDirtyPaintCanvases.delete(canvas);

        return imageData;
    } catch (error) {
        console.warn('[KEDI] Tuval görüntüsü kaydedilemedi:', error);
        return canvas.dataset.image || '';
    }
}

function getEditorForKediElement(element) {
    return element?.closest?.('.kedi-rich-editor') || null;
}

function runKediExcelAction(toolbar, action) {
    const editor = getKediToolbarEditor(toolbar);
    if (!editor) return;

    if (action === 'insertTable') {
        const rows = Math.max(1, Math.min(80, getKediToolbarNumber(toolbar, '[data-kedi-excel-rows]', 5)));
        const cols = Math.max(1, Math.min(26, getKediToolbarNumber(toolbar, '[data-kedi-excel-cols]', 5)));
        insertKediSheet(editor, rows, cols);
        return;
    }

    const table = getActiveKediSheetForEditor(editor);
    if (!table) return;

    if (action === 'addRow') {
        addKediSheetRow(table);
    } else if (action === 'addCol') {
        addKediSheetColumn(table);
    } else if (action === 'recalc') {
        recalcKediSheet(table);
    } else if (action === 'applyFormula') {
        const input = toolbar.querySelector('[data-kedi-excel-formula]');
        applyKediSheetFormula(table, input?.value || '');
    }

    notifyKediEditorChanged(editor);
}

function insertKediSheet(editor, rows = 5, cols = 5) {
    const html = `
        <div class="kedi-sheet-block" contenteditable="false" data-kedi-sheet-block="1">
            ${buildKediSheetHtml(rows, cols)}
        </div>
        <div><br></div>
    `;

    insertHtmlIntoKediEditor(editor, html);
    initializeKediAdvancedEditorContent(editor);
    notifyKediEditorChanged(editor);
}

function buildKediSheetHtml(rows, cols) {
    let head = '<thead><tr><th></th>';
    for (let col = 0; col < cols; col += 1) {
        head += `<th>${kediColumnName(col)}</th>`;
    }
    head += '</tr></thead>';

    let body = '<tbody>';
    for (let row = 0; row < rows; row += 1) {
        body += `<tr><th>${row + 1}</th>`;
        for (let col = 0; col < cols; col += 1) {
            body += `<td contenteditable="true" data-row="${row}" data-col="${col}" data-cell="${kediColumnName(col)}${row + 1}"></td>`;
        }
        body += '</tr>';
    }
    body += '</tbody>';

    return `<table class="kedi-sheet-table" data-kedi-sheet="1">${head}${body}</table>`;
}

const KEDI_SHEET_MAX_ROWS = 80;
const KEDI_SHEET_MAX_COLS = 26;
const KEDI_SHEET_MAX_RANGE_CELLS =
    KEDI_SHEET_MAX_ROWS * KEDI_SHEET_MAX_COLS;
const kediBoundSheets = new WeakSet();
const kediEditedSheetCells = new WeakSet();

function hydrateKediSheets(root = document) {
    root.querySelectorAll('table[data-kedi-sheet]').forEach((table) => {
        table.removeAttribute('data-kedi-sheet-bound');
        refreshKediSheetCellMetadata(table);

        if (kediBoundSheets.has(table)) return;
        kediBoundSheets.add(table);

        table.addEventListener('focusin', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell) return;
            selectKediSheetCell(cell);
        });

        table.addEventListener('click', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell) return;
            selectKediSheetCell(cell);
        });

        table.addEventListener('keydown', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell) return;

            if (event.key === 'Enter') {
                event.preventDefault();
                cell.blur();
            }
        });

        table.addEventListener('input', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell) return;
            kediEditedSheetCells.add(cell);
        });

        table.addEventListener('blur', (event) => {
            const cell = event.target.closest('td[data-cell]');
            if (!cell) return;

            commitKediSheetCell(cell);
            recalcKediSheet(table);
            notifyKediEditorChanged(getEditorForKediElement(table));
        }, true);
    });
}

function selectKediSheetCell(cell) {
    document.querySelectorAll('.kedi-sheet-cell-selected').forEach((existing) => {
        existing.classList.remove('kedi-sheet-cell-selected');
    });

    cell.classList.add('kedi-sheet-cell-selected');
    window.__kediActiveSheetCell = cell;

    const toolbar = document.querySelector(`.kedi-editor-toolbar[data-editor-target="${getEditorForKediElement(cell)?.id}"]`);
    const formulaInput = toolbar?.querySelector('[data-kedi-excel-formula]');

    if (formulaInput) {
        formulaInput.value = cell.dataset.formula || cell.textContent.trim();
    }
}

function getActiveKediSheetForEditor(editor) {
    const activeCell = window.__kediActiveSheetCell;

    if (activeCell && editor.contains(activeCell)) {
        return activeCell.closest('table[data-kedi-sheet]');
    }

    return editor.querySelector('table[data-kedi-sheet]');
}

function applyKediSheetFormula(table, formula) {
    const activeCell = window.__kediActiveSheetCell;
    const cell = activeCell && table.contains(activeCell)
        ? activeCell
        : table.querySelector('td[data-cell]');

    if (!cell) return;

    const value = String(formula || '').trim();

    if (value.startsWith('=')) {
        cell.dataset.formula = value;
    } else {
        delete cell.dataset.formula;
        cell.textContent = value;
    }

    recalcKediSheet(table);
    selectKediSheetCell(cell);
}

function commitKediSheetCell(cell) {
    const value = cell.textContent.trim();
    const wasEdited = kediEditedSheetCells.has(cell);

    if (value.startsWith('=')) {
        cell.dataset.formula = value;
    } else if (wasEdited) {
        delete cell.dataset.formula;
        cell.textContent = value;
    } else if (!cell.dataset.formula) {
        cell.textContent = value;
    }

    kediEditedSheetCells.delete(cell);
}

function recalcKediSheet(table) {
    if (!table) return;

    refreshKediSheetCellMetadata(table);

    const cells = Array.from(table.querySelectorAll('td[data-cell]'));

    for (const cell of cells) {
        if (cell.dataset.formula) {
            const value = evaluateKediSheetFormula(table, cell.dataset.formula, new Set([cell.dataset.cell]));
            cell.textContent = Number.isFinite(value) ? formatKediSheetNumber(value) : '#ERR';
        }
    }
}

function evaluateKediSheetFormula(table, formula, stack = new Set()) {
    let expression = String(formula || '').trim();
    if (expression.startsWith('=')) expression = expression.slice(1);

    let formulaError = false;

    expression = expression.replace(/\b(SUM|AVG|MIN|MAX|COUNT)\(([A-Z]+\d+)(?::([A-Z]+\d+))?\)/gi, (_, fn, startRef, endRef) => {
        const range = getKediSheetRangeValues(
            table,
            startRef,
            endRef || startRef,
            stack
        );

        if (range.error) {
            formulaError = true;
            return '0';
        }

        const values = range.values;
        const upper = fn.toUpperCase();

        if (upper === 'SUM') return String(values.reduce((a, b) => a + b, 0));
        if (upper === 'COUNT') return String(values.length);

        if (!values.length) {
            formulaError = true;
            return '0';
        }

        if (upper === 'AVG') return String(values.reduce((a, b) => a + b, 0) / values.length);
        if (upper === 'MIN') return String(Math.min(...values));
        if (upper === 'MAX') return String(Math.max(...values));
        return '0';
    });

    expression = expression.replace(/\b([A-Z]+\d+)\b/g, (_, ref) => {
        const value = getKediSheetCellNumericValue(
            table,
            ref.toUpperCase(),
            stack
        );

        if (!Number.isFinite(value)) {
            formulaError = true;
            return '0';
        }

        return String(value);
    });

    if (
        formulaError ||
        !/^[0-9+\-*/().\s]+$/.test(expression)
    ) {
        return NaN;
    }

    return evaluateKediArithmeticExpression(expression);
}

function evaluateKediArithmeticExpression(expression) {
    const input = String(expression || '');
    let index = 0;

    function skipWhitespace() {
        while (/\s/.test(input[index] || '')) index += 1;
    }

    function parseNumber() {
        skipWhitespace();
        const match = input.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
        if (!match) return NaN;
        index += match[0].length;
        return Number(match[0]);
    }

    function parsePrimary() {
        skipWhitespace();

        if (input[index] === '(') {
            index += 1;
            const value = parseExpression();
            skipWhitespace();

            if (input[index] !== ')') return NaN;
            index += 1;
            return value;
        }

        return parseNumber();
    }

    function parseFactor() {
        skipWhitespace();

        if (input[index] === '+' || input[index] === '-') {
            const sign = input[index];
            index += 1;
            const value = parseFactor();
            return sign === '-' ? -value : value;
        }

        return parsePrimary();
    }

    function parseTerm() {
        let value = parseFactor();

        while (Number.isFinite(value)) {
            skipWhitespace();
            const operator = input[index];
            if (operator !== '*' && operator !== '/') break;
            index += 1;

            const right = parseFactor();
            if (!Number.isFinite(right)) return NaN;
            if (operator === '/' && right === 0) return NaN;
            value = operator === '*' ? value * right : value / right;
        }

        return value;
    }

    function parseExpression() {
        let value = parseTerm();

        while (Number.isFinite(value)) {
            skipWhitespace();
            const operator = input[index];
            if (operator !== '+' && operator !== '-') break;
            index += 1;

            const right = parseTerm();
            if (!Number.isFinite(right)) return NaN;
            value = operator === '+' ? value + right : value - right;
        }

        return value;
    }

    const result = parseExpression();
    skipWhitespace();

    return Number.isFinite(result) && index === input.length
        ? result
        : NaN;
}

function getKediSheetCellNumericValue(table, ref, stack = new Set()) {
    const result = getKediSheetCellValue(table, ref, stack);
    return result.error ? NaN : result.value;
}

function getKediSheetCellValue(table, ref, stack = new Set()) {
    const cell = table.querySelector(`td[data-cell="${ref}"]`);
    if (!cell) {
        return {
            value: NaN,
            numeric: false,
            error: true
        };
    }

    if (cell.dataset.formula) {
        if (stack.has(ref)) {
            return {
                value: NaN,
                numeric: false,
                error: true
            };
        }

        const nextStack = new Set(stack);
        nextStack.add(ref);
        const value = evaluateKediSheetFormula(
            table,
            cell.dataset.formula,
            nextStack
        );

        return {
            value,
            numeric: Number.isFinite(value),
            error: !Number.isFinite(value)
        };
    }

    const text = String(cell.textContent || '').trim();

    if (!text) {
        return {
            value: 0,
            numeric: false,
            error: false
        };
    }

    const numeric = Number(text.replace(',', '.'));

    return {
        value: Number.isFinite(numeric) ? numeric : 0,
        numeric: Number.isFinite(numeric),
        error: false
    };
}

function getKediSheetRangeValues(table, startRef, endRef, stack = new Set()) {
    const start = parseKediCellRef(startRef);
    const end = parseKediCellRef(endRef);
    const rows = table.querySelectorAll('tbody tr');
    const rowCount = rows.length;
    const colCount = Math.max(
        0,
        ...Array.from(rows).map((row) => row.querySelectorAll('td').length)
    );

    if (
        !start ||
        !end ||
        start.row < 0 ||
        end.row < 0 ||
        start.col < 0 ||
        end.col < 0 ||
        start.row >= rowCount ||
        end.row >= rowCount ||
        start.col >= colCount ||
        end.col >= colCount
    ) {
        return {
            values: [],
            error: true
        };
    }

    const values = [];
    const rowMin = Math.min(start.row, end.row);
    const rowMax = Math.max(start.row, end.row);
    const colMin = Math.min(start.col, end.col);
    const colMax = Math.max(start.col, end.col);
    const rangeSize =
        (rowMax - rowMin + 1) *
        (colMax - colMin + 1);

    if (rangeSize > KEDI_SHEET_MAX_RANGE_CELLS) {
        return {
            values: [],
            error: true
        };
    }

    for (let row = rowMin; row <= rowMax; row += 1) {
        for (let col = colMin; col <= colMax; col += 1) {
            const result = getKediSheetCellValue(
                table,
                `${kediColumnName(col)}${row + 1}`,
                stack
            );

            if (result.error) {
                return {
                    values: [],
                    error: true
                };
            }

            if (result.numeric) {
                values.push(result.value);
            }
        }
    }

    return {
        values,
        error: false
    };
}

function parseKediCellRef(ref) {
    const match = String(ref || '').toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;

    return {
        col: kediColumnIndex(match[1]),
        row: Number(match[2]) - 1
    };
}

function kediColumnName(index) {
    let name = '';
    let n = Number(index) + 1;

    while (n > 0) {
        const rem = (n - 1) % 26;
        name = String.fromCharCode(65 + rem) + name;
        n = Math.floor((n - 1) / 26);
    }

    return name;
}

function kediColumnIndex(name) {
    return String(name || '').toUpperCase().split('').reduce((sum, char) => {
        return sum * 26 + char.charCodeAt(0) - 64;
    }, 0) - 1;
}

function formatKediSheetNumber(value) {
    if (!Number.isFinite(value)) return '#ERR';
    if (Math.abs(value - Math.round(value)) < 1e-10) return String(Math.round(value));
    return String(Math.round(value * 1000000) / 1000000);
}

function refreshKediSheetCellMetadata(table) {
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    rows.forEach((row, rowIndex) => {
        let rowHeader = row.querySelector('th');
        if (!rowHeader) {
            rowHeader = document.createElement('th');
            row.prepend(rowHeader);
        }
        rowHeader.textContent = String(rowIndex + 1);

        Array.from(row.querySelectorAll('td')).forEach((cell, colIndex) => {
            cell.setAttribute('contenteditable', 'true');
            cell.dataset.row = String(rowIndex);
            cell.dataset.col = String(colIndex);
            cell.dataset.cell = `${kediColumnName(colIndex)}${rowIndex + 1}`;
        });
    });

    const colCount = Math.max(0, ...rows.map((row) => row.querySelectorAll('td').length));
    let thead = table.querySelector('thead');
    if (!thead) {
        thead = document.createElement('thead');
        table.prepend(thead);
    }

    let headerRow = thead.querySelector('tr');
    if (!headerRow) {
        headerRow = document.createElement('tr');
        thead.appendChild(headerRow);
    }

    headerRow.innerHTML = '<th></th>' + Array.from({ length: colCount }, (_, index) => `<th>${kediColumnName(index)}</th>`).join('');
}

function addKediSheetRow(table) {
    const tbody = table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));
    if (tbody.querySelectorAll('tr').length >= KEDI_SHEET_MAX_ROWS) return false;

    const colCount = Math.max(1, table.querySelector('tbody tr')?.querySelectorAll('td').length || 1);
    const row = document.createElement('tr');
    row.innerHTML = '<th></th>' + Array.from({ length: colCount }, () => '<td contenteditable="true"></td>').join('');
    tbody.appendChild(row);
    refreshKediSheetCellMetadata(table);
    return true;
}

function addKediSheetColumn(table) {
    const tbody = table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));
    const currentColCount =
        tbody.querySelector('tr')?.querySelectorAll('td').length || 0;

    if (currentColCount >= KEDI_SHEET_MAX_COLS) return false;

    if (!tbody.querySelector('tr')) {
        addKediSheetRow(table);
        return true;
    }

    tbody.querySelectorAll('tr').forEach((row) => {
        const cell = document.createElement('td');
        cell.setAttribute('contenteditable', 'true');
        row.appendChild(cell);
    });

    refreshKediSheetCellMetadata(table);
    return true;
}

function setupWindowControls() {
    const minBtn = document.getElementById('win-min');
    const maxBtn = document.getElementById('win-max');
    const closeBtn = document.getElementById('win-close');
    const maxIcon = document.getElementById('win-max-icon');

    function setMaximizedIcon(isMaximized) {
        if (!maxIcon) return;

        maxIcon.src = isMaximized
            ? 'assets/win-restore.png'
            : 'assets/win-max.png';

        maxIcon.alt = isMaximized ? 'Geri Al' : 'Büyüt';

        if (maxBtn) {
            maxBtn.title = isMaximized ? 'Geri Al' : 'Büyüt';
        }
    }

    minBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.electronWindow?.minimize();
    });

    maxBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.electronWindow?.toggleMaximize();
    });

    closeBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.electronWindow?.close();
    });

    window.electronWindow?.onMaximized?.(() => {
        setMaximizedIcon(true);
    });

    window.electronWindow?.onUnmaximized?.(() => {
        setMaximizedIcon(false);
    });

    window.electronWindow?.isMaximized?.().then((isMaximized) => {
        setMaximizedIcon(Boolean(isMaximized));
    });

    if (!setupWindowControls.closeUnsubscribe) {
        setupWindowControls.closeUnsubscribe =
            window.electronWindow?.onCloseRequested?.(async () => {
                if (typeof flushKediPendingSaves !== 'function') {
                    return true;
                }

                const saved = await flushKediPendingSaves();
                if (!saved) {
                    alert(
                        'KEDI kapatılmadı: bekleyen değişikliklerden en az biri kaydedilemedi.'
                    );
                }
                return saved;
            }) || null;
    }
}

setupWindowControls.closeUnsubscribe = null;

function bindRightPanelTabs() {
    const tabButtons = Array.from(document.querySelectorAll('.right-panel-tab'));
    const tabPages = Array.from(document.querySelectorAll('.right-tab-page'));

    if (!tabButtons.length || !tabPages.length) return;

    for (const button of tabButtons) {
        if (button.dataset.bound === '1') continue;
        button.dataset.bound = '1';

        button.addEventListener('click', () => {
    const target = button.dataset.rightTab;

    tabButtons.forEach((item) => {
        item.classList.toggle('active', item === button);
    });

    tabPages.forEach((page) => {
        page.classList.toggle(
            'active',
            page.id === `right-tab-${target}`
        );
    });

    const rightPanelContent = document.getElementById('right-panel-content');

    if (rightPanelContent) {
        rightPanelContent.scrollTop = 0;
    }

    const activePage = document.getElementById(`right-tab-${target}`);

    if (activePage) {
        activePage.scrollTop = 0;
    }

    if (
    (target === 'missions' || target === 'tags') &&
    typeof refreshKediTagsPanelSoon === 'function'
    ) {
    refreshKediTagsPanelSoon();
    }

    if (target === 'tags') {
    const resetRightPanelScroll = () => {
        const rightPanelContent = document.getElementById('right-panel-content');
        const tagsPage = document.getElementById('right-tab-tags');

        if (rightPanelContent) {
            rightPanelContent.scrollTop = 0;
        }

        if (tagsPage) {
            tagsPage.scrollTop = 0;
        }
    };

    resetRightPanelScroll();
    requestAnimationFrame(resetRightPanelScroll);
    setTimeout(resetRightPanelScroll, 50);
}
});
    }
}

function setupCenterFileTabs() {
    const toolbar = document.getElementById('center-toolbar');
    if (!toolbar) return;

    let tabsEl = document.getElementById('center-tabs');

    if (!tabsEl) {
        toolbar.innerHTML = '<div id="center-tabs" class="center-tabs"></div>';
        tabsEl = document.getElementById('center-tabs');
    }

    if (tabsEl.dataset.bound === '1') {
        renderKediOpenTabs();
        return;
    }

    tabsEl.dataset.bound = '1';

    tabsEl.addEventListener('wheel', (event) => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            tabsEl.scrollLeft += event.deltaY;
        }
    });

    renderKediOpenTabs();
}

function getKediOpenTabsState() {
    if (!window.Kedi) {
        window.Kedi = {
            state: {},
            api: window.kediProject,
            ui: {},
            tree: {},
            map: {},
            tags: {},
            connections: {}
        };
    }

    if (!window.Kedi.state) {
        window.Kedi.state = {};
    }

    if (!Array.isArray(window.Kedi.state.openTabs)) {
        window.Kedi.state.openTabs = [];
    }

    if (typeof window.Kedi.state.activeTabPath === 'undefined') {
        window.Kedi.state.activeTabPath = null;
    }

    return window.Kedi.state;
}

function kediSameTabPath(a, b) {
    if (!a || !b) return false;

    if (typeof sameClientPath === 'function') {
        return sameClientPath(a, b);
    }

    return String(a) === String(b);
}

function getKediOpenTabType(item) {
    const fileName = item?.name || '';

    if (fileName.toLowerCase().endsWith('.map')) return 'map';
    if (fileName.toLowerCase().endsWith('.node')) return 'node';

    return 'file';
}

function getKediOpenTabTitle(item) {
    const rawName =
        item?.metadata?.title ||
        item?.displayName ||
        item?.name ||
        item?.fileName ||
        'Untitled';

    return String(rawName).replace(/\.(map|node)$/i, '');
}

function cloneKediTabItem(item) {
    return {
        name: item.name || item.fileName,
        fileName: item.fileName || item.name,
        fullPath: item.fullPath,
        type: item.type,
        isFile: item.isFile !== false,
        isDirectory: Boolean(item.isDirectory),
        displayName: item.displayName,
        sidecarPath: item.sidecarPath,
        metadata: {
            ...(item.metadata || {})
        }
    };
}

function ensureKediOpenTab(item) {
    if (!item || !item.fullPath || item.isDirectory) return null;

    const type = getKediOpenTabType(item);

    if (type !== 'map' && type !== 'node') return null;

    const state = getKediOpenTabsState();

    let tab = state.openTabs.find((existingTab) => {
        return kediSameTabPath(existingTab.path, item.fullPath);
    });

    if (tab) {
        tab.title = getKediOpenTabTitle(item);
        tab.type = type;
        tab.item = cloneKediTabItem(item);
        return tab;
    }

    tab = {
        path: item.fullPath,
        type,
        title: getKediOpenTabTitle(item),
        item: cloneKediTabItem(item)
    };

    state.openTabs.push(tab);

    return tab;
}

async function openKediFileTab(item) {
    const tab = ensureKediOpenTab(item);

    if (!tab) return false;

    return activateKediOpenTab(tab.path);
}

async function activateKediOpenTab(path) {
    const state = getKediOpenTabsState();
    const previousActiveTabPath = state.activeTabPath;

    const tab = state.openTabs.find((existingTab) => {
        return kediSameTabPath(existingTab.path, path);
    });

    if (!tab) return false;

    const alreadyActive =
        state.activeTabPath &&
        kediSameTabPath(state.activeTabPath, tab.path);

    const alreadyLoaded =
        typeof activeMapPath !== 'undefined' &&
        activeMapPath &&
        kediSameTabPath(activeMapPath, tab.path);

    state.activeTabPath = tab.path;
    renderKediOpenTabs();

    if (alreadyActive && alreadyLoaded) {
        selectKediTreeFileByPath(tab.path);
        return true;
    }

    if (
    typeof saveCurrentCenterNodeEditor === 'function' &&
    activeCenterNode &&
    (!activeCenterNode.path || !kediSameTabPath(activeCenterNode.path, tab.path))
    ) {
    const saved = await saveCurrentCenterNodeEditor();
    if (!saved) {
        state.activeTabPath = previousActiveTabPath;
        renderKediOpenTabs();
        return false;
    }
    }

    if (
        typeof saveCurrentMapLayout === 'function' &&
        typeof activeMapPath !== 'undefined' &&
        activeMapPath &&
        !kediSameTabPath(activeMapPath, tab.path)
    ) {
        const layoutSaved = await saveCurrentMapLayout();
        if (!layoutSaved) {
            state.activeTabPath = previousActiveTabPath;
            renderKediOpenTabs();
            return false;
        }
    }

    if (tab.type === 'map' && typeof openMapInWorkspace === 'function') {
        const opened = await openMapInWorkspace(tab.item);
        if (!opened) {
            state.activeTabPath = previousActiveTabPath;
            renderKediOpenTabs();
            return false;
        }
    }

    if (tab.type === 'node' && typeof openCenterNodeEditor === 'function') {
        const opened = await openCenterNodeEditor(tab.item);
        if (!opened) {
            state.activeTabPath = previousActiveTabPath;
            renderKediOpenTabs();
            return false;
        }
    }

    selectKediTreeFileByPath(tab.path);
    return true;
}

async function closeKediOpenTab(path, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const state = getKediOpenTabsState();

    const isActive =
        state.activeTabPath &&
        kediSameTabPath(state.activeTabPath, path);

    if (
        isActive &&
        typeof saveCurrentCenterNodeEditor === 'function' &&
        activeCenterNode
    ) {
        const saved = await saveCurrentCenterNodeEditor();
        if (!saved) return false;
    }

    if (
        isActive &&
        typeof saveCurrentMapLayout === 'function' &&
        typeof activeMapPath !== 'undefined' &&
        activeMapPath
    ) {
        const layoutSaved = await saveCurrentMapLayout();
        if (!layoutSaved) return false;
    }

    await removeKediOpenTabByPath(path);
    return true;
}

async function removeKediOpenTabByPath(path) {
    const state = getKediOpenTabsState();

    const index = state.openTabs.findIndex((tab) => {
        return kediSameTabPath(tab.path, path);
    });

    const wasActive =
        state.activeTabPath &&
        kediSameTabPath(state.activeTabPath, path);

    if (index === -1) {
        if (
            typeof activeMapPath !== 'undefined' &&
            activeMapPath &&
            kediSameTabPath(activeMapPath, path) &&
            typeof clearMapWorkspace === 'function'
        ) {
            clearMapWorkspace();
        }

        renderKediOpenTabs();
        return;
    }

    state.openTabs.splice(index, 1);

    if (!wasActive) {
        renderKediOpenTabs();
        return;
    }

    const nextTab = state.openTabs[index] || state.openTabs[index - 1] || null;

    if (nextTab) {
        await activateKediOpenTab(nextTab.path);
        return;
    }

    state.activeTabPath = null;
    
    if (typeof clearCenterNodeEditor === 'function') {
        clearCenterNodeEditor();
    }

    if (typeof clearMapWorkspace === 'function') {
        clearMapWorkspace();
    }

    renderKediOpenTabs();
}

function resetKediOpenTabs() {
    const state = getKediOpenTabsState();

    state.openTabs = [];
    state.activeTabPath = null;

    renderKediOpenTabs();
}

function updateKediOpenTabAfterRename(oldPath, result) {
    if (!oldPath || !result || !result.ok) return;

    const state = getKediOpenTabsState();

    const tab = state.openTabs.find((existingTab) => {
        return kediSameTabPath(existingTab.path, oldPath);
    });

    if (tab) {
        tab.path = result.fullPath;
        tab.title =
            result.metadata?.title ||
            String(result.fileName || '').replace(/\.(map|node)$/i, '');

        tab.item = {
            ...tab.item,
            name: result.fileName,
            fileName: result.fileName,
            fullPath: result.fullPath,
            displayName: result.metadata?.title || result.fileName,
            metadata: {
                ...(result.metadata || {})
            },
            sidecarPath: result.sidecarPath || tab.item?.sidecarPath
        };
    }

    if (state.activeTabPath && kediSameTabPath(state.activeTabPath, oldPath)) {
        state.activeTabPath = result.fullPath;
    }

    if (
        typeof activeMapPath !== 'undefined' &&
        activeMapPath &&
        kediSameTabPath(activeMapPath, oldPath)
    ) {
        activeMapPath = result.fullPath;
    }

    if (Array.isArray(result.pathChanges)) {
        applyKediPathChanges(result.pathChanges);
    }

    renderKediOpenTabs();
}

function replaceKediClientPathPrefix(targetPath, oldPrefix, newPrefix) {
    if (!targetPath || !oldPrefix || !newPrefix) return targetPath;

    const normalizedTarget = String(targetPath).replace(/[\\/]+/g, '/');
    const normalizedOld = String(oldPrefix).replace(/[\\/]+/g, '/').replace(/\/+$/g, '');
    const normalizedNew = String(newPrefix).replace(/[\\/]+/g, '/').replace(/\/+$/g, '');
    const caseInsensitive = window.kediEnvironment?.platform === 'win32';
    const comparableTarget = caseInsensitive
        ? normalizedTarget.toLowerCase()
        : normalizedTarget;
    const comparableOld = caseInsensitive
        ? normalizedOld.toLowerCase()
        : normalizedOld;

    if (
        comparableTarget !== comparableOld &&
        !comparableTarget.startsWith(`${comparableOld}/`)
    ) {
        return targetPath;
    }

    return `${normalizedNew}${normalizedTarget.slice(normalizedOld.length)}`;
}

function applyKediPathChanges(pathChanges = []) {
    const changes = pathChanges
        .filter((change) => change?.oldPath && change?.newPath)
        .sort((a, b) => String(b.oldPath).length - String(a.oldPath).length);

    if (!changes.length) return;

    const replacePath = (targetPath) => {
        let nextPath = targetPath;
        for (const change of changes) {
            nextPath = replaceKediClientPathPrefix(
                nextPath,
                change.oldPath,
                change.newPath
            );
        }
        return nextPath;
    };
    const state = getKediOpenTabsState();

    state.openTabs.forEach((tab) => {
        tab.path = replacePath(tab.path);
        if (tab.item?.fullPath) {
            tab.item.fullPath = replacePath(tab.item.fullPath);
        }
        if (tab.item?.sidecarPath) {
            tab.item.sidecarPath = replacePath(tab.item.sidecarPath);
        }
    });

    if (state.activeTabPath) {
        state.activeTabPath = replacePath(state.activeTabPath);
    }

    if (typeof activeMapPath !== 'undefined' && activeMapPath) {
        activeMapPath = replacePath(activeMapPath);
    }

    if (Array.isArray(activeMapNodes)) {
        activeMapNodes.forEach((node) => {
            node.fullPath = replacePath(node.fullPath);
        });
    }

    document.querySelectorAll('.map-node-box[data-node-path]').forEach((box) => {
        box.dataset.nodePath = replacePath(box.dataset.nodePath);
    });

    if (activeCenterNode?.path) {
        activeCenterNode.path = replacePath(activeCenterNode.path);
        if (activeCenterNode.item?.fullPath) {
            activeCenterNode.item.fullPath = replacePath(
                activeCenterNode.item.fullPath
            );
        }
        if (activeCenterNode.item?.sidecarPath) {
            activeCenterNode.item.sidecarPath = replacePath(
                activeCenterNode.item.sidecarPath
            );
        }
    }

    if (activeModalNode?.path) {
        activeModalNode.path = replacePath(activeModalNode.path);
        if (activeModalNode.box?.dataset.nodePath) {
            activeModalNode.box.dataset.nodePath = replacePath(
                activeModalNode.box.dataset.nodePath
            );
        }
    }

    renderKediOpenTabs();
}

function isKediPathAtOrBelow(targetPath, prefixPath) {
    return replaceKediClientPathPrefix(
        targetPath,
        prefixPath,
        '__KEDI_MATCH__'
    ) !== targetPath;
}

async function removeKediOpenTabsForDeletedPaths(paths = []) {
    const prefixes = paths.filter(Boolean);
    if (!prefixes.length) return;

    const isDeletedPath = (targetPath) => {
        return prefixes.some((prefix) => {
            return isKediPathAtOrBelow(targetPath, prefix);
        });
    };
    const state = getKediOpenTabsState();
    const activeWasDeleted = isDeletedPath(state.activeTabPath);

    state.openTabs = state.openTabs.filter((tab) => {
        return !isDeletedPath(tab.path);
    });

    if (activeCenterNode?.path && isDeletedPath(activeCenterNode.path)) {
        if (typeof clearCenterNodeEditor === 'function') {
            clearCenterNodeEditor();
        }
    }

    if (activeModalNode?.path && isDeletedPath(activeModalNode.path)) {
        if (typeof closeNodeModalWithoutSaving === 'function') {
            closeNodeModalWithoutSaving();
        }
    }

    if (
        typeof activeMapPath !== 'undefined' &&
        activeMapPath &&
        isDeletedPath(activeMapPath)
    ) {
        if (typeof clearMapWorkspace === 'function') {
            clearMapWorkspace();
        }
    }

    if (activeWasDeleted) {
        state.activeTabPath = null;
        const nextTab = state.openTabs[0] || null;
        if (nextTab) {
            await activateKediOpenTab(nextTab.path);
            return;
        }
    }

    renderKediOpenTabs();
}

function kediClientPathsOverlap(firstPath, secondPath) {
    if (!firstPath || !secondPath) return false;

    return (
        isKediPathAtOrBelow(firstPath, secondPath) ||
        isKediPathAtOrBelow(secondPath, firstPath)
    );
}

function getActiveMapTabItemForReload() {
    if (typeof activeMapPath === 'undefined' || !activeMapPath) {
        return null;
    }

    const state = getKediOpenTabsState();
    const tab = state.openTabs.find((item) => {
        return kediSameTabPath(item.path, activeMapPath);
    });
    const fileName = String(activeMapPath).split(/[\\/]/).pop() || 'Map.map';

    return {
        ...(tab?.item || {}),
        name: tab?.item?.name || fileName,
        fileName: tab?.item?.fileName || fileName,
        fullPath: activeMapPath,
        metadata: tab?.item?.metadata || null,
        sidecarPath: tab?.item?.sidecarPath || null,
        isFile: true,
        isDirectory: false,
        type: 'file'
    };
}

function isExternalChangeRelevantToActiveMap(changedPaths) {
    if (
        typeof activeMapPath === 'undefined' ||
        !activeMapPath ||
        !Array.isArray(changedPaths)
    ) {
        return false;
    }

    const mapItem = getActiveMapTabItemForReload();
    const relevantPaths = [
        activeMapPath,
        mapItem?.sidecarPath,
        ...(Array.isArray(activeMapNodes)
            ? activeMapNodes.map((node) => node?.fullPath)
            : [])
    ].filter(Boolean);

    return changedPaths.some((changedPath) => {
        return relevantPaths.some((relevantPath) => {
            return kediClientPathsOverlap(changedPath, relevantPath);
        });
    });
}

async function confirmKediExternalReload(message) {
    if (typeof kediConfirm === 'function') {
        return kediConfirm(message, {
            title: 'Dış değişiklik algılandı',
            confirmText: 'Diskten yeniden yükle',
            cancelText: 'Ekrandaki sürümü koru'
        });
    }

    return confirm(message);
}

async function reloadKediWorkspaceAfterExternalChange(changedPaths) {
    if (!Array.isArray(changedPaths) || !changedPaths.length) return;

    if (
        activeCenterNode?.path &&
        changedPaths.some((changedPath) => {
            return kediClientPathsOverlap(
                changedPath,
                activeCenterNode.path
            );
        })
    ) {
        if (activeCenterNode.dirty) {
            const reload = await confirmKediExternalReload(
                'Açık node hem KEDI içinde değiştirilmiş hem de diskten güncellenmiş. Diskteki sürüm yüklensin mi? Ekrandaki kaydedilmemiş değişiklikler korunmayacak.'
            );
            if (!reload) return;
        }

        const item = {
            ...(activeCenterNode.item || {}),
            fullPath: activeCenterNode.path
        };
        clearTimeout(centerNodeSaveTimer);
        centerNodeSaveTimer = null;
        activeCenterNode.dirty = false;
        await openCenterNodeEditor(item);
        return;
    }

    if (!isExternalChangeRelevantToActiveMap(changedPaths)) return;

    const mapItem = getActiveMapTabItemForReload();
    if (!mapItem || typeof openMapInWorkspace !== 'function') return;

    const modalPath = activeModalNode?.path || null;
    const modalWasAffected = modalPath && changedPaths.some((changedPath) => {
        return kediClientPathsOverlap(changedPath, modalPath);
    });
    const hasPendingMapSave = Boolean(mapSaveTimer || mapCameraSaveTimer);
    const hasUnsavedWork =
        hasPendingMapSave ||
        (modalWasAffected && activeModalNode?.dirty);

    if (hasUnsavedWork) {
        const reload = await confirmKediExternalReload(
            'Açık map veya node dışarıdan değiştirildi. Diskteki sürüm yüklensin mi? Henüz diske yazılmamış ekrandaki değişiklikler korunmayacak.'
        );
        if (!reload) return;
    }

    clearTimeout(mapSaveTimer);
    clearTimeout(mapCameraSaveTimer);
    mapSaveTimer = null;
    mapCameraSaveTimer = null;

    if (modalWasAffected && typeof closeNodeModalWithoutSaving === 'function') {
        closeNodeModalWithoutSaving();
    }

    const reloaded = await openMapInWorkspace(mapItem);

    if (reloaded && modalWasAffected && modalPath) {
        const escapedPath = CSS.escape(modalPath);
        const newBox = document.querySelector(
            `.map-node-box[data-node-path="${escapedPath}"]`
        );

        if (newBox && typeof openNodeModalFromBox === 'function') {
            await openNodeModalFromBox(newBox);
        }
    }
}

let kediFileSystemRefreshTail = Promise.resolve();

function handleKediExternalFileSystemChange(payload = {}) {
    const changedPaths = Array.isArray(payload?.changedPaths)
        ? payload.changedPaths.filter(Boolean)
        : [];

    kediFileSystemRefreshTail = kediFileSystemRefreshTail
        .catch(() => undefined)
        .then(async () => {
            await refreshCurrentProjectTree();
            await reloadKediWorkspaceAfterExternalChange(changedPaths);
        })
        .catch((error) => {
            console.error('[KEDI] Dış dosya değişikliği yenilenemedi:', error);
        });

    return kediFileSystemRefreshTail;
}


async function renameKediOpenTabTitle(tab, newTitle) {
    const cleanTitle = String(newTitle || '').trim();

    if (!tab?.path || !cleanTitle || cleanTitle === tab.title) {
        renderKediOpenTabs();
        return;
    }

    try {
        if (
            typeof saveCurrentCenterNodeEditor === 'function' &&
            activeCenterNode?.path &&
            kediSameTabPath(activeCenterNode.path, tab.path)
        ) {
            const centerSaved = await saveCurrentCenterNodeEditor();
            if (!centerSaved) {
                renderKediOpenTabs();
                return false;
            }
        }

        if (
            typeof saveCurrentMapLayout === 'function' &&
            typeof activeMapPath !== 'undefined' &&
            activeMapPath &&
            kediSameTabPath(activeMapPath, tab.path)
        ) {
            const layoutSaved = await saveCurrentMapLayout();
            if (!layoutSaved) {
                alert('Map yerleşimi kaydedilemedi; başlık değiştirilmedi.');
                renderKediOpenTabs();
                return false;
            }
        }

        suppressNextFileSystemRefresh(3000);

        const oldPath = tab.path;
        const result = await window.kediProject?.renameKediFile?.(oldPath, cleanTitle);

        if (!result || !result.ok) {
            alert(result?.error || 'Sekme başlığı değiştirilemedi.');
            renderKediOpenTabs();
            return false;
        }

        if (
            typeof updateTreeItemAfterRename === 'function'
        ) {
            updateTreeItemAfterRename(oldPath, result);
        }

        if (typeof updateOpenMapNodeAfterRename === 'function') {
            updateOpenMapNodeAfterRename(oldPath, result);
        }

        if (typeof updateKediOpenTabAfterRename === 'function') {
            updateKediOpenTabAfterRename(oldPath, result);
        }

        if (activeCenterNode?.path && kediSameTabPath(activeCenterNode.path, oldPath)) {
            activeCenterNode.path = result.fullPath;
            activeCenterNode.metadata = result.metadata || activeCenterNode.metadata || {};
            activeCenterNode.item = {
                ...(activeCenterNode.item || {}),
                name: result.fileName,
                fileName: result.fileName,
                fullPath: result.fullPath,
                displayName: result.metadata?.title || result.fileName,
                metadata: {
                    ...(result.metadata || {})
                },
                sidecarPath: result.sidecarPath || activeCenterNode.item?.sidecarPath
            };
        }

        if (typeof refreshActiveMapTreeBranch === 'function') {
            await refreshActiveMapTreeBranch();
        }

        selectKediTreeFileByPath(result.fullPath);
        return true;
    } catch (error) {
        console.error('[KEDI] Sekme başlığı değiştirme hatası:', error);
        alert('Sekme başlığı değiştirilirken hata oluştu: ' + error.message);
        renderKediOpenTabs();
        return false;
    }
}

function beginKediOpenTabTitleRename(tab, titleEl) {
    if (!tab || !titleEl || titleEl.dataset.renaming === '1') return;

    titleEl.dataset.renaming = '1';

    const input = document.createElement('input');
    input.className = 'center-tab-rename-input';
    input.type = 'text';
    input.value = tab.title || 'Untitled';

    titleEl.replaceWith(input);

    let finished = false;

    async function finish(commit) {
        if (finished) return;
        finished = true;

        const newTitle = input.value.trim();

        if (!commit || !newTitle || newTitle === tab.title) {
            renderKediOpenTabs();
            return;
        }

        await renameKediOpenTabTitle(tab, newTitle);
    }

    input.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });

    input.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });

    input.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            await finish(true);
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            await finish(false);
        }
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            finish(true);
        }, 0);
    });

    setTimeout(() => {
        input.focus();
        input.select();
    }, 0);
}

function selectKediTreeFileByPath(path) {
    if (
        typeof findTreeNodeByPath !== 'function' ||
        typeof selectTreeFile !== 'function'
    ) {
        return;
    }

    const treeNode = findTreeNodeByPath(path);

    if (!treeNode) return;

    const row = Array.from(treeNode.children).find((child) => {
        return child.classList?.contains('tree-row');
    });

    if (!row || !treeNode.__kediItem) return;

    selectTreeFile(treeNode.__kediItem, row);
}

function renderKediOpenTabs() {
    const tabsEl = document.getElementById('center-tabs');
    if (!tabsEl) return;

    const state = getKediOpenTabsState();

    tabsEl.innerHTML = '';

    if (!state.openTabs.length) {
        const empty = document.createElement('div');
        empty.className = 'center-tabs-empty';
        empty.textContent = 'Açık dosya yok';
        tabsEl.appendChild(empty);
        return;
    }

    for (const tab of state.openTabs) {
        const tabEl = document.createElement('div');
        tabEl.className = 'center-tab';
        tabEl.title = tab.path;

        if (state.activeTabPath && kediSameTabPath(state.activeTabPath, tab.path)) {
            tabEl.classList.add('active');
        }

        const icon = document.createElement('span');
        icon.className = 'center-tab-icon';
        icon.textContent = tab.type === 'map' ? '🗺️' : '📄';

        const title = document.createElement('span');
        title.className = 'center-tab-title';
        title.title = 'Yeniden adlandırmak için çift tıkla';
        title.textContent = tab.title || 'Untitled';

        title.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            beginKediOpenTabTitleRename(tab, title);
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'center-tab-close';
        closeBtn.type = 'button';
        closeBtn.title = 'Sekmeyi kapat';
        closeBtn.textContent = '×';

        tabEl.appendChild(icon);
        tabEl.appendChild(title);
        tabEl.appendChild(closeBtn);

        tabEl.addEventListener('click', async (event) => {
            if (event.target.closest('.center-tab-close')) return;

            await activateKediOpenTab(tab.path);
        });

        closeBtn.addEventListener('click', async (event) => {
            await closeKediOpenTab(tab.path, event);
        });

        tabsEl.appendChild(tabEl);
    }
}

async function setupProjectStartup() {



    const projectModal = document.getElementById('project-modal');
    const modalChooseBtn = document.getElementById('modal-choose-project-btn');
    const changeProjectBtn = document.getElementById('change-project-btn');

    const addMapBtn = document.getElementById('add-map-btn');
    const addNodeBtn = document.getElementById('add-node-btn');

    window.kediProject?.onFileSystemChanged?.((payload) => {
        handleKediExternalFileSystemChange(payload);
    });
   

    modalChooseBtn?.addEventListener('click', async () => {
        await chooseAndLoadProject();
    });

    changeProjectBtn?.addEventListener('click', async () => {
        await chooseAndLoadProject();
    });

    addMapBtn?.addEventListener('click', async () => {
    await createKediFileInCurrentProject('.map');
    });

    addNodeBtn?.addEventListener('click', async () => {
    await createKediFileInCurrentProject('.node');
    });

    const lastFolder = await window.kediProject?.getLastFolder?.();

    if (lastFolder) {
        await loadProject(lastFolder);
    } else {
        showProjectModal();
    }
}

async function createKediFileInCurrentProject(ext) {
    if (!window.currentProjectFolder) {
        showProjectModal();
        return;
    }

    suppressNextFileSystemRefresh(1500);

    const result = await window.kediProject?.createKediFile?.(
        window.currentProjectFolder,
        ext
    );

    if (!result || !result.ok) {
        alert(result?.error || 'Dosya oluşturulamadı.');
        return;
    }

    const rootNode = findTreeNodeByPath(window.currentProjectFolder);
    const rootChildren = rootNode?.querySelector('.tree-children');

    if (!rootNode || !rootChildren) {
        await renderFolderTree(window.currentProjectFolder);
        return;
    }

    rootNode.classList.add('expanded');
    expandedTreePaths.add(window.currentProjectFolder);

    const newItem = makeTreeItemFromCreateResult(result);

    await appendTreeItemToContainer(rootChildren, newItem, 1);
}

function refocusKediRenderer() {
    window.electronWindow?.focusRenderer?.();
    window.focus();

    if (!document.body.hasAttribute('tabindex')) {
        document.body.setAttribute('tabindex', '-1');
    }

    document.body.focus({ preventScroll: true });

    const selection = window.getSelection?.();

    if (selection?.removeAllRanges) {
        selection.removeAllRanges();
    }
}

function focusKediTextInput(input, shouldSelect = true) {
    if (!input) return;

    window.electronWindow?.focusRenderer?.();
    window.focus();

    requestAnimationFrame(() => {
        input.focus({ preventScroll: true });

        if (shouldSelect) {
            input.select?.();
        }
    });

    setTimeout(() => {
        input.focus({ preventScroll: true });

        if (shouldSelect) {
            input.select?.();
        }
    }, 60);
}

function escapeKediConfirmText(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function resetKediKeyboardAndPointerState() {
    try {
        window.getSelection?.()?.removeAllRanges?.();
    } catch (error) {}

    document.querySelectorAll('.map-node-box.dragging').forEach((el) => {
        el.classList.remove('dragging');
    });

    document.querySelectorAll('.map-port.connecting-source').forEach((el) => {
        el.classList.remove('connecting-source');
    });

    document.querySelectorAll('.map-selection-box').forEach((el) => {
        el.remove();
    });

    document.getElementById('map-canvas')?.classList.remove('panning');
    document.getElementById('map-temp-edge')?.remove();

    try {
        if (typeof currentConnectionDrag !== 'undefined') {
            currentConnectionDrag = null;
        }
    } catch (error) {}

    try {
        if (typeof currentMapBoxSelection !== 'undefined') {
            currentMapBoxSelection = null;
        }
    } catch (error) {}

    if (typeof resetKediMapConnectionInteractions === 'function') {
        resetKediMapConnectionInteractions();
    }

    if (!document.body.hasAttribute('tabindex')) {
        document.body.setAttribute('tabindex', '-1');
    }

    window.focus();
    document.body.focus({ preventScroll: true });
}

function kediConfirm(message, options = {}) {
    return new Promise((resolve) => {
        document.getElementById('kedi-confirm-overlay')?.remove();
        const previouslyFocused = document.activeElement;

        const overlay = document.createElement('div');
        overlay.id = 'kedi-confirm-overlay';

        const title = escapeKediConfirmText(options.title || 'Onay');
        const text = escapeKediConfirmText(message || '');
        const confirmText = escapeKediConfirmText(options.confirmText || 'Tamam');
        const cancelText = escapeKediConfirmText(options.cancelText || 'Vazgeç');

        overlay.innerHTML = `
            <div
                id="kedi-confirm-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="kedi-confirm-title"
                aria-describedby="kedi-confirm-message"
            >
                <div id="kedi-confirm-title">${title}</div>
                <div id="kedi-confirm-message">${text}</div>

                <div id="kedi-confirm-actions">
                    <button id="kedi-confirm-cancel" type="button">${cancelText}</button>
                    <button id="kedi-confirm-ok" type="button">${confirmText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const card = overlay.querySelector('#kedi-confirm-card');
        const cancelBtn = overlay.querySelector('#kedi-confirm-cancel');
        const okBtn = overlay.querySelector('#kedi-confirm-ok');

        if (options.danger) {
            okBtn?.classList.add('danger');
        }

        let closed = false;

        function close(value) {
            if (closed) return;
            closed = true;

            document.removeEventListener('keydown', onKeyDown, true);
            overlay.remove();

            resetKediKeyboardAndPointerState();
            if (
                previouslyFocused &&
                previouslyFocused.isConnected &&
                typeof previouslyFocused.focus === 'function'
            ) {
                previouslyFocused.focus({ preventScroll: true });
            }

            resolve(value);
        }

        function onKeyDown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(false);
                return;
            }

            if (event.key === 'Enter' && event.target === okBtn) {
                event.preventDefault();
                event.stopPropagation();
                close(true);
                return;
            }

            if (event.key === 'Enter' && event.target === cancelBtn) {
                event.preventDefault();
                event.stopPropagation();
                close(false);
                return;
            }

            if (event.key === 'Tab') {
                const focusable = [cancelBtn, okBtn].filter(Boolean);
                if (!focusable.length) return;

                const currentIndex = focusable.indexOf(document.activeElement);
                const nextIndex = event.shiftKey
                    ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
                    : (currentIndex + 1) % focusable.length;

                event.preventDefault();
                focusable[nextIndex].focus();
            }
        }

        overlay.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (event.target === overlay) {
                close(false);
            }
        });

        card?.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });

        cancelBtn?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            close(false);
        });

        okBtn?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            close(true);
        });

        document.addEventListener('keydown', onKeyDown, true);

        setTimeout(() => {
            cancelBtn?.focus({ preventScroll: true });
        }, 0);
    });
}

const KEDI_CUSTOMIZATION_STORAGE_KEY = 'kedi.customization.v1';

const KEDI_DEFAULT_CUSTOMIZATION = {
    mapDownHubColor: '#f39c12',
    mapCoLevelColor: '#34ace0',
    mapStreamColor: '#2ecc71',
    mapNodeBoxColor: '#252526',
    mapNodeTitleColor: '#f39c12',

    mapNodeTitleSize: 13,
    mapNodeTextSize: 12,

    nodeHeaderColor: '#f39c12'
};

const KEDI_CUSTOMIZATION_CSS_VARIABLES = {
    mapDownHubColor: '--kedi-map-downhub-color',
    mapCoLevelColor: '--kedi-map-colevel-color',
    mapStreamColor: '--kedi-map-stream-color',
    mapNodeBoxColor: '--kedi-map-node-box-color',
    mapNodeTitleColor: '--kedi-map-node-title-color',

    mapNodeTitleSize: '--kedi-map-node-title-size',
    mapNodeTextSize: '--kedi-map-node-text-size',

    nodeHeaderColor: '--kedi-node-header-color'
};

function loadKediCustomizationSettings() {
    try {
        const raw = localStorage.getItem(KEDI_CUSTOMIZATION_STORAGE_KEY);

        if (!raw) {
            return { ...KEDI_DEFAULT_CUSTOMIZATION };
        }

const parsed = JSON.parse(raw) || {};

if (parsed.mapConnectionColor && !parsed.mapDownHubColor) {
    parsed.mapDownHubColor = parsed.mapConnectionColor;
}

delete parsed.mapConnectionColor;

return {
    ...KEDI_DEFAULT_CUSTOMIZATION,
    ...parsed
};
    } catch (error) {
        console.warn('[KEDI] Customize ayarları okunamadı:', error);
        return { ...KEDI_DEFAULT_CUSTOMIZATION };
    }
}

function saveKediCustomizationSettings(settings) {
    try {
        localStorage.setItem(
            KEDI_CUSTOMIZATION_STORAGE_KEY,
            JSON.stringify(settings)
        );
    } catch (error) {
        console.warn('[KEDI] Customize ayarları kaydedilemedi:', error);
    }
}

function isValidKediHexColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || ''));
}

function normalizeKediSizeValue(value, fallback, min = 8, max = 32) {
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function applyKediCustomizationSettings(settings) {
    const root = document.documentElement;

    for (const [key, cssVariable] of Object.entries(KEDI_CUSTOMIZATION_CSS_VARIABLES)) {
        const fallback = KEDI_DEFAULT_CUSTOMIZATION[key];

        if (key === 'mapNodeTitleSize' || key === 'mapNodeTextSize') {
            const value = normalizeKediSizeValue(settings?.[key], fallback, 8, 32);
            root.style.setProperty(cssVariable, `${value}px`);
            continue;
        }

        const value = isValidKediHexColor(settings?.[key])
            ? settings[key]
            : fallback;

        root.style.setProperty(cssVariable, value);
    }
}

function syncKediCustomizationInputs(settings) {
    document.querySelectorAll('[data-kedi-custom-color]').forEach((input) => {
        const key = input.dataset.kediCustomColor;
        const value = settings[key] || KEDI_DEFAULT_CUSTOMIZATION[key];

        if (isValidKediHexColor(value)) {
            input.value = value;
        }
    });

    document.querySelectorAll('[data-kedi-custom-size]').forEach((input) => {
        const key = input.dataset.kediCustomSize;
        const fallback = KEDI_DEFAULT_CUSTOMIZATION[key];

        input.value = normalizeKediSizeValue(settings?.[key], fallback, 8, 32);
    });
}


function setupKediCustomizations() {
    const panel = document.getElementById('kedi-customize-panel');

    if (!panel) return;

    let settings = loadKediCustomizationSettings();

    applyKediCustomizationSettings(settings);
    syncKediCustomizationInputs(settings);

    panel.querySelectorAll('[data-kedi-custom-color]').forEach((input) => {
    if (input.dataset.bound === '1') return;
    input.dataset.bound = '1';

    input.addEventListener('input', () => {
        const key = input.dataset.kediCustomColor;
        const value = input.value;

        if (!KEDI_DEFAULT_CUSTOMIZATION[key]) return;
        if (!isValidKediHexColor(value)) return;

        settings = {
            ...settings,
            [key]: value
        };

        applyKediCustomizationSettings(settings);
        saveKediCustomizationSettings(settings);
    });
});

    panel.querySelectorAll('[data-kedi-custom-size]').forEach((input) => {
    if (input.dataset.bound === '1') return;
    input.dataset.bound = '1';

    input.addEventListener('input', () => {
        const key = input.dataset.kediCustomSize;

        if (!Object.prototype.hasOwnProperty.call(KEDI_DEFAULT_CUSTOMIZATION, key)) return;

        const fallback = KEDI_DEFAULT_CUSTOMIZATION[key];
        const value = normalizeKediSizeValue(input.value, fallback, 8, 32);

        settings = {
            ...settings,
            [key]: value
        };

        input.value = value;

        applyKediCustomizationSettings(settings);
        saveKediCustomizationSettings(settings);
    });
    });

    const resetBtn = document.getElementById('kedi-customize-reset');

    if (resetBtn && resetBtn.dataset.bound !== '1') {
        resetBtn.dataset.bound = '1';

        resetBtn.addEventListener('click', () => {
            settings = { ...KEDI_DEFAULT_CUSTOMIZATION };

            saveKediCustomizationSettings(settings);
            applyKediCustomizationSettings(settings);
            syncKediCustomizationInputs(settings);
        });
    }
}
