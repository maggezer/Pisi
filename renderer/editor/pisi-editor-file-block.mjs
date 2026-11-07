import { registerModule } from '../core/module-registry.mjs';
import {
    PISI_FILE_MAX_BYTES,
    getPisiFileErrorMessage,
    getPisiFileKind,
    getPisiFileReferenceExtension,
    isPisiExecutableFileExtension,
    isPisiFileReference,
    makePisiFileBlockHtml,
    makePisiFileBlockInnerHtml,
    splitPisiDroppedFiles
} from './pisi-editor-file-policy.mjs';
import { shouldPisiPasteAsImageFiles } from './pisi-editor-image-policy.mjs';

// Attachment blocks persist a sidecar reference (file/<sha256>.<ext>) with the
// original name and size. Main resolves every path, verifies the hash and
// decides whether a click opens the file or only shows it in its folder.
// Image files dropped or pasted together with other files still become image
// blocks through insertPisiImageFiles.

const PISI_FILE_SKIP_TARGETS = 'input, textarea, select, .pisi-sheet-block, .pisi-canvas-block, table[data-pisi-sheet], canvas[data-pisi-canvas]';
const pisiFileState = {
    // reference -> note path known to hold the asset in this session
    sources: new Map(),
    verified: new Set(),
    pending: new Map(),
    activeBlock: null,
    initialized: false
};

function pisiFileTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function getPisiFileEditor(target) {
    const element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    return element?.closest?.('.pisi-rich-editor') || null;
}

function getPisiFileEditorNodePath(editor) {
    if (editor?.id === 'node-modal-content') return window.activeModalNode?.path || null;
    if (editor?.id === 'center-node-editor-content') return window.activeCenterNode?.path || null;
    return null;
}

function getPisiFileEditorFromRequest(detail = {}) {
    if (detail.editor?.isConnected) return detail.editor;
    if (detail.editorTarget) return document.getElementById(detail.editorTarget);
    return window.getPisiActiveBlocksEditor?.() || null;
}

function reportPisiFileError(code, fallback) {
    pisiNotifyError(pisiFileTranslate(getPisiFileErrorMessage(code, fallback)));
}

function renderPisiFileBlock(block) {
    const reference = block.dataset.pisiFileAsset;
    const kind = getPisiFileKind(getPisiFileReferenceExtension(reference));
    if (block.dataset.pisiFileKind !== kind) block.dataset.pisiFileKind = kind;
    const inner = makePisiFileBlockInnerHtml({ name: block.dataset.pisiFileName, size: block.dataset.pisiFileSize });
    if (block.innerHTML !== inner) block.innerHTML = inner;
    const executable = isPisiExecutableFileExtension(getPisiFileReferenceExtension(reference));
    block.title = pisiFileTranslate(executable ? 'Klasörde göster (çalıştırılabilir dosya açılmaz)' : 'Varsayılan uygulamada aç');
    block.setAttribute('role', 'button');
    block.tabIndex = -1;
}

// Ensures the asset exists in this note's sidecar. A block pasted from another
// note is copied from the note that held it earlier in this session.
function ensurePisiFileAsset(nodePath, reference) {
    const key = `${nodePath}\n${reference}`;
    if (pisiFileState.verified.has(key)) return Promise.resolve(true);
    if (pisiFileState.pending.has(key)) return pisiFileState.pending.get(key);
    const task = (async () => {
        const stat = await window.pisiDomain?.query?.('editor.file.stat.v1', { nodePath, reference });
        let ok = Boolean(stat?.ok);
        const source = pisiFileState.sources.get(reference);
        if (!ok && stat?.code === 'FILE_NOT_FOUND' && source && source !== nodePath) {
            const copied = await window.pisiDomain?.command?.('editor.file.copy.v1', { nodePath, sourceNodePath: source, reference });
            ok = Boolean(copied?.ok);
        }
        if (ok) {
            pisiFileState.verified.add(key);
            if (!pisiFileState.sources.has(reference)) pisiFileState.sources.set(reference, nodePath);
        }
        return ok;
    })()
        .catch((error) => {
            console.warn('[PISI] Ek doğrulanamadı:', error);
            return false;
        })
        .finally(() => pisiFileState.pending.delete(key));
    pisiFileState.pending.set(key, task);
    return task;
}

