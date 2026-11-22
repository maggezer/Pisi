// The phone's sync engine against the in-memory server (docs/sync-plan.md S5
// step 7): pairing on the code path, both directions, no delete from the
// phone, a restart that keeps the binding and the cursor, a replayed turn,
// a dirty file that waits, and a revoked phone.

import { describe, expect, it } from 'vitest';
import { createFakeSyncServer } from './helpers/fake-sync-server.mjs';
import { createDesktop, createPhone, nodeDoc, pairWithCode, SERVER_URL } from './helpers/sync-devices.mjs';

const NOTE = 'Toplantı.node';
const TASKS = '.pisi/tasks.json';

async function pairedPair() {
    const server = createFakeSyncServer();
    const desktop = await createDesktop(server);
    desktop.write(
        NOTE,
        nodeDoc('node_aaaaaaaa-0000-4000-8000-000000000001', 'Toplantı', [
            ['b1', 'Bir'],
            ['b2', 'İki']
        ])
    );
    await desktop.sync();
    const phone = createPhone(server);
    await phone.project.open();
    await phone.service.init();
    await pairWithCode(desktop, phone);
    await phone.service.sync('test');
    return { server, desktop, phone };
}

describe('mobil senkron motoru', () => {
    it('kodla eşleşir, iki ekran aynı doğrulama numarasını görür ve masaüstündeki not telefona iner', async () => {
        const server = createFakeSyncServer();
        const desktop = await createDesktop(server);
        desktop.write(NOTE, nodeDoc('node_aaaaaaaa-0000-4000-8000-000000000001', 'Toplantı', [['b1', 'Bir']]));
        await desktop.sync();
        const phone = createPhone(server);
        await phone.project.open();
        expect((await phone.service.init()).state).toBe('unpaired');

        const { claimed, view } = await pairWithCode(desktop, phone);
        expect(claimed.sas).toMatch(/^\d{3} \d{3}$/);
        expect(view.sas).toBe(claimed.sas);
        expect(view.name).toBe('Pixel 7');
        expect(view.role).toBe('member');

        await phone.service.sync('test');
        expect(phone.service.getStatus()).toMatchObject({ state: 'idle', spaceName: 'Pisi Projem', serverUrl: SERVER_URL });
        expect(JSON.parse(await phone.driver.readText(NOTE)).content).toContain('Bir');
        // Folders are not synced; the note arrives with its empty sidecar folder (SV6).
        expect(await phone.driver.exists('inv_Toplantı__node_aaaaaaaa-0000-4000-8000-000000000001')).toBe(true);
    });

    it('telefonda yazılan görev ve günlük masaüstüne gider; masaüstündeki not değişikliği telefona gelir', async () => {
        const { desktop, phone } = await pairedPair();
        await phone.project.tasks.create({ id: 'task_phone_1', title: 'Telefondan görev' }, { diaryDate: '2026-11-14' });
        await phone.project.diary.setText('2026-11-17', 'Bugün telefondan yazdım.');
        await phone.service.sync('test');

        await desktop.sync();
        expect(desktop.readJson(TASKS).tasks.map((task) => task.title)).toContain('Telefondan görev');
        expect(desktop.read('diary/2026-11-17.node')).toContain('Bugün telefondan yazdım.');
        expect(desktop.read('diary/.pisi-diary')).not.toBeNull();

        const doc = desktop.readJson(NOTE);
        doc.content = doc.content.replace('İki', 'İki (masaüstü)');
        desktop.write(NOTE, doc);
        await desktop.sync();
        const changed = [];
        phone.project.writer.onFileChanged((key, info) => changed.push([key, info.source]));
        await phone.service.sync('test');
        expect(JSON.parse(await phone.driver.readText(NOTE)).content).toContain('İki (masaüstü)');
        expect(changed).toContainEqual([NOTE, 'sync']);
    });

    it('telefonun gönderdiği hiçbir commit delete içermez; telefonda eksik dosya yeniden iner', async () => {
        const { server, phone } = await pairedPair();
        await phone.driver.remove(NOTE);
        // The file went missing behind the writer's back: a fresh walk sees that.
        const again = createPhone(server, { driver: phone.driver, stateDriver: phone.stateDriver, secrets: phone.secrets });
        await again.project.open();
        await again.service.init();
        await again.project.tasks.create({ id: 'task_phone_2', title: 'İkinci' }, { diaryDate: '2026-11-14' });
        await again.service.sync('test');

        const phoneCommits = server.commits().filter((body) => body.changes.length);
        expect(phoneCommits.length).toBeGreaterThan(0);
        expect(phoneCommits.flatMap((body) => body.changes).some((change) => change.op === 'delete')).toBe(false);
        expect(await again.driver.exists(NOTE)).toBe(true);
    });

    it('uygulama kapatılıp açılınca eşleşme ve imleç korunur', async () => {
        const { server, desktop, phone } = await pairedPair();
        const before = await phone.service.store.load();
        expect(before.cursor).toBeGreaterThan(0);
        phone.service.destroy();

        const restarted = createPhone(server, { driver: phone.driver, stateDriver: phone.stateDriver, secrets: phone.secrets });
        await restarted.project.open();
        expect((await restarted.service.init()).state).toBe('idle');
        expect((await restarted.service.store.load()).cursor).toBe(before.cursor);

        const requestsBefore = server.requests.length;
        await restarted.service.sync('test');
        // Nothing new on the server: one cheap head poll, no changes download.
        expect(server.requests.slice(requestsBefore).some((request) => request.path.endsWith('/changes'))).toBe(false);

        desktop.write('Yeni.node', nodeDoc('node_aaaaaaaa-0000-4000-8000-000000000009', 'Yeni', [['n1', 'Yeni not']]));
        await desktop.sync();
        await restarted.service.sync('test');
        expect(await restarted.driver.exists('Yeni.node')).toBe(true);
    });

    it('yarım kalan tur yeniden oynatılınca aynı sonucu verir', async () => {
        const { server, desktop, phone } = await pairedPair();
        desktop.write('A.node', nodeDoc('node_aaaaaaaa-0000-4000-8000-00000000000a', 'A', [['a1', 'A metni']]));
        desktop.write('B.node', nodeDoc('node_aaaaaaaa-0000-4000-8000-00000000000b', 'B', [['b1', 'B metni']]));
        await desktop.sync();

        // The turn dies after the first file was written: the state (cursor, index) is never saved.
        const cursorBefore = (await phone.service.store.load()).cursor;
        const writer = phone.project.writer;
        const original = writer.applyExternal;
        let writes = 0;
        writer.applyExternal = async (...args) => {
            if ((writes += 1) === 2) throw new Error('uygulama kapandı');
            return original.apply(writer, args);
        };
        await phone.service.sync('test');
        writer.applyExternal = original;
        expect((await phone.service.store.load()).cursor).toBe(cursorBefore);

        const restarted = createPhone(server, { driver: phone.driver, stateDriver: phone.stateDriver, secrets: phone.secrets });
        await restarted.project.open();
        await restarted.service.init();
        await restarted.service.sync('test');
        expect(JSON.parse(await restarted.driver.readText('A.node')).content).toContain('A metni');
        expect(JSON.parse(await restarted.driver.readText('B.node')).content).toContain('B metni');
        const state = await restarted.service.store.load();
        expect(state.cursor).toBeGreaterThan(cursorBefore);
        // Replaying wrote nothing new and sent nothing back.
        const pushesBefore = server.commits().length;
        await restarted.service.sync('test');
        expect(server.commits().length).toBe(pushesBefore);
    });

    it('kaydedilmemiş düzenlemesi olan açık not ertelenir ve temizlenince birleşir (SV4)', async () => {
        const { desktop, phone } = await pairedPair();
        const lease = phone.project.documents.hold(NOTE);
        lease.setDirty(true);
        const doc = desktop.readJson(NOTE);
        doc.content = doc.content.replace('Bir', 'Bir (uzak)');
        desktop.write(NOTE, doc);
        await desktop.sync();

        await phone.service.sync('test');
        expect(JSON.parse(await phone.driver.readText(NOTE)).content).not.toContain('Bir (uzak)');
        expect(phone.service.getStatus().issues).toContainEqual(expect.objectContaining({ code: 'DEFERRED_DIRTY' }));

        lease.setDirty(false);
        await phone.service.sync('test');
        expect(JSON.parse(await phone.driver.readText(NOTE)).content).toContain('Bir (uzak)');
        lease.release();
    });

    it('iptal edilen telefon durur, gizli bilgi ve durum silinir, proje dosyaları kalır', async () => {
        const { server, phone } = await pairedPair();
        const events = [];
        phone.service.subscribe((event) => events.push(event.type));
        const state = await phone.service.store.load();
        server.revoke(state.deviceId);

        await phone.project.tasks.create({ id: 'task_phone_3', title: 'İptalden sonra' }, { diaryDate: '2026-11-14' });
        await phone.service.sync('test');
        expect(events).toContain('revoked');
        expect(phone.service.getStatus()).toMatchObject({ state: 'unpaired', code: 'DEVICE_REVOKED' });
        expect(phone.service.isPaired()).toBe(false);
        expect(phone.secrets.values.size).toBe(0);
        expect(phone.stateDriver.snapshot()).toEqual({});
        expect(await phone.driver.exists(NOTE)).toBe(true);
        expect(await phone.driver.exists(TASKS)).toBe(true);
    });

    it('bağlantıyı kaldırınca sunucu cihazı iptal eder; çevrimdışıyken yerelde yine kaldırılır', async () => {
        const first = await pairedPair();
        expect(await first.phone.service.unpair()).toEqual({ remote: 'ok' });
        const device = [...first.server.spaces.values()][0].devices;
        expect([...device.values()].filter((entry) => entry.role === 'member').every((entry) => entry.revokedAt)).toBe(true);
        expect(first.phone.service.isPaired()).toBe(false);

        const second = await pairedPair();
        second.server.offline = true;
        expect(await second.phone.service.unpair()).toEqual({ remote: 'offline' });
        expect(second.phone.secrets.values.size).toBe(0);
    });

    it("sunucu, telefonun kendi commit'inin altına geri sarılırsa SERVER_ROLLBACK: tur durur, gönderilen değişiklik kaybolmaz (S7)", async () => {
        const { server, phone } = await pairedPair();
        const backup = server.snapshot();
        await phone.project.tasks.create({ id: 'task_phone_rollback', title: 'Geri sarmadan önce' }, { diaryDate: '2026-11-14' });
        expect((await phone.service.sync('test')).ok).toBe(true);
        // The cursor has not passed the phone's own commit: only the seq the server gave it can tell.
        backup();
        const before = await phone.driver.readText(TASKS);
        const summary = await phone.service.sync('test');
        expect(summary).toMatchObject({ ok: false, code: 'SERVER_ROLLBACK' });
        expect(phone.service.getStatus()).toMatchObject({ state: 'stopped', code: 'SERVER_ROLLBACK' });
        expect(await phone.driver.readText(TASKS)).toBe(before);
        expect(server.commits().filter((body) => body.changes.some((change) => change.op === 'put')).length).toBeGreaterThan(0);
    });

    it('ağ yokken tur "çevrimdışı" durumuna geçer ve yazmaz', async () => {
        const { server, phone } = await pairedPair();
        server.offline = true;
        await phone.service.sync('test');
        expect(phone.service.getStatus().state).toBe('offline');
        server.offline = false;
        await phone.service.sync('test');
        expect(phone.service.getStatus().state).toBe('idle');
    });
});
