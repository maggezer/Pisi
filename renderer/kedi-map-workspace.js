function getBaseName(folderPath) {
    if (!folderPath) return '';

    const normalized = folderPath.replace(/[\\/]+$/g, '');
    const parts = normalized.split(/[\\/]/);

    return parts[parts.length - 1] || folderPath;
}

function isMapFileName(fileName = '') {
    return fileName.toLowerCase().endsWith('.map');
}

function isNodeFileName(fileName = '') {
    return fileName.toLowerCase().endsWith('.node');
}

function getFileIcon(fileName = '') {
    const lower = fileName.toLowerCase();

    if (lower.endsWith('.node')) return '📄';
    if (lower.endsWith('.map')) return '🗺️';

    return '📦';
}


async function openMapInWorkspace(mapItem) {
    if (!mapItem || !isMapFileName(mapItem.name)) return;

    if (typeof saveCurrentCenterNodeEditor === 'function' && activeCenterNode) {
        await saveCurrentCenterNodeEditor();
    }

    if (typeof clearCenterNodeEditor === 'function') {
        clearCenterNodeEditor();
    }

    if (typeof ensureKediOpenTab === 'function') {
        ensureKediOpenTab(mapItem);
    }

    if (window.Kedi?.state) {
        window.Kedi.state.activeTabPath = mapItem.fullPath;
    }

    if (typeof renderKediOpenTabs === 'function') {
        renderKediOpenTabs();
    }

    activeMapPath = mapItem.fullPath;

    const placeholder = document.getElementById('workspace-placeholder');
    const canvas = document.getElementById('map-canvas');
    const board = document.getElementById('map-board');

    if (!canvas || !board) return;

    if (placeholder) placeholder.style.display = 'none';
    canvas.style.display = 'block';
    board.innerHTML = '';

    const result = await window.kediProject?.listMapNodes?.(activeMapPath);

    if (!result || !result.ok) {
        alert(result?.error || 'Map yüklenemedi.');
        return;
    }

    activeMapCamera =
    result.map?.data?.map?.camera ||
    { x: 0, y: 0, zoom: 1 };

    applyMapCamera();
    setupMapCanvasPan();
    bindMapZoomEvents();
    bindMapZoomControls();
    bindMapCreationEvents();

    activeMapNodes = result.nodes || [];
    activeMapEdges = result.edges || [];

    for (const node of activeMapNodes) {
    const box = createMapNodeBox(node);
    board.appendChild(box);
    }

    drawMapConnections();

    refreshKediTagsPanelSoon();
  
}

function clearMapWorkspace() {
    const placeholder = document.getElementById('workspace-placeholder');
    const canvas = document.getElementById('map-canvas');
    const board = document.getElementById('map-board');

    activeMapPath = null;
    activeMapNodes = [];
    activeMapEdges = [];
    activeMapCamera = { x: 0, y: 0, zoom: 1 };

    if (board) {
        board.innerHTML = '';
    }

    drawMapConnections();

    if (canvas) {
        canvas.style.display = 'none';
    }

    if (placeholder) {
        placeholder.style.display = 'flex';
    }

    refreshKediTagsPanelSoon();
}

function getMapWorldPointFromClient(clientX, clientY) {
    const canvas = document.getElementById('map-canvas');
    const rect = canvas?.getBoundingClientRect();

    if (!rect) {
        return { x: 80, y: 80 };
    }

    const zoom = activeMapCamera?.zoom || 1;

    return {
        x: (clientX - rect.left - (activeMapCamera?.x || 0)) / zoom,
        y: (clientY - rect.top - (activeMapCamera?.y || 0)) / zoom
    };
}

function isMapBlankEventTarget(event) {
    return !(
        event.target.closest?.('.map-node-box') ||
        event.target.closest?.('.map-edge-group') ||
        event.target.closest?.('.map-edge-hit') ||
        event.target.closest?.('.map-edge-delete') ||
        event.target.closest?.('#map-zoom-controls') ||
        event.target.closest?.('.kedi-map-context-menu')
    );
}

