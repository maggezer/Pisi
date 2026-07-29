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

        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
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

function hydrateKediPaintCanvases(root = document) {
    root.querySelectorAll('canvas[data-kedi-canvas]').forEach((canvas) => {
        if (canvas.dataset.kediCanvasBound !== '1') {
            bindKediCanvas(canvas);
        }

        if (canvas.dataset.image && canvas.dataset.imageLoaded !== canvas.dataset.image) {
            const image = new Image();
            image.onload = () => {
                const context = canvas.getContext('2d');
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                canvas.dataset.imageLoaded = canvas.dataset.image;
            };
            image.src = canvas.dataset.image;
        }
    });
}

function bindKediCanvas(canvas) {
    canvas.dataset.kediCanvasBound = '1';
    let drawing = false;
    let start = null;
    let snapshot = null;

    canvas.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();

        selectKediCanvas(canvas);
        const context = canvas.getContext('2d');
        drawing = true;
        start = getKediCanvasPoint(canvas, event);
        snapshot = context.getImageData(0, 0, canvas.width, canvas.height);

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
            context.globalCompositeOperation = state.tool === 'eraser' ? 'destination-out' : 'source-over';
            context.lineTo(point.x, point.y);
            context.stroke();
            context.globalCompositeOperation = 'source-over';
            return;
        }

        context.putImageData(snapshot, 0, 0);
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
    try {
        canvas.dataset.image = canvas.toDataURL('image/png');
        canvas.dataset.imageLoaded = canvas.dataset.image;
    } catch (error) {
        console.warn('[KEDI] Tuval görüntüsü kaydedilemedi:', error);
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

function hydrateKediSheets(root = document) {
    root.querySelectorAll('table[data-kedi-sheet]').forEach((table) => {
        refreshKediSheetCellMetadata(table);

        if (table.dataset.kediSheetBound === '1') return;
        table.dataset.kediSheetBound = '1';

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

    if (value.startsWith('=')) {
        cell.dataset.formula = value;
    } else if (!cell.dataset.formula) {
        cell.textContent = value;
    }
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

    expression = expression.replace(/\b(SUM|AVG|MIN|MAX|COUNT)\(([A-Z]+\d+)(?::([A-Z]+\d+))?\)/gi, (_, fn, startRef, endRef) => {
        const values = getKediSheetRangeValues(table, startRef, endRef || startRef, stack);
        if (!values.length) return '0';
        const upper = fn.toUpperCase();
        if (upper === 'SUM') return String(values.reduce((a, b) => a + b, 0));
        if (upper === 'AVG') return String(values.reduce((a, b) => a + b, 0) / values.length);
        if (upper === 'MIN') return String(Math.min(...values));
        if (upper === 'MAX') return String(Math.max(...values));
        if (upper === 'COUNT') return String(values.length);
        return '0';
    });

    expression = expression.replace(/\b([A-Z]+\d+)\b/g, (_, ref) => {
        return String(getKediSheetCellNumericValue(table, ref.toUpperCase(), stack));
    });

    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
        return NaN;
    }

    try {
        // The expression is reduced to numbers and arithmetic operators only.
        return Function(`"use strict"; return (${expression});`)();
    } catch (error) {
        return NaN;
    }
}

function getKediSheetCellNumericValue(table, ref, stack = new Set()) {
    const cell = table.querySelector(`td[data-cell="${ref}"]`);
    if (!cell) return 0;

    if (cell.dataset.formula) {
        if (stack.has(ref)) return NaN;
        const nextStack = new Set(stack);
        nextStack.add(ref);
        return evaluateKediSheetFormula(table, cell.dataset.formula, nextStack);
    }

    const numeric = Number(String(cell.textContent || '').replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : 0;
}

function getKediSheetRangeValues(table, startRef, endRef, stack = new Set()) {
    const start = parseKediCellRef(startRef);
    const end = parseKediCellRef(endRef);
    if (!start || !end) return [];

    const values = [];
    const rowMin = Math.min(start.row, end.row);
    const rowMax = Math.max(start.row, end.row);
    const colMin = Math.min(start.col, end.col);
    const colMax = Math.max(start.col, end.col);

    for (let row = rowMin; row <= rowMax; row += 1) {
        for (let col = colMin; col <= colMax; col += 1) {
            values.push(getKediSheetCellNumericValue(table, `${kediColumnName(col)}${row + 1}`, stack));
        }
    }

    return values.filter((value) => Number.isFinite(value));
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
    const colCount = Math.max(1, table.querySelector('tbody tr')?.querySelectorAll('td').length || 1);
    const row = document.createElement('tr');
    row.innerHTML = '<th></th>' + Array.from({ length: colCount }, () => '<td contenteditable="true"></td>').join('');
    tbody.appendChild(row);
    refreshKediSheetCellMetadata(table);
}

function addKediSheetColumn(table) {
    const tbody = table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));

    if (!tbody.querySelector('tr')) {
        addKediSheetRow(table);
        return;
    }

    tbody.querySelectorAll('tr').forEach((row) => {
        const cell = document.createElement('td');
        cell.setAttribute('contenteditable', 'true');
        row.appendChild(cell);
    });

    refreshKediSheetCellMetadata(table);
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
}

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

    if (!tab) return;

    await activateKediOpenTab(tab.path);
}

