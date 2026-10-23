import { resetPisiSelectionBookmarks } from '../editor/pisi-selection-bookmarks.mjs';
import { resetPisiEditorHistory } from '../editor/pisi-editor-history.mjs';
import { beginPisiWorkspaceNavigation, isPisiWorkspaceNavigationCurrent } from '../editor/pisi-editor-navigation.mjs';
import { getPisiEditorRestoreGeneration, isPisiEditorRestorePending } from '../editor/pisi-editor-restore.mjs';
import { registerModule } from '../core/module-registry.mjs';

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

function samePisiWorkspacePath(a, b) {
    if (!a || !b) return false;

    if (typeof pisiSameTabPath === 'function') {
        return pisiSameTabPath(a, b);
    }

    const normalize = (value) => String(value).replace(/[\\/]+/g, '/');
    const normalizedA = normalize(a);
    const normalizedB = normalize(b);

    return window.pisiEnvironment?.platform === 'win32' ? normalizedA.toLowerCase() === normalizedB.toLowerCase() : normalizedA === normalizedB;
}

async function openMapInWorkspace(mapItem, request = beginPisiWorkspaceNavigation()) {
    if (!isPisiWorkspaceNavigationCurrent(request)) return false;
    if (isPisiEditorRestorePending()) return false;
    const restoreGeneration = getPisiEditorRestoreGeneration();
    if (!mapItem || !isMapFileName(mapItem.name || mapItem.fileName)) {
        return false;
    }

    if (typeof saveCurrentCenterNodeEditor === 'function' && activeCenterNode) {
        const saved = await saveCurrentCenterNodeEditor({ allowDiscardRecovery: true });
        if (!isPisiWorkspaceNavigationCurrent(request) || !saved) return false;
    }

    if (activeMapPath && !samePisiWorkspacePath(activeMapPath, mapItem.fullPath) && typeof saveCurrentMapLayout === 'function') {
        const layoutSaved = await saveCurrentMapLayout();
        if (!isPisiWorkspaceNavigationCurrent(request) || !layoutSaved) return false;
    }

    const outgoingNode = activeCenterNode;
    const outgoingRevision = Number(outgoingNode?.revision || 0);
    const result = await window.pisiProject?.listMapNodes?.(mapItem.fullPath);
    if (activeCenterNode !== outgoingNode || Number(outgoingNode?.revision || 0) !== outgoingRevision) return false;
    if (!isPisiWorkspaceNavigationCurrent(request) || isPisiEditorRestorePending() || restoreGeneration !== getPisiEditorRestoreGeneration()) return false;

    if (!result || !result.ok) {
        alert(result?.error || 'Map yüklenemedi.');
        return false;
    }

    const placeholder = document.getElementById('workspace-placeholder');
    const canvas = document.getElementById('map-canvas');
    const board = document.getElementById('map-board');

    if (!canvas || !board) {
        console.error('[PISI] Harita çalışma alanı DOM öğeleri bulunamadı.');
        return false;
    }

    if (typeof clearCenterNodeEditor === 'function') {
        clearCenterNodeEditor(true);
    }

    if (typeof ensurePisiOpenTab === 'function') {
        ensurePisiOpenTab(mapItem);
    }

    if (window.Pisi?.state) {
        window.Pisi.state.activeTabPath = mapItem.fullPath;
    }

    if (typeof renderPisiOpenTabs === 'function') {
        renderPisiOpenTabs();
    }

    activeMapPath = mapItem.fullPath;
    selectedMapEdgeId = null;

    if (placeholder) placeholder.style.display = 'none';
    canvas.hidden = false;
    canvas.style.display = 'block';
    board.innerHTML = '';

    activeMapCamera = result.map?.data?.map?.camera || { x: 0, y: 0, zoom: 1 };
    collapsedHubPorts = new Set(Array.isArray(result.map?.data?.map?.collapsedHubs) ? result.map.data.map.collapsedHubs : []);

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
    if (typeof syncHubPortCollapseVisuals === 'function') {
        syncHubPortCollapseVisuals();
    }

    document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));

    refreshPisiTagsPanelSoon();
    return true;
}

