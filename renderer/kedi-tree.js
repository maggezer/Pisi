const MAP_ZOOM_STEP = 1.1;
const MAP_ZOOM_MIN = 0.1;
const MAP_ZOOM_MAX = 3;
const MAP_ZOOM_HOLD_INTERVAL = 400;

function getKediProjectTitleFromPath(folderPath) {
    if (!folderPath) return 'Explorer';

    const parts = String(folderPath)
        .split(/[\\/]/)
        .filter(Boolean);

    return parts[parts.length - 1] || 'Explorer';
}

function updateKediProjectTitle(folderPath) {
    const titleEl = document.getElementById('project-title');
    if (!titleEl) return;

    titleEl.textContent = getKediProjectTitleFromPath(folderPath);
    titleEl.title = folderPath || '';
}

function suppressNextFileSystemRefresh(duration = 900) {
    suppressFileSystemRefreshUntil = Date.now() + duration;
}

function shouldSuppressFileSystemRefresh() {
    return Date.now() < suppressFileSystemRefreshUntil;
}


async function validateCurrentProject() {
    const folderPath = window.currentProjectFolder;

    if (!folderPath) {
        showProjectModal();
        return false;
    }

    const exists = await window.kediProject?.folderExists?.(folderPath);

    if (!exists) {
        window.currentProjectFolder = null;
        updateKediProjectTitle(null);

        const treeEl = document.getElementById('file-tree');
        if (treeEl) {
            treeEl.innerHTML = '';
        }

        showProjectModal();
        return false;
    }

    return true;
}

async function refreshCurrentProjectTree() {
    clearTimeout(projectRefreshTimer);

    projectRefreshTimer = setTimeout(async () => {
        const valid = await validateCurrentProject();

        if (valid && window.currentProjectFolder) {
            await renderFolderTree(window.currentProjectFolder);
        }
    }, 250);
}

function showProjectModal() {
    const projectModal = document.getElementById('project-modal');
    projectModal?.classList.add('visible');
}

function hideProjectModal() {
    const projectModal = document.getElementById('project-modal');
    projectModal?.classList.remove('visible');
}

async function chooseAndLoadProject() {
    const selectedFolder = await window.kediProject?.chooseFolder?.();

    if (!selectedFolder) {
        // Kullanıcı seçim penceresinde geri/iptal yaptıysa bile
        // mevcut proje hâlâ geçerli mi kontrol et ve ağacı yenile.
        await refreshCurrentProjectTree();
        return;
    }

    await loadProject(selectedFolder);
    hideProjectModal();
}

async function loadProject(folderPath) {
    window.currentProjectFolder = folderPath;
    updateKediProjectTitle(folderPath);

    if (typeof resetKediOpenTabs === 'function') {
        resetKediOpenTabs();
    }

    if (typeof clearMapWorkspace === 'function') {
        clearMapWorkspace();
    }

    await renderFolderTree(folderPath);
}

async function renderFolderTree(rootPath) {
    const treeEl = document.getElementById('file-tree');
    if (!treeEl) return;

    treeEl.innerHTML = '';

    updateKediProjectTitle(rootPath);

    expandedTreePaths.add(rootPath);

    bindFileTreeRootDropZone(treeEl);

    await loadFolderChildren(rootPath, treeEl, 0);
}

function getKediTreeDragStateItem() {
    return window.Kedi?.state?.treeDragItem || null;
}

function setKediTreeDragStateItem(item) {
    if (!window.Kedi) {
        window.Kedi = { state: {} };
    }

    if (!window.Kedi.state) {
        window.Kedi.state = {};
    }

    window.Kedi.state.treeDragItem = item || null;
}

function cloneKediTreeDragItem(item) {
    if (!item) return null;

    return {
        name: item.name || item.fileName || '',
        fileName: item.fileName || item.name || '',
        fullPath: item.fullPath,
        type: item.type,
        isDirectory: Boolean(item.isDirectory),
        isFile: item.isFile !== false,
        displayName: item.displayName || '',
        sidecarPath: item.sidecarPath || null,
        metadata: item.metadata ? { ...item.metadata } : null
    };
}

function getClientPathBaseName(filePath = '') {
    const parts = String(filePath || '').split(/[\/]/).filter(Boolean);
    return parts[parts.length - 1] || '';
}

function getDirectTreeRow(treeNode) {
    if (!treeNode) return null;

    return Array.from(treeNode.children).find((child) => {
        return child.classList?.contains('tree-row');
    });
}

function getAncestorMapItemForTreeNode(treeNode) {
    let current = treeNode;

    while (current) {
        const item = current.__kediItem;

        if (item?.isFile && isMapFileName(item.name || item.fileName)) {
            return item;
        }

        current = current.parentElement?.closest?.('.tree-node') || null;
    }

    return null;
}

function isTreeDropInsideDraggedNode(sourceItem, targetNode) {
    if (!sourceItem?.fullPath || !targetNode) return false;

    const sourceNode = findTreeNodeByPath(sourceItem.fullPath);
    return Boolean(sourceNode && sourceNode !== targetNode && sourceNode.contains(targetNode));
}

