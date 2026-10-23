import { extractPisiPasteBlocks as parsePisiPasteBlocks } from './pisi-paste-blocks.mjs';
import { rekeyPisiPastedBlocks } from './pisi-paste-identities.mjs';
import { registerModule } from '../core/module-registry.mjs';

function makePisiBlockId() {
    if (window.crypto?.randomUUID) {
        return `blk_${window.crypto.randomUUID()}`;
    }

    return `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isPisiEditorBlockElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    if (
        element.matches?.(
            '.pisi-sheet-block, ' +
                '.pisi-sheet-caret-anchor, ' +
                '[data-pisi-sheet-block], ' +
                '.pisi-canvas-block, ' +
                '[data-pisi-canvas-block], ' +
                '.pisi-diary-managed-block, ' +
                '[data-pisi-diary-source]'
        ) ||
        element.closest?.('.pisi-diary-managed-block')
    ) {
        return false;
    }

    return /^(DIV|P|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|PRE|LI)$/i.test(element.tagName);
}

function decoratePisiEditorBlock(element) {
    if (!isPisiEditorBlockElement(element)) {
        if (
            element?.classList?.contains('pisi-editor-block') &&
            (element.matches?.('.pisi-diary-managed-block') || element.closest?.('.pisi-diary-managed-block'))
        ) {
            element.classList.remove('pisi-editor-block');
        }
        return;
    }

    if (!element.classList.contains('pisi-editor-block')) element.classList.add('pisi-editor-block');
    for (const prop of [
        'margin',
        'margin-top',
        'margin-bottom',
        'margin-block',
        'margin-block-start',
        'margin-block-end',
        'padding-top',
        'padding-bottom',
        'line-height'
    ]) {
        element.style?.removeProperty?.(prop);
    }

    if (!element.dataset.pisiBlockId) {
        element.dataset.pisiBlockId = makePisiBlockId();
    }
}

function getPisiEditorNodePath(editor, node) {
    const nodePath = [];
    let current = node;
    while (current && current !== editor) {
        const parent = current.parentNode;
        if (!parent) return null;
        const index = Array.prototype.indexOf.call(parent.childNodes, current);
        if (index < 0) return null;
        nodePath.unshift(index);
        current = parent;
    }
    return current === editor ? nodePath : null;
}

function resolvePisiEditorNodePath(editor, nodePath) {
    if (!Array.isArray(nodePath)) return null;
    let current = editor;
    for (const index of nodePath) {
        if (!current?.childNodes || index < 0 || index >= current.childNodes.length) return null;
        current = current.childNodes[index];
    }
    return current;
}

function capturePisiEditorSelection(editor) {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;

    const makePoint = (container, offset) => {
        const prefix = range.cloneRange();
        prefix.selectNodeContents(editor);
        prefix.setEnd(container, offset);
        const block = (container?.nodeType === Node.ELEMENT_NODE ? container : container?.parentElement)?.closest?.('.pisi-editor-block');
        let blockTextOffset = 0;
        if (block && block.contains(container)) {
            const blockPrefix = range.cloneRange();
            blockPrefix.selectNodeContents(block);
            blockPrefix.setEnd(container, offset);
            blockTextOffset = blockPrefix.toString().length;
        }
        return {
            node: container,
            nodePath: getPisiEditorNodePath(editor, container),
            offset,
            textOffset: prefix.toString().length,
            blockId: block?.dataset?.pisiBlockId || null,
            blockTextOffset,
            isDirectText: container?.parentNode === editor && container?.nodeType === Node.TEXT_NODE
        };
    };

    const backward =
        !selection.isCollapsed &&
        selection.anchorNode &&
        selection.focusNode &&
        (() => {
            const anchor = document.createRange();
            anchor.setStart(selection.anchorNode, selection.anchorOffset);
            anchor.collapse(true);
            const focus = document.createRange();
            focus.setStart(selection.focusNode, selection.focusOffset);
            focus.collapse(true);
            return anchor.compareBoundaryPoints(Range.START_TO_START, focus) > 0;
        })();
    return {
        start: makePoint(range.startContainer, range.startOffset),
        end: makePoint(range.endContainer, range.endOffset),
        backward: Boolean(backward)
    };
}

function resolvePisiEditorTextPosition(editor, targetOffset) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, Number(targetOffset) || 0);
    let lastTextNode = null;

    while (walker.nextNode()) {
        const textNode = walker.currentNode;
        const length = textNode.nodeValue?.length || 0;
        lastTextNode = textNode;
        if (remaining <= length) return { node: textNode, offset: remaining };
        remaining -= length;
    }

    if (lastTextNode) {
        return { node: lastTextNode, offset: lastTextNode.nodeValue?.length || 0 };
    }

    return {
        node: editor.classList?.contains?.('pisi-editor-block') ? editor : editor.querySelector?.('.pisi-editor-block') || editor.firstElementChild || editor,
        offset: 0
    };
}

function isValidPisiEditorRangeOffset(node, offset) {
    if (!node || !Number.isInteger(offset) || offset < 0) return false;
    const limit = node.nodeType === Node.TEXT_NODE ? node.nodeValue?.length || 0 : node.childNodes?.length || 0;
    return offset <= limit;
}

function resolvePisiEditorSelectionPoint(editor, point) {
    if (editor.contains(point?.node) && isValidPisiEditorRangeOffset(point.node, point.offset)) return { node: point.node, offset: point.offset };
    const pathNode = resolvePisiEditorNodePath(editor, point?.nodePath);
    // A duplicate-id repair may rename the active block. In that case its
    // original node path remains the most precise caret anchor.
    const pathBlock = (pathNode?.nodeType === Node.ELEMENT_NODE ? pathNode : pathNode?.parentElement)?.closest?.('.pisi-editor-block');
    if (
        pathBlock &&
        editor.contains(pathBlock) &&
        pathBlock.parentElement === editor &&
        isValidPisiEditorRangeOffset(pathNode, point?.offset) &&
        pathBlock.dataset?.pisiBlockId !== point?.blockId
    ) {
        return { node: pathNode, offset: point.offset };
    }
    if (point?.blockId) {
        const block = Array.from(editor.querySelectorAll?.('.pisi-editor-block') || []).find((candidate) => candidate.dataset?.pisiBlockId === point.blockId);
        if (block) {
            if (block.contains(pathNode) && isValidPisiEditorRangeOffset(pathNode, point?.offset)) {
                return { node: pathNode, offset: point.offset };
            }
            return resolvePisiEditorTextPosition(block, point?.blockTextOffset);
        }
    }
    if (point?.isDirectText && pathNode?.nodeType === Node.ELEMENT_NODE && pathNode.firstChild?.nodeType === Node.TEXT_NODE) {
        return {
            node: pathNode.firstChild,
            offset: Math.min(Math.max(0, Number(point.offset) || 0), pathNode.firstChild.nodeValue?.length || 0)
        };
    }
    if (isValidPisiEditorRangeOffset(pathNode, point?.offset)) {
        return { node: pathNode, offset: point.offset };
    }
    return resolvePisiEditorTextPosition(editor, point?.textOffset);
}

function restorePisiEditorSelection(editor, snapshot) {
    if (!snapshot) return;
    const selection = window.getSelection?.();
    if (!selection) return;

    const start = resolvePisiEditorSelectionPoint(editor, snapshot.start);
    const end = resolvePisiEditorSelectionPoint(editor, snapshot.end);
    const range = document.createRange();

    try {
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        selection.removeAllRanges();
        selection.addRange(range);
        if (snapshot.backward && !range.collapsed && typeof selection.setBaseAndExtent === 'function') {
            selection.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
        }
    } catch (error) {
        console.warn('[PISI] Editör imleci geri yüklenemedi:', error);
    }
}

function ensurePisiEditorBlocks(editor, options = {}) {
    if (!editor) return;

    if (editor.nodeType === Node.ELEMENT_NODE && editor.classList?.contains?.('pisi-rich-editor') && editor.dataset?.pisiPasteBound !== '1') {
        editor.dataset.pisiPasteBound = '1';
        editor.addEventListener('paste', (event) => {
            handlePisiEditorPaste(editor, event);
        });
    }

    const preserveSelection = options.preserveSelection !== false;
    const selectionSnapshot = preserveSelection ? capturePisiEditorSelection(editor) : null;
    let didMutateDom = false;
    // Track id changes separately from node replacement: duplicate ids are
    // common after native paste and previously skipped selection restoration.
    let didChangeIdentity = false;

    try {
        const childNodes = Array.from(editor.childNodes);

        if (!childNodes.length) {
            const block = document.createElement('div');
            block.innerHTML = '<br>';
            decoratePisiEditorBlock(block);
            editor.appendChild(block);
            didMutateDom = true;
            return;
        }

        for (const node of childNodes) {
            if (node.parentNode !== editor) continue;
            const isInline = (candidate) =>
                candidate?.nodeType === Node.TEXT_NODE ||
                (candidate?.nodeType === Node.ELEMENT_NODE && /^(SPAN|STRONG|EM|B|I|U|S|STRIKE|A|CODE|SUB|SUP|MARK|IMG)$/i.test(candidate.tagName));
            if (isInline(node)) {
                const nodes = [node];
                while (isInline(nodes[nodes.length - 1].nextSibling)) nodes.push(nodes[nodes.length - 1].nextSibling);
                if (nodes.every((item) => item.nodeType === Node.TEXT_NODE && !item.textContent.trim())) {
                    nodes.forEach((item) => item.remove());
                } else {
                    const block = document.createElement('div');
                    node.before(block);
                    block.append(...nodes);
                    decoratePisiEditorBlock(block);
                }
                didMutateDom = true;
                continue;
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'BR') {
                    const block = document.createElement('div');
                    block.innerHTML = '<br>';
                    decoratePisiEditorBlock(block);
                    node.replaceWith(block);
                    didMutateDom = true;
                    continue;
                }

                if (node.tagName === 'P') {
                    const block = document.createElement('div');
                    for (const attr of Array.from(node.attributes)) {
                        block.setAttribute(attr.name, attr.value);
                    }
                    block.append(...Array.from(node.childNodes));
                    if (!block.childNodes.length) block.innerHTML = '<br>';
                    decoratePisiEditorBlock(block);
                    node.replaceWith(block);
                    didMutateDom = true;
                    continue;
                }

                if (isPisiEditorBlockElement(node)) {
                    decoratePisiEditorBlock(node);
                }
            }
        }

        if (!editor.childNodes.length) {
            const block = document.createElement('div');
            block.appendChild(document.createElement('br'));
            decoratePisiEditorBlock(block);
            editor.appendChild(block);
            didMutateDom = true;
        }

        // Nested rich-text markup and composite content are not independent
        // editor blocks. Decorating them creates unstable ids and selections.
        const blocks = Array.from(editor.children).filter((element) => element.classList?.contains('pisi-editor-block'));
        const seenBlockIds = new Set();
        for (const block of blocks) {
            const currentId = block.dataset?.pisiBlockId;
            if (!currentId || seenBlockIds.has(currentId)) {
                let replacementId;
                do {
                    replacementId = makePisiBlockId();
                } while (seenBlockIds.has(replacementId));
                block.dataset.pisiBlockId = replacementId;
                didChangeIdentity = true;
            }
            seenBlockIds.add(block.dataset.pisiBlockId);
        }
    } finally {
        if ((didMutateDom || didChangeIdentity) && selectionSnapshot) {
            restorePisiEditorSelection(editor, selectionSnapshot);
        }
    }
}

function getPisiBlockElementsFromContainer(container) {
    if (!container) return [];

    return Array.from(container.children).filter((element) => {
        return isPisiEditorBlockElement(element);
    });
}

function createPisiInertHtmlTemplate(html = '') {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    return template;
}

function extractPisiPasteBlocks(html = '', plain = '') {
    return parsePisiPasteBlocks(html, plain);
}

function handlePisiEditorPaste(editor, event) {
    if (!editor || event?.defaultPrevented) return false;
    if (
        event.target !== editor &&
        event.target?.closest?.(
            'input, textarea, select, table[data-pisi-sheet], .pisi-sheet-block, .pisi-canvas-block, [data-pisi-rollup-relation], [contenteditable="false"]'
        )
    ) {
        return false;
    }

    const clipboardData = event.clipboardData;
    if (!clipboardData) return false;

    const html = clipboardData.getData?.('text/html') || '';
    const plain = clipboardData.getData?.('text/plain') || '';
    if (!html && !plain) return false;
    let blocks = extractPisiPasteBlocks(html, plain);
    if (!blocks.length) return false;

    event.preventDefault();
    event.stopPropagation();

    ensurePisiEditorBlocks(editor, { preserveSelection: true });

    const selection = window.getSelection?.();
    let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !editor.contains(range.startContainer)) {
        const fallbackBlock = editor.querySelector('.pisi-editor-block:last-of-type') || editor;
        range = document.createRange();
        range.selectNodeContents(fallbackBlock);
        range.collapse(false);
    }

    if (!editor.contains(range.endContainer)) return false;
    const topBlock = (node) => {
        let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        while (element && element.parentElement !== editor && element !== editor) element = element.parentElement;
        return element === editor ? null : element;
    };
    const startBlock = topBlock(range.startContainer);
    const endBlock = topBlock(range.endContainer);
    if (!range.collapsed) {
        range.deleteContents();
        if (
            startBlock?.parentElement === editor &&
            endBlock?.parentElement === editor &&
            startBlock !== endBlock &&
            startBlock.matches('.pisi-editor-block') &&
            endBlock.matches('.pisi-editor-block')
        ) {
            const join = startBlock.childNodes.length;
            startBlock.append(...endBlock.childNodes);
            endBlock.remove();
            range.setStart(startBlock, join);
            range.collapse(true);
        }
    }
    if (range.startContainer === editor) {
        const child = editor.childNodes[range.startOffset];
        if (child?.nodeType === Node.ELEMENT_NODE && child.matches('.pisi-editor-block') && child.getAttribute('contenteditable') !== 'false') {
            range.selectNodeContents(child);
            range.collapse(true);
        } else {
            const empty = document.createElement('div');
            decoratePisiEditorBlock(empty);
            empty.dataset.pisiBlockType = 'paragraph';
            range.insertNode(empty);
            range.selectNodeContents(empty);
            range.collapse(true);
        }
    }
    let currentBlock = topBlock(range.startContainer);
    if (!currentBlock?.matches('.pisi-editor-block')) return false;

    if (currentBlock?.dataset.pisiBlockType === 'code') {
        const text = plain || blocks.map((item) => item.text ?? createPisiInertHtmlTemplate(item.html || '').content.textContent).join('\n');
        blocks = [{ tag: 'div', type: 'paragraph', text }];
    }
    const inserted = [];
    const itemToFragment = (item) => {
        if (typeof item.html === 'string') {
            const fragment = createPisiInertHtmlTemplate(item.html).content.cloneNode(true);
            if (item.style) {
                const span = document.createElement('span');
                span.setAttribute('style', item.style);
                span.append(...fragment.childNodes);
                fragment.appendChild(span);
            }
            return fragment;
        }
        const frag = document.createDocumentFragment();
        frag.appendChild(document.createTextNode(String(item.text || '')));
        return frag;
    };

    const buildBlockElement = (item, fallbackType = 'paragraph', fallbackIndent = 0) => {
        if (item.composite) {
            const block = createPisiInertHtmlTemplate(item.html).content.firstElementChild;
            inserted.push(block);
            return block;
        }
        const block = document.createElement(item.tag || 'div');
        for (const [name, value] of Object.entries(item.attributes || {})) {
            if (name !== 'data-pisi-block-id') block.setAttribute(name, value);
        }
        if (item.attributes?.['data-pisi-block-id']) block.dataset.pisiBlockId = item.attributes['data-pisi-block-id'];
        if (item.style) block.setAttribute('style', item.style);
        decoratePisiEditorBlock(block);
        const resolvedType = item.type === 'paragraph' && fallbackType === 'bullet' ? 'bullet' : item.type || 'paragraph';
        block.dataset.pisiBlockType = resolvedType;
        const resolvedIndent = item.type === 'bullet' ? item.indent || 0 : resolvedType === 'bullet' ? fallbackIndent : 0;
        if (resolvedIndent > 0) {
            block.dataset.pisiBulletIndent = String(resolvedIndent);
            block.style.setProperty('--pisi-bullet-indent', String(resolvedIndent));
        }
        block.appendChild(itemToFragment(item));
        if (!block.textContent && !block.querySelector('br, img, table, canvas, .pisi-block-task-marker')) block.appendChild(document.createElement('br'));
        if (resolvedType === 'task' && !block.querySelector('.pisi-user-tag[data-pisi-tag]')) {
            const source = document.createElement('span');
            source.className = 'pisi-todo-source';
            source.dataset.pisiTodoFor = 'todo.1.none';
            source.append(...block.childNodes);
            const metadata = document.createElement('span');
            metadata.className = 'pisi-user-tag pisi-task-metadata';
            metadata.dataset.pisiTag = 'todo.1.none';
            metadata.contentEditable = 'false';
            metadata.textContent = metadata.dataset.pisiTag;
            block.replaceChildren(metadata, source);
            if (item.checked) {
                const done = /** @type {HTMLElement} */ (metadata.cloneNode(true));
                done.dataset.pisiTag = 'done';
                done.dataset.pisiDoneFor = 'todo.1.none';
                done.textContent = done.dataset.pisiTag;
                block.prepend(done);
            }
        }
        inserted.push(block);
        return block;
    };

    const isBlockEmpty = (blk) => !String(blk?.textContent || '').replace(/\u200B/g, '') && !blk?.querySelector?.('*:not(br)');

    const caretMarker = document.createElement('span');
    caretMarker.dataset.pisiPasteCaret = '1';

    if (blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].composite && currentBlock && !isBlockEmpty(currentBlock)) {
        const frag = itemToFragment(blocks[0]);
        frag.appendChild(caretMarker);
        range.insertNode(frag);
    } else if (currentBlock && isBlockEmpty(currentBlock)) {
        const inheritBullet = currentBlock.dataset?.pisiBlockType === 'bullet';
        const inheritIndent = parseInt(currentBlock.dataset?.pisiBulletIndent || '0', 10) || 0;
        const newBlocks = blocks.map((item) => buildBlockElement(item, inheritBullet ? 'bullet' : 'paragraph', inheritIndent));
        const lastBlock = newBlocks[newBlocks.length - 1];
        if (blocks[blocks.length - 1].composite) {
            const tail = buildBlockElement({ tag: 'div', type: 'paragraph', text: '' });
            newBlocks.push(tail);
            tail.appendChild(caretMarker);
        } else lastBlock.appendChild(caretMarker);
        currentBlock.replaceWith(...newBlocks);
    } else if (currentBlock) {
        const afterRange = document.createRange();
        afterRange.selectNodeContents(currentBlock);
        afterRange.setStart(range.startContainer, range.startOffset);
        const trailingFragment = afterRange.extractContents();
        const hasTrailing = Boolean(String(trailingFragment.textContent || '').replace(/\u200B/g, '') || trailingFragment.querySelector?.('*:not(br)'));

        let restItems = blocks;
        if (blocks[0].type === 'paragraph' && !blocks[0].composite) {
            currentBlock.querySelectorAll('br').forEach((br) => {
                if (!br.nextSibling) br.remove();
            });
            currentBlock.appendChild(itemToFragment(blocks[0]));
            restItems = blocks.slice(1);
        } else if (isBlockEmpty(currentBlock)) {
            const firstBlock = buildBlockElement(blocks[0]);
            currentBlock.replaceWith(firstBlock);
            currentBlock = firstBlock;
            restItems = blocks.slice(1);
        }

        const restBlocks = restItems.map((item) => buildBlockElement(item));
        if (restBlocks.length) {
            currentBlock.after(...restBlocks);
        }
        let targetBlock = restBlocks.length ? restBlocks[restBlocks.length - 1] : currentBlock;
        const lastItem = blocks[blocks.length - 1];
        if (lastItem.composite || (hasTrailing && lastItem.type !== 'paragraph')) {
            const tail = buildBlockElement({ tag: 'div', type: 'paragraph', text: '' });
            targetBlock.after(tail);
            targetBlock = tail;
        }
        if (!caretMarker.isConnected) targetBlock.appendChild(caretMarker);
        if (hasTrailing) {
            targetBlock.appendChild(trailingFragment);
        }
    }

    rekeyPisiPastedBlocks(inserted, makePisiBlockId);
    window.initializePisiAdvancedEditorContent?.(editor);
    window.syncPisiTodoBlockMarkers?.(editor);
    if (caretMarker.isConnected && selection) {
        const nextRange = document.createRange();
        nextRange.setStartBefore(caretMarker);
        nextRange.collapse(true);
        caretMarker.remove();
        selection.removeAllRanges();
        selection.addRange(nextRange);
    } else {
        caretMarker.remove();
    }

    ensurePisiEditorBlocks(editor, { preserveSelection: true });
    window.decoratePisiBlockTypes?.(editor);
    window.syncPisiWordHeadingCollapse?.(editor);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    return true;
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    makePisiBlockId: {
        enumerable: true,
        get() {
            return makePisiBlockId;
        }
    },
    isPisiEditorBlockElement: {
        enumerable: true,
        get() {
            return isPisiEditorBlockElement;
        }
    },
    decoratePisiEditorBlock: {
        enumerable: true,
        get() {
            return decoratePisiEditorBlock;
        }
    },
    ensurePisiEditorBlocks: {
        enumerable: true,
        get() {
            return ensurePisiEditorBlocks;
        }
    },
    getPisiBlockElementsFromContainer: {
        enumerable: true,
        get() {
            return getPisiBlockElementsFromContainer;
        }
    },
    createPisiInertHtmlTemplate: {
        enumerable: true,
        get() {
            return createPisiInertHtmlTemplate;
        }
    },
    handlePisiEditorPaste: {
        enumerable: true,
        get() {
            return handlePisiEditorPaste;
        }
    }
});
registerModule('tags.editorBlocks', moduleApi);
