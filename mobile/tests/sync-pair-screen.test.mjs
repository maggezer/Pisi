// The pairing screen (docs/sync-plan.md S5 step 3) with a stand-in camera: the
// QR path, which the browser E2E cannot reach, and leaving the screen while
// the desktop has not answered yet.

import { describe, expect, it } from 'vitest';
import { createI18n } from '../src/i18n/index.mjs';
import { createSyncPairScreen, describePairingError } from '../src/screens/sync/pair.mjs';
import { createFakeSyncServer } from './helpers/fake-sync-server.mjs';
import { createDesktop, createPhone } from './helpers/sync-devices.mjs';

const t = createI18n('tr').t;
const until = async (check) => {
    for (let tries = 0; tries < 200; tries += 1) {
        if (check()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('beklenen durum gelmedi');
};

async function setup(scanned, { fill = null } = {}) {
    const server = createFakeSyncServer();
    const desktop = await createDesktop(server);
    const phone = createPhone(server);
    await phone.project.open();
    if (fill) await fill(phone.project);
    await phone.service.init();
    const done = [];
    const scanner = { scan: async () => scanned(desktop) };
    const screen = createSyncPairScreen({ service: phone.service, scanner, onDone: () => done.push(true) });
    document.body.replaceChildren(screen.element);
    screen.update({ t });
    // The project is looked at first; an empty one goes straight to the choice of QR or code.
    await until(() => screen.getStep() !== 'checking');
    return { desktop, phone, screen, done };
}

const tap = (screen, action) => screen.element.querySelector(`[data-action="${action}"]`).click();

describe('eşleştirme ekranı', () => {
    it('QR okutulunca masaüstünün onayı beklenir, onaylanınca "Bağlandı" görünür', async () => {
        let started;
        const { desktop, phone, screen, done } = await setup(async (desktopSide) => {
            started = await desktopSide.startPairing();
            return started.view.uri;
        });
        expect(screen.getStep()).toBe('choose');
        tap(screen, 'scan-qr');
        await until(() => screen.getStep() === 'waiting');
        expect(screen.element.querySelector('[data-pair="waiting"]').textContent).toBe(t('pair.waitingQr'));
        expect(screen.element.querySelector('[data-pair="sas"]')).toBeNull();
        await desktop.answerPairing(started);
        await until(() => screen.getStep() === 'done');
        expect(screen.element.textContent).toContain('Pisi Projem');
        expect(phone.service.isPaired()).toBe(true);
        tap(screen, 'pair-done');
        expect(done).toEqual([true]);
    });

    it('okutulan şey Pisi kodu değilse söylenir; kamera kapatılırsa hiçbir şey olmaz', async () => {
        const { screen } = await setup(async () => 'https://ornek.com');
        tap(screen, 'scan-qr');
        await until(() => screen.getStep() === 'failed');
        expect(screen.element.querySelector('[data-pair="failed"]').dataset.code).toBe('PAIRING_QR_INVALID');

        const cancelled = await setup(async () => null);
        tap(cancelled.screen, 'scan-qr');
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(cancelled.screen.getStep()).toBe('choose');
    });

    it('ekrandan çıkılınca bekleyen eşleştirme bırakılır ve ekran baştan başlar', async () => {
        const { desktop, phone, screen } = await setup(async () => '');
        tap(screen, 'use-code');
        const started = await desktop.startPairing();
        screen.element.querySelector('#pair-server').value = 'sync.test';
        screen.element.querySelector('#pair-server').dispatchEvent(new Event('input'));
        screen.element.querySelector('#pair-code').value = started.view.code;
        screen.element.querySelector('#pair-code').dispatchEvent(new Event('input'));
        tap(screen, 'connect');
        await until(() => screen.getStep() === 'confirm');
        expect(screen.element.querySelector('[data-pair="sas"]').textContent).toMatch(/^\d{3} \d{3}$/);
        screen.leave();
        await desktop.answerPairing(started);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(phone.service.isPaired()).toBe(false);
        screen.update({ t });
        await until(() => screen.getStep() === 'choose');
    });

    it('telefonda veri varsa önce "ekle / kenara koy" sorulur; seçim eşleştirmeyle birlikte uygulanır (S6)', async () => {
        let started;
        const { desktop, phone, screen } = await setup(
            async (desktopSide) => {
                started = await desktopSide.startPairing();
                return started.view.uri;
            },
            { fill: (project) => project.tasks.create({ id: 'task_phone_1', title: 'Telefon görevi' }, { diaryDate: '2026-11-14' }) }
        );
        await until(() => screen.getStep() === 'initial');
        expect(screen.element.querySelector('[data-action="initial-merge"]').textContent).toBe(t('pair.initialMerge'));
        tap(screen, 'initial-aside');
        expect(screen.getStep()).toBe('choose');
        tap(screen, 'scan-qr');
        await until(() => screen.getStep() === 'waiting');
        await desktop.answerPairing(started);
        await until(() => screen.getStep() === 'done');
        expect(screen.element.querySelector('[data-pair="aside"]').textContent).toBe(t('pair.doneAside'));
        expect(phone.service.getStatus().aside).toHaveLength(1);
        expect(await phone.projectsDriver.readText(`${phone.service.getStatus().aside[0]}/.pisi/tasks.json`)).toContain('Telefon görevi');
        expect(await phone.driver.exists('.pisi/tasks.json')).toBe(false);
    });

    it('yalnız iskelet olan projede soru sorulmaz', async () => {
        const { screen } = await setup(async () => '');
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(screen.getStep()).toBe('choose');
        expect(screen.element.querySelector('[data-pair="initial"]')).toBeNull();
    });

    it('hata kodları kullanıcı metnine çevrilir', () => {
        expect(describePairingError(t, 'PAIRING_EXPIRED')).toMatch(/süresi doldu/);
        expect(describePairingError(t, 'QUOTA_EXCEEDED')).toBe('Eşleştirme tamamlanamadı (QUOTA_EXCEEDED).');
    });
});