function clearMapWorkspace(preserveNavigation = false) {
    if (!preserveNavigation) beginPisiWorkspaceNavigation();
    const placeholder = document.getElementById('workspace-placeholder');
    const canvas = document.getElementById('map-canvas');
    const board = document.getElementById('map-board');

    clearTimeout(mapSaveTimer);
    clearTimeout(mapCameraSaveTimer);
    mapSaveTimer = null;
    mapCameraSaveTimer = null;

    if (typeof resetPisiMapConnectionInteractions === 'function') {
        resetPisiMapConnectionInteractions();
    }

    activeMapPath = null;
    activeMapNodes = [];
    activeMapEdges = [];
    activeMapCamera = { x: 0, y: 0, zoom: 1 };
    selectedMapEdgeId = null;
    collapsedHubPorts = new Set();

    if (board) {
        board.innerHTML = '';
    }

    drawMapConnections();

    if (canvas) {
        canvas.hidden = true;
        canvas.style.display = 'none';
    }

    if (placeholder) {
        placeholder.style.display = 'flex';
    }

    document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));

    refreshPisiTagsPanelSoon();
}

function createMapNodeBox(node) {
    const box = document.createElement('div');
    box.className = 'map-node-box';
    box.dataset.nodeId = node.id;
    box.dataset.nodePath = node.fullPath;
    box.dataset.pisiReference = node.isReference ? 'true' : 'false';
    box.classList.toggle('pisi-map-reference-node', node.isReference === true);
    const hierarchyChildren = (Array.isArray(activeMapEdges) ? activeMapEdges : []).filter((edge) => edge?.sourceId === node.id && edge?.type === 'down-hub');
    box.classList.toggle('pisi-map-hub-node', hierarchyChildren.length > 0);
    box.style.left = `${node.layout.x}px`;
    box.style.top = `${node.layout.y}px`;
    box.style.width = `${node.layout.width}px`;
    box.style.height = `${node.layout.height}px`;
    if (typeof applyPisiMapNodeCustomization === 'function') {
        applyPisiMapNodeCustomization(box, node);
    }
    const title = node.metadata?.title || node.fileName.replace(/\.node$/i, '');
    const preview = node.preview || '';
    box.tabIndex = 0;
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', `${title} node`);
    box.innerHTML = `
        <button class="map-node-btn map-node-delete" title="Node sil">×</button>
        <button class="map-node-btn map-node-open" title="Node düzenle">↗</button>
        <div class="map-port top" data-port="top" role="button" tabindex="0" aria-label="Üst bağlantı portu"></div>
        <div class="map-port right" data-port="right" role="button" tabindex="0" aria-label="Sağ bağlantı portu"></div>
        <div class="map-port bottom" data-port="bottom" role="button" tabindex="0" aria-label="Alt bağlantı portu"></div>
        <div class="map-port left" data-port="left" role="button" tabindex="0" aria-label="Sol bağlantı portu"></div>
        <div class="map-node-title" title="${escapeHtml(title)}"><span class="map-node-title-text">${escapeHtml(title)}</span></div>
        <div class="map-node-preview">${escapeHtml(preview)}</div>
        <div class="map-node-resize"></div>
    `;
    if (node.isReference) {
        const deleteButton = box.querySelector('.map-node-delete');
        if (deleteButton) deleteButton.title = 'Map referansını kaldır';
        box.querySelectorAll('.map-port').forEach((port) => {
            port.hidden = true;
            port.tabIndex = -1;
        });
    }
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
        selectedMapEdgeId = null;
        document.querySelectorAll('.map-edge-group.selected').forEach((group) => {
            group.classList.remove('selected');
        });
        if (!box.classList.contains('selected')) {
            clearSelectedMapNodes();
            box.classList.add('selected');
        }
        document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));
    });

    bindMapNodeDrag(box);
    bindMapNodeResize(box, resizeHandle);

    bindMapPortEvents(box);

    box.addEventListener('keydown', (event) => {
        if (event.target !== box) return;

        if (event.key === 'Enter') {
            event.preventDefault();
            openNodeModalFromBox(box);
        } else if (event.key === 'F2') {
            event.preventDefault();
            startMapNodeTitleEdit(box, node);
        } else if (event.key === 'Delete') {
            event.preventDefault();
            deleteBtn?.click();
        }
    });

    titleEl?.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();

        startMapNodeTitleEdit(box, node);
    });

    // Browsers do not emit dblclick for the secondary mouse button.
    let lastRightClick = null;
    const isTitleCardTarget = (event) =>
        document.getElementById('map-canvas')?.dataset.nodeView === 'title' &&
        !event.target.closest('.map-node-btn, .map-port, .map-node-resize, input, textarea, [contenteditable="true"]');

    box.addEventListener('contextmenu', (event) => {
        if (!isTitleCardTarget(event)) return;
        event.preventDefault();
        event.stopPropagation();
    });

    box.addEventListener('mouseup', (event) => {
        if (event.button !== 2 || !isTitleCardTarget(event)) {
            lastRightClick = null;
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const previous = lastRightClick;
        lastRightClick = { time: event.timeStamp, x: event.clientX, y: event.clientY };
        if (previous && event.timeStamp - previous.time <= 500 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 6) {
            lastRightClick = null;
            openNodeModalFromBox(box);
        }
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

        resetPisiKeyboardAndPointerState();

        const isReference = node.isReference === true;
        const ok = await pisiConfirm(isReference ? 'Bu node yalnızca map görünümünden kaldırılsın mı?' : 'Bu node dosyası silinsin mi?', {
            title: isReference ? 'Map referansını kaldır' : 'Node sil',
            confirmText: isReference ? 'Kaldır' : 'Sil',
            cancelText: 'Vazgeç',
            danger: !isReference
        });

        resetPisiKeyboardAndPointerState();

        if (!ok) return;

        suppressNextFileSystemRefresh(3000);

        const result = isReference
            ? await window.pisiProject?.detachMapReference?.(activeMapPath, node.id)
            : await window.pisiProject?.deleteNodeFromMap?.(node.fullPath);

        if (!result || !result.ok) {
            alert(result?.error || 'Node silinemedi.');
            return;
        }

        if (!isReference && typeof removePisiOpenTabsForDeletedPaths === 'function') {
            await removePisiOpenTabsForDeletedPaths([node.fullPath]);
        }

        box.remove();

        activeMapEdges = Array.isArray(result.edges)
            ? result.edges
            : activeMapEdges.filter((edge) => {
                  return edge.sourceId !== node.id && edge.targetId !== node.id;
              });

        drawMapConnections();

        activeMapNodes = activeMapNodes.filter((item) => item.id !== node.id);

        document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));

        await saveCurrentMapLayout();

        if (typeof refreshActiveMapTreeBranch === 'function') {
            await refreshActiveMapTreeBranch();
        }

        refreshPisiTagsPanelSoon();

        resetPisiKeyboardAndPointerState();

        refocusPisiRenderer();

        setTimeout(() => {
            refocusPisiRenderer();
        }, 80);
    });
}

