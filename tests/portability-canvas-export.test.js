'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const test = require('node:test');
const { extractFunction } = require('./source-helper');
const editorAssets = require('../main/functions/editor-asset-store');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'main/functions/portability.js'), 'utf8');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const exportFunctions = [
    'decodePisiHtmlEntities',
    'escapePisiPortableHtml',
    'stripPisiUnsafeExportHtml',
    'stripPisiTaskMetadataHtml',
    'pisiHtmlToPlainText',
    'pisiHtmlToMarkdown',
    'pisiGetExportSheetRows',
    'pisiExportSheetTableToPlainText',
    'pisiExportSheetTableToMarkdown',
    'pisiTransformSheetTablesForExport',
    'pisiPropertiesFrontmatter',
    'pisiTransformPaintCanvases',
    'pisiEmbedPaintImagesForExport',
    'pisiTransformImageBlocks',
    'pisiEmbedImageBlocksForExport',
    'pisiLinkPaintImagesForMarkdown',
    'pisiDocxPaintImageParagraph',
    'pisiCrc32',
    'makePisiStoredZip',
    'makePisiDocxBuffer',
    'pisiSafeTimestamp',
    'walkPisiFiles',
    'getPisiPortableRelativePath',
    'exportPisiProjectMarkdown',
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
            showSaveDialog: async () => ({ canceled: false, filePath: outputPath }),
            showOpenDialog: async () => ({ canceled: false, filePaths: [outputPath] })
        },
        editorAssets,
        fs,
        pisiCrcTable: null,
        path,
        getPisiDocument: (_nodePath, options) => {
            documentOptions.push(options);
            return {
                ok: true,
                metadata: { title: 'Paint note' },
                sidecarPath,
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
        toPlainText: (html) => context.pisiHtmlToPlainText(html),
        getLoadedHtml: () => loadedHtml,
        documentOptions
    };
}

