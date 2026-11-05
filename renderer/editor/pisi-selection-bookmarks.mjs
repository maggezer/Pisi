const versions = new WeakMap();
const isolated = '[contenteditable="false"], .pisi-task-metadata, .pisi-sheet-block, .pisi-canvas-block, table[data-pisi-sheet]';

export function resetPisiSelectionBookmarks(editor) {
    versions.set(editor, (versions.get(editor) || 0) + 1);
}

function documentScope(editor) {
    const node = editor.id === 'node-modal-content' ? window.activeModalNode : editor.id === 'center-node-editor-content' ? window.activeCenterNode : null;
    return node?.path || '';
}

function textTokens(root) {
    const tokens = [];
    const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            tokens.push({ node, length: node.nodeValue?.length || 0, atomic: false });
            return;
        }
        if (node !== root && node.matches?.(isolated)) return;
        if (['BR', 'IMG', 'HR'].includes(node.nodeName)) {
            tokens.push({ node, length: 1, atomic: true });
            return;
        }
        for (const child of node.childNodes) visit(child);
    };
    visit(root);
    return tokens;
}

function capturePoint(editor, node, nativeOffset) {
    if (node === editor) {
        const next = editor.childNodes[nativeOffset];
        node = next || editor.lastChild;
        nativeOffset = next ? 0 : node?.childNodes.length || 0;
    }
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element || element === editor || element.closest?.(isolated)) return null;
    const block = element.closest?.('.pisi-editor-block');
    if (block?.parentElement !== editor || !block.dataset.pisiBlockId || !block.contains(node)) return null;
    const prefix = document.createRange();
    prefix.selectNodeContents(block);
    prefix.setEnd(node, nativeOffset);
    return {
        blockId: block.dataset.pisiBlockId,
        offset: textTokens(prefix.cloneContents()).reduce((total, token) => total + token.length, 0),
        node,
        nativeOffset,
        block
    };
}

export function capturePisiSelectionBookmark(editor) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount) return null;
    const anchor = capturePoint(editor, selection.anchorNode, selection.anchorOffset);
    const focus = capturePoint(editor, selection.focusNode, selection.focusOffset);
    if (!anchor || !focus) return null;
    return { editor, scope: documentScope(editor), version: versions.get(editor) || 0, anchor, focus };
}

export function resolvePisiBookmarkOffset(tokens, offset, root) {
    let remaining = Math.max(0, Number(offset) || 0);
    for (const token of tokens) {
        if (!token.atomic && remaining <= token.length) return { node: token.node, offset: remaining };
        if (token.atomic && remaining <= 1) {
            const index = Array.prototype.indexOf.call(token.node.parentNode.childNodes, token.node);
            return { node: token.node.parentNode, offset: index + (remaining === 1 ? 1 : 0) };
        }
        remaining -= token.length;
    }
    const last = tokens[tokens.length - 1];
    if (last && !last.atomic) return { node: last.node, offset: last.length };
    return { node: root, offset: root.childNodes.length };
}

function findBlock(editor, point) {
    const matches = Array.from(editor.children).filter((block) => block.getAttribute('data-pisi-block-id') === point.blockId);
    return matches.length === 1 ? matches[0] : null;
}

function validScope(editor, saved) {
    return saved?.editor === editor && saved.scope === documentScope(editor) && saved.version === (versions.get(editor) || 0);
}

function resolvePoint(editor, point) {
    const block = findBlock(editor, point);
    if (!block) return null;
    // Retain exact native affinity at inline boundaries while the node survives.
    // The immutable text offset is authoritative after replacement/normalization.
    if (block.contains(point.node)) {
        const length = point.node.nodeType === Node.TEXT_NODE ? point.node.nodeValue.length : point.node.childNodes.length;
        const current = point.nativeOffset <= length ? capturePoint(editor, point.node, point.nativeOffset) : null;
        if (current?.offset === point.offset) return { node: point.node, offset: point.nativeOffset };
    }
    return resolvePisiBookmarkOffset(textTokens(block), point.offset, block);
}

export function isPisiSelectionBookmarkDisplaced(editor, saved) {
    if (!saved) return false;
    if (!validScope(editor, saved)) return true;
    return [saved.anchor, saved.focus].some((point) => {
        const block = findBlock(editor, point);
        if (!block || block !== point.block || !block.contains(point.node)) return true;
        const length = point.node.nodeType === Node.TEXT_NODE ? point.node.nodeValue.length : point.node.childNodes.length;
        return point.nativeOffset > length || capturePoint(editor, point.node, point.nativeOffset)?.offset !== point.offset;
    });
}

export function resolvePisiSelectionBookmark(editor, saved) {
    if (!validScope(editor, saved)) return null;
    const anchor = resolvePoint(editor, saved.anchor);
    const focus = resolvePoint(editor, saved.focus);
    if (!anchor || !focus) return null;
    const range = document.createRange();
    const end = document.createRange();
    range.setStart(anchor.node, anchor.offset);
    range.collapse(true);
    end.setStart(focus.node, focus.offset);
    end.collapse(true);
    if (range.compareBoundaryPoints(Range.START_TO_START, end) <= 0) range.setEnd(focus.node, focus.offset);
    else {
        range.setStart(focus.node, focus.offset);
        range.setEnd(anchor.node, anchor.offset);
    }
    return { anchor, focus, range };
}

export function restorePisiSelectionBookmark(editor, saved) {
    const resolved = resolvePisiSelectionBookmark(editor, saved);
    if (!resolved) return false;
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return false;
    if (typeof selection.setBaseAndExtent === 'function')
        selection.setBaseAndExtent(resolved.anchor.node, resolved.anchor.offset, resolved.focus.node, resolved.focus.offset);
    else {
        selection.removeAllRanges();
        selection.addRange(resolved.range);
    }
    return true;
}

// A document reload bumps the bookmark version so stale selections are never
// replayed. A deliberate same-document reload (project reload) may carry the
// caret over, but only into the same document and only by block identity and
// text offset; the replaced DOM nodes are never reused.
export function rebasePisiSelectionBookmark(editor, saved) {
    if (!saved || saved.editor !== editor || !saved.scope || saved.scope !== documentScope(editor)) return null;
    const detach = (point) => ({ blockId: point.blockId, offset: point.offset, node: null, nativeOffset: 0, block: null });
    return { editor, scope: saved.scope, version: versions.get(editor) || 0, anchor: detach(saved.anchor), focus: detach(saved.focus) };
}