async function hydratePisiFileBlock(editor, block) {
    if (!editor || !isPisiFileReference(block?.dataset?.pisiFileAsset)) return false;
    renderPisiFileBlock(block);
    const nodePath = getPisiFileEditorNodePath(editor);
    if (!nodePath) return false;
    const ok = await ensurePisiFileAsset(nodePath, block.dataset.pisiFileAsset);
    if (block.isConnected) block.dataset.pisiFileState = ok ? 'ready' : 'missing';
    return ok;
}

function hydratePisiFilesIn(root) {
    const editor = getPisiFileEditor(root) || (root?.matches?.('.pisi-rich-editor') ? root : null);
    if (!editor) return [];
    const blocks = root.matches?.('.pisi-file-block') ? [root] : Array.from(root.querySelectorAll?.('.pisi-file-block') || []);
    return blocks.map((block) => hydratePisiFileBlock(editor, block));
}

function hydratePisiActiveEditorFiles() {
    document.querySelectorAll('.pisi-rich-editor').forEach((editor) => hydratePisiFilesIn(editor));
}

async function storePisiAttachmentFile(editor, file) {
    const nodePath = getPisiFileEditorNodePath(editor);
    if (!nodePath) return { ok: false, code: 'FILE_NO_NOTE' };
    if (!file?.size) return { ok: false, code: 'FILE_EMPTY' };
    if (file.size > PISI_FILE_MAX_BYTES) return { ok: false, code: 'FILE_TOO_LARGE' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const stored = await window.pisiDomain?.command?.('editor.file.store.v1', { nodePath, bytes, name: file.name });
    if (!stored?.ok) return stored || { ok: false, code: 'FILE_EMPTY' };
    pisiFileState.sources.set(stored.reference, nodePath);
    pisiFileState.verified.add(`${nodePath}\n${stored.reference}`);
    return stored;
}

function getPisiFileAnchorBlock(editor, point = null) {
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
    const active = pisiFileState.activeBlock?.parentElement === editor ? pisiFileState.activeBlock : null;
    return active || editor.lastElementChild;
}

function makePisiFileParagraph() {
    const paragraph = document.createElement('div');
    paragraph.className = 'pisi-editor-block';
    paragraph.dataset.pisiBlockId = window.makePisiBlockId?.() || `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    paragraph.dataset.pisiBlockType = 'paragraph';
    paragraph.innerHTML = '<br>';
    return paragraph;
}

function isPisiAtomicBlock(element) {
    return Boolean(element?.matches?.('.pisi-file-block, .pisi-image-block'));
}

function isPisiEmptyFileParagraph(block) {
    return !isPisiAtomicBlock(block) && !block?.textContent?.trim() && !block?.querySelector?.('*:not(br)');
}

async function insertPisiAttachmentFiles(editor, files, options = {}) {
    const list = Array.from(files || []).filter(Boolean);
    if (!editor || !list.length) return [];
    let previous = options.anchorBlock?.parentElement === editor ? options.anchorBlock : null;
    const inserted = [];
    for (const file of list) {
        const result = await storePisiAttachmentFile(editor, file);
        if (!result?.ok) {
            reportPisiFileError(result?.code, result?.error);
            continue;
        }
        const template = document.createElement('template');
        template.innerHTML = makePisiFileBlockHtml({ reference: result.reference, name: result.name, size: result.size, blockId: window.makePisiBlockId?.() });
        const block = /** @type {HTMLElement | null} */ (template.content.firstElementChild);
        if (!block || !editor.isConnected) continue;
        if (previous?.isConnected && previous.parentElement === editor) {
            if (!inserted.length && !options.keepAnchor && isPisiEmptyFileParagraph(previous)) previous.replaceWith(block);
            else previous.after(block);
        } else {
            editor.appendChild(block);
        }
        previous = block;
        inserted.push(block);
        void hydratePisiFileBlock(editor, block);
    }
    if (!inserted.length) return inserted;
    if (!previous.nextElementSibling || isPisiAtomicBlock(previous.nextElementSibling)) previous.after(makePisiFileParagraph());
    editor.focus({ preventScroll: true });
    window.placeCaretAtStartOfPisiBlock?.(window.getSelection?.(), previous.nextElementSibling);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    return inserted;
}

/** Images become image blocks, everything else attachment blocks, in transfer order by kind. */
async function insertPisiDroppedFiles(editor, files, anchorBlock) {
    const { images, attachments } = splitPisiDroppedFiles(files);
    let anchor = anchorBlock;
    if (images.length && typeof window.insertPisiImageFiles === 'function') {
        const blocks = await window.insertPisiImageFiles(editor, images, { anchorBlock: anchor });
        if (blocks?.length) anchor = blocks[blocks.length - 1];
    }
    if (attachments.length) await insertPisiAttachmentFiles(editor, attachments, { anchorBlock: anchor, keepAnchor: anchor !== anchorBlock });
}

function openPisiFilePicker(editor) {
    if (!editor) return false;
    if (!getPisiFileEditorNodePath(editor)) {
        reportPisiFileError('FILE_NO_NOTE');
        return false;
    }
    const anchorBlock = getPisiFileAnchorBlock(editor);
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.addEventListener('change', () => void insertPisiDroppedFiles(editor, input.files, anchorBlock), { once: true });
    input.click();
    return true;
}

function hasPisiNonImageFiles(files) {
    return splitPisiDroppedFiles(files).attachments.length > 0;
}

function handlePisiFilePaste(event) {
    const editor = getPisiFileEditor(event.target);
    if (!editor || editor.getAttribute('contenteditable') === 'false' || event.target?.closest?.(PISI_FILE_SKIP_TARGETS)) return;
    const files = Array.from(event.clipboardData?.files || []);
    if (!hasPisiNonImageFiles(files)) return;
    // Same rule as images: an Office selection that ships files next to its text pastes as text.
    const html = event.clipboardData?.getData('text/html') || '';
    if (!shouldPisiPasteAsImageFiles({ fileTypes: ['image/png'], html })) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void insertPisiDroppedFiles(editor, files, getPisiFileAnchorBlock(editor));
}

function handlePisiFileDragOver(event) {
    if (!getPisiFileEditor(event.target) || !Array.from(event.dataTransfer?.items || []).some((item) => item.kind === 'file')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
}

function handlePisiFileDrop(event) {
    const editor = getPisiFileEditor(event.target);
    const files = Array.from(event.dataTransfer?.files || []);
    if (!editor || !hasPisiNonImageFiles(files) || event.target?.closest?.(PISI_FILE_SKIP_TARGETS)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void insertPisiDroppedFiles(editor, files, getPisiFileAnchorBlock(editor, { x: event.clientX, y: event.clientY }));
}

async function openPisiFileBlock(block, options = {}) {
    const editor = getPisiFileEditor(block);
    const nodePath = getPisiFileEditorNodePath(editor);
    const reference = block?.dataset?.pisiFileAsset;
    if (!nodePath || !isPisiFileReference(reference)) return { ok: false, code: 'FILE_REFERENCE_INVALID' };
    await ensurePisiFileAsset(nodePath, reference);
    const result = await window.pisiDomain?.command?.('editor.file.open.v1', { nodePath, reference, reveal: options.reveal === true });
    if (!result?.ok) reportPisiFileError(result?.code, result?.error);
    return result || { ok: false, code: 'FILE_OPEN_FAILED' };
}

function selectPisiFileBlock(block) {
    const editor = getPisiFileEditor(block);
    if (!editor) return;
    pisiFileState.activeBlock = block;
    if (editor.getAttribute('contenteditable') === 'false') return;
    editor.focus({ preventScroll: true });
    const index = Array.prototype.indexOf.call(editor.childNodes, block);
    window.getSelection?.()?.setBaseAndExtent(editor, index, editor, index + 1);
    window.selectPisiBlock?.(editor, block);
}

function deselectPisiFileBlock() {
    pisiFileState.activeBlock?.classList.remove('pisi-block-active');
    pisiFileState.activeBlock = null;
}

function handlePisiFilePointerDown(event) {
    const block = event.target?.closest?.('.pisi-file-block');
    if (!block || !getPisiFileEditor(block)) {
        if (pisiFileState.activeBlock) deselectPisiFileBlock();
        return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    selectPisiFileBlock(block);
}

function handlePisiFileClick(event) {
    const block = event.target?.closest?.('.pisi-file-block');
    if (!block || !getPisiFileEditor(block) || event.button !== 0) return;
    event.preventDefault();
    void openPisiFileBlock(block, { reveal: event.altKey });
}

function removePisiActiveFileBlock(inputType) {
    const block = pisiFileState.activeBlock;
    const editor = getPisiFileEditor(block);
    if (!block || !editor) return false;
    const next = block.nextElementSibling || block.previousElementSibling;
    deselectPisiFileBlock();
    block.remove();
    if (!editor.firstElementChild) editor.appendChild(makePisiFileParagraph());
    editor.focus({ preventScroll: true });
    const target = next?.isConnected ? next : editor.firstElementChild;
    if (target?.matches?.('.pisi-file-block')) selectPisiFileBlock(target);
    else window.placeCaretAtStartOfPisiBlock?.(window.getSelection?.(), target);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
    return true;
}

function isPisiFileBlockSelectionOnly(block) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount || selection.isCollapsed) return true;
    const range = selection.getRangeAt(0);
    const editor = block.parentElement;
    const index = Array.prototype.indexOf.call(editor?.childNodes || [], block);
    return range.startContainer === editor && range.endContainer === editor && range.startOffset === index && range.endOffset === index + 1;
}

function handlePisiFileClipboard(event) {
    const block = pisiFileState.activeBlock;
    if (!block?.isConnected || !event.clipboardData || !isPisiFileBlockSelectionOnly(block)) return;
    const clone = /** @type {HTMLElement} */ (block.cloneNode(true));
    clone.classList.remove('pisi-block-active');
    ['data-pisi-file-state', 'title', 'role', 'tabindex'].forEach((name) => clone.removeAttribute(name));
    event.clipboardData.setData('text/html', clone.outerHTML);
    event.clipboardData.setData('text/plain', block.dataset.pisiFileName || '');
    event.preventDefault();
    if (event.type === 'cut') removePisiActiveFileBlock('deleteByCut');
}

function handlePisiFileKeydown(event) {
    const block = pisiFileState.activeBlock;
    if (!block?.isConnected) return;
    const editor = getPisiFileEditor(block);
    if (document.activeElement !== editor) return;
    if (event.key === 'Escape') {
        deselectPisiFileBlock();
        return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void openPisiFileBlock(block, { reveal: event.altKey });
        return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        event.stopImmediatePropagation();
        removePisiActiveFileBlock(event.key === 'Delete' ? 'deleteContentForward' : 'deleteContentBackward');
        return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
        // Typing continues below the attachment instead of replacing it.
        let next = block.nextElementSibling;
        if (!next || isPisiAtomicBlock(next)) {
            next = makePisiFileParagraph();
            block.after(next);
        }
        deselectPisiFileBlock();
        window.placeCaretAtStartOfPisiBlock?.(window.getSelection?.(), next);
        window.selectPisiBlock?.(editor, next);
    }
}

function observePisiFileMutations(mutations) {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && (node.matches('.pisi-file-block') || node.querySelector('.pisi-file-block'))) hydratePisiFilesIn(node);
        }
    }
    if (pisiFileState.activeBlock && !pisiFileState.activeBlock.isConnected) deselectPisiFileBlock();
}

function ensurePisiFileBlockStyle() {
    if (document.querySelector('link[data-pisi-file-block-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/editor/pisi-editor-file-block.css';
    link.dataset.pisiFileBlockStyle = '1';
    document.head.appendChild(link);
}

function initializePisiFileBlocks() {
    if (pisiFileState.initialized) return false;
    pisiFileState.initialized = true;
    ensurePisiFileBlockStyle();
    document.addEventListener('paste', handlePisiFilePaste, true);
    document.addEventListener('dragover', handlePisiFileDragOver, true);
    document.addEventListener('drop', handlePisiFileDrop, true);
    document.addEventListener('pointerdown', handlePisiFilePointerDown, true);
    document.addEventListener('click', handlePisiFileClick, true);
    document.addEventListener('keydown', handlePisiFileKeydown, true);
    document.addEventListener('copy', handlePisiFileClipboard, true);
    document.addEventListener('cut', handlePisiFileClipboard, true);
    document.addEventListener('pisi:file-insert-request', (event) => openPisiFilePicker(getPisiFileEditorFromRequest(event.detail)));
    document.addEventListener('pisi:active-node-changed', () => queueMicrotask(hydratePisiActiveEditorFiles));
    new MutationObserver(observePisiFileMutations).observe(document.body, { childList: true, subtree: true });
    hydratePisiActiveEditorFiles();
    return true;
}

const moduleApi = {
    pisiFileState,
    hydratePisiFilesIn,
    insertPisiAttachmentFiles,
    insertPisiDroppedFiles,
    openPisiFilePicker,
    openPisiFileBlock,
    initializePisiFileBlocks
};

registerModule('editor.fileBlocks', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiFileBlocks, { once: true });
} else {
    initializePisiFileBlocks();
}

export {
    hydratePisiFilesIn,
    initializePisiFileBlocks,
    insertPisiAttachmentFiles,
    insertPisiDroppedFiles,
    openPisiFileBlock,
    openPisiFilePicker,
    pisiFileState
};
