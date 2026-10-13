'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { extractFunction } = require('./source-helper');
const editorAssets = require('../main/functions/editor-asset-store');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'main/functions/portability.js'), 'utf8');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const exportFunctions = [
    'escapePisiPortableHtml',
    'stripPisiUnsafeExportHtml',
    'stripPisiTaskMetadataHtml',
    'pisiEmbedPaintImagesForExport',
    'pisiExportHtmlDocument',
    'exportPisiNodeDocument'
]
    .map((name) => (source.includes(`async function ${name}(`) ? 'async ' : '') + extractFunction(source, name))
    .join('\n');

function createExportHarness(format, content, sidecarPath, outputPath) {
    let loadedHtml = '';
    const documentOptions = [];

    class FakeBrowserWindow {
        constructor() {
            this.webContents = {
                printToPDF: async () => Buffer.from('PDF')
            };
        }

        async loadURL(url) {
            loadedHtml = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
        }

        isDestroyed() {
            return false;
        }

        destroy() {}
    }

    const context = vm.createContext({
        Buffer,
        BrowserWindow: FakeBrowserWindow,
        dialog: {
            showSaveDialog: async () => ({ canceled: false, filePath: outputPath })
        },
        editorAssets,
        fs,
        getPisiDocument: (_nodePath, options) => {
            documentOptions.push(options);
            return {
                ok: true,
                metadata: { title: 'Paint note' },
                data: {
                    content: options?.hydrateEditorAssets === true ? editorAssets.hydratePisiEditorAssets(content, { sidecarPath }) : content
                }
            };
        },
        mainWindow: null
    });

    vm.runInContext(exportFunctions, context);

    return {
        run: () => context.exportPisiNodeDocument('paint-note.node', format),
        getLoadedHtml: () => loadedHtml,
        documentOptions
    };
}

test('HTML and PDF node exports embed validated Paint sidecar PNGs as images', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-canvas-export-'));
    const sidecarPath = path.join(temporaryRoot, 'Paint note.pisi-node');
    fs.mkdirSync(sidecarPath, { recursive: true });

    try {
        const png = Buffer.concat([PNG_SIGNATURE, Buffer.from([1, 2, 3, 4])]);
        const normalized = editorAssets.normalizePisiEditorPaintAssets(
            `<div><canvas data-pisi-canvas="1" width="20" height="10" data-image="data:image/png;base64,${png.toString('base64')}"></canvas></div>`,
            { sidecarPath }
        );

        for (const format of ['html', 'pdf']) {
            const outputPath = path.join(temporaryRoot, `Paint note.${format}`);
            const harness = createExportHarness(format, normalized.content, sidecarPath, outputPath);
            const result = await harness.run();
            assert.equal(result.ok, true);
            assert.equal(harness.documentOptions[0].hydrateEditorAssets, true);

            const html = format === 'html' ? fs.readFileSync(outputPath, 'utf8') : harness.getLoadedHtml();
            assert.match(html, /<img src="data:image\/png;base64,/);
            assert.match(html, /width="20" height="10"/);
            assert.doesNotMatch(html, /<canvas\b|data-pisi-asset=/i);
        }
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test('node export rejects Paint canvases without a verified PNG image', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-canvas-export-invalid-'));

    try {
        const content = '<canvas data-pisi-canvas="1" data-pisi-asset="paint/missing.png"></canvas>';
        const harness = createExportHarness('html', content, temporaryRoot, path.join(temporaryRoot, 'note.html'));

        await assert.rejects(harness.run(), /Paint canvas PNG verisi geçersiz/);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});
