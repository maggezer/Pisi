import { registerModule } from '../core/module-registry.mjs';
import {
    PISI_IMAGE_MAX_BYTES,
    PISI_IMAGE_PICKER_ACCEPT,
    PISI_IMAGE_RASTERIZED_TYPES,
    getPisiImageErrorMessage,
    isPisiImageFileTypeAccepted,
    isPisiImageReference,
    makePisiImageBlockHtml,
    normalizePisiImageAlign,
    normalizePisiImageAlt,
    normalizePisiImageWidth,
    shouldPisiPasteAsImageFiles
} from './pisi-editor-image-policy.mjs';

// Image blocks persist only a sidecar reference (image/<sha256>.<ext>). Bytes are
// read once through the domain boundary and shown through a per-session blob:
// URL, so undo snapshots and autosaves never carry image data. Block controls
// live in one floating layer outside the editor so they are never saved.

const PISI_IMAGE_SKIP_TARGETS = 'input, textarea, select, .pisi-sheet-block, .pisi-canvas-block, table[data-pisi-sheet], canvas[data-pisi-canvas]';
const pisiImageState = {
    cache: new Map(),
    verified: new Set(),
    pending: new Map(),
    activeBlock: null,
    controls: null,
    lightbox: null,
    resize: null,
    frame: 0,
    initialized: false
};

function pisiImageTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function getPisiImageEditor(target) {
    const element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    return element?.closest?.('.pisi-rich-editor') || null;
}

function getPisiImageEditorNodePath(editor) {
    if (editor?.id === 'node-modal-content') return window.activeModalNode?.path || null;
    if (editor?.id === 'center-node-editor-content') return window.activeCenterNode?.path || null;
    return null;
}

function getPisiImageEditorFromRequest(detail = {}) {
    if (detail.editor?.isConnected) return detail.editor;
    if (detail.editorTarget) return document.getElementById(detail.editorTarget);
    return window.getPisiActiveBlocksEditor?.() || null;
}

function reportPisiImageError(code, fallback) {
    window.alert(pisiImageTranslate(getPisiImageErrorMessage(code, fallback)));
}

function cachePisiImageBlob(reference, blob) {
    let entry = pisiImageState.cache.get(reference);
    if (!entry) {
        entry = { blob, url: URL.createObjectURL(blob) };
        pisiImageState.cache.set(reference, entry);
    }
    return entry;
}

// Ensures the asset exists in this note's sidecar. A reference copied from
// another note is re-stored from the session blob; the content hash, and so the
// reference, stays the same.
function ensurePisiImageAsset(nodePath, reference) {
    const key = `${nodePath}\n${reference}`;
    if (pisiImageState.verified.has(key)) return Promise.resolve(pisiImageState.cache.get(reference) || null);
    if (pisiImageState.pending.has(key)) return pisiImageState.pending.get(key);
    const task = (async () => {
        const read = await window.pisiDomain?.query?.('editor.asset.read.v1', { nodePath, reference });
        if (read?.ok) {
            pisiImageState.verified.add(key);
            return pisiImageState.cache.get(reference) || cachePisiImageBlob(reference, new Blob([read.bytes], { type: read.mime }));
        }
        const cached = pisiImageState.cache.get(reference);
        if (read?.code === 'IMAGE_NOT_FOUND' && cached) {
            const bytes = new Uint8Array(await cached.blob.arrayBuffer());
            const stored = await window.pisiDomain?.command?.('editor.asset.store.v1', { nodePath, bytes });
            if (stored?.ok && stored.reference === reference) {
                pisiImageState.verified.add(key);
                return cached;
            }
        }
        return null;
    })()
        .catch((error) => {
            console.warn('[PISI] Görsel yüklenemedi:', error);
            return null;
        })
        .finally(() => pisiImageState.pending.delete(key));
    pisiImageState.pending.set(key, task);
    return task;
}

function applyPisiImageWidth(img) {
    const width = normalizePisiImageWidth(img.dataset.pisiImageWidth);
    img.style.width = width ? `${width}px` : '';
}