function canDropTreeItemOnTarget(sourceItem, targetItem, targetNode) {
    if (!sourceItem?.fullPath || !targetItem?.fullPath) return false;
    if (sameClientPath(sourceItem.fullPath, targetItem.fullPath)) return false;
    if (isTreeDropInsideDraggedNode(sourceItem, targetNode)) return false;

    const sourceIsNode = sourceItem.isFile && isNodeFileName(sourceItem.name || sourceItem.fileName);
    const targetIsNode = targetItem.isFile && isNodeFileName(targetItem.name || targetItem.fileName);
    const targetIsMap = targetItem.isFile && isMapFileName(targetItem.name || targetItem.fileName);

    if (targetItem.isDirectory) return true;
    if (sourceIsNode && targetIsMap && targetItem.sidecarPath) return true;

    if (sourceIsNode && targetIsNode) {
        const sourceNode = findTreeNodeByPath(sourceItem.fullPath);
        const sourceMap = getAncestorMapItemForTreeNode(sourceNode);
        const targetMap = getAncestorMapItemForTreeNode(targetNode);

        return Boolean(
            sourceMap?.fullPath &&
            targetMap?.fullPath &&
            sameClientPath(sourceMap.fullPath, targetMap.fullPath) &&
            sourceItem.metadata?.id &&
            targetItem.metadata?.id &&
            sourceItem.metadata.id !== targetItem.metadata.id
        );
    }

    return false;
}

async function reparentMapNodeFromTreeDrop(childItem, parentItem, mapItem) {
    if (!childItem?.metadata?.id || !parentItem?.metadata?.id || !mapItem?.fullPath) {
        return;
    }

    const childId = childItem.metadata.id;
    const parentId = parentItem.metadata.id;

    const listResult = await window.kediProject?.listMapNodes?.(mapItem.fullPath);

    if (!listResult?.ok) {
        alert(listResult?.error || 'Map bağlantıları okunamadı.');
        return;
    }

    const edges = Array.isArray(listResult.edges) ? listResult.edges : [];
    const oldHubParents = edges.filter((edge) => {
        return typeof isHierarchyEdge === 'function' &&
            isHierarchyEdge(edge) &&
            edge.targetId === childId;
    });

    suppressNextFileSystemRefresh(3000);

    for (const edge of oldHubParents) {
        if (edge.id) {
            await window.kediProject?.deleteMapConnection?.(mapItem.fullPath, edge.id);
        }
    }

    const result = await window.kediProject?.upsertMapConnection?.(mapItem.fullPath, {
        sourceId: parentId,
        targetId: childId,
        sourcePort: 'bottom',
        targetPort: 'top',
        type: 'down-hub',
        sourceRole: 'down-hub',
        targetRole: 'up-hub'
    });

    if (!result?.ok) {
        alert(result?.error || 'Node taşınamadı.');
        return;
    }

    if (activeMapPath && sameClientPath(activeMapPath, mapItem.fullPath)) {
        activeMapEdges = result.edges || activeMapEdges;
        drawMapConnections();
        await refreshActiveMapTreeBranch();
    } else {
        await refreshCurrentProjectTree();
    }
}

async function moveTreeItemToFolder(sourceItem, destinationFolderPath, options = {}) {
    if (!sourceItem?.fullPath || !destinationFolderPath) return;

    suppressNextFileSystemRefresh(5000);

    const result = await window.kediProject?.moveKediItem?.(
        sourceItem.fullPath,
        destinationFolderPath,
        options
    );

    if (!result?.ok) {
        alert(result?.error || 'Öğe taşınamadı.');
        return;
    }

    if (typeof updateKediOpenTabAfterRename === 'function' && result.isFile) {
        updateKediOpenTabAfterRename(sourceItem.fullPath, result);
    }

    if (
        activeCenterNode?.path &&
        result.fullPath &&
        sameClientPath(activeCenterNode.path, sourceItem.fullPath)
    ) {
        activeCenterNode.path = result.fullPath;
        activeCenterNode.metadata = result.metadata || activeCenterNode.metadata;
    }

    await refreshCurrentProjectTree();

    const affectedOpenMap = activeMapPath && (
        sameClientPath(activeMapPath, result.parentMapPath) ||
        sameClientPath(activeMapPath, result.oldParentMapPath) ||
        sameClientPath(activeMapPath, sourceItem.fullPath)
    );

    if (affectedOpenMap && typeof openMapInWorkspace === 'function') {
        const mapPath = activeMapPath;
        const mapTreeNode = findTreeNodeByPath(mapPath);
        const mapItem = mapTreeNode?.__kediItem || {
            name: getClientPathBaseName(mapPath),
            fullPath: mapPath,
            isFile: true,
            isDirectory: false,
            metadata: {}
        };

        await openMapInWorkspace(mapItem);
    }
}

async function handleTreeDrop(sourceItem, targetItem, targetNode) {
    if (!canDropTreeItemOnTarget(sourceItem, targetItem, targetNode)) return;

    const sourceIsNode = sourceItem.isFile && isNodeFileName(sourceItem.name || sourceItem.fileName);
    const targetIsNode = targetItem.isFile && isNodeFileName(targetItem.name || targetItem.fileName);
    const targetIsMap = targetItem.isFile && isMapFileName(targetItem.name || targetItem.fileName);

    if (sourceIsNode && targetIsNode) {
        const mapItem = getAncestorMapItemForTreeNode(targetNode);
        await reparentMapNodeFromTreeDrop(sourceItem, targetItem, mapItem);
        return;
    }

    if (targetItem.isDirectory) {
        await moveTreeItemToFolder(sourceItem, targetItem.fullPath, {
            parentMapId: null,
            parentMapPath: null
        });
        return;
    }

    if (sourceIsNode && targetIsMap && targetItem.sidecarPath) {
        await moveTreeItemToFolder(sourceItem, targetItem.sidecarPath, {
            parentMapId: targetItem.metadata?.id || null,
            parentMapPath: targetItem.fullPath
        });
    }
}

