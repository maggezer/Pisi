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

    element.classList.add('pisi-editor-block');
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
            nodePath: getPisiEditorNodePath(editor, container),
            offset,
            textOffset: prefix.toString().length,
            blockId: block?.dataset?.pisiBlockId || null,
            blockTextOffset,
            isDirectText: container?.parentNode === editor && container?.nodeType === Node.TEXT_NODE
        };
    };

    return {
        start: makePoint(range.startContainer, range.startOffset),
        end: makePoint(range.endContainer, range.endOffset)
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
    const pathNode = resolvePisiEditorNodePath(editor, point?.nodePath);
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
            if (node.nodeType === Node.TEXT_NODE) {
                if (!node.textContent.trim()) {
                    node.remove();
                    didMutateDom = true;
                    continue;
                }

                const block = document.createElement('div');
                block.textContent = node.textContent;
                decoratePisiEditorBlock(block);
                node.replaceWith(block);
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

        editor.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre').forEach(decoratePisiEditorBlock);

        const seenBlockIds = new Set();
        editor.querySelectorAll('.pisi-editor-block').forEach((block) => {
            const currentId = block.dataset?.pisiBlockId;
            if (!currentId || seenBlockIds.has(currentId)) {
                block.dataset.pisiBlockId = makePisiBlockId();
            }
            seenBlockIds.add(block.dataset.pisiBlockId);
        });
    } finally {
        if (didMutateDom && selectionSnapshot) {
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

const PISI_PASTE_BLOCK_TAGS = new Set([
    'DIV',
    'P',
    'SECTION',
    'ARTICLE',
    'MAIN',
    'HEADER',
    'FOOTER',
    'ASIDE',
    'BLOCKQUOTE',
    'PRE',
    'UL',
    'OL',
    'LI',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'TR',
    'DD',
    'DT',
    'FIGCAPTION'
]);

const PISI_PASTE_INLINE_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'SUB', 'SUP', 'CODE', 'A', 'SPAN']);

function cleanPisiPastedInlineFragment(fragment, isInternalPisi = false) {
    const container = document.createElement('div');
    container.appendChild(fragment.cloneNode(true));

    Array.from(container.querySelectorAll('*')).forEach((el) => {
        if (!PISI_PASTE_INLINE_TAGS.has(el.tagName)) {
            el.replaceWith(...Array.from(el.childNodes));
            return;
        }
        if (!isInternalPisi) {
            el.removeAttribute('style');
            el.removeAttribute('class');
            if (el.tagName === 'SPAN' && el.attributes.length === 0) {
                el.replaceWith(...Array.from(el.childNodes));
            }
        }
    });

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const textNode = walker.currentNode;
        textNode.nodeValue = String(textNode.nodeValue || '').replace(/\r?\n/g, ' ');
    }

    const html =
        isInternalPisi && typeof window.sanitizePisiEditorHtml === 'function' ? window.sanitizePisiEditorHtml(container.innerHTML) : container.innerHTML;
    const probe = createPisiInertHtmlTemplate(html);
    const hasVisibleText = Boolean(String(probe.content.textContent || '').replace(/[\s\u00A0\u200B]/g, '').length);
    const hasMarker = Boolean(probe.content.querySelector?.('.pisi-block-task-marker, .pisi-user-tag[data-pisi-tag]'));
    return hasVisibleText || hasMarker ? html.trim() : '';
}

function resolvePisiPastedBlockMeta(element, isInternalPisi = false) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return { tag: 'div', type: 'paragraph', indent: 0 };
    }
    const tagUpper = element.tagName.toUpperCase();
    if (/^H[1-6]$/.test(tagUpper)) {
        const level = Math.min(Number(tagUpper.slice(1)) || 2, 5);
        return { tag: `h${level}`, type: `heading${level}`, indent: 0 };
    }
    if (tagUpper === 'BLOCKQUOTE') return { tag: 'blockquote', type: 'quote', indent: 0 };
    if (tagUpper === 'PRE') return { tag: 'pre', type: 'code', indent: 0 };
    if (tagUpper === 'LI') {
        const parentTag = element.parentElement?.tagName?.toUpperCase?.() || '';
        const isNumber = parentTag === 'OL';
        let depth = 0;
        let curr = element.parentElement;
        while (curr) {
            if (curr.tagName === 'UL' || curr.tagName === 'OL') depth += 1;
            curr = curr.parentElement;
        }
        return {
            tag: 'div',
            type: isNumber ? 'number' : 'bullet',
            indent: isNumber ? 0 : Math.max(0, Math.min(depth - 1, 6))
        };
    }
    if (isInternalPisi && element.dataset?.pisiBlockType) {
        const indent = Math.max(0, Math.min(parseInt(element.dataset.pisiBulletIndent || '0', 10) || 0, 6));
        return { tag: 'div', type: element.dataset.pisiBlockType, indent };
    }
    return { tag: 'div', type: 'paragraph', indent: 0 };
}

