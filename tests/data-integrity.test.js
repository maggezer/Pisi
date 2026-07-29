'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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

function loadMainHelpers(functionNames, exports) {
    const source = `
        ${functionNames
            .map((name) => extractFunction(mainSource, name))
            .join('\n')}
        globalThis.testApi = { ${exports.join(', ')} };
    `;
    const context = {
        crypto,
        Date,
        fs,
        Map,
        path,
        Set,
        KEDI_CONNECTION_KEYS: [
            'up-hub',
            'down-hub',
            'co-level',
            'upstream',
            'downstream'
        ],
        KEDI_DIARY_MANAGED_START: '<!--KEDI_DIARY_MANAGED_START-->',
        KEDI_DIARY_MANAGED_END: '<!--KEDI_DIARY_MANAGED_END-->',
        markInternalFileChange() {},
        writeFileAtomic(filePath, content) {
            fs.writeFileSync(filePath, content, 'utf8');
        }
    };

    vm.createContext(context);
    vm.runInContext(source, context);
    return context.testApi;
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('edge onarımı self-loop, tekrar, ikinci parent ve döngüyü güvenli temizler', () => {
    const api = loadMainHelpers([
        'normalizeKediId',
        'normalizeConnectionRole',
        'normalizeMapEdge',
        'isHierarchyEdge',
        'convertEdgeToStream',
        'getKediEdgeSemanticKey',
        'wouldCreateKediHierarchyCycle',
        'normalizeKediMapEdges'
    ], [
        'normalizeMapEdge',
        'normalizeKediMapEdges'
    ]);
    const hierarchy = (id, sourceId, targetId) => ({
        id,
        sourceId,
        targetId,
        type: 'down-hub',
        sourceRole: 'down-hub',
        targetRole: 'up-hub'
    });
    const validIds = new Set(['node_a', 'node_b', 'node_c']);
    const normalized = api.normalizeKediMapEdges([
        hierarchy('edge_ab', 'node_a', 'node_b'),
        hierarchy('edge_ab_copy', 'node_a', 'node_b'),
        hierarchy('edge_cb', 'node_c', 'node_b'),
        hierarchy('edge_ba', 'node_b', 'node_a'),
        hierarchy('edge_self', 'node_a', 'node_a')
    ], validIds);

    assert.equal(normalized.edges.length, 3);
    assert.equal(
        normalized.edges.filter((edge) => edge.type === 'down-hub').length,
        1
    );
    assert.equal(
        normalized.edges.filter((edge) => edge.type === 'stream').length,
        2
    );
    assert.ok(normalized.warnings.length >= 3);

    assert.deepEqual(
        plain(api.normalizeMapEdge({
            id: 'edge_mismatch',
            sourceId: 'node_a',
            targetId: 'node_b',
            type: 'co-level',
            sourceRole: 'downstream',
            targetRole: 'upstream'
        })),
        {
            id: 'edge_mismatch',
            sourceId: 'node_a',
            targetId: 'node_b',
            sourcePort: 'bottom',
            targetPort: 'top',
            type: 'co-level',
            sourceRole: 'co-level',
            targetRole: 'co-level'
        }
    );
});

test('layout ve kamera sayıları güvenli aralıklara sıkıştırılır', () => {
    const api = loadMainHelpers([
        'finiteNumberInRange',
        'normalizeKediNodeLayout',
        'normalizeKediMapCamera'
    ], [
        'normalizeKediNodeLayout',
        'normalizeKediMapCamera'
    ]);

    assert.deepEqual(
        plain(api.normalizeKediMapCamera({
            x: Infinity,
            y: -5000000,
            zoom: 50
        })),
        {
            x: 0,
            y: -1000000,
            zoom: 3
        }
    );
    assert.deepEqual(
        plain(api.normalizeKediNodeLayout({
            x: NaN,
            y: 12,
            width: -10,
            height: 9000
        })),
        {
            x: 80,
            y: 12,
            width: 150,
            height: 4000
        }
    );
});

test('diary temizleyicisi çalıştırılabilir HTML özelliklerini kaldırır', () => {
    const api = loadMainHelpers([
        'sanitizeKediDiaryBlockHtml'
    ], [
        'sanitizeKediDiaryBlockHtml'
    ]);
    const sanitized = api.sanitizeKediDiaryBlockHtml(`
        <div onclick="steal()" style="color:red">
            güvenli
            <a href="javascript:steal()">bağlantı</a>
            <img src="data:image/png;base64,AAAA" onerror=steal()>
            <script>steal()</script>
            <iframe src="https://example.com">içerik</iframe>
        </div>
    `);

    assert.doesNotMatch(sanitized, /onclick|onerror|javascript:|script|iframe/i);
    assert.match(sanitized, /güvenli/);
    assert.match(sanitized, /data:image\/png;base64,AAAA/);
});

test('diary managed alanı çıkarılırken manuel boşluklar korunur', () => {
    const api = loadMainHelpers([
        'stripKediDiaryManagedSection'
    ], [
        'stripKediDiaryManagedSection'
    ]);
    const content = [
        '  manuel başlangıç\n',
        '<!--KEDI_DIARY_MANAGED_START-->',
        '<div>otomatik görev</div>',
        '<!--KEDI_DIARY_MANAGED_END-->',
        '\nmanuel son  '
    ].join('');

    assert.equal(
        api.stripKediDiaryManagedSection(content),
        '  manuel başlangıç\n\nmanuel son  '
    );
});

test('normal kullanıcı diary klasörü marker eklenmeden korunur', (t) => {
    const projectFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), 'kedi-diary-guard-')
    );
    const diaryFolder = path.join(projectFolder, 'diary');
    fs.mkdirSync(diaryFolder);
    fs.writeFileSync(
        path.join(diaryFolder, 'kullanici-notu.txt'),
        'korunacak',
        'utf8'
    );
    t.after(() => {
        fs.rmSync(projectFolder, { recursive: true, force: true });
    });

    const api = loadMainHelpers([
        'normalizeKediDiaryIsoDate',
        'readJsonFileResult',
        'isKediManagedDiaryFolder',
        'ensureKediDiaryFolder'
    ], [
        'ensureKediDiaryFolder'
    ]);
    const result = api.ensureKediDiaryFolder(projectFolder);

    assert.equal(result.ok, false);
    assert.match(result.error, /kullanıcı klasörünü korumak/i);
    assert.equal(
        fs.existsSync(path.join(diaryFolder, '.kedi-diary')),
        false
    );
});
