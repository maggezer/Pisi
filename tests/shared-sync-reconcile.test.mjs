// Decision engine of a sync turn (docs/sync-plan.md §3.6, S1.5): table-driven
// cases for index + local scan + remote changes → actions.

import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPisiSyncRemoteOrder, makePisiSyncIndexEntry, planPisiSyncCommits, reconcilePisiSyncTurn } from '../shared/sync-reconcile.mjs';

const DEV = 'dv_8h1Lq0Zx2Wc7Vb3Nm5Kp4J';
const fid = (name) => `f_${name.padEnd(43, 'x')}`;
const meta = (path, op = 'put', extra = {}) => ({
    v: 1,
    path,
    class: 'node',
    op,
    sha256: `sha-${extra.content || 'r'}`,
    docId: extra.docId || 'node_1',
    dev: DEV,
    dseq: 1,
    renamedFrom: null,
    ...extra
});
const indexed = (name, path, extra = {}) => ({
    [fid(name)]: { path, seq: 10, blob: `b_${name}`, sha256: `sha-${name}-base`, size: 1, docId: `node_${name}`, ...extra }
});
const scan = (name, path, sha, extra = {}) => ({ path, fid: fid(name), sha256: sha, size: 1, docId: `node_${name}`, ...extra });
const change = (name, path, op = 'put', extra = {}) => ({
    seq: extra.seq || 20,
    fid: fid(name),
    op,
    blob: op === 'put' ? extra.blob || `b_${name}_new` : null,
    device: DEV,
    commit: extra.commit || 'cm_1',
    meta:
        extra.meta === undefined
            ? meta(path, op, { docId: `node_${name}`, sha256: extra.sha256 || `sha-${name}-remote`, ...(extra.metaExtra || {}) })
            : extra.meta,
    invalid: extra.invalid || null
});
const decide = (input) => reconcilePisiSyncTurn(input).actions.map((action) => [action.type, action.path, action.code ?? action.baseSeq ?? null]);

