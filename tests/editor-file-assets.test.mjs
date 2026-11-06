import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    PISI_IMAGE_ORPHAN_GRACE_MS,
    collectPisiEditorAssetReferences,
    collectPisiEditorFileReferences,
    prunePisiEditorAssetStore
} from '../main/functions/editor-asset-store.js';
import {
    PISI_FILE_MAX_BYTES,
    copyPisiFileAsset,
    getPisiFileExtension,
    isPisiExecutableFileExtension,
    normalizePisiFileName,
    resolvePisiFileAssetPath,
    statPisiFileAsset,
    writePisiFileAsset
} from '../main/functions/editor-file-asset-store.js';

function withSidecar(run) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-file-assets-'));
    try {
        return run(path.join(root, 'Not.pisi-node'), root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

test('attachments are content addressed by hash and keep a safe extension from the original name', () =>
    withSidecar((sidecar) => {
        const bytes = Buffer.from('rapor içeriği');
        const first = writePisiFileAsset(sidecar, bytes, 'Rapor 2026.PDF');
        assert.equal(first.ok, true);
        assert.equal(first.reference, `file/${sha(bytes)}.pdf`);
        assert.equal(first.name, 'Rapor 2026.PDF');
        assert.equal(first.size, bytes.length);
        assert.equal(first.written, true);
        assert.deepEqual(fs.readFileSync(path.join(sidecar, 'file', `${sha(bytes)}.pdf`)), bytes);

        const again = writePisiFileAsset(sidecar, new Uint8Array(bytes), 'başka-ad.pdf');
        assert.equal(again.reference, first.reference);
        assert.equal(again.written, false);
        assert.equal(fs.readdirSync(path.join(sidecar, 'file')).length, 1);
    }));

test('size limit, empty input and file names fail or normalize with stable codes', () =>
    withSidecar((sidecar) => {
        assert.equal(writePisiFileAsset(sidecar, Buffer.alloc(0), 'x.txt').code, 'FILE_EMPTY');
        assert.equal(writePisiFileAsset(sidecar, null, 'x.txt').code, 'FILE_EMPTY');
        const tooLarge = writePisiFileAsset(sidecar, Buffer.alloc(PISI_FILE_MAX_BYTES + 1), 'big.zip');
        assert.equal(tooLarge.code, 'FILE_TOO_LARGE');
        assert.equal(tooLarge.maxBytes, 20 * 1024 * 1024);
        assert.equal(fs.existsSync(path.join(sidecar, 'file')), false);

        assert.equal(normalizePisiFileName('../../etc/passwd'), '.. .. etc passwd');
        assert.equal(normalizePisiFileName('a\u0000b\nc.txt'), 'a b c.txt');
        assert.equal(normalizePisiFileName('..'), 'dosya');
        assert.equal(normalizePisiFileName('x'.repeat(400)).length, 255);
        assert.equal(getPisiFileExtension('arşiv.TAR.GZ'), 'gz');
        assert.equal(getPisiFileExtension('README'), 'bin');
        assert.equal(getPisiFileExtension('.bashrc'), 'bin');
        assert.equal(getPisiFileExtension('x.tab le'), 'bin');
    }));

test('references never resolve outside the sidecar file folder', () =>
    withSidecar((sidecar) => {
        const valid = `file/${'a'.repeat(64)}.docx`;
        assert.equal(resolvePisiFileAssetPath(sidecar, valid).assetPath, path.join(path.resolve(sidecar), 'file', `${'a'.repeat(64)}.docx`));
        for (const reference of [
            `file/../${'a'.repeat(64)}.docx`,
            `image/${'a'.repeat(64)}.png`,
            `file/${'a'.repeat(63)}.pdf`,
            `file/${'a'.repeat(64)}.PDF`,
            `file/${'a'.repeat(64)}`,
            `/file/${'a'.repeat(64)}.pdf`,
            ''
        ]) {
            assert.equal(resolvePisiFileAssetPath(sidecar, reference), null, reference);
            assert.equal(statPisiFileAsset(sidecar, reference).code, 'FILE_REFERENCE_INVALID', reference);
        }
    }));

test('stat verifies existence and hash, and flags executables for reveal-only', () =>
    withSidecar((sidecar) => {
        const stored = writePisiFileAsset(sidecar, Buffer.from('echo hi'), 'kur.sh');
        const stat = statPisiFileAsset(sidecar, stored.reference);
        assert.equal(stat.ok, true);
        assert.equal(stat.executable, true);
        assert.equal(statPisiFileAsset(sidecar, `file/${'b'.repeat(64)}.txt`).code, 'FILE_NOT_FOUND');
        fs.writeFileSync(stat.assetPath, 'değişti');
        assert.equal(statPisiFileAsset(sidecar, stored.reference).code, 'FILE_CORRUPT');

        for (const ext of ['exe', 'BAT', 'msi', 'ps1', 'app', 'dmg', 'appimage', 'jar', 'lnk']) assert.equal(isPisiExecutableFileExtension(ext), true, ext);
        for (const ext of ['pdf', 'docx', 'zip', 'mp4', 'txt']) assert.equal(isPisiExecutableFileExtension(ext), false, ext);
    }));

test('copy re-stores an attachment in another note sidecar with the same reference', () =>
    withSidecar((sidecar, root) => {
        const target = path.join(root, 'Hedef.pisi-node');
        const stored = writePisiFileAsset(sidecar, Buffer.from('tablo'), 'veri.csv');
        const copied = copyPisiFileAsset(sidecar, target, stored.reference);
        assert.equal(copied.ok, true);
        assert.equal(copied.reference, stored.reference);
        assert.equal(statPisiFileAsset(target, stored.reference).ok, true);
        assert.equal(copyPisiFileAsset(target, sidecar, `file/${'c'.repeat(64)}.csv`).code, 'FILE_NOT_FOUND');
    }));

test('attachment references feed integrity, history and orphan cleanup with the grace period', () =>
    withSidecar((sidecar) => {
        const kept = writePisiFileAsset(sidecar, Buffer.from('kalır'), 'a.txt');
        const orphan = writePisiFileAsset(sidecar, Buffer.from('yetim'), 'b.txt');
        const html = `<p>x</p><div class="pisi-file-block" data-pisi-file-block="1" data-pisi-file-asset="${kept.reference}" data-pisi-file-name="a.txt"></div><div data-pisi-file-asset="file/../x.txt"></div>`;
        assert.deepEqual(collectPisiEditorFileReferences(html), [kept.reference]);
        assert.deepEqual(collectPisiEditorAssetReferences(html), [kept.reference]);

        const fresh = prunePisiEditorAssetStore(sidecar, collectPisiEditorAssetReferences(html));
        assert.deepEqual(fresh.removed, []);
        const later = prunePisiEditorAssetStore(sidecar, collectPisiEditorAssetReferences(html), { now: Date.now() + PISI_IMAGE_ORPHAN_GRACE_MS + 1000 });
        assert.deepEqual(later.removed, [orphan.reference]);
        assert.deepEqual(later.kept, [kept.reference]);
        assert.equal(statPisiFileAsset(sidecar, kept.reference).ok, true);
    }));
