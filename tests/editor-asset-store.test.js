'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    getPisiPaintAssetReference,
    normalizePisiEditorPaintAssets,
    hydratePisiEditorPaintAssets
} = require('../main/functions/editor-asset-store');

const PNG_SIGNATURE = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

function makePng(seed) {
    return Buffer.concat([
        PNG_SIGNATURE,
        Buffer.from([seed, seed + 1, seed + 2, seed + 3])
    ]);
}

function makeCanvasHtml(buffer) {
    return [
        '<div class="pisi-canvas-block">',
        '<canvas data-pisi-canvas="1" width="20" height="10" ',
        `data-image="data:image/png;base64,${buffer.toString('base64')}"></canvas>`,
        '</div>'
    ].join('');
}

test('Paint PNG is externalized to a content-addressed sidecar asset', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-paint-asset-'));
    const sidecar = path.join(root, 'Note.pisi-node');
    fs.mkdirSync(sidecar, { recursive: true });

    try {
        const png = makePng(12);
        const reference = getPisiPaintAssetReference(png);
        const normalized = normalizePisiEditorPaintAssets(
            makeCanvasHtml(png),
            { sidecarPath: sidecar }
        );

        assert.equal(normalized.assets.length, 1);
        assert.equal(normalized.assets[0], reference.relativePath);
        assert.equal(normalized.written.length, 1);
        assert.doesNotMatch(normalized.content, /data-image=/i);
        assert.match(
            normalized.content,
            new RegExp(`data-pisi-asset="${reference.relativePath.replace('.', '\\.')}"`)
        );

        const assetPath = path.join(sidecar, ...reference.relativePath.split('/'));
        assert.equal(fs.existsSync(assetPath), true);
        assert.deepEqual(fs.readFileSync(assetPath), png);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Paint sidecar asset hydrates to transient renderer data-image', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-paint-hydrate-'));
    const sidecar = path.join(root, 'Note.pisi-node');
    fs.mkdirSync(sidecar, { recursive: true });

    try {
        const png = makePng(22);
        const normalized = normalizePisiEditorPaintAssets(
            makeCanvasHtml(png),
            { sidecarPath: sidecar }
        );
        const hydrated = hydratePisiEditorPaintAssets(
            normalized.content,
            { sidecarPath: sidecar }
        );

        assert.match(hydrated, /data-pisi-asset="paint\/[a-f0-9]{64}\.png"/i);
        assert.match(
            hydrated,
            new RegExp(
                `data-image="data:image/png;base64,${png.toString('base64')}"`
            )
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Saving the same Paint PNG twice reuses the same asset file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-paint-dedupe-'));
    const sidecar = path.join(root, 'Note.pisi-node');
    fs.mkdirSync(sidecar, { recursive: true });

    try {
        const png = makePng(32);
        const first = normalizePisiEditorPaintAssets(
            makeCanvasHtml(png),
            { sidecarPath: sidecar }
        );
        const second = normalizePisiEditorPaintAssets(
            makeCanvasHtml(png),
            { sidecarPath: sidecar }
        );

        assert.deepEqual(first.assets, second.assets);
        assert.equal(first.written.length, 1);
        assert.equal(second.written.length, 0);
        assert.equal(
            fs.readdirSync(path.join(sidecar, 'paint')).length,
            1
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Changed Paint PNG creates a new immutable asset reference', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-paint-version-'));
    const sidecar = path.join(root, 'Note.pisi-node');
    fs.mkdirSync(sidecar, { recursive: true });

    try {
        const first = normalizePisiEditorPaintAssets(
            makeCanvasHtml(makePng(42)),
            { sidecarPath: sidecar }
        );
        const second = normalizePisiEditorPaintAssets(
            makeCanvasHtml(makePng(52)),
            { sidecarPath: sidecar }
        );

        assert.notEqual(first.assets[0], second.assets[0]);
        assert.equal(
            fs.readdirSync(path.join(sidecar, 'paint')).length,
            2
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Normalization without writes is safe for history comparisons', () => {
    const png = makePng(62);
    const normalized = normalizePisiEditorPaintAssets(
        makeCanvasHtml(png),
        { writeAssets: false }
    );

    assert.equal(normalized.written.length, 0);
    assert.doesNotMatch(normalized.content, /data-image=/i);
    assert.match(normalized.content, /data-pisi-asset="paint\/[a-f0-9]{64}\.png"/i);
});