function bindTreeRowDragAndDrop(row, node, item, isRoot = false) {
    if (!row || !node || !item || isRoot) return;

    row.draggable = true;

    row.addEventListener('dragstart', (event) => {
        if (
            event.target.closest('.tree-rename-input') ||
            event.target.closest('.tree-row-actions')
        ) {
            event.preventDefault();
            return;
        }

        const payload = cloneKediTreeDragItem(node.__kediItem || item);
        setKediTreeDragStateItem(payload);

        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-kedi-tree-item', JSON.stringify(payload));
        event.dataTransfer.setData('text/plain', payload.fullPath || '');

        row.classList.add('dragging');
    });

    row.addEventListener('dragend', () => {
        setKediTreeDragStateItem(null);
        row.classList.remove('dragging');
        document.querySelectorAll('.tree-row.drag-over').forEach((el) => {
            el.classList.remove('drag-over');
        });
        document.getElementById('file-tree')?.classList.remove('drag-over-root');
    });

    row.addEventListener('dragover', (event) => {
        const sourceItem = getKediTreeDragStateItem();
        const targetItem = node.__kediItem || item;

        if (!canDropTreeItemOnTarget(sourceItem, targetItem, node)) return;

        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        row.classList.add('drag-over');
    });

    row.addEventListener('dragleave', (event) => {
        if (!row.contains(event.relatedTarget)) {
            row.classList.remove('drag-over');
        }
    });

    row.addEventListener('drop', async (event) => {
        const sourceItem = getKediTreeDragStateItem();
        const targetItem = node.__kediItem || item;

        if (!canDropTreeItemOnTarget(sourceItem, targetItem, node)) return;

        event.preventDefault();
        event.stopPropagation();

        row.classList.remove('drag-over');
        await handleTreeDrop(sourceItem, targetItem, node);
    });
}

function bindFileTreeRootDropZone(treeEl) {
    if (!treeEl || treeEl.dataset.rootDropBound === '1') return;

    treeEl.dataset.rootDropBound = '1';

    treeEl.addEventListener('dragover', (event) => {
        const sourceItem = getKediTreeDragStateItem();

        if (!sourceItem?.fullPath || !window.currentProjectFolder) return;
        if (event.target.closest('.tree-row')) return;

        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        treeEl.classList.add('drag-over-root');
    });

    treeEl.addEventListener('dragleave', (event) => {
        if (!treeEl.contains(event.relatedTarget)) {
            treeEl.classList.remove('drag-over-root');
        }
    });

    treeEl.addEventListener('drop', async (event) => {
        const sourceItem = getKediTreeDragStateItem();

        if (!sourceItem?.fullPath || !window.currentProjectFolder) return;
        if (event.target.closest('.tree-row')) return;

        event.preventDefault();
        event.stopPropagation();

        treeEl.classList.remove('drag-over-root');
        await moveTreeItemToFolder(sourceItem, window.currentProjectFolder, {
            parentMapId: null,
            parentMapPath: null
        });
    });
}

