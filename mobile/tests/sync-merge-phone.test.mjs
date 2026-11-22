// What the phone does with changes on both sides (docs/sync-plan.md §3.4, S5):
// edits of different blocks merge, the same block edited twice becomes one
// conflict copy, a task changed on both sides keeps both fields, and
// attachments stay on the server until they are opened (S6) — a conflict copy
// that names one reuses the server's blob without downloading it.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFakeSyncServer } from './helpers/fake-sync-server.mjs';
import { createDesktop, createPhone, nodeDoc, pairWithCode } from './helpers/sync-devices.mjs';
import { applyBlockPatch, textToBlockHtml } from '../src/data/note-patch.mjs';

const NOTE = 'Plan.node';
const ID = 'node_bbbbbbbb-0000-4000-8000-000000000001';

async function paired(desktopFiles = {}) {
    const server = createFakeSyncServer();
    const desktop = await createDesktop(server);
    desktop.write(
        NOTE,
        nodeDoc(ID, 'Plan', [
            ['b1', 'Bir'],
            ['b2', 'İki'],
            ['b3', 'Üç']
        ])
    );
    for (const [path, value] of Object.entries(desktopFiles)) desktop.write(path, value);
    await desktop.sync();
    const phone = createPhone(server);
    await phone.project.open();
    await phone.service.init();
    await pairWithCode(desktop, phone);
    await phone.service.sync('test');
    return { server, desktop, phone };
}

const setBlock = (doc, blockId, text) => ({ ...doc, content: applyBlockPatch(doc.content, [{ op: 'replace', blockId, html: textToBlockHtml(text) }]) });

async function editOnPhone(phone, blockId, text) {
    const { data } = await phone.project.notes.read(NOTE);
    await phone.project.notes.updateContent(NOTE, [{ op: 'replace', blockId, html: textToBlockHtml(text) }], { expectedContent: data.content });
}

describe('telefonda birleştirme', () => {
    it('farklı bloklar iki tarafta değişince ikisi de kalır, kopya oluşmaz', async () => {
        const { desktop, phone } = await paired();
        desktop.write(NOTE, setBlock(desktop.readJson(NOTE), 'b1', 'Bir (masaüstü)'));
        await desktop.sync();
        await editOnPhone(phone, 'b3', 'Üç (telefon)');
        await phone.service.sync('test');
        await desktop.sync();
        for (const content of [JSON.parse(await phone.driver.readText(NOTE)).content, desktop.readJson(NOTE).content]) {
            expect(content).toContain('Bir (masaüstü)');
            expect(content).toContain('Üç (telefon)');
        }
        expect(desktop.paths().filter((path) => path.endsWith('.node'))).toEqual([NOTE]);
    });

    it('aynı blok iki tarafta değişince tek çakışma kopyası oluşur ve iki metin de durur', async () => {
        const { desktop, phone } = await paired();
        const events = [];
        phone.service.subscribe((event) => events.push(event));
        desktop.write(NOTE, setBlock(desktop.readJson(NOTE), 'b2', 'İki (masaüstü)'));
        await desktop.sync();
        await editOnPhone(phone, 'b2', 'İki (telefon)');
        await phone.service.sync('test');
        await desktop.sync();
        const notes = desktop.paths().filter((path) => path.endsWith('.node'));
        expect(notes).toHaveLength(2);
        const copyPath = notes.find((path) => path !== NOTE);
        expect(copyPath).toMatch(/çakışma/);
        expect(desktop.readJson(NOTE).content).toContain('İki (masaüstü)');
        expect(desktop.readJson(copyPath).content).toContain('İki (telefon)');
        expect(desktop.readJson(copyPath).pisi.id).not.toBe(ID);
        expect(events).toContainEqual({ type: 'conflict-copy', count: 1 });
        expect(phone.service.getStatus().conflicts[0]).toMatchObject({ kind: 'copy', path: NOTE });
    });

    it('telefon görevi tamamlar, masaüstü başlığını değiştirir: iki alan da kalır', async () => {
        const tasks = {
            version: 1,
            updatedAt: '2026-11-17T08:00:00.000Z',
            tasks: [{ id: 'task_first', title: 'Eski başlık', status: 'todo', diaryDate: '2026-11-17', updatedAt: '2026-11-17T08:00:00.000Z' }]
        };
        const { desktop, phone } = await paired({ '.pisi/tasks.json': tasks });
        expect(await phone.project.tasks.complete('task_first')).toMatchObject({ ok: true, changed: true });
        const changed = desktop.readJson('.pisi/tasks.json');
        changed.tasks[0] = { ...changed.tasks[0], title: 'Yeni başlık', updatedAt: '2026-11-17T09:00:00.000Z' };
        desktop.write('.pisi/tasks.json', changed);
        await desktop.sync();
        await phone.service.sync('test');
        await desktop.sync();
        const onPhone = JSON.parse(await phone.driver.readText('.pisi/tasks.json')).tasks[0];
        const onDesktop = desktop.readJson('.pisi/tasks.json').tasks[0];
        for (const task of [onPhone, onDesktop]) expect(task).toMatchObject({ title: 'Yeni başlık', status: 'done' });
    });

    it('ekler telefona inmez; çakışma kopyasının eki sunucudaki blob ile gönderilir', async () => {
        const sidecar = `inv_Plan__${ID}`;
        const imageText = 'png baytları yerine metin';
        const reference = `image/${createHash('sha256').update(imageText).digest('hex')}.png`;
        const image = `${sidecar}/${reference}`;
        const doc = nodeDoc(ID, 'Plan', [
            ['b1', 'Bir'],
            ['b2', 'İki']
        ]);
        doc.content += `<div class="pisi-editor-block" data-pisi-block-id="img1" data-pisi-block-type="image" data-pisi-image-asset="${reference}"></div>`;
        const { server, desktop, phone } = await paired();
        desktop.write(image, imageText);
        desktop.write(NOTE, doc);
        await desktop.sync();
        await phone.service.sync('test');
        expect(await phone.driver.exists(image)).toBe(false);
        const blobDownloads = () => server.requests.filter((request) => request.method === 'GET' && /\/blobs\/b_/.test(request.path)).length;
        const state = await phone.service.store.load();
        expect(Object.values(state.remoteOnly).map((entry) => entry.path)).toContain(image);
        expect(Object.values(state.index).map((entry) => entry.path)).not.toContain(image);

        desktop.write(NOTE, setBlock(desktop.readJson(NOTE), 'b2', 'İki (masaüstü)'));
        await desktop.sync();
        await editOnPhone(phone, 'b2', 'İki (telefon)');
        const downloadsBefore = blobDownloads();
        await phone.service.sync('test');
        // The phone downloaded the note only: the attachment travelled as the blob the server holds.
        expect(blobDownloads() - downloadsBefore).toBe(1);
        await desktop.sync();
        const copyImage = desktop.paths().find((path) => path.includes('/image/') && path !== image);
        expect(copyImage).toBeTruthy();
        expect(desktop.read(copyImage)).toBe(imageText);
        expect(await phone.driver.exists(copyImage)).toBe(false);
    });
});
