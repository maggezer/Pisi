import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

// Automatic project backups outside the project folder: names, retention,
// folder rules, what is left out, and a small ZIP writer and reader (deflate,
// no ZIP64). No Electron; runs in the project read worker and in tests.

export const PISI_BACKUP_DAILY_MS = 24 * 60 * 60 * 1000;
export const PISI_BACKUP_STALE_MS = 3 * 24 * 60 * 60 * 1000;
export const PISI_BACKUP_KEEP_DAYS = 14;
export const PISI_BACKUP_KEEP_WEEKS = 8;
const PISI_ZIP_MAX_ENTRIES = 65535;
const PISI_ZIP_MAX_BYTES = 0xffffffff;

function pad(value) {
    return String(value).padStart(2, '0');
}

/** A file-name safe project name (letters of any script, digits, space, - and _). */
export function sanitizePisiBackupProjectName(name) {
    const clean = String(name || 'Proje')
        .normalize('NFC')
        .replace(/[^\p{L}\p{N} _-]+/gu, '-')
        .replace(/\s+/g, ' ')
        .replace(/-+/g, '-')
        .trim()
        .slice(0, 60);
    return clean || 'Proje';
}

/** Pisi-<proje>-YYYY-MM-DD-HHmm.zip (local time). */
export function formatPisiBackupFileName(projectName, time) {
    const date = new Date(time);
    const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
    return `Pisi-${sanitizePisiBackupProjectName(projectName)}-${stamp}.zip`;
}

/** { time } for a backup of `projectName`, or null for any other file. */
export function parsePisiBackupFileName(fileName, projectName) {
    const prefix = `Pisi-${sanitizePisiBackupProjectName(projectName)}-`;
    const name = String(fileName || '');
    if (!name.startsWith(prefix) || !name.endsWith('.zip')) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?:-\d+)?\.zip$/.exec(name.slice(prefix.length));
    if (!match) return null;
    const time = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])).getTime();
    return Number.isFinite(time) ? { time } : null;
}

function isoWeekKey(time) {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    const week1 = new Date(date.getFullYear(), 0, 4);
    const week = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
    return `${date.getFullYear()}-W${week}`;
}

/**
 * Which backups to keep: every backup of the last 14 days, plus the newest
 * backup of each of the last 8 ISO weeks. Files that are not this project's
 * Pisi backups are never touched.
 * @returns {{ keep: string[], remove: string[] }}
 */
export function selectPisiBackupRetention(fileNames, projectName, now, options = {}) {
    const days = options.days ?? PISI_BACKUP_KEEP_DAYS;
    const weeks = options.weeks ?? PISI_BACKUP_KEEP_WEEKS;
    const backups = fileNames
        .map((name) => ({ name, parsed: parsePisiBackupFileName(name, projectName) }))
        .filter((item) => item.parsed)
        .sort((a, b) => b.parsed.time - a.parsed.time);
    const dayLimit = now - days * PISI_BACKUP_DAILY_MS;
    const weekLimit = now - weeks * 7 * PISI_BACKUP_DAILY_MS;
    const keep = new Set();
    const weeksSeen = new Set();
    for (const item of backups) {
        if (item.parsed.time >= dayLimit) keep.add(item.name);
        const week = isoWeekKey(item.parsed.time);
        if (item.parsed.time >= weekLimit && !weeksSeen.has(week)) {
            weeksSeen.add(week);
            keep.add(item.name);
        }
    }
    return {
        keep: backups.filter((item) => keep.has(item.name)).map((item) => item.name),
        remove: backups.filter((item) => !keep.has(item.name)).map((item) => item.name)
    };
}

