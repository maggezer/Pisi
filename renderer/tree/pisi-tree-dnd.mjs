import { registerModule } from '../core/module-registry.mjs';

const PISI_TREE_FILE_CLICK_DELAY_MS = 280;
let pendingPisiTreeFileClick = null;

function cancelPendingPisiTreeFileClick() {
    if (!pendingPisiTreeFileClick) return false;

    clearTimeout(pendingPisiTreeFileClick.timer);
    pendingPisiTreeFileClick = null;
    return true;
}

function schedulePisiTreeFileClick(item, row) {
    cancelPendingPisiTreeFileClick();

    const pending = {
        row,
        timer: null
    };

    pending.timer = setTimeout(async () => {
        if (pendingPisiTreeFileClick !== pending) return;
        pendingPisiTreeFileClick = null;

        const treeNode = row?.closest?.('.tree-node');
        const currentItem = treeNode?.__pisiItem || item;

        if (!row?.isConnected || row.dataset.renaming === '1' || !currentItem || currentItem.isDirectory) {
            return;
        }

        try {
            selectTreeFile(currentItem, row);

            if (typeof openPisiFileTab === 'function') {
                await openPisiFileTab(currentItem);
            } else if (isMapFileName(currentItem.name || currentItem.fileName)) {
                await openMapInWorkspace(currentItem);
            }
        } catch (error) {
            console.error('[PISI] Ağaç öğesi açılamadı:', error);
        }
    }, PISI_TREE_FILE_CLICK_DELAY_MS);

    pendingPisiTreeFileClick = pending;
}

function getPisiTreeDragStateItem() {
    return window.Pisi?.state?.treeDragItem || null;
}

function setPisiTreeDragStateItem(item) {
    if (!window.Pisi) {
        window.Pisi = { state: {} };
    }

    if (!window.Pisi.state) {
        window.Pisi.state = {};
    }

    window.Pisi.state.treeDragItem = item || null;
}

function clonePisiTreeDragItem(item) {
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
    const parts = String(filePath || '')
        .split(/[\\/]/)
        .filter(Boolean);
    return parts[parts.length - 1] || '';
}