async function createMapNodeBoxAtClientPoint(clientX, clientY) {
    if (!activeMapPath) return;

    const worldPoint = getMapWorldPointFromClient(clientX, clientY);

    suppressNextFileSystemRefresh(3000);

    const result = await window.kediProject?.createNodeUnderMap?.(activeMapPath);

    if (!result || !result.ok) {
        alert(result?.error || 'Node box oluşturulamadı.');
        return;
    }

    const node = result.node;

    if (!node) {
        alert('Node oluşturuldu ama map içine eklenemedi. Map’i yeniden açmayı dene.');
        return;
    }

    node.layout = {
        x: Math.round(worldPoint.x - 110),
        y: Math.round(worldPoint.y - 46),
        width: Number(node.layout?.width || 220),
        height: Number(node.layout?.height || 92)
    };

    activeMapNodes = [
        ...activeMapNodes.filter((item) => item.id !== node.id),
        node
    ];

    appendMapNodeBox(node);
    await saveCurrentMapLayout();

    if (typeof refreshActiveMapTreeBranch === 'function') {
        await refreshActiveMapTreeBranch();
    }

    refreshKediTagsPanelSoon();
}

function hideKediMapContextMenu() {
    document.getElementById('kedi-map-context-menu')?.remove();
}

function showKediMapContextMenu(clientX, clientY) {
    hideKediMapContextMenu();

    const menu = document.createElement('div');
    menu.id = 'kedi-map-context-menu';
    menu.className = 'kedi-map-context-menu';
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'kedi-map-context-menu-item';
    createBtn.textContent = '📄 Node box oluştur';

    createBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        hideKediMapContextMenu();
        await createMapNodeBoxAtClientPoint(clientX, clientY);
    });

    menu.appendChild(createBtn);
    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);

    menu.style.left = `${Math.min(clientX, maxLeft)}px`;
    menu.style.top = `${Math.min(clientY, maxTop)}px`;
}