async function createTreeNode(item, level = 0, isRoot = false) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.dataset.path = item.fullPath;
    node.dataset.level = String(level);

    node.__kediItem = item;

    if (item.metadata?.id) {
    node.dataset.kediId = item.metadata.id;
    }

    const row = document.createElement('div');
    row.className = isRoot ? 'tree-row tree-root-row' : 'tree-row';
    row.style.paddingLeft = `${level * 14 + 6}px`;
    row.title = isRoot ? '' : item.fullPath;

    const isMapFile = item.isFile && isMapFileName(item.name);
    const isNodeFile = item.isFile && isNodeFileName(item.name);
    const hasSyntheticChildren = Array.isArray(item.children) && item.children.length > 0;

    const canHaveChildren = item.isDirectory || isMapFile || hasSyntheticChildren;

    const name = document.createElement('span');
    name.className = isRoot ? 'tree-name tree-root-name' : 'tree-name';
    name.textContent = getTreeItemDisplayName(item);

    if (!isRoot) {
    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = canHaveChildren ? '▶' : '';

    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.textContent = item.isDirectory ? '📁' : getFileIcon(item.name);

    row.appendChild(toggle);
    row.appendChild(icon);
    }

    row.appendChild(name);

    if (isMapFile || isNodeFile) {
    const actions = document.createElement('div');
    actions.className = 'tree-row-actions';

    if (isMapFile) {
        const addNodeBtn = document.createElement('button');
        addNodeBtn.className = 'tree-inline-action-btn add-node-under-map-btn';
        addNodeBtn.title = 'Bu map altında node oluştur';

        addNodeBtn.innerHTML = `
            <img src="assets/add-node.png" alt="+" class="tree-action-img">
            <span class="tree-action-fallback">+</span>
        `;

        addNodeBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            await createNodeUnderMapFromTree(item, node);
        });

        actions.appendChild(addNodeBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'tree-inline-action-btn delete-tree-item-btn';
    deleteBtn.title = isMapFile ? 'Map sil' : 'Node sil';
    deleteBtn.innerHTML = `<span class="tree-action-fallback">×</span>`;

    deleteBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        await deleteTreeKediItem(item, node);
    });

    actions.appendChild(deleteBtn);
    row.appendChild(actions);
    }

    node.appendChild(row);

    bindTreeRowDragAndDrop(row, node, item, isRoot);

    if (canHaveChildren) {
        const children = document.createElement('div');
        children.className = 'tree-children';
        node.appendChild(children);

        const childFolderPath = item.isDirectory ? item.fullPath : null;
        
        async function toggleChildren() {
            const willExpand = !node.classList.contains('expanded');

            if (willExpand) {
                node.classList.add('expanded');
                expandedTreePaths.add(item.fullPath);

             if (children.dataset.loaded !== '1') {
            
                if (isMapFile) {
                await loadMapTreeChildren(item.fullPath, children, level + 1);
                    } else if (hasSyntheticChildren) {
                await loadSyntheticTreeChildren(item.children, children, level + 1);
                    } else if (childFolderPath) {
                await loadFolderChildren(childFolderPath, children, level + 1);
                }

                children.dataset.loaded = '1';
            }
            } else {

                node.classList.remove('expanded');
                expandedTreePaths.delete(item.fullPath);
            }
        }

        if (!isRoot) {
    row.addEventListener('click', async (event) => {
        if (event.target.closest('.tree-rename-input')) return;
        if (event.target.closest('.tree-row-actions')) return;

        if (!item.isDirectory) {
            selectTreeFile(item, row);

            if (typeof openKediFileTab === 'function') {
                await openKediFileTab(item);
            } else if (isMapFile) {
                await openMapInWorkspace(item);
            }
        }

        await toggleChildren();
    });
}

if (!isRoot) {
    row.addEventListener('dblclick', (event) => {
        if (event.target.closest('.tree-rename-input')) return;
        if (event.target.closest('.tree-row-actions')) return;

        event.preventDefault();
        event.stopPropagation();

        if (!item.isDirectory) {
            selectTreeFile(item, row);
            startRenameTreeFile(item, row);
        }
    });
}

        if (isRoot || expandedTreePaths.has(item.fullPath)) {
            node.classList.add('expanded');
            expandedTreePaths.add(item.fullPath);

            if (isMapFile) {
            await loadMapTreeChildren(item.fullPath, children, level + 1);
            children.dataset.loaded = '1';
        } else if (hasSyntheticChildren) {
            await loadSyntheticTreeChildren(item.children, children, level + 1);
            children.dataset.loaded = '1';
        } else if (childFolderPath) {
            await loadFolderChildren(childFolderPath, children, level + 1);
            children.dataset.loaded = '1';
        }
        }
    } else {
        row.addEventListener('click', async (event) => {

            if (event.target.closest('.tree-rename-input')) return;

            event.preventDefault();
            event.stopPropagation();

            selectTreeFile(item, row);
        
             if (!item.isDirectory && typeof openKediFileTab === 'function') {
                 await openKediFileTab(item);
                }
        });

        row.addEventListener('dblclick', (event) => {

            if (event.target.closest('.tree-rename-input')) return;

            event.preventDefault();
            event.stopPropagation();

            selectTreeFile(item, row);
            startRenameTreeFile(item, row);
        });
    }

    return node;
}

async function deleteTreeKediItem(item, treeNode) {
    if (!item || item.isDirectory) return;

    const isMapFile = isMapFileName(item.name);
    const isNodeFile = isNodeFileName(item.name);

    if (!isMapFile && !isNodeFile) return;

    const visibleName = getTreeItemDisplayName(item);
    const ok = confirm(`"${visibleName}" silinsin mi?`);

    if (!ok) return;

    try {
        suppressNextFileSystemRefresh(8000);

        const result = await window.kediProject?.deleteKediFile?.(item.fullPath);

        if (!result || !result.ok) {
            alert(result?.error || 'Dosya silinemedi.');
            return;
        }

        if (isMapFile) {
            await handleDeletedMapFromTree(item, treeNode);
            return;
        }

        if (isNodeFile) {
            await handleDeletedNodeFromTree(item, treeNode, result);
        }
    } catch (error) {
        console.error('[KEDI] Sol ağaç silme hatası:', error);
        alert('Silme sırasında hata oluştu: ' + error.message);
    }
}

async function handleDeletedMapFromTree(item, treeNode) {
    expandedTreePaths.delete(item.fullPath);

    if (selectedTreeItem?.item?.fullPath === item.fullPath) {
        selectedTreeItem = null;
    }

    treeNode?.remove();

    if (typeof removeKediOpenTabByPath === 'function') {
        await removeKediOpenTabByPath(item.fullPath);
        return;
    }

    if (activeMapPath === item.fullPath) {
        clearMapWorkspace();
    }
}