function getAncestorMapItemForTreeNode(treeNode) {
    let current = treeNode;

    while (current) {
        const item = current.__pisiItem;

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

    suppressNextFileSystemRefresh(3000);

    const result = await window.pisiProject?.reparentMapNode?.(mapItem.fullPath, childId, parentId);

    if (!result?.ok) {
        pisiNotifyError(result?.error || 'Not taşınamadı.');
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

    if (typeof flushPisiPendingSaves === 'function') {
        const saved = await flushPisiPendingSaves();
        if (!saved) return false;
    }

    suppressNextFileSystemRefresh(5000);

    const result = await window.pisiProject?.movePisiItem?.(sourceItem.fullPath, destinationFolderPath, options);

    if (!result?.ok) {
        pisiNotifyError(result?.error || 'Öğe taşınamadı.');
        return false;
    }

    if (typeof updatePisiOpenTabAfterRename === 'function' && result.isFile) {
        updatePisiOpenTabAfterRename(sourceItem.fullPath, result);
    } else if (Array.isArray(result.pathChanges) && typeof applyPisiPathChanges === 'function') {
        applyPisiPathChanges(result.pathChanges);
    }

    if (activeCenterNode?.path && result.fullPath && sameClientPath(activeCenterNode.path, sourceItem.fullPath)) {
        activeCenterNode.path = result.fullPath;
        activeCenterNode.metadata = result.metadata || activeCenterNode.metadata;
    }

    await refreshCurrentProjectTree();

    const affectedOpenMap =
        activeMapPath &&
        (sameClientPath(activeMapPath, result.parentMapPath) ||
            sameClientPath(activeMapPath, result.oldParentMapPath) ||
            sameClientPath(activeMapPath, sourceItem.fullPath));

    if (affectedOpenMap && typeof openMapInWorkspace === 'function') {
        const mapPath = activeMapPath;
        const mapTreeNode = findTreeNodeByPath(mapPath);
        const mapItem = mapTreeNode?.__pisiItem || {
            name: getClientPathBaseName(mapPath),
            fullPath: mapPath,
            isFile: true,
            isDirectory: false,
            metadata: {}
        };

        await openMapInWorkspace(mapItem);
    }

    return true;
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
        if (event.target.closest('.tree-rename-input') || event.target.closest('.tree-row-actions')) {
            event.preventDefault();
            return;
        }

        const payload = clonePisiTreeDragItem(node.__pisiItem || item);
        setPisiTreeDragStateItem(payload);

        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-pisi-tree-item', JSON.stringify(payload));
        event.dataTransfer.setData('text/plain', payload.fullPath || '');

        row.classList.add('dragging');
    });

    row.addEventListener('dragend', () => {
        setPisiTreeDragStateItem(null);
        row.classList.remove('dragging');
        document.querySelectorAll('.tree-row.drag-over').forEach((el) => {
            el.classList.remove('drag-over');
        });
        document.getElementById('file-tree')?.classList.remove('drag-over-root');
    });

    row.addEventListener('dragover', (event) => {
        const sourceItem = getPisiTreeDragStateItem();
        const targetItem = node.__pisiItem || item;

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
        const sourceItem = getPisiTreeDragStateItem();
        const targetItem = node.__pisiItem || item;

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
        const sourceItem = getPisiTreeDragStateItem();

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
        const sourceItem = getPisiTreeDragStateItem();

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

    node.__pisiItem = item;

    if (item.metadata?.id) {
        node.dataset.pisiId = item.metadata.id;
    }

    const row = document.createElement('div');
    row.className = isRoot ? 'tree-row tree-root-row' : 'tree-row';
    row.style.paddingLeft = `${level * 14 + 6}px`;
    row.title = isRoot ? '' : item.fullPath;
    row.setAttribute('role', 'treeitem');
    row.tabIndex = isRoot ? -1 : 0;

    const isMapFile = item.isFile && isMapFileName(item.name);
    const isNodeFile = item.isFile && isNodeFileName(item.name);
    const hasSyntheticChildren = Array.isArray(item.children) && item.children.length > 0;

    const canHaveChildren = item.isDirectory || isMapFile || hasSyntheticChildren;
    if (canHaveChildren) {
        row.setAttribute('aria-expanded', 'false');
    }

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

            await deleteTreePisiItem(item, node);
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
                row.setAttribute('aria-expanded', 'true');

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
                row.setAttribute('aria-expanded', 'false');
            }
        }

        const toggleControl = row.querySelector('.tree-toggle');
        toggleControl?.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            cancelPendingPisiTreeFileClick();
            await toggleChildren();
        });
        toggleControl?.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        if (!isRoot) {
            row.addEventListener('keydown', async (event) => {
                if (event.target.closest('button, input')) return;

                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    row.click();
                    return;
                }

                if (event.key === 'ArrowRight' && !node.classList.contains('expanded')) {
                    event.preventDefault();
                    await toggleChildren();
                    return;
                }

                if (event.key === 'ArrowLeft' && node.classList.contains('expanded')) {
                    event.preventDefault();
                    await toggleChildren();
                    return;
                }

                if (event.key === 'F2' && !item.isDirectory) {
                    event.preventDefault();
                    cancelPendingPisiTreeFileClick();
                    startRenameTreeFile(item, row);
                    return;
                }

                if (event.key === 'Delete' && (isMapFile || isNodeFile)) {
                    event.preventDefault();
                    await deleteTreePisiItem(item, node);
                }
            });
        }

        if (!isRoot) {
            row.addEventListener('click', async (event) => {
                if (event.target.closest('.tree-rename-input')) return;
                if (event.target.closest('.tree-row-actions')) return;
                if (event.target.closest('.tree-toggle')) return;

                event.preventDefault();
                event.stopPropagation();

                if (!item.isDirectory) {
                    selectTreeFile(item, row);

                    if (event.detail > 1) {
                        cancelPendingPisiTreeFileClick();
                        return;
                    }

                    schedulePisiTreeFileClick(item, row);
                    return;
                }

                await toggleChildren();
            });
        }

        if (!isRoot) {
            row.addEventListener('dblclick', (event) => {
                if (event.target.closest('.tree-rename-input')) return;
                if (event.target.closest('.tree-row-actions')) return;
                if (event.target.closest('.tree-toggle')) return;

                event.preventDefault();
                event.stopPropagation();
                cancelPendingPisiTreeFileClick();

                if (!item.isDirectory) {
                    selectTreeFile(item, row);
                    startRenameTreeFile(item, row);
                }
            });
        }

        if (isRoot || expandedTreePaths.has(item.fullPath)) {
            node.classList.add('expanded');
            expandedTreePaths.add(item.fullPath);
            row.setAttribute('aria-expanded', 'true');

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

            if (event.detail > 1) {
                cancelPendingPisiTreeFileClick();
                return;
            }

            schedulePisiTreeFileClick(item, row);
        });

        row.addEventListener('dblclick', (event) => {
            if (event.target.closest('.tree-rename-input')) return;

            event.preventDefault();
            event.stopPropagation();
            cancelPendingPisiTreeFileClick();

            selectTreeFile(item, row);
            startRenameTreeFile(item, row);
        });
    }

    return node;
}

