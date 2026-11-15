import { expect, test } from '@playwright/test';

// Saturday 14 November 2026, 09:30 in Istanbul.
const NOW = new Date('2026-11-14T09:30:00+03:00');

async function openSettings(page) {
    await page.clock.setFixedTime(NOW);
    await page.goto('/');
    await expect(page.locator('[data-screen]')).toBeVisible();
    await page.getByRole('button', { name: 'Ayarları aç' }).tap();
    await expect(page.locator('[data-screen]')).toHaveAttribute('data-screen', 'settings');
}

const count = (page, id) => page.locator(`[data-project="${id}"] .pisi-row-value`);
const shot = (page, name) => page.screenshot({ path: `e2e/screenshots/${test.info().project.name}/${name}.png`, animations: 'disabled' });

/** The project files as the storage driver sees them: the Filesystem plugin's web store (IndexedDB). */
const projectFiles = (page) =>
    page.evaluate(
        () =>
            new Promise((resolve, reject) => {
                const open = indexedDB.open('Disc');
                open.onerror = () => reject(open.error);
                open.onsuccess = () => {
                    const request = open.result.transaction('FileStorage').objectStore('FileStorage').getAll();
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () =>
                        resolve(
                            request.result
                                .filter((entry) => entry.type === 'file')
                                .map((entry) => ({ path: entry.path.replace(/^\/DATA\/projects\/default\//, ''), content: entry.content }))
                        );
                };
            })
    );

test('ilk açılışta boş proje kurulur; örnek proje yüklenir ve yeniden başlatınca veriler durur', async ({ page }) => {
    await openSettings(page);
    await expect(count(page, 'name')).toHaveText('Pisi Projem');
    await expect(count(page, 'tasks')).toHaveText('0');
    await expect(count(page, 'notes')).toHaveText('0');
    expect((await projectFiles(page)).map((file) => file.path).sort()).toEqual(['.pisi/properties.json', 'diary/.pisi-diary']);

    await page.locator('[data-developer="load-sample"]').tap();
    await expect(page.getByRole('status')).toContainText('Örnek proje yüklendi: 6 görev, 3 not eklendi.');
    await expect(count(page, 'tasks')).toHaveText('6');
    await expect(count(page, 'notes')).toHaveText('4');
    await shot(page, '08-settings-project');

    // Reloading is a cold start: everything shown now is read back from storage.
    await page.reload();
    await page.getByRole('button', { name: 'Ayarları aç' }).tap();
    await expect(count(page, 'tasks')).toHaveText('6');
    await expect(count(page, 'notes')).toHaveText('4');
    await expect(count(page, 'maps')).toHaveText('0');

    const files = await projectFiles(page);
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual([
        '.pisi/properties.json',
        '.pisi/tasks.json',
        'Işık ve ısı.node',
        'Pisi Mobil.node',
        'Toplantı Notları.node',
        'diary/.pisi-diary',
        'diary/2026-11-14.node'
    ]);
    // Atomic writes leave no temporary file behind, and tasks.json is the desktop's format.
    expect(paths.filter((path) => path.endsWith('.tmp'))).toEqual([]);
    const store = JSON.parse(files.find((file) => file.path === '.pisi/tasks.json').content);
    expect(store.version).toBe(1);
    expect(store.tasks.map((task) => task.title)).toContain('TÜBİTAK raporunun yöntem bölümünü gözden geçir');
    expect(store.tasks.every((task) => /^task_[0-9a-f-]{36}$/.test(task.id) && /^todo\.[1-5]\./.test(task.todoTag))).toBe(true);

    // Loading the sample again adds nothing.
    await page.locator('[data-developer="load-sample"]').tap();
    await expect(page.getByRole('status')).toContainText('0 görev, 0 not');
    await expect(count(page, 'tasks')).toHaveText('6');
});

test('Ayarlar proje bölümü %130 yazıda taşmaz ve dokunma hedefleri 48 px', async ({ page }) => {
    await openSettings(page);
    // The screen is drawn again when the project has been read; measure after that.
    await expect(count(page, 'tasks')).toHaveText('0');
    await page.evaluate(() => (document.documentElement.style.fontSize = '130%'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    const box = await page.locator('[data-developer="load-sample"]').boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(48);
});
