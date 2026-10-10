export function findTreeNodeByPath(targetPath) {
    if (!targetPath) return null;

    const nodes = document.querySelectorAll('.tree-node');

    for (const node of nodes) {
        if (node.dataset.path === targetPath) {
            return node;
        }
    }

    return null;
}

export function getDirectTreeChildrenContainer(treeNode) {
    if (!treeNode) return null;

    return Array.from(treeNode.children).find((child) => {
        return child.classList.contains('tree-children');
    });
}

export function rememberExpandedPathsUnder(containerEl) {
    if (!containerEl) return;

    const expandedNodes = containerEl.querySelectorAll('.tree-node.expanded');

    expandedNodes.forEach((node) => {
        if (node.dataset.path) {
            expandedTreePaths.add(node.dataset.path);
        }
    });
}

export function findTreeNodeByPisiId(pisiId) {
    if (!pisiId) return null;

    return document.querySelector(`.tree-node[data-pisi-id="${CSS.escape(pisiId)}"]`);
}

export function ensureTreeChildrenContainer(treeNode) {
    let children = getDirectTreeChildrenContainer(treeNode);

    if (!children) {
        children = document.createElement('div');
        children.className = 'tree-children';
        treeNode.appendChild(children);
    }

    return children;
}

export function setTreeNodeLevelRecursive(treeNode, level) {
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

export function dedupeTreeNodeByPisiId(pisiId, keepNode) {
    const duplicates = document.querySelectorAll(`.tree-node[data-pisi-id="${CSS.escape(pisiId)}"]`);

    duplicates.forEach((node) => {
        if (node !== keepNode) {
            node.remove();
        }
    });
}

export function moveTreeNodeUnderParent(parentId, childId) {
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

export function animateTreeRow(row) {
    if (!row) return;

    row.classList.remove('just-created');

    // Animasyonu yeniden tetiklemek için reflow.
    void row.offsetWidth;

    row.classList.add('just-created');

    setTimeout(() => {
        row.classList.remove('just-created');
    }, 950);
}

export async function appendTreeItemToContainer(containerEl, item, level) {
    if (!containerEl) return null;

    const childNode = await createTreeNode(item, level);
    containerEl.appendChild(childNode);

    const row = childNode.querySelector('.tree-row');
    animateTreeRow(row);

    return childNode;
}
