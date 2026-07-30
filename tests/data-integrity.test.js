'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { extractFunction } = require('./source-helper');

const { readMainSource } = require('./source-bundle');
const mainSource = readMainSource();

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
        PISI_CONNECTION_KEYS: [
            'up-hub',
            'down-hub',
            'co-level',
            'upstream',
            'downstream'
        ],
        PISI_DIARY_MANAGED_START: '<!--PISI_DIARY_MANAGED_START-->',
        PISI_DIARY_MANAGED_END: '<!--PISI_DIARY_MANAGED_END-->',
        markInternalFileChange() {},
        sealInternalFileChange() {},
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
        'normalizePisiId',
        'normalizeConnectionRole',
        'normalizeMapEdge',
        'isHierarchyEdge',
        'convertEdgeToStream',
        'getPisiEdgeSemanticKey',
        'wouldCreatePisiHierarchyCycle',
        'normalizePisiMapEdges'
    ], [
        'normalizeMapEdge',
        'normalizePisiMapEdges'
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
    const normalized = api.normalizePisiMapEdges([
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
        'normalizePisiNodeLayout',
        'normalizePisiMapCamera'
    ], [
        'normalizePisiNodeLayout',
        'normalizePisiMapCamera'
    ]);

    assert.deepEqual(
        plain(api.normalizePisiMapCamera({
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
        plain(api.normalizePisiNodeLayout({
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
        'sanitizePisiDiaryBlockHtml'
    ], [
        'sanitizePisiDiaryBlockHtml'
    ]);
    const sanitized = api.sanitizePisiDiaryBlockHtml(`
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
        'stripPisiDiaryManagedSection'
    ], [
        'stripPisiDiaryManagedSection'
    ]);
    const content = [
        '  manuel başlangıç\n',
        '<!--PISI_DIARY_MANAGED_START-->',
        '<div>otomatik görev</div>',
        '<!--PISI_DIARY_MANAGED_END-->',
        '\nmanuel son  '
    ].join('');

    assert.equal(
        api.stripPisiDiaryManagedSection(content),
        '  manuel başlangıç\n\nmanuel son  '
    );
});

test('normal kullanıcı diary klasörü marker eklenmeden korunur', (t) => {
    const projectFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), 'pisi-diary-guard-')
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
        'normalizePisiDiaryIsoDate',
        'readJsonFileResult',
        'isPisiManagedDiaryFolder',
        'ensurePisiDiaryFolder'
    ], [
        'ensurePisiDiaryFolder'
    ]);
    const result = api.ensurePisiDiaryFolder(projectFolder);

    assert.equal(result.ok, false);
    assert.match(result.error, /kullanıcı klasörünü korumak/i);
    assert.equal(
        fs.existsSync(path.join(diaryFolder, '.pisi-diary')),
        false
    );
});

test('boş ve eski işaretçili diary klasörleri güvenle Pisi yönetimine alınır', (t) => {
    const projectFolders = [];
    t.after(() => {
        for (const folder of projectFolders) {
            fs.rmSync(folder, { recursive: true, force: true });
        }
    });

    const api = loadMainHelpers([
        'normalizePisiDiaryIsoDate',
        'readJsonFileResult',
        'isPisiManagedDiaryFolder',
        'ensurePisiDiaryFolder'
    ], [
        'ensurePisiDiaryFolder'
    ]);

    const emptyProject = fs.mkdtempSync(
        path.join(os.tmpdir(), 'pisi-empty-diary-')
    );
    projectFolders.push(emptyProject);
    const emptyDiary = path.join(emptyProject, 'diary');
    fs.mkdirSync(emptyDiary);

    const emptyResult = api.ensurePisiDiaryFolder(emptyProject);
    assert.equal(emptyResult.ok, true);
    assert.equal(
        fs.existsSync(path.join(emptyDiary, '.pisi-diary')),
        true
    );

    const legacyProject = fs.mkdtempSync(
        path.join(os.tmpdir(), 'pisi-legacy-diary-')
    );
    projectFolders.push(legacyProject);
    const legacyDiary = path.join(legacyProject, 'diary');
    fs.mkdirSync(legacyDiary);
    fs.writeFileSync(
        path.join(legacyDiary, '.kedi-diary'),
        'legacy marker',
        'utf8'
    );

    const legacyResult = api.ensurePisiDiaryFolder(legacyProject);
    assert.equal(legacyResult.ok, true);
    assert.equal(
        fs.existsSync(path.join(legacyDiary, '.pisi-diary')),
        true
    );
    assert.equal(
        fs.readFileSync(path.join(legacyDiary, '.kedi-diary'), 'utf8'),
        'legacy marker'
    );
});

test('watcher PISI kaydını dış değişiklikten dosya imzasıyla ayırır', (t) => {
    const folder = fs.mkdtempSync(
        path.join(os.tmpdir(), 'pisi-watcher-')
    );
    const filePath = path.join(folder, 'not.node');
    t.after(() => {
        fs.rmSync(folder, { recursive: true, force: true });
    });

    const functionNames = [
        'normalizePathForCompare',
        'isSameOrInsidePath',
        'getInternalFileChangeSignature',
        'pruneExpiredInternalFileChanges',
        'markInternalFileChange',
        'sealInternalFileChange',
        'isRecentInternalFileChange',
        'hasRecentInternalFileChangeInside'
    ];
    const source = `
        const recentInternalFileChanges = new Map();
        const PISI_INTERNAL_CHANGE_TTL_MS = 6000;
        ${functionNames
            .map((name) => extractFunction(mainSource, name))
            .join('\n')}
        globalThis.watcherApi = {
            markInternalFileChange,
            sealInternalFileChange,
            isRecentInternalFileChange,
            hasRecentInternalFileChangeInside
        };
    `;
    const context = {
        Date,
        fs,
        Map,
        path,
        process
    };
    vm.createContext(context);
    vm.runInContext(source, context);

    context.watcherApi.markInternalFileChange(filePath);
    fs.writeFileSync(filePath, 'PISI kaydı', 'utf8');
    context.watcherApi.sealInternalFileChange(filePath);

    assert.equal(
        context.watcherApi.isRecentInternalFileChange(filePath),
        true
    );
    assert.equal(
        context.watcherApi.hasRecentInternalFileChangeInside(folder),
        true
    );

    fs.writeFileSync(
        filePath,
        'PISI dışındaki daha yeni ve farklı kayıt',
        'utf8'
    );

    assert.equal(
        context.watcherApi.isRecentInternalFileChange(filePath),
        false
    );
    assert.equal(
        context.watcherApi.hasRecentInternalFileChangeInside(folder),
        false
    );
});
