// A small QR code encoder for the pairing window (docs/sync-plan.md S3, step 4;
// docs/sync-protocol.md §6.6). Byte mode, error correction level M, versions
// 1–25 (the pairing text is about 250 bytes, version 12–14). It follows the
// ISO/IEC 18004 construction: data codewords, Reed–Solomon blocks over GF(256)
// with 0x11D, interleaving, function patterns, the eight masks and the format
// and version bits. No dependency; tests/sync-qr.test.mjs decodes the result
// with an independent decoder (jsQR, a dev dependency only).

const MAX_VERSION = 25;
// Level M (index 0 of these tables is unused).
const ECC_CODEWORDS_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28];
const ECC_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21];
const FORMAT_LEVEL_M = 0;

function gfMultiply(x, y) {
    let z = 0;
    for (let bit = 7; bit >= 0; bit -= 1) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> bit) & 1) * x;
    }
    return z;
}

function reedSolomonDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i += 1) {
        for (let j = 0; j < result.length; j += 1) {
            result[j] = gfMultiply(result[j], root);
            if (j + 1 < result.length) result[j] ^= result[j + 1];
        }
        root = gfMultiply(root, 0x02);
    }
    return result;
}

function reedSolomonRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);
    for (const byte of data) {
        const factor = byte ^ result.shift();
        result.push(0);
        divisor.forEach((coefficient, index) => {
            result[index] ^= gfMultiply(coefficient, factor);
        });
    }
    return result;
}

function rawDataModules(version) {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
        const alignments = Math.floor(version / 7) + 2;
        result -= (25 * alignments - 10) * alignments - 55;
        if (version >= 7) result -= 36;
    }
    return result;
}

const dataCodewords = (version) => Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[version] * ECC_BLOCKS[version];

function alignmentPositions(version) {
    if (version === 1) return [];
    const count = Math.floor(version / 7) + 2;
    const size = version * 4 + 17;
    const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
    const result = [6];
    for (let position = size - 7; result.length < count; position -= step) result.splice(1, 0, position);
    return result;
}

function encodeData(bytes, version) {
    const bits = [];
    const push = (value, length) => {
        for (let bit = length - 1; bit >= 0; bit -= 1) bits.push((value >>> bit) & 1);
    };
    push(0b0100, 4);
    push(bytes.length, version <= 9 ? 8 : 16);
    for (const byte of bytes) push(byte, 8);
    const capacity = dataCodewords(version) * 8;
    push(0, Math.min(4, capacity - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
    const codewords = [];
    for (let at = 0; at < bits.length; at += 8) codewords.push(bits.slice(at, at + 8).reduce((value, bit) => (value << 1) | bit, 0));
    return codewords;
}

function addErrorCorrection(data, version) {
    const blockCount = ECC_BLOCKS[version];
    const eccLength = ECC_CODEWORDS_PER_BLOCK[version];
    const rawCodewords = Math.floor(rawDataModules(version) / 8);
    const shortBlocks = blockCount - (rawCodewords % blockCount);
    const shortLength = Math.floor(rawCodewords / blockCount);
    const divisor = reedSolomonDivisor(eccLength);
    const blocks = [];
    for (let index = 0, at = 0; index < blockCount; index += 1) {
        const block = data.slice(at, at + shortLength - eccLength + (index < shortBlocks ? 0 : 1));
        at += block.length;
        const ecc = reedSolomonRemainder(block, divisor);
        if (index < shortBlocks) block.push(0);
        blocks.push(block.concat(ecc));
    }
    const result = [];
    for (let column = 0; column < blocks[0].length; column += 1) {
        blocks.forEach((block, index) => {
            if (column !== shortLength - eccLength || index >= shortBlocks) result.push(block[column]);
        });
    }
    return result;
}

function createGrid(version) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => {
        modules[y][x] = dark;
        reserved[y][x] = true;
    };
    for (let i = 0; i < size; i += 1) {
        set(6, i, i % 2 === 0);
        set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [
        [3, 3],
        [size - 4, 3],
        [3, size - 4]
    ]) {
        for (let dy = -4; dy <= 4; dy += 1) {
            for (let dx = -4; dx <= 4; dx += 1) {
                const x = cx + dx;
                const y = cy + dy;
                const distance = Math.max(Math.abs(dx), Math.abs(dy));
                if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4);
            }
        }
    }
    const positions = alignmentPositions(version);
    const last = positions.length - 1;
    positions.forEach((cy, i) => {
        positions.forEach((cx, j) => {
            if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
            for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        });
    });
    drawFormatBits({ modules, reserved, size, set }, 0);
    if (version >= 7) {
        let remainder = version;
        for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
        const bits = (version << 12) | remainder;
        for (let i = 0; i < 18; i += 1) {
            const dark = ((bits >>> i) & 1) === 1;
            const a = size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            set(a, b, dark);
            set(b, a, dark);
        }
    }
    return { modules, reserved, size, set };
}

