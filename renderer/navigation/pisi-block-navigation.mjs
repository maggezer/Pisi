import { registerModule } from '../core/module-registry.mjs';

// Opening a note at a block (docs/task-plan.md G5, GK3): a tag or search
// result names the note by its path and the block by its id; the note is
// opened and that block, and only that block, is shown. Nothing is matched by
// text or tag, nothing is looked for across the project and nothing is
// written. Tasks open their place by the task id (openPisiTaskLocation in
// renderer/tasks/pisi-task-actions.mjs). The highlight is an animation, never
// a class saved with the note.

let pisiBlockHighlightAnimation = null;
let pisiBlockHighlightRequest = 0;

function samePisiNavigationPath(a, b) {
    if (!a || !b) return false;
    const normalize = (value) =>
        String(value)
            .replace(/[\\/]+/g, '/')
            .replace(/\/+$/g, '');
    const left = normalize(a);
    const right = normalize(b);
    return window.pisiEnvironment?.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function getPisiNavigationEditors(nodePath) {
    const editors = [];
    const modalEditor = document.getElementById('node-modal-content');
    const centerEditor = document.getElementById('center-node-editor-content');
    if (modalEditor && samePisiNavigationPath(window.activeModalNode?.path, nodePath)) editors.push(modalEditor);
    if (centerEditor && samePisiNavigationPath(window.activeCenterNode?.path, nodePath)) editors.push(centerEditor);
    return editors;
}

/** The top-level block of an editor with exactly this block id, or null. */
function findPisiEditorBlockById(editor, blockId) {
    if (!editor || !blockId) return null;
    return Array.from(editor.querySelectorAll('[data-pisi-block-id]')).find((element) => element.dataset.pisiBlockId === blockId) || null;
}

function clearPisiBlockHighlight() {
    pisiBlockHighlightRequest += 1;
    pisiBlockHighlightAnimation?.cancel?.();
    pisiBlockHighlightAnimation = null;
}

function animatePisiBlock(target) {
    if (!target?.isConnected) return false;
    pisiBlockHighlightAnimation?.cancel?.();
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (typeof target.animate !== 'function') return true;
    const animation = target.animate(
        [
            { backgroundColor: 'rgba(93, 173, 226, 0.34)', boxShadow: '0 0 0 2px rgba(93, 173, 226, 0.88)', offset: 0 },
            { backgroundColor: 'rgba(93, 173, 226, 0.24)', boxShadow: '0 0 0 2px rgba(93, 173, 226, 0.72)', offset: 0.72 },
            { backgroundColor: 'rgba(93, 173, 226, 0)', boxShadow: '0 0 0 2px rgba(93, 173, 226, 0)', offset: 1 }
        ],
        { duration: 2200, easing: 'ease-out' }
    );
    pisiBlockHighlightAnimation = animation;
    animation.finished
        .catch(() => {})
        .finally(() => {
            if (pisiBlockHighlightAnimation === animation) pisiBlockHighlightAnimation = null;
        });
    return true;
}

/**
 * Shows the block `target.blockId` of the open note `target.nodePath`. Waits a
 * short while for the editor to draw the note; false when that note has no
 * block with that id.
 */
async function highlightPisiEditorBlock(target = {}) {
    if (!target?.nodePath || !target?.blockId) return false;
    clearPisiBlockHighlight();
    const requestId = pisiBlockHighlightRequest;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        if (requestId !== pisiBlockHighlightRequest) return false;
        for (const editor of getPisiNavigationEditors(target.nodePath)) {
            const block = findPisiEditorBlockById(editor, target.blockId);
            if (block) return animatePisiBlock(block);
        }
        await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return false;
}

function makePisiBlockNavigationNodeItem(target) {
    if (target.nodeItem?.fullPath) return { ...target.nodeItem, fullPath: target.nodePath, mapPath: target.mapPath || target.nodeItem.mapPath || null };
    const fileName =
        String(target.nodePath || '')
            .split(/[\\/]/)
            .pop() || 'Node.node';
    return {
        name: fileName,
        fileName,
        fullPath: target.nodePath,
        mapPath: target.mapPath || null,
        type: 'file',
        isFile: true,
        isDirectory: false,
        displayName: target.nodeTitle || fileName.replace(/\.node$/i, '')
    };
}

function dispatchPisiBlockNavigationComplete(result) {
    document.dispatchEvent(new CustomEvent('pisi:block-navigation-complete', { detail: result }));
    return result;
}

/**
 * Opens a tag result: its note, then its block. `{ ok, code, nodePath, blockId }`;
 * `code` is OK, NODE_PATH_MISSING, CURRENT_NODE_SAVE_FAILED, NODE_OPEN_FAILED or BLOCK_NOT_FOUND.
 */
async function openPisiTagBlockResult(input = {}) {
    clearPisiBlockHighlight();
    const target = {
        nodePath: input.nodePath || null,
        blockId: input.blockId || null,
        mapPath: input.mapPath || null,
        nodeTitle: input.nodeTitle || '',
        nodeItem: input.nodeItem || null
    };
    if (!target.nodePath) return dispatchPisiBlockNavigationComplete({ ok: false, code: 'NODE_PATH_MISSING', nodePath: null, blockId: target.blockId });

    const modalOnTarget = samePisiNavigationPath(window.activeModalNode?.path, target.nodePath);
    // The task workspace hides the center editor without clearing activeCenterNode: the tab is opened again to show it.
    const centerOnTarget =
        samePisiNavigationPath(window.activeCenterNode?.path, target.nodePath) && document.getElementById('center-node-editor')?.hidden === false;
    if (!modalOnTarget && window.activeModalNode) {
        const saved = await window.closeNodeModalAndSave?.();
        if (saved === false)
            return dispatchPisiBlockNavigationComplete({ ok: false, code: 'CURRENT_NODE_SAVE_FAILED', nodePath: target.nodePath, blockId: target.blockId });
    }
    if (!modalOnTarget && !centerOnTarget) {
        const opened = await window.openPisiFileTab?.(makePisiBlockNavigationNodeItem(target));
        if (!opened) return dispatchPisiBlockNavigationComplete({ ok: false, code: 'NODE_OPEN_FAILED', nodePath: target.nodePath, blockId: target.blockId });
    }
    const highlighted = await highlightPisiEditorBlock(target);
    return dispatchPisiBlockNavigationComplete({
        ok: highlighted,
        code: highlighted ? 'OK' : 'BLOCK_NOT_FOUND',
        nodeOpened: true,
        nodePath: target.nodePath,
        blockId: target.blockId,
        mapPath: target.mapPath
    });
}

const moduleApi = { openPisiTagBlockResult, highlightPisiEditorBlock, findPisiEditorBlockById };

registerModule('navigation.block', moduleApi);

export { openPisiTagBlockResult, highlightPisiEditorBlock, findPisiEditorBlockById };
