#!/usr/bin/env node
// Pisi Sync: the scenario matrix of docs/sync-plan.md S7, end to end, with two real
// devices and the real server:
//   - the PHP test server on MariaDB (scripts/start-sync-test-server.mjs), behind a
//     fault-injecting proxy (scripts/sync-e2e/fault-proxy.mjs);
//   - the desktop: the Pisi app in Electron (scripts/sync-e2e/desktop.mjs), on a copy of
//     tests/fixtures/desktop-project with a few notes for the scenarios;
//   - the phone: Pisi Mobil's build in Playwright as a Pixel 7 (scripts/sync-e2e/phone.mjs).
// The two pair through their own pairing screens (code and verification number). Every
// scenario then runs on that pair, in order; after each one, Project Integrity — the
// desktop's in the app, the same audit in Node on the phone's copy — reports nothing new
// (scenario 15). The destructive scenarios (revoke, rollback) come last.
//
// `npm run test:sync-server` runs it when PISI_SYNC_MATRIX_E2E=1 (CI: sync-server.yml,
// under xvfb). Needs MariaDB (PISI_SYNC_TEST_DB_*), PHP, the Electron binary (npm ci)
// and the mobile package with Playwright's Chromium (npm --prefix mobile ci).
// `--only=1,2,14` runs the set-up and the listed scenarios (while debugging).

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startSyncTestServer } from './start-sync-test-server.mjs';
import { auditProjectFolder } from './sync-e2e/desktop-audit.mjs';
import { assert, sleep, startDesktop } from './sync-e2e/desktop.mjs';
import { startFaultProxy } from './sync-e2e/fault-proxy.mjs';
import { buildMobile, exportPhoneProject, startPhone } from './sync-e2e/phone.mjs';
import {
    ageAndPrune,
    changesPerFid,
    corruptBlob,
    headSeq,
    headsAfter,
    onlySpaceId,
    pointChangeAtBlob,
    restoreSpace,
    snapshotSpace
} from './sync-e2e/server-tools.mjs';
import { checkPisiSyncPath, getPisiSyncFileClass } from '../shared/sync-paths.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const TIME_ZONE = 'Europe/Istanbul';
const only = (process.argv.find((arg) => arg.startsWith('--only=')) || '').slice('--only='.length).split(',').filter(Boolean).map(Number);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const DIARY = `diary/${today}.node`;
const blockId = (note, index) => `blk_${note}0000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// The notes the scenarios work on, next to the fixture's own files.
const NOTES = {
    shared: { key: 'Ortak Not.node', id: 'node_a1a1a1a1-0000-4000-8000-000000000001', title: 'Ortak Not', tag: 'a1a1', blocks: 8 },
    deleted: { key: 'Silinecek.node', id: 'node_a2a2a2a2-0000-4000-8000-000000000002', title: 'Silinecek', tag: 'a2a2', blocks: 3 },
    editDelete: { key: 'Sil ve Düzenle.node', id: 'node_a3a3a3a3-0000-4000-8000-000000000003', title: 'Sil ve Düzenle', tag: 'a3a3', blocks: 3 },
    renamed: { key: 'Yeniden Adlandır.node', id: 'node_a4a4a4a4-0000-4000-8000-000000000004', title: 'Yeniden Adlandır', tag: 'a4a4', blocks: 3 },
    image: { key: 'Görsel Notu.node', id: 'node_a5a5a5a5-0000-4000-8000-000000000005', title: 'Görsel Notu', tag: 'a5a5', blocks: 2 }
};
const paragraph = (note, index) => `${note.title} paragraf ${index + 1}: ${'senkron metni '.repeat(12).trim()}`;

function nodeDocument({ id, title, tag, blocks }, createdAt = '2026-11-17T08:00:00.000Z') {
    return {
        pisi: { version: 1, type: 'node', id, title, sidecar: `inv_${title}__${id}`, createdAt, updatedAt: createdAt, parentMap: 'none' },
        content: Array.from(
            { length: blocks },
            (_value, index) =>
                `<div class="pisi-editor-block" data-pisi-block-id="${blockId(tag, index + 1)}" data-pisi-block-type="paragraph" data-pisi-section-level="0">${paragraph({ title }, index)}</div>`
        ).join('')
    };
}

async function prepareProject(projectPath) {
    const fixture = path.join(repoRoot, 'tests', 'fixtures', 'desktop-project');
    await fs.cp(fixture, projectPath, { recursive: true, filter: (source) => !source.includes('.pisi-history') });
    for (const folder of JSON.parse(await fs.readFile(`${fixture}.directories.json`, 'utf8'))) {
        if (!folder.includes('.pisi-history')) await fs.mkdir(path.join(projectPath, folder), { recursive: true });
    }
    // Scenario 4 needs a diary day that is new on both devices.
    for (const name of await fs.readdir(path.join(projectPath, 'diary'))) {
        const [day, month, year] = today.split('-').reverse();
        if (name === `${today}.node` || name.startsWith(`inv_${day}-${month}-${year}__`))
            await fs.rm(path.join(projectPath, 'diary', name), { recursive: true });
    }
    for (const note of Object.values(NOTES)) {
        await fs.writeFile(path.join(projectPath, note.key), JSON.stringify(nodeDocument(note), null, 2));
        await fs.mkdir(path.join(projectPath, `inv_${note.title}__${note.id}`), { recursive: true });
    }
}

const isAttachment = (key) => getPisiSyncFileClass(key) === 'asset';
const isSynced = (key) => checkPisiSyncPath(key).ok;
const isConflictCopy = (key) => /çakışma/.test(key) && key.endsWith('.node');
const issueKey = (issue) => [issue.code, issue.path || issue.filePath || '', issue.taskId || issue.id || '', issue.message || ''].join('|');

const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pisi-sync-matrix-')));
const projectPath = path.join(tempRoot, 'project');
const phoneCopy = path.join(tempRoot, 'phone-copy');
await fs.mkdir(projectPath, { recursive: true });
await prepareProject(projectPath);

console.log('[matris] mobil derleme…');
buildMobile();
const server = await startSyncTestServer();
const proxy = await startFaultProxy(server.baseUrl);
const serverUrl = proxy.baseUrl.replace(/^http:/, 'https:');
let desktop = null;
let phone = null;
const passed = [];

/** Desktop and phone have the same synced files (the phone's attachments only once downloaded). */
async function assertSameProject(label) {
    const desktopFiles = await desktop.files(isSynced);
    const phoneFiles = new Map((await phone.files()).map((entry) => [entry.path, entry.content]));
    for (const [key, bytes] of desktopFiles) {
        if (getPisiSyncFileClass(key) === 'other') continue;
        if (isAttachment(key) && !phoneFiles.has(key)) continue;
        assert(phoneFiles.has(key), `${label}: telefonda eksik`, key);
        const phoneBytes = isAttachment(key) ? Buffer.from(phoneFiles.get(key), 'base64') : Buffer.from(phoneFiles.get(key), 'utf8');
        assert(phoneBytes.equals(bytes), `${label}: iki cihazda farklı`, {
            key,
            desktop: bytes.toString('utf8').slice(0, 3000),
            phone: phoneBytes.toString('utf8').slice(0, 3000)
        });
    }
    for (const key of phoneFiles.keys()) assert(desktopFiles.has(key), `${label}: yalnız telefonda var`, key);
}

const conflictCopies = async () => ({
    desktop: [...(await desktop.files(isConflictCopy)).keys()].sort(),
    phone: (await phone.files())
        .map((entry) => entry.path)
        .filter(isConflictCopy)
        .sort()
});

let desktopBaseline = new Set();
let phoneBaseline = new Set();

async function phoneAudit() {
    await exportPhoneProject(phone, phoneCopy, isAttachment);
    const desktopKeys = new Set((await desktop.files(isAttachment)).keys());
    // An attachment that has not come down yet is not "missing" (S6): it waits on the server.
    return auditProjectFolder(phoneCopy).issues.filter(
        (issue) => !(issue.code === 'attachment-target-missing' && [...desktopKeys].some((key) => issue.message.endsWith(key.slice(key.indexOf('/') + 1))))
    );
}

/** Scenario 15: after every scenario neither device has a Project Integrity finding it did not have at the start. */
async function assertIntegrity(label) {
    const fromDesktop = (await desktop.integrity()).issues.filter((issue) => !desktopBaseline.has(issueKey(issue)));
    assert(fromDesktop.length === 0, `${label}: masaüstünde yeni Integrity bulgusu`, fromDesktop);
    const fromPhone = (await phoneAudit()).filter((issue) => !phoneBaseline.has(issueKey(issue)));
    assert(fromPhone.length === 0, `${label}: telefonda yeni Integrity bulgusu`, fromPhone);
}

async function scenario(number, title, run) {
    if (only.length && !only.includes(number)) return;
    const started = Date.now();
    console.log(`[matris] ${number}. ${title}`);
    proxy.clear();
    phone.offline = false;
    await run();
    await assertIntegrity(`${number}. senaryo`);
    passed.push({ number, title, ms: Date.now() - started });
}

/** Waits until no synced file of the desktop has changed for a while (its projections react to what came in). */
async function desktopQuiet() {
    let last = '';
    let stableSince = Date.now();
    for (const started = Date.now(); Date.now() - started < 30000;) {
        const stamp = JSON.stringify([...(await desktop.files(isSynced))].map(([key, bytes]) => [key, sha(bytes)]));
        if (stamp !== last) {
            last = stamp;
            stableSince = Date.now();
        } else if (Date.now() - stableSince >= 1500) return;
        await sleep(250);
    }
    throw new Error('Masaüstü 30 sn içinde durulmadı');
}

/**
 * Phone and desktop exchange until both have everything: the phone sends, then the desktop and
 * the phone take turns until a desktop turn neither sends nor receives anything. The desktop
 * answers some incoming changes with writes of its own (the diary's task section follows
 * tasks.json), so this may take a second round, but it must settle within four.
 */
async function exchange(label) {
    await phone.syncNow(`${label}: telefon`);
    for (let round = 0; round < 4; round += 1) {
        await desktopQuiet();
        const result = await desktop.syncOk(label);
        await phone.syncNow(`${label}: telefon (${round + 1})`);
        if (!result.pushed && !result.changed && !result.added && !result.removed) return;
    }
    throw new Error(`${label}: iki cihaz dört turda durulmadı`);
}

try {
    // ── Set-up: the desktop opens a space, the phone pairs with the code. ──────────────
    desktop = await startDesktop({ projectPath, userDataPath: path.join(tempRoot, 'user-data'), env: { TZ: TIME_ZONE } });
    const startIssues = (await desktop.integrity()).issues;
    assert(Array.isArray(startIssues), 'Integrity denetimi çalışmadı');
    desktopBaseline = new Set(startIssues.map(issueKey));
    assert(desktopBaseline.size === 0, 'Fixture projesi Integrity bulgusu olmadan başlar', startIssues);
    const firstRun = await desktop.createSpace(serverUrl, server.setupKey);
    assert(firstRun.role === 'admin', 'Masaüstü yönetici olmalı', firstRun);
    const spaceId = onlySpaceId(server);

    phone = await startPhone({ proxy, timezoneId: TIME_ZONE });
    await phone.open();
    await phone.openFromMenu('settings');
    await phone.page.locator('[data-sync="pair"]').tap();
    await phone.page.locator('[data-action="use-code"]').tap();
    await desktop.evaluate('window.openPisiSyncPairingDialog()');
    const code = await desktop.waitUntil('eşleştirme kodu', () =>
        desktop.evaluate(`document.querySelector('[data-pisi-sync-pairing-code]')?.textContent || null`)
    );
    await phone.page.locator('#pair-server').fill('sync.test');
    await phone.page.locator('#pair-code').fill(code);
    await phone.page.locator('#pair-name').fill('Matris telefonu');
    await phone.page.locator('[data-action="connect"]').tap();
    const phoneSas = (
        await phone.until('telefonda doğrulama numarası', async () => (await phone.page.locator('[data-pair="sas"]').textContent())?.trim())
    ).replace(/\D/g, '');
    const shown = await desktop.waitUntil('masaüstünde doğrulama numarası', () =>
        desktop.evaluate(`(() => {
            const sas = document.querySelector('[data-pisi-sync-pairing-sas]');
            return sas && !sas.hidden && sas.querySelector('strong')?.textContent ? { sas: sas.querySelector('strong').textContent, device: document.querySelector('[data-pisi-sync-pairing-device]')?.textContent } : null;
        })()`)
    );
    assert(shown.sas.replace(/\D/g, '') === phoneSas, 'İki ekranda aynı doğrulama numarası', { shown, phoneSas });
    assert(shown.device.includes('Matris telefonu'), 'Masaüstü telefonun adını gösterir', shown);
    await desktop.evaluate(`document.querySelector('[data-pisi-sync-pairing-accept]').click()`);
    await phone.page.locator('[data-pair="done"]').waitFor({ timeout: 60000 });
    await desktop.evaluate('window.closePisiSyncPairingDialog()');
    // The first download starts as soon as the pairing is done, before "Tamam".
    await phone.page.locator('[data-action="pair-done"]').tap();
    await phone.settle('ilk indirme', 0);
    await phone.until(
        'ilk indirme bitti',
        async () => (await phone.read(NOTES.shared.key)) !== null && (await phone.statusRow().getAttribute('data-state')) === 'idle',
        120000
    );
    await assertSameProject('ilk indirme');
    phoneBaseline = new Set((await phoneAudit()).map(issueKey));
    assert(phoneBaseline.size === 0, 'Telefondaki kopya Integrity bulgusu olmadan başlar', [...phoneBaseline]);
    console.log('[matris] kurulum: alan açıldı, telefon kodla eşleşti, proje indi');

    // ── 1. Different blocks of one note on both devices: both edits stay, no copy. ────────
    await scenario(1, 'aynı notun farklı blokları iki cihazda değişir', async () => {
        const copiesBefore = await conflictCopies();
        phone.offline = true;
        await phone.openNote(NOTES.shared.key);
        await phone.typeAtEnd(1, ' TELEFON-S1');
        await phone.home();
        await desktop.openNote(NOTES.shared.key);
        await desktop.typeInBlock(blockId('a1a1', 5), ' MASAUSTU-S1');
        await desktop.flush();
        await desktop.syncOk('1');
        phone.offline = false;
        await exchange('1');
        const text = await desktop.read(NOTES.shared.key);
        assert(text.includes('TELEFON-S1') && text.includes('MASAUSTU-S1'), '1: iki değişiklik de masaüstünde');
        assert(JSON.stringify(await conflictCopies()) === JSON.stringify(copiesBefore), '1: çakışma kopyası oluşmaz', await conflictCopies());
        await assertSameProject('1');
    });

    // ── 2. The same block on both devices: one conflict copy, both texts kept. ───────────
    await scenario(2, 'aynı blok iki cihazda değişir', async () => {
        const before = await conflictCopies();
        phone.offline = true;
        await phone.openNote(NOTES.shared.key);
        await phone.typeAtEnd(2, ' TELEFON-S2');
        await phone.home();
        await desktop.openNote(NOTES.shared.key);
        await desktop.typeInBlock(blockId('a1a1', 3), ' MASAUSTU-S2');
        await desktop.flush();
        await desktop.syncOk('2');
        phone.offline = false;
        await exchange('2');
        const after = await conflictCopies();
        const added = after.desktop.filter((key) => !before.desktop.includes(key));
        assert(added.length === 1, '2: masaüstünde tek çakışma kopyası', after);
        assert(JSON.stringify(after.phone) === JSON.stringify(after.desktop), '2: kopya iki cihazda aynı', after);
        const both = (await desktop.read(NOTES.shared.key)) + (await desktop.read(added[0]));
        assert(both.includes('TELEFON-S2') && both.includes('MASAUSTU-S2'), '2: iki metin de kalır (not ya da kopya)');
        await assertSameProject('2');
    });

    // ── 3. The phone completes a task while the desktop renames it: both fields stay. ─────
    await scenario(3, 'telefon görevi tamamlar, masaüstü başlığını değiştirir', async () => {
        const id = 'task_matrix_s3_0001';
        const created = await desktop.evaluate(
            `window.pisiDomain.command('task.upsert.v1', { projectFolder: window.currentProjectFolder, task: { id: '${id}', title: 'Matris görevi', status: 'todo' } })`
        );
        assert(created?.ok, '3: görev oluşturulur', created);
        await desktop.syncOk('3');
        await phone.syncNow('3: görev telefona');
        phone.offline = true;
        await phone.openFromMenu('tasks');
        await phone.page.locator('[data-view="inbox"]').tap();
        const box = phone.page.getByRole('checkbox', { name: 'Tamamla: Matris görevi' });
        await phone.tap(box);
        await phone.until(
            '3: telefonda tamamlandı',
            async () => (await phone.readJson('.pisi/tasks.json')).tasks.find((task) => task.id === id)?.status === 'done'
        );
        const renamed = await desktop.evaluate(
            `window.pisiDomain.command('task.update.v1', { projectFolder: window.currentProjectFolder, taskId: '${id}', patch: { title: 'Matris görevi (masaüstü)' } })`
        );
        assert(renamed?.ok, '3: masaüstünde başlık değişir', renamed);
        await desktop.syncOk('3');
        phone.offline = false;
        await exchange('3');
        for (const [side, store] of [
            ['masaüstü', await desktop.readJson('.pisi/tasks.json')],
            ['telefon', await phone.readJson('.pisi/tasks.json')]
        ]) {
            const task = store.tasks.find((item) => item.id === id);
            assert(task?.status === 'done' && task.title === 'Matris görevi (masaüstü)', `3: ${side}ta iki alan da kalır`, task);
        }
        await phone.home();
        await assertSameProject('3');
    });

    // ── 4. The same day's diary is new on both devices: one diary, both texts. ───────────
    await scenario(4, 'aynı gün iki cihaz günlük yazar', async () => {
        assert(!(await desktop.exists(DIARY)) && (await phone.read(DIARY)) === null, '4: günün günlüğü iki cihazda da yok');
        phone.offline = true;
        await phone.home();
        await phone.page.locator('[data-diary="text"]').fill('Telefonun günlüğü S4');
        await phone.page.locator('[data-diary="text"]').blur();
        await phone.until('4: telefonda günlük', async () => (await phone.read(DIARY))?.includes('Telefonun günlüğü S4'));
        await desktop.evaluate(`window.pisiProject.getOrCreateDiaryNode(window.currentProjectFolder, '${today}')`);
        await desktop.openNote(DIARY);
        await desktop.typeAtEditorEnd('Masaüstünün günlüğü S4');
        await desktop.flush();
        await desktop.syncOk('4');
        phone.offline = false;
        await exchange('4');
        const diary = await desktop.read(DIARY);
        assert(diary.includes('Telefonun günlüğü S4') && diary.includes('Masaüstünün günlüğü S4'), '4: tek günlükte iki metin');
        const stray = [...(await desktop.files((key) => /Günlük çakışması/.test(key))).keys()];
        assert(stray.length === 0, '4: günlük çakışma kopyası oluşmaz', stray);
        await assertSameProject('4');
    });

    // ── 5. The desktop deletes a note that is open on the phone. ─────────────────────────
    await scenario(5, 'masaüstü notu siler; telefonda açıksa söylenir', async () => {
        await phone.openNote(NOTES.deleted.key);
        const deleted = await desktop.evaluate(`window.pisiProject.deletePisiFile(${JSON.stringify(desktop.abs(NOTES.deleted.key))})`);
        assert(deleted?.ok !== false, '5: masaüstünde silme', deleted);
        await desktop.syncOk('5');
        await phone.resume('5: telefon');
        await phone.until('5: snackbar', async () => /Bu not masaüstünde silindi/.test((await phone.snackbar().allTextContents()).join(' ')));
        await phone.until('5: listeye dönüş', async () => (await phone.screenName()) !== 'note');
        assert((await phone.read(NOTES.deleted.key)) === null, '5: telefondan kalktı');
        await assertSameProject('5');
    });

    // ── 6. The desktop deletes a note the offline phone edits: a conflict copy. ──────────
    await scenario(6, 'masaüstü siler, çevrimdışı telefon düzenler', async () => {
        const before = await conflictCopies();
        phone.offline = true;
        await phone.openNote(NOTES.editDelete.key);
        await phone.typeAtEnd(0, ' TELEFON-S6');
        await phone.home();
        await desktop.evaluate(`window.pisiProject.deletePisiFile(${JSON.stringify(desktop.abs(NOTES.editDelete.key))})`);
        await desktop.syncOk('6');
        phone.offline = false;
        await exchange('6');
        assert(!(await desktop.exists(NOTES.editDelete.key)) && (await phone.read(NOTES.editDelete.key)) === null, '6: asıl yol iki cihazda silinir');
        const after = await conflictCopies();
        const added = after.desktop.filter((key) => !before.desktop.includes(key));
        assert(added.length === 1 && (await desktop.read(added[0])).includes('TELEFON-S6'), '6: telefonun düzenlemesi çakışma kopyasında', after);
        await assertSameProject('6');
    });

    // ── 7. The desktop renames a note the offline phone edits: the edit follows the name. ─
    await scenario(7, 'masaüstü yeniden adlandırır, çevrimdışı telefon düzenler', async () => {
        const before = await conflictCopies();
        phone.offline = true;
        await phone.openNote(NOTES.renamed.key);
        await phone.typeAtEnd(0, ' TELEFON-S7');
        await phone.home();
        const renamed = await desktop.evaluate(`window.pisiProject.renamePisiFile(${JSON.stringify(desktop.abs(NOTES.renamed.key))}, 'Yeni Ad')`);
        assert(renamed?.ok !== false, '7: masaüstünde yeniden adlandırma', renamed);
        assert(await desktop.exists('Yeni Ad.node'), '7: yeni ad masaüstünde');
        await desktop.syncOk('7');
        phone.offline = false;
        await exchange('7');
        assert((await desktop.read('Yeni Ad.node')).includes('TELEFON-S7'), '7: düzenleme yeni ada gider');
        assert(!(await desktop.exists(NOTES.renamed.key)) && (await phone.read(NOTES.renamed.key)) === null, '7: eski ad kalmaz');
        assert(JSON.stringify(await conflictCopies()) === JSON.stringify(before), '7: çakışma kopyası oluşmaz', await conflictCopies());
        await assertSameProject('7');
    });

    // ── 8. The desktop adds an image: a placeholder on the phone, downloaded when shown. ──
    await scenario(8, 'masaüstü görsel ekler; telefonda yer tutucu, açınca iner', async () => {
        await desktop.openNote(NOTES.image.key);
        assert(await desktop.pasteImage(), '8: görsel yapıştırılır');
        const reference = await desktop.waitUntil('8: görsel kaydedildi', async () => {
            const data = await desktop.readJson(NOTES.image.key);
            return /data-pisi-image-asset="([^"]+)"/.exec(data.content)?.[1] || null;
        });
        const imageKey = `inv_${NOTES.image.title}__${NOTES.image.id}/${reference}`;
        await desktop.waitUntil('8: görsel dosyası', () => desktop.exists(imageKey));
        await desktop.flush();
        await desktop.syncOk('8');
        await phone.syncNow('8: not telefona');
        assert((await phone.read(NOTES.image.key))?.includes(reference), '8: not telefona iner');
        assert((await phone.read(imageKey)) === null, '8: görsel açılmadan inmez');
        phone.offline = true;
        await phone.openNote(NOTES.image.key);
        const frame = phone.page.locator('.pisi-note-image');
        // The download was tried and failed: the placeholder and "Yeniden dene" are shown.
        await phone.until(
            '8: yer tutucu',
            async () => (await frame.getAttribute('data-attachment')) === 'waiting' && (await frame.locator('[data-action="retry-attachment"]').isVisible())
        );
        assert(/Görsel bağlantı gelince iner/.test(await frame.textContent()), '8: yer tutucu metni');
        phone.offline = false;
        await frame.locator('[data-action="retry-attachment"]').tap();
        await phone.until('8: görsel indi', async () => (await frame.getAttribute('data-attachment')) === 'local', 60000);
        const stored = await phone.read(imageKey);
        assert(sha(Buffer.from(stored, 'base64')) === sha(await desktop.files((key) => key === imageKey).then((files) => files.get(imageKey))), '8: özet aynı');
        await phone.home();
        await exchange('8: son');
        await assertSameProject('8');
    });

    // ── 9. Days offline, 50 changes, a pruned log: all go up after a full comparison. ────
    await scenario(9, 'telefon günlerce çevrimdışı kalıp 50 değişiklikle döner', async () => {
        const spaceId = onlySpaceId(server);
        phone.offline = true;
        const titles = Array.from({ length: 48 }, (_value, index) => `Çevrimdışı ${String(index + 1).padStart(2, '0')}`);
        await phone.openFromMenu('notes');
        for (const title of titles) {
            await phone.page.locator('[data-action="new-note"]').tap();
            await phone.page.locator('#pisi-new-note-title').fill(title);
            await phone.page.locator('#pisi-new-note-title').press('Enter');
            await phone.until(`9: ${title}`, async () => (await phone.screenName()) === 'note');
            await phone.back();
            await phone.until('9: liste', async () => (await phone.screenName()) === 'notes');
        }
        await phone.home();
        const diaryField = phone.page.locator('[data-diary="text"]');
        await diaryField.focus();
        await phone.page.keyboard.press('Control+End');
        await phone.page.keyboard.type('\nÇevrimdışı günlerin notu S9');
        await diaryField.blur();
        const add = phone.page.getByRole('textbox', { name: 'Görev ekle' });
        await add.fill('Çevrimdışı görev S9');
        await add.press('Enter');
        await phone.until('9: telefonda görev', async () =>
            (await phone.readJson('.pisi/tasks.json')).tasks.some((task) => task.title === 'Çevrimdışı görev S9')
        );
        // Meanwhile the desktop goes on (the same note twice, so its first change is no head any more),
        // and the days pass on the server.
        const phoneCursor = (await phone.syncState()).cursor;
        await desktop.openNote(NOTES.shared.key);
        for (const mark of [' MASAUSTU-S9a', ' MASAUSTU-S9']) {
            await desktop.typeInBlock(blockId('a1a1', 7), mark);
            await desktop.flush();
            await desktop.syncOk('9');
        }
        const pruned = ageAndPrune(server, spaceId);
        assert(pruned > phoneCursor, '9: günlük telefonun imlecinin ötesine budandı', { pruned, phoneCursor });
        const mark = proxy.log.length;
        phone.offline = false;
        await phone.syncNow('9: dönüş');
        const phoneRequests = proxy.since(mark, 'phone');
        assert(
            phoneRequests.some((entry) => entry.path.includes('/changes') && entry.status === 410),
            '9: budanmış imleç CURSOR_EXPIRED alır',
            phoneRequests.map((entry) => `${entry.method} ${entry.path} ${entry.status}`)
        );
        assert(
            phoneRequests.some((entry) => entry.path.includes('/heads') && entry.status === 200),
            '9: tam karşılaştırmaya geçilir'
        );
        await exchange('9: son');
        for (const title of titles) assert(await desktop.exists(`${title}.node`), '9: not masaüstüne gitti', title);
        assert((await desktop.read(DIARY)).includes('Çevrimdışı günlerin notu S9'), '9: günlük gitti');
        assert(
            (await desktop.readJson('.pisi/tasks.json')).tasks.some((task) => task.title === 'Çevrimdışı görev S9'),
            '9: görev gitti'
        );
        assert((await phone.read(NOTES.shared.key)).includes('MASAUSTU-S9'), '9: masaüstünün değişikliği telefona geldi');
        await assertSameProject('9');
    });

    // ── 10. The connection breaks in the middle of an upload: it goes on, nothing twice. ─
    await scenario(10, 'yükleme ortasında bağlantı kesilir', async () => {
        const spaceId = onlySpaceId(server);
        const seqBefore = headSeq(server, spaceId);
        const FILES = 12;
        for (let index = 0; index < FILES; index += 1) {
            const note = { id: `node_b10b10b1-0000-4000-8000-${String(index).padStart(12, '0')}`, title: `Yükleme ${index + 1}`, tag: 'b10b', blocks: 4 };
            await fs.writeFile(desktop.abs(`${note.title}.node`), JSON.stringify(nodeDocument(note), null, 2));
            await fs.mkdir(desktop.abs(`inv_${note.title}__${note.id}`), { recursive: true });
        }
        // The desktop: after five blobs went up, every part upload breaks.
        const mark = proxy.log.length;
        const rule = proxy.fail({ client: 'desktop', method: 'PUT', path: /\/uploads\/[^/]+\/parts\/\d+$/, when: 'before', times: 1000, skip: 5 });
        const broken = await desktop.sync();
        assert(broken?.ok === false && rule.hits > 0, '10: kesilen tur başarısız biter', broken);
        assert(headSeq(server, spaceId) === seqBefore, "10: commit'e varılmadı");
        proxy.clear();
        const resumed = proxy.log.length;
        await desktop.syncOk('10: sürdürme');
        // Blobs whose upload was completed before the break are not uploaded again.
        const uploadsOf = (entries) => {
            const started = [];
            const completed = new Set();
            let current = null;
            for (const entry of entries) {
                const start = /\/blobs\/([^/]+)\/uploads$/.exec(entry.path);
                if (start && entry.status === 201) started.push((current = start[1]));
                else if (current && /\/uploads\/[^/]+\/complete$/.test(entry.path) && entry.status === 201) completed.add(current);
            }
            return { started, completed };
        };
        const first = uploadsOf(proxy.log.slice(mark, resumed).filter((entry) => entry.client === 'desktop'));
        const second = uploadsOf(proxy.since(resumed, 'desktop'));
        assert(first.completed.size >= 5, '10: kesilmeden önce blob yüklendi', first);
        assert(second.started.length > 0 && second.started.every((blob) => !first.completed.has(blob)), '10: yüklenmiş blob yeniden yüklenmez', {
            first,
            second
        });
        const twice = changesPerFid(server, spaceId, seqBefore).filter((row) => row.n > 1);
        assert(twice.length === 0, '10: hiçbir dosya iki kez gönderilmez', twice);
        // The phone: the server takes the commit, the answer is lost; the retry gets the same result.
        await phone.syncNow('10: telefon iner');
        const phoneMark = headSeq(server, spaceId);
        await phone.openNote(NOTES.shared.key);
        await phone.typeAtEnd(0, ' TELEFON-S10');
        await phone.home();
        const lost = proxy.fail({ client: 'phone', method: 'POST', path: /\/commit$/, when: 'after', times: 1 });
        await phone.syncNow('10: telefon');
        if (!(await desktop.read(NOTES.shared.key)).includes('TELEFON-S10')) await phone.syncNow('10: telefon yeniden');
        assert(lost.hits === 1, '10: yanıt bir kez kayboldu', lost);
        const phoneTwice = changesPerFid(server, spaceId, phoneMark).filter((row) => row.n > 1);
        assert(phoneTwice.length === 0, '10: aynı commitId ile yeniden deneme çift kayıt üretmez', phoneTwice);
        await desktop.syncOk('10');
        assert((await desktop.read(NOTES.shared.key)).includes('TELEFON-S10'), '10: telefonun değişikliği masaüstüne geldi');
        await exchange('10: son');
        await assertSameProject('10');
    });

    // ── 13. The server corrupts a blob or moves it to another file: not applied (SV9). ───
    await scenario(13, 'sunucu blobu bozar ya da başka dosyaya taşır', async () => {
        const spaceId = onlySpaceId(server);
        // A blob the phone is about to download is corrupted on disk.
        const bad = { id: 'node_c13c13c1-0000-4000-8000-000000000001', title: 'Bozuk Blob', tag: 'c13c', blocks: 2 };
        const mark = headSeq(server, spaceId);
        await fs.writeFile(desktop.abs(`${bad.title}.node`), JSON.stringify(nodeDocument(bad), null, 2));
        await fs.mkdir(desktop.abs(`inv_${bad.title}__${bad.id}`), { recursive: true });
        await desktop.syncOk('13');
        const [head] = headsAfter(server, spaceId, mark).filter((row) => row.op === 'put');
        assert(head, '13: yeni başlık', headsAfter(server, spaceId, mark));
        const repair = corruptBlob(server, spaceId, String(head.blob_id));
        await phone.syncNow('13: bozuk blob');
        assert((await phone.read(`${bad.title}.node`)) === null, '13: bozuk içerik telefona yazılmaz');
        const phoneIssues = (await phone.syncState())?.issues || [];
        assert(
            phoneIssues.some((issue) => issue.path === `${bad.title}.node` && ['DECRYPT_FAILED', 'HASH_MISMATCH_LOCAL'].includes(issue.code)),
            '13: telefon senkron durumunda gösterir',
            phoneIssues
        );
        repair();
        // A blob of the phone's note is shown to the desktop under another note.
        const moved = [
            { title: 'Taşınan A', text: 'A notunun metni S13' },
            { title: 'Taşınan B', text: 'B notunun metni S13' }
        ];
        const markMoved = headSeq(server, spaceId);
        await phone.openFromMenu('notes');
        for (const note of moved) {
            await phone.page.locator('[data-action="new-note"]').tap();
            await phone.page.locator('#pisi-new-note-title').fill(note.title);
            await phone.page.locator('#pisi-new-note-title').press('Enter');
            await phone.until(`13: ${note.title}`, async () => (await phone.screenName()) === 'note');
            await phone.typeAtEnd(0, note.text);
            await phone.back();
            await phone.until('13: liste', async () => (await phone.screenName()) === 'notes');
        }
        await phone.syncNow('13: taşınan notlar');
        const heads = headsAfter(server, spaceId, markMoved).filter((row) => row.op === 'put' && row.device_id !== undefined);
        assert(heads.length >= 2, '13: iki not gönderildi', heads);
        // Newest first: B then A (the phone sends them in one commit; take the two notes' rows by size order is not enough, so try both).
        const [first, second] = heads;
        pointChangeAtBlob(server, spaceId, Number(second.seq), String(first.blob_id), Number(first.size));
        const result = await desktop.sync();
        const issues = result?.issues ?? 0;
        const onDesktop = await Promise.all(
            moved.map(async (note) => ((await desktop.exists(`${note.title}.node`)) ? await desktop.read(`${note.title}.node`) : null))
        );
        // The note whose head was moved is not written; the other one is.
        const written = onDesktop.filter(Boolean);
        assert(written.length === 1, '13: taşınan blob masaüstüne yazılmaz', { onDesktop: onDesktop.map((text) => text?.slice(0, 80) ?? null), result });
        assert(issues > 0, '13: masaüstü senkron durumunda gösterir', result);
        pointChangeAtBlob(server, spaceId, Number(second.seq), String(second.blob_id), Number(second.size));
        // The devices write both notes again: the next versions come through.
        await desktop.openNote(`${bad.title}.node`);
        await desktop.typeInBlock(blockId('c13c', 1), ' onarıldı');
        await desktop.flush();
        await desktop.syncOk('13: onarım');
        for (const note of moved) {
            await phone.openNote(`${note.title}.node`);
            await phone.typeAtEnd(0, ' onarıldı');
            await phone.home();
        }
        await exchange('13: onarım');
        for (const note of moved) assert((await desktop.read(`${note.title}.node`)).includes(note.text), '13: onarımdan sonra iner', note.title);
        await assertSameProject('13');
    });

    // ── 14. A turn while the user types in the open note on the desktop. ──────────────────
    await scenario(14, 'masaüstünde açık not yazılırken tur çalışır', async () => {
        await desktop.openNote(NOTES.shared.key);
        await desktop.evaluate(`(() => {
            const editor = document.getElementById('center-node-editor-content');
            for (const block of editor.children) block.__pisiE2EMark = block.dataset.pisiBlockId;
            return true;
        })()`);
        await desktop.typeInBlock(blockId('a1a1', 4), 'YAZILAN-1 ', 10);
        await phone.openNote(NOTES.shared.key);
        await phone.typeAtEnd(5, ' TELEFON-S14');
        await phone.home();
        await phone.syncNow('14: telefon');
        const before = await desktop.editorProbe();
        const turn = desktop.evaluate('window.pisiSyncClient.run("manual")');
        await desktop.insertText('YAZILAN-2 ');
        assert((await turn)?.ok, '14: yazarken tur');
        await desktop.waitUntil('14: uzak blok uygulandı', async () => {
            const state = await desktop.editorProbe();
            if (state.blocks.find((block) => block.id === blockId('a1a1', 6))?.text.includes('TELEFON-S14')) return true;
            await desktop.sync();
            return false;
        });
        const after = await desktop.editorProbe();
        const typed = after.blocks.find((block) => block.id === blockId('a1a1', 4));
        assert(typed.text.slice(10).startsWith('YAZILAN-1 YAZILAN-2 '), '14: yazılan metin yerinde', typed);
        assert(after.caret?.blockId === blockId('a1a1', 4) && after.caret.before === 10 + 'YAZILAN-1 YAZILAN-2 '.length, '14: imleç yerinde', after.caret);
        assert(after.scrollTop === before.scrollTop, '14: kaydırma yerinde', { before: before.scrollTop, after: after.scrollTop });
        assert(JSON.stringify(after.tabs) === JSON.stringify(before.tabs) && after.activeTab === before.activeTab, '14: sekmeler yerinde');
        for (const block of after.blocks) {
            if (block.id !== blockId('a1a1', 6)) assert(block.mark === block.id, '14: değişmeyen bloklar yeniden çizilmez', block.id);
        }
        assert((await desktop.loadCount()) === 0, '14: loadProject çağrılmaz', await desktop.loadCount());
        await desktop.flush();
        await exchange('14');
        assert((await phone.read(NOTES.shared.key)).includes('YAZILAN-1 YAZILAN-2'), '14: yazılan metin telefona gider');
        await assertSameProject('14');
    });

    // ── 11. The desktop revokes the phone: it stops, keeps its files, pairs again. ───────
    await scenario(11, 'masaüstü telefonu iptal eder', async () => {
        const filesBefore = (await phone.files()).map((entry) => entry.path).sort();
        await desktop.openSettings();
        const revoked = await desktop.waitUntil('11: iptal düğmesi', () =>
            desktop.evaluate(`(() => {
                const button = document.querySelector('#pisi-e2e-settings [data-pisi-sync-action="revoke"]');
                if (!button) return null;
                button.click();
                return true;
            })()`)
        );
        assert(revoked, '11: iptal');
        await desktop.waitUntil('11: onay', () =>
            desktop.evaluate(`(() => { const ok = document.getElementById('pisi-confirm-ok'); if (!ok) return false; ok.click(); return true; })()`)
        );
        await desktop.waitUntil('11: cihaz iptal edildi', async () => {
            const list = await desktop.evaluate('window.pisiSyncClient.devices()');
            return list?.devices?.some((device) => !device.self && device.revokedAt) || null;
        });
        await phone.openSettings();
        await phone.syncNow('11: iptal edilen telefon');
        await phone.until('11: telefon durdu', async () => (await phone.page.locator('[data-sync="revoked"]').count()) > 0);
        assert((await phone.syncState()) === null, '11: gizli bilgi ve durum silinir');
        assert(JSON.stringify((await phone.files()).map((entry) => entry.path).sort()) === JSON.stringify(filesBefore), '11: telefonun dosyaları kalır');
        // Paired again: the phone has data, so it is asked; "add" merges with an empty base.
        await phone.page.locator('[data-sync="pair"]').tap();
        await phone.page.locator('[data-action="initial-merge"]').tap();
        await phone.page.locator('[data-action="use-code"]').tap();
        await desktop.evaluate('window.openPisiSyncPairingDialog()');
        const again = await desktop.waitUntil('11: yeni kod', () =>
            desktop.evaluate(`document.querySelector('[data-pisi-sync-pairing-code]')?.textContent || null`)
        );
        await phone.page.locator('#pair-server').fill('sync.test');
        await phone.page.locator('#pair-code').fill(again);
        await phone.page.locator('[data-action="connect"]').tap();
        await phone.page.locator('[data-pair="sas"]').waitFor();
        await desktop.waitUntil('11: masaüstünde onay', () =>
            desktop.evaluate(
                `(() => { const accept = document.querySelector('[data-pisi-sync-pairing-accept]'); if (!accept || accept.closest('[hidden]')) return false; accept.click(); return true; })()`
            )
        );
        await phone.page.locator('[data-pair="done"]').waitFor({ timeout: 60000 });
        await desktop.evaluate('window.closePisiSyncPairingDialog()');
        await phone.page.locator('[data-action="pair-done"]').tap();
        await exchange('11: yeniden eşleşme');
        assert((await phone.statusRow().getAttribute('data-state')) === 'idle', '11: telefon yeniden eşleşti');
        await assertSameProject('11');
    });

    // ── 12. The server's database goes back to an old backup: both stop, write nothing. ──
    await scenario(12, 'sunucu geri sarılır', async () => {
        const spaceId = onlySpaceId(server);
        snapshotSpace(server, spaceId);
        await desktop.openNote(NOTES.shared.key);
        await desktop.typeInBlock(blockId('a1a1', 8), ' MASAUSTU-S12');
        await desktop.flush();
        await desktop.syncOk('12');
        await phone.syncNow('12: telefon');
        const desktopBefore = await desktop.files(isSynced);
        const phoneBefore = JSON.stringify(await phone.files());
        restoreSpace(server, spaceId);
        const result = await desktop.sync();
        assert(result?.ok === false && result.code === 'SERVER_ROLLBACK', '12: masaüstü SERVER_ROLLBACK', result);
        assert((await desktop.status()).stopped === 'SERVER_ROLLBACK', '12: masaüstü durur');
        const desktopAfter = await desktop.files(isSynced);
        assert(
            desktopAfter.size === desktopBefore.size && [...desktopBefore].every(([key, bytes]) => desktopAfter.get(key)?.equals(bytes)),
            '12: masaüstünde hiçbir şey yazılmaz'
        );
        await phone.syncNow('12: telefon geri sarma');
        await phone.until('12: telefon durur', async () => (await phone.statusRow().getAttribute('data-state')) === 'stopped');
        assert((await phone.page.locator('[data-sync="stopped"]').count()) === 1, '12: telefonda uyarı');
        assert(JSON.stringify(await phone.files()) === phoneBefore, '12: telefonda hiçbir şey yazılmaz');
    });

    console.log(`[matris] geçti: ${passed.map((item) => `${item.number} (${Math.round(item.ms / 1000)} sn)`).join(', ')}`);
    console.log(`[matris] 15. her senaryodan sonra iki cihazda Project Integrity yeni bulgu vermedi (${passed.length} denetim)`);
    if (!only.length) assert(passed.length === 14, 'Matristeki 14 senaryonun hepsi çalıştı', passed);
    if (process.env.PISI_SYNC_MATRIX_REPORT) {
        await fs.mkdir(path.dirname(path.resolve(process.env.PISI_SYNC_MATRIX_REPORT)), { recursive: true });
        await fs.writeFile(
            process.env.PISI_SYNC_MATRIX_REPORT,
            JSON.stringify(
                { scenarios: passed, integrityChecks: passed.length, environment: { node: process.version, platform: `${process.platform} ${process.arch}` } },
                null,
                2
            )
        );
    }
} catch (error) {
    console.error('[matris] başarısız:', error?.stack || error);
    if (desktop) console.error(desktop.logs().slice(-6000));
    if (phone?.errors.length) console.error('[matris] telefon sayfa hataları:', phone.errors.join('\n'));
    const phpErrors = server.phpErrorLog();
    if (phpErrors) console.error('[matris] PHP hata günlüğü:', phpErrors.slice(-4000));
    process.exitCode = 1;
} finally {
    await phone?.stop();
    await desktop?.stop();
    await proxy.close();
    await server.stop();
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