const cases = [
    {
        name: 'yeni yerel dosya gönderilir (baseSeq 0)',
        input: { local: [scan('a', 'A.node', 'sha-a')] },
        expected: [['push-put', 'A.node', 0]]
    },
    {
        name: 'değişmeyen dosya için eylem yok',
        input: { index: indexed('a', 'A.node'), local: [scan('a', 'A.node', 'sha-a-base')] },
        expected: []
    },
    {
        name: 'yalnız yerelde değişen dosya gönderilir (baseSeq = indeks)',
        input: { index: indexed('a', 'A.node'), local: [scan('a', 'A.node', 'sha-a-yerel')] },
        expected: [['push-put', 'A.node', 10]]
    },
    {
        name: 'yalnız uzakta değişen dosya uygulanır',
        input: { index: indexed('a', 'A.node'), local: [scan('a', 'A.node', 'sha-a-base')], remote: [change('a', 'A.node')] },
        expected: [['pull', 'A.node', null]]
    },
    {
        name: 'iki tarafta değişen .node birleştirilir',
        input: { index: indexed('a', 'A.node'), local: [scan('a', 'A.node', 'sha-a-yerel')], remote: [change('a', 'A.node')] },
        expected: [['merge', 'A.node', 20]]
    },
    {
        name: 'iki taraf aynı içeriğe vardıysa yalnız indeks güncellenir',
        input: { index: indexed('a', 'A.node'), local: [scan('a', 'A.node', 'sha-a-remote')], remote: [change('a', 'A.node')] },
        expected: [['adopt', 'A.node', null]]
    },
    {
        name: 'aynı yolda iki yeni dosya: temel olmadan birleştirme',
        input: { local: [scan('a', 'A.node', 'sha-a-yerel')], remote: [change('a', 'A.node')] },
        expected: [['merge', 'A.node', 20]]
    },
    {
        name: 'iki tarafta değişen başka dosya: yerel kenara kopyalanır',
        input: {
            index: indexed('p', 'rapor.pdf'),
            local: [scan('p', 'rapor.pdf', 'sha-yerel')],
            remote: [change('p', 'rapor.pdf', 'put', { metaExtra: { class: 'other' } })]
        },
        expected: [['conflict-copy', 'rapor.pdf', null]]
    },
    {
        name: 'uzak silme, yerel değişmemiş: telefonda da uygulanır',
        input: { role: 'member', index: indexed('a', 'A.node'), local: [scan('a', 'A.node', 'sha-a-base')], remote: [change('a', 'A.node', 'delete')] },
        expected: [['remove', 'A.node', null]]
    },
    {
        name: 'uzak silme, yerelde değişmiş, yeniden adlandırma yok: çakışma kopyası',
        input: { role: 'member', index: indexed('a', 'A.node'), local: [scan('a', 'A.node', 'sha-a-yerel')], remote: [change('a', 'A.node', 'delete')] },
        expected: [['keep-copy', 'A.node', null]]
    },
    {
        name: 'uzakta yeniden adlandırılan dosyanın yerel düzenlemesi yeni yola birleşir',
        input: {
            role: 'member',
            index: indexed('a', 'A.node'),
            local: [scan('a', 'A.node', 'sha-a-yerel')],
            remote: [
                change('a', 'A.node', 'delete', { seq: 21 }),
                change('b', 'B.node', 'put', { seq: 22, metaExtra: { renamedFrom: fid('a'), docId: 'node_a' } })
            ]
        },
        expected: [['rename-merge', 'A.node', null]]
    },
    {
        name: 'masaüstünde silinen dosya: silme gönderilir',
        input: { role: 'admin', index: indexed('a', 'A.node') },
        expected: [['push-delete', 'A.node', 10]]
    },
    {
        name: 'telefonda eksik dosya silinmiş sayılmaz, yeniden indirilir (SV12)',
        input: { role: 'member', index: indexed('a', 'A.node') },
        expected: [['pull', 'A.node', null]]
    },
    {
        name: 'masaüstünde silinen dosya uzakta değişmiş: uzak sürüm kopya olur, silme gönderilir',
        input: { role: 'admin', index: indexed('a', 'A.node'), remote: [change('a', 'A.node')] },
        expected: [['delete-with-copy', 'A.node', 20]]
    },
    {
        name: 'masaüstünde yeniden adlandırma: aynı docId ile silme + koyma',
        input: { role: 'admin', index: indexed('a', 'Eski.node'), local: [scan('b', 'Yeni.node', 'sha-a-base', { docId: 'node_a' })] },
        expected: [
            ['push-delete', 'Eski.node', 10],
            ['push-put', 'Yeni.node', 0]
        ]
    },
    {
        name: 'kaydedilmemiş açık belge uzak değişiklikte ertelenir (SV4)',
        input: { index: indexed('a', 'A.node'), local: [scan('a', 'A.node', 'sha-a-yerel', { dirty: true })], remote: [change('a', 'A.node')] },
        expected: [['defer', 'A.node', 'DEFERRED_DIRTY']]
    },
    {
        name: 'bozuk yerel JSON ne gönderilir ne ezilir (SV10)',
        input: { index: indexed('a', 'A.node'), local: [scan('a', 'A.node', 'sha-bozuk', { corrupt: true })], remote: [change('a', 'A.node')] },
        expected: [['skip', 'A.node', 'LOCAL_CORRUPT']]
    },
    {
        name: 'doğrulanmayan uzak değişiklik uygulanmaz (SV9)',
        input: {
            index: indexed('a', 'A.node'),
            local: [scan('a', 'A.node', 'sha-a-base')],
            remote: [change('a', 'A.node', 'put', { invalid: 'DECRYPT_FAILED', meta: null })]
        },
        expected: [['skip', 'A.node', 'DECRYPT_FAILED']]
    },
    {
        name: 'büyük-küçük harfle çakışan iki yerel dosya gönderilmez',
        input: { local: [scan('a', 'Not.node', 'sha-1'), scan('b', 'not.node', 'sha-2')] },
        expected: [
            ['skip', 'Not.node', 'PATH_COLLISION'],
            ['skip', 'not.node', 'PATH_COLLISION']
        ]
    },
    {
        name: 'güvensiz yerel yol gönderilmez; senkron dışı yol sessizce atlanır',
        input: { local: [scan('a', 'a/ /b.node', 'sha-1'), scan('b', '.pisi/trash/items/x.json', 'sha-2')] },
        expected: [['skip', 'a/ /b.node', 'PATH_UNSAFE']]
    },
    {
        name: 'çok büyük dosya gönderilmez',
        input: { local: [scan('a', 'video.mp4', 'sha-1', { tooLarge: true })] },
        expected: [['skip', 'video.mp4', 'FILE_TOO_LARGE']]
    },
    {
        name: 'uygulama sırası: ekler, belgeler, otorite; sonra gönderimler',
        input: {
            local: [scan('t', '.pisi/tasks.json', 'sha-t-yerel'), scan('n', 'B.node', 'sha-n')],
            index: indexed('t', '.pisi/tasks.json'),
            remote: [
                change('t2', '.pisi/relationships.json', 'put', { metaExtra: { class: 'authority' } }),
                change('i', 'inv_A__node_1/image/abc.png', 'put', { metaExtra: { class: 'asset' } }),
                change('m', 'A.node')
            ]
        },
        expected: [
            ['pull', 'inv_A__node_1/image/abc.png', null],
            ['pull', 'A.node', null],
            ['pull', '.pisi/relationships.json', null],
            ['push-put', 'B.node', 0],
            ['push-put', '.pisi/tasks.json', 10]
        ]
    }
];

