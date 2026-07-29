'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { extractFunction } = require('./source-helper');

const mainSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'main.js'),
    'utf8'
);

function loadValidationApi(projectFolder) {
    const functionNames = [
        'getKediFileExt',
        'sanitizeKediBaseName',
        'normalizeKediId',
        'normalizePathForCompare',
        'isSameOrInsidePath',
        'assertNoSymbolicLinksBetween',
        'assertProjectPath'
    ];
    const source = `
        let activeProjectFolder = ${JSON.stringify(projectFolder)};
        ${functionNames
            .map((name) => extractFunction(mainSource, name))
            .join('\n')}
        globalThis.kediValidationApi = {
            sanitizeKediBaseName,
            normalizeKediId,
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
    return context.kediValidationApi;
}

test('KEDI kimlikleri yol parçaları ve yanlış tür öneklerini reddeder', () => {
    const api = loadValidationApi(process.cwd());

    assert.equal(api.normalizeKediId('node_safe-123', '.node'), 'node_safe-123');
    assert.equal(api.normalizeKediId('../outside', '.node'), null);
    assert.equal(api.normalizeKediId('node_..\\outside', '.node'), null);
    assert.equal(api.normalizeKediId('map_safe', '.node'), null);
});

test('Windows reserved adları güvenli dosya adına dönüştürülür', () => {
    const api = loadValidationApi(process.cwd());

    assert.equal(api.sanitizeKediBaseName('CON'), '_CON');
    assert.equal(api.sanitizeKediBaseName('LPT1.txt'), '_LPT1.txt');
    assert.equal(api.sanitizeKediBaseName('../not:allowed'), '.._not_allowed');
});

test('proje yolu sınırı dış erişimi ve symlink kaçışını engeller', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kedi-security-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kedi-outside-'));

    t.after(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    });

    const nodePath = path.join(root, 'safe.node');
    fs.writeFileSync(nodePath, '{}', 'utf8');
    const api = loadValidationApi(root);

    assert.equal(
        api.assertProjectPath(nodePath, {
            type: 'file',
            extensions: ['.node']
        }),
        path.resolve(nodePath)
    );
    assert.throws(
        () => api.assertProjectPath(path.join(outside, 'escape.node')),
        /dışında|bulunamadı/
    );

    const linkPath = path.join(root, 'outside-link');
    try {
        fs.symlinkSync(outside, linkPath, 'dir');
    } catch (error) {
        t.skip(`Symlink oluşturulamıyor: ${error.message}`);
        return;
    }

    assert.throws(
        () => api.assertProjectPath(path.join(linkPath, 'escape.node'), {
            mustExist: false
        }),
        /symlink|bağlantı/
    );
});
