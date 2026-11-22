// The first transfer of a project (docs/sync-plan.md S6) against the in-memory
// server: the desktop's first upload streams, can be cancelled and goes on after
// an interruption; the phone's first download takes every head, writes the
// authorities and today's diary first, goes on after an interruption and ends
// byte for byte equal to the desktop (attachments aside); a phone with a project
// adds it or sets it aside; attachments come down when they are opened.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getPisiSyncLocalDate } from '../../shared/sync-initial.mjs';
import { createFakeSyncServer } from './helpers/fake-sync-server.mjs';
import { createDesktop, createPhone, nodeDoc, pairWithCode } from './helpers/sync-devices.mjs';

const TASKS = '.pisi/tasks.json';
const TODAY = getPisiSyncLocalDate(new Date());
const DIARY = `diary/${TODAY}.node`;
const NOTE_ID = (index) => `node_aaaaaaaa-0000-4000-8000-${String(index).padStart(12, '0')}`;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function imageBytes(seed, size = 3000) {
    const bytes = new Uint8Array(size);
    for (let at = 0; at < size; at += 1) bytes[at] = (seed * 31 + at * 7) & 0xff;
    return bytes;
}

/** A desktop project: `notes` notes, tasks, today's diary, the diary marker and one note with an image. */
function fillDesktop(desktop, { notes = 30 } = {}) {
    for (let index = 1; index <= notes; index += 1) {
        desktop.write(`Not ${index}.node`, nodeDoc(NOTE_ID(index), `Not ${index}`, [[`b${index}`, `Masaüstü notu ${index}`]]));
    }
    desktop.write(TASKS, { version: 1, tasks: [{ id: 'task_desktop_1', title: 'Masaüstü görevi', status: 'todo', dueDate: TODAY }] });
    desktop.write('diary/.pisi-diary', 'Pisi diary folder\n');
    desktop.write(DIARY, nodeDoc('node_dddddddd-0000-4000-8000-000000000001', TODAY, [['d1', 'Masaüstü günlüğü']]));
    const image = imageBytes(1);
    const imagePath = `inv_Not 1__${NOTE_ID(1)}/image/${sha(image)}.png`;
    desktop.writeBytes(imagePath, image);
    return { imagePath, image };
}

/** Every file of the phone's project as text (attachments as base64), temporary files left out. */
async function phoneFiles(driver, folder = '', out = {}) {
    for (const entry of await driver.list(folder)) {
        const key = folder ? `${folder}/${entry.name}` : entry.name;
        if (entry.type === 'directory') await phoneFiles(driver, key, out);
        else out[key] = /\/(image|file|paint)\//.test(key) ? await driver.readBase64(key) : await driver.readText(key);
    }
    return out;
}

