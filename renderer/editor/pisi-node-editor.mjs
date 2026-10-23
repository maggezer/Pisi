import { sanitizePisiEditorHtml } from './pisi-editor-sanitize.mjs';
import {
    getPisiNodeRecoveryWarning,
    applyPisiEditorRecoveryState,
    protectPisiEditorRecovery,
    allowPisiRecoveryDeparture
} from './pisi-editor-recovery-policy.mjs';
import {
    beginPisiWorkspaceNavigation,
    isPisiWorkspaceNavigationCurrent,
    beginPisiModalNavigation,
    isPisiModalNavigationCurrent
} from './pisi-editor-navigation.mjs';
import { registerModule } from '../core/module-registry.mjs';
import { getPisiEditorRestoreGeneration, isPisiEditorRestorePending, isPisiEditorWriteBlocked, runPisiEditorWrite } from './pisi-editor-restore.mjs';
import { getPisiEditorAssetRecoveryWarning } from './pisi-editor-asset-recovery.mjs';

function dispatchPisiActiveNodeChanged(reason = 'update') {
    const activeNode = activeModalNode || activeCenterNode || null;
    document.dispatchEvent(
        new CustomEvent('pisi:active-node-changed', {
            detail: {
                reason,
                path: activeNode?.path || null,
                mapPath: activeNode?.mapPath || null,
                metadata: activeNode?.metadata || null,
                source: activeModalNode ? 'modal' : activeCenterNode ? 'center' : null
            }
        })
    );
}

function clearPisiEditorCaret(editor) {
    if (!editor) return;

    const activeElement = document.activeElement;
    if (activeElement === editor || editor.contains(activeElement)) {
        activeElement?.blur?.();
    }

    const selection = window.getSelection?.();
    if (!selection?.rangeCount) return;

    const range = selection.getRangeAt(0);
    if (editor.contains(range.startContainer) || editor.contains(range.endContainer)) {
        selection.removeAllRanges();
    }
}

function ensurePisiEditorWritable(editor) {
    if (!editor) return;

    editor.contentEditable = 'true';
    editor.setAttribute('contenteditable', 'true');
    editor.removeAttribute('aria-readonly');
    editor.removeAttribute('inert');
}

async function openNodeModalFromBox(box) {
    if (isPisiEditorRestorePending()) return false;
    const restoreGeneration = getPisiEditorRestoreGeneration();
    const request = beginPisiModalNavigation();
    if (activeModalNode) {
        const saved = await closeNodeModalAndSave(true);
        if (!saved || !isPisiModalNavigationCurrent(request)) return false;
    }
    const nodePath = box.dataset.nodePath;
    const propertyMapPath = activeMapPath || null;

    const centerNode = activeCenterNode;
    const sharesCenter = centerNode?.path && samePisiWorkspacePath(centerNode.path, nodePath);
    if (sharesCenter) {
        const saved = await saveCurrentCenterNodeEditor();
        if (!saved || !isPisiModalNavigationCurrent(request)) return false;
    }
    const centerRevision = Number(centerNode?.revision || 0);
    const result = await window.pisiProject?.getPisiDocument?.(nodePath);
    if (sharesCenter && (activeCenterNode !== centerNode || Number(centerNode.revision || 0) !== centerRevision)) return false;
    if (
        !isPisiModalNavigationCurrent(request) ||
        activeMapPath !== propertyMapPath ||
        isPisiEditorRestorePending() ||
        restoreGeneration !== getPisiEditorRestoreGeneration()
    )
        return false;

    if (!result || !result.ok) {
        alert(result?.error || 'Node açılamadı.');
        return false;
    }

    activeModalNode = {
        box,
        path: nodePath,
        mapPath: propertyMapPath,
        metadata: result.metadata,
        returnFocus: document.activeElement,
        dirty: false,
        revision: 0,
        assetRecoveryWarning: getPisiEditorAssetRecoveryWarning(result.data?.content || '')
    };

    const overlay = document.getElementById('node-modal-overlay');
    const titleInput = document.getElementById('node-modal-title');
    const contentInput = document.getElementById('node-modal-content');

    if (titleInput) {
        titleInput.value = result.metadata.title || '';

        if (titleInput.dataset.modalDirtyBound !== '1') {
            titleInput.dataset.modalDirtyBound = '1';
            titleInput.addEventListener('input', () => {
                if (!activeModalNode) return;
                activeModalNode.dirty = true;
                activeModalNode.revision = Number(activeModalNode.revision || 0) + 1;
            });
        }
    }

    if (contentInput) {
        applyPisiEditorRecoveryState(null, contentInput, titleInput);
        ensurePisiEditorWritable(contentInput);

        if (contentInput.dataset.modalDirtyBound !== '1') {
            contentInput.dataset.modalDirtyBound = '1';
            contentInput.addEventListener('input', () => {
                if (!activeModalNode) return;
                activeModalNode.dirty = true;
                activeModalNode.revision = Number(activeModalNode.revision || 0) + 1;
            });
        }

        setPisiEditorContent(contentInput, result.data.content || '');
        applyPisiEditorRecoveryState(activeModalNode, contentInput, titleInput);
        clearPisiEditorCaret(contentInput);
        refreshPisiTagsPanelSoon();
    }

    closePisiTagMenu();

    overlay?.classList.add('visible');
    dispatchPisiActiveNodeChanged('modal-open');
    return true;
}

