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

function sanitizePisiEditorHtml(html = '') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = String(html || '');

    wrapper
        .querySelectorAll(
            '.pisi-sheet-section-header, ' +
                '.pisi-sheet-search-row, ' +
                '.pisi-sheet-search, ' +
                '.pisi-sheet-pagination, ' +
                '.pisi-sheet-drag-fill-handle, ' +
                '.pisi-canvas-section-header'
        )
        .forEach((element) => element.remove());

    wrapper.querySelectorAll('.pisi-composite-alignment-active').forEach((element) => {
        element.classList.remove('pisi-composite-alignment-active');
    });

    const allowedTags = new Set([
        'A',
        'B',
        'BLOCKQUOTE',
        'BR',
        'CANVAS',
        'CODE',
        'DIV',
        'EM',
        'FONT',
        'H1',
        'H2',
        'H3',
        'H4',
        'H5',
        'H6',
        'I',
        'IMG',
        'LI',
        'OL',
        'P',
        'PRE',
        'S',
        'SPAN',
        'STRONG',
        'SUB',
        'SUP',
        'TABLE',
        'TBODY',
        'TD',
        'TH',
        'THEAD',
        'TR',
        'U',
        'UL'
    ]);
    const globallyAllowedAttributes = new Set([
        'class',
        'title',
        'contenteditable',
        'role',
        'tabindex',
        'aria-checked',
        'aria-hidden',
        'aria-label',
        'data-pisi-block-id',
        'data-pisi-block-type',
        'data-pisi-task-id',
        'data-pisi-todo-checkbox',
        'data-pisi-tag',
        'data-pisi-done-for',
        'data-pisi-diary-source',
        'data-pisi-todo-status',
        'data-pisi-todo-for',
        'data-pisi-todo-parent',
        'data-pisi-todo-repeat',
        'data-pisi-todo-order',
        'data-pisi-todo-scheduled-at',
        'data-pisi-todo-deadline',
        'data-pisi-todo-reminder-at',
        'data-pisi-todo-duration-minutes',
        'data-pisi-todo-actual-minutes',
        'data-pisi-todo-completion-offset-days',
        'data-pisi-node-title',
        'data-pisi-rollup-relation',
        'data-pisi-rollup-target',
        'data-pisi-rollup-aggregate'
    ]);
    const allowedStyleProperties = new Set([
        'background-color',
        'color',
        'font-family',
        'font-size',
        'font-style',
        'font-weight',
        'text-align',
        'text-decoration'
    ]);

    wrapper.querySelectorAll('script, style, iframe, object, embed, link, meta, base, form, input, button').forEach((element) => element.remove());

    Array.from(wrapper.querySelectorAll('*')).forEach((element) => {
        if (!allowedTags.has(element.tagName)) {
            element.replaceWith(...Array.from(element.childNodes));
            return;
        }

        Array.from(element.attributes).forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            const value = String(attribute.value || '');
            let allowed = globallyAllowedAttributes.has(name);

            if (name === 'style') {
                const safeDeclarations = value
                    .split(';')
                    .map((declaration) => declaration.trim())
                    .filter(Boolean)
                    .map((declaration) => {
                        const separatorIndex = declaration.indexOf(':');
                        if (separatorIndex < 1) return '';

                        const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
                        const propertyValue = declaration.slice(separatorIndex + 1).trim();

                        if (!allowedStyleProperties.has(property) || /url\s*\(|expression\s*\(|@import/i.test(propertyValue)) {
                            return '';
                        }

                        return `${property}: ${propertyValue}`;
                    })
                    .filter(Boolean);

                if (safeDeclarations.length) {
                    element.setAttribute('style', safeDeclarations.join('; '));
                } else {
                    element.removeAttribute('style');
                }
                return;
            }

            if (element.tagName === 'A' && name === 'href') {
                allowed = /^(?:https?:|mailto:)/i.test(value);
            }

            if (element.tagName === 'IMG') {
                if (name === 'src') {
                    allowed = /^(?:data:image\/(?:png|jpeg|gif|webp);base64,|\.{0,2}\/?assets\/)/i.test(value);
                } else if (['alt', 'width', 'height'].includes(name)) {
                    allowed = true;
                }
            }

            if (element.tagName === 'FONT') {
                allowed = ['color', 'face', 'size'].includes(name);
            }

            if (element.tagName === 'DIV') {
                if (name === 'data-pisi-canvas-block') {
                    allowed = value === '1';
                } else if (name === 'data-pisi-canvas-title') {
                    allowed = value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
                } else if (name === 'data-pisi-canvas-collapsed') {
                    allowed = /^(?:0|1)$/.test(value);
                } else if (name === 'data-pisi-composite-align') {
                    allowed = /^(?:left|center|right)$/.test(value);
                }
            }

            if (element.tagName === 'CANVAS') {
                allowed = ['width', 'height', 'data-pisi-canvas', 'data-pisi-document-ink', 'data-pisi-asset', 'data-image'].includes(name);

                if (name === 'data-image') {
                    allowed = /^data:image\/png;base64,/i.test(value);
                }

                if (name === 'data-pisi-asset') {
                    allowed = /^paint\/[a-f0-9]{64}\.png$/i.test(value);
                }
            }

            if (['TABLE', 'TD'].includes(element.tagName)) {
                allowed = allowed || ['data-pisi-sheet', 'data-formula', 'data-cell', 'data-row', 'data-col'].includes(name);
            }

            if (element.tagName === 'TABLE') {
                if (name === 'data-pisi-database-id') {
                    allowed = /^database-[A-Za-z0-9_-]{8,160}$/.test(value);
                }

                if (name === 'data-pisi-sheet-asset') {
                    allowed = /^sheet\/[a-f0-9]{64}\.json$/i.test(value);
                }

                if (name === 'data-pisi-sheet-model') {
                    allowed = false;

                    if (value.length <= 64 * 1024 * 1024) {
                        try {
                            const snapshot = JSON.parse(value);
                            const validSnapshot = Boolean(
                                snapshot &&
                                typeof snapshot === 'object' &&
                                !Array.isArray(snapshot) &&
                                typeof snapshot.databaseId === 'string' &&
                                Array.isArray(snapshot.fields) &&
                                Array.isArray(snapshot.items) &&
                                Array.isArray(snapshot.views)
                            );

                            if (validSnapshot) {
                                element.setAttribute(attribute.name, JSON.stringify(snapshot));
                                allowed = true;
                            }
                        } catch {
                            allowed = false;
                        }
                    }
                }
            }

            if (['data-pisi-rollup-relation', 'data-pisi-rollup-target'].includes(name)) {
                allowed = allowed && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
            }

            if (name === 'data-pisi-rollup-aggregate') {
                allowed = /^(?:count|sum|average|min|max|unique|join)$/.test(value);
            }

            if (!allowed || name.startsWith('on')) {
                element.removeAttribute(attribute.name);
            }
        });

        if (element.hasAttribute('class')) {
            const safeClasses = Array.from(element.classList).filter((name) => {
                return /^pisi-[A-Za-z0-9_-]+$/.test(name);
            });
            element.className = safeClasses.join(' ');
        }

        if (element.tagName === 'CANVAS') {
            const isDocumentInk = element.hasAttribute('data-pisi-document-ink');
            const maxWidth = isDocumentInk ? 4096 : 1600;
            const maxHeight = isDocumentInk ? 4096 : 1200;
            const fallbackWidth = isDocumentInk ? 1 : 520;
            const fallbackHeight = isDocumentInk ? 1 : 320;
            const width = Math.min(maxWidth, Math.max(1, Number(element.getAttribute('width')) || fallbackWidth));
            const height = Math.min(maxHeight, Math.max(1, Number(element.getAttribute('height')) || fallbackHeight));

            element.setAttribute('width', String(width));
            element.setAttribute('height', String(height));

            if (isDocumentInk) {
                element.setAttribute('data-pisi-document-ink', '1');
                element.removeAttribute('data-pisi-canvas');
            } else {
                element.setAttribute('data-pisi-canvas', '1');
                element.removeAttribute('data-pisi-document-ink');
            }

            element.removeAttribute('data-pisi-canvas-bound');
            element.removeAttribute('data-image-loaded');
        }

        if (element.hasAttribute('contenteditable')) {
            const value = element.getAttribute('contenteditable');
            element.setAttribute('contenteditable', value === 'false' ? 'false' : 'true');
        }
    });

    return wrapper.innerHTML;
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
    const nodePath = box.dataset.nodePath;
    const propertyMapPath = activeMapPath || null;

    const result = await window.pisiProject?.getPisiDocument?.(nodePath);
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
        const recoveryWarning = getPisiEditorAssetRecoveryWarning(result.data?.content || '');
        if (recoveryWarning) alert(recoveryWarning);
        clearPisiEditorCaret(contentInput);
        refreshPisiTagsPanelSoon();
    }

    closePisiTagMenu();

    overlay?.classList.add('visible');
    dispatchPisiActiveNodeChanged('modal-open');
    return true;
}