function bindMapCreationEvents() {
    const canvas = document.getElementById('map-canvas');

    if (!canvas || canvas.dataset.creationBound === '1') return;

    canvas.dataset.creationBound = '1';

    canvas.addEventListener('dblclick', async (event) => {
        if (!activeMapPath || !isMapBlankEventTarget(event)) return;

        event.preventDefault();
        event.stopPropagation();

        hideKediMapContextMenu();
        await createMapNodeBoxAtClientPoint(event.clientX, event.clientY);
    });

    canvas.addEventListener('contextmenu', (event) => {
        if (canvas.dataset.skipNextContextMenu === '1') {
            canvas.dataset.skipNextContextMenu = '0';
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (!activeMapPath || !isMapBlankEventTarget(event)) return;

        event.preventDefault();
        event.stopPropagation();

        showKediMapContextMenu(event.clientX, event.clientY);
    });

    document.addEventListener('mousedown', (event) => {
        if (!event.target.closest?.('.kedi-map-context-menu')) {
            hideKediMapContextMenu();
        }
    });

    window.addEventListener('blur', hideKediMapContextMenu);
}

function createMapNodeBox(node) {
    const box = document.createElement('div');
    box.className = 'map-node-box';
    box.dataset.nodeId = node.id;
    box.dataset.nodePath = node.fullPath;

    box.style.left = `${node.layout.x}px`;
    box.style.top = `${node.layout.y}px`;
    box.style.width = `${node.layout.width}px`;
    box.style.height = `${node.layout.height}px`;

    const title = node.metadata?.title || node.fileName.replace(/\.node$/i, '');
    const preview = node.preview || '';

    box.innerHTML = `
        <button class="map-node-btn map-node-delete" title="Node sil">×</button>
        <button class="map-node-btn map-node-open" title="Node düzenle">↗</button>

        <div class="map-port top" data-port="top"></div>
        <div class="map-port right" data-port="right"></div>
        <div class="map-port bottom" data-port="bottom"></div>
        <div class="map-port left" data-port="left"></div>

        <div class="map-node-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
        <div class="map-node-preview">${escapeHtml(preview)}</div>

        <div class="map-node-resize"></div>
    `;

    bindMapNodeBoxEvents(box, node);

    return box;
}

function bindMapNodeBoxEvents(box, node) {
    const titleEl = box.querySelector('.map-node-title');
    const previewEl = box.querySelector('.map-node-preview');
    const openBtn = box.querySelector('.map-node-open');
    const deleteBtn = box.querySelector('.map-node-delete');
    const resizeHandle = box.querySelector('.map-node-resize');

    box.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;

    if (
        event.target.closest('.map-node-btn') ||
        event.target.closest('.map-node-resize') ||
        event.target.closest('.map-port') ||
        event.target.closest('.map-node-title-input') ||
        event.target.closest('.map-node-title[contenteditable="true"]')
    ) {
        return;
    }

    // Seçili grubun içindeysek seçimi bozma.
    // Böylece seçili node'lardan birini sol tıkla sürükleyince grup birlikte taşınır.
    if (!box.classList.contains('selected')) {
        clearSelectedMapNodes();
        box.classList.add('selected');
    }
    });

    bindMapNodeDrag(box);
    bindMapNodeResize(box, resizeHandle);

    bindMapPortEvents(box);

    titleEl?.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();

        startMapNodeTitleEdit(box, node);
    });

    previewEl?.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();

        openNodeModalFromBox(box);
    });

    openBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        openNodeModalFromBox(box);
    });

    deleteBtn?.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        resetKediKeyboardAndPointerState();

        const ok = await kediConfirm('Bu node dosyası silinsin mi?', {
        title: 'Node sil',
        confirmText: 'Sil',
        cancelText: 'Vazgeç',
        danger: true
        });

        resetKediKeyboardAndPointerState();

    if (!ok) return;

    suppressNextFileSystemRefresh(3000);

        const result = await window.kediProject?.deleteNodeFromMap?.(node.fullPath);

        if (!result || !result.ok) {
            alert(result?.error || 'Node silinemedi.');
            return;
        }

        box.remove();

        activeMapEdges = Array.isArray(result.edges)
        ? result.edges
        : activeMapEdges.filter((edge) => {
            return edge.sourceId !== node.id && edge.targetId !== node.id;
        });

        drawMapConnections();

        activeMapNodes = activeMapNodes.filter((item) => item.id !== node.id);

        await saveCurrentMapLayout();

        if (typeof refreshActiveMapTreeBranch === 'function') {
    
        await refreshActiveMapTreeBranch();
        }

        refreshKediTagsPanelSoon();

        resetKediKeyboardAndPointerState();

        refocusKediRenderer();

        setTimeout(() => {
        refocusKediRenderer();
        }, 80);

    });
}

function bindMapNodeDrag(box) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let dragZoom = 1;
    let draggedBoxes = [];

    box.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;

        if (
            event.target.closest('.map-node-btn') ||
            event.target.closest('.map-node-resize') ||
            event.target.closest('.map-port') ||
            event.target.closest('.map-node-title-input') ||
            event.target.closest('.map-node-title[contenteditable="true"]')
        ) {
            return;
        }

        if (!box.classList.contains('selected')) {
            clearSelectedMapNodes();
            box.classList.add('selected');
        }

        dragging = true;

        startX = event.clientX;
        startY = event.clientY;
        dragZoom = activeMapCamera?.zoom || 1;

        draggedBoxes = getSelectedMapNodeBoxes().map((selectedBox) => {
            selectedBox.classList.add('dragging');

            return {
                box: selectedBox,
                x: parseFloat(selectedBox.style.left || '0'),
                y: parseFloat(selectedBox.style.top || '0')
            };
        });

        event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
        if (!dragging) return;

        const dx = (event.clientX - startX) / dragZoom;
        const dy = (event.clientY - startY) / dragZoom;

        for (const item of draggedBoxes) {
            item.box.style.left = `${item.x + dx}px`;
            item.box.style.top = `${item.y + dy}px`;
        }

        drawMapConnections();
    });

    window.addEventListener('mouseup', () => {
        if (!dragging) return;

        dragging = false;

        for (const item of draggedBoxes) {
            item.box.classList.remove('dragging');
        }

        draggedBoxes = [];

        scheduleMapLayoutSave();
    });
}

