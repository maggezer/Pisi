import { findTreeNodeByPath, getDirectTreeChildrenContainer, rememberExpandedPathsUnder, animateTreeRow } from './pisi-tree-dom.mjs';
import { loadMapTreeChildren } from './pisi-tree-loading.mjs';

export async function handleDeletedNodeFromTree(item, treeNode, result) {
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
        (sameClientPath(parentMapPath, activeMapPath) ||
            activeMapNodes.some((node) => {
                return sameClientPath(node.fullPath, item.fullPath) || node.id === deletedNodeId;
            }));

    if (belongsToActiveMap) {
        if (deletedNodeId) {
            const box = document.querySelector(`.map-node-box[data-node-id="${CSS.escape(deletedNodeId)}"]`);

            box?.remove();
        }

        activeMapNodes = activeMapNodes.filter((node) => {
            return !sameClientPath(node.fullPath, item.fullPath) && node.id !== deletedNodeId;
        });

        activeMapEdges =
            result.edges ||
            activeMapEdges.filter((edge) => {
                return edge.sourceId !== deletedNodeId && edge.targetId !== deletedNodeId;
            });

        drawMapConnections();

        await refreshActiveMapTreeBranch();
    } else {
        treeNode?.remove();
    }
}

export async function refreshActiveMapTreeBranch() {
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

export function makeTreeItemFromCreateResult(result) {
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

export function updateTreeItemAfterRename(oldPath, result) {
    if (!oldPath || !result || !result.ok) return;

    const treeNode = findTreeNodeByPath(oldPath);
    if (!treeNode) return;

    const displayName = result.metadata?.title || result.displayName || result.fileName;

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

export function normalizeClientPath(filePath) {
    const normalized = String(filePath || '').replace(/[\\/]+/g, '/');

    return window.pisiEnvironment?.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function sameClientPath(a, b) {
    return normalizeClientPath(a) === normalizeClientPath(b);
}

export function findMapNodeBoxByPath(nodePath) {
    const boxes = document.querySelectorAll('.map-node-box');

    for (const box of boxes) {
        if (sameClientPath(box.dataset.nodePath, nodePath)) {
            return box;
        }
    }

    return null;
}

export function animateMapBox(box) {
    if (!box) return;

    box.classList.remove('just-updated');
    void box.offsetWidth;
    box.classList.add('just-updated');

    setTimeout(() => {
        box.classList.remove('just-updated');
    }, 700);
}

export function updateOpenMapNodeAfterRename(oldPath, result) {
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

export function appendMapNodeBox(node) {
    const board = document.getElementById('map-board');
    if (!board || !node) return;

    const box = createMapNodeBox(node);
    board.appendChild(box);

    box.classList.add('selected');
    setTimeout(() => box.classList.remove('selected'), 900);

    drawMapConnections();
}

export async function createNodeUnderMapFromTree(mapItem, mapNodeEl) {
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