function closeNodeModalAndSave(preserveNavigation = false) {
    if (!preserveNavigation) beginPisiModalNavigation();
    const node = activeModalNode;
    if (isPisiEditorRestorePending()) return false;
    if (getPisiNodeRecoveryWarning(node)) {
        return allowPisiRecoveryDeparture(node, true).then((allowed) => {
            if (!allowed || activeModalNode !== node) return false;
            closeNodeModalWithoutSaving();
            return true;
        });
    }
    const previousSave = pisiCenterSaveTail;
    const saveTask = runPisiEditorWrite(() => previousSave.catch(() => false).then(() => performNodeModalCloseAndSave(node)), node);
    pisiCenterSaveTail = saveTask;
    return saveTask;
}

async function performNodeModalCloseAndSave(node) {
    if (activeModalNode !== node) return false;
    const overlay = document.getElementById('node-modal-overlay');
    const titleInput = document.getElementById('node-modal-title');
    const contentInput = document.getElementById('node-modal-content');

    if (!activeModalNode) {
        overlay?.classList.remove('visible');
        return true;
    }

    try {
        let nodePath = node.path;
        const oldPath = nodePath;
        const centerNode = activeCenterNode?.path && samePisiWorkspacePath(activeCenterNode.path, oldPath) ? activeCenterNode : null;
        if (centerNode?.dirty) return false;
        const centerRevision = Number(centerNode?.revision || 0);
        const saveRevision = Number(node.revision || 0);
        const oldTitle = node.metadata?.title || '';
        const title = titleInput?.value?.trim() || oldTitle;
        const content = getPisiEditorContent(contentInput);
        const recoveryWarning = protectPisiEditorRecovery(node, contentInput, titleInput, content);
        if (recoveryWarning) {
            const allowed = await allowPisiRecoveryDeparture(node, true);
            if (!allowed || activeModalNode !== node) return false;
            closeNodeModalWithoutSaving();
            return true;
        }

        if (title && title !== oldTitle) {
            suppressNextFileSystemRefresh(1500);

            const renameResult = await window.pisiProject?.renamePisiFile?.(nodePath, title);

            if (renameResult && renameResult.ok) {
                nodePath = renameResult.fullPath;
                node.path = nodePath;
                node.box.dataset.nodePath = nodePath;
                node.metadata = renameResult.metadata;

                updateTreeItemAfterRename(oldPath, renameResult);
                updateOpenMapNodeAfterRename(oldPath, renameResult);
                if (typeof updatePisiOpenTabAfterRename === 'function') updatePisiOpenTabAfterRename(oldPath, renameResult);

                if (typeof refreshActiveMapTreeBranch === 'function') {
                    await refreshActiveMapTreeBranch();
                }
            } else {
                alert(renameResult?.error || 'Node başlığı değiştirilemedi.');

                // Rename başarısızsa modal kapanmasın; kullanıcı düzeltebilsin.
                titleInput?.focus();
                return false;
            }
        }

        suppressNextFileSystemRefresh(3000);
        const saveResult = await window.pisiProject?.saveNodeContent?.(nodePath, content);

        if (!saveResult || !saveResult.ok) {
            alert(saveResult?.error || 'Node kaydedilemedi.');
            return false;
        }

        node.metadata = saveResult.metadata || node.metadata;
        if (centerNode && activeCenterNode === centerNode && Number(centerNode.revision || 0) === centerRevision && !centerNode.dirty) {
            const elements = getCenterNodeEditorElements();
            setPisiEditorContent(elements.contentEditor, content);
            if (elements.titleInput) elements.titleInput.value = node.metadata?.title || title;
            centerNode.path = nodePath;
            centerNode.metadata = node.metadata;
            centerNode.revision = centerRevision + 1;
            centerNode.item = { ...centerNode.item, fullPath: nodePath, metadata: node.metadata, displayName: node.metadata?.title || title };
        }

        const titleEl = node.box.querySelector('.map-node-title');
        const previewEl = node.box.querySelector('.map-node-preview');

        if (titleEl) {
            titleEl.textContent = saveResult.metadata.title;
            titleEl.title = saveResult.metadata.title;
        }

        if (previewEl) {
            previewEl.textContent = saveResult.preview || '';
        }

        animateMapBox(node.box);

        closePisiTagMenu();
        refreshPisiTagsPanelSoon();

        if (activeModalNode !== node || Number(node.revision || 0) !== saveRevision) return false;
        const returnFocus = node.returnFocus;
        overlay?.classList.remove('visible');
        activeModalNode = null;
        dispatchPisiActiveNodeChanged('modal-close');
        returnFocus?.focus?.({ preventScroll: true });
        return true;
    } catch (error) {
        console.error('[PISI] Modal kaydetme/kapatma hatası:', error);
        alert('Modal kapatılırken hata oluştu: ' + error.message);
        return false;
    }
}

