import { registerModule } from "../core/module-registry.mjs";

function getPisiTreePathSegments(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .map((segment) => segment.trim().toLowerCase());
}

function isPisiInternalTreePath(value) {
    const segments = getPisiTreePathSegments(value);
    return segments.includes('.pisi') || segments.includes('.pisi-history');
}

function removePisiInternalTreeNodes(root = document.getElementById('file-tree')) {
    if (!root) return 0;

    let removed = 0;
    root.querySelectorAll('.tree-node[data-path]').forEach((node) => {
        if (!isPisiInternalTreePath(node.dataset.path)) return;
        node.remove();
        removed += 1;
    });
    return removed;
}

function installPisiInternalTreeFilter() {
    const root = document.getElementById('file-tree');
    if (!root || root.dataset.pisiInternalFilterBound === '1') return false;

    root.dataset.pisiInternalFilterBound = '1';
    removePisiInternalTreeNodes(root);

    const observer = new MutationObserver(() => {
        removePisiInternalTreeNodes(root);
    });
    observer.observe(root, {
        childList: true,
        subtree: true
    });
    return true;
}

function initializePisiInternalTreeFilter() {
    installPisiInternalTreeFilter();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializePisiInternalTreeFilter, {
            once: true
        });
    } else {
        initializePisiInternalTreeFilter();
    }
}

registerModule('tree.internalFilter', {
    getPisiTreePathSegments,
    initializePisiInternalTreeFilter,
    installPisiInternalTreeFilter,
    isPisiInternalTreePath,
    removePisiInternalTreeNodes
});

export {
    getPisiTreePathSegments,
    initializePisiInternalTreeFilter,
    installPisiInternalTreeFilter,
    isPisiInternalTreePath,
    removePisiInternalTreeNodes
};
