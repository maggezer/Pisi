// Recovery of the phone's sync (shared/sync-recovery.mjs) against the in-memory
// server: "Sunucuyla yeniden eşleş" after the server went back to a backup
// (docs/sync-protocol.md §7.4), remote changes that failed verification (SV9)
// and a space the last desktop deleted when it left.

import { describe, expect, it } from 'vitest';
import { createFakeSyncServer } from './helpers/fake-sync-server.mjs';
import { createDesktop, createPhone, nodeDoc, pairWithCode } from './helpers/sync-devices.mjs';

const NOTE = 'Toplantı.node';
const TASKS = '.pisi/tasks.json';
const NOTE_ID = 'node_aaaaaaaa-0000-4000-8000-000000000001';

async function pairedPair({ fetchImpl } = {}) {
    const server = createFakeSyncServer();
    const desktop = await createDesktop(server);
    desktop.write(
        NOTE,
        nodeDoc(NOTE_ID, 'Toplantı', [
            ['b1', 'Bir'],
            ['b2', 'İki']
        ])
    );
    await desktop.sync();
    const phone = createPhone(server, fetchImpl ? { fetchImpl: fetchImpl(server) } : {});
    await phone.project.open();
    await phone.service.init();
    await pairWithCode(desktop, phone);
    await phone.service.sync('test');
    return { server, desktop, phone };
}

const editBlock = (desktop, path, from, to) => {
    const doc = desktop.readJson(path);
    doc.content = doc.content.replace(from, to);
    desktop.write(path, doc);
};
const hasConflictCopy = (paths) => paths.some((path) => /çakışma/i.test(path));