function bindMapNodeDrag(box) {
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

        const startX = event.clientX;
        const startY = event.clientY;
        const dragZoom = activeMapCamera?.zoom || 1;
        let hasDragged = false;

        const draggedBoxes = getSelectedMapNodeBoxes().map((selectedBox) => {
            selectedBox.classList.add('dragging');

            return {
                box: selectedBox,
                x: parseFloat(selectedBox.style.left || '0'),
                y: parseFloat(selectedBox.style.top || '0')
            };
        });

        const onMouseMove = (moveEvent) => {
            const dx = (moveEvent.clientX - startX) / dragZoom;
            const dy = (moveEvent.clientY - startY) / dragZoom;

            if (Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) > 4) {
                hasDragged = true;
            }

            for (const item of draggedBoxes) {
                item.box.style.left = `${item.x + dx}px`;
                item.box.style.top = `${item.y + dy}px`;
            }

            if (typeof scheduleDrawMapConnections === 'function') {
                scheduleDrawMapConnections();
            } else {
                drawMapConnections();
            }
        };

        const onMouseUp = (upEvent) => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);

            for (const item of draggedBoxes) {
                item.box.classList.remove('dragging');
            }

            const moved = hasDragged || Math.abs(upEvent.clientX - startX) + Math.abs(upEvent.clientY - startY) > 4;

            if (moved) {
                clearSelectedMapNodes();
            }

            scheduleMapLayoutSave();
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp, { once: true });
        event.preventDefault();
    });
}

