// Pairing with the desktop and the first sync in the phone view (docs/sync-plan.md
// S5 step 7). The server is the in-memory one of the unit tests
// (tests/helpers/fake-sync-server.mjs), reached through a Playwright route;
// the desktop is the shared engine with the desktop's own pairing code.
// Screenshots: the code form, the verification number and Settings once paired.

import { expect, test } from '@playwright/test';
import { createFakeSyncServer } from '../tests/helpers/fake-sync-server.mjs';
import { createDesktop, nodeDoc } from '../tests/helpers/sync-devices.mjs';
import { back, open, openFromMenu, projectFiles, screen, shot } from './helpers.mjs';
import { routeServer } from './sync-helpers.mjs';

const NOTE_ID = 'node_cccccccc-0000-4000-8000-000000000001';

test('kodla eşleştirme: doğrulama numarası iki tarafta aynı, masaüstündeki not telefona iner, telefondaki günlük masaüstüne gider', async ({ page }) => {
    const server = createFakeSyncServer();
    const desktop = await createDesktop(server);
    desktop.write('Masaüstü Notu.node', nodeDoc(NOTE_ID, 'Masaüstü Notu', [['b1', 'Masaüstünde yazıldı']]));
    await desktop.sync();
    await routeServer(page, server);

    await open(page);
    await openFromMenu(page, 'settings');
    await page.locator('[data-sync="pair"]').tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'sync-pair');
    // A browser has no camera scanner: only the code path is offered.
    await expect(page.locator('[data-action="scan-qr"]')).toHaveCount(0);
    await page.locator('[data-action="use-code"]').tap();

    const started = await desktop.startPairing();
    await page.locator('#pair-server').fill('sync.test');
    await page.locator('#pair-code').fill(started.view.code.toLowerCase());
    await page.locator('#pair-name').fill('Test telefonu');
    await page.locator('#pair-code').blur();
    await shot(page, '60-sync-pair-code');
    await page.locator('[data-action="connect"]').tap();

    const sas = page.locator('[data-pair="sas"]');
    await expect(sas).toHaveText(/^\d{3} \d{3}$/);
    await shot(page, '61-sync-pair-sas');
    const view = await desktop.answerPairing(started);
    expect(view).toMatchObject({ method: 'code', name: 'Test telefonu', platform: 'web', role: 'member' });
    expect(await sas.textContent()).toBe(view.sas);

    await expect(page.locator('[data-pair="done"]')).toBeVisible();
    await page.locator('[data-action="pair-done"]').tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
    await expect(page.locator('[data-sync="space"] .pisi-row-value')).toHaveText('Pisi Projem');
    await expect(page.locator('[data-sync="status"]')).toHaveAttribute('data-state', 'idle');
    await expect.poll(async () => (await projectFiles(page)).map((file) => file.path)).toContain('Masaüstü Notu.node');
    await page.locator('[data-sync="status"]').scrollIntoViewIfNeeded();
    await shot(page, '62-sync-settings-paired');

    // A diary line written on the phone reaches the desktop with "Sync now".
    await back(page);
    await page.locator('[data-diary="text"]').fill('Telefondan senkron denemesi');
    await openFromMenu(page, 'settings');
    await page.locator('[data-sync="sync-now"]').tap();
    await expect
        .poll(async () => {
            await desktop.sync();
            return desktop.paths().find((path) => path.startsWith('diary/2026-11-14')) ? desktop.read('diary/2026-11-14.node') : '';
        })
        .toContain('Telefondan senkron denemesi');
    // The phone never sends a delete (SV12), and no request carries the phone's name in the clear (SV8).
    expect(
        server
            .commits()
            .flatMap((body) => body.changes)
            .some((change) => change.op === 'delete')
    ).toBe(false);
    expect(server.requests.map((request) => request.body || '').join('\n')).not.toContain('Test telefonu');

    // Removing the device: confirmed in a dialog; the project files stay.
    await page.locator('[data-sync="unpair"]').tap();
    await expect(page.locator('[data-dialog="sync-unpair"]')).toBeVisible();
    await page.locator('[data-dialog="sync-unpair"] [data-action="confirm"]').tap();
    await expect(page.getByRole('status')).toContainText('Bağlantı kaldırıldı.');
    await expect(page.locator('[data-sync="pair"]')).toBeVisible();
    expect((await projectFiles(page)).map((file) => file.path)).toContain('Masaüstü Notu.node');
});

test('yanlış kod ve masaüstünün reddi kullanıcıya söylenir; yeniden denenebilir', async ({ page }) => {
    const server = createFakeSyncServer();
    const desktop = await createDesktop(server);
    await routeServer(page, server);
    await open(page);
    await openFromMenu(page, 'settings');
    await page.locator('[data-sync="pair"]').tap();
    await page.locator('[data-action="use-code"]').tap();
    await page.locator('#pair-server').fill('https://sync.test');
    await page.locator('#pair-code').fill('0000-0000');
    await page.locator('[data-action="connect"]').tap();
    await expect(page.locator('[data-pair="failed"]')).toHaveAttribute('data-code', 'PAIRING_NOT_FOUND');
    await expect(page.locator('[data-pair="failed"]')).toContainText('Kod bulunamadı');

    await page.locator('[data-action="retry-pairing"]').tap();
    const started = await desktop.startPairing();
    await page.locator('#pair-code').fill(started.view.code);
    await page.locator('[data-action="connect"]').tap();
    await expect(page.locator('[data-pair="sas"]')).toBeVisible();
    await desktop.answerPairing(started, { reject: true });
    await expect(page.locator('[data-pair="failed"]')).toHaveAttribute('data-code', 'PAIRING_REJECTED');
    await shot(page, '63-sync-pair-rejected');

    // Back leaves the screen; the next visit starts over.
    await back(page);
    await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
    await page.locator('[data-sync="pair"]').tap();
    await expect(page.locator('[data-action="use-code"]')).toBeVisible();
});
