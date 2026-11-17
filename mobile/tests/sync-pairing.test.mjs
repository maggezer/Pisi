// Pairing on the phone (docs/sync-protocol.md §6.6, docs/sync-plan.md S5 step 3):
// the QR path with its proof, a wrong code, the desktop saying no, a pairing
// that runs out of time and one the user gives up on.

import { describe, expect, it } from 'vitest';
import { createFakeSyncServer } from './helpers/fake-sync-server.mjs';
import { createDesktop, createPhone } from './helpers/sync-devices.mjs';
import { getPairingServerUrl } from '../src/sync/pairing.mjs';

async function setup(options = {}) {
    const server = createFakeSyncServer(options);
    const desktop = await createDesktop(server);
    const phone = createPhone(server);
    await phone.project.open();
    await phone.service.init();
    return { server, desktop, phone };
}

describe('telefonda eşleştirme', () => {
    it('QR yolu: kanıt masaüstünde doğrulanır, doğrulama numarası yoktur, telefon bağlanır', async () => {
        const { desktop, phone } = await setup();
        const started = await desktop.startPairing();
        const claimed = await phone.service.startPairing({ method: 'qr', uri: started.view.uri, deviceName: 'Pixel 7' });
        expect(claimed.sas).toBeNull();
        const [view] = await Promise.all([desktop.answerPairing(started), claimed.wait()]);
        expect(view).toMatchObject({ method: 'qr', valid: true, name: 'Pixel 7', platform: 'android', sas: null });
        expect(phone.service.isPaired()).toBe(true);
        expect((await phone.service.store.load()).role).toBe('member');
    });

    it('QR yolu: sır değiştirilmişse masaüstü talebi geçersiz sayar', async () => {
        const { desktop, phone } = await setup();
        const started = await desktop.startPairing();
        const tampered = started.view.uri.replace(/x=([^&]+)/, (_, value) => `x=${value.startsWith('A') ? 'B' : 'A'}${value.slice(1)}`);
        await phone.service.startPairing({ method: 'qr', uri: tampered, deviceName: 'Pixel 7' });
        const view = await desktop.answerPairing(started, { reject: true });
        expect(view.valid).toBe(false);
    });

    it('bozuk QR ve geçersiz adres eşleştirmeyi başlatmaz', async () => {
        const { phone } = await setup();
        await expect(phone.service.startPairing({ method: 'qr', uri: 'https://ornek.com', deviceName: 'P' })).rejects.toMatchObject({
            code: 'PAIRING_QR_INVALID'
        });
        await expect(phone.service.startPairing({ method: 'code', serverUrl: '', code: 'AAAA-BBBB', deviceName: 'P' })).rejects.toMatchObject({
            code: 'BAD_SERVER_URL'
        });
        expect(getPairingServerUrl({ method: 'code', serverUrl: 'sync.ornek.com/pisi/' })).toBe('https://sync.ornek.com/pisi');
        expect(getPairingServerUrl({ method: 'code', serverUrl: 'http://sync.ornek.com' })).toBeNull();
    });

    it('yanlış kod PAIRING_NOT_FOUND ile biter', async () => {
        const { phone } = await setup();
        await expect(phone.service.startPairing({ method: 'code', serverUrl: 'https://sync.test', code: '0000-0000', deviceName: 'P' })).rejects.toMatchObject({
            code: 'PAIRING_NOT_FOUND'
        });
        expect(phone.service.isPaired()).toBe(false);
    });

    it('masaüstü "Farklı" derse telefon PAIRING_REJECTED alır ve bağlanmaz', async () => {
        const { desktop, phone } = await setup();
        const started = await desktop.startPairing();
        const claimed = await phone.service.startPairing({ method: 'code', serverUrl: 'https://sync.test', code: started.view.code, deviceName: 'P' });
        const waiting = claimed.wait();
        await desktop.answerPairing(started, { reject: true });
        await expect(waiting).rejects.toMatchObject({ code: 'PAIRING_REJECTED' });
        expect(phone.service.isPaired()).toBe(false);
        expect(phone.secrets.values.size).toBe(0);
    });

    it('süresi dolan eşleştirme PAIRING_EXPIRED ile biter', async () => {
        let clock = Date.parse('2026-11-17T10:00:00.000Z');
        const { desktop, phone } = await setup({ now: () => clock });
        const started = await desktop.startPairing();
        const claimed = await phone.service.startPairing({ method: 'code', serverUrl: 'https://sync.test', code: started.view.code, deviceName: 'P' });
        clock += 11 * 60 * 1000;
        await expect(claimed.wait()).rejects.toMatchObject({ code: 'PAIRING_EXPIRED' });
    });

    it('vazgeçilen eşleştirme beklemeyi bırakır', async () => {
        const { desktop, phone } = await setup();
        const started = await desktop.startPairing();
        const claimed = await phone.service.startPairing({ method: 'code', serverUrl: 'https://sync.test', code: started.view.code, deviceName: 'P' });
        const waiting = claimed.wait();
        phone.service.cancelPairing();
        await expect(waiting).rejects.toMatchObject({ code: 'PAIRING_CANCELLED' });
        expect(phone.service.isPaired()).toBe(false);
    });

    it('sunucuya giden hiçbir istekte cihaz adı, proje adı ya da içerik açık değildir (SV8)', async () => {
        const { server, desktop, phone } = await setup();
        desktop.write('Gizli Başlık.node', {
            pisi: { version: 1, type: 'node', id: 'node_aaaaaaaa-0000-4000-8000-0000000000aa', title: 'Gizli Başlık', sidecar: 'inv_x__y', parentMap: 'none' },
            content: 'çok gizli metin'
        });
        await desktop.sync();
        const started = await desktop.startPairing();
        const claimed = await phone.service.startPairing({
            method: 'code',
            serverUrl: 'https://sync.test',
            code: started.view.code,
            deviceName: 'Benim Telefonum'
        });
        await Promise.all([desktop.answerPairing(started), claimed.wait()]);
        await phone.project.diary.setText('2026-11-17', 'telefondaki gizli günlük');
        await phone.service.sync('test');
        const bodies = server.requests.map((request) => request.body || '').join('\n');
        for (const secret of ['Benim Telefonum', 'Pisi Projem', 'Gizli Başlık', 'çok gizli metin', 'telefondaki gizli günlük', 'diary/2026-11-17.node']) {
            expect(bodies).not.toContain(secret);
        }
    });
});
