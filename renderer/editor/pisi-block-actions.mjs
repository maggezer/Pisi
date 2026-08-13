import { registerModule } from "../core/module-registry.mjs";

const pisiBlockActionsState = {
    handle: null,
    menu: null,
    block: null,
    hideTimer: null,
    pickerOverlay: null,
    pickerInput: null,
    pickerResults: null,
    pickerSourceBlock: null,
    insertionRange: null,
    candidates: []
};

function pisiBlockActionsTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function normalizePisiBlockActionText(value = '') {
    return String(value || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getPisiBlockActionContext(block) {
    const editor = block?.closest?.('.pisi-rich-editor');
    const active = editor?.id === 'node-modal-content'
        ? window.activeModalNode
        : window.activeCenterNode;
    return {
        editor,
        nodePath: active?.path || '',
        nodeTitle: active?.metadata?.title ||
            String(active?.path || '').split(/[\\/]/).pop()?.replace(/\.node$/i, '') ||
            'Node'
    };
}

function getPisiBlockActionPreview(block, length = 72) {
    const text = String(block?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
    return (text || pisiBlockActionsTranslate('(boş blok)')).slice(0, length);
}

function clearPisiBlockHandleHideTimer() {
    clearTimeout(pisiBlockActionsState.hideTimer);
    pisiBlockActionsState.hideTimer = null;
}

function positionPisiBlockHandle(block) {
    const handle = ensurePisiBlockHandle();
    if (!block?.isConnected) {
        handle.hidden = true;
        return false;
    }
    const rect = block.getBoundingClientRect();
    handle.style.left = `${Math.max(6, rect.left - 29)}px`;
    handle.style.top = `${Math.max(6, rect.top + 1)}px`;
    handle.hidden = false;
    pisiBlockActionsState.block = block;
    return true;
}

function schedulePisiBlockHandleHide(delay = 140) {
    clearPisiBlockHandleHideTimer();
    pisiBlockActionsState.hideTimer = setTimeout(() => {
        pisiBlockActionsState.hideTimer = null;
        if (pisiBlockActionsState.menu && !pisiBlockActionsState.menu.hidden) return;
        if (pisiBlockActionsState.handle) pisiBlockActionsState.handle.hidden = true;
    }, delay);
}

function ensurePisiBlockHandle() {
    if (pisiBlockActionsState.handle?.isConnected) {
        return pisiBlockActionsState.handle;
    }
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'pisi-block-handle';
    handle.hidden = true;
    handle.title = pisiBlockActionsTranslate('Blok işlemleri');
    handle.setAttribute('aria-label', handle.title);
    const icon = document.createElement('span');
    icon.className = 'pisi-block-handle-icon';
    icon.setAttribute('aria-hidden', 'true');
    handle.appendChild(icon);
    handle.addEventListener('mouseenter', clearPisiBlockHandleHideTimer);
    handle.addEventListener('mouseleave', () => schedulePisiBlockHandleHide());
    handle.addEventListener('mousedown', (event) => event.preventDefault());
    handle.addEventListener('click', () => {
        const block = pisiBlockActionsState.block;
        if (!block) return;
        window.selectPisiBlock?.(block.closest('.pisi-rich-editor'), block);
        togglePisiBlockActionsMenu(block);
    });
    document.body.appendChild(handle);
    pisiBlockActionsState.handle = handle;
    return handle;
}

function makePisiBlockMenuButton(action, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pisi-block-action-menu-item';
    button.dataset.blockAction = action;
    button.textContent = pisiBlockActionsTranslate(label);
    return button;
}

function ensurePisiBlockActionsMenu() {
    if (pisiBlockActionsState.menu?.isConnected) {
        return pisiBlockActionsState.menu;
    }
    const menu = document.createElement('div');
    menu.className = 'pisi-block-action-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.append(
        makePisiBlockMenuButton('reference', 'Blok referansı ekle'),
        makePisiBlockMenuButton('copy', 'Blok bağlantısını kopyala'),
        makePisiBlockMenuButton('connections', 'Kullanıldığı yerleri göster')
    );
    const separator = document.createElement('div');
    separator.className = 'pisi-block-action-menu-separator';
    separator.setAttribute('role', 'separator');
    menu.append(
        separator,
        makePisiBlockMenuButton('duplicate', 'Bloğu çoğalt'),
        makePisiBlockMenuButton('delete', 'Bloğu sil')
    );
    menu.addEventListener('mouseenter', clearPisiBlockHandleHideTimer);
    menu.addEventListener('mouseleave', () => schedulePisiBlockHandleHide());
    menu.addEventListener('mousedown', (event) => event.preventDefault());
    menu.addEventListener('click', (event) => {
        const button = event.target.closest('[data-block-action]');
        if (!button) return;
        void runPisiBlockAction(button.dataset.blockAction, button);
    });
    document.body.appendChild(menu);
    pisiBlockActionsState.menu = menu;
    return menu;
}

function closePisiBlockActionsMenu() {
    if (pisiBlockActionsState.menu) pisiBlockActionsState.menu.hidden = true;
}

function togglePisiBlockActionsMenu(block) {
    const menu = ensurePisiBlockActionsMenu();
    const alreadyOpen = !menu.hidden && pisiBlockActionsState.block === block;
    if (alreadyOpen) {
        closePisiBlockActionsMenu();
        return false;
    }
    pisiBlockActionsState.block = block;
    positionPisiBlockHandle(block);
    const handleRect = pisiBlockActionsState.handle.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 230, handleRect.left))}px`;
    menu.style.top = `${Math.min(window.innerHeight - 230, handleRect.bottom + 5)}px`;
    menu.hidden = false;
    menu.querySelector('button')?.focus({ preventScroll: true });
    return true;
}

function capturePisiBlockInsertionRange(block) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return block?.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
}

function makePisiBlockReferenceCandidates(index, sourceBlock) {
    const source = getPisiBlockActionContext(sourceBlock);
    const sourceId = sourceBlock?.dataset?.pisiBlockId || '';
    const candidates = [];
    for (const documentRecord of index?.documents?.values?.() || []) {
        for (const block of documentRecord.contentBlocks || []) {
            if (!block.blockId) continue;
            if (documentRecord.path === source.nodePath && block.blockId === sourceId) continue;
            candidates.push({
                nodePath: documentRecord.path,
                nodeTitle: documentRecord.title || 'Node',
                relativePath: documentRecord.relativePath || '',
                mapTitle: documentRecord.memberships?.[0]?.mapTitle || '',
                blockId: block.blockId,
                preview: block.text || pisiBlockActionsTranslate('(boş blok)'),
                searchText: normalizePisiBlockActionText(
                    `${documentRecord.title} ${documentRecord.relativePath} ${block.text}`
                ),
                currentNode: documentRecord.path === source.nodePath,
                nodeItem: documentRecord.nodeItem,
                membership: documentRecord.memberships?.[0] || null
            });
        }
    }
    return candidates.sort((a, b) => {
        if (a.currentNode !== b.currentNode) return a.currentNode ? -1 : 1;
        return a.nodeTitle.localeCompare(b.nodeTitle, 'tr');
    });
}

function renderPisiBlockReferencePickerResults(query = '') {
    const host = pisiBlockActionsState.pickerResults;
    if (!host) return;
    const normalized = normalizePisiBlockActionText(query);
    const matches = pisiBlockActionsState.candidates
        .filter((candidate) => !normalized || candidate.searchText.includes(normalized))
        .slice(0, 80);
    if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'pisi-block-reference-picker-empty';
        empty.textContent = pisiBlockActionsTranslate('Eşleşen blok yok.');
        host.replaceChildren(empty);
        return;
    }
    const fragment = document.createDocumentFragment();
    for (const candidate of matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-block-reference-picker-result';
        const title = document.createElement('strong');
        title.textContent = candidate.nodeTitle;
        const preview = document.createElement('span');
        preview.textContent = candidate.preview;
        const context = document.createElement('small');
        context.textContent = candidate.currentNode
            ? pisiBlockActionsTranslate('Açık node')
            : (candidate.mapTitle || pisiBlockActionsTranslate('Başka node'));
        button.append(title, preview, context);
        button.addEventListener('click', () => insertPisiBlockReference(candidate));
        fragment.appendChild(button);
    }
    host.replaceChildren(fragment);
}

function ensurePisiBlockReferencePicker() {
    if (pisiBlockActionsState.pickerOverlay?.isConnected) {
        return pisiBlockActionsState.pickerOverlay;
    }
    const overlay = document.createElement('div');
    overlay.className = 'pisi-block-reference-picker-overlay';
    overlay.hidden = true;
    const dialog = document.createElement('section');
    dialog.className = 'pisi-block-reference-picker-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute(
        'aria-label',
        pisiBlockActionsTranslate('Referans verilecek bloğu seç')
    );
    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = pisiBlockActionsTranslate('Referans verilecek bloğu seç');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pisi-block-reference-picker-close';
    close.textContent = '×';
    close.title = pisiBlockActionsTranslate('Kapat');
    close.addEventListener('click', closePisiBlockReferencePicker);
    header.append(title, close);
    const source = document.createElement('div');
    source.className = 'pisi-block-reference-picker-source';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'pisi-block-reference-picker-input';
    input.placeholder = pisiBlockActionsTranslate('Blok ara');
    input.setAttribute('aria-label', input.placeholder);
    const results = document.createElement('div');
    results.className = 'pisi-block-reference-picker-results';
    input.addEventListener('input', () => {
        renderPisiBlockReferencePickerResults(input.value);
    });
    dialog.append(header, source, input, results);
    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) closePisiBlockReferencePicker();
    });
    document.body.appendChild(overlay);
    pisiBlockActionsState.pickerOverlay = overlay;
    pisiBlockActionsState.pickerInput = input;
    pisiBlockActionsState.pickerResults = results;
    return overlay;
}

async function openPisiBlockReferencePicker(block = window.getPisiActiveBlock?.()) {
    if (!block) return false;
    const overlay = ensurePisiBlockReferencePicker();
    const source = overlay.querySelector('.pisi-block-reference-picker-source');
    source.textContent = `${pisiBlockActionsTranslate('Kaynak blok')}: ${getPisiBlockActionPreview(block)}`;
    pisiBlockActionsState.pickerSourceBlock = block;
    pisiBlockActionsState.insertionRange = capturePisiBlockInsertionRange(block);
    pisiBlockActionsState.pickerInput.value = '';
    pisiBlockActionsState.pickerResults.replaceChildren();
    overlay.hidden = false;
    overlay.setAttribute('aria-busy', 'true');
    const index = await window.ensurePisiSearchIndex?.();
    if (overlay.hidden) return false;
    pisiBlockActionsState.candidates = makePisiBlockReferenceCandidates(index, block);
    overlay.removeAttribute('aria-busy');
    renderPisiBlockReferencePickerResults();
    pisiBlockActionsState.pickerInput.focus();
    return true;
}

function closePisiBlockReferencePicker() {
    if (pisiBlockActionsState.pickerOverlay) {
        pisiBlockActionsState.pickerOverlay.hidden = true;
        pisiBlockActionsState.pickerOverlay.removeAttribute('aria-busy');
    }
    pisiBlockActionsState.pickerSourceBlock?.focus?.({ preventScroll: true });
    pisiBlockActionsState.pickerSourceBlock = null;
    pisiBlockActionsState.insertionRange = null;
    pisiBlockActionsState.candidates = [];
}

function insertPisiBlockReference(candidate) {
    const sourceBlock = pisiBlockActionsState.pickerSourceBlock;
    const editor = sourceBlock?.closest?.('.pisi-rich-editor');
    if (!sourceBlock || !editor || !candidate?.blockId) return false;
    const reference = document.createElement('span');
    reference.className = 'pisi-block-reference';
    reference.dataset.pisiBlockRef = `${candidate.nodePath}#${candidate.blockId}`;
    reference.dataset.pisiNodeTitle = candidate.nodeTitle;
    reference.contentEditable = 'false';
    reference.tabIndex = 0;
    reference.setAttribute('role', 'link');
    reference.title = pisiBlockActionsTranslate('Blok referansını aç');
    reference.textContent = `↗ ${candidate.nodeTitle} · ${String(candidate.preview).slice(0, 54)}`;

    const range = pisiBlockActionsState.insertionRange;
    const selection = window.getSelection?.();
    if (
        range &&
        sourceBlock.contains(range.commonAncestorContainer) &&
        range.commonAncestorContainer.isConnected
    ) {
        range.deleteContents();
        const leading = document.createTextNode(' ');
        const trailing = document.createTextNode(' ');
        const fragment = document.createDocumentFragment();
        fragment.append(leading, reference, trailing);
        range.insertNode(fragment);
        range.setStartAfter(trailing);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
    } else {
        sourceBlock.append(
            document.createTextNode(' '),
            reference,
            document.createTextNode(' ')
        );
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    window.selectPisiBlock?.(editor, sourceBlock);
    closePisiBlockReferencePicker();
    return true;
}

