import { applyPisiEditorRecoveryState } from './pisi-editor-recovery-policy.mjs';
import { getPisiEditorAssetRecoveryWarning } from './pisi-editor-asset-recovery.mjs';

const pendingEditorWrites = new Set();
let restoringDocument = false;
let restoreGeneration = 0;

export function getPisiEditorRestoreGeneration() {
    return restoreGeneration;
}

export function isPisiEditorRestorePending() {
    return restoringDocument;
}

export function isPisiEditorWriteBlocked(node = undefined) {
    if (restoringDocument) return true;
    const protectedNodes = [window.activeCenterNode, window.activeModalNode].filter((candidate) => candidate?.restoreReloadRequired);
    // Unscoped callers remain fail-closed. A failed reload must not prevent
    // another document from saving, but every copy of the restored path is protected.
    if (node === undefined) return protectedNodes.length > 0;
    return Boolean(
        node?.restoreReloadRequired ||
        protectedNodes.some(
            (candidate) =>
                candidate === node ||
                (node?.path && candidate.path && (window.samePisiWorkspacePath?.(candidate.path, node.path) ?? candidate.path === node.path))
        )
    );
}

// Track writes already sent to the main process. A restore must follow them,
// while writes queued by timers/shortcuts during restoration must not run.
export function runPisiEditorWrite(operation, node = undefined) {
    if (isPisiEditorWriteBlocked(node)) return Promise.resolve(false);
    const pending = Promise.resolve().then(() => {
        if (isPisiEditorWriteBlocked(node)) return false;
        return operation();
    });
    pendingEditorWrites.add(pending);
    void pending.then(
        () => pendingEditorWrites.delete(pending),
        () => pendingEditorWrites.delete(pending)
    );
    return pending;
}

function cancelCenterSave() {
    clearTimeout(window.centerNodeSaveTimer);
    window.centerNodeSaveTimer = null;
}

function editorTargets(nodePath) {
    const samePath = (node) => node?.path && window.samePisiWorkspacePath(node.path, nodePath);
    const targets = [];
    if (samePath(window.activeCenterNode)) {
        const elements = window.getCenterNodeEditorElements();
        targets.push({ node: window.activeCenterNode, editor: elements.contentEditor, title: elements.titleInput, modal: false });
    }
    if (samePath(window.activeModalNode)) {
        targets.push({
            node: window.activeModalNode,
            editor: document.getElementById('node-modal-content'),
            title: document.getElementById('node-modal-title'),
            modal: true
        });
    }
    return targets;
}

export async function restorePisiEditorDocument(nodePath, restore) {
    if (restoringDocument) return { ok: false, error: 'Sürüm geri yüklenemedi.' };
    restoringDocument = true;
    restoreGeneration += 1;
    cancelCenterSave();
    let targets = [];
    let controls = [];
    let inertStates = [];
    let restored = false;
    try {
        targets = editorTargets(nodePath);
        controls = targets.flatMap(({ editor, title }) => [editor, title]).filter(Boolean);
        inertStates = controls.map((element) => element.inert);
        controls.forEach((element) => {
            element.inert = true;
        });
        await Promise.allSettled([...pendingEditorWrites]);
        cancelCenterSave();
        const result = await restore();
        if (!result?.ok || result.canceled) return result || { ok: false, error: 'Sürüm geri yüklenemedi.' };
        restored = true;
        // Fail closed until all live editor copies have been replaced. Otherwise
        // a failed read could let the old DOM overwrite the restored document.
        targets.forEach(({ node }) => {
            node.restoreReloadRequired = true;
        });
        const documentResult = await window.pisiProject.getPisiDocument(nodePath);
        if (!documentResult?.ok) throw new Error(documentResult?.error || 'Not açılamadı.');
        const content = documentResult.data?.content || '';
        for (const target of targets) {
            const active = target.modal ? window.activeModalNode : window.activeCenterNode;
            if (active !== target.node) continue;
            if (target.title) target.title.value = documentResult.metadata?.title || '';
            window.setPisiEditorContent(target.editor, content);
            target.node.metadata = documentResult.metadata || {};
            target.node.assetRecoveryWarning = getPisiEditorAssetRecoveryWarning(content);
            target.node.dirty = false;
            target.node.revision = Number(target.node.revision || 0) + 1;
            if (target.node.item) {
                target.node.item = { ...target.node.item, metadata: target.node.metadata, displayName: target.node.metadata.title };
            }
            if (target.modal) {
                const title = target.node.box?.querySelector('.map-node-title');
                const preview = target.node.box?.querySelector('.map-node-preview');
                if (title) title.textContent = target.node.metadata.title || '';
                if (preview) preview.textContent = String(target.editor?.textContent || '').slice(0, 600);
            }
        }
        targets.forEach(({ node }) => {
            node.restoreReloadRequired = false;
        });
        window.dispatchPisiActiveNodeChanged('history-restore');
        window.refreshPisiTagsPanelSoon?.();
        return result;
    } catch (error) {
        return { ok: false, restored, error: error?.message || 'Sürüm geri yüklenemedi.' };
    } finally {
        cancelCenterSave();
        controls.forEach((element, index) => {
            element.inert = inertStates[index];
        });
        for (const target of targets) {
            const active = target.modal ? window.activeModalNode : window.activeCenterNode;
            if (active === target.node) applyPisiEditorRecoveryState(target.node, target.editor, target.title);
        }
        restoringDocument = false;
        if (!restored && window.activeCenterNode?.dirty) window.scheduleCenterNodeEditorSave();
    }
}
