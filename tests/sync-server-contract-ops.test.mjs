// Senkron sunucusu sözleşmesi: işletim ve güvenlik. Bakım (göç bekleniyor), veritabanı
// yok, beklenmeyen hata, hız sınırları, sunucu kotası, web kökü düzeni ve veritabanında açık
// veri bulunmaması (docs/sync-protocol.md §9, §10, §11, §12; plan S2 kabulü).
// `npm run test:sync-server` çalıştırır.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startSyncTestServer } from '../scripts/start-sync-test-server.mjs';
import { computePisiSyncFid, computePisiSyncBlobId, openPisiSyncSpaceKeys, sealPisiSyncEnvelope } from '../shared/sync-crypto.mjs';
import { makePisiSyncChangeMeta, sealPisiSyncChangeMeta } from '../shared/sync-meta.mjs';
import {
    SYNC_SERVER_SKIP,
    call,
    createSpace,
    expectError,
    newToken,
    opaqueEnvelope,
    pairDevice,
    randomId,
    sha256Hex,
    subtle,
    uploadBlob
} from './sync-server-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const head = (space) => `/v1/spaces/${space.spaceId}/head`;

describe('senkron sunucusu: işletim ve güvenlik', { skip: SYNC_SERVER_SKIP }, () => {
    const servers = [];
    const startServer = async (options) => {
        const server = await startSyncTestServer(options);
        servers.push(server);
        return server;
    };
    after(async () => {
        await Promise.all(servers.map((server) => server.stop()));
    });

    test('göç beklenirken MAINTENANCE; migrate.php sonrası çalışır; bakım ayarı', async () => {
        const server = await startServer({ migrate: false });
        assert.equal((await call(server, 'GET', '/v1/info', { protocol: null })).status, 200, '/v1/info veritabanına dokunmaz');
        const waiting = expectError(assert, await call(server, 'GET', `/v1/spaces/${randomId('sp_')}/head`, { token: newToken() }), 'MAINTENANCE');
        assert.equal(waiting.retryable, true);
        expectError(assert, await call(server, 'POST', '/v1/spaces', { headers: { 'Pisi-Setup-Key': server.setupKey }, body: {} }), 'MAINTENANCE');
        const status = server.runBin('migrate.php', ['--status']);
        assert.equal(status.status, 2);
        const migrated = server.runBin('migrate.php');
        assert.equal(migrated.status, 0, migrated.stderr);
        assert.match(migrated.stdout, /Şema sürümü: 1/);
        assert.equal(server.runBin('migrate.php', ['--status']).status, 0);
        const space = await createSpace(server);
        assert.equal((await call(server, 'GET', head(space), { token: space.token })).status, 200);

        const paused = await startServer({ config: { maintenance: true } });
        expectError(assert, await call(paused, 'GET', `/v1/spaces/${randomId('sp_')}/head`, { token: newToken() }), 'MAINTENANCE');
    });

    test('veritabanına bağlanılamazsa DB_UNAVAILABLE; ayrıntı sızmaz', async () => {
        const server = await startServer({
            database: false,
            migrate: false,
            config: { database: { dsn: 'mysql:host=127.0.0.1;port=1;dbname=yok;charset=utf8mb4', user: 'yok', password: 'gizli-parola' } }
        });
        const response = await call(server, 'GET', `/v1/spaces/${randomId('sp_')}/head`, { token: newToken() });
        const error = expectError(assert, response, 'DB_UNAVAILABLE');
        assert.equal(error.retryable, true);
        assert.doesNotMatch(response.text, /gizli-parola|SQLSTATE|PDO|mysql:|\.php/);
        assert.equal(server.runBin('check.php').status, 1, 'check.php bağlantı hatasını bildirir');
    });

    test('beklenmeyen hata INTERNAL döner; yığın izi, yol ya da SQL içermez', async () => {
        const server = await startServer({ config: { testing: { faultInjection: true } } });
        const response = await call(server, 'GET', `/v1/spaces/${randomId('sp_')}/head`, { headers: { 'Pisi-Test-Fault': 'internal' } });
        const error = expectError(assert, response, 'INTERNAL');
        assert.equal(error.retryable, true);
        assert.doesNotMatch(response.text, /fault injection|RuntimeException|#0|\.php|server\//);
        const normal = await startServer();
        const ignored = await call(normal, 'GET', `/v1/spaces/${randomId('sp_')}/head`, { headers: { 'Pisi-Test-Fault': 'internal' } });
        expectError(assert, ignored, 'AUTH_REQUIRED');
    });

    test('hız sınırları: alan açma, yanlış kurulum anahtarı kilidi, geçersiz token, eşleştirme, cihaz', async () => {
        const server = await startServer({
            config: { rateLimits: { spaceCreatePerHour: 5, setupKeyLockSeconds: 3600, pairingPerHour: 10, invalidTokenPerMinute: 30, devicePerMinute: 8 } }
        });
        const space = await createSpace(server);

        // Sabit pencereli sayaç: pencere test sırasında bir kez dönebilir, bu yüzden sınır
        // en çok iki pencere içinde görülmelidir.
        async function untilLimited(send, expectedBefore, limit) {
            let allowed = 0;
            for (let index = 0; index < limit * 2 + 1; index++) {
                const response = await send();
                if (response.status === 429) return { response, allowed };
                assert.equal(response.json?.error?.code ?? 'OK', expectedBefore);
                allowed++;
            }
            assert.fail('hız sınırı görülmedi');
        }

        // Cihaz başına dakikada 8 istek (createSpace sayılmaz).
        const device = await untilLimited(() => call(server, 'GET', head(space), { token: space.token }), 'OK', 8);
        assert.ok(device.allowed >= 8);
        const error = expectError(assert, device.response, 'RATE_LIMITED');
        assert.equal(error.retryable, true);
        assert.match(device.response.headers.get('retry-after'), /^\d+$/);
        assert.ok(Number(device.response.headers.get('retry-after')) <= 60);

        // Geçersiz token: IP başına dakikada 30.
        const other = await createSpace(server);
        const tokens = await untilLimited(() => call(server, 'GET', head(other), { token: newToken() }), 'TOKEN_INVALID', 30);
        assert.ok(tokens.allowed >= 30);
        expectError(assert, tokens.response, 'RATE_LIMITED');
        // Aynı IP'den gelen geçerli token bu sayaçtan etkilenmez.
        assert.equal((await call(server, 'GET', head(other), { token: other.token })).status, 200);

        // Eşleştirme lookup + claim: IP başına saatte 10.
        const lookups = await untilLimited(() => call(server, 'POST', '/v1/pairings/lookup', { body: { code: 'ZZZZ-ZZZZ' } }), 'PAIRING_NOT_FOUND', 10);
        assert.ok(lookups.allowed >= 10);
        expectError(assert, await call(server, 'POST', `/v1/pairings/${randomId('pr_')}/claim`, { body: {} }), 'RATE_LIMITED');

        // Alan açma: IP başına saatte 5 (ilk iki alan dâhil); yanlış anahtar bir saat kilitler.
        for (let index = 0; index < 2; index++) await createSpace(server);
        const wrong = await call(server, 'POST', '/v1/spaces', { headers: { 'Pisi-Setup-Key': 'psk_yanlis' }, body: {} });
        expectError(assert, wrong, 'SETUP_KEY_INVALID');
        const locked = await call(server, 'POST', '/v1/spaces', { headers: { 'Pisi-Setup-Key': server.setupKey }, body: {} });
        expectError(assert, locked, 'RATE_LIMITED');
        assert.ok(Number(locked.headers.get('retry-after')) > 3500, 'kilit bir saat');

        // Sayaç tablosunda IP düz metin değildir.
        const buckets = server.sql('SELECT bucket FROM rate_limits').rows.map((row) => row.bucket);
        assert.ok(buckets.length > 0);
        assert.ok(buckets.every((bucket) => !bucket.includes('127.0.0.1')));
    });

    test('sunucudaki en çok alan sayısı dolunca QUOTA_EXCEEDED', async () => {
        const server = await startServer({ config: { limits: { maxSpaces: 2 } } });
        await createSpace(server);
        await createSpace(server);
        await assert.rejects(createSpace(server), /507/);
        const response = await call(server, 'POST', '/v1/spaces', {
            headers: { 'Pisi-Setup-Key': server.setupKey },
            body: {
                spaceId: randomId('sp_'),
                deviceId: randomId('dv_'),
                tokenHash: sha256Hex(newToken()),
                spaceName: opaqueEnvelope(),
                deviceLabel: opaqueEnvelope()
            }
        });
        assert.deepEqual(expectError(assert, response, 'QUOTA_EXCEEDED').details, { scope: 'spaces' });
    });

    test("bin/spaces.php alanları listeler ve sahipsiz alanı siler; silinen alanın token'ları TOKEN_INVALID alır", async () => {
        const server = await startServer();
        const kept = await createSpace(server);
        const orphan = await createSpace(server);
        const phone = await pairDevice(server, orphan);
        await uploadBlob(server, orphan, crypto.randomBytes(500));
        // The last desktop leaves: the server keeps the space while a phone is still on it.
        expectError(assert, await call(server, 'DELETE', `/v1/spaces/${orphan.spaceId}/devices/me`, { token: orphan.token }), 'LAST_ADMIN');

        const listed = server.runBin('spaces.php', ['list', '--json']);
        assert.equal(listed.status, 0, listed.stderr);
        const spaces = JSON.parse(listed.stdout).spaces;
        assert.deepEqual(spaces.map((space) => space.spaceId).sort(), [kept.spaceId, orphan.spaceId].sort());
        const row = spaces.find((space) => space.spaceId === orphan.spaceId);
        assert.equal(row.admins, 1);
        assert.equal(row.members, 1);
        assert.ok(row.usageBytes >= 500);
        assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}T/);
        // The table holds no name: the server cannot read it.
        const table = server.runBin('spaces.php', ['list']);
        assert.equal(table.status, 0);
        assert.ok(table.stdout.includes(orphan.spaceId) && !table.stdout.includes('Pisi Projem'));

        assert.equal(server.runBin('spaces.php', ['delete', orphan.spaceId]).status, 2, 'onaysız silmez');
        assert.equal(server.runBin('spaces.php', ['delete', orphan.spaceId, `--confirm=${kept.spaceId}`]).status, 2, 'yanlış onayla silmez');
        assert.equal(server.runBin('spaces.php', ['delete', 'sp_kisa', '--confirm=sp_kisa']).status, 2);
        assert.equal(server.runBin('spaces.php', ['frobnicate']).status, 2);
        const deleted = server.runBin('spaces.php', ['delete', orphan.spaceId, `--confirm=${orphan.spaceId}`]);
        assert.equal(deleted.status, 0, deleted.stderr);
        assert.equal(server.runBin('spaces.php', ['delete', orphan.spaceId, `--confirm=${orphan.spaceId}`]).status, 3, 'olmayan alan');

        for (const device of [orphan, phone]) expectError(assert, await call(server, 'GET', head(orphan), { token: device.token }), 'TOKEN_INVALID');
        assert.equal((await call(server, 'GET', head(kept), { token: kept.token })).status, 200);
        assert.equal(Number(server.sql('SELECT COUNT(*) AS n FROM devices WHERE space_id = ?', [orphan.spaceId]).rows[0].n), 0);
        assert.ok(!fs.existsSync(path.join(server.dataDir, 'blobs', orphan.spaceId)), 'blob klasörü kaldırıldı');
        assert.deepEqual(
            JSON.parse(server.runBin('spaces.php', ['list', '--json']).stdout).spaces.map((space) => space.spaceId),
            [kept.spaceId]
        );
    });

    test('server/public yalnız index.php ve .htaccess içerir; ayar, veri ve kod web kökünden okunamaz', async () => {
        assert.deepEqual(fs.readdirSync(path.join(root, 'server', 'public')).sort(), ['.htaccess', 'index.php']);
        const htaccess = fs.readFileSync(path.join(root, 'server', 'public', '.htaccess'), 'utf8');
        assert.match(htaccess, /CGIPassAuth On/);
        assert.match(htaccess, /E=HTTP_AUTHORIZATION:%\{HTTP:Authorization\}/);
        assert.match(htaccess, /Options -Indexes/);
        assert.match(fs.readFileSync(path.join(root, 'server', 'app', '.htaccess'), 'utf8'), /^Require all denied$/m);
        const index = fs.readFileSync(path.join(root, 'server', 'public', 'index.php'), 'utf8');
        assert.equal(index.match(/^const PISI_SYNC_APP_DIR = .+;$/gm)?.length, 1, 'uygulama yolu tek bir sabitten gelir');

        const server = await startServer();
        const space = await createSpace(server);
        const blobId = await uploadBlob(server, space, crypto.randomBytes(100));
        const blobPath = `blobs/${space.spaceId}/${blobId.slice(2, 4)}/${blobId.slice(4, 6)}/${blobId}`;
        const probes = [
            '/config.php',
            '/config.json',
            '/app/config.php',
            '/../app/config.php',
            '/%2e%2e/app/config.php',
            '/.htaccess',
            '/index.php/../config.php',
            '/app/src/Config.php',
            '/app/schema/001-initial.sql',
            '/data/setup-key.hash',
            `/data/${blobPath}`,
            `/${blobPath}`,
            '/v1/../config.php'
        ];
        for (const probe of probes) {
            const response = await call(server, 'GET', probe);
            assert.equal(response.status, 404, probe);
            assert.equal(response.json.error.code, 'NOT_FOUND', probe);
            assert.doesNotMatch(response.text, /setupKeyHash|database|CREATE TABLE|<\?php/, probe);
        }
    });

    test('veritabanında düz token, kurulum anahtarı, dosya yolu, ad ya da kısa kod bulunmaz', async () => {
        const server = await startServer();
        const projectKey = crypto.randomBytes(32);
        const admin = await createSpace(server, { name: 'Gizli Proje Adı', deviceName: 'Ofis MacBook' });
        const keys = await openPisiSyncSpaceKeys(subtle, projectKey, admin.spaceId);
        const member = await pairDevice(server, admin, { name: 'Gizli Pixel', projectKey });

        const notePath = 'Toplantı Notları/Gizli Plan.node';
        const content = new TextEncoder().encode('{"pisi":{"id":"node_gizli"},"content":"<p>Çok gizli içerik</p>"}');
        const fid = await computePisiSyncFid(subtle, keys.fid, notePath);
        const blob = await computePisiSyncBlobId(subtle, keys.blob, content);
        const envelope = await sealPisiSyncEnvelope({
            subtle,
            key: keys.content,
            spaceId: admin.spaceId,
            purpose: 'blob',
            binding: blob,
            plaintext: content,
            nonce: crypto.randomBytes(12)
        });
        await uploadBlob(server, member, envelope, { blobId: blob });
        const meta = makePisiSyncChangeMeta({
            path: notePath,
            op: 'put',
            size: content.length,
            sha256: sha256Hex(content),
            docId: 'node_gizli',
            device: member.deviceId,
            dseq: 1,
            at: new Date().toISOString()
        });
        const sealedMeta = await sealPisiSyncChangeMeta({ subtle, keys, fid, blob, meta, nonce: crypto.randomBytes(12) });
        const committed = await call(server, 'POST', `/v1/spaces/${admin.spaceId}/commit`, {
            token: member.token,
            body: { commitId: randomId('cm_'), changes: [{ fid, op: 'put', blob, size: envelope.length, baseSeq: 0, meta: sealedMeta }] }
        });
        assert.equal(committed.status, 200);
        const pending = await call(server, 'POST', `/v1/spaces/${admin.spaceId}/pairings`, {
            token: admin.token,
            body: { pairingId: randomId('pr_'), deviceId: randomId('dv_'), desktopKey: crypto.randomBytes(65).toString('base64url') }
        });
        const code = pending.json.code;

        const dump = JSON.stringify(server.dump());
        const files = fs
            .readdirSync(server.dataDir, { recursive: true })
            .map((name) => path.join(server.dataDir, name))
            .filter((file) => fs.statSync(file).isFile())
            .map((file) => fs.readFileSync(file).toString('latin1'))
            .join('\n');
        const forbidden = {
            'admin token': admin.token,
            'member token': member.token,
            'kurulum anahtarı': server.setupKey,
            'kısa kod': code,
            'kısa kod (tiresiz)': code.replace('-', ''),
            'dosya yolu': notePath,
            'dosya adı': 'Gizli Plan',
            içerik: 'Çok gizli içerik',
            'proje adı': 'Gizli Proje Adı',
            'cihaz adı': 'Ofis MacBook',
            'telefon adı': 'Gizli Pixel',
            'proje anahtarı': projectKey.toString('base64url')
        };
        const hex = (text) => Buffer.from(text, 'utf8').toString('hex');
        for (const [label, value] of Object.entries(forbidden)) {
            assert.ok(!dump.includes(value) && !dump.includes(hex(value)), `veritabanında ${label} var`);
            assert.ok(!files.includes(Buffer.from(value, 'utf8').toString('latin1')), `veri klasöründe ${label} var`);
        }
        assert.ok(dump.includes(sha256Hex(admin.token)), 'token yalnız SHA-256 özetiyle saklanır');
        assert.ok(!dump.includes(server.setupKey) && !fs.readdirSync(server.dataDir).includes('setup-key.txt'));
    });
});
