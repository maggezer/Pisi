// Mobil senkron motoru gerçek PHP test sunucusuna karşı (docs/sync-plan.md S5 adım 7).
// Telefon: mobil veri katmanı (bellek sürücüsü) ve mobile/src/sync/ servisi; masaüstü:
// sync-client-device.mjs'teki masaüstü istemcisi. Kodla ve QR ile eşleşme, iki yönlü
// senkron, telefonun hiç delete göndermemesi ve iptal edilen telefon.
// `npm run test:sync-server` çalıştırır.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startSyncTestServer } from '../scripts/start-sync-test-server.mjs';
import { SYNC_SERVER_SKIP } from './sync-server-client.mjs';
import { createSpaceFor, createTestDevice, nodeDoc, serverUrlOf, subtle } from './sync-client-device.mjs';
import { grantPisiSyncPairing, pollPisiSyncPairing, startPisiSyncPairing } from '../main/functions/sync-client-pairing.js';
import { createPhone } from '../mobile/tests/helpers/sync-devices.mjs';
import crypto from 'node:crypto';

const random = (n) => new Uint8Array(crypto.randomBytes(n));
const NOTE = 'Masaüstü Notu.node';
const NOTE_ID = 'node_99999999-2222-4333-8444-555555555555';

async function desktopWithSpace(server) {
    const desktop = createTestDevice(server, { name: 'Masaüstü' });
    desktop.write(NOTE, nodeDoc(NOTE_ID, 'Masaüstü Notu', [['b1', 'Masaüstünde yazılan gizli metin']]));
    desktop.write('.pisi/tasks.json', { version: 1, updatedAt: '2026-11-17T08:00:00.000Z', tasks: [] });
    await createSpaceFor(server, desktop);
    assert.equal((await desktop.sync()).ok, true);
    return desktop;
}

/** The desktop answers a pairing: waits for the claim and grants it. */
async function grant(desktop, started) {
    const state = await desktop.store.load();
    const secrets = await desktop.store.readSecrets();
    for (let tries = 0; tries < 100; tries += 1) {
        const view = await pollPisiSyncPairing({ subtle, http: desktop.http, session: started.session });
        if (view.state === 'claimed') {
            assert.equal(view.valid, true);
            await grantPisiSyncPairing({
                subtle,
                http: desktop.http,
                session: started.session,
                keys: desktop.keys,
                projectKey: secrets.key,
                spaceName: state.spaceName,
                random
            });
            return view;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('talep gelmedi');
}

async function pairedPhone(server, desktop, method = 'code') {
    const phone = createPhone(server, {
        fetchImpl: (url, init) => globalThis.fetch(url, init),
        allowLoopbackHttp: true,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 300)))
    });
    await phone.project.open();
    await phone.service.init();
    const state = await desktop.store.load();
    const started = await startPisiSyncPairing({ subtle, http: desktop.http, serverUrl: state.serverUrl, spaceId: state.spaceId, random });
    const claimed = await phone.service.startPairing(
        method === 'qr'
            ? { method: 'qr', uri: started.view.uri, deviceName: 'Pixel 7' }
            : { method: 'code', serverUrl: serverUrlOf(server), code: started.view.code, deviceName: 'Pixel 7' }
    );
    const [view] = await Promise.all([grant(desktop, started), claimed.wait()]);
    if (method === 'code') assert.equal(view.sas, claimed.sas);
    assert.equal(view.role, 'member');
    const summary = await phone.service.sync('test');
    assert.equal(summary?.ok, true, JSON.stringify(summary));
    return phone;
}

describe('mobil senkron istemcisi', { skip: SYNC_SERVER_SKIP }, () => {
    let server;
    before(async () => {
        server = await startSyncTestServer();
    });
    after(async () => {
        await server?.stop();
    });

    test('kodla eşleşme: masaüstündeki not telefona iner; telefonda yazılan görev ve günlük masaüstünde bir sonraki turda görünür', async () => {
        const desktop = await desktopWithSpace(server);
        const phone = await pairedPhone(server, desktop);
        assert.match(JSON.parse(await phone.driver.readText(NOTE)).content, /Masaüstünde yazılan gizli metin/);

        await phone.project.tasks.create({ id: 'task_phone_1', title: 'Telefondan görev', status: 'todo' }, { diaryDate: '2026-11-17' });
        await phone.project.diary.setText('2026-11-17', 'Telefondan günlük');
        assert.equal((await phone.service.sync('test')).ok, true);
        assert.equal((await desktop.sync()).ok, true);
        assert.ok(desktop.readJson('.pisi/tasks.json').tasks.some((task) => task.title === 'Telefondan görev'));
        assert.match(desktop.read('diary/2026-11-17.node'), /Telefondan günlük/);

        const doc = desktop.readJson(NOTE);
        doc.content = doc.content.replace('gizli metin', 'gizli metin (değişti)');
        desktop.write(NOTE, doc);
        assert.equal((await desktop.sync()).ok, true);
        assert.equal((await phone.service.sync('test')).ok, true);
        assert.match(JSON.parse(await phone.driver.readText(NOTE)).content, /gizli metin \(değişti\)/);
    });

    test('QR yolu: kanıtla eşleşir; telefonun hiçbir commit isteği delete içermez', async () => {
        const desktop = await desktopWithSpace(server);
        const requests = [];
        const phone = await pairedPhone(server, desktop, 'qr');
        // Desktop deletes; the phone applies it and never sends a delete of its own (SV12).
        const original = phone.service;
        assert.ok(original.isPaired());
        desktop.remove(NOTE);
        assert.equal((await desktop.sync()).ok, true);
        const fetchSpy = globalThis.fetch;
        globalThis.fetch = (url, init) => {
            requests.push({ url: String(url), body: typeof init?.body === 'string' ? init.body : '' });
            return fetchSpy(url, init);
        };
        try {
            await phone.project.tasks.create({ id: 'task_phone_2', title: 'İkinci', status: 'todo' }, { diaryDate: '2026-11-17' });
            assert.equal((await phone.service.sync('test')).ok, true);
        } finally {
            globalThis.fetch = fetchSpy;
        }
        assert.equal(await phone.driver.exists(NOTE), false);
        const commits = requests.filter((request) => request.url.endsWith('/commit')).map((request) => JSON.parse(request.body));
        assert.ok(commits.length > 0);
        assert.equal(
            commits.flatMap((body) => body.changes).some((change) => change.op === 'delete'),
            false
        );
        for (const request of requests) assert.doesNotMatch(request.body, /Pixel 7|İkinci|task_phone_2|tasks\.json/);
    });

    test('masaüstünden iptal edilen telefon durur, gizli bilgisi silinir, dosyaları kalır', async () => {
        const desktop = await desktopWithSpace(server);
        const phone = await pairedPhone(server, desktop);
        const phoneState = await phone.service.store.load();
        await desktop.http.request('DELETE', `/v1/spaces/${phoneState.spaceId}/devices/${phoneState.deviceId}`);
        const events = [];
        phone.service.subscribe((event) => events.push(event.type));
        await phone.service.sync('test');
        assert.ok(events.includes('revoked'));
        assert.equal(phone.service.isPaired(), false);
        assert.equal(phone.secrets.values.size, 0);
        assert.equal(await phone.driver.exists(NOTE), true);
    });
});
