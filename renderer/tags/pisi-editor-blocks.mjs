import { registerModule } from "../core/module-registry.mjs";

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
            '[data-pisi-sheet-block]'
        )
    ) {
        return false;
    }

    return /^(DIV|P|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|PRE|LI)$/i.test(element.tagName);
}

function decoratePisiEditorBlock(element) {
    if (!isPisiEditorBlockElement(element)) return;

    element.classList.add('pisi-editor-block');

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
        return {
            nodePath: getPisiEditorNodePath(editor, container),
            offset,
            textOffset: prefix.toString().length
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
        node: editor.querySelector?.('.pisi-editor-block') || editor.firstElementChild || editor,
        offset: 0
    };
}

function isValidPisiEditorRangeOffset(node, offset) {
    if (!node || !Number.isInteger(offset) || offset < 0) return false;
    const limit = node.nodeType === Node.TEXT_NODE
        ? node.nodeValue?.length || 0
        : node.childNodes?.length || 0;
    return offset <= limit;
}

function resolvePisiEditorSelectionPoint(editor, point) {
    const pathNode = resolvePisiEditorNodePath(editor, point?.nodePath);
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

    const preserveSelection = options.preserveSelection !== false;
    const selectionSnapshot = preserveSelection
        ? capturePisiEditorSelection(editor)
        : null;

    try {
        const childNodes = Array.from(editor.childNodes);

        if (!childNodes.length) {
            const block = document.createElement('div');
            block.innerHTML = '<br>';
            decoratePisiEditorBlock(block);
            editor.appendChild(block);
            return;
        }

        for (const node of childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (!node.textContent.trim()) {
                    node.remove();
                    continue;
                }

                const block = document.createElement('div');
                block.textContent = node.textContent;
                decoratePisiEditorBlock(block);
                node.replaceWith(block);
                continue;
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'BR') {
                    const block = document.createElement('div');
                    block.innerHTML = '<br>';
                    decoratePisiEditorBlock(block);
                    node.replaceWith(block);
                    continue;
                }

                if (isPisiEditorBlockElement(node)) {
                    decoratePisiEditorBlock(node);
                }
            }
        }

        editor.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre')
            .forEach(decoratePisiEditorBlock);
    } finally {
        if (selectionSnapshot) {
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

const moduleApi = {};
Object.defineProperties(moduleApi, {
    "makePisiBlockId": {
        enumerable: true,
        get() { return makePisiBlockId; }
    },
    "isPisiEditorBlockElement": {
        enumerable: true,
        get() { return isPisiEditorBlockElement; }
    },
    "decoratePisiEditorBlock": {
        enumerable: true,
        get() { return decoratePisiEditorBlock; }
    },
    "ensurePisiEditorBlocks": {
        enumerable: true,
        get() { return ensurePisiEditorBlocks; }
    },
    "getPisiBlockElementsFromContainer": {
        enumerable: true,
        get() { return getPisiBlockElementsFromContainer; }
    },
    "createPisiInertHtmlTemplate": {
        enumerable: true,
        get() { return createPisiInertHtmlTemplate; }
    }
});
registerModule("tags.editorBlocks", moduleApi);
