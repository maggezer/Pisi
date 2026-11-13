'use strict';

// Security boundaries, checked on the real main-process modules
// (tests/main-store-harness.cjs): id and file-name validation as the registry
// exposes them (the rules themselves live in shared/ids.mjs and
// shared/document-naming.mjs) and the active-project path guard.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadPisiMainStores } = require('./main-store-harness.cjs');

const modules = loadPisiMainStores();
const pathSecurity = modules['main.pathSecurity'];
const electronIpc = modules['main.electronIpc'];

test('PISI kimlikleri yol parçaları ve yanlış tür öneklerini reddeder', () => {
    assert.equal(pathSecurity.normalizePisiId('node_safe-123', '.node'), 'node_safe-123');
    assert.equal(pathSecurity.normalizePisiId('../outside', '.node'), null);
    assert.equal(pathSecurity.normalizePisiId('node_..\\outside', '.node'), null);
    assert.equal(pathSecurity.normalizePisiId('map_safe', '.node'), null);
});

test('Windows reserved adları güvenli dosya adına dönüştürülür', () => {
    assert.equal(pathSecurity.sanitizePisiBaseName('CON'), '_CON');
    assert.equal(pathSecurity.sanitizePisiBaseName('LPT1.txt'), '_LPT1.txt');
    assert.equal(pathSecurity.sanitizePisiBaseName('../not:allowed'), '.._not_allowed');
});

test('proje yolu sınırı dış erişimi ve symlink kaçışını engeller', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-security-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-outside-'));
    const projectRoot = fs.realpathSync.native(root);
    const outsideRoot = fs.realpathSync.native(outside);

    // runtime.js owns activeProjectFolder in the app; the harness provides it as a plain global.
    globalThis.activeProjectFolder = projectRoot;
    t.after(() => {
        globalThis.activeProjectFolder = null;
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    });

    const nodePath = path.join(projectRoot, 'safe.node');
    fs.writeFileSync(nodePath, '{}', 'utf8');

    assert.equal(
        electronIpc.assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        }),
        path.resolve(nodePath)
    );
    assert.throws(() => electronIpc.assertProjectPath(path.join(outsideRoot, 'escape.node')), /dışında|bulunamadı/);

    const linkPath = path.join(projectRoot, 'outside-link');
    try {
        fs.symlinkSync(outsideRoot, linkPath, 'dir');
    } catch (error) {
        t.skip(`Symlink oluşturulamıyor: ${error.message}`);
        return;
    }

    assert.throws(
        () =>
            electronIpc.assertProjectPath(path.join(linkPath, 'escape.node'), {
                mustExist: false
            }),
        /symlink|bağlantı/
    );
});