function closeNodeModalAndSave() {
    beginPisiModalNavigation();
    const node = activeModalNode;
    return runPisiEditorWrite(() => performNodeModalCloseAndSave(node));
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
        const saveRevision = Number(node.revision || 0);
        const oldTitle = node.metadata?.title || '';
        const title = titleInput?.value?.trim() || oldTitle;
        const content = getPisiEditorContent(contentInput);
        const recoveryWarning = node.assetRecoveryWarning || getPisiEditorAssetRecoveryWarning(content);
        if (recoveryWarning) {
            alert(recoveryWarning);
            return false;
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
    if (isPisiEditorWriteBlocked()) return;
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

    if (activeCenterNode?.path && !samePisiWorkspacePath(activeCenterNode.path, nodeItem.fullPath)) {
        const saved = await saveCurrentCenterNodeEditor();
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
        ensurePisiEditorWritable(contentEditor);
        setPisiEditorContent(contentEditor, result.data?.content || '');
        const recoveryWarning = getPisiEditorAssetRecoveryWarning(result.data?.content || '');
        if (recoveryWarning) alert(recoveryWarning);
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

function saveCurrentCenterNodeEditor() {
    if (isPisiEditorWriteBlocked()) return false;
    if (!activeCenterNode?.path) return true;

    const node = activeCenterNode;
    const previousSave = pisiCenterSaveTail;
    const saveTask = runPisiEditorWrite(() => previousSave.catch(() => false).then(() => performCurrentCenterNodeEditorSave(node)));

    pisiCenterSaveTail = saveTask;
    return saveTask;
}

async function performCurrentCenterNodeEditorSave(node) {
    if (activeCenterNode !== node) return false;
    if (isPisiEditorWriteBlocked()) return false;
    if (!activeCenterNode?.path) return true;

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
        const recoveryWarning = node.assetRecoveryWarning || getPisiEditorAssetRecoveryWarning(content);
        if (recoveryWarning) {
            alert(recoveryWarning);
            return false;
        }

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
        return true;
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
    if (isPisiEditorWriteBlocked()) return false;
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
        const centerSaved = await saveCurrentCenterNodeEditor();
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
