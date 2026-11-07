import * as fs from 'node:fs';
import * as path from 'node:path';

// Local diagnostic log: one JSON object per line in <directory>/pisi-YYYY-MM-DD.log.
// Files rotate by size (pisi-DATE.1.log …) and are kept for a fixed number of
// days. Nothing is sent anywhere. Messages pass a privacy filter: absolute
// paths become project-relative (or masked), and context fields that may carry
// note or file content are dropped. No Electron; unit-tested with a temp dir.

export const PISI_LOG_MAX_BYTES = 2 * 1024 * 1024;
export const PISI_LOG_MAX_PARTS_PER_DAY = 5;
export const PISI_LOG_RETENTION_DAYS = 14;
export const PISI_LOG_MAX_MESSAGE = 2000;
export const PISI_LOG_MAX_STACK = 8000;
export const PISI_LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error', 'fatal']);
const PISI_LOG_FILE_PATTERN = /^pisi-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;
const PISI_LOG_CONTENT_KEYS = /^(content|html|text|body|data|markdown|value|payload|snapshot)$/i;

function pad(value) {
    return String(value).padStart(2, '0');
}

/** Local calendar date of `time` as YYYY-MM-DD. */
export function getPisiLogDate(time) {
    const date = new Date(time);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getPisiLogFileName(date, part = 0) {
    return part > 0 ? `pisi-${date}.${part}.log` : `pisi-${date}.log`;
}

/** { date, part } of a log file name, or null for other files. */
export function parsePisiLogFileName(name) {
    const match = PISI_LOG_FILE_PATTERN.exec(String(name || ''));
    return match ? { date: match[1], part: Number(match[2] || 0) } : null;
}

/** Log files older than `retentionDays` (the day of `now` counts as day 1). */
export function listExpiredPisiLogFiles(names, now, retentionDays = PISI_LOG_RETENTION_DAYS) {
    const cutoff = new Date(now);
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (retentionDays - 1));
    const oldest = getPisiLogDate(cutoff.getTime());
    return names.filter((name) => {
        const parsed = parsePisiLogFileName(name);
        return parsed && parsed.date < oldest;
    });
}

