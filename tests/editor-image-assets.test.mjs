import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
    PISI_IMAGE_MAX_BYTES,
    PISI_IMAGE_ORPHAN_GRACE_MS,
    collectPisiEditorAssetReferences,
    detectPisiImageFormat,
    normalizePisiEditorAssets,
    prunePisiEditorAssetStore,
    readPisiImageAsset,
    validatePisiImageBuffer,
    writePisiImageAsset
} from '../main/functions/editor-asset-store.js';

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function makePng(width, height) {
    const chunk = (type, data) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(data.length, 0);
        head.write(type, 4, 'ascii');
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
        return Buffer.concat([head, data, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    const rows = Buffer.alloc((width * 3 + 1) * height);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(rows)),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

function makeJpeg(width, height) {
    // SOI, an APP0 segment to skip, then SOF0 with the frame size.
    const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
    const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00]);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

function makeWebpLossless(width, height) {
    const bits = (width - 1) | ((height - 1) << 14);
    const payload = Buffer.alloc(5);
    payload[0] = 0x2f;
    payload.writeUInt32LE(bits >>> 0, 1);
    const chunk = Buffer.concat([Buffer.from('VP8L', 'ascii'), Buffer.from([payload.length, 0, 0, 0]), payload]);
    const riff = Buffer.alloc(8);
    riff.write('RIFF', 0, 'ascii');
    riff.writeUInt32LE(4 + chunk.length, 4);
    return Buffer.concat([riff, Buffer.from('WEBP', 'ascii'), chunk]);
}

const GIF_3X2 = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.from([3, 0, 2, 0, 0, 0, 0]), Buffer.from([0x3b])]);

function withSidecar(run) {
    const sidecar = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-image-assets-'));
    try {
        return run(sidecar);
    } finally {
        fs.rmSync(sidecar, { recursive: true, force: true });
    }
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

test('image format comes from the leading bytes with real dimensions', () => {
    assert.deepEqual(detectPisiImageFormat(makePng(20, 10)), { ext: 'png', mime: 'image/png', width: 20, height: 10 });
    assert.deepEqual(detectPisiImageFormat(makeJpeg(640, 480)), { ext: 'jpg', mime: 'image/jpeg', width: 640, height: 480 });
    assert.deepEqual(detectPisiImageFormat(GIF_3X2), { ext: 'gif', mime: 'image/gif', width: 3, height: 2 });
    assert.deepEqual(detectPisiImageFormat(makeWebpLossless(33, 17)), { ext: 'webp', mime: 'image/webp', width: 33, height: 17 });
    assert.equal(detectPisiImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
    assert.equal(detectPisiImageFormat(Buffer.from('not an image at all')), null);
});

test('validation rejects empty, oversized, unsupported and dimensionless images with stable codes', () => {
    assert.equal(validatePisiImageBuffer(Buffer.alloc(0)).code, 'IMAGE_EMPTY');
    assert.equal(validatePisiImageBuffer(Buffer.alloc(PISI_IMAGE_MAX_BYTES + 1)).code, 'IMAGE_TOO_LARGE');
    assert.equal(validatePisiImageBuffer(Buffer.from('<svg/>'.padEnd(64, ' '))).code, 'IMAGE_UNSUPPORTED');
    assert.equal(validatePisiImageBuffer(makePng(0, 10)).code, 'IMAGE_INVALID_DIMENSIONS');
    assert.equal(validatePisiImageBuffer(new Uint8Array(makePng(4, 4))).ok, true);
});

test('stored images are content addressed, deduplicated and hash verified on read', () =>
    withSidecar((sidecar) => {
        const png = makePng(8, 8);
        const first = writePisiImageAsset(sidecar, png);
        assert.equal(first.ok, true);
        assert.equal(first.reference, `image/${sha256(png)}.png`);
        assert.deepEqual([first.width, first.height, first.mime, first.written], [8, 8, 'image/png', true]);

        const assetPath = path.join(sidecar, first.reference);
        const past = new Date(Date.now() - 2 * PISI_IMAGE_ORPHAN_GRACE_MS);
        fs.utimesSync(assetPath, past, past);
        const second = writePisiImageAsset(sidecar, Buffer.from(png));
        assert.equal(second.reference, first.reference);
        assert.equal(second.written, false);
        assert.deepEqual(fs.readdirSync(path.join(sidecar, 'image')), [path.basename(assetPath)]);
        assert.ok(fs.statSync(assetPath).mtimeMs > past.getTime(), 'a re-inserted image restarts its grace period');

        const read = readPisiImageAsset(sidecar, first.reference);
        assert.equal(read.ok, true);
        assert.deepEqual(read.buffer, png);

        fs.writeFileSync(assetPath, makePng(9, 9));
        assert.equal(readPisiImageAsset(sidecar, first.reference).code, 'IMAGE_CORRUPT');
        assert.equal(readPisiImageAsset(sidecar, `image/${'a'.repeat(64)}.png`).code, 'IMAGE_NOT_FOUND');
        assert.equal(writePisiImageAsset(sidecar, Buffer.from('plain text pretending to be png')).code, 'IMAGE_UNSUPPORTED');
    }));

test('image references never resolve outside the sidecar image folder', () =>
    withSidecar((sidecar) => {
        for (const reference of [
            '../image.png',
            'image/../../escape.png',
            `image/${'a'.repeat(64)}.svg`,
            `image/${'a'.repeat(64)}.png/../../x`,
            `paint/${'a'.repeat(64)}.png`,
            `/etc/passwd`,
            `image\\${'a'.repeat(64)}.png`
        ]) {
            assert.equal(readPisiImageAsset(sidecar, reference).code, 'IMAGE_REFERENCE_INVALID', reference);
        }
    }));

test('saved HTML keeps only the image reference and drops invalid image references', () => {
    const reference = `image/${'b'.repeat(64)}.jpg`;
    const html =
        `<div class="pisi-image-block"><img data-pisi-image-asset="${reference}" alt="Kapak" src="blob:file:///1234"></div>` +
        '<img data-pisi-image-asset="image/../x.png" src="blob:file:///5678">';
    const normalized = normalizePisiEditorAssets(html, { writeAssets: false });
    assert.equal(normalized.content, `<div class="pisi-image-block"><img data-pisi-image-asset="${reference}" alt="Kapak"></div>`);
    assert.deepEqual(normalized.assets, [reference]);
    assert.deepEqual(collectPisiEditorAssetReferences(normalized.content), [reference]);
});

test('orphan image assets are pruned only after the grace period while referenced ones stay', () =>
    withSidecar((sidecar) => {
        const referenced = writePisiImageAsset(sidecar, makePng(2, 2)).reference;
        const freshOrphan = writePisiImageAsset(sidecar, makePng(3, 3)).reference;
        const oldOrphan = writePisiImageAsset(sidecar, makePng(4, 4)).reference;
        const now = Date.now();
        const old = new Date(now - PISI_IMAGE_ORPHAN_GRACE_MS - 60_000);
        fs.utimesSync(path.join(sidecar, oldOrphan), old, old);
        fs.utimesSync(path.join(sidecar, referenced), old, old);

        const result = prunePisiEditorAssetStore(sidecar, [referenced], { now });
        assert.equal(result.ok, true);
        assert.deepEqual(result.removed, [oldOrphan]);
        assert.deepEqual(result.kept, [referenced, freshOrphan].sort());
        assert.equal(fs.existsSync(path.join(sidecar, oldOrphan)), false);
        assert.equal(fs.existsSync(path.join(sidecar, freshOrphan)), true);
    }));