function bindMapNodeResize(box, handle) {
    if (!handle) return;

    let resizing = false;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    handle.addEventListener('mousedown', (event) => {
        resizing = true;
        startX = event.clientX;
        startY = event.clientY;
        startW = box.offsetWidth;
        startH = box.offsetHeight;

        event.preventDefault();
        event.stopPropagation();
    });

    window.addEventListener('mousemove', (event) => {
        if (!resizing) return;

        const dx = event.clientX - startX;
        const dy = event.clientY - startY;

        const newW = Math.max(150, startW + dx);
        const newH = Math.max(74, startH + dy);

        box.style.width = `${newW}px`;
        box.style.height = `${newH}px`;

        drawMapConnections();
    });

    window.addEventListener('mouseup', () => {
        if (!resizing) return;

        resizing = false;
        scheduleMapLayoutSave();
    });
}

function collectMapLayout() {
    return Array.from(document.querySelectorAll('.map-node-box')).map((box) => ({
        id: box.dataset.nodeId,
        x: parseFloat(box.style.left || '0'),
        y: parseFloat(box.style.top || '0'),
        width: box.offsetWidth,
        height: box.offsetHeight
    }));
}

function scheduleMapLayoutSave() {
    clearTimeout(mapSaveTimer);

    mapSaveTimer = setTimeout(() => {
        saveCurrentMapLayout();
    }, 350);
}

async function saveCurrentMapLayout() {
    if (!activeMapPath) return;

    const layout = collectMapLayout();

    await window.kediProject?.saveMapLayout?.(activeMapPath, layout);
}

async function startMapNodeTitleEdit(box, node) {
    const titleEl = box.querySelector('.map-node-title');

    if (!titleEl) return;
    if (box.dataset.renaming === '1') return;

    box.dataset.renaming = '1';

    const oldTitle = titleEl.textContent.trim();
    const oldPath = node.fullPath;

    const input = document.createElement('input');
    input.className = 'map-node-title-input';
    input.value = oldTitle;

    titleEl.textContent = '';
    titleEl.appendChild(input);
    
    input.addEventListener('mousedown', (event) => {
    event.stopPropagation();
    });

    input.addEventListener('click', (event) => {
    event.stopPropagation();
    });

    input.addEventListener('dblclick', (event) => {
    event.stopPropagation();
    });

    input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    });

    input.addEventListener('keyup', (event) => {
    event.stopPropagation();
    });

    focusKediTextInput(input, true);

    let finished = false;

    function restoreTitle(title) {
        titleEl.textContent = title;
        titleEl.title = title;

        box.dataset.renaming = '0';
    }

    async function finish(commit) {
        if (finished) return;
        finished = true;

        try {
            const newTitle = input.value.trim();

            if (!commit || !newTitle || newTitle === oldTitle) {
                restoreTitle(oldTitle);
                return;
            }

            suppressNextFileSystemRefresh(3000);

            const result = await window.kediProject?.renameKediFile?.(
                oldPath,
                newTitle
            );

            if (!result || !result.ok) {
                alert(result?.error || 'Node adı değiştirilemedi.');

                // Kritik: hata alsak bile edit modundan temiz çık.
                restoreTitle(oldTitle);
                return;
            }

            node.fullPath = result.fullPath;
            node.fileName = result.fileName;
            node.metadata = result.metadata;

            box.dataset.nodePath = result.fullPath;

            const cleanTitle =
                result.metadata?.title ||
                result.fileName.replace(/\.node$/i, '');

            restoreTitle(cleanTitle);

            updateTreeItemAfterRename(oldPath, result);
            updateOpenMapNodeAfterRename(oldPath, result);

            if (typeof refreshActiveMapTreeBranch === 'function') {
            await refreshActiveMapTreeBranch();
            }

            if (typeof animateMapBox === 'function') {
                animateMapBox(box);
            }
        } catch (error) {
            console.error('[KEDI] Map node rename hatası:', error);
            alert('Node adı değiştirilemedi: ' + error.message);

            restoreTitle(oldTitle);
        } finally {
            box.dataset.renaming = '0';
        }
    }

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
}

