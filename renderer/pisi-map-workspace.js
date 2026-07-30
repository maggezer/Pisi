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

function samePisiWorkspacePath(a, b) {
    if (!a || !b) return false;

    if (typeof pisiSameTabPath === 'function') {
        return pisiSameTabPath(a, b);
    }

    const normalize = (value) => String(value).replace(/[\\/]+/g, '/');
    const normalizedA = normalize(a);
    const normalizedB = normalize(b);

    return window.pisiEnvironment?.platform === 'win32'
        ? normalizedA.toLowerCase() === normalizedB.toLowerCase()
        : normalizedA === normalizedB;
}


async function openMapInWorkspace(mapItem) {
    if (!mapItem || !isMapFileName(mapItem.name || mapItem.fileName)) {
        return false;
    }

    if (typeof saveCurrentCenterNodeEditor === 'function' && activeCenterNode) {
        const saved = await saveCurrentCenterNodeEditor();
        if (!saved) return false;
    }

    if (
        activeMapPath &&
        !samePisiWorkspacePath(activeMapPath, mapItem.fullPath) &&
        typeof saveCurrentMapLayout === 'function'
    ) {
        const layoutSaved = await saveCurrentMapLayout();
        if (!layoutSaved) return false;
    }

    const result = await window.pisiProject?.listMapNodes?.(mapItem.fullPath);

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
        clearCenterNodeEditor();
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

    if (placeholder) placeholder.style.display = 'none';
    canvas.hidden = false;
    canvas.style.display = 'block';
    board.innerHTML = '';

    activeMapCamera =
    result.map?.data?.map?.camera ||
    { x: 0, y: 0, zoom: 1 };
    collapsedHubPorts = new Set(
        Array.isArray(result.map?.data?.map?.collapsedHubs)
            ? result.map.data.map.collapsedHubs
            : []
    );

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

    refreshPisiTagsPanelSoon();
    return true;
}

function clearMapWorkspace() {
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

    refreshPisiTagsPanelSoon();
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
        event.target.closest?.('.pisi-map-context-menu')
    );
}

async function createMapNodeBoxAtClientPoint(clientX, clientY) {
    if (!activeMapPath) return;

    const worldPoint = getMapWorldPointFromClient(clientX, clientY);

    suppressNextFileSystemRefresh(3000);

    const result = await window.pisiProject?.createNodeUnderMap?.(activeMapPath);

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

    refreshPisiTagsPanelSoon();
}

function hidePisiMapContextMenu() {
    document.getElementById('pisi-map-context-menu')?.remove();
}

