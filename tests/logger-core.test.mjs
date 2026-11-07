import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    createPisiLogger,
    createPisiRateLimiter,
    formatPisiLogLine,
    getPisiLogDate,
    listExpiredPisiLogFiles,
    listRecentPisiLogFiles,
    parsePisiLogFileName,
    redactPisiLogPaths,
    sanitizePisiLogContext
} from '../main/functions/logger-core.js';

const DAY = 24 * 60 * 60 * 1000;
const noon = (date) => new Date(`${date}T12:00:00`).getTime();

function tempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-logger-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function readLines(dir, name) {
    return fs
        .readFileSync(path.join(dir, name), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
}

test('a line is one JSON object with time, level, module, message and stack', () => {
    const error = new Error('Disk dolu');
    const line = JSON.parse(formatPisiLogLine({ time: Date.UTC(2026, 10, 7, 10), level: 'error', module: 'documentStore', message: 'Kayıt başarısız', error }));
    assert.equal(line.time, '2026-11-07T10:00:00.000Z');
    assert.equal(line.level, 'error');
    assert.equal(line.module, 'documentStore');
    assert.equal(line.message, 'Kayıt başarısız Error: Disk dolu');
    assert.match(line.stack, /Disk dolu/);
    assert.equal(JSON.parse(formatPisiLogLine({ time: 0, level: 'nope', message: 'x' })).level, 'info');
    assert.equal(JSON.parse(formatPisiLogLine({ time: 0, level: 'info', message: 'x'.repeat(5000) })).message.length, 2000);
});

test('privacy: project paths become relative, home and other paths are masked', () => {
    const roots = { projectFolder: '/home/ayse/Notlar', appRoot: '/opt/Pisi/resources/app', homeDir: '/home/ayse' };
    assert.equal(redactPisiLogPaths('Kaydedilemedi: /home/ayse/Notlar/Proje/rapor.node', roots), 'Kaydedilemedi: Proje/rapor.node');
    assert.equal(redactPisiLogPaths('at file:///opt/Pisi/resources/app/renderer/editor/x.mjs:10:5', roots), 'at app:/renderer/editor/x.mjs:10:5');
    assert.equal(redactPisiLogPaths('okunamadı /home/ayse/Belgeler/gizli/maaş.xlsx', roots), 'okunamadı <home>/…/maaş.xlsx');
    assert.equal(redactPisiLogPaths('EACCES: /var/lib/other/secret.txt', roots), 'EACCES: <path>/secret.txt');
    assert.equal(redactPisiLogPaths('C:\\Users\\Ayse\\Desktop\\x.node açılamadı', {}), '<path>/x.node açılamadı');
    assert.equal(redactPisiLogPaths('see https://example.com/a/b', roots), 'see https://example.com/a/b', 'URLs are not paths');
    assert.equal(redactPisiLogPaths('Proje/rapor.node', roots), 'Proje/rapor.node', 'relative paths stay');
    const winRoots = { projectFolder: 'D:\\Notlar' };
    assert.equal(redactPisiLogPaths('D:\\Notlar\\a\\b.node', winRoots), 'a\\b.node');
});

test('privacy: content-like context fields are dropped, only short primitives kept', () => {
    const context = sanitizePisiLogContext(
        { code: 'EACCES', attempt: 2, content: '<p>gizli not</p>', html: '<b>x</b>', text: 'metin', nested: { a: 1 }, filePath: '/home/ayse/Notlar/a.node' },
        { projectFolder: '/home/ayse/Notlar' }
    );
    assert.deepEqual(context, { code: 'EACCES', attempt: 2, filePath: 'a.node' });
    assert.equal(sanitizePisiLogContext({ content: 'x' }), undefined);
    const line = formatPisiLogLine({ time: 0, level: 'warn', message: 'm', context: { body: 'gizli', reason: 'r' } });
    assert.doesNotMatch(line, /gizli/);
});

test('file names, dates and 14-day retention', () => {
    assert.deepEqual(parsePisiLogFileName('pisi-2026-11-07.log'), { date: '2026-11-07', part: 0 });
    assert.deepEqual(parsePisiLogFileName('pisi-2026-11-07.3.log'), { date: '2026-11-07', part: 3 });
    assert.equal(parsePisiLogFileName('notes.log'), null);
    const now = noon('2026-11-14');
    assert.equal(getPisiLogDate(now), '2026-11-14');
    const names = ['pisi-2026-10-31.log', 'pisi-2026-11-01.log', 'pisi-2026-11-01.1.log', 'pisi-2026-11-14.log', 'other.txt'];
    assert.deepEqual(listExpiredPisiLogFiles(names, now, 14), ['pisi-2026-10-31.log'], '14 days = Nov 1 … Nov 14');
    assert.deepEqual(listRecentPisiLogFiles(['pisi-2026-11-11.log', 'pisi-2026-11-12.log', 'pisi-2026-11-14.log', 'x.log'], now, 3), [
        'pisi-2026-11-14.log',
        'pisi-2026-11-12.log'
    ]);
});

test('the logger rotates by size and stops at the daily part limit', (t) => {
    const dir = tempDir(t);
    const time = noon('2026-11-07');
    const logger = createPisiLogger({ directory: () => dir, now: () => time, maxBytes: 400, maxParts: 3 });
    for (let index = 0; index < 40; index += 1) logger.info('test', `satır ${index} ${'x'.repeat(60)}`);
    const files = fs.readdirSync(dir).sort();
    assert.deepEqual(files, ['pisi-2026-11-07.1.log', 'pisi-2026-11-07.2.log', 'pisi-2026-11-07.log']);
    for (const name of files) assert.ok(fs.statSync(path.join(dir, name)).size <= 400 + 200, `${name} stays near the limit`);
    const last = readLines(dir, 'pisi-2026-11-07.2.log').at(-1);
    assert.equal(last.module, 'logger');
    assert.match(last.message, /sınırı aşıldı/);
    assert.equal(logger.info('test', 'daha fazla'), false, 'full day writes nothing');
});

test('the logger continues an existing file, opens a new one each day and prunes old files', (t) => {
    const dir = tempDir(t);
    fs.writeFileSync(path.join(dir, 'pisi-2026-10-01.log'), '{}\n');
    fs.writeFileSync(path.join(dir, 'pisi-2026-11-07.log'), '{"time":"x"}\n');
    let time = noon('2026-11-07');
    const logger = createPisiLogger({ directory: () => dir, now: () => time });
    logger.warn('a', 'bir');
    assert.equal(fs.existsSync(path.join(dir, 'pisi-2026-10-01.log')), false, 'files older than 14 days are deleted');
    assert.equal(readLines(dir, 'pisi-2026-11-07.log').length, 2, 'appends to today');
    time += DAY;
    logger.error('b', 'iki', new Error('e'));
    assert.equal(readLines(dir, 'pisi-2026-11-08.log')[0].level, 'error');
});

test('the logger never throws when the disk fails', () => {
    const logger = createPisiLogger({
        directory: () => {
            throw new Error('no disk');
        }
    });
    assert.equal(logger.error('x', 'y'), false);
});

test('rate limiter: 20 per minute, the dropped count is reported once in the next window', () => {
    const limiter = createPisiRateLimiter(20, 60000);
    const results = Array.from({ length: 30 }, (_value, index) => limiter.take(1000 + index));
    assert.equal(results.filter((result) => result.allowed).length, 20);
    assert.equal(limiter.pending(), 10);
    const next = limiter.take(61001);
    assert.deepEqual(next, { allowed: true, suppressed: 10 });
    assert.equal(limiter.take(61002).suppressed, 0);
});
