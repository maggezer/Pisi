'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { extractFunction } = require('./source-helper');

const { readMainSource } = require('./source-bundle');
const mainSource = readMainSource();

function loadValidationApi(projectFolder) {
    const functionNames = [
        'getPisiFileExt',
        'sanitizePisiBaseName',
        'normalizePisiId',
        'normalizePathForCompare',
        'isSameOrInsidePath',
        'assertNoSymbolicLinksBetween',
        'assertProjectPath'
    ];
    const source = `
        let activeProjectFolder = ${JSON.stringify(projectFolder)};
        ${functionNames.map((name) => extractFunction(mainSource, name)).join('\n')}
        globalThis.pisiValidationApi = {
            sanitizePisiBaseName,
            normalizePisiId,
            assertProjectPath
        };
    `;
    const context = {
        fs,
        path,
        process
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return context.pisiValidationApi;
}

test('PISI kimlikleri yol parçaları ve yanlış tür öneklerini reddeder', () => {
    const api = loadValidationApi(process.cwd());

    assert.equal(api.normalizePisiId('node_safe-123', '.node'), 'node_safe-123');
    assert.equal(api.normalizePisiId('../outside', '.node'), null);
    assert.equal(api.normalizePisiId('node_..\\outside', '.node'), null);
    assert.equal(api.normalizePisiId('map_safe', '.node'), null);
});

test('Windows reserved adları güvenli dosya adına dönüştürülür', () => {
    const api = loadValidationApi(process.cwd());

    assert.equal(api.sanitizePisiBaseName('CON'), '_CON');
    assert.equal(api.sanitizePisiBaseName('LPT1.txt'), '_LPT1.txt');
    assert.equal(api.sanitizePisiBaseName('../not:allowed'), '.._not_allowed');
});

test('proje yolu sınırı dış erişimi ve symlink kaçışını engeller', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-security-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-outside-'));
    const projectRoot = fs.realpathSync.native(root);
    const outsideRoot = fs.realpathSync.native(outside);

    t.after(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    });

    const nodePath = path.join(projectRoot, 'safe.node');
    fs.writeFileSync(nodePath, '{}', 'utf8');
    const api = loadValidationApi(projectRoot);

    assert.equal(
        api.assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        }),
        path.resolve(nodePath)
    );
    assert.throws(() => api.assertProjectPath(path.join(outsideRoot, 'escape.node')), /dışında|bulunamadı/);

    const linkPath = path.join(projectRoot, 'outside-link');
    try {
        fs.symlinkSync(outsideRoot, linkPath, 'dir');
    } catch (error) {
        t.skip(`Symlink oluşturulamıyor: ${error.message}`);
        return;
    }

    assert.throws(
        () =>
            api.assertProjectPath(path.join(linkPath, 'escape.node'), {
                mustExist: false
            }),
        /symlink|bağlantı/
    );
});
