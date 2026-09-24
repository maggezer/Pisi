const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function checkPng(bytes) {
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    let offset = 8;
    const data = [];
    let ended = false;
    while (offset < bytes.length) {
        assert.ok(offset + 12 <= bytes.length, 'truncated PNG chunk');
        const length = bytes.readUInt32BE(offset);
        const end = offset + 12 + length;
        assert.ok(end <= bytes.length, 'PNG chunk exceeds file');
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        let crc = 0xffffffff;
        for (const value of bytes.subarray(offset + 4, end - 4)) {
            crc ^= value;
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32BE(end - 4), type + ' checksum');
        if (type === 'IDAT') data.push(bytes.subarray(offset + 8, end - 4));
        offset = end;
        if (type === 'IEND') { ended = true; break; }
    }
    assert.ok(ended, 'missing PNG end');
    assert.equal(offset, bytes.length);
    assert.ok(zlib.inflateSync(Buffer.concat(data)).length > 0);
}

test('desktop PNG has valid chunks, checksums and compressed pixels', () => {
    checkPng(fs.readFileSync(path.join(__dirname, '../assets/pisi.png')));
});

test('Windows ICO contains valid images at every advertised size', () => {
    const bytes = fs.readFileSync(path.join(__dirname, '../assets/pisi.ico'));
    assert.equal(bytes.readUInt16LE(0), 0);
    assert.equal(bytes.readUInt16LE(2), 1);
    const count = bytes.readUInt16LE(4);
    assert.ok(count >= 3);
    let expectedOffset = 6 + count * 16;
    const sizes = [];
    for (let i = 0; i < count; i++) {
        const entry = 6 + i * 16;
        const width = bytes[entry] || 256;
        const height = bytes[entry + 1] || 256;
        const length = bytes.readUInt32LE(entry + 8);
        const offset = bytes.readUInt32LE(entry + 12);
        assert.equal(offset, expectedOffset);
        assert.ok(offset + length <= bytes.length);
        const frame = bytes.subarray(offset, offset + length);
        if (frame[0] === 137) {
            checkPng(frame);
            assert.equal(frame.readUInt32BE(16), width);
            assert.equal(frame.readUInt32BE(20), height);
        } else {
            assert.equal(frame.readUInt32LE(0), 40);
            assert.equal(frame.readInt32LE(4), width);
            assert.equal(frame.readInt32LE(8), height * 2);
            assert.equal(frame.readUInt16LE(14), 32);
            const maskStride = Math.ceil(width / 32) * 4;
            assert.equal(length, 40 + width * height * 4 + maskStride * height);
        }
        sizes.push(width);
        expectedOffset = offset + length;
    }
    assert.equal(expectedOffset, bytes.length);
    for (const size of [16, 32, 48, 256]) assert.ok(sizes.includes(size));
});