function setKediEditorContent(editor, content = '') {
    if (!editor) return;

    const value = String(content || '');

    if (/<[a-z][\s\S]*>/i.test(value)) {
        editor.innerHTML = sanitizeKediEditorHtml(value);
        ensureKediEditorBlocks(editor);
        if (typeof initializeKediAdvancedEditorContent === 'function') {
            initializeKediAdvancedEditorContent(editor);
        }
        return;
    }

    editor.innerHTML = markdownTextToKediEditorHtml(value);
    ensureKediEditorBlocks(editor);
    if (typeof initializeKediAdvancedEditorContent === 'function') {
        initializeKediAdvancedEditorContent(editor);
    }
}

function getKediEditorContent(editor) {
    if (!editor) return '';

    ensureKediEditorBlocks(editor);

    if (typeof hydrateKediPaintCanvases === 'function') {
        hydrateKediPaintCanvases(editor);
    }

    editor.querySelectorAll?.('canvas[data-kedi-canvas]')?.forEach?.((canvas) => {
        if (typeof saveKediCanvasData === 'function') {
            saveKediCanvasData(canvas);
        }
    });

    if (typeof hydrateKediSheets === 'function') {
        hydrateKediSheets(editor);
    }

    return sanitizeKediEditorHtml(editor.innerHTML || '');
}

function markdownTextToKediEditorHtml(text = '') {
    const lines = String(text || '').split('\n');

    return lines.map((line) => {
        const headingMatch = line.match(/^\s*(#{2,5})\s+(.*)$/);

        if (headingMatch) {
            const level = headingMatch[1].length;
            const title = headingMatch[2] || '';

            return `<h${level}>${escapeHtml(title)}</h${level}>`;
        }

        if (!line.trim()) {
            return '<div><br></div>';
        }

        return `<div>${escapeHtml(line)}</div>`;
    }).join('');
}

function sanitizeKediEditorHtml(html = '') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = String(html || '');

    wrapper.querySelectorAll('script, style, iframe, object, embed, link').forEach((el) => {
        el.remove();
    });

    wrapper.querySelectorAll('*').forEach((el) => {
        Array.from(el.attributes).forEach((attr) => {
            const name = attr.name.toLowerCase();

            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
            }
        });
    });

    return wrapper.innerHTML;
}

async function openNodeModalFromBox(box) {
    const nodePath = box.dataset.nodePath;

    const result = await window.kediProject?.getKediDocument?.(nodePath);

    if (!result || !result.ok) {
        alert(result?.error || 'Node açılamadı.');
        return;
    }

    activeModalNode = {
        box,
        path: nodePath,
        metadata: result.metadata
    };

    const overlay = document.getElementById('node-modal-overlay');
    const titleInput = document.getElementById('node-modal-title');
    const contentInput = document.getElementById('node-modal-content');

    if (titleInput) {
        titleInput.value = result.metadata.title || '';
    }

    if (contentInput) {
    setKediEditorContent(contentInput, result.data.content || '');
    refreshKediTagsPanelSoon();
    }

    closeKediTagMenu();

    overlay?.classList.add('visible');
    contentInput?.focus();
}

