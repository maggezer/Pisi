// The first transfer of a project to the phone (docs/sync-plan.md S6) in the
// phone view, against the in-memory server of the unit tests:
// - a phone with its own diary and task adds them to the desktop's project, or
//   sets them aside; in neither case is the phone's text lost;
// - during the first download the Pisi tab shows the desktop's task and diary
//   before the notes have come down;
// - a note with an image opened offline shows a placeholder, and the image
//   comes down once the server answers again; a file block opens its file.
// Screenshots: the question, the placeholder, Settings during and after.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { normalizePisiTask } from '../../shared/task-model.mjs';
import { createFakeSyncServer } from '../tests/helpers/fake-sync-server.mjs';
import { createDesktop, nodeDoc } from '../tests/helpers/sync-devices.mjs';
import { TODAY, back, open, openFromMenu, projectFiles, screen, shot } from './helpers.mjs';
import { SERVER, routeServer } from './sync-helpers.mjs';

const DIARY = `diary/${TODAY}.node`;
const NOTE_ID = 'node_eeeeeeee-0000-4000-8000-000000000001';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A small real PNG (an orange square), so the browser can draw it. */
function makePng(size = 24) {
    const crc = (bytes) => {
        let value = ~0;
        for (const byte of bytes) {
            value ^= byte;
            for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
        }
        return ~value >>> 0;
    };
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const out = Buffer.alloc(body.length + 8);
        out.writeUInt32BE(data.length, 0);
        body.copy(out, 4);
        out.writeUInt32BE(crc(body), body.length + 4);
        return out;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 2;
    const rows = Buffer.concat(Array.from({ length: size }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([217, 128, 31]))])));
    return new Uint8Array(
        Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
    );
}

/** A desktop project with a task for today, today's diary and `notes` notes. */
async function makeDesktop(server, { notes = 3 } = {}) {
    const desktop = await createDesktop(server);
    // A version 2 record (docs/task-plan.md §3.1) living in today's diary, made by the rule both platforms write with.
    const task = normalizePisiTask({ id: 'task_desktop_1', title: 'Masaüstü görevi', priority: 2, dueDate: TODAY, diaryDate: TODAY }, null, {
        now: new Date('2026-11-14T06:00:00.000Z'),
        makeUuid: () => '00000000-0000-4000-8000-000000000001'
    }).task;
    desktop.write('.pisi/tasks.json', { version: 2, tasks: [task] });
    desktop.write('diary/.pisi-diary', 'Pisi diary folder\n');
    desktop.write(DIARY, nodeDoc('node_dddddddd-0000-4000-8000-000000000001', TODAY, [['d1', 'Masaüstü günlüğü']]));
    for (let index = 1; index <= notes; index += 1) {
        desktop.write(
            `Not ${index}.node`,
            nodeDoc(`node_eeeeeeee-0000-4000-8000-${String(index + 100).padStart(12, '0')}`, `Not ${index}`, [[`n${index}`, `Not ${index} metni`]])
        );
    }
    await desktop.sync();
    return desktop;
}

/** A file of the project set aside today, as the Filesystem plugin's web store holds it. */
const readAside = (page, key) =>
    page.evaluate(
        (path) =>
            new Promise((resolve, reject) => {
                const request = indexedDB.open('Disc');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const get = request.result.transaction('FileStorage').objectStore('FileStorage').get(path);
                    get.onsuccess = () => resolve(get.result?.content ?? null);
                    get.onerror = () => reject(get.error);
                };
            }),
        `/DATA/projects/default-oncesi-${TODAY}/${key}`
    );

async function pairWithCode(page, desktop, { choice = null, screenshot = null } = {}) {
    await openFromMenu(page, 'settings');
    await page.locator('[data-sync="pair"]').tap();
    await expect(screen(page)).toHaveAttribute('data-screen', 'sync-pair');
    if (choice) {
        await expect(page.locator('[data-pair="initial"]')).toBeVisible();
        if (screenshot) await shot(page, screenshot);
        await page.locator(`[data-action="initial-${choice}"]`).tap();
    }
    await page.locator('[data-action="use-code"]').tap();
    const started = await desktop.startPairing();
    await page.locator('#pair-server').fill(SERVER);
    await page.locator('#pair-code').fill(started.view.code);
    await page.locator('[data-action="connect"]').tap();
    await expect(page.locator('[data-pair="sas"]')).toBeVisible();
    await desktop.answerPairing(started);
    await expect(page.locator('[data-pair="done"]')).toBeVisible();
}

