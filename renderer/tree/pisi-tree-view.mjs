import { registerModule } from '../core/module-registry.mjs';
import {
    findTreeNodeByPath,
    getDirectTreeChildrenContainer,
    rememberExpandedPathsUnder,
    findTreeNodeByPisiId,
    ensureTreeChildrenContainer,
    setTreeNodeLevelRecursive,
    dedupeTreeNodeByPisiId,
    moveTreeNodeUnderParent,
    animateTreeRow,
    appendTreeItemToContainer
} from './pisi-tree-dom.mjs';
import {
    handleDeletedNodeFromTree,
    refreshActiveMapTreeBranch,
    makeTreeItemFromCreateResult,
    updateTreeItemAfterRename,
    normalizeClientPath,
    sameClientPath,
    findMapNodeBoxByPath,
    animateMapBox,
    updateOpenMapNodeAfterRename,
    appendMapNodeBox,
    createNodeUnderMapFromTree
} from './pisi-tree-mutations.mjs';
import { selectTreeFile, startRenameSelectedTreeFile, startRenameTreeFile } from './pisi-tree-rename.mjs';
import {
    isPisiInternalTreeItem,
    loadFolderChildren,
    makeTreeItemFromMapNode,
    getTreeRolesFromEdge,
    buildMapNodeTreeItems,
    loadSyntheticTreeChildren,
    loadMapTreeChildren
} from './pisi-tree-loading.mjs';

const moduleApi = {};
Object.defineProperties(moduleApi, {
    handleDeletedNodeFromTree: {
        enumerable: true,
        get() {
            return handleDeletedNodeFromTree;
        }
    },
    findTreeNodeByPath: {
        enumerable: true,
        get() {
            return findTreeNodeByPath;
        }
    },
    getDirectTreeChildrenContainer: {
        enumerable: true,
        get() {
            return getDirectTreeChildrenContainer;
        }
    },
    rememberExpandedPathsUnder: {
        enumerable: true,
        get() {
            return rememberExpandedPathsUnder;
        }
    },
    refreshActiveMapTreeBranch: {
        enumerable: true,
        get() {
            return refreshActiveMapTreeBranch;
        }
    },
    findTreeNodeByPisiId: {
        enumerable: true,
        get() {
            return findTreeNodeByPisiId;
        }
    },
    ensureTreeChildrenContainer: {
        enumerable: true,
        get() {
            return ensureTreeChildrenContainer;
        }
    },
    setTreeNodeLevelRecursive: {
        enumerable: true,
        get() {
            return setTreeNodeLevelRecursive;
        }
    },
    dedupeTreeNodeByPisiId: {
        enumerable: true,
        get() {
            return dedupeTreeNodeByPisiId;
        }
    },
    moveTreeNodeUnderParent: {
        enumerable: true,
        get() {
            return moveTreeNodeUnderParent;
        }
    },
    animateTreeRow: {
        enumerable: true,
        get() {
            return animateTreeRow;
        }
    },
    appendTreeItemToContainer: {
        enumerable: true,
        get() {
            return appendTreeItemToContainer;
        }
    },
    makeTreeItemFromCreateResult: {
        enumerable: true,
        get() {
            return makeTreeItemFromCreateResult;
        }
    },
    updateTreeItemAfterRename: {
        enumerable: true,
        get() {
            return updateTreeItemAfterRename;
        }
    },
    normalizeClientPath: {
        enumerable: true,
        get() {
            return normalizeClientPath;
        }
    },
    sameClientPath: {
        enumerable: true,
        get() {
            return sameClientPath;
        }
    },
    findMapNodeBoxByPath: {
        enumerable: true,
        get() {
            return findMapNodeBoxByPath;
        }
    },
    animateMapBox: {
        enumerable: true,
        get() {
            return animateMapBox;
        }
    },
    updateOpenMapNodeAfterRename: {
        enumerable: true,
        get() {
            return updateOpenMapNodeAfterRename;
        }
    },
    appendMapNodeBox: {
        enumerable: true,
        get() {
            return appendMapNodeBox;
        }
    },
    createNodeUnderMapFromTree: {
        enumerable: true,
        get() {
            return createNodeUnderMapFromTree;
        }
    },
    selectTreeFile: {
        enumerable: true,
        get() {
            return selectTreeFile;
        }
    },
    startRenameSelectedTreeFile: {
        enumerable: true,
        get() {
            return startRenameSelectedTreeFile;
        }
    },
    startRenameTreeFile: {
        enumerable: true,
        get() {
            return startRenameTreeFile;
        }
    },
    loadFolderChildren: {
        enumerable: true,
        get() {
            return loadFolderChildren;
        }
    },
    makeTreeItemFromMapNode: {
        enumerable: true,
        get() {
            return makeTreeItemFromMapNode;
        }
    },
    getTreeRolesFromEdge: {
        enumerable: true,
        get() {
            return getTreeRolesFromEdge;
        }
    },
    buildMapNodeTreeItems: {
        enumerable: true,
        get() {
            return buildMapNodeTreeItems;
        }
    },
    loadSyntheticTreeChildren: {
        enumerable: true,
        get() {
            return loadSyntheticTreeChildren;
        }
    },
    loadMapTreeChildren: {
        enumerable: true,
        get() {
            return loadMapTreeChildren;
        }
    }
});
registerModule('tree.view', moduleApi);