async function closeNodeModalAndSave() {
    const overlay = document.getElementById('node-modal-overlay');
    const titleInput = document.getElementById('node-modal-title');
    const contentInput = document.getElementById('node-modal-content');

    if (!activeModalNode) {
        overlay?.classList.remove('visible');
        return;
    }

    try {
        let nodePath = activeModalNode.path;
        const oldPath = nodePath;
        const oldTitle = activeModalNode.metadata?.title || '';
        const title = titleInput?.value?.trim() || oldTitle;
        const content = getKediEditorContent(contentInput);

        if (title && title !== oldTitle) {
            suppressNextFileSystemRefresh(1500);

            const renameResult = await window.kediProject?.renameKediFile?.(
                nodePath,
                title
            );

            if (renameResult && renameResult.ok) {
                nodePath = renameResult.fullPath;
                activeModalNode.path = nodePath;
                activeModalNode.box.dataset.nodePath = nodePath;
                activeModalNode.metadata = renameResult.metadata;

                updateTreeItemAfterRename(oldPath, renameResult);
                updateOpenMapNodeAfterRename(oldPath, renameResult);

                if (typeof refreshActiveMapTreeBranch === 'function') {
                await refreshActiveMapTreeBranch();
                }

            } else {
                alert(renameResult?.error || 'Node başlığı değiştirilemedi.');

                // Rename başarısızsa modal kapanmasın; kullanıcı düzeltebilsin.
                titleInput?.focus();
                return;
            }
        }

        const saveResult = await window.kediProject?.saveNodeContent?.(
            nodePath,
            content
        );

        if (!saveResult || !saveResult.ok) {
            alert(saveResult?.error || 'Node kaydedilemedi.');
            return;
        }

        const titleEl = activeModalNode.box.querySelector('.map-node-title');
        const previewEl = activeModalNode.box.querySelector('.map-node-preview');

        if (titleEl) {
            titleEl.textContent = saveResult.metadata.title;
            titleEl.title = saveResult.metadata.title;
        }

        if (previewEl) {
            previewEl.textContent = saveResult.preview || '';
        }

        animateMapBox(activeModalNode.box);

        closeKediTagMenu();
        refreshKediTagsPanelSoon();

        overlay?.classList.remove('visible');
        activeModalNode = null;
    } catch (error) {
        console.error('[KEDI] Modal kaydetme/kapatma hatası:', error);
        alert('Modal kapatılırken hata oluştu: ' + error.message);
    }
}

function getCenterNodeEditorElements() {
    return {
        wrapper: document.getElementById('center-node-editor'),
        titleInput: document.getElementById('center-node-editor-title'),
        contentEditor: document.getElementById('center-node-editor-content'),
        saveBtn: document.getElementById('center-node-editor-save'),
        placeholder: document.getElementById('workspace-placeholder'),
        mapCanvas: document.getElementById('map-canvas')
    };
}

function bindCenterNodeEditorControls() {
    const { titleInput, contentEditor, saveBtn } = getCenterNodeEditorElements();

    if (saveBtn && saveBtn.dataset.bound !== '1') {
        saveBtn.dataset.bound = '1';

        saveBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            await saveCurrentCenterNodeEditor();
        });
    }

    if (titleInput && titleInput.dataset.bound !== '1') {
        titleInput.dataset.bound = '1';

        titleInput.addEventListener('keydown', async (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                await saveCurrentCenterNodeEditor();
            }

            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                await saveCurrentCenterNodeEditor();
            }
        });
    }

    if (contentEditor && contentEditor.dataset.centerNodeSaveBound !== '1') {
        contentEditor.dataset.centerNodeSaveBound = '1';

        contentEditor.addEventListener('input', () => {
            refreshKediTagsPanelSoon();
            scheduleCenterNodeEditorSave();
        });

        contentEditor.addEventListener('keydown', async (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                await saveCurrentCenterNodeEditor();
            }
        });
    }
}

function scheduleCenterNodeEditorSave() {
    clearTimeout(centerNodeSaveTimer);

    centerNodeSaveTimer = setTimeout(() => {
        saveCurrentCenterNodeEditor();
    }, 800);
}