async function hydratePisiImageElement(editor, img) {
    const reference = img?.getAttribute('data-pisi-image-asset');
    if (!editor || !isPisiImageReference(reference)) return false;
    applyPisiImageWidth(img);
    const block = img.closest('.pisi-image-block');
    const cached = pisiImageState.cache.get(reference);
    if (cached && img.getAttribute('src') !== cached.url) img.src = cached.url;
    const nodePath = getPisiImageEditorNodePath(editor);
    if (!nodePath) return Boolean(cached);
    const entry = await ensurePisiImageAsset(nodePath, reference);
    if (!img.isConnected) return false;
    if (entry && img.getAttribute('src') !== entry.url) img.src = entry.url;
    if (block) block.dataset.pisiImageState = entry ? 'ready' : 'missing';
    return Boolean(entry);
}

function hydratePisiImagesIn(root) {
    const editor = getPisiImageEditor(root) || (root?.matches?.('.pisi-rich-editor') ? root : null);
    if (!editor) return [];
    const images = root.matches?.('img[data-pisi-image-asset]') ? [root] : Array.from(root.querySelectorAll?.('img[data-pisi-image-asset]') || []);
    return images.map((img) => hydratePisiImageElement(editor, img));
}

function hydratePisiActiveEditorImages() {
    document.querySelectorAll('.pisi-rich-editor').forEach((editor) => hydratePisiImagesIn(editor));
}

async function rasterizePisiSvgFile(file) {
    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const width = Math.min(4096, image.naturalWidth || 1024);
        const height = Math.min(4096, image.naturalHeight || Math.round(width * 0.75));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(image, 0, 0, width, height);
        return await new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('SVG'))), 'image/png'));
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function storePisiImageFile(editor, file) {
    const nodePath = getPisiImageEditorNodePath(editor);
    if (!nodePath) return { ok: false, code: 'IMAGE_NO_NOTE' };
    if (!isPisiImageFileTypeAccepted(file?.type)) return { ok: false, code: 'IMAGE_UNSUPPORTED' };
    let blob = file;
    if (PISI_IMAGE_RASTERIZED_TYPES.includes(String(file.type).toLowerCase())) {
        try {
            blob = await rasterizePisiSvgFile(file);
        } catch {
            return { ok: false, code: 'IMAGE_SVG_FAILED' };
        }
    }
    if (blob.size > PISI_IMAGE_MAX_BYTES) return { ok: false, code: 'IMAGE_TOO_LARGE' };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const stored = await window.pisiDomain?.command?.('editor.asset.store.v1', { nodePath, bytes });
    if (!stored?.ok) return stored || { ok: false, code: 'IMAGE_EMPTY' };
    cachePisiImageBlob(stored.reference, new Blob([bytes], { type: stored.mime }));
    pisiImageState.verified.add(`${nodePath}\n${stored.reference}`);
    return stored;
}

function getPisiImageAnchorBlock(editor, point = null) {
    let element = null;
    if (point) element = document.elementFromPoint(point.x, point.y);
    if (!element || !editor.contains(element)) {
        const selection = window.getSelection?.();
        element = selection?.rangeCount ? selection.getRangeAt(0).startContainer : null;
        if (element && !editor.contains(element)) element = null;
    }
    let block = element?.nodeType === Node.ELEMENT_NODE ? element : element?.parentElement;
    while (block && block.parentElement !== editor) block = block.parentElement;
    if (block && block !== editor) return block;
    const active = pisiImageState.activeBlock?.parentElement === editor ? pisiImageState.activeBlock : null;
    return active || editor.lastElementChild;
}

function makePisiImageParagraph() {
    const paragraph = document.createElement('div');
    paragraph.className = 'pisi-editor-block';
    paragraph.dataset.pisiBlockId = window.makePisiBlockId?.() || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    paragraph.dataset.pisiBlockType = 'paragraph';
    paragraph.innerHTML = '<br>';
    return paragraph;
}

function isPisiImageBlockElement(element) {
    return Boolean(element?.matches?.('.pisi-image-block'));
}

function isPisiEmptyParagraph(block) {
    return block?.dataset?.pisiBlockType !== 'image' && !block?.textContent?.trim() && !block?.querySelector?.('*:not(br)');
}