async function handleDeletedNodeFromTree(item, treeNode, result) {
    const deletedNodeId = result.deletedNodeId || item.metadata?.id || treeNode?.dataset.kediId;
    const parentMapPath = result.parentMapPath || null;

    if (selectedTreeItem?.item?.fullPath === item.fullPath) {
        selectedTreeItem = null;
    }

    // Eğer bu node şu an açık map'in içindeyse orta alanı da güncelle.
    const belongsToActiveMap =
        activeMapPath &&
        (
            parentMapPath === activeMapPath ||
            activeMapNodes.some((node) => {
                return node.fullPath === item.fullPath || node.id === deletedNodeId;
            })
        );

    if (belongsToActiveMap) {
        if (deletedNodeId) {
            const box = document.querySelector(
                `.map-node-box[data-node-id="${CSS.escape(deletedNodeId)}"]`
            );

            box?.remove();
        }

        activeMapNodes = activeMapNodes.filter((node) => {
            return node.fullPath !== item.fullPath && node.id !== deletedNodeId;
        });

        activeMapEdges = result.edges || activeMapEdges.filter((edge) => {
            return edge.sourceId !== deletedNodeId && edge.targetId !== deletedNodeId;
        });

        drawMapConnections();

        await refreshActiveMapTreeBranch();
        return;
    }

    // Standalone node ise veya aktif map içinde değilse sadece satırı kaldır.
    treeNode?.remove();
}

function findTreeNodeByPath(targetPath) {
    if (!targetPath) return null;

    const nodes = document.querySelectorAll('.tree-node');

    for (const node of nodes) {
        if (node.dataset.path === targetPath) {
            return node;
        }
    }

    return null;
}

function getDirectTreeChildrenContainer(treeNode) {
    if (!treeNode) return null;

    return Array.from(treeNode.children).find((child) => {
        return child.classList.contains('tree-children');
    });
}

function rememberExpandedPathsUnder(containerEl) {
    if (!containerEl) return;

    const expandedNodes = containerEl.querySelectorAll('.tree-node.expanded');

    expandedNodes.forEach((node) => {
        if (node.dataset.path) {
            expandedTreePaths.add(node.dataset.path);
        }
    });
}

async function refreshActiveMapTreeBranch() {
    if (!activeMapPath) return;

    const mapTreeNode = findTreeNodeByPath(activeMapPath);

    if (!mapTreeNode) {
        console.warn('[KEDI] Aktif map sol ağaçta bulunamadı.');
        return;
    }

    const children = getDirectTreeChildrenContainer(mapTreeNode);

    if (!children) {
        console.warn('[KEDI] Aktif map için tree-children bulunamadı.');
        return;
    }

    const mapLevel = Number(mapTreeNode.dataset.level || 0);

    // Map kapalıysa şimdi açmaya çalışma.
    // Sadece "sonraki açılışta yeniden yükle" işareti koy.
    if (!mapTreeNode.classList.contains('expanded')) {
        children.dataset.loaded = '0';
        return;
    }

    // Alt dallarda açık olan node'ları hatırla.
    rememberExpandedPathsUnder(children);

    // Sadece bu map'in altındaki node ağacını yeniden kur.
    await loadMapTreeChildren(activeMapPath, children, mapLevel + 1);

    children.dataset.loaded = '1';
}

function findTreeNodeByKediId(kediId) {
    if (!kediId) return null;

    return document.querySelector(
        `.tree-node[data-kedi-id="${CSS.escape(kediId)}"]`
    );
}

function getDirectTreeChildrenContainer(treeNode) {
    return Array.from(treeNode.children).find((child) => {
        return child.classList.contains('tree-children');
    });
}

function ensureTreeChildrenContainer(treeNode) {
    let children = getDirectTreeChildrenContainer(treeNode);

    if (!children) {
        children = document.createElement('div');
        children.className = 'tree-children';
        treeNode.appendChild(children);
    }

    return children;
}

function setTreeNodeLevelRecursive(treeNode, level) {
    treeNode.dataset.level = String(level);

    const row = Array.from(treeNode.children).find((child) => {
        return child.classList.contains('tree-row');
    });

    if (row) {
        row.style.paddingLeft = `${level * 14 + 6}px`;
    }

    const children = getDirectTreeChildrenContainer(treeNode);

    if (!children) return;

    const childTreeNodes = Array.from(children.children).filter((child) => {
        return child.classList.contains('tree-node');
    });

    for (const childTreeNode of childTreeNodes) {
        setTreeNodeLevelRecursive(childTreeNode, level + 1);
    }
}

function dedupeTreeNodeByKediId(kediId, keepNode) {
    const duplicates = document.querySelectorAll(
        `.tree-node[data-kedi-id="${CSS.escape(kediId)}"]`
    );

    duplicates.forEach((node) => {
        if (node !== keepNode) {
            node.remove();
        }
    });
}

function moveTreeNodeUnderParent(parentId, childId) {
    const parentTreeNode = findTreeNodeByKediId(parentId);
    const childTreeNode = findTreeNodeByKediId(childId);

    if (!parentTreeNode || !childTreeNode) {
        return false;
    }

    const parentLevel = Number(parentTreeNode.dataset.level || 0);
    const children = ensureTreeChildrenContainer(parentTreeNode);

    parentTreeNode.classList.add('expanded');
    expandedTreePaths.add(parentTreeNode.dataset.path);

    children.appendChild(childTreeNode);

    setTreeNodeLevelRecursive(childTreeNode, parentLevel + 1);
    dedupeTreeNodeByKediId(childId, childTreeNode);

    return true;
}