function createProjectExportHarness(projectRoot, outputFolder, content, sidecarPath) {
    const documentOptions = [];
    const context = vm.createContext({
        Buffer,
        dialog: {
            showOpenDialog: async () => ({ canceled: false, filePaths: [outputFolder] })
        },
        editorAssets,
        fs,
        path,
        getPisiDocument: (_nodePath, options) => {
            documentOptions.push(options);
            return {
                ok: true,
                metadata: { type: 'node', title: 'Paint note' },
                sidecarPath,
                data: {
                    pisi: { type: 'node', title: 'Paint note' },
                    properties: {},
                    content: editorAssets.hydratePisiEditorAssets(content, { sidecarPath })
                }
            };
        },
        mainWindow: null
    });
    const projectFunctions = [
        'decodePisiHtmlEntities',
        'escapePisiPortableHtml',
        'stripPisiUnsafeExportHtml',
        'stripPisiTaskMetadataHtml',
        'pisiHtmlToPlainText',
        'pisiHtmlToMarkdown',
        'pisiGetExportSheetRows',
        'pisiExportSheetTableToPlainText',
        'pisiExportSheetTableToMarkdown',
        'pisiTransformSheetTablesForExport',
        'pisiPropertiesFrontmatter',
        'pisiTransformPaintCanvases',
        'pisiTransformImageBlocks',
        'pisiLinkPaintImagesForMarkdown',
        'pisiSafeTimestamp',
        'walkPisiFiles',
        'getPisiPortableRelativePath',
        'exportPisiProjectMarkdown'
    ]
        .map((name) => (source.includes(`async function ${name}(`) ? 'async ' : '') + extractFunction(source, name))
        .join('\n');
    vm.runInContext(projectFunctions, context);

    return {
        run: () => context.exportPisiProjectMarkdown(projectRoot),
        documentOptions
    };
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function makePng(width = 20, height = 10) {
    const makeChunk = (type, data) => {
        const typeBytes = Buffer.from(type, 'ascii');
        const chunk = Buffer.alloc(12 + data.length);
        chunk.writeUInt32BE(data.length, 0);
        typeBytes.copy(chunk, 4);
        data.copy(chunk, 8);
        chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
        return chunk;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const pixels = Buffer.alloc(height * (width * 4 + 1));
    return Buffer.concat([PNG_SIGNATURE, makeChunk('IHDR', header), makeChunk('IDAT', zlib.deflateSync(pixels)), makeChunk('IEND', Buffer.alloc(0))]);
}

function readStoredZipEntries(buffer) {
    const entries = new Map();
    let offset = 0;

    while (buffer.readUInt32LE(offset) === 0x04034b50) {
        const nameLength = buffer.readUInt16LE(offset + 26);
        const extraLength = buffer.readUInt16LE(offset + 28);
        const size = buffer.readUInt32LE(offset + 18);
        const nameStart = offset + 30;
        const name = buffer.toString('utf8', nameStart, nameStart + nameLength);
        const dataStart = nameStart + nameLength + extraLength;
        entries.set(name, buffer.subarray(dataStart, dataStart + size));
        offset = dataStart + size;
    }

    return entries;
}

test('HTML and PDF node exports embed validated Paint sidecar PNGs as images', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-canvas-export-'));
    const sidecarPath = path.join(temporaryRoot, 'Paint note.pisi-node');
    fs.mkdirSync(sidecarPath, { recursive: true });

    try {
        const png = makePng();
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

test('Markdown node export writes Paint images as sibling assets with relative links', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-canvas-markdown-'));
    const sidecarPath = path.join(temporaryRoot, 'Paint note.pisi-node');
    fs.mkdirSync(sidecarPath, { recursive: true });

    try {
        const png = makePng();
        const normalized = editorAssets.normalizePisiEditorPaintAssets(
            `<canvas data-pisi-canvas="1" width="20" height="10" data-image="data:image/png;base64,${png.toString('base64')}"></canvas>`,
            { sidecarPath }
        );
        const outputPath = path.join(temporaryRoot, 'Paint note.md');
        const harness = createExportHarness('markdown', normalized.content, sidecarPath, outputPath);
        const result = await harness.run();

        assert.equal(result.ok, true);
        assert.equal(harness.documentOptions[0].hydrateEditorAssets, true);
        const markdown = fs.readFileSync(outputPath, 'utf8');
        assert.match(markdown, /!\[Paint canvas\]\(Paint%20note\.assets\/paint-[a-f0-9]{64}\.png\)/);
        const assetDirectory = path.join(temporaryRoot, 'Paint note.assets');
        const [assetName] = fs.readdirSync(assetDirectory);
        assert.deepEqual(fs.readFileSync(path.join(assetDirectory, assetName)), png);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test('DOCX node export includes Paint image media and DrawingML relationships', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-canvas-docx-'));
    const sidecarPath = path.join(temporaryRoot, 'Paint note.pisi-node');
    fs.mkdirSync(sidecarPath, { recursive: true });

    try {
        const png = makePng();
        const normalized = editorAssets.normalizePisiEditorPaintAssets(
            `<canvas data-pisi-canvas="1" data-image="data:image/png;base64,${png.toString('base64')}"></canvas>`,
            { sidecarPath }
        );
        const outputPath = path.join(temporaryRoot, 'Paint note.docx');
        const harness = createExportHarness('docx', normalized.content, sidecarPath, outputPath);
        const result = await harness.run();
        assert.equal(result.ok, true);
        assert.equal(harness.documentOptions[0].hydrateEditorAssets, true);

        const entries = readStoredZipEntries(fs.readFileSync(outputPath));
        assert.deepEqual(entries.get('word/media/paint-1.png'), png);
        assert.match(entries.get('word/document.xml').toString('utf8'), /<a:blip r:embed="rId1"\/>/);
        assert.match(entries.get('word/_rels/document.xml.rels').toString('utf8'), /Target="media\/paint-1\.png"/);
        assert.match(entries.get('[Content_Types].xml').toString('utf8'), /Extension="png" ContentType="image\/png"/);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test('project Markdown export includes hydrated Paint sidecar images', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-project-markdown-'));
    const projectRoot = path.join(temporaryRoot, 'project');
    const outputFolder = path.join(temporaryRoot, 'export');
    const sidecarPath = path.join(projectRoot, 'Paint note.pisi-node');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(sidecarPath, { recursive: true });

    try {
        const png = makePng();
        const normalized = editorAssets.normalizePisiEditorPaintAssets(
            `<canvas data-pisi-canvas="1" data-image="data:image/png;base64,${png.toString('base64')}"></canvas>`,
            { sidecarPath }
        );
        fs.writeFileSync(path.join(projectRoot, 'Paint note.node'), '{}', 'utf8');
        const harness = createProjectExportHarness(projectRoot, outputFolder, normalized.content, sidecarPath);
        const result = await harness.run();

        assert.equal(result.ok, true);
        assert.equal(harness.documentOptions[0].hydrateEditorAssets, true);
        const markdownPath = path.join(result.destination, 'Paint note.md');
        assert.match(fs.readFileSync(markdownPath, 'utf8'), /!\[Paint canvas\]\(Paint%20note\.assets\/paint-[a-f0-9]{64}\.png\)/);
        const assetDirectory = path.join(result.destination, 'Paint note.assets');
        const [assetName] = fs.readdirSync(assetDirectory);
        assert.deepEqual(fs.readFileSync(path.join(assetDirectory, assetName)), png);
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

function createSheetFixture(sidecarPath) {
    const model = {
        databaseId: 'database-test-01',
        title: 'Contacts',
        fields: [
            { id: 'field-name', name: 'Name', type: 'text' },
            {
                id: 'field-status',
                name: 'Status',
                type: 'select',
                options: [{ id: 'opt-open', label: 'Open', color: '#64b5f6' }]
            },
            { id: 'field-active', name: 'Active', type: 'checkbox' }
        ],
        items: [
            {
                id: 'item-1',
                values: {
                    'field-name': { value: 'Ada & Bob', formula: null, format: {} },
                    'field-status': { value: 'opt-open', formula: null, format: {} },
                    'field-active': { value: true, formula: null, format: {} }
                }
            }
        ],
        views: []
    };
    return editorAssets.normalizePisiEditorSheetAssets(`<table data-pisi-sheet="1" data-pisi-sheet-model='${JSON.stringify(model)}'></table>`, { sidecarPath });
}

test('HTML and PDF exports render hydrated Sheet models as visible tables', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sheet-html-export-'));
    const sidecarPath = path.join(temporaryRoot, 'Sheet note.pisi-node');
    fs.mkdirSync(sidecarPath, { recursive: true });

    try {
        const normalized = createSheetFixture(sidecarPath);
        for (const format of ['html', 'pdf']) {
            const outputPath = path.join(temporaryRoot, `Sheet note.${format}`);
            const harness = createExportHarness(format, normalized.content, sidecarPath, outputPath);
            const result = await harness.run();
            assert.equal(result.ok, true);
            const html = format === 'html' ? fs.readFileSync(outputPath, 'utf8') : harness.getLoadedHtml();
            assert.match(html, /<th>Name<\/th>/);
            assert.match(html, /<td>Ada &amp; Bob<\/td>/);
            assert.match(html, /<td>Open<\/td>/);
            assert.match(html, /<td>☑<\/td>/);
            assert.doesNotMatch(html, /data-pisi-sheet-model|data-pisi-sheet-asset/);
        }
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test('Markdown and DOCX exports preserve Sheet fields and cell values', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sheet-text-export-'));
    const sidecarPath = path.join(temporaryRoot, 'Sheet note.pisi-node');
    fs.mkdirSync(sidecarPath, { recursive: true });

    try {
        const normalized = createSheetFixture(sidecarPath);
        const markdownPath = path.join(temporaryRoot, 'Sheet note.md');
        const markdownHarness = createExportHarness('markdown', normalized.content, sidecarPath, markdownPath);
        assert.equal((await markdownHarness.run()).ok, true);
        const markdown = fs.readFileSync(markdownPath, 'utf8');
        assert.match(markdown, /\| Name \| Status \| Active \|/);
        assert.match(markdown, /\| Ada & Bob \| Open \| ☑ \|/);

        const docxPath = path.join(temporaryRoot, 'Sheet note.docx');
        const docxHarness = createExportHarness('docx', normalized.content, sidecarPath, docxPath);
        assert.equal((await docxHarness.run()).ok, true);
        const entries = readStoredZipEntries(fs.readFileSync(docxPath));
        const document = entries.get('word/document.xml').toString('utf8');
        assert.match(document, /Name \| Status \| Active/);
        assert.match(document, /Ada &amp; Bob \| Open \| ☑/);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test('project Markdown export includes hydrated Sheet data', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-project-sheet-export-'));
    const projectRoot = path.join(temporaryRoot, 'project');
    const outputFolder = path.join(temporaryRoot, 'export');
    const sidecarPath = path.join(projectRoot, 'Sheet note.pisi-node');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(sidecarPath, { recursive: true });

    try {
        const normalized = createSheetFixture(sidecarPath);
        fs.writeFileSync(path.join(projectRoot, 'Sheet note.node'), '{}', 'utf8');
        const harness = createProjectExportHarness(projectRoot, outputFolder, normalized.content, sidecarPath);
        const result = await harness.run();
        assert.equal(result.ok, true);
        const markdown = fs.readFileSync(path.join(result.destination, 'Sheet note.md'), 'utf8');
        assert.match(markdown, /\| Name \| Status \| Active \|/);
        assert.match(markdown, /\| Ada & Bob \| Open \| ☑ \|/);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test('node export rejects Sheet blocks without a hydrated, verified sidecar model', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sheet-export-invalid-'));

    try {
        const content = `<table data-pisi-sheet="1" data-pisi-sheet-asset="sheet/${'a'.repeat(64)}.json"></table>`;
        const harness = createExportHarness('html', content, temporaryRoot, path.join(temporaryRoot, 'note.html'));
        await assert.rejects(harness.run(), /Sheet verisi dışa aktarılamadı/);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test('plain-text history conversion does not require a hydrated Sheet export model', () => {
    const harness = createExportHarness('html', '', '', '');
    assert.equal(harness.toPlainText('<table data-pisi-sheet="1" data-pisi-sheet-asset="sheet/missing.json"></table>'), '');
});

const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test('image blocks export from the note sidecar to HTML, PDF, Markdown and DOCX', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-image-export-'));
    const sidecarPath = path.join(temporaryRoot, 'Paint note.pisi-node');
    fs.mkdirSync(sidecarPath, { recursive: true });

    try {
        const png = makePng(30, 12);
        const storedPng = editorAssets.writePisiImageAsset(sidecarPath, png);
        const storedGif = editorAssets.writePisiImageAsset(sidecarPath, GIF_1X1);
        const block = (reference, alt, width = '') =>
            `<div class="pisi-editor-block pisi-image-block" data-pisi-block-type="image" data-pisi-image-block="1" data-pisi-image-align="center" contenteditable="false"><img data-pisi-image-asset="${reference}" alt="${alt}"${width ? ` data-pisi-image-width="${width}"` : ''}></div>`;
        const missing = `image/${'0'.repeat(64)}.png`;
        const content = block(storedPng.reference, 'Grafik', '240') + block(storedGif.reference, 'Nokta') + block(missing, 'Kayıp görsel');

        for (const format of ['html', 'pdf']) {
            const outputPath = path.join(temporaryRoot, `Paint note.${format}`);
            const harness = createExportHarness(format, content, sidecarPath, outputPath);
            assert.equal((await harness.run()).ok, true);
            const html = format === 'html' ? fs.readFileSync(outputPath, 'utf8') : harness.getLoadedHtml();
            assert.match(html, /<img src="data:image\/png;base64,[^"]+" alt="Grafik" width="240">/);
            assert.match(html, /<img src="data:image\/gif;base64,[^"]+" alt="Nokta">/);
            assert.match(html, /<span>Kayıp görsel<\/span>/);
            assert.doesNotMatch(html, /data-pisi-image-asset/);
        }

        const markdownPath = path.join(temporaryRoot, 'Paint note.md');
        assert.equal((await createExportHarness('markdown', content, sidecarPath, markdownPath).run()).ok, true);
        const markdown = fs.readFileSync(markdownPath, 'utf8');
        assert.match(markdown, /!\[Grafik\]\(Paint%20note\.assets\/image-[a-f0-9]{64}\.png\)/);
        assert.match(markdown, /!\[Nokta\]\(Paint%20note\.assets\/image-[a-f0-9]{64}\.gif\)/);
        const assetDirectory = path.join(temporaryRoot, 'Paint note.assets');
        const exportedPng = fs.readdirSync(assetDirectory).find((name) => name.endsWith('.png'));
        assert.deepEqual(fs.readFileSync(path.join(assetDirectory, exportedPng)), png);

        const docxPath = path.join(temporaryRoot, 'Paint note.docx');
        assert.equal((await createExportHarness('docx', content, sidecarPath, docxPath).run()).ok, true);
        const entries = readStoredZipEntries(fs.readFileSync(docxPath));
        assert.deepEqual(entries.get('word/media/image-1.png'), png);
        assert.deepEqual(entries.get('word/media/image-2.gif'), GIF_1X1);
        assert.match(entries.get('word/_rels/document.xml.rels').toString('utf8'), /Target="media\/image-2\.gif"/);
        const contentTypes = entries.get('[Content_Types].xml').toString('utf8');
        assert.match(contentTypes, /Extension="png" ContentType="image\/png"/);
        assert.match(contentTypes, /Extension="gif" ContentType="image\/gif"/);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});