function closeNodeModalWithoutSaving() {
    beginPisiModalNavigation();
    const overlay = document.getElementById('node-modal-overlay');
    const contentInput = document.getElementById('node-modal-content');
    const titleInput = document.getElementById('node-modal-title');

    applyPisiEditorRecoveryState(null, contentInput, titleInput);
    const returnFocus = activeModalNode?.returnFocus;
    overlay?.classList.remove('visible');
    if (contentInput) contentInput.innerHTML = '';
    if (titleInput) titleInput.value = '';
    activeModalNode = null;
    dispatchPisiActiveNodeChanged('modal-close-without-save');
    closePisiTagMenu();
    returnFocus?.focus?.({ preventScroll: true });
}

function getCenterNodeEditorElements() {
    return {
        wrapper: document.getElementById('center-node-editor'),
        titleInput: document.getElementById('center-node-editor-title'),
        contentEditor: document.getElementById('center-node-editor-content'),
        saveBtn: document.getElementById('center-node-editor-save'),
        placeholder: document.getElementById('workspace-placeholder'),
        mapCanvas: document.getElementById('map-canvas')
    };
}

function bindCenterNodeEditorControls() {
    const { titleInput, contentEditor, saveBtn } = getCenterNodeEditorElements();

    if (saveBtn && saveBtn.dataset.bound !== '1') {
        saveBtn.dataset.bound = '1';

        saveBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            await saveCurrentCenterNodeEditor();
        });
    }

    if (titleInput && titleInput.dataset.bound !== '1') {
        titleInput.dataset.bound = '1';

        titleInput.addEventListener('input', () => {
            if (!activeCenterNode) return;
            activeCenterNode.dirty = true;
            activeCenterNode.revision = Number(activeCenterNode.revision || 0) + 1;
            scheduleCenterNodeEditorSave();
        });

        titleInput.addEventListener('keydown', async (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                await saveCurrentCenterNodeEditor();
            }

            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                await saveCurrentCenterNodeEditor();
            }
        });
    }

    if (contentEditor && contentEditor.dataset.centerNodeSaveBound !== '1') {
        contentEditor.dataset.centerNodeSaveBound = '1';

        contentEditor.addEventListener('input', () => {
            if (activeCenterNode) {
                activeCenterNode.dirty = true;
                activeCenterNode.revision = Number(activeCenterNode.revision || 0) + 1;
            }
            refreshPisiTagsPanelSoon();
            scheduleCenterNodeEditorSave();
        });

        contentEditor.addEventListener('keydown', async (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                await saveCurrentCenterNodeEditor();
            }
        });
    }
}