async function insertPisiImageFiles(editor, files, options = {}) {
    const list = Array.from(files || []).filter(Boolean);
    if (!editor || !list.length) return [];
    let previous = options.anchorBlock?.parentElement === editor ? options.anchorBlock : null;
    const inserted = [];
    for (const file of list) {
        const result = await storePisiImageFile(editor, file);
        if (!result?.ok) {
            reportPisiImageError(result?.code, result?.error);
            continue;
        }
        const template = document.createElement('template');
        template.innerHTML = makePisiImageBlockHtml({ reference: result.reference, align: 'center', blockId: window.makePisiBlockId?.() });
        const block = template.content.firstElementChild;
        if (!block || !editor.isConnected) continue;
        if (previous?.isConnected && previous.parentElement === editor) {
            if (!inserted.length && isPisiEmptyParagraph(previous)) previous.replaceWith(block);
            else previous.after(block);
        } else {
            editor.appendChild(block);
        }
        previous = block;
        inserted.push(block);
        void hydratePisiImageElement(editor, block.querySelector('img'));
    }
    if (!inserted.length) return inserted;
    if (!previous.nextElementSibling || isPisiImageBlockElement(previous.nextElementSibling)) previous.after(makePisiImageParagraph());
    editor.focus({ preventScroll: true });
    window.placeCaretAtStartOfPisiBlock?.(window.getSelection?.(), previous.nextElementSibling);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    return inserted;
}

function openPisiImagePicker(editor) {
    if (!editor) return false;
    if (!getPisiImageEditorNodePath(editor)) {
        reportPisiImageError('IMAGE_NO_NOTE');
        return false;
    }
    const anchorBlock = getPisiImageAnchorBlock(editor);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = PISI_IMAGE_PICKER_ACCEPT;
    input.multiple = true;
    input.addEventListener('change', () => void insertPisiImageFiles(editor, input.files, { anchorBlock }), { once: true });
    input.click();
    return true;
}

function getPisiImageFiles(dataTransfer) {
    return Array.from(dataTransfer?.files || []).filter((file) => isPisiImageFileTypeAccepted(file.type));
}

function handlePisiImagePaste(event) {
    const editor = getPisiImageEditor(event.target);
    if (!editor || editor.getAttribute('contenteditable') === 'false' || event.target?.closest?.(PISI_IMAGE_SKIP_TARGETS)) return;
    if (pisiImageState.activeBlock && !event.clipboardData?.files?.length) return;
    const files = getPisiImageFiles(event.clipboardData);
    const html = event.clipboardData?.getData('text/html') || '';
    if (!shouldPisiPasteAsImageFiles({ fileTypes: files.map((file) => file.type), html })) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void insertPisiImageFiles(editor, files, { anchorBlock: getPisiImageAnchorBlock(editor) });
}

function hasPisiImageDragFiles(dataTransfer) {
    return Array.from(dataTransfer?.items || []).some((item) => item.kind === 'file' && isPisiImageFileTypeAccepted(item.type));
}