/** The phone writes a diary line and a task for today before it is paired. */
async function writeOnPhone(page) {
    await page.locator('[data-diary="text"]').fill('Telefonda yazılan günlük');
    const input = page.getByRole('textbox', { name: 'Görev ekle' });
    await input.fill('Telefon görevi');
    await input.press('Enter');
    await expect(page.locator('[data-group="day"] .pisi-task-title')).toContainText(['Telefon görevi']);
}

test('"Telefondakileri projeye ekle": telefondaki günlük masaüstüne gider, masaüstününki telefona gelir', async ({ page }) => {
    const server = createFakeSyncServer();
    const desktop = await makeDesktop(server);
    await routeServer(page, server);
    await open(page);
    await writeOnPhone(page);
    await pairWithCode(page, desktop, { choice: 'merge', screenshot: '64-sync-initial-question' });
    await page.locator('[data-action="pair-done"]').tap();
    await expect(page.locator('[data-sync="status"]')).toHaveAttribute('data-state', 'idle');

    await expect
        .poll(async () => {
            await desktop.sync();
            return desktop.read(DIARY);
        })
        .toContain('Telefonda yazılan günlük');
    expect(desktop.read(DIARY)).toContain('Masaüstü günlüğü');
    expect(desktop.readJson('.pisi/tasks.json').tasks.map((task) => task.title)).toEqual(expect.arrayContaining(['Masaüstü görevi', 'Telefon görevi']));
    await back(page);
    await expect(page.locator('[data-diary="text"]')).toHaveValue(
        /Masaüstü günlüğü[\s\S]*Telefonda yazılan günlük|Telefonda yazılan günlük[\s\S]*Masaüstü günlüğü/
    );
    for (const title of ['Masaüstü görevi', 'Telefon görevi'])
        await expect(page.locator('[data-group="day"] .pisi-task-title', { hasText: title })).toHaveCount(1);
});

test('"Telefondakileri kenara koy": telefondaki proje kenara konur, Ayarlarda adıyla görünür, sunucudaki proje iner', async ({ page }) => {
    const server = createFakeSyncServer();
    const desktop = await makeDesktop(server);
    await routeServer(page, server);
    await open(page);
    await writeOnPhone(page);
    await pairWithCode(page, desktop, { choice: 'aside' });
    await expect(page.locator('[data-pair="aside"]')).toBeVisible();
    await page.locator('[data-action="pair-done"]').tap();
    await expect(page.locator('[data-sync="status"]')).toHaveAttribute('data-state', 'idle');
    await expect(page.locator('[data-project="aside"] .pisi-row-value')).toHaveText(`default-oncesi-${TODAY}`);
    await page.locator('[data-project="aside"]').scrollIntoViewIfNeeded();
    await shot(page, '65-sync-settings-aside');

    // The phone's diary is kept in the folder set aside, not lost; the project now holds the desktop's.
    const asideDiary = await readAside(page, DIARY);
    expect(asideDiary).toContain('Telefonda yazılan günlük');
    expect(await readAside(page, '.pisi/tasks.json')).toContain('Telefon görevi');
    await back(page);
    await expect(page.locator('[data-diary="text"]')).toHaveValue(/Masaüstü günlüğü/);
    await expect(page.locator('[data-diary="text"]')).not.toHaveValue(/Telefonda yazılan/);
    await expect(page.locator('[data-group="day"] .pisi-task-title')).toHaveText(['Masaüstü görevi']);
    await desktop.sync();
    expect(desktop.read(DIARY)).not.toContain('Telefonda yazılan günlük');
});