function scheduleCenterNodeEditorSave() {
    if (isPisiEditorWriteBlocked(activeCenterNode)) return;
    clearTimeout(centerNodeSaveTimer);

    centerNodeSaveTimer = setTimeout(() => {
        saveCurrentCenterNodeEditor();
    }, 800);
}

async function openCenterNodeEditor(nodeItem, request = beginPisiWorkspaceNavigation()) {
    if (!isPisiWorkspaceNavigationCurrent(request)) return false;
    if (isPisiEditorRestorePending()) return false;
    const restoreGeneration = getPisiEditorRestoreGeneration();
    if (!nodeItem?.fullPath) return;

    const propertyMapPath = nodeItem.mapPath || activeMapPath || null;

    bindCenterNodeEditorControls();

    if (activeCenterNode?.path && (activeCenterNode.dirty || !samePisiWorkspacePath(activeCenterNode.path, nodeItem.fullPath))) {
        const saved = await saveCurrentCenterNodeEditor({ allowDiscardRecovery: true });
        if (!isPisiWorkspaceNavigationCurrent(request) || !saved) return false;
    }

    if (activeMapPath) {
        const layoutSaved = await saveCurrentMapLayout();
        if (!isPisiWorkspaceNavigationCurrent(request) || !layoutSaved) return false;
    }

    const outgoingNode = activeCenterNode;
    const outgoingRevision = Number(outgoingNode?.revision || 0);
    const result = await window.pisiProject?.getPisiDocument?.(nodeItem.fullPath);
    if (activeCenterNode !== outgoingNode || Number(outgoingNode?.revision || 0) !== outgoingRevision) return false;
    if (!isPisiWorkspaceNavigationCurrent(request) || isPisiEditorRestorePending() || restoreGeneration !== getPisiEditorRestoreGeneration()) return false;

    if (!result || !result.ok) {
        alert(result?.error || 'Node açılamadı.');
        return false;
    }

    clearMapWorkspace(true);

    const { wrapper, titleInput, contentEditor, placeholder, mapCanvas } = getCenterNodeEditorElements();

    if (placeholder) {
        placeholder.style.display = 'none';
    }

    if (mapCanvas) {
        mapCanvas.hidden = true;
        mapCanvas.style.display = 'none';
    }

    if (wrapper) {
        wrapper.hidden = false;
    }

    activeCenterNode = {
        path: nodeItem.fullPath,
        mapPath: propertyMapPath,
        item: {
            ...nodeItem,
            ...(propertyMapPath ? { mapPath: propertyMapPath } : {})
        },
        metadata: result.metadata || {},
        dirty: false,
        revision: 0,
        assetRecoveryWarning: getPisiEditorAssetRecoveryWarning(result.data?.content || '')
    };

    if (titleInput) {
        titleInput.value = result.metadata?.title || nodeItem.metadata?.title || String(nodeItem.fileName || nodeItem.name || '').replace(/\.node$/i, '');
    }

    if (contentEditor) {
        applyPisiEditorRecoveryState(null, contentEditor, titleInput);
        ensurePisiEditorWritable(contentEditor);
        setPisiEditorContent(contentEditor, result.data?.content || '');
        applyPisiEditorRecoveryState(activeCenterNode, contentEditor, titleInput);
        clearPisiEditorCaret(contentEditor);
    }

    dispatchPisiActiveNodeChanged('center-open');
    closePisiTagMenu();

    if (typeof bindPisiTagControls === 'function') {
        bindPisiTagControls();
    }

    if (typeof bindPisiBlockIndexControls === 'function') {
        bindPisiBlockIndexControls();
    }

    return true;
}