function updateTreeAfterSavedConnection(edge) {
    if (!edge) return;

    // Sadece hiyerarşik ilişki sol ağaçta hareket üretir.
    if (!isHierarchyEdge(edge)) {
        return;
    }

    const moved = moveTreeNodeUnderParent(edge.sourceId, edge.targetId);

    // Eğer DOM node henüz yoksa hiçbir şey yapma.
    // Bir sonraki manuel/normal ağaç açılışında zaten doğru kurulacak.
    if (!moved) {
        console.warn('[KEDI] Tree node DOM içinde bulunamadı. Full refresh yapılmadı.');
    }
}

async function refreshActiveMapTreeBranch() {
    if (!activeMapPath) return;

    const mapTreeNode = findTreeNodeByPath(activeMapPath);
    if (!mapTreeNode) return;

    const children = mapTreeNode.querySelector('.tree-children');
    if (!children) return;

    const mapLevel = Number(mapTreeNode.dataset.level || 0);

    // Map kapalıysa boşuna açıp çizme.
    if (!mapTreeNode.classList.contains('expanded')) {
        children.dataset.loaded = '0';
        return;
    }

    await loadMapTreeChildren(activeMapPath, children, mapLevel + 1);
    children.dataset.loaded = '1';
}

function animateTreeRow(row) {
    if (!row) return;

    row.classList.remove('just-created');

    // Animasyonu yeniden tetiklemek için reflow.
    void row.offsetWidth;

    row.classList.add('just-created');

    setTimeout(() => {
        row.classList.remove('just-created');
    }, 950);
}

async function appendTreeItemToContainer(containerEl, item, level) {
    if (!containerEl) return null;

    const childNode = await createTreeNode(item, level);
    containerEl.appendChild(childNode);

    const row = childNode.querySelector('.tree-row');
    animateTreeRow(row);

    return childNode;
}

function makeTreeItemFromCreateResult(result) {
    return {
        name: result.fileName,
        displayName: result.metadata?.title || result.displayName || result.fileName,
        fullPath: result.fullPath,
        type: 'file',
        isDirectory: false,
        isFile: true,
        metadata: result.metadata || null,
        sidecarPath: result.sidecarPath || null
    };
}

function updateTreeItemAfterRename(oldPath, result) {
    if (!oldPath || !result || !result.ok) return;

    const treeNode = findTreeNodeByPath(oldPath);
    if (!treeNode) return;

    const displayName =
        result.metadata?.title ||
        result.displayName ||
        result.fileName;

    treeNode.dataset.path = result.fullPath;

    if (result.metadata?.id) {
        treeNode.dataset.kediId = result.metadata.id;
    }

    const row = treeNode.querySelector('.tree-row');
    const nameEl = treeNode.querySelector('.tree-name');

    if (row) {
        row.title = result.fullPath;
    }

    if (nameEl) {
        nameEl.textContent = displayName;
    }

    // Asıl düzeltme burada:
    // Sol ağaç satırının yaşayan item objesini de güncelliyoruz.
    const currentItem = treeNode.__kediItem || {};

    currentItem.name = result.fileName;
    currentItem.displayName = displayName;
    currentItem.fullPath = result.fullPath;
    currentItem.metadata = result.metadata || currentItem.metadata;
    currentItem.sidecarPath = result.sidecarPath || currentItem.sidecarPath;
    currentItem.type = currentItem.type || 'file';
    currentItem.isFile = true;
    currentItem.isDirectory = false;

    treeNode.__kediItem = currentItem;

    if (selectedTreeItem?.item?.fullPath === oldPath) {
        selectedTreeItem.item = currentItem;
        selectedTreeItem.row = row || selectedTreeItem.row;
    }

    animateTreeRow(row);
}

function normalizeClientPath(filePath) {
    return String(filePath || '')
        .replace(/[\\/]+/g, '/')
        .toLowerCase();
}

function sameClientPath(a, b) {
    return normalizeClientPath(a) === normalizeClientPath(b);
}

function findMapNodeBoxByPath(nodePath) {
    const boxes = document.querySelectorAll('.map-node-box');

    for (const box of boxes) {
        if (sameClientPath(box.dataset.nodePath, nodePath)) {
            return box;
        }
    }

    return null;
}

function animateMapBox(box) {
    if (!box) return;

    box.classList.remove('just-updated');
    void box.offsetWidth;
    box.classList.add('just-updated');

    setTimeout(() => {
        box.classList.remove('just-updated');
    }, 700);
}

function updateOpenMapNodeAfterRename(oldPath, result) {
    if (!result || !result.ok) return;

    const box = findMapNodeBoxByPath(oldPath);

    if (box) {
        box.dataset.nodePath = result.fullPath;

        const titleEl = box.querySelector('.map-node-title');

        if (titleEl) {
            const title = result.metadata?.title || result.fileName.replace(/\.node$/i, '');
            titleEl.textContent = title;
            titleEl.title = title;
        }

        animateMapBox(box);
    }

    const activeNode = activeMapNodes.find((node) => sameClientPath(node.fullPath, oldPath));

    if (activeNode) {
        activeNode.fullPath = result.fullPath;
        activeNode.fileName = result.fileName;
        activeNode.metadata = result.metadata || activeNode.metadata;
    }
}

function updateMapBoxAfterRename(box, result) {
    if (!box || !result || !result.ok) return;

    box.dataset.nodePath = result.fullPath;

    const titleEl = box.querySelector('.map-node-title');

    if (titleEl) {
        titleEl.textContent = result.metadata?.title || result.fileName.replace(/\.node$/i, '');
        titleEl.title = titleEl.textContent;
    }

    animateTreeRow(box);
}

