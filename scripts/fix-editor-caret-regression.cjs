'use strict';

const fs = require('node:fs');

function replaceOnce(source, pattern, replacement, label) {
    const matches = source.match(pattern);
    if (!matches) {
        throw new Error(`${label} fragment was not found.`);
    }
    return source.replace(pattern, replacement);
}

const tagIndexPath = 'renderer/tags/pisi-tag-index.mjs';
let tagIndex = fs.readFileSync(tagIndexPath, 'utf8');

const ensureBlocksPattern = /function ensurePisiEditorBlocks\(editor\) \{[\s\S]*?\n\}\n\nfunction getPisiBlockElementsFromContainer/;
const ensureBlocksReplacement = `function capturePisiEditorSelection(editor) {
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

    return {
        start: getTextOffset(range.startContainer, range.startOffset),
        end: getTextOffset(range.endContainer, range.endOffset)
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

function restorePisiEditorSelection(editor, snapshot) {
    if (!snapshot) return;

    const selection = window.getSelection?.();
    if (!selection) return;

    const start = resolvePisiEditorTextPosition(editor, snapshot.start);
    const end = resolvePisiEditorTextPosition(editor, snapshot.end);
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
    } finally {
        if (selectionSnapshot) {
            restorePisiEditorSelection(editor, selectionSnapshot);
        }
    }
}

function getPisiBlockElementsFromContainer`;

tagIndex = replaceOnce(
    tagIndex,
    ensureBlocksPattern,
    ensureBlocksReplacement,
    'ensurePisiEditorBlocks'
);
fs.writeFileSync(tagIndexPath, tagIndex, 'utf8');

const workspacePath = 'renderer/map/pisi-map-workspace.mjs';
let workspace = fs.readFileSync(workspacePath, 'utf8');

const getContentPattern = /function getPisiEditorContent\(editor\) \{[\s\S]*?\n\}\n\nfunction markdownTextToPisiEditorHtml/;
const getContentReplacement = `function getPisiEditorContent(editor) {
    if (!editor) return '';

    if (typeof hydratePisiPaintCanvases === 'function') {
        hydratePisiPaintCanvases(editor);
    }

    editor.querySelectorAll?.('canvas[data-pisi-canvas]')?.forEach?.((canvas) => {
        if (typeof savePisiCanvasData === 'function') {
            savePisiCanvasData(canvas);
        }
    });

    if (typeof hydratePisiSheets === 'function') {
        hydratePisiSheets(editor);
    }

    // Kayıt normalizasyonu canlı contenteditable DOM'u değiştirmemeli.
    // Aksi halde Chromium selection/caret konumunu sıfırlar.
    const normalizedEditor = editor.cloneNode(true);
    ensurePisiEditorBlocks(normalizedEditor, {
        preserveSelection: false
    });

    return sanitizePisiEditorHtml(normalizedEditor.innerHTML || '');
}

function markdownTextToPisiEditorHtml`;

workspace = replaceOnce(
    workspace,
    getContentPattern,
    getContentReplacement,
    'getPisiEditorContent'
);
fs.writeFileSync(workspacePath, workspace, 'utf8');

const testPath = 'tests/source-invariants.test.js';
let tests = fs.readFileSync(testPath, 'utf8');

if (!tests.includes("const tagIndexSource = read('renderer/tags/pisi-tag-index.mjs');")) {
    tests = replaceOnce(
        tests,
        "const editorSource = readMany(collect('renderer/editor', '.mjs'));",
        "const editorSource = readMany(collect('renderer/editor', '.mjs'));\nconst tagIndexSource = read('renderer/tags/pisi-tag-index.mjs');\nconst mapWorkspaceSource = read('renderer/map/pisi-map-workspace.mjs');",
        'source invariant imports'
    );
}

const caretTest = `test('editör normalizasyonu caret konumunu korur', () => {
    assert.match(tagIndexSource, /function capturePisiEditorSelection\\(/);
    assert.match(tagIndexSource, /function restorePisiEditorSelection\\(/);
    assert.match(
        tagIndexSource,
        /const selectionSnapshot = preserveSelection[\\s\\S]*?restorePisiEditorSelection\\(editor, selectionSnapshot\\)/
    );

    const contentFunction = mapWorkspaceSource.match(
        /function getPisiEditorContent\\(editor\\) \\{[\\s\\S]*?\\n\\}/
    )?.[0] || '';

    assert.match(contentFunction, /const normalizedEditor = editor\\.cloneNode\\(true\\)/);
    assert.match(
        contentFunction,
        /ensurePisiEditorBlocks\\(normalizedEditor, \\{[\\s\\S]*?preserveSelection: false/
    );
    assert.doesNotMatch(contentFunction, /ensurePisiEditorBlocks\\(editor\\)/);
});

`;

if (!tests.includes("test('editör normalizasyonu caret konumunu korur'")) {
    tests = replaceOnce(
        tests,
        "test('Paint geçici yükleme nitelikleri kalıcı HTML içine yazılmaz', () => {",
        caretTest + "test('Paint geçici yükleme nitelikleri kalıcı HTML içine yazılmaz', () => {",
        'caret regression test insertion'
    );
}

fs.writeFileSync(testPath, tests, 'utf8');