/** Log files whose date is within the last `days` days (newest first). */
export function listRecentPisiLogFiles(names, now, days) {
    const keep = new Set(names.filter((name) => parsePisiLogFileName(name)).filter((name) => !listExpiredPisiLogFiles([name], now, days).length));
    return [...keep].sort().reverse();
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes absolute paths from text. Inside the project the path becomes
 * project-relative; the app folder becomes "app:"; the home folder keeps only
 * the file name ("<home>/…/name"); any other absolute path becomes "<path>/name".
 * @param {string} text
 * @param {{ projectFolder?: string|null, appRoot?: string|null, homeDir?: string|null }} [roots]
 */
export function redactPisiLogPaths(text, roots = {}) {
    let value = String(text ?? '');
    const replaceRoot = (root, replacement) => {
        if (!root) return;
        const normalized = String(root).replace(/[\\/]+$/, '');
        if (normalized.length < 2) return;
        for (const variant of new Set([normalized, normalized.replace(/\\/g, '/'), `file://${normalized.replace(/\\/g, '/')}`])) {
            value = value.replace(new RegExp(escapeRegExp(variant) + '(?=[\\\\/]|\\b|$)', 'g'), replacement);
        }
    };
    // file:///… URLs first, then the longest roots first.
    value = value.replace(/file:\/\/(?=\/)/g, '');
    const roots2 = [
        [roots.projectFolder, '<project>'],
        [roots.appRoot, 'app:'],
        [roots.homeDir, '<home>']
    ]
        .filter(([root]) => root)
        .sort((a, b) => String(b[0]).length - String(a[0]).length);
    for (const [root, replacement] of roots2) replaceRoot(root, replacement);
    // <project>/a/b.node → a/b.node ; <home>/x/y/z.txt → <home>/…/z.txt
    value = value.replace(/<project>[\\/]/g, '');
    value = value.replace(/<home>((?:[\\/][^\\/\s'"`:)]+)+)/g, (_match, rest) => `<home>/…/${rest.split(/[\\/]/).pop()}`);
    // Remaining absolute paths: POSIX (/a/b) and Windows (C:\a\b).
    value = value.replace(/(?<![\w:.<>/-])(?:[A-Za-z]:[\\/]|\/(?!\/))(?:[^\\/\s'"`:)]+[\\/])+([^\\/\s'"`:)]+)/g, '<path>/$1');
    return value;
}

/** Shallow context with content-like fields dropped and only primitives kept. */
export function sanitizePisiLogContext(context, roots = {}) {
    if (!context || typeof context !== 'object') return undefined;
    const result = {};
    for (const [key, raw] of Object.entries(context).slice(0, 20)) {
        if (PISI_LOG_CONTENT_KEYS.test(key)) continue;
        if (raw === null || typeof raw === 'number' || typeof raw === 'boolean') result[key] = raw;
        else if (typeof raw === 'string') result[key] = redactPisiLogPaths(raw, roots).slice(0, 300);
    }
    return Object.keys(result).length ? result : undefined;
}

function describeError(error) {
    if (!error) return { message: '', stack: '' };
    if (error instanceof Error) return { message: `${error.name || 'Error'}: ${error.message}`, stack: String(error.stack || '') };
    if (typeof error === 'object')
        return { message: String(error.message || error.reason || JSON.stringify(error).slice(0, 500)), stack: String(error.stack || '') };
    return { message: String(error), stack: '' };
}

/**
 * One log line (without the trailing newline).
 * @param {{ time: number, level: string, module?: string, message?: unknown, error?: unknown, stack?: string, context?: object }} entry
 */
export function formatPisiLogLine(entry, roots = {}) {
    const level = PISI_LOG_LEVELS.includes(entry.level) ? entry.level : 'info';
    const described = describeError(entry.error);
    const baseMessage = entry.message instanceof Error ? describeError(entry.message).message : String(entry.message ?? '');
    const message = [baseMessage, entry.message instanceof Error ? '' : described.message].filter(Boolean).join(' ');
    const stack = typeof entry.stack === 'string' ? entry.stack : entry.message instanceof Error ? describeError(entry.message).stack : described.stack;
    const line = {
        time: new Date(entry.time).toISOString(),
        level,
        module: String(entry.module || 'main').slice(0, 80),
        message: redactPisiLogPaths(message, roots).slice(0, PISI_LOG_MAX_MESSAGE)
    };
    if (stack) line.stack = redactPisiLogPaths(stack, roots).slice(0, PISI_LOG_MAX_STACK);
    const context = sanitizePisiLogContext(entry.context, roots);
    if (context) line.context = context;
    return JSON.stringify(line);
}

/**
 * Fixed-window rate limiter: at most `limit` events per `windowMs`. `take`
 * returns { allowed, suppressed } where `suppressed` is the number dropped in
 * the previous window (reported once, when the next window opens).
 */
export function createPisiRateLimiter(limit = 20, windowMs = 60000) {
    let windowStart = -Infinity;
    let used = 0;
    let dropped = 0;
    return {
        take(now) {
            let suppressed = 0;
            if (now - windowStart >= windowMs) {
                suppressed = dropped;
                windowStart = now;
                used = 0;
                dropped = 0;
            }
            if (used < limit) {
                used += 1;
                return { allowed: true, suppressed };
            }
            dropped += 1;
            return { allowed: false, suppressed };
        },
        pending() {
            return dropped;
        }
    };
}

/**
 * A file logger. Never throws: a failing disk only loses log lines.
 * @param {{ directory: () => string, now?: () => number, maxBytes?: number, maxParts?: number,
 *   retentionDays?: number, roots?: () => object }} options
 */
export function createPisiLogger(options) {
    const now = options.now || (() => Date.now());
    const maxBytes = options.maxBytes || PISI_LOG_MAX_BYTES;
    const maxParts = options.maxParts || PISI_LOG_MAX_PARTS_PER_DAY;
    const retentionDays = options.retentionDays || PISI_LOG_RETENTION_DAYS;
    const state = { date: '', part: 0, size: 0, full: false, cleanedFor: '' };

    function directory() {
        const dir = options.directory();
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    function prune(dir, time) {
        const date = getPisiLogDate(time);
        if (state.cleanedFor === date) return;
        state.cleanedFor = date;
        for (const name of listExpiredPisiLogFiles(fs.readdirSync(dir), time, retentionDays)) {
            try {
                fs.rmSync(path.join(dir, name), { force: true });
            } catch {
                // Keep logging even if an old file cannot be removed.
            }
        }
    }

    function openDay(dir, date) {
        if (state.date === date) return;
        state.date = date;
        state.full = false;
        const parts = fs
            .readdirSync(dir)
            .map(parsePisiLogFileName)
            .filter((parsed) => parsed && parsed.date === date)
            .map((parsed) => parsed.part);
        state.part = parts.length ? Math.max(...parts) : 0;
        try {
            state.size = fs.statSync(path.join(dir, getPisiLogFileName(date, state.part))).size;
        } catch {
            state.size = 0;
        }
    }

    function write(entry) {
        try {
            const time = now();
            const dir = directory();
            prune(dir, time);
            openDay(dir, getPisiLogDate(time));
            if (state.full) return false;
            let line = formatPisiLogLine({ ...entry, time }, options.roots?.() || {}) + '\n';
            if (state.size > 0 && state.size + Buffer.byteLength(line) > maxBytes) {
                if (state.part + 1 >= maxParts) {
                    state.full = true;
                    line =
                        formatPisiLogLine({
                            time,
                            level: 'warn',
                            module: 'logger',
                            message: 'Günlük kayıt sınırı aşıldı; bugünkü sonraki kayıtlar yazılmayacak.'
                        }) + '\n';
                    fs.appendFileSync(path.join(dir, getPisiLogFileName(state.date, state.part)), line, 'utf8');
                    return false;
                }
                state.part += 1;
                state.size = 0;
            }
            fs.appendFileSync(path.join(dir, getPisiLogFileName(state.date, state.part)), line, 'utf8');
            state.size += Buffer.byteLength(line);
            return true;
        } catch {
            return false;
        }
    }

    const log = (level) => (module, message, error, context) => write({ level, module, message, error, context });
    return {
        write,
        debug: log('debug'),
        info: log('info'),
        warn: log('warn'),
        error: log('error'),
        fatal: log('fatal'),
        directory
    };
}
