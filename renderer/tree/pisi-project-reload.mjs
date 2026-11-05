import { registerModule } from '../core/module-registry.mjs';
import { capturePisiSelectionBookmark, rebasePisiSelectionBookmark, restorePisiSelectionBookmark } from '../editor/pisi-selection-bookmarks.mjs';

// Reloading the project that is already open must not discard the user's place:
// open tabs, the active tab and the caret in the center note survive as long as
// their files still exist. Switching to another project starts clean.

function getPisiCenterEditorForReload() {
    return typeof getCenterNodeEditorElements === 'function' ? getCenterNodeEditorElements().contentEditor || null : null;
}

function capturePisiProjectWorkspace() {
    const state = window.Pisi?.state || {};
    const centerPath = window.activeCenterNode?.path || null;
    const editor = getPisiCenterEditorForReload();
    const selection = window.getSelection?.();
    const caretInEditor = Boolean(editor && centerPath && selection?.rangeCount && editor.contains(selection.anchorNode));

    return {
        tabs: (Array.isArray(state.openTabs) ? state.openTabs : [])
            .filter((tab) => tab?.path && tab.item?.fullPath)
            .map((tab) => ({ path: tab.path, item: { ...tab.item, metadata: { ...(tab.item.metadata || {}) } } })),
        activeTabPath: state.activeTabPath || null,
        centerPath,
        selection: caretInEditor ? capturePisiSelectionBookmark(editor) : null
    };
}

async function doesPisiWorkspaceDocumentExist(filePath) {
    try {
        const result = await window.pisiProject?.getPisiDocument?.(filePath);
        return Boolean(result?.ok);
    } catch {
        return false;
    }
}

async function restorePisiProjectWorkspace(snapshot) {
    if (!snapshot?.tabs?.length) return false;

    const kept = [];
    for (const tab of snapshot.tabs) {
        if (await doesPisiWorkspaceDocumentExist(tab.path)) kept.push(tab);
    }
    if (!kept.length) return false;

    kept.forEach((tab) => ensurePisiOpenTab(tab.item));
    const target = kept.find((tab) => pisiSameTabPath(tab.path, snapshot.activeTabPath)) || kept[kept.length - 1];
    const activated = await activatePisiOpenTab(target.path);
    renderPisiOpenTabs();
    if (!activated) return false;

    if (snapshot.selection && snapshot.centerPath && pisiSameTabPath(snapshot.centerPath, target.path)) {
        const editor = getPisiCenterEditorForReload();
        const rebased = editor ? rebasePisiSelectionBookmark(editor, snapshot.selection) : null;
        if (rebased) restorePisiSelectionBookmark(editor, rebased);
    }
    return true;
}

const moduleApi = {
    capturePisiProjectWorkspace,
    doesPisiWorkspaceDocumentExist,
    restorePisiProjectWorkspace
};

registerModule('tree.projectReload', moduleApi);

export { capturePisiProjectWorkspace, doesPisiWorkspaceDocumentExist, restorePisiProjectWorkspace };