function handlePisiImageDragOver(event) {
    if (!getPisiImageEditor(event.target) || !hasPisiImageDragFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
}

function handlePisiImageDrop(event) {
    const editor = getPisiImageEditor(event.target);
    const files = getPisiImageFiles(event.dataTransfer);
    if (!editor || !files.length || event.target?.closest?.(PISI_IMAGE_SKIP_TARGETS)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void insertPisiImageFiles(editor, files, { anchorBlock: getPisiImageAnchorBlock(editor, { x: event.clientX, y: event.clientY }) });
}

function notifyPisiImageBlockChanged(block, inputType = 'formatSetBlockTextDirection') {
    getPisiImageEditor(block)?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
}

function makePisiImageControlButton(label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.pisiImageAction = action;
    button.textContent = pisiImageTranslate(label);
    return button;
}

function ensurePisiImageControls() {
    if (pisiImageState.controls?.isConnected) return pisiImageState.controls;
    const controls = document.createElement('div');
    controls.className = 'pisi-image-controls';
    controls.hidden = true;
    const toolbar = document.createElement('div');
    toolbar.className = 'pisi-image-controls-toolbar';
    toolbar.append(
        makePisiImageControlButton('Sol', 'left'),
        makePisiImageControlButton('Orta', 'center'),
        makePisiImageControlButton('Sağ', 'right'),
        makePisiImageControlButton('Alt metin', 'alt'),
        makePisiImageControlButton('Önizle', 'preview')
    );
    const altRow = document.createElement('label');
    altRow.className = 'pisi-image-controls-alt';
    altRow.hidden = true;
    const altInput = document.createElement('input');
    altInput.type = 'text';
    altInput.maxLength = 500;
    altInput.placeholder = pisiImageTranslate('Görseli kısaca tanımlayın');
    altRow.append(altInput);
    const handle = document.createElement('div');
    handle.className = 'pisi-image-resize-handle';
    handle.title = pisiImageTranslate('Boyutu değiştir (çift tıklama: sıfırla)');
    controls.append(toolbar, altRow, handle);
    document.body.appendChild(controls);

    controls.addEventListener('mousedown', (event) => {
        if (event.target !== altInput) event.preventDefault();
    });
    toolbar.addEventListener('click', (event) => {
        const action = event.target.closest('[data-pisi-image-action]')?.dataset.pisiImageAction;
        const block = pisiImageState.activeBlock;
        if (!action || !block?.isConnected) return;
        if (action === 'preview') return openPisiImageLightbox(block.querySelector('img'));
        if (action === 'alt') {
            altRow.hidden = !altRow.hidden;
            altInput.value = block.querySelector('img')?.alt || '';
            if (!altRow.hidden) altInput.focus();
            return;
        }
        block.dataset.pisiImageAlign = normalizePisiImageAlign(action);
        notifyPisiImageBlockChanged(block);
        schedulePisiImageControlsPosition();
    });
    const commitAlt = () => {
        const img = pisiImageState.activeBlock?.querySelector('img');
        if (!img) return;
        const alt = normalizePisiImageAlt(altInput.value);
        if (img.alt !== alt) {
            img.alt = alt;
            notifyPisiImageBlockChanged(img);
        }
    };
    altInput.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
            event.preventDefault();
            commitAlt();
            altRow.hidden = true;
        } else if (event.key === 'Escape') {
            altRow.hidden = true;
        }
    });
    altInput.addEventListener('blur', commitAlt);
    handle.addEventListener('pointerdown', startPisiImageResize);
    handle.addEventListener('dblclick', () => {
        const img = pisiImageState.activeBlock?.querySelector('img');
        if (!img?.dataset.pisiImageWidth) return;
        delete img.dataset.pisiImageWidth;
        applyPisiImageWidth(img);
        notifyPisiImageBlockChanged(img);
        schedulePisiImageControlsPosition();
    });
    pisiImageState.controls = controls;
    return controls;
}

function positionPisiImageControls() {
    pisiImageState.frame = 0;
    const controls = pisiImageState.controls;
    const block = pisiImageState.activeBlock;
    const img = block?.querySelector('img');
    if (!controls) return;
    if (!block?.isConnected || !img) {
        controls.hidden = true;
        pisiImageState.activeBlock = null;
        return;
    }
    const rect = img.getBoundingClientRect();
    controls.hidden = false;
    controls.style.left = `${Math.round(rect.left)}px`;
    controls.style.top = `${Math.round(rect.top)}px`;
    controls.style.width = `${Math.round(rect.width)}px`;
    controls.style.height = `${Math.round(rect.height)}px`;
    controls.querySelectorAll('[data-pisi-image-action]').forEach((button) => {
        button.classList.toggle('active', button.dataset.pisiImageAction === normalizePisiImageAlign(block.dataset.pisiImageAlign));
    });
}

function schedulePisiImageControlsPosition() {
    if (!pisiImageState.frame) pisiImageState.frame = requestAnimationFrame(positionPisiImageControls);
}

function selectPisiImageBlock(block) {
    const editor = getPisiImageEditor(block);
    if (!editor) return;
    pisiImageState.activeBlock = block;
    // The selection spans the block node itself, as a selected image does in a
    // desktop editor; without it Chromium drops a caret into the first editable
    // block on the next key press and block commands would target that block.
    editor.focus({ preventScroll: true });
    const index = Array.prototype.indexOf.call(editor.childNodes, block);
    window.getSelection?.()?.setBaseAndExtent(editor, index, editor, index + 1);
    window.selectPisiBlock?.(editor, block);
    const controls = ensurePisiImageControls();
    controls.querySelector('.pisi-image-controls-alt').hidden = true;
    positionPisiImageControls();
}

function deselectPisiImageBlock() {
    pisiImageState.activeBlock?.classList.remove('pisi-block-active');
    pisiImageState.activeBlock = null;
    if (pisiImageState.controls) pisiImageState.controls.hidden = true;
}