test('ilk indirmede Pisi ekranı notlar inmeden masaüstündeki görevi ve günlüğü gösterir', async ({ page }) => {
    const server = createFakeSyncServer();
    const desktop = await makeDesktop(server, { notes: 40 });
    // Blob downloads after the first three (tasks, diary marker, today's diary) wait until the test lets them go.
    let downloads = 0;
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    await routeServer(page, server, {
        hold: async (request) => {
            if (request.method() === 'GET' && /\/blobs\/b_/.test(request.url()) && (downloads += 1) > 3) await gate;
        }
    });
    await open(page);
    await pairWithCode(page, desktop);
    await page.locator('[data-action="pair-done"]').tap();
    await expect(page.locator('[data-sync="progress"]')).toHaveAttribute('data-phase', 'download');
    await page.locator('[data-sync="progress"]').scrollIntoViewIfNeeded();
    await shot(page, '66-sync-first-download');
    await back(page);
    await expect(page.locator('[data-group="day"] .pisi-task-title')).toContainText(['Masaüstü görevi']);
    await expect(page.locator('[data-diary="text"]')).toHaveValue(/Masaüstü günlüğü/);
    expect((await projectFiles(page)).filter((file) => /^Not \d+\.node$/.test(file.path)).length).toBeLessThan(40);

    release();
    await expect.poll(async () => (await projectFiles(page)).filter((file) => /^Not \d+\.node$/.test(file.path)).length).toBe(40);
});

test('çevrimdışı açılan görselli not yer tutucu gösterir, bağlantı gelince görsel iner; dosya bloğu dosyayı açar', async ({ page }) => {
    const server = createFakeSyncServer();
    const desktop = await makeDesktop(server, { notes: 0 });
    const image = makePng();
    const file = new TextEncoder().encode('%PDF-1.4 Pisi rapor');
    const sidecar = `inv_Ekli Not__${NOTE_ID}`;
    const imageRef = `image/${sha(image)}.png`;
    const fileRef = `file/${sha(file)}.pdf`;
    desktop.writeBytes(`${sidecar}/${imageRef}`, image);
    desktop.writeBytes(`${sidecar}/${fileRef}`, file);
    const note = nodeDoc(NOTE_ID, 'Ekli Not', [['p1', 'Görsel ve dosya aşağıda']]);
    note.content +=
        `<div class="pisi-editor-block pisi-image-block" data-pisi-block-id="img1" data-pisi-block-type="image" contenteditable="false"><img data-pisi-image-asset="${imageRef}" alt="Turuncu kare"></div>` +
        `<div class="pisi-editor-block pisi-file-block" data-pisi-block-id="file1" data-pisi-block-type="file" data-pisi-file-block="1" data-pisi-file-asset="${fileRef}" data-pisi-file-name="Rapor.pdf" data-pisi-file-size="${file.length}" data-pisi-file-kind="pdf" contenteditable="false"><span class="pisi-file-name">Rapor.pdf</span></div>`;
    desktop.write('Ekli Not.node', note);
    await desktop.sync();
    await routeServer(page, server);
    await open(page);
    await pairWithCode(page, desktop);
    await page.locator('[data-action="pair-done"]').tap();
    await expect(page.locator('[data-sync="status"]')).toHaveAttribute('data-state', 'idle');
    // The note came down, its attachments did not (they come down when opened).
    const paths = (await projectFiles(page)).map((entry) => entry.path);
    expect(paths).toContain('Ekli Not.node');
    expect(paths.some((path) => path.includes('/image/'))).toBe(false);
    await back(page);

    server.offline = true;
    await openFromMenu(page, 'notes');
    await page.locator('[data-note="Ekli Not.node"]').tap();
    const frame = page.locator('.pisi-note-image');
    await expect(frame).toHaveAttribute('data-attachment', 'waiting');
    await expect(frame).toContainText('Görsel bağlantı gelince iner.');
    await expect(frame.locator('[data-action="retry-attachment"]')).toBeVisible();
    await shot(page, '67-note-image-waiting');

    server.offline = false;
    await frame.locator('[data-action="retry-attachment"]').tap();
    await expect(frame).toHaveAttribute('data-attachment', 'local');
    await expect(frame.locator('img')).toHaveJSProperty('complete', true);
    expect(await frame.locator('img').evaluate((img) => img.naturalWidth)).toBe(24);
    // The downloaded image is a project file now, byte for byte what the desktop has.
    const stored = (await projectFiles(page)).find((entry) => entry.path === `${sidecar}/${imageRef}`);
    expect(sha(Buffer.from(stored.content, 'base64'))).toBe(sha(image));

    await page.locator('[data-action="open-file"]').tap();
    await expect(page.locator('.pisi-note-file')).toHaveAttribute('data-attachment', 'opened');
    expect(await page.evaluate(() => window.pisiDeveloper.openedFiles())).toEqual([{ key: `${sidecar}/${fileRef}`, name: 'Rapor.pdf' }]);
    await shot(page, '68-note-attachments');
});