function bindMapNodeResize(box, handle) {
    if (!handle) return;

    handle.addEventListener('mousedown', (event) => {
        const startX = event.clientX;
        const startY = event.clientY;
        const startW = box.offsetWidth;
        const startH = box.offsetHeight;
        const resizeZoom = activeMapCamera?.zoom || 1;

        const onMouseMove = (moveEvent) => {
            const dx = (moveEvent.clientX - startX) / resizeZoom;
            const dy = (moveEvent.clientY - startY) / resizeZoom;

            const newW = Math.max(150, startW + dx);
            const newH = Math.max(74, startH + dy);

            box.style.width = `${newW}px`;
            box.style.height = `${newH}px`;

            if (typeof scheduleDrawMapConnections === 'function') {
                scheduleDrawMapConnections();
            } else {
                drawMapConnections();
            }
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            scheduleMapLayoutSave();
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp, { once: true });

        event.preventDefault();
        event.stopPropagation();
    });
}

function collectMapLayout() {
    return Array.from(document.querySelectorAll('.map-node-box')).map((box) => {
        const node = activeMapNodes.find((item) => item?.id === box.dataset.nodeId);
        return {
            id: box.dataset.nodeId,
            x: parseFloat(box.style.left || '0'),
            y: parseFloat(box.style.top || '0'),
            width: box.offsetWidth || parseFloat(box.style.width || '220'),
            height: box.offsetHeight || parseFloat(box.style.height || '92'),
            customization: { ...(node?.customization || {}) }
        };
    });
}

function scheduleMapLayoutSave() {
    clearTimeout(mapSaveTimer);

    mapSaveTimer = setTimeout(() => {
        saveCurrentMapLayout();
    }, 350);
}

async function saveCurrentMapLayout() {
    if (!activeMapPath) return true;

    clearTimeout(mapSaveTimer);
    mapSaveTimer = null;
    const mapPath = activeMapPath;
    const layout = collectMapLayout();

    try {
        const result = await window.pisiProject?.saveMapLayout?.(mapPath, layout);

        return Boolean(result?.ok);
    } catch (error) {
        console.error('[PISI] Map yerleşimi kaydedilemedi:', error);
        return false;
    }
}

