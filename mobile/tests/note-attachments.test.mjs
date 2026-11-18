// The image and file blocks of a note when the phone does not hold the
// attachment yet (docs/sync-plan.md S6 step 4): a placeholder that downloads
// once on screen, waits while offline and tries again, and a file block that
// downloads and opens its file, never an executable one.

import { describe, expect, it } from 'vitest';
import { createI18n } from '../src/i18n/index.mjs';
import { mountImage, renderFileBody } from '../src/screens/notes/attachment-views.mjs';
import { createAttachments, isExecutableFileName } from '../src/sync/attachments.mjs';
import { h } from '../src/ui/dom.mjs';
import { createMemoryDriver } from '../src/data/drivers/memory-driver.mjs';

const t = createI18n('tr').t;
const flush = async () => {
    for (let round = 0; round < 10; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Assets over a memory driver; `remote` holds what the "server" has, `online` whether it answers. */
function makeAssets({ remote = {}, online = true } = {}) {
    const driver = createMemoryDriver();
    const visible = [];
    const fetched = [];
    const opened = [];
    const state = { online };
    const assets = {
        keyOf: (reference) => `inv_Not__node_1/${reference}`,
        async status(key) {
            if (await driver.exists(key)) return 'local';
            return key in remote ? 'remote' : 'missing';
        },
        async fetch(key) {
            fetched.push(key);
            if (!state.online) return { ok: false, code: 'OFFLINE' };
            if (!(key in remote)) return { ok: false, code: 'NOT_FOUND' };
            if (remote[key] === 'bad') return { ok: false, code: 'HASH_MISMATCH_LOCAL' };
            driver.putBase64(key, remote[key]);
            return { ok: true };
        },
        async open(key, name) {
            const result = await this.fetch(key);
            if (!result.ok) return result;
            opened.push({ key, name });
            return { ok: true };
        },
        whenVisible: (element, callback) => visible.push(callback),
        waiting: new Set()
    };
    const loadAsset = async (reference) =>
        (await driver.exists(assets.keyOf(reference))) ? `data:image/png;base64,${await driver.readBase64(assets.keyOf(reference))}` : null;
    return { assets, driver, visible, fetched, opened, state, loadAsset };
}

const showVisible = async (visible) => {
    for (const callback of visible.splice(0)) callback();
    await flush();
};

describe('not ekranında ekler', () => {
    it('telefonda olmayan görsel yer tutucuyla görünür, ekrana gelince iner ve gösterilir', async () => {
        const { assets, visible, fetched, loadAsset } = makeAssets({ remote: { 'inv_Not__node_1/image/aa.png': 'iVBORw0K' } });
        const frame = mountImage(h('div'), { t, alt: 'Görsel', reference: 'image/aa.png', loadAsset, assets });
        await flush();
        expect(frame.dataset.attachment).toBe('waiting');
        expect(frame.textContent).toBe(t('note.imageWaiting'));
        expect(fetched).toEqual([]);
        await showVisible(visible);
        expect(frame.dataset.attachment).toBe('local');
        expect(frame.querySelector('img').getAttribute('src')).toBe('data:image/png;base64,iVBORw0K');
    });

    it('çevrimdışıyken çökmez, yer tutucu ve "Yeniden dene" gösterir; bağlantı gelince iner', async () => {
        const { assets, visible, state, loadAsset } = makeAssets({ remote: { 'inv_Not__node_1/image/aa.png': 'iVBORw0K' }, online: false });
        const frame = mountImage(h('div'), { t, alt: '', reference: 'image/aa.png', loadAsset, assets });
        await flush();
        await showVisible(visible);
        expect(frame.dataset.attachment).toBe('waiting');
        expect(frame.querySelector('[data-action="retry-attachment"]').textContent).toBe(t('note.attachmentRetry'));
        expect(assets.waiting.size).toBe(1);

        // The screen runs the waiting downloads again after the next good sync turn.
        state.online = true;
        for (const retry of [...assets.waiting]) await retry();
        await flush();
        expect(frame.dataset.attachment).toBe('local');
        expect(assets.waiting.size).toBe(0);
    });

    it('özeti tutmayan ya da sunucuda olmayan görsel "gösterilemiyor" olur ve yeniden denenmez', async () => {
        const { assets, visible, loadAsset } = makeAssets({ remote: { 'inv_Not__node_1/image/aa.png': 'bad' } });
        const frame = mountImage(h('div'), { t, alt: '', reference: 'image/aa.png', loadAsset, assets });
        await flush();
        await showVisible(visible);
        expect(frame.dataset.attachment).toBe('missing');
        expect(assets.waiting.size).toBe(0);
        const other = mountImage(h('div'), { t, alt: '', reference: 'image/yok.png', loadAsset, assets });
        await flush();
        expect(other.dataset.attachment).toBe('missing');
        expect(other.textContent).toBe(t('note.imageMissing'));
    });

    it('dosya bloğu ad ve boyutu gösterir; dokununca iner ve açılır; çalıştırılabilir dosya açılmaz', async () => {
        const { assets, opened, state } = makeAssets({ remote: { 'inv_Not__node_1/file/dd.pdf': 'JVBERi0=', 'inv_Not__node_1/file/ee.apk': 'UEsD' } });
        const segment = { attributes: { 'data-pisi-file-name': 'Rapor.pdf', 'data-pisi-file-asset': 'file/dd.pdf', 'data-pisi-file-size': '2048' } };
        state.online = false;
        const body = renderFileBody({ t, locale: 'tr-TR', segment, assets });
        expect(body.textContent).toContain('Rapor.pdf');
        expect(body.textContent).toContain('2 KB');
        body.querySelector('[data-action="open-file"]').click();
        await flush();
        expect(body.dataset.code).toBe('OFFLINE');
        expect(body.textContent).toContain(t('note.fileOffline'));
        state.online = true;
        body.querySelector('[data-action="open-file"]').click();
        await flush();
        expect(body.dataset.attachment).toBe('opened');
        expect(opened).toEqual([{ key: 'inv_Not__node_1/file/dd.pdf', name: 'Rapor.pdf' }]);

        const apk = renderFileBody({ t, segment: { attributes: { 'data-pisi-file-name': 'kur.apk', 'data-pisi-file-asset': 'file/ee.apk' } }, assets });
        expect(apk.querySelector('[data-action="open-file"]')).toBeNull();
        expect(apk.textContent).toContain(t('note.fileBlocked'));
        expect(isExecutableFileName('a.EXE')).toBe(true);
        expect(isExecutableFileName('rapor.pdf')).toBe(false);
    });

    it('createAttachments: dosya yerelde varsa indirmeden açar; senkron yoksa "yok" der', async () => {
        const driver = createMemoryDriver();
        driver.putBase64('inv_N/file/dd.pdf', 'JVBERi0=');
        const requests = [];
        const opener = { open: async (request) => (requests.push(request), { ok: true }) };
        const plain = createAttachments({ project: { driver }, sync: null, opener });
        expect(await plain.status('inv_N/file/dd.pdf')).toBe('local');
        expect(await plain.status('inv_N/file/yok.pdf')).toBe('missing');
        expect(await plain.open('inv_N/file/dd.pdf', 'Rapor.pdf')).toEqual({ ok: true });
        expect(requests).toEqual([{ key: 'inv_N/file/dd.pdf', name: 'Rapor.pdf' }]);
        expect(await plain.open('inv_N/file/yok.pdf', 'x.pdf')).toEqual({ ok: false, code: 'NOT_FOUND' });
        expect(await plain.open('inv_N/file/dd.exe', 'kur.exe')).toEqual({ ok: false, code: 'BLOCKED' });
    });
});
