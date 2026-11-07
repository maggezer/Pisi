import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    extractPisiBackupZip,
    formatPisiBackupFileName,
    isPisiBackupDue,
    isPisiBackupExcluded,
    isPisiBackupStale,
    isSafePisiZipEntryName,
    listPisiBackupFiles,
    parsePisiBackupFileName,
    readPisiZipEntries,
    sanitizePisiBackupProjectName,
    selectPisiBackupRetention,
    validatePisiBackupFolder,
    writePisiProjectBackupZip
} from '../main/functions/external-backup-core.js';

const DAY = 24 * 60 * 60 * 1000;
const at = (text) => new Date(text).getTime();

test('backup file names: Pisi-<proje>-YYYY-MM-DD-HHmm.zip, project names made file-safe', () => {
    assert.equal(formatPisiBackupFileName('Notlarım', at('2026-11-07T09:05:00')), 'Pisi-Notlarım-2026-11-07-0905.zip');
    assert.equal(sanitizePisiBackupProjectName('İş/Proje: 2026?'), 'İş-Proje- 2026-');
    assert.equal(sanitizePisiBackupProjectName(''), 'Proje');
    assert.deepEqual(parsePisiBackupFileName('Pisi-Notlarım-2026-11-07-0905.zip', 'Notlarım'), { time: at('2026-11-07T09:05:00') });
    assert.ok(parsePisiBackupFileName('Pisi-Notlarım-2026-11-07-0905-2.zip', 'Notlarım'), 'a same-minute duplicate is still recognised');
    assert.equal(parsePisiBackupFileName('Pisi-Başka-2026-11-07-0905.zip', 'Notlarım'), null, 'other projects are not ours');
    assert.equal(parsePisiBackupFileName('rapor.zip', 'Notlarım'), null);
});

test('retention: everything from the last 14 days plus the newest of each of the last 8 weeks', () => {
    const now = at('2026-11-30T12:00:00');
    const names = [];
    for (let day = 0; day < 90; day += 1) names.push(formatPisiBackupFileName('P', now - day * DAY));
    names.push('notlar.txt', formatPisiBackupFileName('Başka', now - 100 * DAY));
    const { keep, remove } = selectPisiBackupRetention(names, 'P', now);
    const keptDays = keep.map((name) => Math.round((now - parsePisiBackupFileName(name, 'P').time) / DAY));
    for (let day = 0; day <= 14; day += 1) assert.ok(keptDays.includes(day), `day ${day} is kept`);
    const weekly = keptDays.filter((day) => day > 14);
    assert.ok(weekly.length >= 5 && weekly.length <= 7, `one per week beyond 14 days (${weekly})`);
    assert.ok(
        weekly.every((day) => day <= 56),
        'nothing older than 8 weeks'
    );
    assert.ok(!remove.includes('notlar.txt') && !keep.includes('notlar.txt'), 'other files are never touched');
    assert.ok(!remove.some((name) => name.includes('Başka')), 'other projects are never touched');
    assert.equal(keep.length + remove.length, 90);
});

test('the backup folder must be outside the project and must not contain it', () => {
    const project = path.join(os.tmpdir(), 'Projeler', 'Notlar');
    assert.equal(validatePisiBackupFolder(path.join(os.tmpdir(), 'Yedekler'), project).ok, true);
    assert.equal(validatePisiBackupFolder(project, project).code, 'BACKUP_FOLDER_INSIDE_PROJECT');
    assert.equal(validatePisiBackupFolder(path.join(project, 'yedek'), project).code, 'BACKUP_FOLDER_INSIDE_PROJECT');
    assert.equal(validatePisiBackupFolder(path.join(os.tmpdir(), 'Projeler'), project).code, 'BACKUP_FOLDER_CONTAINS_PROJECT');
    assert.equal(validatePisiBackupFolder(path.join(os.tmpdir(), 'Projeler', 'Notlar2'), project).ok, true, 'a sibling with a longer name is fine');
    assert.equal(validatePisiBackupFolder('', project).code, 'BACKUP_FOLDER_MISSING');
});

test('excluded: history, journals, atomic copies, the lock and temporary files', () => {
    for (const excluded of [
        '.pisi-history/n/a.json.gz',
        '.pisi/mutations/mut_1/journal.json',
        '.pisi/backups/x.pisi-backup',
        '.pisi.lock',
        'A.node.pisi-backup',
        'nd_x/.A.node.1.abc.tmp',
        '.pisi-delete-1/x.node',
        '.git/HEAD',
        '~$rapor.docx'
    ]) {
        assert.equal(isPisiBackupExcluded(excluded), true, excluded);
    }
    for (const included of [
        'A.node',
        'Harita.map',
        '.pisi/tasks.json',
        '.pisi/relationships.json',
        '.pisi/trash/items/x/manifest.json',
        '.pisi-views.json',
        'nd_x/inv_y/image.png'
    ]) {
        assert.equal(isPisiBackupExcluded(included), false, included);
    }
});