async function startMapNodeTitleEdit(box, node) {
    const titleEl = box.querySelector('.map-node-title');

    if (!titleEl) return;
    if (box.dataset.renaming === '1') return;

    box.dataset.renaming = '1';

    const oldTitle = titleEl.textContent.trim();
    const oldPath = node.fullPath;

    const input = document.createElement('input');
    input.className = 'map-node-title-input pisi-rename-input';
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

    focusPisiTextInput(input, true);

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

            const result = await window.pisiProject?.renamePisiFile?.(oldPath, newTitle);

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

            const cleanTitle = result.metadata?.title || result.fileName.replace(/\.node$/i, '');

            restoreTitle(cleanTitle);

            document.dispatchEvent(new CustomEvent('pisi:map-customization-context-changed'));

            updateTreeItemAfterRename(oldPath, result);
            updateOpenMapNodeAfterRename(oldPath, result);

            if (typeof refreshActiveMapTreeBranch === 'function') {
                await refreshActiveMapTreeBranch();
            }

            if (typeof animateMapBox === 'function') {
                animateMapBox(box);
            }
        } catch (error) {
            console.error('[PISI] Map node rename hatası:', error);
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

function setPisiEditorContent(editor, content = '') {
    if (!editor) return;
    resetPisiSelectionBookmarks(editor);

    const value = String(content || '');

    if (/<[a-z][\s\S]*>/i.test(value)) {
        editor.innerHTML = sanitizePisiEditorHtml(value);
        ensurePisiEditorBlocks(editor);
        window.decoratePisiBlockTypes?.(editor);
        window.syncPisiWordHeadingCollapse?.(editor);
        if (typeof initializePisiAdvancedEditorContent === 'function') {
            initializePisiAdvancedEditorContent(editor);
        }
        resetPisiEditorHistory(editor);
        return;
    }

    editor.innerHTML = markdownTextToPisiEditorHtml(value);
    ensurePisiEditorBlocks(editor);
    window.decoratePisiBlockTypes?.(editor);
    window.syncPisiWordHeadingCollapse?.(editor);
    if (typeof initializePisiAdvancedEditorContent === 'function') {
        initializePisiAdvancedEditorContent(editor);
    }
    resetPisiEditorHistory(editor);
}

function getPisiEditorContent(editor) {
    if (!editor) return '';

    if (typeof hydratePisiPaintCanvases === 'function') {
        hydratePisiPaintCanvases(editor);
    }

    editor.querySelectorAll?.('canvas[data-pisi-canvas]')?.forEach?.((canvas) => {
        if (typeof savePisiCanvasData === 'function') {
            savePisiCanvasData(canvas);
        }
    });

    if (typeof savePisiDocumentInkForEditor === 'function') {
        savePisiDocumentInkForEditor(editor);
    }

    if (typeof hydratePisiSheets === 'function') {
        hydratePisiSheets(editor);
    }

    // Kayıt normalizasyonu canlı contenteditable DOM'u değiştirmemeli.
    // Aksi halde Chromium selection/caret konumunu sıfırlar.
    const normalizedEditor = editor.cloneNode(true);
    normalizedEditor.querySelectorAll('.pisi-block-active').forEach((block) => {
        block.classList.remove('pisi-block-active');
    });
    ensurePisiEditorBlocks(normalizedEditor, {
        preserveSelection: false
    });

    return sanitizePisiEditorHtml(normalizedEditor.innerHTML || '');
}

function markdownTextToPisiEditorHtml(text = '') {
    const lines = String(text || '').split('\n');

    return lines
        .map((line) => {
            const headingMatch = line.match(/^\s*(#{2,5})\s+(.*)$/);

            if (headingMatch) {
                const level = headingMatch[1].length;
                const title = headingMatch[2] || '';

                return `<h${level}>${escapeHtml(title)}</h${level}>`;
            }

            const bulletMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
            if (bulletMatch) {
                const indent = Math.min(Math.floor((bulletMatch[1] || '').replace(/\t/g, '  ').length / 2), 6);
                const indentAttr = indent > 0 ? ` data-pisi-bullet-indent="${indent}" style="--pisi-bullet-indent: ${indent}"` : '';
                const body = bulletMatch[3] ? escapeHtml(bulletMatch[3]) : '<br>';
                return `<div class="pisi-editor-block" data-pisi-block-type="bullet"${indentAttr}>${body}</div>`;
            }

            if (!line.trim()) {
                return '<div><br></div>';
            }

            return `<div>${escapeHtml(line)}</div>`;
        })
        .join('');
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    isMapFileName: {
        enumerable: true,
        get() {
            return isMapFileName;
        }
    },
    isNodeFileName: {
        enumerable: true,
        get() {
            return isNodeFileName;
        }
    },
    getFileIcon: {
        enumerable: true,
        get() {
            return getFileIcon;
        }
    },
    samePisiWorkspacePath: {
        enumerable: true,
        get() {
            return samePisiWorkspacePath;
        }
    },
    openMapInWorkspace: {
        enumerable: true,
        get() {
            return openMapInWorkspace;
        }
    },
    clearMapWorkspace: {
        enumerable: true,
        get() {
            return clearMapWorkspace;
        }
    },
    createMapNodeBox: {
        enumerable: true,
        get() {
            return createMapNodeBox;
        }
    },
    bindMapNodeBoxEvents: {
        enumerable: true,
        get() {
            return bindMapNodeBoxEvents;
        }
    },
    bindMapNodeDrag: {
        enumerable: true,
        get() {
            return bindMapNodeDrag;
        }
    },
    bindMapNodeResize: {
        enumerable: true,
        get() {
            return bindMapNodeResize;
        }
    },
    collectMapLayout: {
        enumerable: true,
        get() {
            return collectMapLayout;
        }
    },
    scheduleMapLayoutSave: {
        enumerable: true,
        get() {
            return scheduleMapLayoutSave;
        }
    },
    saveCurrentMapLayout: {
        enumerable: true,
        get() {
            return saveCurrentMapLayout;
        }
    },
    startMapNodeTitleEdit: {
        enumerable: true,
        get() {
            return startMapNodeTitleEdit;
        }
    },
    setPisiEditorContent: {
        enumerable: true,
        get() {
            return setPisiEditorContent;
        }
    },
    getPisiEditorContent: {
        enumerable: true,
        get() {
            return getPisiEditorContent;
        }
    },
    markdownTextToPisiEditorHtml: {
        enumerable: true,
        get() {
            return markdownTextToPisiEditorHtml;
        }
    }
});
registerModule('map.workspace', moduleApi);
