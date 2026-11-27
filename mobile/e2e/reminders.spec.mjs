// Task reminders as notifications (app/reminders.mjs). The browser build has
// no Android notifications; the debug build's memory notifier stands in for
// them (`window.pisiDeveloper.notifications`): what is scheduled is read from
// it, and a tap on a notification is made through it.

import { expect, test } from '@playwright/test';
import { back, loadSampleProject, open, openFromMenu, screen, shot } from './helpers.mjs';

const scheduled = (page) =>
    page.evaluate(() =>
        window.pisiDeveloper.notifications
            .scheduled()
            .map((item) => ({ id: item.id, body: item.body, at: new Date(item.at).toISOString(), taskId: item.extra.taskId }))
    );
const settingValue = (page, selector) => page.locator(`${selector} .pisi-row-value`);

test('hatırlatma: görevde kurulan hatırlatma bildirim olarak planlanır, Ayarlar’da görünür, dokununca görev açılır', async ({ page }) => {
    await open(page);
    await loadSampleProject(page);
    await openFromMenu(page, 'tasks');
    await page.getByRole('status').waitFor({ state: 'detached' });

    // A reminder at 16:30 today (the test's clock is 14 November, 09:30).
    await page.locator('.pisi-task-body', { hasText: 'Market alışverişi' }).tap();
    const detail = page.getByRole('dialog', { name: 'Görev' });
    await expect(detail.locator('[data-task-note="reminder"]')).toContainText('bu telefonda ve masaüstünde bildirim çıkar');
    await detail.locator('[data-task-input="reminderAt"]').fill('2026-11-14T16:30');
    await expect
        .poll(async () => (await scheduled(page)).find((item) => item.body === 'Market alışverişi')?.at)
        .toBe(new Date('2026-11-14T16:30:00+03:00').toISOString());
    await back(page);

    // Settings shows the reminders and what Android allows.
    await back(page);
    await openFromMenu(page, 'settings');
    await expect(page.getByRole('heading', { name: 'Hatırlatmalar' })).toBeVisible();
    await expect(settingValue(page, '[data-setting="reminders-enabled"]')).toHaveText('Açık');
    await expect(settingValue(page, '[data-setting="reminders-time"]')).toHaveText('09:00');
    await expect(settingValue(page, '[data-reminders="permission"]')).toHaveText('Verildi');
    const count = (await scheduled(page)).length;
    await expect(settingValue(page, '[data-reminders="scheduled"]')).toHaveText(String(count));
    await page.locator('[data-reminders="scheduled"]').scrollIntoViewIfNeeded();
    await shot(page, '95-settings-reminders');

    // Turned off, nothing is scheduled; turned on again, the reminders come back.
    await page.locator('[data-setting="reminders-enabled"]').tap();
    await page.getByRole('radio', { name: 'Kapalı' }).tap();
    await expect.poll(async () => (await scheduled(page)).length).toBe(0);
    await page.locator('[data-setting="reminders-enabled"]').tap();
    await page.getByRole('radio', { name: 'Açık' }).tap();
    await expect.poll(async () => (await scheduled(page)).length).toBe(count);

    // A tap on the notification opens the task, wherever the app is.
    const reminder = (await scheduled(page)).find((item) => item.body === 'Market alışverişi');
    await page.evaluate((id) => window.pisiDeveloper.notifications.tap(id), reminder.id);
    await expect(page.getByRole('dialog', { name: 'Görev' }).getByRole('textbox', { name: 'Başlık' })).toHaveValue('Market alışverişi');
    await expect(screen(page)).toHaveAttribute('data-screen', 'settings');
});
