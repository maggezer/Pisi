import { registerModule } from "../core/module-registry.mjs";

function dispatchPisiActiveNodeChanged(reason = 'update') {
    const activeNode = activeModalNode || activeCenterNode || null;
    document.dispatchEvent(new CustomEvent('pisi:active-node-changed', {
        detail: {
            reason,
            path: activeNode?.path || null,
            mapPath: activeNode?.mapPath || null,
            metadata: activeNode?.metadata || null,
            source: activeModalNode
                ? 'modal'
                : (activeCenterNode ? 'center' : null)
        }
    }));
}

function sanitizePisiEditorHtml(html = '') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = String(html || '');

    const allowedTags = new Set([
        'A', 'B', 'BLOCKQUOTE', 'BR', 'CANVAS', 'CODE', 'DIV', 'EM',
        'FONT', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'I', 'IMG', 'LI',
        'OL', 'P', 'PRE', 'S', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TABLE',
        'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'U', 'UL'
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
        'data-pisi-citation-source',
        'data-pisi-citation-key',
        'data-pisi-block-ref',
        'data-pisi-node-title'
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

    wrapper
        .querySelectorAll('script, style, iframe, object, embed, link, meta, base, form, input, button')
        .forEach((element) => element.remove());

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

                        const property = declaration
                            .slice(0, separatorIndex)
                            .trim()
                            .toLowerCase();
                        const propertyValue = declaration
                            .slice(separatorIndex + 1)
                            .trim();

                        if (
                            !allowedStyleProperties.has(property) ||
                            /url\s*\(|expression\s*\(|@import/i.test(propertyValue)
                        ) {
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

            if (element.tagName === 'CANVAS') {
                allowed = [
                    'width',
                    'height',
                    'data-pisi-canvas',
                    'data-pisi-document-ink',
                    'data-image'
                ].includes(name);

                if (name === 'data-image') {
                    allowed = /^data:image\/png;base64,/i.test(value);
                }
            }

            if (['TABLE', 'TD'].includes(element.tagName)) {
                allowed = allowed || [
                    'data-pisi-sheet',
                    'data-formula',
                    'data-cell',
                    'data-row',
                    'data-col'
                ].includes(name);
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
            const isDocumentInk = element.hasAttribute(
                'data-pisi-document-ink'
            );
            const maxWidth = isDocumentInk ? 4096 : 1600;
            const maxHeight = isDocumentInk ? 4096 : 1200;
            const fallbackWidth = isDocumentInk ? 1 : 520;
            const fallbackHeight = isDocumentInk ? 1 : 320;
            const width = Math.min(
                maxWidth,
                Math.max(
                    1,
                    Number(element.getAttribute('width')) || fallbackWidth
                )
            );
            const height = Math.min(
                maxHeight,
                Math.max(
                    1,
                    Number(element.getAttribute('height')) || fallbackHeight
                )
            );

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
            element.setAttribute(
                'contenteditable',
                value === 'false' ? 'false' : 'true'
            );
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
    if (
        editor.contains(range.startContainer) ||
        editor.contains(range.endContainer)
    ) {
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
    const nodePath = box.dataset.nodePath;
    const propertyMapPath = activeMapPath || null;

    const result = await window.pisiProject?.getPisiDocument?.(nodePath);

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
        revision: 0
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
                activeModalNode.revision =
                    Number(activeModalNode.revision || 0) + 1;
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
                activeModalNode.revision =
                    Number(activeModalNode.revision || 0) + 1;
            });
        }

        setPisiEditorContent(contentInput, result.data.content || '');
        clearPisiEditorCaret(contentInput);
        refreshPisiTagsPanelSoon();
    }

    closePisiTagMenu();

    overlay?.classList.add('visible');
    dispatchPisiActiveNodeChanged('modal-open');
    return true;
}

async function closeNodeModalAndSave() {
    const overlay = document.getElementById('node-modal-overlay');
    const titleInput = document.getElementById('node-modal-title');
    const contentInput = document.getElementById('node-modal-content');

    if (!activeModalNode) {
        overlay?.classList.remove('visible');
        return true;
    }

    try {
        let nodePath = activeModalNode.path;
        const oldPath = nodePath;
        const oldTitle = activeModalNode.metadata?.title || '';
        const title = titleInput?.value?.trim() || oldTitle;
        const content = getPisiEditorContent(contentInput);

        if (title && title !== oldTitle) {
            suppressNextFileSystemRefresh(1500);

            const renameResult = await window.pisiProject?.renamePisiFile?.(
                nodePath,
                title
            );

            if (renameResult && renameResult.ok) {
                nodePath = renameResult.fullPath;
                activeModalNode.path = nodePath;
                activeModalNode.box.dataset.nodePath = nodePath;
                activeModalNode.metadata = renameResult.metadata;

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
        const saveResult = await window.pisiProject?.saveNodeContent?.(
            nodePath,
            content
        );

        if (!saveResult || !saveResult.ok) {
            alert(saveResult?.error || 'Node kaydedilemedi.');
            return false;
        }

        const titleEl = activeModalNode.box.querySelector('.map-node-title');
        const previewEl = activeModalNode.box.querySelector('.map-node-preview');

        if (titleEl) {
            titleEl.textContent = saveResult.metadata.title;
            titleEl.title = saveResult.metadata.title;
        }

        if (previewEl) {
            previewEl.textContent = saveResult.preview || '';
        }

        animateMapBox(activeModalNode.box);

        closePisiTagMenu();
        refreshPisiTagsPanelSoon();

        const returnFocus = activeModalNode.returnFocus;
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
            activeCenterNode.revision =
                Number(activeCenterNode.revision || 0) + 1;
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
                activeCenterNode.revision =
                    Number(activeCenterNode.revision || 0) + 1;
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
    clearTimeout(centerNodeSaveTimer);

    centerNodeSaveTimer = setTimeout(() => {
        saveCurrentCenterNodeEditor();
    }, 800);
}

async function openCenterNodeEditor(nodeItem) {
    if (!nodeItem?.fullPath) return;

    const propertyMapPath = nodeItem.mapPath || activeMapPath || null;

    bindCenterNodeEditorControls();

    if (
        activeCenterNode?.path &&
        !samePisiWorkspacePath(activeCenterNode.path, nodeItem.fullPath)
    ) {
        const saved = await saveCurrentCenterNodeEditor();
        if (!saved) return false;
    }

    if (activeMapPath) {
        const layoutSaved = await saveCurrentMapLayout();
        if (!layoutSaved) return false;
    }

    const result = await window.pisiProject?.getPisiDocument?.(nodeItem.fullPath);

    if (!result || !result.ok) {
        alert(result?.error || 'Node açılamadı.');
        return false;
    }

    clearMapWorkspace();

    const {
        wrapper,
        titleInput,
        contentEditor,
        placeholder,
        mapCanvas
    } = getCenterNodeEditorElements();

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
        revision: 0
    };

    if (titleInput) {
        titleInput.value =
            result.metadata?.title ||
            nodeItem.metadata?.title ||
            String(nodeItem.fileName || nodeItem.name || '').replace(/\.node$/i, '');
    }

    if (contentEditor) {
        ensurePisiEditorWritable(contentEditor);
        setPisiEditorContent(contentEditor, result.data?.content || '');
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
    if (!activeCenterNode?.path) return true;

    const saveTask = pisiCenterSaveTail
        .catch(() => false)
        .then(() => performCurrentCenterNodeEditorSave());

    pisiCenterSaveTail = saveTask;
    return saveTask;
}

async function performCurrentCenterNodeEditorSave() {
    if (!activeCenterNode?.path) return true;

    const { titleInput, contentEditor, saveBtn } = getCenterNodeEditorElements();
    const saveRevision = Number(activeCenterNode.revision || 0);

    try {
        clearTimeout(centerNodeSaveTimer);
        centerNodeSaveTimer = null;
        saveBtn?.classList.add('saving');

        let nodePath = activeCenterNode.path;
        const oldPath = nodePath;
        const oldTitle = activeCenterNode.metadata?.title || '';
        const title = titleInput?.value?.trim() || oldTitle;
        const content = getPisiEditorContent(contentEditor);

        if (title && title !== oldTitle) {
            suppressNextFileSystemRefresh(3000);

            const renameResult = await window.pisiProject?.renamePisiFile?.(
                nodePath,
                title
            );

            if (!renameResult || !renameResult.ok) {
                alert(renameResult?.error || 'Node başlığı değiştirilemedi.');
                titleInput?.focus();
                return false;
            }

            nodePath = renameResult.fullPath;

            activeCenterNode.path = nodePath;
            activeCenterNode.metadata = renameResult.metadata || {};
            activeCenterNode.item = {
                ...activeCenterNode.item,
                name: renameResult.fileName,
                fileName: renameResult.fileName,
                fullPath: renameResult.fullPath,
                displayName: renameResult.metadata?.title || renameResult.fileName,
                metadata: {
                    ...(renameResult.metadata || {})
                },
                sidecarPath: renameResult.sidecarPath || activeCenterNode.item?.sidecarPath
            };

            updateTreeItemAfterRename(oldPath, renameResult);
            updateOpenMapNodeAfterRename(oldPath, renameResult);

            if (typeof updatePisiOpenTabAfterRename === 'function') {
                updatePisiOpenTabAfterRename(oldPath, renameResult);
            }
        }

        suppressNextFileSystemRefresh(3000);
        const saveResult = await window.pisiProject?.saveNodeContent?.(
            nodePath,
            content
        );

        if (!saveResult || !saveResult.ok) {
            alert(saveResult?.error || 'Node kaydedilemedi.');
            return false;
        }

        activeCenterNode.metadata = saveResult.metadata || activeCenterNode.metadata;
        if (Number(activeCenterNode.revision || 0) === saveRevision) {
            activeCenterNode.dirty = false;
        }
        dispatchPisiActiveNodeChanged('center-save');

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

function clearCenterNodeEditor() {
    clearTimeout(centerNodeSaveTimer);

    const {
        wrapper,
        titleInput,
        contentEditor
    } = getCenterNodeEditorElements();

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
    "sanitizePisiEditorHtml": {
        enumerable: true,
        get() { return sanitizePisiEditorHtml; }
    },
    "dispatchPisiActiveNodeChanged": {
        enumerable: true,
        get() { return dispatchPisiActiveNodeChanged; }
    },
    "openNodeModalFromBox": {
        enumerable: true,
        get() { return openNodeModalFromBox; }
    },
    "closeNodeModalAndSave": {
        enumerable: true,
        get() { return closeNodeModalAndSave; }
    },
    "closeNodeModalWithoutSaving": {
        enumerable: true,
        get() { return closeNodeModalWithoutSaving; }
    },
    "getCenterNodeEditorElements": {
        enumerable: true,
        get() { return getCenterNodeEditorElements; }
    },
    "bindCenterNodeEditorControls": {
        enumerable: true,
        get() { return bindCenterNodeEditorControls; }
    },
    "scheduleCenterNodeEditorSave": {
        enumerable: true,
        get() { return scheduleCenterNodeEditorSave; }
    },
    "openCenterNodeEditor": {
        enumerable: true,
        get() { return openCenterNodeEditor; }
    },
    "pisiCenterSaveTail": {
        enumerable: true,
        get() { return pisiCenterSaveTail; },
        set(value) { pisiCenterSaveTail = value; }
    },
    "saveCurrentCenterNodeEditor": {
        enumerable: true,
        get() { return saveCurrentCenterNodeEditor; }
    },
    "performCurrentCenterNodeEditorSave": {
        enumerable: true,
        get() { return performCurrentCenterNodeEditorSave; }
    },
    "clearCenterNodeEditor": {
        enumerable: true,
        get() { return clearCenterNodeEditor; }
    },
    "flushPisiPendingSaves": {
        enumerable: true,
        get() { return flushPisiPendingSaves; }
    }
});
registerModule("editor.node", moduleApi);