let pisiCenterSaveTail = Promise.resolve(true);

function saveCurrentCenterNodeEditor(options = {}) {
    if (isPisiEditorRestorePending()) return false;
    if (getPisiNodeRecoveryWarning(activeCenterNode)) return allowPisiRecoveryDeparture(activeCenterNode, options.allowDiscardRecovery === true);
    if (isPisiEditorWriteBlocked(activeCenterNode)) return false;
    if (!activeCenterNode?.path) return true;

    const node = activeCenterNode;
    const previousSave = pisiCenterSaveTail;
    const saveTask = runPisiEditorWrite(() => previousSave.catch(() => false).then(() => performCurrentCenterNodeEditorSave(node, options)), node);

    pisiCenterSaveTail = saveTask;
    return saveTask;
}

async function performCurrentCenterNodeEditorSave(node, options = {}) {
    if (activeCenterNode !== node) return false;
    if (isPisiEditorWriteBlocked(activeCenterNode)) return false;
    if (!activeCenterNode?.path) return true;
    if (typeof activeModalNode !== 'undefined' && activeModalNode?.path && samePisiWorkspacePath(node.path, activeModalNode.path)) return !node.dirty;

    const { titleInput, contentEditor, saveBtn } = getCenterNodeEditorElements();
    const saveRevision = Number(node.revision || 0);

    try {
        clearTimeout(centerNodeSaveTimer);
        centerNodeSaveTimer = null;
        saveBtn?.classList.add('saving');

        let nodePath = node.path;
        const oldPath = nodePath;
        const oldTitle = node.metadata?.title || '';
        const title = titleInput?.value?.trim() || oldTitle;
        const content = getPisiEditorContent(contentEditor);
        const recoveryWarning = protectPisiEditorRecovery(node, contentEditor, titleInput, content);
        if (recoveryWarning) return allowPisiRecoveryDeparture(node, options.allowDiscardRecovery === true);

        if (title && title !== oldTitle) {
            suppressNextFileSystemRefresh(3000);

            const renameResult = await window.pisiProject?.renamePisiFile?.(nodePath, title);

            if (!renameResult || !renameResult.ok) {
                alert(renameResult?.error || 'Node başlığı değiştirilemedi.');
                titleInput?.focus();
                return false;
            }

            nodePath = renameResult.fullPath;

            node.path = nodePath;
            node.metadata = renameResult.metadata || {};
            node.item = {
                ...node.item,
                name: renameResult.fileName,
                fileName: renameResult.fileName,
                fullPath: renameResult.fullPath,
                displayName: renameResult.metadata?.title || renameResult.fileName,
                metadata: {
                    ...(renameResult.metadata || {})
                },
                sidecarPath: renameResult.sidecarPath || node.item?.sidecarPath
            };

            updateTreeItemAfterRename(oldPath, renameResult);
            updateOpenMapNodeAfterRename(oldPath, renameResult);

            if (typeof updatePisiOpenTabAfterRename === 'function') {
                updatePisiOpenTabAfterRename(oldPath, renameResult);
            }
        }

        suppressNextFileSystemRefresh(3000);
        const saveResult = await window.pisiProject?.saveNodeContent?.(nodePath, content);

        if (!saveResult || !saveResult.ok) {
            alert(saveResult?.error || 'Node kaydedilemedi.');
            return false;
        }

        node.metadata = saveResult.metadata || node.metadata;
        if (Number(node.revision || 0) === saveRevision) {
            node.dirty = false;
        }
        if (activeCenterNode === node) dispatchPisiActiveNodeChanged('center-save');

        if (typeof refreshActiveMapTreeBranch === 'function') {
            await refreshActiveMapTreeBranch();
        }

        refreshPisiTagsPanelSoon();
        return activeCenterNode !== node || Number(node.revision || 0) === saveRevision;
    } catch (error) {
        console.error('[PISI] Center node editor kaydetme hatası:', error);
        alert('Node kaydedilirken hata oluştu: ' + error.message);
        return false;
    } finally {
        saveBtn?.classList.remove('saving');
    }
}