async function activateKediOpenTab(path) {
    const state = getKediOpenTabsState();

    const tab = state.openTabs.find((existingTab) => {
        return kediSameTabPath(existingTab.path, path);
    });

    if (!tab) return;

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
        return;
    }

    if (
    typeof saveCurrentCenterNodeEditor === 'function' &&
    activeCenterNode &&
    (!activeCenterNode.path || !kediSameTabPath(activeCenterNode.path, tab.path))
    ) {
    await saveCurrentCenterNodeEditor();
    }

    if (
        typeof saveCurrentMapLayout === 'function' &&
        typeof activeMapPath !== 'undefined' &&
        activeMapPath &&
        !kediSameTabPath(activeMapPath, tab.path)
    ) {
        await saveCurrentMapLayout();
    }

    if (tab.type === 'map' && typeof openMapInWorkspace === 'function') {
        await openMapInWorkspace(tab.item);
    }

    if (tab.type === 'node' && typeof openCenterNodeEditor === 'function') {
    await openCenterNodeEditor(tab.item);
    }

    selectKediTreeFileByPath(tab.path);
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
        await saveCurrentCenterNodeEditor();
    }

    if (
        isActive &&
        typeof saveCurrentMapLayout === 'function' &&
        typeof activeMapPath !== 'undefined' &&
        activeMapPath
    ) {
        await saveCurrentMapLayout();
    }

    await removeKediOpenTabByPath(path);
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

    if (!tab) return;

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

    renderKediOpenTabs();
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
            await saveCurrentCenterNodeEditor();
        }

        if (
            typeof saveCurrentMapLayout === 'function' &&
            typeof activeMapPath !== 'undefined' &&
            activeMapPath &&
            kediSameTabPath(activeMapPath, tab.path)
        ) {
            await saveCurrentMapLayout();
        }

        suppressNextFileSystemRefresh(3000);

        const oldPath = tab.path;
        const result = await window.kediProject?.renameKediFile?.(oldPath, cleanTitle);

        if (!result || !result.ok) {
            alert(result?.error || 'Sekme başlığı değiştirilemedi.');
            renderKediOpenTabs();
            return;
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
    } catch (error) {
        console.error('[KEDI] Sekme başlığı değiştirme hatası:', error);
        alert('Sekme başlığı değiştirilirken hata oluştu: ' + error.message);
        renderKediOpenTabs();
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

window.kediProject?.onFileSystemChanged?.(() => {
    if (shouldSuppressFileSystemRefresh()) {
        return;
    }

    // Aktif map açıkken connection/node metadata yazımları fs.watch tetikliyor.
    // Bu sırada full refresh yapmak sol paneli bozukmuş gibi zıplatıyor.
    if (activeMapPath) {
        return;
    }

    refreshCurrentProjectTree();
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

    if (!document.body.hasAttribute('tabindex')) {
        document.body.setAttribute('tabindex', '-1');
    }

    window.focus();
    document.body.focus({ preventScroll: true });
}

function kediConfirm(message, options = {}) {
    return new Promise((resolve) => {
        document.getElementById('kedi-confirm-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'kedi-confirm-overlay';

        const title = escapeKediConfirmText(options.title || 'Onay');
        const text = escapeKediConfirmText(message || '');
        const confirmText = escapeKediConfirmText(options.confirmText || 'Tamam');
        const cancelText = escapeKediConfirmText(options.cancelText || 'Vazgeç');

        overlay.innerHTML = `
            <div id="kedi-confirm-card">
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

            resolve(value);
        }

        function onKeyDown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(false);
                return;
            }

            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
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