async function openCenterNodeEditor(nodeItem) {
    if (!nodeItem?.fullPath) return;

    bindCenterNodeEditorControls();

    if (activeCenterNode?.path && activeCenterNode.path !== nodeItem.fullPath) {
        await saveCurrentCenterNodeEditor();
    }

    if (activeMapPath) {
        await saveCurrentMapLayout();
    }

    clearMapWorkspace();

    const result = await window.kediProject?.getKediDocument?.(nodeItem.fullPath);

    if (!result || !result.ok) {
        alert(result?.error || 'Node açılamadı.');
        return;
    }

    const {
        wrapper,
        titleInput,
        contentEditor,
        placeholder,
        mapCanvas
    } = getCenterNodeEditorElements();

    if (placeholder) {
        placeholder.style.display = 'none';
    }

    if (mapCanvas) {
        mapCanvas.style.display = 'none';
    }

    if (wrapper) {
        wrapper.hidden = false;
    }

    activeCenterNode = {
        path: nodeItem.fullPath,
        item: nodeItem,
        metadata: result.metadata || {}
    };

    if (titleInput) {
        titleInput.value =
            result.metadata?.title ||
            nodeItem.metadata?.title ||
            String(nodeItem.fileName || nodeItem.name || '').replace(/\.node$/i, '');
    }

    if (contentEditor) {
        setKediEditorContent(contentEditor, result.data?.content || '');
    }

    closeKediTagMenu();

    if (typeof bindKediTagControls === 'function') {
        bindKediTagControls();
    }

    if (typeof bindKediBlockIndexControls === 'function') {
        bindKediBlockIndexControls();
    }

    setTimeout(() => {
        contentEditor?.focus({ preventScroll: true });
    }, 0);
}

async function saveCurrentCenterNodeEditor() {
    if (!activeCenterNode?.path) return;

    const { titleInput, contentEditor, saveBtn } = getCenterNodeEditorElements();

    try {
        saveBtn?.classList.add('saving');

        let nodePath = activeCenterNode.path;
        const oldPath = nodePath;
        const oldTitle = activeCenterNode.metadata?.title || '';
        const title = titleInput?.value?.trim() || oldTitle;
        const content = getKediEditorContent(contentEditor);

        if (title && title !== oldTitle) {
            suppressNextFileSystemRefresh(3000);

            const renameResult = await window.kediProject?.renameKediFile?.(
                nodePath,
                title
            );

            if (!renameResult || !renameResult.ok) {
                alert(renameResult?.error || 'Node başlığı değiştirilemedi.');
                titleInput?.focus();
                return;
            }

            nodePath = renameResult.fullPath;

            activeCenterNode.path = nodePath;
            activeCenterNode.metadata = renameResult.metadata || {};
            activeCenterNode.item = {
                ...activeCenterNode.item,
                name: renameResult.fileName,
                fileName: renameResult.fileName,
                fullPath: renameResult.fullPath,
                displayName: renameResult.metadata?.title || renameResult.fileName,
                metadata: {
                    ...(renameResult.metadata || {})
                },
                sidecarPath: renameResult.sidecarPath || activeCenterNode.item?.sidecarPath
            };

            updateTreeItemAfterRename(oldPath, renameResult);
            updateOpenMapNodeAfterRename(oldPath, renameResult);

            if (typeof updateKediOpenTabAfterRename === 'function') {
                updateKediOpenTabAfterRename(oldPath, renameResult);
            }
        }

        const saveResult = await window.kediProject?.saveNodeContent?.(
            nodePath,
            content
        );

        if (!saveResult || !saveResult.ok) {
            alert(saveResult?.error || 'Node kaydedilemedi.');
            return;
        }

        activeCenterNode.metadata = saveResult.metadata || activeCenterNode.metadata;

        if (typeof refreshActiveMapTreeBranch === 'function') {
            await refreshActiveMapTreeBranch();
        }

        refreshKediTagsPanelSoon();
    } catch (error) {
        console.error('[KEDI] Center node editor kaydetme hatası:', error);
        alert('Node kaydedilirken hata oluştu: ' + error.message);
    } finally {
        saveBtn?.classList.remove('saving');
    }
}

function clearCenterNodeEditor() {
    clearTimeout(centerNodeSaveTimer);

    const {
        wrapper,
        titleInput,
        contentEditor
    } = getCenterNodeEditorElements();

    if (titleInput) {
        titleInput.value = '';
    }

    if (contentEditor) {
        contentEditor.innerHTML = '';
    }

    if (wrapper) {
        wrapper.hidden = true;
    }

    activeCenterNode = null;
    closeKediTagMenu();
}