function startPisiImageResize(event) {
    const block = pisiImageState.activeBlock;
    const img = block?.querySelector('img');
    const editor = getPisiImageEditor(block);
    if (!img || !editor) return;
    event.preventDefault();
    const align = normalizePisiImageAlign(block.dataset.pisiImageAlign);
    pisiImageState.resize = {
        img,
        startX: event.clientX,
        startWidth: img.getBoundingClientRect().width,
        factor: align === 'center' ? 2 : align === 'right' ? -1 : 1,
        maxWidth: Math.max(40, block.clientWidth)
    };
    event.target.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
        const resize = pisiImageState.resize;
        if (!resize) return;
        const width = Math.min(resize.maxWidth, Math.max(40, resize.startWidth + (moveEvent.clientX - resize.startX) * resize.factor));
        resize.img.style.width = `${Math.round(width)}px`;
        positionPisiImageControls();
    };
    const end = () => {
        const resize = pisiImageState.resize;
        pisiImageState.resize = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        if (!resize?.img.isConnected) return;
        const width = normalizePisiImageWidth(resize.img.getBoundingClientRect().width);
        if (width && width !== resize.img.dataset.pisiImageWidth) {
            resize.img.dataset.pisiImageWidth = width;
            notifyPisiImageBlockChanged(resize.img);
        }
        applyPisiImageWidth(resize.img);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
}

function openPisiImageLightbox(img) {
    if (!img?.src) return false;
    let lightbox = pisiImageState.lightbox;
    if (!lightbox?.isConnected) {
        lightbox = document.createElement('div');
        lightbox.className = 'pisi-image-lightbox';
        lightbox.setAttribute('role', 'dialog');
        lightbox.setAttribute('aria-modal', 'true');
        lightbox.tabIndex = -1;
        lightbox.append(document.createElement('img'));
        lightbox.addEventListener('click', () => closePisiImageLightbox());
        lightbox.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closePisiImageLightbox();
        });
        document.body.appendChild(lightbox);
        pisiImageState.lightbox = lightbox;
    }
    const preview = lightbox.querySelector('img');
    preview.src = img.src;
    preview.alt = img.alt || '';
    lightbox.hidden = false;
    lightbox.focus();
    return true;
}

function closePisiImageLightbox() {
    if (!pisiImageState.lightbox || pisiImageState.lightbox.hidden) return false;
    pisiImageState.lightbox.hidden = true;
    getPisiImageEditor(pisiImageState.activeBlock)?.focus({ preventScroll: true });
    return true;
}

function handlePisiImagePointerDown(event) {
    if (event.target?.closest?.('.pisi-image-controls, .pisi-image-lightbox')) return;
    const block = event.target?.closest?.('.pisi-image-block');
    if (!block || !getPisiImageEditor(block)) {
        if (pisiImageState.activeBlock) deselectPisiImageBlock();
        return;
    }
    event.preventDefault();
    if (pisiImageState.activeBlock === block && event.target.matches('img')) {
        openPisiImageLightbox(event.target);
        return;
    }
    selectPisiImageBlock(block);
}

function removePisiActiveImageBlock(inputType) {
    const block = pisiImageState.activeBlock;
    const editor = getPisiImageEditor(block);
    if (!block || !editor) return false;
    const next = block.nextElementSibling || block.previousElementSibling;
    deselectPisiImageBlock();
    block.remove();
    if (!editor.firstElementChild) editor.appendChild(makePisiImageParagraph());
    editor.focus({ preventScroll: true });
    const target = next?.isConnected ? next : editor.firstElementChild;
    if (isPisiImageBlockElement(target)) selectPisiImageBlock(target);
    else window.placeCaretAtStartOfPisiBlock?.(window.getSelection?.(), target);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
    return true;
}

function writePisiImageClipboard(event, block) {
    const clone = block.cloneNode(true);
    clone.classList.remove('pisi-block-active');
    clone.removeAttribute('data-pisi-image-state');
    clone.querySelectorAll('img').forEach((img) => {
        img.removeAttribute('src');
        img.removeAttribute('style');
    });
    event.clipboardData.setData('text/html', clone.outerHTML);
    event.clipboardData.setData('text/plain', clone.querySelector('img')?.alt || '');
    event.preventDefault();
}