const desktopTextFiles = (desktop) =>
    Object.fromEntries(
        desktop
            .paths()
            .filter((path) => !/\/(image|file|paint)\//.test(path))
            .map((path) => [path, desktop.read(path)])
    );

/** A phone paired with `desktop`, its first turn run. */
async function pairPhone(server, desktop, options = {}) {
    const phone = createPhone(server, options);
    await phone.project.open();
    await phone.service.init();
    await pairWithCode(desktop, phone, { initial: options.initial ?? 'replace' });
    await phone.service.sync('test');
    return phone;
}

/** A fetch that stops answering once `kill()` was called: the app was killed mid-transfer. */
function killableFetch(server) {
    let killed = false;
    let calls = 0;
    let downloadsLeft = Infinity;
    const control = {
        calls: () => calls,
        kill: () => (killed = true),
        revive: () => {
            killed = false;
            downloadsLeft = Infinity;
        },
        killAfterDownloads: (count) => (downloadsLeft = count),
        fetch: (url, init) => {
            calls += 1;
            if (!killed && /\/blobs\/b_/.test(String(url)) && (init?.method || 'GET') === 'GET' && (downloadsLeft -= 1) < 0) killed = true;
            if (killed) return Promise.reject(new TypeError('Failed to fetch'));
            return server.fetch(url, init);
        }
    };
    return control;
}

describe('masaüstünün ilk yüklemesi', () => {
    it('dosyaları tek tek yükler, ilerlemeyi bildirir; kesilince kaldığı yerden sürer ve sonuç kesilmeyenle aynıdır', async () => {
        const server = createFakeSyncServer();
        const network = killableFetch(server);
        const desktop = await createDesktop(server, { fetchImpl: network.fetch });
        for (let index = 1; index <= 450; index += 1)
            desktop.write(`Not ${index}.node`, nodeDoc(NOTE_ID(index), `Not ${index}`, [[`b${index}`, `Metin ${index}`]]));

        // Killed after 250 files went up: the first commit (200) is in, the second is half uploaded.
        const progress = [];
        let completes = 0;
        const result = await desktop
            .sync({
                onProgress: (value) => {
                    progress.push(value);
                    if (value.phase === 'upload' && (completes = value.files.done) === 250) network.kill();
                }
            })
            .catch((error) => ({ ok: false, code: error.code }));
        expect(result).toMatchObject({ ok: false, code: 'OFFLINE' });
        expect(completes).toBe(250);
        expect(progress.at(0)).toMatchObject({ phase: 'upload', files: { done: 0, total: 450 } });
        expect(progress.at(-1).bytes.done).toBeGreaterThan(0);
        const space = [...server.spaces.values()][0];
        expect(space.heads.size).toBe(200);

        network.revive();
        desktop.restart();
        const uploadsBefore = server.requests.filter((request) => request.path.endsWith('/uploads')).length;
        expect((await desktop.sync()).ok).toBe(true);
        // The 50 blobs uploaded before the kill are skipped: only the 200 files after them go up.
        expect(server.requests.filter((request) => request.path.endsWith('/uploads')).length - uploadsBefore).toBe(200);
        expect(space.heads.size).toBe(450);
        // Every file is in the log once: nothing was committed twice.
        expect(space.changes.length).toBe(450);

        // A phone downloads exactly what the desktop holds.
        const phone = await pairPhone(server, desktop);
        expect(await phoneFiles(phone.driver)).toEqual(desktopTextFiles(desktop));
    }, 60_000);

    it('durdurulan tur CANCELLED ile biter; sonraki tur kalanları gönderir', async () => {
        const server = createFakeSyncServer();
        const desktop = await createDesktop(server);
        for (let index = 1; index <= 40; index += 1)
            desktop.write(`Not ${index}.node`, nodeDoc(NOTE_ID(index), `Not ${index}`, [[`b${index}`, `Metin ${index}`]]));
        const result = await desktop.sync({ onProgress: (value) => value.files.done === 10 && desktop.cancel() });
        expect(result).toMatchObject({ ok: false, code: 'CANCELLED' });
        const space = [...server.spaces.values()][0];
        expect(space.heads.size).toBe(0);
        expect((await desktop.sync()).ok).toBe(true);
        expect(space.heads.size).toBe(40);
    });
});

describe('telefonun ilk indirmesi', () => {
    it('bütün başlıkları alır; otorite dosyaları ve bugünün günlüğü önce iner, ekler inmez; sonuç masaüstüyle bayt bayt aynıdır', async () => {
        const server = createFakeSyncServer();
        const desktop = await createDesktop(server);
        const { imagePath } = fillDesktop(desktop, { notes: 120 });
        await desktop.sync();

        const phone = createPhone(server);
        await phone.project.open();
        await phone.service.init();
        const order = [];
        phone.project.writer.onFileChanged((key, info) => info.source === 'sync' && order.push(key));
        const progress = [];
        phone.service.subscribe((event) => event.type === 'status' && phone.service.getStatus().progress && progress.push(phone.service.getStatus().progress));
        const requestsBefore = server.requests.length;
        await pairWithCode(desktop, phone, { initial: 'replace' });
        await phone.service.sync('test');

        const paths = server.requests.slice(requestsBefore).map((request) => request.path);
        expect(paths.some((path) => path.endsWith('/heads'))).toBe(true);
        const firstNote = order.findIndex((key) => key.startsWith('Not '));
        for (const key of [TASKS, DIARY, 'diary/.pisi-diary']) expect(order.indexOf(key)).toBeLessThan(firstNote);
        expect(progress.at(-1)).toMatchObject({ phase: 'download', files: { done: 123, total: 123 } });

        expect(await phoneFiles(phone.driver)).toEqual(desktopTextFiles(desktop));
        expect(await phone.driver.exists(imagePath)).toBe(false);
        expect(await phone.service.hasRemoteAttachment(imagePath)).toBe(true);
        expect(phone.service.getStatus().progress).toBeNull();
    });

    it('%50de kesilen ilk indirme yeniden başlayınca tamamlanır ve kesilmeyen indirmeyle bayt bayt aynıdır', async () => {
        const server = createFakeSyncServer();
        const desktop = await createDesktop(server);
        fillDesktop(desktop, { notes: 200 });
        await desktop.sync();

        const network = killableFetch(server);
        const phone = createPhone(server, { fetchImpl: network.fetch });
        await phone.project.open();
        await phone.service.init();
        await pairWithCode(desktop, phone, { initial: 'replace' });
        // Killed once half of the 203 files have come down.
        const half = 101;
        network.killAfterDownloads(half);
        await phone.service.sync('test');
        expect(Object.keys(await phoneFiles(phone.driver)).length).toBeLessThan(desktop.paths().length - 1);
        phone.service.destroy();

        // The app starts again with the same storage.
        network.revive();
        const downloadsBefore = server.requests.filter((request) => /\/blobs\/b_/.test(request.path) && request.method === 'GET').length;
        const restarted = createPhone(server, {
            driver: phone.driver,
            stateDriver: phone.stateDriver,
            secrets: phone.secrets,
            projectsDriver: phone.projectsDriver
        });
        await restarted.project.open();
        await restarted.service.init();
        await restarted.service.sync('test');
        const downloads = server.requests.filter((request) => /\/blobs\/b_/.test(request.path) && request.method === 'GET').length - downloadsBefore;
        // What was written before the kill is not downloaded again.
        expect(downloads).toBeLessThan(203 - half + 50);

        const whole = await pairPhone(server, desktop);
        expect(await phoneFiles(restarted.driver)).toEqual(await phoneFiles(whole.driver));
        expect(await phoneFiles(restarted.driver)).toEqual(desktopTextFiles(desktop));
    }, 60_000);
});

describe('telefonda veri varken ilk eşleşme', () => {
    async function phoneWithData(server) {
        const phone = createPhone(server);
        await phone.project.open();
        await phone.service.init();
        await phone.project.tasks.create({ id: 'task_phone_1', title: 'Telefon görevi' }, { diaryDate: '2026-11-14' });
        await phone.project.diary.setText(TODAY, 'Telefonda yazdım.');
        return phone;
    }

    it('yalnız iskelet olan proje soru sormaz ve sunucudaki proje bayt bayt iner', async () => {
        const server = createFakeSyncServer();
        const desktop = await createDesktop(server);
        fillDesktop(desktop, { notes: 3 });
        desktop.write('.pisi/properties.json', {
            version: 1,
            definitions: [{ id: 'prop_1', name: 'Durum', type: 'text' }],
            conflicts: [],
            updatedAt: '2026-11-01T00:00:00.000Z'
        });
        await desktop.sync();
        const phone = createPhone(server);
        await phone.project.open();
        expect(await phone.service.inspectProject()).toEqual({ skeleton: true });
        await phone.service.init();
        await pairWithCode(desktop, phone, { initial: 'replace' });
        await phone.service.sync('test');
        expect(await phoneFiles(phone.driver)).toEqual(desktopTextFiles(desktop));
    });

    it('"Telefondakileri projeye ekle": görevler kimliğe göre eklenir, aynı günün günlüğü birleşir', async () => {
        const server = createFakeSyncServer();
        const desktop = await createDesktop(server);
        fillDesktop(desktop, { notes: 3 });
        await desktop.sync();
        const phone = await phoneWithData(server);
        expect(await phone.service.inspectProject()).toEqual({ skeleton: false });
        await pairWithCode(desktop, phone, { initial: 'merge' });
        await phone.service.sync('test');
        await desktop.sync();

        const titles = desktop.readJson(TASKS).tasks.map((task) => task.title);
        expect(titles).toEqual(expect.arrayContaining(['Masaüstü görevi', 'Telefon görevi']));
        expect(desktop.read(DIARY)).toContain('Masaüstü günlüğü');
        expect(desktop.read(DIARY)).toContain('Telefonda yazdım.');
        expect(JSON.parse(await phone.driver.readText(TASKS)).tasks.map((task) => task.title)).toEqual(expect.arrayContaining(titles));
    });

    it('"Telefondakileri kenara koy": telefondaki proje silinmeden kenara taşınır, sunucudaki proje iner', async () => {
        const server = createFakeSyncServer();
        const desktop = await createDesktop(server);
        fillDesktop(desktop, { notes: 3 });
        await desktop.sync();
        const phone = await phoneWithData(server);
        const before = await phoneFiles(phone.driver);
        const events = [];
        phone.service.subscribe((event) => events.push(event.type));
        await pairWithCode(desktop, phone, { initial: 'aside' });
        await phone.service.sync('test');

        const [aside] = phone.service.getStatus().aside;
        expect(aside).toBe(`default-oncesi-${TODAY}`);
        expect(events).toContain('set-aside');
        // Every file of the phone's project is in the folder set aside, unchanged.
        for (const [key, text] of Object.entries(before)) expect(await phone.projectsDriver.readText(`${aside}/${key}`)).toBe(text);
        // The project is now the server's: the phone's task and diary text are not in it, nor sent to the desktop.
        expect(await phoneFiles(phone.driver)).toEqual(desktopTextFiles(desktop));
        await desktop.sync();
        expect(desktop.readJson(TASKS).tasks.map((task) => task.title)).toEqual(['Masaüstü görevi']);
        expect(server.commits().flatMap((body) => body.changes).length).toBe(desktop.paths().length);
    });
});

describe('ekler açılınca iner', () => {
    it('görsel indirilir, blob kimliği ve adındaki özet doğrulanır; çevrimdışıyken OFFLINE, bozuk blob yazılmaz', async () => {
        const server = createFakeSyncServer();
        const desktop = await createDesktop(server);
        const { imagePath, image } = fillDesktop(desktop, { notes: 2 });
        const other = imageBytes(2);
        const otherPath = `inv_Not 2__${NOTE_ID(2)}/image/${sha(other)}.png`;
        desktop.writeBytes(otherPath, other);
        await desktop.sync();
        const phone = await pairPhone(server, desktop);

        server.offline = true;
        expect(await phone.service.fetchAttachment(imagePath)).toMatchObject({ ok: false, code: 'OFFLINE' });
        expect(await phone.driver.exists(imagePath)).toBe(false);
        server.offline = false;

        const events = [];
        phone.service.subscribe((event) => events.push(event));
        const [first, second] = await Promise.all([phone.service.fetchAttachment(imagePath), phone.service.fetchAttachment(imagePath)]);
        expect(first).toMatchObject({ ok: true, size: image.length });
        expect(second).toBe(first);
        expect(Buffer.from(await phone.driver.readBase64(imagePath), 'base64').equals(Buffer.from(image))).toBe(true);
        expect(events.filter((event) => event.type === 'attachment')).toHaveLength(1);
        expect(await phone.service.fetchAttachment('inv_yok/image/yok.png')).toMatchObject({ ok: false, code: 'NOT_FOUND' });

        // The server swaps the bytes of two blobs: the attachment is not written (SV9).
        const space = [...server.spaces.values()][0];
        const blobs = [...space.blobs.keys()];
        const state = await phone.service.store.load();
        const entry = Object.values(state.remoteOnly).find((item) => item.path === otherPath);
        const swap =
            blobs.find((blob) => blob !== entry.blob && space.blobs.get(blob).length === space.blobs.get(entry.blob).length) ??
            blobs.find((blob) => blob !== entry.blob);
        space.blobs.set(entry.blob, space.blobs.get(swap));
        const tampered = await phone.service.fetchAttachment(otherPath);
        expect(tampered.ok).toBe(false);
        expect(['DECRYPT_FAILED', 'HASH_MISMATCH_LOCAL']).toContain(tampered.code);
        expect(await phone.driver.exists(otherPath)).toBe(false);

        // An attachment the desktop deletes goes from the phone too, once it was downloaded.
        desktop.remove(imagePath);
        await desktop.sync();
        await phone.service.sync('test');
        expect(await phone.driver.exists(imagePath)).toBe(false);
        expect(await phone.service.hasRemoteAttachment(imagePath)).toBe(false);
    });
});
