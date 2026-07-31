'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFileSync(path.join(root, file), content);

function replaceRequired(source, before, after, label) {
    if (!source.includes(before)) {
        if (source.includes(after)) return source;
        throw new Error(`${label} integration point not found.`);
    }
    return source.replace(before, after);
}

function patchBootstrap() {
    const file = 'renderer/bootstrap.mjs';
    let source = read(file);
    source = replaceRequired(
        source,
        'import "./editor/pisi-editor-paint.mjs";\n',
        'import "./editor/pisi-editor-paint.mjs";\n' +
            'import "./editor/pisi-editor-document-ink.mjs";\n',
        'Renderer bootstrap'
    );
    write(file, source);
}

function patchStyleChain() {
    const file = 'style.css';
    let source = read(file);
    source = replaceRequired(
        source,
        '@import url("./styles/65-unified-toolbar.css") layer(pisi);\n' +
            '@import url("./styles/70-components.css") layer(pisi);',
        '@import url("./styles/65-unified-toolbar.css") layer(pisi);\n' +
            '@import url("./styles/66-document-ink.css") layer(pisi);\n' +
            '@import url("./styles/70-components.css") layer(pisi);',
        'Stylesheet chain'
    );
    write(file, source);
}

function patchSanitizer() {
    const file = 'renderer/editor/pisi-node-editor.mjs';
    let source = read(file);

    source = replaceRequired(
        source,
        "                    'data-pisi-canvas',\n" +
            "                    'data-image'\n",
        "                    'data-pisi-canvas',\n" +
            "                    'data-pisi-document-ink',\n" +
            "                    'data-image'\n",
        'Canvas attribute sanitizer'
    );

    const oldNormalization = `        if (element.tagName === 'CANVAS') {
            const width = Math.min(1600, Math.max(1, Number(element.getAttribute('width')) || 520));
            const height = Math.min(1200, Math.max(1, Number(element.getAttribute('height')) || 320));
            element.setAttribute('width', String(width));
            element.setAttribute('height', String(height));
            element.setAttribute('data-pisi-canvas', '1');
            element.removeAttribute('data-pisi-canvas-bound');
            element.removeAttribute('data-image-loaded');
        }
`;
    const newNormalization = `        if (element.tagName === 'CANVAS') {
            const isDocumentInk = element.hasAttribute(
                'data-pisi-document-ink'
            );
            const maxWidth = isDocumentInk ? 4096 : 1600;
            const maxHeight = isDocumentInk ? 4096 : 1200;
            const fallbackWidth = isDocumentInk ? 1 : 520;
            const fallbackHeight = isDocumentInk ? 1 : 320;
            const width = Math.min(
                maxWidth,
                Math.max(
                    1,
                    Number(element.getAttribute('width')) || fallbackWidth
                )
            );
            const height = Math.min(
                maxHeight,
                Math.max(
                    1,
                    Number(element.getAttribute('height')) || fallbackHeight
                )
            );

            element.setAttribute('width', String(width));
            element.setAttribute('height', String(height));

            if (isDocumentInk) {
                element.setAttribute('data-pisi-document-ink', '1');
                element.removeAttribute('data-pisi-canvas');
            } else {
                element.setAttribute('data-pisi-canvas', '1');
                element.removeAttribute('data-pisi-document-ink');
            }

            element.removeAttribute('data-pisi-canvas-bound');
            element.removeAttribute('data-image-loaded');
        }
`;

    source = replaceRequired(
        source,
        oldNormalization,
        newNormalization,
        'Canvas normalization'
    );
    write(file, source);
}

function patchEditorSave() {
    const file = 'renderer/map/pisi-map-workspace.mjs';
    let source = read(file);
    const before = `    editor.querySelectorAll?.('canvas[data-pisi-canvas]')?.forEach?.((canvas) => {
        if (typeof savePisiCanvasData === 'function') {
            savePisiCanvasData(canvas);
        }
    });

    if (typeof hydratePisiSheets === 'function') {
`;
    const after = `    editor.querySelectorAll?.('canvas[data-pisi-canvas]')?.forEach?.((canvas) => {
        if (typeof savePisiCanvasData === 'function') {
            savePisiCanvasData(canvas);
        }
    });

    if (typeof savePisiDocumentInkForEditor === 'function') {
        savePisiDocumentInkForEditor(editor);
    }

    if (typeof hydratePisiSheets === 'function') {
`;
    source = replaceRequired(
        source,
        before,
        after,
        'Editor save pipeline'
    );
    write(file, source);
}

function patchModuleManifest() {
    const file = 'renderer/module-manifest.json';
    const manifest = JSON.parse(read(file));

    if (manifest.some((entry) => entry.module === 'editor.documentInk')) {
        return;
    }

    const paintIndex = manifest.findIndex(
        (entry) => entry.module === 'editor.paint'
    );
    if (paintIndex < 0) {
        throw new Error('editor.paint manifest entry not found.');
    }

    manifest.splice(paintIndex + 1, 0, {
        module: 'editor.documentInk',
        path: 'renderer/editor/pisi-editor-document-ink.mjs',
        bindings: [
            'PISI_DOCUMENT_INK_MAX_WIDTH',
            'PISI_DOCUMENT_INK_MAX_HEIGHT',
            'getPisiDocumentInkLayer',
            'getPisiDocumentInkCanvas',
            'hasPisiEmbeddedPaintCanvas',
            'getPisiDocumentInkExtent',
            'resizePisiDocumentInkCanvas',
            'ensurePisiDocumentInkLayer',
            'savePisiDocumentInkData',
            'savePisiDocumentInkForEditor',
            'hydratePisiDocumentInk',
            'bindPisiDocumentInkCanvas',
            'deactivatePisiDocumentInk',
            'activatePisiDocumentInk',
            'syncPisiDocumentInkForPaintTool',
            'bindPisiDocumentInkEditors'
        ]
    });

    write(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

patchBootstrap();
patchStyleChain();
patchSanitizer();
patchEditorSave();
patchModuleManifest();

console.log('Document ink integration applied.');
