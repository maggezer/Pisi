import { describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../src/data/drivers/memory-driver.mjs';
import { createProjectWriter } from '../src/data/project-writer.mjs';
import { createIds, spyDriver } from './data-helpers.mjs';

function setup(files = {}) {
    const driver = spyDriver(createMemoryDriver(files));
    const changed = [];
    const writer = createProjectWriter({ driver, makeToken: createIds() });
    writer.onFileChanged((key) => changed.push(key));
    return { driver, writer, changed };
}

describe('ProjectWriter', () => {
    it('geçici dosyaya yazar, yeniden adlandırır, geri okuyup doğrular ve fileChanged yayınlar (V6)', async () => {
        const { driver, writer, changed } = setup();
        const result = await writer.writeText('.pisi/tasks.json', '{"a":1}');

        expect(result).toEqual({ written: true, key: '.pisi/tasks.json' });
        expect(driver.calls.filter(([name]) => name !== 'readText')).toEqual([
            ['mkdir', '.pisi'],
            ['writeText', '.pisi/.tasks.json.mobile-00000000-0000-4000-8000-000000000001.tmp'],
            ['rename', '.pisi/.tasks.json.mobile-00000000-0000-4000-8000-000000000001.tmp', '.pisi/tasks.json']
        ]);
        expect(driver.calls.at(-1)).toEqual(['readText', '.pisi/tasks.json']);
        expect(driver.snapshot()).toEqual({ '.pisi/tasks.json': '{"a":1}' });
        expect(changed).toEqual(['.pisi/tasks.json']);
    });

    it('içeriği değişmeyen dosyayı yeniden yazmaz (V4)', async () => {
        const { driver, writer, changed } = setup({ 'Not.node': 'aynı' });
        expect(await writer.writeText('Not.node', 'aynı')).toEqual({ written: false, key: 'Not.node' });
        expect(await writer.update('Not.node', () => null)).toEqual({ written: false, key: 'Not.node' });
        expect(await writer.update('Not.node', (text) => text)).toEqual({ written: false, key: 'Not.node' });
        expect([driver.count('writeText'), driver.count('rename'), changed]).toEqual([0, 0, []]);
    });

    it('yazmalar tek kuyrukta sırayla yapılır; update diskteki son hali görür (V5)', async () => {
        const { driver, writer } = setup({ 'sayaç.json': '0' });
        const results = await Promise.all(Array.from({ length: 5 }, () => writer.update('sayaç.json', (text) => String(Number(text) + 1))));
        expect(results.every((result) => result.written)).toBe(true);
        expect(driver.snapshot()['sayaç.json']).toBe('5');
    });

    it('yazma yarıda kalırsa hedef eski halinde kalır, geçici dosya temizlenir ve kuyruk devam eder', async () => {
        const { driver, writer, changed } = setup({ 'Not.node': 'eski' });
        driver.failOn('rename');
        await expect(writer.writeText('Not.node', 'yeni')).rejects.toThrow('rename failed');
        expect(driver.snapshot()).toEqual({ 'Not.node': 'eski' });
        expect(changed).toEqual([]);

        driver.heal();
        await writer.writeText('Not.node', 'yeni');
        await writer.flush();
        expect(driver.snapshot()).toEqual({ 'Not.node': 'yeni' });
    });

    it('geri okunan içerik farklıysa yazmayı başarısız sayar', async () => {
        const base = createMemoryDriver();
        const driver = { ...base, rename: async (from, to) => base.writeText(to, `${await base.readText(from)} bozuldu`) };
        const writer = createProjectWriter({ driver, makeToken: createIds() });
        await expect(writer.writeText('Not.node', 'içerik')).rejects.toThrow(/could not be verified/);
    });

    it('salt okunur işaretli dosyaya yazmaz (V7)', async () => {
        const { driver, writer } = setup({ '.pisi/tasks.json': '{bozuk' });
        writer.markReadOnly('.pisi/tasks.json', 'invalid JSON');
        await expect(writer.writeText('.pisi/tasks.json', '{}')).rejects.toMatchObject({ code: 'READ_ONLY', key: '.pisi/tasks.json' });
        await expect(writer.update('.pisi/tasks.json', () => '{}')).rejects.toMatchObject({ code: 'READ_ONLY' });
        expect(driver.snapshot()).toEqual({ '.pisi/tasks.json': '{bozuk' });
        expect(writer.getReadOnlyFiles()).toEqual(['.pisi/tasks.json']);
    });

    it('açılışta yarım kalmış geçici dosyaları toparlar: hedef ya tam önceki ya tam sonraki haldedir', async () => {
        const { driver, writer, changed } = setup({
            // Target still there: the write never reached the rename.
            'A.node': '{"eski":true}',
            '.A.node.mobile-1.tmp': '{"yeni":true}',
            // Target gone, temporary file complete: the rename is finished.
            '.B.node.mobile-2.tmp': '{"tam":true}',
            // Target gone, temporary file cut short: it is dropped.
            '.C.node.mobile-3.tmp': '{"yarım":',
            // Not mobile's file: left alone.
            '.D.node.4242.aaaa.tmp': 'masaüstü'
        });
        expect(await writer.recoverDirectory('')).toBe(3);
        expect(driver.snapshot()).toEqual({ '.D.node.4242.aaaa.tmp': 'masaüstü', 'A.node': '{"eski":true}', 'B.node': '{"tam":true}' });
        expect(changed).toEqual(['B.node']);
        expect(await writer.recoverDirectory('yok')).toBe(0);
    });

    it('run birden çok adımı tek iş olarak sıraya koyar', async () => {
        const { driver, writer } = setup();
        const order = [];
        const first = writer.run(async (tx) => {
            await tx.write('a.node', '1');
            await tx.mkdir('inv_a');
            order.push('run');
            return (await tx.exists('inv_a')) && (await tx.read('a.node'));
        });
        const second = writer.writeText('b.node', '2').then(() => order.push('write'));
        expect(await first).toBe('1');
        await second;
        expect(order).toEqual(['run', 'write']);
        expect(Object.keys(driver.snapshot())).toEqual(['a.node', 'b.node']);
    });

    it('dinleyicideki hata yazmayı bozmaz', async () => {
        const errors = [];
        const writer = createProjectWriter({ driver: createMemoryDriver(), makeToken: createIds(), onError: (error) => errors.push(error.message) });
        writer.onFileChanged(() => {
            throw new Error('dinleyici');
        });
        expect((await writer.writeText('a.node', '1')).written).toBe(true);
        expect(errors).toEqual(['dinleyici']);
    });
});
