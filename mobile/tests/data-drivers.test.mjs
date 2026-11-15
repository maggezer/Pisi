import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeKey } from '../src/data/drivers/keys.mjs';
import { createMemoryDriver } from '../src/data/drivers/memory-driver.mjs';
import { createNodeFsDriver } from '../src/data/drivers/node-fs-driver.mjs';
import { createCapacitorFsDriver } from '../src/platform/capacitor-fs-driver.mjs';

const temporaryFolders = [];
afterEach(() => {
    for (const folder of temporaryFolders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

function nodeDriver() {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-mobile-driver-'));
    temporaryFolders.push(folder);
    return createNodeFsDriver(folder);
}

/** A stand-in for the Capacitor Filesystem plugin that refuses to rename over an existing file, as some platforms do. */
function fakeFilesystem() {
    const files = new Map();
    const folders = new Set();
    const missing = () => Object.assign(new Error('File does not exist.'), { code: 'OS-PLUG-FILE-0008' });
    return {
        files,
        async stat({ path: target }) {
            if (files.has(target)) return { type: 'file', size: files.get(target).length, mtime: 1 };
            if (folders.has(target)) return { type: 'directory', size: 0, mtime: 1 };
            throw missing();
        },
        async readFile({ path: target }) {
            if (!files.has(target)) throw missing();
            return { data: files.get(target) };
        },
        async writeFile({ path: target, data }) {
            if (!folders.has(target.slice(0, target.lastIndexOf('/')))) throw new Error('Parent folder does not exist.');
            files.set(target, data);
        },
        async rename({ from, to }) {
            if (!files.has(from)) throw missing();
            if (files.has(to)) throw new Error('Destination exists.');
            files.set(to, files.get(from));
            files.delete(from);
        },
        async readdir({ path: target }) {
            if (!folders.has(target)) throw missing();
            const inside = (candidate) => candidate.startsWith(`${target}/`) && !candidate.slice(target.length + 1).includes('/');
            return {
                files: [
                    ...[...folders].filter(inside).map((name) => ({ name: name.slice(target.length + 1), type: 'directory' })),
                    ...[...files.keys()].filter(inside).map((name) => ({ name: name.slice(target.length + 1), type: 'file' }))
                ]
            };
        },
        async mkdir({ path: target }) {
            if (folders.has(target)) throw new Error('Directory exists.');
            for (let current = target; current; current = current.slice(0, Math.max(0, current.lastIndexOf('/')))) folders.add(current);
        },
        async deleteFile({ path: target }) {
            if (!files.delete(target)) throw missing();
        }
    };
}

describe('proje anahtarları', () => {
    it('proje dışına çıkabilecek anahtarı reddeder', () => {
        expect(normalizeKey('diary/2026-11-14.node')).toBe('diary/2026-11-14.node');
        expect(normalizeKey('')).toBe('');
        for (const key of ['../x', 'a/../b', '/etc/passwd', 'a\\b', 'C:/x', 'a//b', './a']) {
            expect(() => normalizeKey(key), key).toThrow(/Invalid project key/);
        }
    });
});

describe.each([
    ['MemoryDriver', () => createMemoryDriver()],
    ['NodeFsDriver', nodeDriver],
    ['CapacitorFsDriver', () => createCapacitorFsDriver({ filesystem: fakeFilesystem() })]
])('%s sürücü sözleşmesi', (_name, create) => {
    it('yazar, okur, listeler, yeniden adlandırır ve siler', async () => {
        const driver = create();
        await driver.mkdir('');
        await driver.mkdir('.pisi');
        await driver.mkdir('diary/inv_x');
        await driver.mkdir('diary/inv_x');
        await driver.writeText('.pisi/tasks.json', 'bir');
        await driver.writeText('.pisi/.tasks.json.tmp', 'iki ğüşiöç');

        expect(await driver.readText('.pisi/tasks.json')).toBe('bir');
        expect(await driver.list('')).toEqual([
            { name: '.pisi', type: 'directory' },
            { name: 'diary', type: 'directory' }
        ]);
        expect((await driver.stat('.pisi/tasks.json')).type).toBe('file');
        expect((await driver.stat('diary')).type).toBe('directory');
        expect(await driver.stat('yok.node')).toBeNull();

        // rename replaces the destination: this is the last step of an atomic write.
        await driver.rename('.pisi/.tasks.json.tmp', '.pisi/tasks.json');
        expect(await driver.readText('.pisi/tasks.json')).toBe('iki ğüşiöç');
        expect(await driver.list('.pisi')).toEqual([{ name: 'tasks.json', type: 'file' }]);

        await driver.remove('.pisi/tasks.json');
        await driver.remove('.pisi/tasks.json');
        expect(await driver.exists('.pisi/tasks.json')).toBe(false);
        expect(await driver.exists('.pisi')).toBe(true);
    });

    it('olmayan dosya ve klasör için NOT_FOUND verir', async () => {
        const driver = create();
        await driver.mkdir('');
        await expect(driver.readText('yok.node')).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(driver.list('yok')).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(driver.rename('yok.tmp', 'var.node')).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(driver.readText('../dışarı')).rejects.toMatchObject({ code: 'INVALID_KEY' });
    });
});

describe('CapacitorFsDriver', () => {
    it("projeyi Directory.Data altında 'projects/default' klasöründe tutar", async () => {
        const filesystem = fakeFilesystem();
        const driver = createCapacitorFsDriver({ filesystem });
        await driver.mkdir('.pisi');
        await driver.writeText('.pisi/tasks.json', '{}');
        expect([...filesystem.files.keys()]).toEqual(['projects/default/.pisi/tasks.json']);
    });
});
