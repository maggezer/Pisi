// S4: the data layer takes changes from outside (sync) through the writer:
// one write per change, nothing written back, never over a file a screen
// holds unsaved edits of, and the index and search follow.

import { describe, expect, it } from 'vitest';
import { createExternalSource } from '../src/data/external-source.mjs';
import { createOpenDocuments } from '../src/data/open-documents.mjs';
import { createMemoryProject, json, noteFile, paragraph, storeJson } from './data-helpers.mjs';

const NOTE = noteFile({ id: 'node_a', title: 'Gezi', content: paragraph('blk_1', 'Bir') + paragraph('blk_2', 'İki') });
const TASKS = storeJson({ version: 1, updatedAt: null, futureTop: 'kalır', tasks: [{ id: 'task_1', title: 'Yaz', status: 'todo', priority: 3 }] });
const FILES = { 'Gezi.node': NOTE, 'inv_Gezi__node_a/image/aa.png': 'png', '.pisi/tasks.json': TASKS };

const renames = (driver, key) => driver.calls.filter(([name, , to]) => name === 'rename' && to === key).length;
const settle = async (project) => {
    await project.flush();
    await project.index.settled();
};

async function open(files = FILES) {
    const memory = createMemoryProject(files);
    await memory.project.open();
    await memory.project.index.build();
    const events = [];
    memory.project.writer.onFileChanged((key, info) => events.push([key, info]));
    return { ...memory, events };
}

