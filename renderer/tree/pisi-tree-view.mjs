import { registerModule } from "../core/module-registry.mjs";

async function handleDeletedNodeFromTree(item, treeNode, result) {
    const deletedNodeId = result.deletedNodeId || item.metadata?.id || treeNode?.dataset.pisiId;
    const parentMapPath = result.parentMapPath || null;

    if (sameClientPath(selectedTreeItem?.item?.fullPath, item.fullPath)) {
        selectedTreeItem = null;
    }

    if (typeof removePisiOpenTabsForDeletedPaths === 'function') {
        await removePisiOpenTabsForDeletedPaths([item.fullPath]);
    }

    // Eğer bu node şu an açık map'in içindeyse orta alanı da güncelle.
    const belongsToActiveMap =
        activeMapPath &&
        (
            sameClientPath(parentMapPath, activeMapPath) ||
            activeMapNodes.some((node) => {
                return (
                    sameClientPath(node.fullPath, item.fullPath) ||
                    node.id === deletedNodeId
                );
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
            return (
                !sameClientPath(node.fullPath, item.fullPath) &&
                node.id !== deletedNodeId
            );
        });

        activeMapEdges = result.edges || activeMapEdges.filter((edge) => {
            return edge.sourceId !== deletedNodeId && edge.targetId !== deletedNodeId;
        });

        drawMapConnections();

        await refreshActiveMapTreeBranch();
    } else {
        treeNode?.remove();
    }
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
        console.warn('[PISI] Aktif map sol ağaçta bulunamadı.');
        return;
    }

    const children = getDirectTreeChildrenContainer(mapTreeNode);

    if (!children) {
        console.warn('[PISI] Aktif map için tree-children bulunamadı.');
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

function findTreeNodeByPisiId(pisiId) {
    if (!pisiId) return null;

    return document.querySelector(
        `.tree-node[data-pisi-id="${CSS.escape(pisiId)}"]`
    );
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

function dedupeTreeNodeByPisiId(pisiId, keepNode) {
    const duplicates = document.querySelectorAll(
        `.tree-node[data-pisi-id="${CSS.escape(pisiId)}"]`
    );

    duplicates.forEach((node) => {
        if (node !== keepNode) {
            node.remove();
        }
    });
}

function moveTreeNodeUnderParent(parentId, childId) {
    const parentTreeNode = findTreeNodeByPisiId(parentId);
    const childTreeNode = findTreeNodeByPisiId(childId);

    if (!parentTreeNode || !childTreeNode) {
        return false;
    }

    const parentLevel = Number(parentTreeNode.dataset.level || 0);
    const children = ensureTreeChildrenContainer(parentTreeNode);

    parentTreeNode.classList.add('expanded');
    expandedTreePaths.add(parentTreeNode.dataset.path);

    children.appendChild(childTreeNode);

    setTreeNodeLevelRecursive(childTreeNode, parentLevel + 1);
    dedupeTreeNodeByPisiId(childId, childTreeNode);

    return true;
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
        treeNode.dataset.pisiId = result.metadata.id;
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
    const currentItem = treeNode.__pisiItem || {};

    currentItem.name = result.fileName;
    currentItem.displayName = displayName;
    currentItem.fullPath = result.fullPath;
    currentItem.metadata = result.metadata || currentItem.metadata;
    currentItem.sidecarPath = result.sidecarPath || currentItem.sidecarPath;
    currentItem.type = currentItem.type || 'file';
    currentItem.isFile = true;
    currentItem.isDirectory = false;

    treeNode.__pisiItem = currentItem;

    if (sameClientPath(selectedTreeItem?.item?.fullPath, oldPath)) {
        selectedTreeItem.item = currentItem;
        selectedTreeItem.row = row || selectedTreeItem.row;
    }

    animateTreeRow(row);
}

function normalizeClientPath(filePath) {
    const normalized = String(filePath || '')
        .replace(/[\\/]+/g, '/');

    return window.pisiEnvironment?.platform === 'win32'
        ? normalized.toLowerCase()
        : normalized;
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

    const result = await window.pisiProject?.createNodeUnderMap?.(mapItem.fullPath);

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

function startRenameSelectedTreeFile() {
    if (!selectedTreeItem) return;

    startRenameTreeFile(selectedTreeItem.item, selectedTreeItem.row);
}

function startRenameTreeFile(item, row) {
    const treeNode = row?.closest('.tree-node');

    // Eğer bu satır daha önce rename ile güncellendiyse,
    // event listener içindeki eski item yerine DOM'a bağlı güncel item'ı kullan.
    if (treeNode?.__pisiItem) {
        item = treeNode.__pisiItem;
    }

    if (!item || item.isDirectory) return;

    const nameSpan = row.querySelector('.tree-name');
    if (!nameSpan) return;

    if (row.dataset.renaming === '1') return;
    row.dataset.renaming = '1';

    const oldPath = item.fullPath;
    console.log('[PISI] Rename input title:', getTreeItemDisplayName(item), item);
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

            if (typeof flushPisiPendingSaves === 'function') {
                const saved = await flushPisiPendingSaves();
                if (!saved) {
                    restoreName(oldName);
                    return;
                }
            }

            const renameSourcePath = item.fullPath || oldPath;
            suppressNextFileSystemRefresh(1500);

            const result = await window.pisiProject?.renamePisiFile?.(
                renameSourcePath,
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
            
            updateTreeItemAfterRename(renameSourcePath, result);
            updateOpenMapNodeAfterRename(renameSourcePath, result);

            if (typeof updatePisiOpenTabAfterRename === 'function') {
            updatePisiOpenTabAfterRename(renameSourcePath, result);
            }

            animateTreeRow(row);
        } catch (error) {
            console.error('[PISI] Rename sırasında hata:', error);
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

async function loadFolderChildren(
    folderPath,
    containerEl,
    level,
    rootRender = null
) {
    const rootRenderIsCurrent = () => {
        return (
            !rootRender ||
            isCurrentPisiTreeRootRender(
                rootRender.renderId,
                rootRender.rootPath
            )
        );
    };

    if (!rootRenderIsCurrent()) return false;

    const result = await window.pisiProject?.listFolder?.(folderPath);
    if (!rootRenderIsCurrent()) return false;

    if (!result || !result.ok) {
        const fragment = document.createDocumentFragment();
        const errorRow = document.createElement('div');
        errorRow.className = 'tree-row';
        errorRow.style.paddingLeft = `${level * 14 + 6}px`;
        errorRow.textContent = '⚠️ ' + (result?.error || 'Klasör okunamadı');
        fragment.appendChild(errorRow);
        containerEl.replaceChildren(fragment);
        return false;
    }

    const fragment = document.createDocumentFragment();

    for (const item of result.items) {
        const childNode = await createTreeNode(item, level);
        if (!rootRenderIsCurrent()) return false;
        fragment.appendChild(childNode);
    }

    containerEl.replaceChildren(fragment);
    return true;
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

        let ancestorId = parentId;
        const ancestorGuard = new Set();
        let createsCycle = false;

        while (ancestorId && !ancestorGuard.has(ancestorId)) {
            if (ancestorId === childId) {
                createsCycle = true;
                break;
            }

            ancestorGuard.add(ancestorId);
            ancestorId = parentByChildId.get(ancestorId) || null;
        }

        if (createsCycle) {
            continue;
        }

        parentByChildId.set(childId, parentId);

        const children = childrenByParentId.get(parentId);

        if (!children.includes(childId)) {
            children.push(childId);
        }

        childIds.add(childId);
    }

    const renderedIds = new Set();
    const makeItemRecursive = (nodeId, visited = new Set()) => {
        if (visited.has(nodeId)) {
            return null;
        }

        visited.add(nodeId);
        renderedIds.add(nodeId);

        const node = nodeById.get(nodeId);
        if (!node) return null;

        const childItems = (childrenByParentId.get(nodeId) || [])
            .map((childId) => makeItemRecursive(childId, new Set(visited)))
            .filter(Boolean);

        return makeTreeItemFromMapNode(node, childItems);
    };

    const roots = nodes
        .filter((node) => node?.id && !childIds.has(node.id))
        .map((node) => makeItemRecursive(node.id))
        .filter(Boolean);

    for (const node of nodes) {
        if (!node?.id || renderedIds.has(node.id)) continue;
        const fallbackItem = makeItemRecursive(node.id);
        if (fallbackItem) roots.push(fallbackItem);
    }

    return roots;
}

async function loadSyntheticTreeChildren(items, containerEl, level) {
    const fragment = document.createDocumentFragment();

    for (const item of items) {
        const childNode = await createTreeNode(item, level);
        fragment.appendChild(childNode);
    }

    containerEl.replaceChildren(fragment);
}

async function loadMapTreeChildren(mapPath, containerEl, level) {
    try {
        const result = await window.pisiProject?.listMapNodes?.(mapPath);

        if (!result || !result.ok) {
            const fragment = document.createDocumentFragment();
            const errorRow = document.createElement('div');
            errorRow.className = 'tree-row';
            errorRow.style.paddingLeft = `${level * 14 + 6}px`;
            errorRow.textContent = '⚠️ ' + (result?.error || 'Map node listesi okunamadı');

            fragment.appendChild(errorRow);
            containerEl.replaceChildren(fragment);
            return;
        }

        const treeItems = buildMapNodeTreeItems(
            result.nodes || [],
            result.edges || []
        );

        const fragment = document.createDocumentFragment();

        for (const item of treeItems) {
            const childNode = await createTreeNode(item, level);
            fragment.appendChild(childNode);
        }

        containerEl.replaceChildren(fragment);
    } catch (error) {
        console.error('[PISI] Map tree yüklenirken hata:', error);

        const fragment = document.createDocumentFragment();
        const errorRow = document.createElement('div');
        errorRow.className = 'tree-row';
        errorRow.style.paddingLeft = `${level * 14 + 6}px`;
        errorRow.textContent = '⚠️ Map tree hatası: ' + error.message;

        fragment.appendChild(errorRow);
        containerEl.replaceChildren(fragment);
    }
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "handleDeletedNodeFromTree": {
        enumerable: true,
        get() { return handleDeletedNodeFromTree; }
    },
    "findTreeNodeByPath": {
        enumerable: true,
        get() { return findTreeNodeByPath; }
    },
    "getDirectTreeChildrenContainer": {
        enumerable: true,
        get() { return getDirectTreeChildrenContainer; }
    },
    "rememberExpandedPathsUnder": {
        enumerable: true,
        get() { return rememberExpandedPathsUnder; }
    },
    "refreshActiveMapTreeBranch": {
        enumerable: true,
        get() { return refreshActiveMapTreeBranch; }
    },
    "findTreeNodeByPisiId": {
        enumerable: true,
        get() { return findTreeNodeByPisiId; }
    },
    "ensureTreeChildrenContainer": {
        enumerable: true,
        get() { return ensureTreeChildrenContainer; }
    },
    "setTreeNodeLevelRecursive": {
        enumerable: true,
        get() { return setTreeNodeLevelRecursive; }
    },
    "dedupeTreeNodeByPisiId": {
        enumerable: true,
        get() { return dedupeTreeNodeByPisiId; }
    },
    "moveTreeNodeUnderParent": {
        enumerable: true,
        get() { return moveTreeNodeUnderParent; }
    },
    "animateTreeRow": {
        enumerable: true,
        get() { return animateTreeRow; }
    },
    "appendTreeItemToContainer": {
        enumerable: true,
        get() { return appendTreeItemToContainer; }
    },
    "makeTreeItemFromCreateResult": {
        enumerable: true,
        get() { return makeTreeItemFromCreateResult; }
    },
    "updateTreeItemAfterRename": {
        enumerable: true,
        get() { return updateTreeItemAfterRename; }
    },
    "normalizeClientPath": {
        enumerable: true,
        get() { return normalizeClientPath; }
    },
    "sameClientPath": {
        enumerable: true,
        get() { return sameClientPath; }
    },
    "findMapNodeBoxByPath": {
        enumerable: true,
        get() { return findMapNodeBoxByPath; }
    },
    "animateMapBox": {
        enumerable: true,
        get() { return animateMapBox; }
    },
    "updateOpenMapNodeAfterRename": {
        enumerable: true,
        get() { return updateOpenMapNodeAfterRename; }
    },
    "appendMapNodeBox": {
        enumerable: true,
        get() { return appendMapNodeBox; }
    },
    "createNodeUnderMapFromTree": {
        enumerable: true,
        get() { return createNodeUnderMapFromTree; }
    },
    "selectTreeFile": {
        enumerable: true,
        get() { return selectTreeFile; }
    },
    "startRenameSelectedTreeFile": {
        enumerable: true,
        get() { return startRenameSelectedTreeFile; }
    },
    "startRenameTreeFile": {
        enumerable: true,
        get() { return startRenameTreeFile; }
    },
    "loadFolderChildren": {
        enumerable: true,
        get() { return loadFolderChildren; }
    },
    "makeTreeItemFromMapNode": {
        enumerable: true,
        get() { return makeTreeItemFromMapNode; }
    },
    "getTreeRolesFromEdge": {
        enumerable: true,
        get() { return getTreeRolesFromEdge; }
    },
    "buildMapNodeTreeItems": {
        enumerable: true,
        get() { return buildMapNodeTreeItems; }
    },
    "loadSyntheticTreeChildren": {
        enumerable: true,
        get() { return loadSyntheticTreeChildren; }
    },
    "loadMapTreeChildren": {
        enumerable: true,
        get() { return loadMapTreeChildren; }
    }
});
registerModule("tree.view", moduleApi);
