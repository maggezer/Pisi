// The real-hosting smoke test (scripts/sync-smoke.mjs, docs/sync-plan.md S7 step 2)
// against the local PHP test server: it passes, deletes its temporary space, and its
// output (meant to be pasted into a PR) holds neither the server address nor the setup
// key nor a token — also when it fails. `npm run test:sync-server` runs it.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startSyncTestServer } from '../scripts/start-sync-test-server.mjs';
import { SYNC_SERVER_SKIP } from './sync-server-client.mjs';

const script = path.join(import.meta.dirname, '..', 'scripts', 'sync-smoke.mjs');

function runSmoke(args, env) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', (chunk) => (output += chunk));
        child.stderr.on('data', (chunk) => (output += chunk));
        child.on('exit', (status) => resolve({ status, output }));
    });
}

function assertNothingLeaks(server, output) {
    assert.ok(!output.includes(server.baseUrl), 'sunucu adresi çıktıda yok');
    assert.ok(!output.includes(`127.0.0.1:${server.port}`), 'sunucu adresi çıktıda yok');
    assert.ok(!output.includes(server.setupKey), 'kurulum anahtarı çıktıda yok');
    assert.doesNotMatch(output, /\bpsk_[A-Za-z0-9_-]{8,}|\btok_[A-Za-z0-9_-]{8,}/, 'anahtar ya da token biçiminde metin yok');
}

describe('gerçek sunucu duman testi (sync:smoke)', { skip: SYNC_SERVER_SKIP }, () => {
    let server;
    before(async () => {
        server = await startSyncTestServer();
    });
    after(async () => {
        await server?.stop();
    });

    test('senaryo 1, 2, 5 ve 8 geçer; geçici alan silinir; çıktıda adres ve anahtar yok', async () => {
        const { status, output } = await runSmoke(['--server', server.baseUrl, '--json'], {
            PISI_SYNC_SETUP_KEY: server.setupKey,
            PISI_SYNC_SMOKE_ALLOW_LOOPBACK: '1'
        });
        assert.equal(status, 0, output);
        assert.match(output, /Sonuç: GEÇTİ/);
        const report = JSON.parse(output.trim().split('\n').at(-1));
        assert.equal(report.ok, true);
        for (const name of ['1. ', '2. ', '5. ', '8. '])
            assert.ok(
                report.steps.some((item) => item.name.startsWith(name) && item.ok),
                name
            );
        assert.ok(report.steps.some((item) => item.name === 'geçici alan silindi' && item.ok));
        assert.equal(Number(server.sql('SELECT COUNT(*) AS n FROM spaces').rows[0].n), 0, 'alan sunucuda kalmaz');
        assert.equal(Number(server.sql('SELECT COUNT(*) AS n FROM devices').rows[0].n), 0, 'cihazlar da gider');
        assertNothingLeaks(server, output);
    });

    test('yanlış kurulum anahtarında başarısız olur, alan açılmaz; çıktıda adres ve anahtar yine yok', async () => {
        const wrongKey = `psk_${'y'.repeat(43)}`;
        const { status, output } = await runSmoke(['--server', server.baseUrl], { PISI_SYNC_SETUP_KEY: wrongKey, PISI_SYNC_SMOKE_ALLOW_LOOPBACK: '1' });
        assert.equal(status, 1, output);
        assert.match(output, /SETUP_KEY_INVALID/);
        assert.match(output, /Sonuç: BAŞARISIZ/);
        assert.ok(!output.includes(wrongKey));
        assertNothingLeaks(server, output);
        assert.equal(Number(server.sql('SELECT COUNT(*) AS n FROM spaces').rows[0].n), 0);
    });

    test('kurulum anahtarı yalnız ortam değişkeninden okunur; https olmayan adres reddedilir', async () => {
        const missing = await runSmoke(['--server', 'https://sunucu.ornek'], { PISI_SYNC_SETUP_KEY: '' });
        assert.equal(missing.status, 2);
        assert.match(missing.output, /PISI_SYNC_SETUP_KEY/);
        const plain = await runSmoke(['--server', 'http://sunucu.ornek'], { PISI_SYNC_SETUP_KEY: 'x', PISI_SYNC_SMOKE_ALLOW_LOOPBACK: '' });
        assert.equal(plain.status, 2);
        assert.match(plain.output, /https/);
    });
});