function appendMapNodeBox(node) {
    const board = document.getElementById('map-board');
    if (!board || !node) return;

    const box = createMapNodeBox(node);
    board.appendChild(box);

    box.classList.add('selected');
    setTimeout(() => box.classList.remove('selected'), 900);

    drawMapConnections();
}

async function createNodeUnderMapFromTree(mapItem, mapNodeEl) {
    if (!mapItem || !isMapFileName(mapItem.name)) {
        return;
    }

    suppressNextFileSystemRefresh(1500);

    const result = await window.kediProject?.createNodeUnderMap?.(mapItem.fullPath);

    if (!result || !result.ok) {
        alert(result?.error || 'Map altında node oluşturulamadı.');
        return;
    }

    expandedTreePaths.add(mapItem.fullPath);

    const children = mapNodeEl.querySelector('.tree-children');
    const mapLevel = Number(mapNodeEl.dataset.level || 0);

    if (children) {
        mapNodeEl.classList.add('expanded');

        await loadMapTreeChildren(mapItem.fullPath, children, mapLevel + 1);

        children.dataset.loaded = '1';
    }

    // Full map reload yok.
    // Eğer bu map zaten ortada açıksa sadece yeni kutuyu ekle.
    if (activeMapPath === mapItem.fullPath && result.node) {
        appendMapNodeBox(result.node);
    }
}

function selectTreeFile(item, row) {
    document.querySelectorAll('.tree-row.selected').forEach((el) => {
        el.classList.remove('selected');
    });

    row.classList.add('selected');

    selectedTreeItem = {
        item,
        row
    };
}

function getEditableBaseName(fileName) {
    const lower = fileName.toLowerCase();

    if (lower.endsWith('.node')) {
        return fileName.slice(0, -'.node'.length);
    }

    if (lower.endsWith('.map')) {
        return fileName.slice(0, -'.map'.length);
    }

    return fileName;
}

function startRenameSelectedTreeFile() {
    if (!selectedTreeItem) return;

    startRenameTreeFile(selectedTreeItem.item, selectedTreeItem.row);
}

function startRenameTreeFile(item, row) {
    const treeNode = row?.closest('.tree-node');

    // Eğer bu satır daha önce rename ile güncellendiyse,
    // event listener içindeki eski item yerine DOM'a bağlı güncel item'ı kullan.
    if (treeNode?.__kediItem) {
        item = treeNode.__kediItem;
    }

    if (!item || item.isDirectory) return;

    const nameSpan = row.querySelector('.tree-name');
    if (!nameSpan) return;

    if (row.dataset.renaming === '1') return;
    row.dataset.renaming = '1';

    const oldPath = item.fullPath;
    console.log('[KEDI] Rename input title:', getTreeItemDisplayName(item), item);
    const oldBaseName = getTreeItemDisplayName(item);
    const oldName = oldBaseName;

    const input = document.createElement('input');
    input.className = 'tree-rename-input';
    input.value = oldBaseName;

    nameSpan.replaceWith(input);

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

    input.focus();
    input.select();

    let finished = false;

    function restoreName(text = oldName) {
        const span = document.createElement('span');
        span.className = 'tree-name';
        span.textContent = text;

        if (input.isConnected) {
            input.replaceWith(span);
        }

        row.dataset.renaming = '0';
    }

    async function finishRename(commit) {
        if (finished) return;
        finished = true;

        try {
            const newBaseName = input.value.trim();

            if (!commit || !newBaseName || newBaseName === oldBaseName) {
                restoreName(oldName);
                return;
            }

            suppressNextFileSystemRefresh(1500);

            const result = await window.kediProject?.renameKediFile?.(
                oldPath,
                newBaseName
            );

            if (!result || !result.ok) {
                alert(result?.error || 'İsim değiştirilemedi.');
                restoreName(oldName);
                return;
            }

            item.name = result.fileName;
            item.displayName = result.metadata?.title || result.displayName || result.fileName;
            item.fullPath = result.fullPath;
            item.metadata = result.metadata || item.metadata;
            item.sidecarPath = result.sidecarPath || item.sidecarPath;

            const nodeEl = row.closest('.tree-node');
            if (nodeEl) {
                nodeEl.dataset.path = result.fullPath;
            }

            row.title = result.fullPath;

            restoreName(result.metadata?.title || result.displayName || result.fileName);
            
            updateTreeItemAfterRename(oldPath, result);
            updateOpenMapNodeAfterRename(oldPath, result);

            if (typeof updateKediOpenTabAfterRename === 'function') {
            updateKediOpenTabAfterRename(oldPath, result);
            }

            animateTreeRow(row);
        } catch (error) {
            console.error('[KEDI] Rename sırasında hata:', error);
            alert('İsim değiştirilemedi: ' + error.message);
            restoreName(oldName);
        } finally {
            row.dataset.renaming = '0';
        }
    }

    input.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            await finishRename(true);
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            await finishRename(false);
        }
    });

    input.addEventListener('blur', async () => {
        await finishRename(true);
    });
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'F2') {
        event.preventDefault();
        startRenameSelectedTreeFile();
    }
});