async function deleteTreePisiItem(item, treeNode) {
    if (!item || item.isDirectory) return;

    cancelPendingPisiTreeFileClick();

    const isMapFile = isMapFileName(item.name);
    const isNodeFile = isNodeFileName(item.name);

    if (!isMapFile && !isNodeFile) return;

    const visibleName = getTreeItemDisplayName(item);
    let childNodeCount = 0;

    if (isMapFile) {
        const listResult = await window.pisiProject?.listMapNodes?.(item.fullPath);
        childNodeCount = Array.isArray(listResult?.nodes) ? listResult.nodes.length : 0;
    }

    const confirmationMessage = isMapFile
        ? `"${visibleName}" haritası ve içindeki ${childNodeCount} not Çöp Kutusu'na taşınsın mı?`
        : `"${visibleName}" notu Çöp Kutusu'na taşınsın mı?`;
    const ok = await pisiConfirm(confirmationMessage, {
        title: isMapFile ? 'Haritayı sil' : 'Notu sil',
        confirmText: 'Çöp Kutusu’na taşı',
        danger: true
    });

    if (!ok) return;

    try {
        const centerWasExactTarget = Boolean(
            isNodeFile && typeof activeCenterNode !== 'undefined' && activeCenterNode?.path && sameClientPath(activeCenterNode.path, item.fullPath)
        );
        const modalWasExactTarget = Boolean(
            isNodeFile && typeof activeModalNode !== 'undefined' && activeModalNode?.path && sameClientPath(activeModalNode.path, item.fullPath)
        );
        const modalTargetBox = modalWasExactTarget ? activeModalNode?.box || null : null;

        if (typeof flushPisiPendingSaves === 'function') {
            const saved = await flushPisiPendingSaves();

            if (!saved) return;
        }

        let deletePath = item.fullPath;

        if (centerWasExactTarget && typeof activeCenterNode !== 'undefined' && activeCenterNode?.path) {
            deletePath = activeCenterNode.path;
        } else if (modalWasExactTarget && modalTargetBox?.dataset?.nodePath) {
            deletePath = modalTargetBox.dataset.nodePath;
        }

        const liveTreeNode = findTreeNodeByPath(deletePath);

        if (liveTreeNode) {
            treeNode = liveTreeNode;
            item = liveTreeNode.__pisiItem || {
                ...item,
                fullPath: deletePath
            };
        } else if (!sameClientPath(deletePath, item.fullPath)) {
            item = {
                ...item,
                fullPath: deletePath
            };
        }

        suppressNextFileSystemRefresh(8000);

        const result = await window.pisiProject?.deletePisiFile?.(item.fullPath);

        if (!result || !result.ok) {
            pisiNotifyError(result?.error || 'Dosya silinemedi.');
            return;
        }

        if (isMapFile) {
            await handleDeletedMapFromTree(item, treeNode, result);
            return;
        }

        if (isNodeFile) {
            await handleDeletedNodeFromTree(item, treeNode, result);
        }
    } catch (error) {
        console.error('[PISI] Sol ağaç silme hatası:', error);
        pisiNotifyError('Silme sırasında hata oluştu.', { detail: error?.message });
    }
}

async function handleDeletedMapFromTree(item, treeNode, result = {}) {
    expandedTreePaths.delete(item.fullPath);

    if (sameClientPath(selectedTreeItem?.item?.fullPath, item.fullPath)) {
        selectedTreeItem = null;
    }

    treeNode?.remove();

    if (typeof removePisiOpenTabsForDeletedPaths === 'function') {
        await removePisiOpenTabsForDeletedPaths([
            item.fullPath,
            result.deletedSidecarPath || item.sidecarPath,
            ...(Array.isArray(result.childNodePaths) ? result.childNodePaths : [])
        ]);
        return;
    }

    if (sameClientPath(activeMapPath, item.fullPath)) {
        clearMapWorkspace();
    }
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    getPisiTreeDragStateItem: {
        enumerable: true,
        get() {
            return getPisiTreeDragStateItem;
        }
    },
    setPisiTreeDragStateItem: {
        enumerable: true,
        get() {
            return setPisiTreeDragStateItem;
        }
    },
    clonePisiTreeDragItem: {
        enumerable: true,
        get() {
            return clonePisiTreeDragItem;
        }
    },
    getClientPathBaseName: {
        enumerable: true,
        get() {
            return getClientPathBaseName;
        }
    },
    getAncestorMapItemForTreeNode: {
        enumerable: true,
        get() {
            return getAncestorMapItemForTreeNode;
        }
    },
    isTreeDropInsideDraggedNode: {
        enumerable: true,
        get() {
            return isTreeDropInsideDraggedNode;
        }
    },
    canDropTreeItemOnTarget: {
        enumerable: true,
        get() {
            return canDropTreeItemOnTarget;
        }
    },
    reparentMapNodeFromTreeDrop: {
        enumerable: true,
        get() {
            return reparentMapNodeFromTreeDrop;
        }
    },
    moveTreeItemToFolder: {
        enumerable: true,
        get() {
            return moveTreeItemToFolder;
        }
    },
    handleTreeDrop: {
        enumerable: true,
        get() {
            return handleTreeDrop;
        }
    },
    bindTreeRowDragAndDrop: {
        enumerable: true,
        get() {
            return bindTreeRowDragAndDrop;
        }
    },
    bindFileTreeRootDropZone: {
        enumerable: true,
        get() {
            return bindFileTreeRootDropZone;
        }
    },
    createTreeNode: {
        enumerable: true,
        get() {
            return createTreeNode;
        }
    },
    deleteTreePisiItem: {
        enumerable: true,
        get() {
            return deleteTreePisiItem;
        }
    },
    handleDeletedMapFromTree: {
        enumerable: true,
        get() {
            return handleDeletedMapFromTree;
        }
    }
});
registerModule('tree.dragDrop', moduleApi);