function isSameOrInside(parent, child) {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * A backup folder must be outside the project and must not contain it.
 * Pass real paths (fs.realpath) so links cannot hide the relation.
 */
export function validatePisiBackupFolder(folder, projectFolder) {
    if (!folder) return { ok: false, code: 'BACKUP_FOLDER_MISSING', error: 'Yedek klasörü seçilmedi.' };
    const target = path.resolve(folder);
    const project = path.resolve(projectFolder);
    const compare = (value) => (process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value);
    if (isSameOrInside(compare(project), compare(target)))
        return { ok: false, code: 'BACKUP_FOLDER_INSIDE_PROJECT', error: 'Yedek klasörü projenin içinde olamaz.' };
    if (isSameOrInside(compare(target), compare(project)))
        return { ok: false, code: 'BACKUP_FOLDER_CONTAINS_PROJECT', error: 'Yedek klasörü projeyi içeren bir klasör olamaz.' };
    return { ok: true, folder: target };
}

/** Left out of backups: version history, in-flight journals, atomic copies, the lock and temporary files. */
export function isPisiBackupExcluded(relativePath) {
    const parts = String(relativePath || '')
        .split(/[\\/]+/)
        .filter(Boolean);
    if (!parts.length) return true;
    const first = parts[0].toLowerCase();
    if (first === '.pisi-history' || first === '.git' || first === 'node_modules' || first === '.pisi.lock') return true;
    if (first === '.pisi' && ['mutations', 'backups'].includes(String(parts[1] || '').toLowerCase())) return true;
    const last = parts[parts.length - 1];
    if (/\.tmp$|\.pisi-backup$|^\.DS_Store$|^Thumbs\.db$|^~\$/i.test(last)) return true;
    return parts.some((part) => /^\.pisi-(?:delete|transaction)-/i.test(part));
}

export function isPisiBackupDue(lastSuccessAt, now) {
    const last = Date.parse(String(lastSuccessAt || ''));
    return !Number.isFinite(last) || now - last >= PISI_BACKUP_DAILY_MS;
}

export function isPisiBackupStale(lastSuccessAt, now) {
    const last = Date.parse(String(lastSuccessAt || ''));
    return !Number.isFinite(last) || now - last > PISI_BACKUP_STALE_MS;
}

/** A ZIP entry name that stays inside the target folder. */
export function isSafePisiZipEntryName(name) {
    const value = String(name || '');
    if (!value || value.length > 1024 || value.includes('\0') || value.includes('\\')) return false;
    if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
    return value.split('/').every((part) => part !== '..' && part !== '.') && !value.split('/').slice(0, -1).includes('');
}

let crcTable = null;
function crc32(buffer) {
    if (!crcTable) {
        crcTable = Array.from({ length: 256 }, (_unused, index) => {
            let value = index;
            for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
            return value >>> 0;
        });
    }
    let crc = 0xffffffff;
    for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(time) {
    const date = new Date(time);
    const dosTimeValue = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { dosTimeValue, dosDate };
}

/** Lists the files of `root` to back up (relative paths with forward slashes), sorted. */
export async function listPisiBackupFiles(root) {
    const files = [];
    const visit = async (directory, prefix) => {
        let entries = [];
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink()) continue;
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (isPisiBackupExcluded(relative)) continue;
            if (entry.isDirectory()) await visit(path.join(directory, entry.name), relative);
            else if (entry.isFile()) files.push(relative);
        }
    };
    await visit(path.resolve(root), '');
    return files.sort();
}

/**
 * Writes a deflate ZIP of `root` to `outputPath` (through `outputPath.tmp`,
 * renamed at the end, so a cut-off backup never looks complete).
 * @returns {Promise<{ files: number, bytes: number, outputPath: string }>}
 */