async function loadFolderChildren(folderPath, containerEl, level) {
    containerEl.innerHTML = '';

    const result = await window.kediProject?.listFolder?.(folderPath);

    if (!result || !result.ok) {
        const errorRow = document.createElement('div');
        errorRow.className = 'tree-row';
        errorRow.style.paddingLeft = `${level * 14 + 6}px`;
        errorRow.textContent = '⚠️ ' + (result?.error || 'Klasör okunamadı');
        containerEl.appendChild(errorRow);
        return;
    }

    for (const item of result.items) {
        const childNode = await createTreeNode(item, level);
        containerEl.appendChild(childNode);
    }
}

function makeTreeItemFromMapNode(mapNode, children = []) {
    return {
        name: mapNode.fileName,
        displayName: mapNode.metadata?.title || mapNode.fileName.replace(/\.node$/i, ''),
        fullPath: mapNode.fullPath,
        type: 'file',
        isDirectory: false,
        isFile: true,
        metadata: mapNode.metadata || null,
        sidecarPath: mapNode.metadata?.sidecar || null,
        children
    };
}

function getTreeRolesFromEdge(edge) {
    if (edge.sourceRole && edge.targetRole) {
        return {
            sourceRole: edge.sourceRole,
            targetRole: edge.targetRole
        };
    }

    // Eski kayıtlar için fallback.
    if (edge.type === 'co-level' || edge.type === 'colevel') {
        return {
            sourceRole: 'co-level',
            targetRole: 'co-level'
        };
    }

    if (edge.type === 'stream') {
        return {
            sourceRole: 'downstream',
            targetRole: 'upstream'
        };
    }

    return {
        sourceRole: 'down-hub',
        targetRole: 'up-hub'
    };
}

function buildMapNodeTreeItems(nodes = [], edges = []) {
    const nodeById = new Map();
    const childrenByParentId = new Map();
    const childIds = new Set();
    const parentByChildId = new Map();

    for (const node of nodes) {
        if (!node?.id) continue;

        nodeById.set(node.id, node);
        childrenByParentId.set(node.id, []);
    }

    for (const edge of edges) {
        const { sourceRole, targetRole } = getTreeRolesFromEdge(edge);

        let parentId = null;
        let childId = null;

        // Sol ağaçta SADECE down-hub -> up-hub hiyerarşi üretir.
        if (sourceRole === 'down-hub' && targetRole === 'up-hub') {
            parentId = edge.sourceId;
            childId = edge.targetId;
        }

        // Eski/ters kayıtlar için güvenlik.
        if (sourceRole === 'up-hub' && targetRole === 'down-hub') {
            parentId = edge.targetId;
            childId = edge.sourceId;
        }

        if (!parentId || !childId) {
            continue;
        }

        if (!nodeById.has(parentId) || !nodeById.has(childId)) {
            continue;
        }

        // Kritik kural:
        // Bir child node sol ağaçta sadece bir parent altında görünebilir.
        // Eğer eski bozuk map kayıtlarında aynı child ikinci kez parent aldıysa,
        // tree tarafında ikinci parent yok sayılır.
        if (parentByChildId.has(childId)) {
            continue;
        }

        parentByChildId.set(childId, parentId);

        const children = childrenByParentId.get(parentId);

        if (!children.includes(childId)) {
            children.push(childId);
        }

        childIds.add(childId);
    }

    const makeItemRecursive = (nodeId, visited = new Set()) => {
        if (visited.has(nodeId)) {
            return null;
        }

        visited.add(nodeId);

        const node = nodeById.get(nodeId);
        if (!node) return null;

        const childItems = (childrenByParentId.get(nodeId) || [])
            .map((childId) => makeItemRecursive(childId, new Set(visited)))
            .filter(Boolean);

        return makeTreeItemFromMapNode(node, childItems);
    };

    return nodes
        .filter((node) => node?.id && !childIds.has(node.id))
        .map((node) => makeItemRecursive(node.id))
        .filter(Boolean);
}

async function loadSyntheticTreeChildren(items, containerEl, level) {
    containerEl.innerHTML = '';

    for (const item of items) {
        const childNode = await createTreeNode(item, level);
        containerEl.appendChild(childNode);
    }
}

async function loadMapTreeChildren(mapPath, containerEl, level) {
    try {
        const result = await window.kediProject?.listMapNodes?.(mapPath);

        if (!result || !result.ok) {
            containerEl.innerHTML = '';

            const errorRow = document.createElement('div');
            errorRow.className = 'tree-row';
            errorRow.style.paddingLeft = `${level * 14 + 6}px`;
            errorRow.textContent = '⚠️ ' + (result?.error || 'Map node listesi okunamadı');

            containerEl.appendChild(errorRow);
            return;
        }

        const treeItems = buildMapNodeTreeItems(
            result.nodes || [],
            result.edges || []
        );

        // Buraya kadar hata yoksa eski görünümü temizle.
        containerEl.innerHTML = '';

        for (const item of treeItems) {
            const childNode = await createTreeNode(item, level);
            containerEl.appendChild(childNode);
        }

    } catch (error) {
        console.error('[KEDI] Map tree yüklenirken hata:', error);

        containerEl.innerHTML = '';

        const errorRow = document.createElement('div');
        errorRow.className = 'tree-row';
        errorRow.style.paddingLeft = `${level * 14 + 6}px`;
        errorRow.textContent = '⚠️ Map tree hatası: ' + error.message;

        containerEl.appendChild(errorRow);
    }
}