async function openPisiEmbeddedBlockReference(reference) {
    const raw = String(reference?.dataset?.pisiBlockRef || '');
    const separator = raw.lastIndexOf('#');
    if (separator < 1 || separator === raw.length - 1) return false;
    const nodePath = raw.slice(0, separator);
    const blockId = raw.slice(separator + 1).replace(/^\^/, '');
    const index = await window.ensurePisiSearchIndex?.();
    const documentRecord = Array.from(index?.documents?.values?.() || [])
        .find((record) => record.path === nodePath);
    const block = documentRecord?.contentBlocks?.find((item) => item.blockId === blockId);
    return window.openPisiSearchResult?.({
        kind: 'content',
        title: documentRecord?.title || reference.dataset.pisiNodeTitle || 'Node',
        nodeTitle: documentRecord?.title || reference.dataset.pisiNodeTitle || 'Node',
        nodePath,
        nodeItem: documentRecord?.nodeItem || null,
        mapPath: documentRecord?.memberships?.[0]?.mapPath || null,
        mapTitle: documentRecord?.memberships?.[0]?.mapTitle || '',
        mapItem: documentRecord?.memberships?.[0]?.mapItem || null,
        blockId,
        preview: block?.text || reference.textContent || ''
    }) || false;
}

async function runPisiBlockAction(action, button) {
    const block = pisiBlockActionsState.block;
    if (!block) return false;
    if (action === 'reference') {
        closePisiBlockActionsMenu();
        return openPisiBlockReferencePicker(block);
    }
    if (action === 'copy') {
        const copied = window.copyPisiBlockReference?.(block);
        if (copied && button) {
            const previous = button.textContent;
            button.textContent = pisiBlockActionsTranslate('Blok bağlantısı kopyalandı.');
            setTimeout(() => {
                if (button.isConnected) button.textContent = previous;
            }, 1400);
        }
        return Boolean(copied);
    }
    closePisiBlockActionsMenu();
    if (action === 'connections') {
        return window.openPisiBlockConnections?.() || false;
    }
    if (action === 'duplicate') {
        return Boolean(window.duplicatePisiBlock?.(block));
    }
    if (action === 'delete') {
        const confirmed = typeof window.pisiConfirm === 'function'
            ? await window.pisiConfirm('Bu blok silinsin mi?', {
                title: 'Bloğu sil',
                confirmText: 'Sil',
                danger: true
            })
            : true;
        return confirmed ? Boolean(window.deletePisiBlock?.(block)) : false;
    }
    return false;
}

