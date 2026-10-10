export function isPisiInternalTreeItem(item) {
    const pathName = String(item?.fullPath || '')
        .split(/[\\/]/)
        .filter(Boolean)
        .pop();
    const name = String(item?.name || item?.fileName || pathName || '')
        .trim()
        .toLowerCase();

    return name === '.pisi-history';
}

export async function loadFolderChildren(folderPath, containerEl, level, rootRender = null) {
    const rootRenderIsCurrent = () => {
        return !rootRender || isCurrentPisiTreeRootRender(rootRender.renderId, rootRender.rootPath);
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

    const visibleItems = Array.isArray(result.items) ? result.items.filter((item) => !isPisiInternalTreeItem(item)) : [];

    for (const item of visibleItems) {
        const childNode = await createTreeNode(item, level);
        if (!rootRenderIsCurrent()) return false;
        fragment.appendChild(childNode);
    }

    containerEl.replaceChildren(fragment);
    return true;
}

export function makeTreeItemFromMapNode(mapNode, children = []) {
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

export function getTreeRolesFromEdge(edge) {
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

export function buildMapNodeTreeItems(nodes = [], edges = []) {
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

        const childItems = (childrenByParentId.get(nodeId) || []).map((childId) => makeItemRecursive(childId, new Set(visited))).filter(Boolean);

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

export async function loadSyntheticTreeChildren(items, containerEl, level) {
    const fragment = document.createDocumentFragment();

    for (const item of items) {
        const childNode = await createTreeNode(item, level);
        fragment.appendChild(childNode);
    }

    containerEl.replaceChildren(fragment);
}

export async function loadMapTreeChildren(mapPath, containerEl, level) {
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

        const treeItems = buildMapNodeTreeItems(result.nodes || [], result.edges || []);

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
