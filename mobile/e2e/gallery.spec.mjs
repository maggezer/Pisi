import { expect, test } from '@playwright/test';

// The component gallery is served by the development server (see playwright.config.mjs).
const GALLERY_URL = 'http://127.0.0.1:4174/?gallery';
const SECTIONS = ['colours', 'type', 'space', 'icons', 'buttons', 'chips', 'lists', 'tasks', 'fields', 'overlays', 'chrome'];

async function open(page) {
    await page.goto(GALLERY_URL);
    await expect(page.locator('[data-gallery="root"]')).toBeVisible();
}

const shot = (page, name, options = {}) =>
    page.screenshot({ path: `e2e/screenshots/${test.info().project.name}/${name}.png`, animations: 'disabled', ...options });

const smallTargets = (page) =>
    page.evaluate(() =>
        [...document.querySelectorAll('button, input, textarea')]
            .map((control) => ({
                name: (control.getAttribute('aria-label') || control.textContent || control.id).trim(),
                box: control.getBoundingClientRect()
            }))
            .filter(({ box }) => box.width < 48 || box.height < 48)
            .map(({ name, box }) => `${name} ${Math.round(box.width)}x${Math.round(box.height)}`)
    );

test('galeri bütün bileşenleri sistem temasında gösterir', async ({ page }) => {
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', test.info().project.name);
    for (const section of SECTIONS) await expect(page.locator(`[data-gallery="${section}"]`)).toBeVisible();
    await expect(page.locator('.pisi-tab')).toHaveText(['Pisi', 'Görevler', 'Notlar', 'Takvim', 'Haritalar']);
    await expect(page.locator('.pisi-tab svg')).toHaveCount(5);
    await shot(page, '20-gallery', { fullPage: true });
});

test('tarayıcının hesapladığı renklerle her token çifti kontrast eşiğini geçer', async ({ page }) => {
    await open(page);
    const pairs = await page.locator('.gallery-pair').evaluateAll((elements) =>
        elements.map((element) => ({
            name: element.querySelector('.gallery-pair-name').textContent,
            kind: element.dataset.kind,
            ratio: Number.parseFloat(element.querySelector('.gallery-pair-ratio').textContent)
        }))
    );
    expect(pairs.length).toBeGreaterThan(20);
    expect(pairs.filter(({ kind, ratio }) => !(ratio >= (kind === 'text' ? 4.5 : 3)))).toEqual([]);
});

test('tek yazı ailesi: başlık, gövde, düğme ve metin alanı aynı aileyi kullanır', async ({ page }) => {
    await open(page);
    const families = await page.evaluate(() => [
        ...new Set([...document.querySelectorAll('h1, h2, p, button, input, textarea, code, span')].map((element) => getComputedStyle(element).fontFamily))
    ]);
    // <code> keeps the browser's monospace; everything else shares one family.
    expect(families.filter((family) => !family.includes('monospace'))).toHaveLength(1);
});

test('onay kutusu 24 px görünür, 48 px dokunma alanına sahiptir; geri al eski durumu getirir', async ({ page }) => {
    await open(page);
    const checkbox = page.locator('[data-task="a"]');
    const box = await checkbox.locator('.pisi-checkbox-box').boundingBox();
    const touch = await checkbox.boundingBox();
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([24, 24]);
    expect(Math.min(touch.width, touch.height)).toBeGreaterThanOrEqual(48);

    await checkbox.tap();
    await expect(checkbox).toHaveAttribute('aria-checked', 'true');
    const snackbar = page.locator('.gallery-floating [role="status"]');
    await expect(snackbar).toContainText('Görev tamamlandı');
    await shot(page, '23-gallery-snackbar');

    await snackbar.getByRole('button', { name: 'Geri al' }).tap();
    await expect(checkbox).toHaveAttribute('aria-checked', 'false');
    await expect(snackbar).toHaveCount(0);
});

test('sheet ve diyalog açılır, geri tuşu ve perde ile kapanır', async ({ page }) => {
    await open(page);
    await page.locator('[data-open="sheet"]').tap();
    await expect(page.getByRole('dialog', { name: 'Hızlı ekle' })).toBeVisible();
    await shot(page, '21-gallery-sheet');
    await page.getByRole('dialog').getByRole('button', { name: 'Kapat' }).tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.locator('[data-open="choice"]').tap();
    await page.getByRole('dialog').getByRole('radio', { name: 'Koyu' }).tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.locator('[data-open="dialog"]').tap();
    await expect(page.getByRole('alertdialog', { name: 'Değişiklikler atılsın mı?' })).toBeVisible();
    await shot(page, '22-gallery-dialog');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    await page.locator('[data-open="dialog"]').tap();
    await page.locator('[data-dialog]').tap({ position: { x: 8, y: 8 } });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('görev satırı: başlık iki satıra sarılır, kırpılmaz; tarih seçici gün seçer', async ({ page }) => {
    await open(page);
    const row = page.locator('[data-task="row-1"]');
    const title = row.locator('.pisi-task-title');
    const lines = await title.evaluate((element) =>
        Math.round(element.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(element).lineHeight))
    );
    expect(lines).toBe(2);
    expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(row.locator('.pisi-task-meta-item')).toHaveText(['10:00', 'Çok yüksek', 'Rapor planı']);
    const box = await row.boundingBox();
    const list = await page.locator('[data-gallery="tasks"] .pisi-task-list').boundingBox();
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(Math.round(list.width) - 2);

    await page.locator('[data-open="date"]').tap();
    const dialog = page.getByRole('dialog', { name: 'Tarih seç' });
    await expect(dialog.locator('.pisi-date-month-title')).toHaveText('Kasım 2026');
    expect(await smallTargets(page)).toEqual([]);
    await shot(page, '25-gallery-date-picker');
    await dialog.getByRole('button', { name: 'Sonraki ay' }).tap();
    await expect(dialog.locator('.pisi-date-month-title')).toHaveText('Aralık 2026');
    await dialog.locator('[data-date="2026-12-03"]').tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('çip, segment ve alt menü seçimi değiştirir; segment temayı değiştirir', async ({ page }) => {
    await open(page);
    await page.locator('[data-filter="upcoming"]').tap();
    await expect(page.locator('.pisi-chip[aria-pressed="true"]')).toHaveText(/Yaklaşan/);
    await page.locator('[data-tab="notes"]').tap();
    await expect(page.locator('.pisi-tab[aria-current="page"]')).toHaveText('Notlar');

    const other = test.info().project.name === 'dark' ? 'light' : 'dark';
    await page
        .getByRole('radiogroup', { name: 'Tema' })
        .getByRole('radio', { name: other === 'dark' ? 'Koyu' : 'Açık' })
        .tap();
    await expect(page.locator('html')).toHaveAttribute('data-theme', other);
});

test('dokunma hedefleri en az 48 px; yazı %130 büyüyünce yatay taşma olmaz', async ({ page }) => {
    await open(page);
    const overflows = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(await smallTargets(page)).toEqual([]);
    expect(await overflows()).toBe(false);

    await page.locator('[data-open="dialog"]').tap();
    expect(await smallTargets(page)).toEqual([]);
    await page.keyboard.press('Escape');

    await page.evaluate(() => (document.documentElement.style.fontSize = '130%'));
    expect(await overflows()).toBe(false);
    expect(await smallTargets(page)).toEqual([]);
    await shot(page, '24-gallery-font-130', { fullPage: true });
});
