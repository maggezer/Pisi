'use strict';

const fs = require('node:fs');

function replaceOnce(source, pattern, replacement, label) {
    if (typeof pattern === 'string') {
        if (!source.includes(pattern)) {
            throw new Error(`${label} fragment was not found.`);
        }
        return source.replace(pattern, replacement);
    }

    if (!pattern.test(source)) {
        throw new Error(`${label} fragment was not found.`);
    }

    return source.replace(pattern, replacement);
}

const tagIndexPath = 'renderer/tags/pisi-tag-index.mjs';
let tagIndex = fs.readFileSync(tagIndexPath, 'utf8');

const selectionHelpersPattern = /function capturePisiEditorSelection\(editor\) \{[\s\S]*?\n\}\n\nfunction ensurePisiEditorBlocks/;
const selectionHelpersReplacement = `function getPisiEditorNodePath(editor, node) {
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
        if (!current?.childNodes || index < 0 || index >= current.childNodes.length) {
            return null;
        }
        current = current.childNodes[index];
    }

    return current;
}

function capturePisiEditorSelection(editor) {
    const selection = window.getSelection?.();

    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);

    if (
        !editor.contains(range.startContainer) ||
        !editor.contains(range.endContainer)
    ) {
        return null;
    }

    const getTextOffset = (container, offset) => {
        const prefix = range.cloneRange();
        prefix.selectNodeContents(editor);
        prefix.setEnd(container, offset);
        return prefix.toString().length;
    };

    const makePoint = (container, offset) => ({
        nodePath: getPisiEditorNodePath(editor, container),
        offset,
        textOffset: getTextOffset(container, offset)
    });

    return {
        start: makePoint(range.startContainer, range.startOffset),
        end: makePoint(range.endContainer, range.endOffset)
    };
}

function resolvePisiEditorTextPosition(editor, targetOffset) {
    const walker = document.createTreeWalker(
        editor,
        NodeFilter.SHOW_TEXT
    );
    let remaining = Math.max(0, Number(targetOffset) || 0);
    let lastTextNode = null;

    while (walker.nextNode()) {
        const textNode = walker.currentNode;
        const length = textNode.nodeValue?.length || 0;
        lastTextNode = textNode;

        if (remaining <= length) {
            return {
                node: textNode,
                offset: remaining
            };
        }

        remaining -= length;
    }

    if (lastTextNode) {
        return {
            node: lastTextNode,
            offset: lastTextNode.nodeValue?.length || 0
        };
    }

    const fallback =
        editor.querySelector?.('.pisi-editor-block') ||
        editor.firstElementChild ||
        editor;

    return {
        node: fallback,
        offset: 0
    };
}

function isValidPisiEditorRangeOffset(node, offset) {
    if (!node || !Number.isInteger(offset) || offset < 0) return false;

    if (node.nodeType === Node.TEXT_NODE) {
        return offset <= (node.nodeValue?.length || 0);
    }

    return offset <= (node.childNodes?.length || 0);
}

function resolvePisiEditorSelectionPoint(editor, point) {
    const pathNode = resolvePisiEditorNodePath(editor, point?.nodePath);

    if (isValidPisiEditorRangeOffset(pathNode, point?.offset)) {
        return {
            node: pathNode,
            offset: point.offset
        };
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

function ensurePisiEditorBlocks`;

tagIndex = replaceOnce(
    tagIndex,
    selectionHelpersPattern,
    selectionHelpersReplacement,
    'selection helpers'
);
fs.writeFileSync(tagIndexPath, tagIndex, 'utf8');

const nodeEditorPath = 'renderer/editor/pisi-node-editor.mjs';
let nodeEditor = fs.readFileSync(nodeEditorPath, 'utf8');

const focusHelper = `function focusPisiEditorAtEnd(editor) {
    if (!editor) return;

    editor.focus({ preventScroll: true });

    const selection = window.getSelection?.();
    if (!selection) return;

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    editor.scrollTop = editor.scrollHeight;
}

`;

if (!nodeEditor.includes('function focusPisiEditorAtEnd(')) {
    nodeEditor = replaceOnce(
        nodeEditor,
        '\nasync function openNodeModalFromBox(box) {',
        `\n${focusHelper}async function openNodeModalFromBox(box) {`,
        'modal function insertion point'
    );
}

nodeEditor = replaceOnce(
    nodeEditor,
    /    overlay\?\.classList\.add\('visible'\);\n    contentInput\?\.focus\(\);\n    return true;/,
    `    overlay?.classList.add('visible');
    requestAnimationFrame(() => {
        focusPisiEditorAtEnd(contentInput);
    });
    return true;`,
    'modal initial focus'
);

nodeEditor = replaceOnce(
    nodeEditor,
    /    setTimeout\(\(\) => \{\n        contentEditor\?\.focus\(\{ preventScroll: true \}\);\n    \}, 0\);/,
    `    setTimeout(() => {
        focusPisiEditorAtEnd(contentEditor);
    }, 0);`,
    'center editor initial focus'
);

fs.writeFileSync(nodeEditorPath, nodeEditor, 'utf8');

const testPath = 'tests/source-invariants.test.js';
let tests = fs.readFileSync(testPath, 'utf8');

if (!tests.includes("const nodeEditorSource = read('renderer/editor/pisi-node-editor.mjs');")) {
    tests = replaceOnce(
        tests,
        "const mapWorkspaceSource = read('renderer/map/pisi-map-workspace.mjs');",
        "const mapWorkspaceSource = read('renderer/map/pisi-map-workspace.mjs');\nconst nodeEditorSource = read('renderer/editor/pisi-node-editor.mjs');",
        'node editor invariant source'
    );
}

const enterCaretTest = `test('Enter ile boş satır korunur ve belge sonunda açılır', () => {
    assert.match(tagIndexSource, /function getPisiEditorNodePath\\(/);
    assert.match(tagIndexSource, /function resolvePisiEditorNodePath\\(/);
    assert.match(tagIndexSource, /nodePath: getPisiEditorNodePath\\(editor, container\\)/);
    assert.match(tagIndexSource, /function resolvePisiEditorSelectionPoint\\(/);

    assert.match(nodeEditorSource, /function focusPisiEditorAtEnd\\(/);
    assert.match(nodeEditorSource, /range\\.collapse\\(false\\)/);
    assert.match(nodeEditorSource, /focusPisiEditorAtEnd\\(contentInput\\)/);
    assert.match(nodeEditorSource, /focusPisiEditorAtEnd\\(contentEditor\\)/);
});

`;

if (!tests.includes("test('Enter ile boş satır korunur ve belge sonunda açılır'")) {
    tests = replaceOnce(
        tests,
        "test('Paint geçici yükleme nitelikleri kalıcı HTML içine yazılmaz', () => {",
        enterCaretTest + "test('Paint geçici yükleme nitelikleri kalıcı HTML içine yazılmaz', () => {",
        'enter/caret invariant test insertion point'
    );
}

fs.writeFileSync(testPath, tests, 'utf8');
console.log('Editor Enter and initial caret fix applied.');