describe('ProjectWriter.applyExternal (S4)', () => {
    it('dış değişiklik tek kez, atomik yazılır ve olay `source: sync` taşır; değişmeyen içerik yazılmaz', async () => {
        const { project, driver, events } = await open();
        const next = NOTE.replace('İki', 'İki (masaüstü)');
        expect(await project.writer.applyExternal('Gezi.node', next)).toEqual({ written: true, key: 'Gezi.node' });
        expect(driver.snapshot()['Gezi.node']).toBe(next);
        expect(renames(driver, 'Gezi.node')).toBe(1);
        expect(events).toEqual([['Gezi.node', { source: 'sync' }]]);

        expect(await project.writer.applyExternal('Gezi.node', next)).toMatchObject({ written: false, reason: 'unchanged' });
        expect(renames(driver, 'Gezi.node')).toBe(1);
        expect(events).toHaveLength(1);
    });

    it('sync olayından sonra hiçbir repo aynı dosyayı yeniden yazmaz; yerel yazmalar `local` olarak işaretlenir', async () => {
        const { project, driver, events } = await open();
        const tasks = JSON.parse(TASKS);
        tasks.tasks[0].status = 'done';
        await project.writer.applyExternal('.pisi/tasks.json', storeJson(tasks));
        await project.writer.applyExternal('diary/2026-11-14.node', noteFile({ id: 'node_d', title: '14-11-2026', content: paragraph('blk_d', 'Gün') }));
        await settle(project);
        await project.tasks.list();
        await project.diary.read('2026-11-14');
        await settle(project);
        expect(driver.calls.filter(([name]) => name === 'rename').map(([, , to]) => to)).toEqual(['.pisi/tasks.json', 'diary/2026-11-14.node']);

        await project.tasks.setStatus('task_1', 'doing');
        expect(events.map(([key, info]) => `${key}:${info.source}`)).toEqual(['.pisi/tasks.json:sync', 'diary/2026-11-14.node:sync', '.pisi/tasks.json:local']);
    });

    it('`expected` tutmazsa yazılmaz ve ertelenir; bozuk (read-only) yerel dosya ve JSON olmayan içerik yazılmaz (SV4, SV10)', async () => {
        const { project, driver } = await open({ ...FILES, 'Bozuk.node': '{' });
        await project.notes.read('Bozuk.node');

        const result = await project.writer.applyExternal('Gezi.node', NOTE.replace('Bir', 'Uzak'), { expected: 'eski metin' });
        expect(result).toEqual({ written: false, key: 'Gezi.node', reason: 'changed' });
        expect(project.documents.getDeferred()).toEqual([{ key: 'Gezi.node', reason: 'changed' }]);
        expect(driver.snapshot()['Gezi.node']).toBe(NOTE);

        expect(await project.writer.applyExternal('Bozuk.node', NOTE)).toMatchObject({ written: false, reason: 'read-only' });
        expect(driver.snapshot()['Bozuk.node']).toBe('{');
        expect(await project.writer.applyExternal('Yeni.node', '{"yarım":')).toMatchObject({ written: false, reason: 'invalid' });
        expect(await project.writer.applyExternal('.pisi/tasks.json', '[]')).toMatchObject({ written: false, reason: 'invalid' });
        expect(driver.snapshot()['Yeni.node']).toBeUndefined();

        // Applied with the right base: the file is taken off the deferred list.
        expect(await project.writer.applyExternal('Gezi.node', NOTE.replace('Bir', 'Uzak'), { expected: NOTE })).toMatchObject({ written: true });
        expect(project.documents.getDeferred()).toEqual([]);
    });

    it('ekranın kirli tuttuğu dosyaya dış değişiklik uygulanmaz; flush sonrası temizlenince uygulanır (SV4)', async () => {
        const { project, driver } = await open();
        let flushed = 0;
        const lease = project.documents.hold('Gezi.node', { flush: () => (flushed += 1) });
        const cleaned = [];
        project.documents.onClean((key) => cleaned.push(key));
        lease.setDirty(true);

        const next = NOTE.replace('Bir', 'Uzak');
        expect(await project.writer.applyExternal('Gezi.node', next)).toMatchObject({ written: false, reason: 'dirty' });
        expect(await project.writer.removeExternal('Gezi.node')).toMatchObject({ written: false, reason: 'dirty' });
        expect(project.documents.isDeferred('Gezi.node')).toBe(true);
        expect(driver.snapshot()['Gezi.node']).toBe(NOTE);

        await project.documents.flush('Gezi.node');
        lease.setDirty(false);
        expect([flushed, cleaned]).toEqual([1, ['Gezi.node']]);
        expect(await project.writer.applyExternal('Gezi.node', next)).toMatchObject({ written: true });
        expect(project.documents.isDeferred('Gezi.node')).toBe(false);
        lease.release();
        expect(project.documents.isOpen('Gezi.node')).toBe(false);
    });

    it('yerel kayıt ile dış değişiklik aynı kuyrukta sırayla yürür; araya giren kayıt `expected` ile korunur', async () => {
        const { project, driver } = await open();
        const external = createExternalSource(project);
        const saving = project.notes.updateContent('Gezi.node', [{ op: 'replace', blockId: 'blk_1', html: 'Yerel' }]);
        const outside = external.setBlockText('Gezi.node', 'blk_2', 'Uzak');
        await Promise.all([saving, outside]);
        const content = JSON.parse(driver.snapshot()['Gezi.node']).content;
        expect(content).toBe(paragraph('blk_1', 'Yerel') + paragraph('blk_2', 'Uzak'));
    });

    it('gelen not ya da harita boş yönetilen yan klasörüyle oluşur (SV6); yolu güvensiz yan klasör adı kullanılmaz', async () => {
        const { project, driver } = await open();
        const note = noteFile({ id: 'node_y', title: 'Yeni', content: paragraph('blk_y', 'Uzak') });
        await project.writer.applyExternal('Klasör/Yeni.node', note);
        expect(await driver.exists('Klasör/inv_Yeni__node_y')).toBe(true);
        const map = json({ pisi: { version: 1, type: 'map', id: 'map_k', title: 'Kroki', sidecar: 'nd_Kroki__map_k' }, map: { nodes: [] } });
        await project.writer.applyExternal('Kroki.map', map);
        expect(await driver.exists('nd_Kroki__map_k')).toBe(true);
        const sneaky = noteFile({ id: 'node_z', title: 'Z', pisi: { sidecar: '../inv_Z__node_z' } });
        await project.writer.applyExternal('Z.node', sneaky);
        expect(driver.calls.filter(([name, key]) => name === 'mkdir' && String(key).includes('..'))).toEqual([]);
    });
});