function bindPisiBlockActions(editor) {
    if (!editor || editor.dataset.pisiBlockActionsBound === '1') return false;
    editor.dataset.pisiBlockActionsBound = '1';
    editor.addEventListener('pointerover', (event) => {
        const block = event.target.closest?.('.pisi-editor-block');
        if (!block || !editor.contains(block)) return;
        clearPisiBlockHandleHideTimer();
        positionPisiBlockHandle(block);
    });
    editor.addEventListener('pointerleave', () => schedulePisiBlockHandleHide());
    editor.addEventListener('click', (event) => {
        const reference = event.target.closest?.('[data-pisi-block-ref]');
        if (reference && editor.contains(reference)) {
            event.preventDefault();
            void openPisiEmbeddedBlockReference(reference);
        }
    });
    editor.addEventListener('keydown', (event) => {
        const reference = event.target.closest?.('[data-pisi-block-ref]');
        if (reference && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            void openPisiEmbeddedBlockReference(reference);
        }
    });
    return true;
}

function initializePisiBlockActions() {
    const bindAll = () => [
        document.getElementById('center-node-editor-content'),
        document.getElementById('node-modal-content')
    ].forEach(bindPisiBlockActions);
    bindAll();
    document.addEventListener('DOMContentLoaded', bindAll, { once: true });
    document.addEventListener('pisi:active-node-changed', bindAll);
    document.addEventListener('mousedown', (event) => {
        if (
            !event.target.closest?.('.pisi-block-action-menu') &&
            !event.target.closest?.('.pisi-block-handle')
        ) {
            closePisiBlockActionsMenu();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (pisiBlockActionsState.pickerOverlay && !pisiBlockActionsState.pickerOverlay.hidden) {
            event.preventDefault();
            closePisiBlockReferencePicker();
            return;
        }
        closePisiBlockActionsMenu();
    }, true);
    window.addEventListener('resize', () => {
        if (pisiBlockActionsState.block && !pisiBlockActionsState.handle?.hidden) {
            positionPisiBlockHandle(pisiBlockActionsState.block);
        }
        closePisiBlockActionsMenu();
    });
    document.addEventListener('scroll', () => {
        if (pisiBlockActionsState.block && !pisiBlockActionsState.handle?.hidden) {
            positionPisiBlockHandle(pisiBlockActionsState.block);
        }
        closePisiBlockActionsMenu();
    }, true);
}

const moduleApi = {
    pisiBlockActionsState,
    bindPisiBlockActions,
    openPisiBlockReferencePicker,
    closePisiBlockReferencePicker,
    insertPisiBlockReference,
    openPisiEmbeddedBlockReference,
    initializePisiBlockActions
};

registerModule('editor.blockActions', moduleApi);
initializePisiBlockActions();

export {
    bindPisiBlockActions,
    closePisiBlockReferencePicker,
    initializePisiBlockActions,
    insertPisiBlockReference,
    openPisiBlockReferencePicker,
    openPisiEmbeddedBlockReference,
    pisiBlockActionsState
};
