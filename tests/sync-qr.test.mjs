// Eşleştirme QR kodlayıcısı (renderer/sync/pisi-sync-qr.mjs, docs/sync-plan.md S3 adım 4):
// üretilen kod bağımsız bir çözücüyle (jsQR, yalnız geliştirme bağımlılığı) okunur ve
// metin bayt bayt geri gelir. Eşleştirme metni protokol §6.6 biçimindedir.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { encodePisiSyncQr, getPisiSyncQrPath } from '../renderer/sync/pisi-sync-qr.mjs';
import { formatPisiSyncPairingUri } from '../shared/sync-meta.mjs';

const require = createRequire(import.meta.url);
const jsQR = require('jsqr');

function decode(qr, { scale = 4, margin = 4 } = {}) {
    const width = (qr.size + margin * 2) * scale;
    const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
    for (let y = 0; y < qr.size; y += 1) {
        for (let x = 0; x < qr.size; x += 1) {
            if (!qr.modules[y][x]) continue;
            for (let dy = 0; dy < scale; dy += 1) {
                for (let dx = 0; dx < scale; dx += 1) {
                    const at = (((y + margin) * scale + dy) * width + (x + margin) * scale + dx) * 4;
                    pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
                }
            }
        }
    }
    return jsQR(pixels, width, width, { inversionAttempts: 'dontInvert' });
}

const id = (prefix, bytes = 16) => `${prefix}${crypto.randomBytes(bytes).toString('base64url')}`;

test('eşleştirme QR metni çözücüyle aynen okunur', () => {
    for (const serverUrl of ['https://sync.ornek.com', 'https://çok-uzun-bir-alan-adı.ornek.com.tr/pisi/senkron/sunucu']) {
        const uri = formatPisiSyncPairingUri({
            serverUrl,
            spaceId: id('sp_'),
            pairingId: id('pr_'),
            desktopKey: Buffer.concat([Buffer.from([4]), crypto.randomBytes(64)]).toString('base64url'),
            secret: crypto.randomBytes(32),
            code: '7K3MQ9WX'
        });
        const qr = encodePisiSyncQr(uri);
        assert.ok(qr.version >= 10 && qr.version <= 25, `sürüm ${qr.version}`);
        const result = decode(qr);
        assert.ok(result, `QR çözülemedi (sürüm ${qr.version})`);
        assert.equal(result.data, uri);
    }
});

test('her sürüm aralığında ve Türkçe metinde çözülür', () => {
    for (const length of [1, 17, 40, 90, 150, 220, 300, 400, 600]) {
        const text = 'ğüşiöç'.repeat(Math.ceil(length / 12)).slice(0, Math.ceil(length / 2)) + 'x'.repeat(Math.floor(length / 2));
        const qr = encodePisiSyncQr(text);
        const result = decode(qr);
        assert.ok(result, `uzunluk ${length}, sürüm ${qr.version}`);
        assert.equal(result.data, text);
    }
});

test('çok uzun metin reddedilir; SVG yolu karanlık modülleri çizer', () => {
    assert.throws(() => encodePisiSyncQr('x'.repeat(2000)), RangeError);
    const qr = encodePisiSyncQr('pisi');
    const dark = qr.modules.flat().filter(Boolean).length;
    assert.equal((getPisiSyncQrPath(qr).match(/M/g) || []).length, dark);
});