describe('ProjectWriter.removeExternal (S4)', () => {
    it('masaüstünde silinen dosya kalkar; boş kalan yönetilen yan klasörler kaldırılır, dolu ya da kullanıcı klasörü kalır', async () => {
        const mapNote = noteFile({ id: 'node_m', title: 'Üye', pisi: { parentMap: 'map_k' } });
        const { project, driver, events } = await open({
            ...FILES,
            'Kroki.map': json({ pisi: { version: 1, type: 'map', id: 'map_k', title: 'Kroki', sidecar: 'nd_Kroki__map_k' }, map: { nodes: [] } }),
            'nd_Kroki__map_k/Üye.node': mapNote,
            'nd_Kroki__map_k/inv_Üye__node_m/image/bb.png': 'png',
            'Kullanıcı/not.txt': 'kalır'
        });
        await driver.mkdir('Kullanıcı/boş');

        // The image goes first: the note still names its sidecar folder, so the folder stays (an empty one is fine, SV6).
        expect(await project.writer.removeExternal('inv_Gezi__node_a/image/aa.png')).toEqual({
            written: true,
            key: 'inv_Gezi__node_a/image/aa.png',
            removed: true
        });
        expect(await driver.exists('inv_Gezi__node_a')).toBe(true);
        expect(await project.writer.removeExternal('Gezi.node')).toMatchObject({ written: true, removed: true });
        expect(driver.snapshot()['Gezi.node']).toBeUndefined();
        expect(await driver.exists('inv_Gezi__node_a')).toBe(false);

        await project.writer.removeExternal('nd_Kroki__map_k/Üye.node');
        expect(await driver.exists('nd_Kroki__map_k/inv_Üye__node_m/image/bb.png')).toBe(true);
        await project.writer.removeExternal('nd_Kroki__map_k/inv_Üye__node_m/image/bb.png');
        // The note's sidecar is gone; the map's stays while the map names it.
        expect(await driver.exists('nd_Kroki__map_k/inv_Üye__node_m')).toBe(false);
        expect(await driver.exists('nd_Kroki__map_k')).toBe(true);
        await project.writer.removeExternal('Kroki.map');
        expect(await driver.exists('nd_Kroki__map_k')).toBe(false);
        expect(await driver.exists('Kullanıcı/boş')).toBe(true);
        expect(await project.writer.removeExternal('Yok.node')).toMatchObject({ written: false, reason: 'unchanged' });
        expect(await project.writer.removeExternal('Kullanıcı')).toMatchObject({ written: false, reason: 'invalid' });

        expect(events.map(([key, info]) => [key, info.removed])).toEqual([
            ['inv_Gezi__node_a/image/aa.png', true],
            ['Gezi.node', true],
            ['nd_Kroki__map_k/Üye.node', true],
            ['nd_Kroki__map_k/inv_Üye__node_m/image/bb.png', true],
            ['Kroki.map', true]
        ]);
    });

    it('`expected` tutmazsa silinmez', async () => {
        const { project, driver } = await open();
        expect(await project.writer.removeExternal('Gezi.node', { expected: 'başka' })).toMatchObject({ written: false, reason: 'changed' });
        expect(driver.snapshot()['Gezi.node']).toBe(NOTE);
    });
});

describe('indeks ve arama dış değişikliği artımlı alır (S4)', () => {
    it('gelen not listeye ve aramaya girer, değişen not yeniden katlanır, silinen not çıkar; okunamayan belge salt okunur olur', async () => {
        const { project } = await open();
        const external = createExternalSource(project);
        await external.put('Yeni.node', noteFile({ id: 'node_n', title: 'Yeni', content: paragraph('blk_n', 'Istakoz') }));
        await project.index.settled();
        expect(project.search.query('ıstakoz').map((note) => note.key)).toEqual(['Yeni.node']);

        const before = project.index.getNote('Gezi.node');
        await external.setBlockText('Yeni.node', 'blk_n', 'Kalamar');
        await project.index.settled();
        expect(project.index.getNote('Gezi.node')).toBe(before);
        expect(project.search.query('ıstakoz')).toEqual([]);
        expect(project.search.query('kalamar').map((note) => note.key)).toEqual(['Yeni.node']);

        await external.remove('Yeni.node');
        await project.index.settled();
        expect(project.index.getNote('Yeni.node')).toBeNull();
        expect(project.search.query('kalamar')).toEqual([]);

        await external.put('Garip.node', json({ başka: 'biçim' }));
        await project.index.settled();
        expect(project.getIntegrity().readOnlyFiles).toContain('Garip.node');
    });
});

describe('açık belge kiraları', () => {
    it('aynı dosyada iki kira: biri kirliyken dosya kirlidir; son kirli kira temizlenince bir kez haber verilir', async () => {
        const documents = createOpenDocuments();
        const cleaned = [];
        documents.onClean((key) => cleaned.push(key));
        const pisi = documents.hold('diary/2026-11-14.node');
        const note = documents.hold('diary/2026-11-14.node');
        pisi.setDirty(true);
        note.setDirty(true);
        pisi.setDirty(false);
        expect([documents.isDirty('diary/2026-11-14.node'), cleaned]).toEqual([true, []]);
        note.release();
        expect([documents.isDirty('diary/2026-11-14.node'), cleaned]).toEqual([false, ['diary/2026-11-14.node']]);
        note.setDirty(true);
        expect(documents.isDirty('diary/2026-11-14.node')).toBe(false);
    });
});