for (const { name, input, expected } of cases) {
    test(name, () => assert.deepEqual(decide(input), expected));
}

test('telefon hiçbir durumda silme göndermez', () => {
    const inputs = cases.map((entry) => ({ ...entry.input, role: 'member' }));
    for (const input of inputs) {
        assert.equal(
            reconcilePisiSyncTurn(input).actions.some((action) => action.type === 'push-delete' || action.type === 'delete-with-copy'),
            false
        );
    }
});

test('gönderimler en çok 200 değişiklikli commit’lere bölünür; yeniden adlandırma çifti ayrılmaz', () => {
    const pushes = Array.from({ length: 399 }, (_, index) => ({ type: 'push-put', fid: fid(`p${index}`), renamedFrom: null }));
    pushes.splice(199, 0, { type: 'push-delete', fid: fid('old') }, { type: 'push-put', fid: fid('new'), renamedFrom: fid('old') });
    const commits = planPisiSyncCommits(pushes);
    assert.deepEqual(
        commits.map((commit) => commit.length),
        [199, 200, 2]
    );
    const withRename = commits.find((commit) => commit.some((push) => push.fid === fid('new')));
    assert.ok(withRename.some((push) => push.fid === fid('old')));
});

test('sunucu geri sarma ve yeniden oynatma denetimleri (§7.4)', () => {
    const row = (seq, dseq) => ({ seq, fid: fid(`s${seq}`), device: DEV, meta: { dseq } });
    assert.deepEqual(checkPisiSyncRemoteOrder({ cursor: 50, head: 40 }).code, 'SERVER_ROLLBACK');
    assert.deepEqual(checkPisiSyncRemoteOrder({ cursor: 50, head: 60, changes: [row(49, 1)] }).code, 'SERVER_ROLLBACK');
    assert.deepEqual(checkPisiSyncRemoteOrder({ cursor: 50, head: 60, changes: [row(52, 3), row(51, 4)] }).code, 'SERVER_ROLLBACK');
    const checked = checkPisiSyncRemoteOrder({ cursor: 50, head: 60, changes: [row(51, 5), row(52, 5), row(53, 4), row(54, 6)], lastDseq: { [DEV]: 4 } });
    assert.deepEqual(
        [checked.ok, checked.accepted.map((item) => item.seq), checked.rejected.map((item) => [item.seq, item.code]), checked.lastDseq[DEV]],
        [
            true,
            [51, 54],
            [
                [52, 'SERVER_REPLAY'],
                [53, 'SERVER_REPLAY']
            ],
            6
        ]
    );
    assert.equal(checkPisiSyncRemoteOrder({ cursor: 50, head: 60, heads: true, changes: [row(5, 1), row(3, 1)] }).ok, true);
    assert.equal(makePisiSyncIndexEntry({ path: 'İ.node', seq: 1, blob: 'b', sha256: 's', size: 1 }).pathKey, 'i̇.node');
});
