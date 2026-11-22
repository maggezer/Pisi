import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app/app.mjs';
import { loadSampleProject } from '../src/data/sample-project.mjs';
import { NOW, createMemoryProject, noteFile, storeJson } from './data-helpers.mjs';
import { createFakePlatform, createFakeStorage, createFakeSystemTheme } from './helpers.mjs';

let app;
let root;

function start({ files = {}, developer = false } = {}) {
    const platform = createFakePlatform();
    const memory = createMemoryProject(files);
    const errors = [];
    app = createApp({
        root,
        platform,
        storage: createFakeStorage(),
        systemTheme: createFakeSystemTheme(),
        deviceLanguage: 'tr-TR',
        project: memory.project,
        loadSample: developer ? loadSampleProject : null,
        now: () => new Date(NOW),
        onError: (error) => errors.push(error)
    });
    return { ...memory, platform, errors };
}

const openSettings = () => {
    root.querySelector('[data-action="launcher"]').click();
    root.querySelector('[data-menu="settings"]').click();
};
const count = (id) => root.querySelector(`[data-project="${id}"] .pisi-row-value`).textContent;
const snackbar = () => root.querySelector('.pisi-snackbar-message')?.textContent ?? null;

beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
});

afterEach(() => {
    app?.destroy();
    root.remove();
});

describe('uygulama ve proje', () => {
    it('ilk açılışta proje iskeletini kurar ve Ayarlar proje özetini gösterir', async () => {
        const { driver, errors } = start();
        openSettings();
        expect(count('tasks')).toBe('…');
        await app.ready;

        expect(Object.keys(driver.snapshot())).toEqual(['.pisi/properties.json', 'diary/.pisi-diary']);
        expect([count('name'), count('tasks'), count('notes'), count('diary'), count('maps'), count('integrity')]).toEqual([
            'Pisi Projem',
            '0',
            '0',
            '0',
            '0',
            'Sorun yok'
        ]);
        expect(root.querySelector('[data-developer]')).toBeNull();
        expect([snackbar(), errors]).toEqual([null, []]);
    });

    it('geliştirici bölümü yalnız debug derlemesinde görünür; örnek projeyi yükler', async () => {
        const { driver } = start({ developer: true });
        await app.ready;
        openSettings();
        root.querySelector('[data-developer="load-sample"]').click();
        await expect.poll(snackbar).toBe('Örnek proje yüklendi: 6 görev, 3 not eklendi.');

        // Three notes; the sample tasks live in today's diary, and the two dated other days create their days' diaries (docs/task-plan.md §3.2.2).
        expect([count('tasks'), count('notes'), count('diary')]).toEqual(['6', '3', '3']);
        expect(JSON.parse(driver.snapshot()['.pisi/tasks.json']).tasks).toHaveLength(6);
    });

    it('var olan projeyi açar; okunamayan dosyayı kullanıcıya bildirir ve ezmez', async () => {
        const { driver } = start({ files: { 'Not.node': noteFile({}), '.pisi/tasks.json': '{bozuk' } });
        await app.ready;

        expect(snackbar()).toMatch(/^1 dosya okunamadı\./);
        openSettings();
        expect(root.querySelector('[data-project="read-only"]').textContent).toMatch(/^1 dosya okunamadı\./);
        expect(root.textContent).toContain('.pisi/tasks.json');
        expect([count('tasks'), count('notes')]).toEqual(['0', '1']);
        expect(count('integrity')).toBe('1 dosya salt okunur');
        expect(root.querySelector('[data-project="integrity"]').dataset.state).toBe('read-only');
        expect(driver.snapshot()).toEqual({ '.pisi/tasks.json': '{bozuk', 'Not.node': noteFile({}) });
    });

    it('uygulama duraklayınca ve ekran değişince kuyruktaki yazmalar diske iner', async () => {
        const { platform, project, driver } = start({ files: { '.pisi/tasks.json': storeJson({ version: 1, updatedAt: null, tasks: [] }) } });
        await app.ready;
        let flushed = 0;
        const flush = project.flush;
        project.flush = () => {
            flushed += 1;
            return flush();
        };

        void project.tasks.create({ title: 'Duraklamadan önce' }, { diaryDate: '2026-11-14' });
        platform.pause();
        await app.lifecycle.flush();
        expect(JSON.parse(driver.snapshot()['.pisi/tasks.json']).tasks.map((task) => task.title)).toEqual(['Duraklamadan önce']);

        root.querySelector('[data-action="launcher"]').click();
        root.querySelector('[data-menu="notes"]').click();
        platform.pressBack();
        // The diary is written first, then the queue is flushed; both are asynchronous.
        await expect.poll(() => flushed).toBeGreaterThanOrEqual(4);
    });

    it('proje açılamazsa uygulama çalışmaya devam eder ve bunu söyler', async () => {
        const { driver, errors } = start();
        driver.failOn('list');
        await app.ready;
        expect(snackbar()).toBe('Proje açılamadı.');
        expect(errors).toHaveLength(1);
        expect(root.querySelector('[data-screen]').dataset.screen).toBe('pisi');
    });
});
