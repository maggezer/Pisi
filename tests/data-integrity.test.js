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
        ${functionNames.map((name) => extractFunction(mainSource, name)).join('\n')}
        globalThis.testApi = { ${exports.join(', ')} };
    `;
    const context = {
        crypto,
        Date,
        fs,
        Map,
        path,
        Set,
        PISI_CONNECTION_KEYS: ['up-hub', 'down-hub', 'co-level', 'upstream', 'downstream'],
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
    const api = loadMainHelpers(
        [
            'normalizePisiId',
            'normalizeConnectionRole',
            'normalizePisiCustomizationColor',
            'normalizePisiMapEdgeCustomization',
            'normalizeMapEdge',
            'isHierarchyEdge',
            'convertEdgeToStream',
            'getPisiEdgeSemanticKey',
            'wouldCreatePisiHierarchyCycle',
            'normalizePisiMapEdges'
        ],
        ['normalizeMapEdge', 'normalizePisiMapEdges']
    );
    const hierarchy = (id, sourceId, targetId) => ({
        id,
        sourceId,
        targetId,
        type: 'down-hub',
        sourceRole: 'down-hub',
        targetRole: 'up-hub'
    });
    const validIds = new Set(['node_a', 'node_b', 'node_c']);
    const normalized = api.normalizePisiMapEdges(
        [
            hierarchy('edge_ab', 'node_a', 'node_b'),
            hierarchy('edge_ab_copy', 'node_a', 'node_b'),
            hierarchy('edge_cb', 'node_c', 'node_b'),
            hierarchy('edge_ba', 'node_b', 'node_a'),
            hierarchy('edge_self', 'node_a', 'node_a')
        ],
        validIds
    );

    assert.equal(normalized.edges.length, 3);
    assert.equal(normalized.edges.filter((edge) => edge.type === 'down-hub').length, 1);
    assert.equal(normalized.edges.filter((edge) => edge.type === 'stream').length, 2);
    assert.ok(normalized.warnings.length >= 3);

    assert.deepEqual(
        plain(
            api.normalizeMapEdge({
                id: 'edge_mismatch',
                sourceId: 'node_a',
                targetId: 'node_b',
                type: 'co-level',
                sourceRole: 'downstream',
                targetRole: 'upstream',
                customization: {
                    color: '#ABCDEF'
                }
            })
        ),
        {
            id: 'edge_mismatch',
            sourceId: 'node_a',
            targetId: 'node_b',
            sourcePort: 'bottom',
            targetPort: 'top',
            type: 'co-level',
            sourceRole: 'co-level',
            targetRole: 'co-level',
            customization: {
                color: '#abcdef'
            }
        }
    );
});

test('node silme canonical relationship store içinden tüm bağlı ilişkileri topluca kaldırır', () => {
    let writtenRelationships = null;
    const source = `
        ${extractFunction(mainSource, 'deletePisiSemanticRelationshipsForNodes')}
        globalThis.deleteRelationshipsForNodes = deletePisiSemanticRelationshipsForNodes;
    `;
    const context = {
        Array,
        Set,
        pathSecurity: {
            normalizePisiId(value) {
                const id = String(value || '');
                return /^node_[A-Za-z0-9_-]+$/.test(id) ? id : '';
            }
        },
        readPisiRelationshipStore() {
            return {
                ok: true,
                relationships: [
                    { id: 'edge_ab', sourceId: 'node_a', targetId: 'node_b' },
                    { id: 'edge_bc', sourceId: 'node_b', targetId: 'node_c' },
                    { id: 'edge_cd', sourceId: 'node_c', targetId: 'node_d' }
                ]
            };
        },
        writePisiRelationshipStore(_projectFolder, relationships) {
            writtenRelationships = relationships;
            return { ok: true, relationships };
        }
    };

    vm.createContext(context);
    vm.runInContext(source, context);

    const result = context.deleteRelationshipsForNodes('/project', ['node_b']);

    assert.equal(result.ok, true);
    assert.equal(result.removed, 2);
    assert.deepEqual(plain(result.removedRelationshipIds), ['edge_ab', 'edge_bc']);
    assert.deepEqual(plain(writtenRelationships), [
        { id: 'edge_cd', sourceId: 'node_c', targetId: 'node_d' }
    ]);
});

test('layout ve kamera sayıları güvenli aralıklara sıkıştırılır', () => {
    const api = loadMainHelpers(
        ['finiteNumberInRange', 'normalizePisiNodeLayout', 'normalizePisiMapCamera'],
        ['normalizePisiNodeLayout', 'normalizePisiMapCamera']
    );

    assert.deepEqual(
        plain(
            api.normalizePisiMapCamera({
                x: Infinity,
                y: -5000000,
                zoom: 50
            })
        ),
        {
            x: 0,
            y: -1000000,
            zoom: 3
        }
    );
    assert.deepEqual(
        plain(
            api.normalizePisiNodeLayout({
                x: NaN,
                y: 12,
                width: -10,
                height: 9000
            })
        ),
        {
            x: 80,
            y: 12,
            width: 150,
            height: 4000
        }
    );
});

test('diary temizleyicisi çalıştırılabilir HTML özelliklerini kaldırır', () => {
    const api = loadMainHelpers(['sanitizePisiDiaryBlockHtml'], ['sanitizePisiDiaryBlockHtml']);
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
    const api = loadMainHelpers(['stripPisiDiaryManagedSection'], ['stripPisiDiaryManagedSection']);
    const content = [
        '  manuel başlangıç\n',
        '<!--PISI_DIARY_MANAGED_START-->',
        '<div>otomatik görev</div>',
        '<!--PISI_DIARY_MANAGED_END-->',
        '\nmanuel son  '
    ].join('');

    assert.equal(api.stripPisiDiaryManagedSection(content), '  manuel başlangıç\n\nmanuel son  ');
});

test('normal kullanıcı diary klasörü marker eklenmeden korunur', (t) => {
    const projectFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-diary-guard-'));
    const diaryFolder = path.join(projectFolder, 'diary');
    fs.mkdirSync(diaryFolder);
    fs.writeFileSync(path.join(diaryFolder, 'kullanici-notu.txt'), 'korunacak', 'utf8');
    t.after(() => {
        fs.rmSync(projectFolder, { recursive: true, force: true });
    });

    const api = loadMainHelpers(
        ['normalizePisiDiaryIsoDate', 'readJsonFileResult', 'isPisiManagedDiaryFolder', 'ensurePisiDiaryFolder'],
        ['ensurePisiDiaryFolder']
    );
    const result = api.ensurePisiDiaryFolder(projectFolder);

    assert.equal(result.ok, false);
    assert.match(result.error, /kullanıcı klasörünü korumak/i);
    assert.equal(fs.existsSync(path.join(diaryFolder, '.pisi-diary')), false);
});

test('boş diary klasörü güvenle Pisi yönetimine alınır', (t) => {
    const projectFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-empty-diary-'));
    t.after(() => {
        fs.rmSync(projectFolder, { recursive: true, force: true });
    });

    const api = loadMainHelpers(
        ['normalizePisiDiaryIsoDate', 'readJsonFileResult', 'isPisiManagedDiaryFolder', 'ensurePisiDiaryFolder'],
        ['ensurePisiDiaryFolder']
    );

    const diaryFolder = path.join(projectFolder, 'diary');
    fs.mkdirSync(diaryFolder);

    const result = api.ensurePisiDiaryFolder(projectFolder);
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(path.join(diaryFolder, '.pisi-diary')), true);
    assert.equal(fs.existsSync(path.join(diaryFolder, '.kedi-diary')), false);
});

test('watcher PISI kaydını dış değişiklikten dosya imzasıyla ayırır', (t) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-watcher-'));
    const filePath = path.join(folder, 'not.node');
    t.after(() => {
        fs.rmSync(folder, { recursive: true, force: true });
    });

    const functionNames = [
        'normalizePathForCompare',
        'isSameOrInsidePath',
        'getInternalFileChangeSignature',
        'pruneExpiredInternalFileChanges',
        'markInternalDirectoryChange',
        'hasRecentInternalDirectoryChange',
        'markInternalFileChange',
        'sealInternalFileChange',
        'isRecentInternalFileChange',
        'hasRecentInternalFileChangeInside'
    ];
    const source = `
        const recentInternalFileChanges = new Map();
        const recentInternalDirectoryChanges = new Map();
        const PISI_INTERNAL_CHANGE_TTL_MS = 6000;
        const PISI_INTERNAL_DIRECTORY_GRACE_MS = 1200;
        ${functionNames.map((name) => extractFunction(mainSource, name)).join('\n')}
        globalThis.watcherApi = {
            markInternalFileChange,
            sealInternalFileChange,
            isRecentInternalFileChange,
            hasRecentInternalFileChangeInside,
            hasRecentInternalDirectoryChange
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

    assert.equal(context.watcherApi.isRecentInternalFileChange(filePath), true);
    assert.equal(context.watcherApi.hasRecentInternalFileChangeInside(folder), true);
    assert.equal(context.watcherApi.hasRecentInternalDirectoryChange(folder), true);

    fs.writeFileSync(filePath, 'PISI dışındaki daha yeni ve farklı kayıt', 'utf8');

    assert.equal(context.watcherApi.isRecentInternalFileChange(filePath), false);
    assert.equal(context.watcherApi.hasRecentInternalFileChangeInside(folder), false);
});