function extractPisiPasteBlocks(html = '', plain = '') {
    const blocks = [];
    const cleanHtml = String(html || '').trim();

    if (cleanHtml) {
        const isInternalPisi = /data-pisi-(?:block-id|tag|todo|done)|pisi-editor-block|pisi-user-tag|pisi-todo-source/i.test(cleanHtml);
        const template = createPisiInertHtmlTemplate(cleanHtml);
        template.content
            .querySelectorAll('script, style, meta, link, title, head, svg, iframe, object, embed, form, input, button')
            .forEach((el) => el.remove());

        const pushLeafChildNodes = (nodes, meta) => {
            if (meta.type === 'code') {
                const rawText = nodes.map((n) => n.textContent || '').join('');
                const cleanedCode = rawText
                    .replace(/\r\n?/g, '\n')
                    .split('\n')
                    .filter((line) => line.trim().length > 0)
                    .join('\n');
                if (cleanedCode.trim()) {
                    blocks.push({ ...meta, text: cleanedCode });
                }
                return;
            }
            let currentLine = document.createDocumentFragment();
            const flushLine = () => {
                const lineHtml = cleanPisiPastedInlineFragment(currentLine, isInternalPisi);
                currentLine = document.createDocumentFragment();
                if (lineHtml) {
                    blocks.push({ ...meta, html: lineHtml });
                }
            };
            for (const child of nodes) {
                if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'BR') {
                    flushLine();
                } else {
                    currentLine.appendChild(child.cloneNode(true));
                }
            }
            flushLine();
        };

        const walkContainer = (container, inheritedMeta = { tag: 'div', type: 'paragraph', indent: 0 }) => {
            let inlineBuffer = [];
            const flushInlineBuffer = () => {
                if (!inlineBuffer.length) return;
                pushLeafChildNodes(inlineBuffer, inheritedMeta);
                inlineBuffer = [];
            };
            for (const child of Array.from(container.childNodes)) {
                if (child.nodeType === Node.ELEMENT_NODE && PISI_PASTE_BLOCK_TAGS.has(child.tagName)) {
                    flushInlineBuffer();
                    const childMeta = resolvePisiPastedBlockMeta(child, isInternalPisi);
                    const hasBlockChildren = Array.from(child.children).some((grand) => PISI_PASTE_BLOCK_TAGS.has(grand.tagName));
                    if (hasBlockChildren) {
                        walkContainer(child, childMeta);
                    } else {
                        pushLeafChildNodes(Array.from(child.childNodes), childMeta);
                    }
                } else {
                    inlineBuffer.push(child);
                }
            }
            flushInlineBuffer();
        };

        walkContainer(template.content);
    }

    if (!blocks.length && plain) {
        const normalizedPlain = String(plain).replace(/\r\n?/g, '\n');
        const lines = normalizedPlain
            .split('\n')
            .map((line) => line.replace(/\r/g, ''))
            .filter((line) => line.trim().length > 0);

        if (!lines.length) {
            const fallbackText = normalizedPlain.replace(/\n+/g, ' ');
            if (fallbackText) {
                blocks.push({ tag: 'div', type: 'paragraph', indent: 0, text: fallbackText });
            }
            return blocks;
        }

        for (const line of lines) {
            const headingMatch = line.match(/^\s*(#{1,5})\s+(.+)$/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                blocks.push({ tag: `h${level}`, type: `heading${level}`, indent: 0, text: headingMatch[2] });
                continue;
            }
            const bulletMatch = line.match(/^(\s*)([-*+])\s+(.+)$/);
            if (bulletMatch) {
                const indent = Math.min(Math.floor((bulletMatch[1] || '').replace(/\t/g, '  ').length / 2), 6);
                blocks.push({ tag: 'div', type: 'bullet', indent, text: bulletMatch[3] });
                continue;
            }
            blocks.push({ tag: 'div', type: 'paragraph', indent: 0, text: line });
        }
    }

    return blocks;
}

