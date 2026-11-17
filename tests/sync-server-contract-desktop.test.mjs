// Masaüstü senkron istemcisi gerçek PHP test sunucusuna karşı (docs/sync-plan.md S3).
// İki masaüstü cihazı (sync-client-device.mjs) aynı motoru çalıştırır: ilk yükleme,
// blok düzeyinde birleştirme, çakışma kopyası, silme, yeniden adlandırma, STALE_BASE,
// commit idempotensi ve sunucuya açık veri gitmemesi. `npm run test:sync-server` çalıştırır.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startSyncTestServer } from '../scripts/start-sync-test-server.mjs';
import { SYNC_SERVER_SKIP } from './sync-server-client.mjs';
import { createSpaceFor, createTestDevice, joinWithCode, nodeDoc } from './sync-client-device.mjs';

const NOTE = 'Toplantı Notları.node';
const NOTE_ID = 'node_11111111-2222-4333-8444-555555555555';

async function pairOfDesktops(server) {
    const a = createTestDevice(server, { name: 'Masaüstü A' });
    a.write(
        NOTE,
        nodeDoc(NOTE_ID, 'Toplantı Notları', [
            ['b1', 'Birinci gizli paragraf'],
            ['b2', 'İkinci paragraf'],
            ['b3', 'Üçüncü paragraf']
        ])
    );
    a.write('.pisi/tasks.json', { version: 1, updatedAt: '2026-11-17T08:00:00.000Z', tasks: [] });
    a.write('diary/.pisi-diary', '');
    await createSpaceFor(server, a);
    const first = await a.sync();
    assert.equal(first.ok, true, JSON.stringify(first));
    const b = createTestDevice(server, { name: 'Masaüstü B' });
    await joinWithCode(server, a, b);
    const pulled = await b.sync();
    assert.equal(pulled.ok, true, JSON.stringify(pulled));
    return { a, b };
}