test('due once a day, stale after three days', () => {
    const now = at('2026-11-07T12:00:00');
    assert.equal(isPisiBackupDue(null, now), true);
    assert.equal(isPisiBackupDue(new Date(now - 23 * 3600 * 1000).toISOString(), now), false);
    assert.equal(isPisiBackupDue(new Date(now - 25 * 3600 * 1000).toISOString(), now), true);
    assert.equal(isPisiBackupStale(new Date(now - 2 * DAY).toISOString(), now), false);
    assert.equal(isPisiBackupStale(new Date(now - 3 * DAY - 1000).toISOString(), now), true);
    assert.equal(isPisiBackupStale(null, now), true);
});

test('ZIP entry names that would leave the target are refused', () => {
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\b', 'a//b', '', './a']) assert.equal(isSafePisiZipEntryName(bad), false, bad);
    for (const good of ['A.node', 'nd_x/inv_y/image.png', '.pisi/tasks.json']) assert.equal(isSafePisiZipEntryName(good), true, good);
});

test('integration: the ZIP holds the project without excluded files and restores byte for byte into a new folder', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-backup-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const project = path.join(root, 'Notlar');
    const write = (relative, content) => {
        const target = path.join(project, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    };
    write('A.node', JSON.stringify({ pisi: { id: 'node_a', title: 'A' }, content: '<p>Öğrenci ğüşıöç</p>' }));
    write('Harita.map', JSON.stringify({ pisi: { id: 'map_1' }, map: { nodes: [] } }));
    write('.pisi/tasks.json', JSON.stringify({ tasks: [{ id: 't1' }] }));
    write('nd_Harita__map_1/inv_A__node_a/image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    write('.pisi-history/node_a/1.json.gz', 'history');
    write('.pisi/mutations/mut_1/journal.json', '{}');
    write('.pisi.lock', '{}');
    write('nd_Harita__map_1/.A.node.1.x.tmp', 'tmp');
    write('Büyük.node', JSON.stringify({ pisi: { id: 'node_b' }, content: 'x'.repeat(300000) }));

    const zipPath = path.join(root, 'Pisi-Notlar-2026-11-07-1200.zip');
    const result = await writePisiProjectBackupZip(project, zipPath);
    assert.equal(fs.existsSync(`${zipPath}.tmp`), false, 'the temporary file is renamed');
    const { entries } = await readPisiZipEntries(zipPath);
    const names = entries.map((entry) => entry.name).sort();
    assert.deepEqual(names, ['.pisi/tasks.json', 'A.node', 'Büyük.node', 'Harita.map', 'nd_Harita__map_1/inv_A__node_a/image.png']);
    assert.equal(result.files, 5);
    assert.ok(fs.statSync(zipPath).size < 300000 / 10, 'contents are compressed');
    assert.deepEqual(await listPisiBackupFiles(project), names);

    const target = path.join(root, 'Notlar (yedek)');
    const extracted = await extractPisiBackupZip(zipPath, target);
    assert.equal(extracted.files, 5);
    for (const name of names) assert.deepEqual(fs.readFileSync(path.join(target, name)), fs.readFileSync(path.join(project, name)), name);
    await assert.rejects(() => extractPisiBackupZip(zipPath, target), /EEXIST/, 'an existing folder is never overwritten');
});

test('integration: a ZIP with a path outside the target is refused before anything is written', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-backup-evil-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const project = path.join(root, 'p');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'ok.node'), '{}');
    const zipPath = path.join(root, 'evil.zip');
    await writePisiProjectBackupZip(project, zipPath);
    // Rewrite the stored name "ok.node" to "../x.node" (same length + 2 → patch in place with a same-length name).
    const buffer = fs.readFileSync(zipPath);
    const patched = Buffer.from(buffer.toString('latin1').replaceAll('ok.node', '../ok.n'), 'latin1');
    fs.writeFileSync(zipPath, patched);
    const target = path.join(root, 'restore');
    await assert.rejects(() => extractPisiBackupZip(zipPath, target), /güvenli olmayan/);
    assert.equal(fs.existsSync(target), false, 'nothing was created');
    assert.equal(fs.existsSync(path.join(root, 'ok.n')), false);
});