export async function writePisiProjectBackupZip(root, outputPath, options = {}) {
    const files = await listPisiBackupFiles(root);
    if (files.length > PISI_ZIP_MAX_ENTRIES) throw new Error('Proje tek bir yedek dosyası için çok fazla dosya içeriyor.');
    const tempPath = `${outputPath}.tmp`;
    const handle = await fs.open(tempPath, 'w');
    const central = [];
    let offset = 0;
    try {
        for (const [index, relative] of files.entries()) {
            if (options.shouldStop?.()) throw new Error('Yedekleme durduruldu.');
            const fullPath = path.join(root, ...relative.split('/'));
            const [data, stat] = await Promise.all([fs.readFile(fullPath), fs.stat(fullPath)]);
            const compressed = zlib.deflateRawSync(data, { level: 6 });
            const name = Buffer.from(relative, 'utf8');
            const crc = crc32(data);
            const { dosTimeValue, dosDate } = dosTime(stat.mtimeMs);
            const local = Buffer.alloc(30);
            local.writeUInt32LE(0x04034b50, 0);
            local.writeUInt16LE(20, 4);
            local.writeUInt16LE(0x0800, 6);
            local.writeUInt16LE(8, 8);
            local.writeUInt16LE(dosTimeValue, 10);
            local.writeUInt16LE(dosDate, 12);
            local.writeUInt32LE(crc, 14);
            local.writeUInt32LE(compressed.length, 18);
            local.writeUInt32LE(data.length, 22);
            local.writeUInt16LE(name.length, 26);
            await handle.write(Buffer.concat([local, name, compressed]));
            const header = Buffer.alloc(46);
            header.writeUInt32LE(0x02014b50, 0);
            header.writeUInt16LE(20, 4);
            header.writeUInt16LE(20, 6);
            header.writeUInt16LE(0x0800, 8);
            header.writeUInt16LE(8, 10);
            header.writeUInt16LE(dosTimeValue, 12);
            header.writeUInt16LE(dosDate, 14);
            header.writeUInt32LE(crc, 16);
            header.writeUInt32LE(compressed.length, 20);
            header.writeUInt32LE(data.length, 24);
            header.writeUInt16LE(name.length, 28);
            header.writeUInt32LE(offset, 42);
            central.push(Buffer.concat([header, name]));
            offset += local.length + name.length + compressed.length;
            if (offset > PISI_ZIP_MAX_BYTES) throw new Error('Proje tek bir yedek dosyası için çok büyük (4 GB).');
            options.onProgress?.(index + 1, files.length);
        }
        const directory = Buffer.concat(central);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(central.length, 8);
        end.writeUInt16LE(central.length, 10);
        end.writeUInt32LE(directory.length, 12);
        end.writeUInt32LE(offset, 16);
        await handle.write(Buffer.concat([directory, end]));
        await handle.sync();
    } catch (error) {
        await handle.close().catch(() => {});
        await fs.rm(tempPath, { force: true });
        throw error;
    }
    await handle.close();
    await fs.rename(tempPath, outputPath);
    return { files: files.length, bytes: offset, outputPath };
}

/** The entries of a ZIP written by writePisiProjectBackupZip (or any plain deflate/stored ZIP). */
export async function readPisiZipEntries(zipPath) {
    const buffer = await fs.readFile(zipPath);
    const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (endOffset < 0) throw new Error('Geçerli bir ZIP dosyası değil.');
    const count = buffer.readUInt16LE(endOffset + 10);
    let pointer = buffer.readUInt32LE(endOffset + 16);
    const entries = [];
    for (let index = 0; index < count; index += 1) {
        if (buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error('ZIP dizini bozuk.');
        const method = buffer.readUInt16LE(pointer + 10);
        const compressedSize = buffer.readUInt32LE(pointer + 20);
        const size = buffer.readUInt32LE(pointer + 24);
        const nameLength = buffer.readUInt16LE(pointer + 28);
        const extraLength = buffer.readUInt16LE(pointer + 30);
        const commentLength = buffer.readUInt16LE(pointer + 32);
        const externalAttributes = buffer.readUInt32LE(pointer + 38);
        const localOffset = buffer.readUInt32LE(pointer + 42);
        const name = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8');
        pointer += 46 + nameLength + extraLength + commentLength;
        const localNameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        entries.push({ name, method, size, compressedSize, start, isSymlink: ((externalAttributes >>> 16) & 0o170000) === 0o120000 });
    }
    return { buffer, entries };
}

/**
 * Extracts a backup ZIP into `target`, which must not exist yet (it is
 * created). Unsafe names, links and unknown compression stop the whole
 * restore before anything is written.
 * @returns {Promise<{ files: number, target: string }>}
 */
export async function extractPisiBackupZip(zipPath, target) {
    const { buffer, entries } = await readPisiZipEntries(zipPath);
    for (const entry of entries) {
        if (!isSafePisiZipEntryName(entry.name.replace(/\/$/, '')) || entry.isSymlink)
            throw new Error(`Yedekte güvenli olmayan bir dosya yolu var: ${entry.name}`);
        if (entry.method !== 0 && entry.method !== 8) throw new Error('Yedek desteklenmeyen bir sıkıştırma kullanıyor.');
    }
    await fs.mkdir(target, { recursive: false });
    let files = 0;
    for (const entry of entries) {
        const destination = path.join(target, ...entry.name.split('/').filter(Boolean));
        if (entry.name.endsWith('/')) {
            await fs.mkdir(destination, { recursive: true });
            continue;
        }
        const raw = buffer.subarray(entry.start, entry.start + entry.compressedSize);
        const data = entry.method === 8 ? zlib.inflateRawSync(raw) : raw;
        if (data.length !== entry.size) throw new Error(`Yedekteki dosya bozuk: ${entry.name}`);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, data, { flag: 'wx' });
        files += 1;
    }
    return { files, target };
}