describe('masaüstü senkron istemcisi', { skip: SYNC_SERVER_SKIP }, () => {
    let server;
    before(async () => {
        server = await startSyncTestServer();
    });
    after(async () => {
        await server?.stop();
    });

    test('ilk yükleme ve ikinci masaüstüne iniş bayt bayt aynı', async () => {
        const { a, b } = await pairOfDesktops(server);
        assert.deepEqual(b.list(), a.list());
        for (const file of a.list()) assert.equal(b.read(file), a.read(file), file);
        assert.ok(b.applied.length > 0);
    });

    test('farklı bloklar iki tarafta değişir: ikisi de kalır, kopya yok', async () => {
        const { a, b } = await pairOfDesktops(server);
        const docA = a.readJson(NOTE);
        docA.content = docA.content.replace('Birinci gizli paragraf', 'Birinci A');
        a.write(NOTE, docA);
        const docB = b.readJson(NOTE);
        docB.content = docB.content.replace('Üçüncü paragraf', 'Üçüncü B');
        b.write(NOTE, docB);
        assert.equal((await a.sync()).ok, true);
        const second = await b.sync();
        assert.equal(second.ok, true, JSON.stringify(second));
        assert.ok(second.rounds >= 1);
        await a.sync();
        for (const device of [a, b]) {
            const content = device.readJson(NOTE).content;
            assert.match(content, /Birinci A/);
            assert.match(content, /Üçüncü B/);
            assert.equal(device.list().filter((file) => file.endsWith('.node')).length, 1);
        }
    });

    test('aynı blok iki tarafta değişir: tek çakışma kopyası, iki metin de var', async () => {
        const { a, b } = await pairOfDesktops(server);
        const docA = a.readJson(NOTE);
        docA.content = docA.content.replace('İkinci paragraf', 'İkinci A sürümü');
        a.write(NOTE, docA);
        const docB = b.readJson(NOTE);
        docB.content = docB.content.replace('İkinci paragraf', 'İkinci B sürümü');
        b.write(NOTE, docB);
        assert.equal((await a.sync()).ok, true);
        const result = await b.sync();
        assert.equal(result.ok, true, JSON.stringify(result));
        await a.sync();
        await b.sync();
        for (const device of [a, b]) {
            const notes = device.list().filter((file) => file.endsWith('.node'));
            assert.equal(notes.length, 2, notes.join(', '));
            const all = notes.map((file) => device.read(file)).join('\n');
            assert.match(all, /İkinci A sürümü/);
            assert.match(all, /İkinci B sürümü/);
        }
        assert.deepEqual(a.list(), b.list());
        const state = await b.store.load();
        assert.ok(state.conflicts.some((entry) => entry.kind === 'copy'));
    });

    test('silme ve yeniden adlandırma öbür masaüstüne yayılır', async () => {
        const { a, b } = await pairOfDesktops(server);
        a.write('Silinecek.node', nodeDoc('node_aaaaaaaa-2222-4333-8444-555555555555', 'Silinecek', [['x1', 'sil']]));
        await a.sync();
        await b.sync();
        assert.ok(b.read('Silinecek.node'));
        a.remove('Silinecek.node');
        const doc = a.readJson(NOTE);
        a.remove(NOTE);
        a.write('Yeni Ad.node', doc);
        assert.equal((await a.sync()).ok, true);
        const result = await b.sync();
        assert.equal(result.ok, true);
        assert.equal(b.read('Silinecek.node'), null);
        assert.equal(b.read(NOTE), null);
        assert.ok(b.read('Yeni Ad.node'));
        assert.ok(result.removed.includes(NOTE));
    });

    test('kaydedilmemiş açık belgeye uzak değişiklik uygulanmaz, sonra uygulanır', async () => {
        const { a, b } = await pairOfDesktops(server);
        const docA = a.readJson(NOTE);
        docA.content = docA.content.replace('Üçüncü paragraf', 'Üçüncü A');
        a.write(NOTE, docA);
        await a.sync();
        b.dirty.add(NOTE);
        const deferred = await b.sync();
        assert.ok(deferred.issues.some((issue) => issue.code === 'DEFERRED_DIRTY'));
        assert.doesNotMatch(b.read(NOTE), /Üçüncü A/);
        b.dirty.delete(NOTE);
        await b.sync();
        assert.match(b.read(NOTE), /Üçüncü A/);
    });

    test('sunucuya giden hiçbir istekte yol, başlık ya da düz içerik yok', async () => {
        const { a, b } = await pairOfDesktops(server);
        for (const device of [a, b]) {
            for (const request of device.requests) {
                const body = request.body === undefined ? '' : typeof request.body === 'string' ? request.body : Buffer.from(request.body).toString('latin1');
                const text = `${request.path} ${body}`;
                for (const secret of ['Toplantı', 'Toplant', 'gizli paragraf', 'tasks.json', '.pisi', 'diary', 'Masaüstü', 'Pisi Projem']) {
                    assert.equal(text.includes(secret), false, `${request.method} ${request.path} içinde "${secret}"`);
                }
            }
        }
    });

    test('commit ağ hatasında aynı commitId ile yeniden gönderilir, çift kayıt olmaz', async () => {
        const { a } = await pairOfDesktops(server);
        a.write('Ek.node', nodeDoc('node_bbbbbbbb-2222-4333-8444-555555555555', 'Ek', [['e1', 'ek']]));
        let dropNext = true;
        const flaky = createTestDevice(server, {
            project: a.project,
            fetchImpl: async (url, options) => {
                const response = await fetch(url, options);
                if (dropNext && String(url).endsWith('/commit')) {
                    dropNext = false;
                    throw new TypeError('fetch failed');
                }
                return response;
            }
        });
        flaky.store = a.store;
        // The engine of `a` with a flaky transport: re-create it on a's state.
        const { createPisiSyncEngine } = await import('../main/functions/sync-client-engine.js');
        const crypto = await import('node:crypto');
        const engine = createPisiSyncEngine({
            http: flaky.http,
            store: a.store,
            files: a.files,
            random: (n) => new Uint8Array(crypto.randomBytes(n)),
            uuid: () => crypto.randomUUID()
        });
        const result = await engine.runTurn({ reason: 'test' });
        assert.equal(result.ok, true, JSON.stringify(result));
        const head = server.sql('SELECT head FROM spaces WHERE space_id = ?', [a.spaceId]).rows[0].head;
        const rows = server.sql('SELECT COUNT(*) AS n FROM changes WHERE space_id = ?', [a.spaceId]).rows[0].n;
        assert.equal(Number(head), Number(rows));
        const state = await a.store.load();
        assert.equal(state.pendingCommit, null);
        assert.equal(dropNext, false, 'ilk commit yanıtı düşürüldü');
    });

    test('uygulama yarıda kesilirse imleç ve indeks ilerlemez; sonraki tur tamamlar', async () => {
        const { a, b } = await pairOfDesktops(server);
        const docA = a.readJson(NOTE);
        docA.content = docA.content.replace('İkinci paragraf', 'İkinci A');
        a.write(NOTE, docA);
        a.write('Yeni.node', nodeDoc('node_cccccccc-2222-4333-8444-555555555555', 'Yeni', [['y1', 'yeni not']]));
        assert.equal((await a.sync()).ok, true);
        const before = await b.store.load();
        const broken = createTestDevice(server, {
            project: b.project,
            files: {
                beforeWrite: (_op, index) => {
                    if (index === 1) throw new Error('kesildi');
                }
            }
        });
        const { createPisiSyncEngine } = await import('../main/functions/sync-client-engine.js');
        const crypto = await import('node:crypto');
        const engine = createPisiSyncEngine({
            http: b.http,
            store: b.store,
            files: broken.files,
            random: (n) => new Uint8Array(crypto.randomBytes(n)),
            uuid: () => crypto.randomUUID()
        });
        await assert.rejects(engine.runTurn({ reason: 'test' }), /kesildi/);
        const after = await b.store.load();
        assert.equal(after.cursor, before.cursor, 'imleç ilerlemedi');
        assert.deepEqual(Object.keys(after.index).sort(), Object.keys(before.index).sort());
        const result = await b.sync();
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.match(b.read(NOTE), /İkinci A/);
        assert.ok(b.read('Yeni.node'));
        assert.equal(b.read(NOTE), a.read(NOTE));
    });

    test('sunucu geri sarılırsa SERVER_ROLLBACK: tur durur, hiçbir şey yazılmaz', async () => {
        const { a, b } = await pairOfDesktops(server);
        a.write('Ek2.node', nodeDoc('node_dddddddd-2222-4333-8444-555555555555', 'Ek2', [['e', 'x']]));
        await a.sync();
        await b.sync();
        const files = b.list();
        server.sql('UPDATE spaces SET head = 1 WHERE space_id = ?', [b.spaceId]);
        const result = await b.sync();
        assert.equal(result.ok, false);
        assert.equal(result.code, 'SERVER_ROLLBACK');
        assert.deepEqual(b.list(), files);
        assert.equal((await b.store.load()).stopped, 'SERVER_ROLLBACK');
        assert.equal((await b.sync()).code, 'SERVER_ROLLBACK', 'durdurulan senkron kendiliğinden sürmez');
    });

    test('budanmış imleç (CURSOR_EXPIRED) tam karşılaştırmayla toparlanır', async () => {
        const { a, b } = await pairOfDesktops(server);
        for (let round = 0; round < 3; round += 1) {
            const doc = a.readJson(NOTE);
            doc.content = doc.content.replace(/Üçüncü[^<]*/, `Üçüncü tur ${round}`);
            a.write(NOTE, doc);
            await a.sync();
        }
        a.write('Budama.node', nodeDoc('node_eeeeeeee-2222-4333-8444-555555555555', 'Budama', [['p', 'budama sonrası']]));
        await a.sync();
        const head = Number(server.sql('SELECT head FROM spaces WHERE space_id = ?', [a.spaceId]).rows[0].head);
        server.sql('UPDATE spaces SET pruned_through = ? WHERE space_id = ?', [head - 1, a.spaceId]);
        const requestsBefore = b.requests.length;
        const result = await b.sync();
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.ok(
            b.requests.slice(requestsBefore).some((request) => request.path.includes('/heads')),
            'tam karşılaştırma yapıldı'
        );
        assert.deepEqual(b.list(), a.list());
        for (const file of a.list()) assert.equal(b.read(file), a.read(file), file);
        assert.equal((await b.store.load()).cursor, head);
    });
});