function isPisiImageBlockSelectionOnly(block) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount || selection.isCollapsed) return true;
    const range = selection.getRangeAt(0);
    const editor = block.parentElement;
    const index = Array.prototype.indexOf.call(editor?.childNodes || [], block);
    return range.startContainer === editor && range.endContainer === editor && range.startOffset === index && range.endOffset === index + 1;
}

function handlePisiImageClipboard(event) {
    const block = pisiImageState.activeBlock;
    if (!block?.isConnected || !event.clipboardData || !isPisiImageBlockSelectionOnly(block)) return;
    writePisiImageClipboard(event, block);
    if (event.type === 'cut') removePisiActiveImageBlock('deleteByCut');
}

function handlePisiImageKeydown(event) {
    if (event.key === 'Escape' && closePisiImageLightbox()) return;
    const block = pisiImageState.activeBlock;
    if (!block?.isConnected || event.target?.closest?.('.pisi-image-controls')) return;
    // Only the editor that owns the selected image may act on it.
    if (document.activeElement !== getPisiImageEditor(block)) return;
    if (event.key === 'Escape') {
        deselectPisiImageBlock();
        return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        event.stopImmediatePropagation();
        removePisiActiveImageBlock(event.key === 'Delete' ? 'deleteContentForward' : 'deleteContentBackward');
        return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openPisiImageLightbox(block.querySelector('img'));
        return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
        // Typing continues below the image instead of replacing the selected block.
        const editor = getPisiImageEditor(block);
        let next = block.nextElementSibling;
        if (!next || isPisiImageBlockElement(next)) {
            next = makePisiImageParagraph();
            block.after(next);
        }
        deselectPisiImageBlock();
        window.placeCaretAtStartOfPisiBlock?.(window.getSelection?.(), next);
        window.selectPisiBlock?.(editor, next);
    }
}

function observePisiImageMutations(mutations) {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && (node.matches('img[data-pisi-image-asset]') || node.querySelector('img[data-pisi-image-asset]'))) {
                hydratePisiImagesIn(node);
            }
        }
    }
    if (pisiImageState.activeBlock && !pisiImageState.activeBlock.isConnected) deselectPisiImageBlock();
}

function ensurePisiImageBlockStyle() {
    if (document.querySelector('link[data-pisi-image-block-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/editor/pisi-editor-image-block.css';
    link.dataset.pisiImageBlockStyle = '1';
    document.head.appendChild(link);
}

function initializePisiImageBlocks() {
    if (pisiImageState.initialized) return false;
    pisiImageState.initialized = true;
    ensurePisiImageBlockStyle();
    document.addEventListener('paste', handlePisiImagePaste, true);
    document.addEventListener('dragover', handlePisiImageDragOver, true);
    document.addEventListener('drop', handlePisiImageDrop, true);
    document.addEventListener('pointerdown', handlePisiImagePointerDown, true);
    document.addEventListener('keydown', handlePisiImageKeydown, true);
    document.addEventListener('copy', handlePisiImageClipboard, true);
    document.addEventListener('cut', handlePisiImageClipboard, true);
    document.addEventListener('scroll', schedulePisiImageControlsPosition, true);
    window.addEventListener('resize', schedulePisiImageControlsPosition);
    document.addEventListener('pisi:image-insert-request', (event) => openPisiImagePicker(getPisiImageEditorFromRequest(event.detail)));
    document.addEventListener('pisi:active-node-changed', () => queueMicrotask(hydratePisiActiveEditorImages));
    new MutationObserver(observePisiImageMutations).observe(document.body, { childList: true, subtree: true });
    hydratePisiActiveEditorImages();
    return true;
}

const moduleApi = {
    pisiImageState,
    hydratePisiImagesIn,
    insertPisiImageFiles,
    openPisiImagePicker,
    openPisiImageLightbox,
    selectPisiImageBlock,
    initializePisiImageBlocks
};

registerModule('editor.imageBlocks', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiImageBlocks, { once: true });
} else {
    initializePisiImageBlocks();
}

export {
    hydratePisiImagesIn,
    initializePisiImageBlocks,
    insertPisiImageFiles,
    openPisiImageLightbox,
    openPisiImagePicker,
    pisiImageState,
    selectPisiImageBlock
};