function handlePisiEditorPaste(editor, event) {
    if (!editor || event?.defaultPrevented) return false;
    if (event.target?.closest?.('table[data-pisi-sheet], .pisi-sheet-block, .pisi-canvas-block, [data-pisi-rollup-relation]')) {
        return false;
    }

    const clipboardData = event.clipboardData;
    if (!clipboardData) return false;

    const html = clipboardData.getData?.('text/html') || '';
    const plain = clipboardData.getData?.('text/plain') || '';
    if (!html && !plain) return false;
    if (/<(?:table|canvas|img)\b|data-pisi-(?:sheet|canvas|rollup)/i.test(html)) {
        return false;
    }

    const blocks = extractPisiPasteBlocks(html, plain);
    if (!blocks.length) return false;

    event.preventDefault();
    event.stopPropagation();

    ensurePisiEditorBlocks(editor, { preserveSelection: false });

    const selection = window.getSelection?.();
    let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !editor.contains(range.startContainer)) {
        const fallbackBlock = editor.querySelector('.pisi-editor-block:last-of-type') || editor;
        range = document.createRange();
        range.selectNodeContents(fallbackBlock);
        range.collapse(false);
    }

    if (!range.collapsed && editor.contains(range.endContainer)) {
        range.deleteContents();
    }

    let currentBlock = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement)?.closest?.(
        '.pisi-editor-block'
    );
    if (!currentBlock || !editor.contains(currentBlock)) {
        currentBlock = editor.querySelector('.pisi-editor-block:last-of-type');
    }

    const itemToFragment = (item) => {
        if (typeof item.html === 'string') {
            return createPisiInertHtmlTemplate(item.html).content.cloneNode(true);
        }
        const frag = document.createDocumentFragment();
        frag.appendChild(document.createTextNode(String(item.text || '')));
        return frag;
    };

    const buildBlockElement = (item, fallbackType = 'paragraph', fallbackIndent = 0) => {
        const block = document.createElement(item.tag || 'div');
        decoratePisiEditorBlock(block);
        const resolvedType = item.type === 'paragraph' && fallbackType === 'bullet' ? 'bullet' : item.type || 'paragraph';
        block.dataset.pisiBlockType = resolvedType;
        const resolvedIndent = item.type === 'bullet' ? item.indent || 0 : resolvedType === 'bullet' ? fallbackIndent : 0;
        if (resolvedIndent > 0) {
            block.dataset.pisiBulletIndent = String(resolvedIndent);
            block.style.setProperty('--pisi-bullet-indent', String(resolvedIndent));
        }
        block.appendChild(itemToFragment(item));
        if (!block.childNodes.length) block.innerHTML = '<br>';
        return block;
    };

    const isBlockEmpty = (blk) => !String(blk?.textContent || '').replace(/[\s\u00A0\u200B]/g, '') && !blk?.querySelector?.('*:not(br)');

    const caretMarker = document.createElement('span');
    caretMarker.dataset.pisiPasteCaret = '1';

    if (blocks.length === 1 && blocks[0].type === 'paragraph' && currentBlock) {
        if (isBlockEmpty(currentBlock)) {
            currentBlock.innerHTML = '';
            range.setStart(currentBlock, 0);
            range.collapse(true);
        }
        const frag = itemToFragment(blocks[0]);
        frag.appendChild(caretMarker);
        range.insertNode(frag);
    } else if (currentBlock && isBlockEmpty(currentBlock)) {
        const inheritBullet = currentBlock.dataset?.pisiBlockType === 'bullet';
        const inheritIndent = parseInt(currentBlock.dataset?.pisiBulletIndent || '0', 10) || 0;
        const newBlocks = blocks.map((item) => buildBlockElement(item, inheritBullet ? 'bullet' : 'paragraph', inheritIndent));
        const lastBlock = newBlocks[newBlocks.length - 1];
        lastBlock.appendChild(caretMarker);
        currentBlock.replaceWith(...newBlocks);
    } else if (currentBlock) {
        const afterRange = document.createRange();
        afterRange.selectNodeContents(currentBlock);
        afterRange.setStart(range.startContainer, range.startOffset);
        const trailingFragment = afterRange.extractContents();
        const hasTrailing = Boolean(
            String(trailingFragment.textContent || '').replace(/[\s\u00A0\u200B]/g, '') || trailingFragment.querySelector?.('*:not(br)')
        );

        let restItems = blocks;
        if (blocks[0].type === 'paragraph') {
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
        const targetBlock = restBlocks.length ? restBlocks[restBlocks.length - 1] : currentBlock;
        targetBlock.appendChild(caretMarker);
        if (hasTrailing) {
            targetBlock.appendChild(trailingFragment);
        }
    }

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
    editor.dispatchEvent(new Event('input', { bubbles: true }));
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