describe('senkronun kurtarılması', () => {
    it('sunucu yedeğe dönünce iki cihaz "Sunucuyla yeniden eşleş" ile devam eder; yedekten sonraki hiçbir değişiklik kaybolmaz', async () => {
        const { server, desktop, phone } = await pairedPair();
        const backup = server.snapshot();

        // After the backup: the desktop edits the note and adds one, the phone writes a task. Both see each other's.
        editBlock(desktop, NOTE, 'Bir', 'Bir (yedekten sonra)');
        desktop.write('Yeni.node', nodeDoc('node_bbbbbbbb-0000-4000-8000-000000000002', 'Yeni', [['n1', 'Yedekten sonra açılan not']]));
        expect((await desktop.sync()).ok).toBe(true);
        await phone.project.tasks.upsert({ id: 'task_after_backup', title: 'Yedekten sonra telefondan', status: 'todo' });
        expect((await phone.service.sync('test')).ok).toBe(true);
        expect((await desktop.sync()).ok).toBe(true);
        // While the server is gone the phone also writes something only it has.
        await phone.project.diary.setText('2026-11-18', 'Sunucu dönerken yazdım.');

        backup();
        expect(await desktop.sync()).toMatchObject({ ok: false, code: 'SERVER_ROLLBACK' });
        expect(await phone.service.sync('test')).toMatchObject({ ok: false, code: 'SERVER_ROLLBACK' });
        expect(phone.service.getStatus()).toMatchObject({ state: 'stopped', code: 'SERVER_ROLLBACK' });

        expect(await desktop.rejoin()).toEqual({ ok: true, code: null });
        expect((await desktop.sync()).ok).toBe(true);
        expect((await phone.service.rejoin()).ok).toBe(true);
        expect(phone.service.getStatus().state).toBe('idle');
        expect((await desktop.sync()).ok).toBe(true);
        expect((await phone.service.sync('test')).ok).toBe(true);

        // The desktop's own newer version won against the backup: no conflict copy, nothing lost.
        expect(desktop.read(NOTE)).toContain('Bir (yedekten sonra)');
        expect(desktop.read('Yeni.node')).toContain('Yedekten sonra açılan not');
        expect(desktop.readJson(TASKS).tasks.map((task) => task.title)).toContain('Yedekten sonra telefondan');
        expect(desktop.read('diary/2026-11-18.node')).toContain('Sunucu dönerken yazdım.');
        expect(hasConflictCopy(desktop.paths())).toBe(false);

        expect(await phone.driver.readText(NOTE)).toContain('Bir (yedekten sonra)');
        expect(await phone.driver.readText('Yeni.node')).toContain('Yedekten sonra açılan not');
        expect(JSON.parse(await phone.driver.readText(TASKS)).tasks.map((task) => task.title)).toContain('Yedekten sonra telefondan');
        // The phone never sends a delete, also not while it rejoins (SV12).
        expect(server.commits().some((body) => body.changes.some((change) => change.op === 'delete'))).toBe(false);
    });

    it('masaüstü yeniden eşleşince aynı bloğu değiştiren telefon iki metni de tutar (biri çakışma kopyasında)', async () => {
        const { server, desktop, phone } = await pairedPair();
        const backup = server.snapshot();
        // After the backup the desktop changes a block and sends it; the phone, offline, changes the same block.
        editBlock(desktop, NOTE, 'İki', 'İki (masaüstü)');
        expect((await desktop.sync()).ok).toBe(true);
        const phoneDoc = JSON.parse(await phone.driver.readText(NOTE));
        phoneDoc.content = phoneDoc.content.replace('İki', 'İki (telefon)');
        // A local edit of the phone (the editor writes through the same ProjectWriter).
        await phone.project.writer.applyExternal(NOTE, JSON.stringify(phoneDoc, null, 2));

        backup();
        expect(await desktop.sync()).toMatchObject({ ok: false, code: 'SERVER_ROLLBACK' });
        await desktop.rejoin();
        expect((await desktop.sync()).ok).toBe(true);
        // The phone had not pulled past the backup: the desktop's version is a normal change after its base.
        expect((await phone.service.sync('test')).ok).toBe(true);
        expect((await desktop.sync()).ok).toBe(true);

        const copies = desktop.paths().filter((path) => /çakışma/i.test(path));
        expect(copies).toHaveLength(1);
        const all = [desktop.read(NOTE), ...copies.map((path) => desktop.read(path))].join('\n');
        expect(all).toContain('İki (masaüstü)');
        expect(all).toContain('İki (telefon)');
    });

    it('imleci geri sarmayı göstermeyen telefon, başlıkların günlük denetiminde SERVER_ROLLBACK ile durur ve kaybolan görevini yeniden gönderir', async () => {
        const { server, desktop, phone } = await pairedPair();
        const backup = server.snapshot();
        // After the backup only the phone writes; the desktop does not pull it before the server goes back.
        await phone.project.tasks.upsert({ id: 'task_lost', title: 'Geri sarmada kaybolan görev', status: 'todo' });
        expect((await phone.service.sync('test')).ok).toBe(true);
        expect((await phone.service.sync('test')).ok).toBe(true);
        backup();
        // The desktop's cursor is at the backup: it sees nothing and sends three new notes, which lift the head over the phone's cursor.
        for (const name of ['Bir', 'İki', 'Üç'])
            desktop.write(`${name}.node`, nodeDoc(`node_dddddddd-0000-4000-8000-00000000000${name.length}`, name, [['x', name]]));
        expect((await desktop.sync()).ok).toBe(true);
        expect(server.spaces.get(desktop.spaceId).head).toBeGreaterThan((await phone.service.store.load()).cursor);

        // The cursor cannot show it: an ordinary turn goes on (the documented limit, pisi-error.md §4c).
        expect((await phone.service.sync('test')).ok).toBe(true);
        // The daily full compare finds the task file's head below what the phone synced.
        const state = await phone.service.store.load();
        state.fullCheckAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
        await phone.service.store.save(state);
        expect(await phone.service.sync('test')).toMatchObject({ ok: false, code: 'SERVER_ROLLBACK' });

        expect((await phone.service.rejoin()).ok).toBe(true);
        expect((await desktop.sync()).ok).toBe(true);
        expect(desktop.readJson(TASKS).tasks.map((task) => task.title)).toContain('Geri sarmada kaybolan görev');
        for (const name of ['Bir', 'İki', 'Üç']) expect(await phone.driver.readText(`${name}.node`)).toContain(name);
    });

    it('doğrulanamayan uzak değişiklik yazılmaz, Ayarlar listesinde görünür ve "Şimdi eşitle" ile yeniden denenince iner', async () => {
        let corrupt = false;
        const fetchImpl =
            (server) =>
            async (url, init = {}) => {
                const response = await server.fetch(url, init);
                if (!corrupt || (init.method || 'GET') !== 'GET' || !/\/blobs\/b_/.test(String(url)) || response.status !== 200) return response;
                const bytes = new Uint8Array(await response.arrayBuffer());
                bytes[bytes.length - 1] ^= 1;
                return new globalThis.Response(bytes, { status: 200, headers: response.headers });
            };
        const { desktop, phone } = await pairedPair({ fetchImpl });
        desktop.write('Bozuk.node', nodeDoc('node_cccccccc-0000-4000-8000-000000000003', 'Bozuk', [['c1', 'Bozulan içerik']]));
        await desktop.sync();

        corrupt = true;
        await phone.service.sync('test');
        expect(await phone.driver.exists('Bozuk.node')).toBe(false);
        const [entry] = phone.service.getStatus().unapplied;
        expect(entry).toMatchObject({ path: 'Bozuk.node', code: 'DECRYPT_FAILED' });

        // A turn of another trigger does not look again (the cursor moved on); the entry stays listed.
        corrupt = false;
        await phone.service.sync('write');
        expect(await phone.driver.exists('Bozuk.node')).toBe(false);
        expect(phone.service.getStatus().unapplied).toHaveLength(1);

        // "Şimdi eşitle" compares every head again: the repaired content comes down and the entry goes.
        await phone.service.sync('manual');
        expect(await phone.driver.readText('Bozuk.node')).toContain('Bozulan içerik');
        expect(phone.service.getStatus().unapplied).toEqual([]);
    });

    it('son masaüstü alanı silince telefon TOKEN_INVALID alır, senkronu bırakır ve dosyaları kalır', async () => {
        const { desktop, phone } = await pairedPair();
        // The last admin cannot just leave: the space would stay with the phone on it.
        await expect(desktop.http.request('DELETE', `/v1/spaces/${desktop.spaceId}/devices/me`)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
        await desktop.http.request('DELETE', `/v1/spaces/${desktop.spaceId}`, { json: { confirm: desktop.spaceId } });

        const events = [];
        phone.service.subscribe((event) => events.push(event));
        await phone.service.sync('test');
        expect(phone.service.getStatus()).toMatchObject({ state: 'unpaired', code: 'TOKEN_INVALID' });
        expect(events).toContainEqual({ type: 'revoked', code: 'TOKEN_INVALID' });
        expect(phone.service.isPaired()).toBe(false);
        expect(await phone.driver.readText(NOTE)).toContain('Bir');
        expect(phone.secrets.values.size).toBe(0);
    });
});