function clearCenterNodeEditor(preserveNavigation = false) {
    if (!preserveNavigation) beginPisiWorkspaceNavigation();
    clearTimeout(centerNodeSaveTimer);
    centerNodeSaveTimer = null;

    const { wrapper, titleInput, contentEditor } = getCenterNodeEditorElements();
    applyPisiEditorRecoveryState(null, contentEditor, titleInput);

    if (titleInput) {
        titleInput.value = '';
    }

    if (contentEditor) {
        contentEditor.innerHTML = '';
    }

    if (wrapper) {
        wrapper.hidden = true;
    }

    activeCenterNode = null;
    dispatchPisiActiveNodeChanged('center-clear');
    closePisiTagMenu();
}

async function flushPisiPendingSaves() {
    if (isPisiEditorRestorePending()) return false;
    clearTimeout(centerNodeSaveTimer);
    clearTimeout(mapSaveTimer);
    clearTimeout(mapCameraSaveTimer);
    centerNodeSaveTimer = null;
    mapSaveTimer = null;
    mapCameraSaveTimer = null;

    if (activeModalNode) {
        const modalSaved = await closeNodeModalAndSave();
        if (!modalSaved) return false;
    }

    if (activeCenterNode) {
        const centerSaved = await saveCurrentCenterNodeEditor({ allowDiscardRecovery: true });
        if (!centerSaved) return false;
    }

    if (activeMapPath) {
        const layoutSaved = await saveCurrentMapLayout();
        if (!layoutSaved) return false;

        if (typeof flushActiveMapCameraSave === 'function') {
            const cameraSaved = await flushActiveMapCameraSave();
            if (!cameraSaved) return false;
        }
    }

    return true;
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    sanitizePisiEditorHtml: {
        enumerable: true,
        get() {
            return sanitizePisiEditorHtml;
        }
    },
    dispatchPisiActiveNodeChanged: {
        enumerable: true,
        get() {
            return dispatchPisiActiveNodeChanged;
        }
    },
    openNodeModalFromBox: {
        enumerable: true,
        get() {
            return openNodeModalFromBox;
        }
    },
    closeNodeModalAndSave: {
        enumerable: true,
        get() {
            return closeNodeModalAndSave;
        }
    },
    closeNodeModalWithoutSaving: {
        enumerable: true,
        get() {
            return closeNodeModalWithoutSaving;
        }
    },
    getCenterNodeEditorElements: {
        enumerable: true,
        get() {
            return getCenterNodeEditorElements;
        }
    },
    bindCenterNodeEditorControls: {
        enumerable: true,
        get() {
            return bindCenterNodeEditorControls;
        }
    },
    scheduleCenterNodeEditorSave: {
        enumerable: true,
        get() {
            return scheduleCenterNodeEditorSave;
        }
    },
    openCenterNodeEditor: {
        enumerable: true,
        get() {
            return openCenterNodeEditor;
        }
    },
    pisiCenterSaveTail: {
        enumerable: true,
        get() {
            return pisiCenterSaveTail;
        },
        set(value) {
            pisiCenterSaveTail = value;
        }
    },
    saveCurrentCenterNodeEditor: {
        enumerable: true,
        get() {
            return saveCurrentCenterNodeEditor;
        }
    },
    performCurrentCenterNodeEditorSave: {
        enumerable: true,
        get() {
            return performCurrentCenterNodeEditorSave;
        }
    },
    clearCenterNodeEditor: {
        enumerable: true,
        get() {
            return clearCenterNodeEditor;
        }
    },
    flushPisiPendingSaves: {
        enumerable: true,
        get() {
            return flushPisiPendingSaves;
        }
    }
});
registerModule('editor.node', moduleApi);