function drawFormatBits(grid, mask) {
    const { size, set } = grid;
    const data = (FORMAT_LEVEL_M << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i += 1) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
}

function drawCodewords(grid, codewords) {
    const { modules, reserved, size } = grid;
    let index = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vertical = 0; vertical < size; vertical += 1) {
            for (let j = 0; j < 2; j += 1) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - vertical : vertical;
                if (!reserved[y][x] && index < codewords.length * 8) {
                    modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1;
                    index += 1;
                }
            }
        }
    }
}

const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (_x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

function applyMask(grid, mask) {
    const { modules, reserved, size } = grid;
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!reserved[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
}

/** Penalty of rules 1, 2 and 4 of the standard; any mask decodes, this one only picks a readable one. */
function penalty({ modules, size }) {
    let score = 0;
    const lines = [];
    for (let i = 0; i < size; i += 1) {
        lines.push(modules[i]);
        lines.push(modules.map((row) => row[i]));
    }
    for (const line of lines) {
        let run = 1;
        for (let i = 1; i <= size; i += 1) {
            if (i < size && line[i] === line[i - 1]) run += 1;
            else {
                if (run >= 5) score += run - 2;
                run = 1;
            }
        }
    }
    let dark = 0;
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            if (modules[y][x]) dark += 1;
            if (x < size - 1 && y < size - 1) {
                const color = modules[y][x];
                if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) score += 3;
            }
        }
    }
    const total = size * size;
    score += Math.ceil(Math.abs(dark * 20 - total * 10) / total - 1) * 10;
    return score;
}

/** Encodes text (UTF-8) as a QR code. Returns `{ version, size, modules }`, `modules[y][x]` true for dark. */
export function encodePisiSyncQr(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let version = 1;
    while (version <= MAX_VERSION && 4 + (version <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8) version += 1;
    if (version > MAX_VERSION) throw new RangeError('QR için metin çok uzun.');
    const codewords = addErrorCorrection(encodeData(bytes, version), version);
    const grid = createGrid(version);
    drawCodewords(grid, codewords);
    let best = 0;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask += 1) {
        applyMask(grid, mask);
        drawFormatBits(grid, mask);
        const score = penalty(grid);
        if (score < bestScore) {
            best = mask;
            bestScore = score;
        }
        applyMask(grid, mask);
    }
    applyMask(grid, best);
    drawFormatBits(grid, best);
    return { version, size: grid.size, modules: grid.modules };
}

/** An SVG path (`d`) of the dark modules, offset by a quiet zone of `margin` modules. */
export function getPisiSyncQrPath(qr, margin = 4) {
    const parts = [];
    for (let y = 0; y < qr.size; y += 1) {
        for (let x = 0; x < qr.size; x += 1) if (qr.modules[y][x]) parts.push(`M${x + margin} ${y + margin}h1v1h-1z`);
    }
    return parts.join('');
}
