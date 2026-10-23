function point(editor, node, offset) {
    if (!node || !editor.contains(node)) return null;
    const path = [];
    for (let current = node; current !== editor; current = current.parentNode) {
        path.unshift(Array.prototype.indexOf.call(current.parentNode.childNodes, current));
    }
    return { path, offset };
}

export function captureHistorySelection(editor) {
    const selection = window.getSelection?.();
    const anchor = point(editor, selection?.anchorNode, selection?.anchorOffset);
    const focus = point(editor, selection?.focusNode, selection?.focusOffset);
    return anchor && focus ? { anchor, focus } : null;
}

export function restoreHistorySelection(editor, saved) {
    if (!saved) return;
    const resolve = ({ path, offset }) => {
        let node = editor;
        for (const index of path) {
            if (!node.childNodes[index]) break;
            node = node.childNodes[index];
        }
        const length = node.nodeType === Node.TEXT_NODE ? node.textContent.length : node.childNodes.length;
        return { node, offset: Math.min(offset, length) };
    };
    const anchor = resolve(saved.anchor);
    const focus = resolve(saved.focus);
    window.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
}