function showPisiMapContextMenu(clientX, clientY) {
    hidePisiMapContextMenu();

    const menu = document.createElement('div');
    menu.id = 'pisi-map-context-menu';
    menu.className = 'pisi-map-context-menu';
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'pisi-map-context-menu-item';
    createBtn.textContent = '📄 Node box oluştur';

    createBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        hidePisiMapContextMenu();
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

        hidePisiMapContextMenu();
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

        showPisiMapContextMenu(event.clientX, event.clientY);
    });

    document.addEventListener('mousedown', (event) => {
        if (!event.target.closest?.('.pisi-map-context-menu')) {
            hidePisiMapContextMenu();
        }
    });

    window.addEventListener('blur', hidePisiMapContextMenu);
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

    box.addEventListener('keydown', (event) => {
        if (event.target !== box) return;

        if (event.key === 'Enter') {
            event.preventDefault();
            openNodeModalFromBox(box);
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

        const ok = await pisiConfirm('Bu node dosyası silinsin mi?', {
        title: 'Node sil',
        confirmText: 'Sil',
        cancelText: 'Vazgeç',
        danger: true
        });

        resetPisiKeyboardAndPointerState();

    if (!ok) return;

    suppressNextFileSystemRefresh(3000);

        const result = await window.pisiProject?.deleteNodeFromMap?.(node.fullPath);

        if (!result || !result.ok) {
            alert(result?.error || 'Node silinemedi.');
            return;
        }

        if (typeof removePisiOpenTabsForDeletedPaths === 'function') {
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

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);

            for (const item of draggedBoxes) {
                item.box.classList.remove('dragging');
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
    if (!activeMapPath) return true;

    clearTimeout(mapSaveTimer);
    mapSaveTimer = null;
    const mapPath = activeMapPath;
    const layout = collectMapLayout();

    try {
        const result = await window.pisiProject?.saveMapLayout?.(
            mapPath,
            layout
        );

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

            const result = await window.pisiProject?.renamePisiFile?.(
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

    const value = String(content || '');

    if (/<[a-z][\s\S]*>/i.test(value)) {
        editor.innerHTML = sanitizePisiEditorHtml(value);
        ensurePisiEditorBlocks(editor);
        if (typeof initializePisiAdvancedEditorContent === 'function') {
            initializePisiAdvancedEditorContent(editor);
        }
        return;
    }

    editor.innerHTML = markdownTextToPisiEditorHtml(value);
    ensurePisiEditorBlocks(editor);
    if (typeof initializePisiAdvancedEditorContent === 'function') {
        initializePisiAdvancedEditorContent(editor);
    }
}

function getPisiEditorContent(editor) {
    if (!editor) return '';

    ensurePisiEditorBlocks(editor);

    if (typeof hydratePisiPaintCanvases === 'function') {
        hydratePisiPaintCanvases(editor);
    }

    editor.querySelectorAll?.('canvas[data-pisi-canvas]')?.forEach?.((canvas) => {
        if (typeof savePisiCanvasData === 'function') {
            savePisiCanvasData(canvas);
        }
    });

    if (typeof hydratePisiSheets === 'function') {
        hydratePisiSheets(editor);
    }

    return sanitizePisiEditorHtml(editor.innerHTML || '');
}

function markdownTextToPisiEditorHtml(text = '') {
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

function sanitizePisiEditorHtml(html = '') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = String(html || '');

    const allowedTags = new Set([
        'A', 'B', 'BLOCKQUOTE', 'BR', 'CANVAS', 'CODE', 'DIV', 'EM',
        'FONT', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'I', 'IMG', 'LI',
        'OL', 'P', 'PRE', 'S', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TABLE',
        'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'U', 'UL'
    ]);
    const globallyAllowedAttributes = new Set([
        'class',
        'title',
        'contenteditable',
        'data-pisi-block-id',
        'data-pisi-tag',
        'data-pisi-done-for',
        'data-pisi-diary-source'
    ]);
    const allowedStyleProperties = new Set([
        'background-color',
        'color',
        'font-family',
        'font-size',
        'font-style',
        'font-weight',
        'text-align',
        'text-decoration'
    ]);

    wrapper
        .querySelectorAll('script, style, iframe, object, embed, link, meta, base, form, input, button')
        .forEach((element) => element.remove());

    Array.from(wrapper.querySelectorAll('*')).forEach((element) => {
        if (!allowedTags.has(element.tagName)) {
            element.replaceWith(...Array.from(element.childNodes));
            return;
        }

        Array.from(element.attributes).forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            const value = String(attribute.value || '');
            let allowed = globallyAllowedAttributes.has(name);

            if (name === 'style') {
                const safeDeclarations = value
                    .split(';')
                    .map((declaration) => declaration.trim())
                    .filter(Boolean)
                    .map((declaration) => {
                        const separatorIndex = declaration.indexOf(':');
                        if (separatorIndex < 1) return '';

                        const property = declaration
                            .slice(0, separatorIndex)
                            .trim()
                            .toLowerCase();
                        const propertyValue = declaration
                            .slice(separatorIndex + 1)
                            .trim();

                        if (
                            !allowedStyleProperties.has(property) ||
                            /url\s*\(|expression\s*\(|@import/i.test(propertyValue)
                        ) {
                            return '';
                        }

                        return `${property}: ${propertyValue}`;
                    })
                    .filter(Boolean);

                if (safeDeclarations.length) {
                    element.setAttribute('style', safeDeclarations.join('; '));
                } else {
                    element.removeAttribute('style');
                }
                return;
            }

            if (element.tagName === 'A' && name === 'href') {
                allowed = /^(?:https?:|mailto:)/i.test(value);
            }

            if (element.tagName === 'IMG') {
                if (name === 'src') {
                    allowed = /^(?:data:image\/(?:png|jpeg|gif|webp);base64,|\.{0,2}\/?assets\/)/i.test(value);
                } else if (['alt', 'width', 'height'].includes(name)) {
                    allowed = true;
                }
            }

            if (element.tagName === 'FONT') {
                allowed = ['color', 'face', 'size'].includes(name);
            }

            if (element.tagName === 'CANVAS') {
                allowed = [
                    'width',
                    'height',
                    'data-pisi-canvas',
                    'data-image'
                ].includes(name);

                if (name === 'data-image') {
                    allowed = /^data:image\/png;base64,/i.test(value);
                }
            }

            if (['TABLE', 'TD'].includes(element.tagName)) {
                allowed = allowed || [
                    'data-pisi-sheet',
                    'data-formula',
                    'data-cell',
                    'data-row',
                    'data-col'
                ].includes(name);
            }

            if (!allowed || name.startsWith('on')) {
                element.removeAttribute(attribute.name);
            }
        });

        if (element.hasAttribute('class')) {
            const safeClasses = Array.from(element.classList).filter((name) => {
                return /^pisi-[A-Za-z0-9_-]+$/.test(name);
            });
            element.className = safeClasses.join(' ');
        }

        if (element.tagName === 'CANVAS') {
            const width = Math.min(1600, Math.max(1, Number(element.getAttribute('width')) || 520));
            const height = Math.min(1200, Math.max(1, Number(element.getAttribute('height')) || 320));
            element.setAttribute('width', String(width));
            element.setAttribute('height', String(height));
            element.setAttribute('data-pisi-canvas', '1');
            element.removeAttribute('data-pisi-canvas-bound');
            element.removeAttribute('data-image-loaded');
        }

        if (element.hasAttribute('contenteditable')) {
            const value = element.getAttribute('contenteditable');
            element.setAttribute(
                'contenteditable',
                value === 'false' ? 'false' : 'true'
            );
        }
    });

    return wrapper.innerHTML;
}

async function openNodeModalFromBox(box) {
    const nodePath = box.dataset.nodePath;

    const result = await window.pisiProject?.getPisiDocument?.(nodePath);

    if (!result || !result.ok) {
        alert(result?.error || 'Node açılamadı.');
        return false;
    }

    activeModalNode = {
        box,
        path: nodePath,
        metadata: result.metadata,
        returnFocus: document.activeElement,
        dirty: false,
        revision: 0
    };

    const overlay = document.getElementById('node-modal-overlay');
    const titleInput = document.getElementById('node-modal-title');
    const contentInput = document.getElementById('node-modal-content');

    if (titleInput) {
        titleInput.value = result.metadata.title || '';

        if (titleInput.dataset.modalDirtyBound !== '1') {
            titleInput.dataset.modalDirtyBound = '1';
            titleInput.addEventListener('input', () => {
                if (!activeModalNode) return;
                activeModalNode.dirty = true;
                activeModalNode.revision =
                    Number(activeModalNode.revision || 0) + 1;
            });
        }
    }

    if (contentInput) {
        if (contentInput.dataset.modalDirtyBound !== '1') {
            contentInput.dataset.modalDirtyBound = '1';
            contentInput.addEventListener('input', () => {
                if (!activeModalNode) return;
                activeModalNode.dirty = true;
                activeModalNode.revision =
                    Number(activeModalNode.revision || 0) + 1;
            });
        }

        setPisiEditorContent(contentInput, result.data.content || '');
        refreshPisiTagsPanelSoon();
    }

    closePisiTagMenu();

    overlay?.classList.add('visible');
    contentInput?.focus();
    return true;
}

async function closeNodeModalAndSave() {
    const overlay = document.getElementById('node-modal-overlay');
    const titleInput = document.getElementById('node-modal-title');
    const contentInput = document.getElementById('node-modal-content');

    if (!activeModalNode) {
        overlay?.classList.remove('visible');
        return true;
    }

    try {
        let nodePath = activeModalNode.path;
        const oldPath = nodePath;
        const oldTitle = activeModalNode.metadata?.title || '';
        const title = titleInput?.value?.trim() || oldTitle;
        const content = getPisiEditorContent(contentInput);

        if (title && title !== oldTitle) {
            suppressNextFileSystemRefresh(1500);

            const renameResult = await window.pisiProject?.renamePisiFile?.(
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
                return false;
            }
        }

        const saveResult = await window.pisiProject?.saveNodeContent?.(
            nodePath,
            content
        );

        if (!saveResult || !saveResult.ok) {
            alert(saveResult?.error || 'Node kaydedilemedi.');
            return false;
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

        closePisiTagMenu();
        refreshPisiTagsPanelSoon();

        const returnFocus = activeModalNode.returnFocus;
        overlay?.classList.remove('visible');
        activeModalNode = null;
        returnFocus?.focus?.({ preventScroll: true });
        return true;
    } catch (error) {
        console.error('[PISI] Modal kaydetme/kapatma hatası:', error);
        alert('Modal kapatılırken hata oluştu: ' + error.message);
        return false;
    }
}

function closeNodeModalWithoutSaving() {
    const overlay = document.getElementById('node-modal-overlay');
    const contentInput = document.getElementById('node-modal-content');
    const titleInput = document.getElementById('node-modal-title');

    const returnFocus = activeModalNode?.returnFocus;
    overlay?.classList.remove('visible');
    if (contentInput) contentInput.innerHTML = '';
    if (titleInput) titleInput.value = '';
    activeModalNode = null;
    closePisiTagMenu();
    returnFocus?.focus?.({ preventScroll: true });
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

        titleInput.addEventListener('input', () => {
            if (!activeCenterNode) return;
            activeCenterNode.dirty = true;
            activeCenterNode.revision =
                Number(activeCenterNode.revision || 0) + 1;
            scheduleCenterNodeEditorSave();
        });

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
            if (activeCenterNode) {
                activeCenterNode.dirty = true;
                activeCenterNode.revision =
                    Number(activeCenterNode.revision || 0) + 1;
            }
            refreshPisiTagsPanelSoon();
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

    if (
        activeCenterNode?.path &&
        !samePisiWorkspacePath(activeCenterNode.path, nodeItem.fullPath)
    ) {
        const saved = await saveCurrentCenterNodeEditor();
        if (!saved) return false;
    }

    if (activeMapPath) {
        const layoutSaved = await saveCurrentMapLayout();
        if (!layoutSaved) return false;
    }

    const result = await window.pisiProject?.getPisiDocument?.(nodeItem.fullPath);

    if (!result || !result.ok) {
        alert(result?.error || 'Node açılamadı.');
        return false;
    }

    clearMapWorkspace();

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
        mapCanvas.hidden = true;
        mapCanvas.style.display = 'none';
    }

    if (wrapper) {
        wrapper.hidden = false;
    }

    activeCenterNode = {
        path: nodeItem.fullPath,
        item: nodeItem,
        metadata: result.metadata || {},
        dirty: false,
        revision: 0
    };

    if (titleInput) {
        titleInput.value =
            result.metadata?.title ||
            nodeItem.metadata?.title ||
            String(nodeItem.fileName || nodeItem.name || '').replace(/\.node$/i, '');
    }

    if (contentEditor) {
        setPisiEditorContent(contentEditor, result.data?.content || '');
    }

    closePisiTagMenu();

    if (typeof bindPisiTagControls === 'function') {
        bindPisiTagControls();
    }

    if (typeof bindPisiBlockIndexControls === 'function') {
        bindPisiBlockIndexControls();
    }

    setTimeout(() => {
        contentEditor?.focus({ preventScroll: true });
    }, 0);

    return true;
}

let pisiCenterSaveTail = Promise.resolve(true);

function saveCurrentCenterNodeEditor() {
    if (!activeCenterNode?.path) return true;

    const saveTask = pisiCenterSaveTail
        .catch(() => false)
        .then(() => performCurrentCenterNodeEditorSave());

    pisiCenterSaveTail = saveTask;
    return saveTask;
}

async function performCurrentCenterNodeEditorSave() {
    if (!activeCenterNode?.path) return true;

    const { titleInput, contentEditor, saveBtn } = getCenterNodeEditorElements();
    const saveRevision = Number(activeCenterNode.revision || 0);

    try {
        clearTimeout(centerNodeSaveTimer);
        centerNodeSaveTimer = null;
        saveBtn?.classList.add('saving');

        let nodePath = activeCenterNode.path;
        const oldPath = nodePath;
        const oldTitle = activeCenterNode.metadata?.title || '';
        const title = titleInput?.value?.trim() || oldTitle;
        const content = getPisiEditorContent(contentEditor);

        if (title && title !== oldTitle) {
            suppressNextFileSystemRefresh(3000);

            const renameResult = await window.pisiProject?.renamePisiFile?.(
                nodePath,
                title
            );

            if (!renameResult || !renameResult.ok) {
                alert(renameResult?.error || 'Node başlığı değiştirilemedi.');
                titleInput?.focus();
                return false;
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

            if (typeof updatePisiOpenTabAfterRename === 'function') {
                updatePisiOpenTabAfterRename(oldPath, renameResult);
            }
        }

        const saveResult = await window.pisiProject?.saveNodeContent?.(
            nodePath,
            content
        );

        if (!saveResult || !saveResult.ok) {
            alert(saveResult?.error || 'Node kaydedilemedi.');
            return false;
        }

        activeCenterNode.metadata = saveResult.metadata || activeCenterNode.metadata;
        if (Number(activeCenterNode.revision || 0) === saveRevision) {
            activeCenterNode.dirty = false;
        }

        if (typeof refreshActiveMapTreeBranch === 'function') {
            await refreshActiveMapTreeBranch();
        }

        refreshPisiTagsPanelSoon();
        return true;
    } catch (error) {
        console.error('[PISI] Center node editor kaydetme hatası:', error);
        alert('Node kaydedilirken hata oluştu: ' + error.message);
        return false;
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
    closePisiTagMenu();
}

async function flushPisiPendingSaves() {
    clearTimeout(centerNodeSaveTimer);
    clearTimeout(mapSaveTimer);
    clearTimeout(mapCameraSaveTimer);
    centerNodeSaveTimer = null;
    mapSaveTimer = null;
    mapCameraSaveTimer = null;

    if (activeModalNode) {
        const modalSaved = await closeNodeModalAndSave();
        if (!modalSaved) return false;
    }

    if (activeCenterNode) {
        const centerSaved = await saveCurrentCenterNodeEditor();
        if (!centerSaved) return false;
    }

    if (activeMapPath) {
        const layoutSaved = await saveCurrentMapLayout();
        if (!layoutSaved) return false;

        if (typeof flushActiveMapCameraSave === 'function') {
            const cameraSaved = await flushActiveMapCameraSave();
            if (!cameraSaved) return false;
        }
    }

    return true;
}
