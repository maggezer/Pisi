// Device state of Pisi Sync on the desktop (docs/sync-plan.md §3.2, rules SV1, SV2).
// Everything lives in the app's user data folder, never in the project:
//   <root>/<projectKey>/state.json   binding, cursor, index, dseq, conflict log …
//   <root>/<projectKey>/secrets.json token and project key, sealed by the caller
//                                    (Electron safeStorage on the desktop)
//   <root>/<projectKey>/base/<hex>   last synced content of mergeable files
// An unreadable state file is never replaced: the caller tells the user to
// pair again (docs/sync-protocol.md §10). The project files are never touched here.
// Writes use fs/promises (temp file + rename) so they stay outside the atomic
// mutation hooks, which only cover project paths.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const PISI_SYNC_STATE_VERSION = 1;
export const PISI_SYNC_CONFLICT_LOG_LIMIT = 200;

export class PisiSyncStateError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'PisiSyncStateError';
        this.code = code;
    }
}

/** Key of a project folder in the user data folder; case folded where the file system folds case. */
export function getPisiSyncProjectKey(projectPath, platform = process.platform) {
    const resolved = path.resolve(String(projectPath || ''));
    const folded = platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved;
    return crypto.createHash('sha256').update(folded).digest('hex').slice(0, 32);
}

/** A fresh state for a project bound to a space. */
export function makePisiSyncState({ projectPath, serverUrl, spaceId, deviceId, role, spaceName = '', deviceName = '', limits = null, now = new Date() }) {
    return {
        stateVersion: PISI_SYNC_STATE_VERSION,
        projectPath: path.resolve(projectPath),
        serverUrl,
        spaceId,
        deviceId,
        role,
        spaceName,
        deviceName,
        createdAt: now.toISOString(),
        limits,
        cursor: 0,
        dseq: 0,
        lastDseq: {},
        index: {},
        hashCache: {},
        pendingRemote: [],
        pendingCommit: null,
        conflicts: [],
        issues: [],
        lastRun: null,
        stopped: null
    };
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateState(value) {
    if (!isPlainObject(value) || value.stateVersion !== PISI_SYNC_STATE_VERSION) return false;
    for (const key of ['serverUrl', 'spaceId', 'deviceId', 'role', 'projectPath']) if (typeof value[key] !== 'string') return false;
    if (!Number.isSafeInteger(value.cursor) || !Number.isSafeInteger(value.dseq)) return false;
    return isPlainObject(value.index) && isPlainObject(value.lastDseq);
}

async function writeFileAtomic(filePath, data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, data, { mode: 0o600 });
    await fs.rename(temp, filePath);
}

async function readOptional(filePath) {
    try {
        return await fs.readFile(filePath);
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

/**
 * The state store of one project. `secrets` seals and opens the secret
 * strings: `{ seal(text) → string, open(text) → string, weak: boolean }`.
 */
export function createPisiSyncStateStore({ root, projectPath, secrets, platform = process.platform }) {
    const projectKey = getPisiSyncProjectKey(projectPath, platform);
    const dir = path.join(root, projectKey);
    const statePath = path.join(dir, 'state.json');
    const secretsPath = path.join(dir, 'secrets.json');
    const basePath = (fid) => path.join(dir, 'base', Buffer.from(String(fid), 'utf8').toString('hex'));

    return {
        projectKey,
        dir,
        async exists() {
            return (await readOptional(statePath)) !== null;
        },
        /** The state, or null when the project is not bound. Throws STATE_UNREADABLE for a broken file. */
        async load() {
            const raw = await readOptional(statePath);
            if (raw === null) return null;
            let value;
            try {
                value = JSON.parse(raw.toString('utf8'));
            } catch {
                throw new PisiSyncStateError('STATE_UNREADABLE', 'Senkron durumu okunamadı.');
            }
            if (!validateState(value)) throw new PisiSyncStateError('STATE_UNREADABLE', 'Senkron durumu okunamadı.');
            for (const key of ['hashCache', 'conflicts', 'issues', 'pendingRemote']) if (value[key] === undefined) value[key] = key === 'hashCache' ? {} : [];
            return value;
        },
        async save(state) {
            if (state.conflicts.length > PISI_SYNC_CONFLICT_LOG_LIMIT) state.conflicts = state.conflicts.slice(-PISI_SYNC_CONFLICT_LOG_LIMIT);
            await writeFileAtomic(statePath, JSON.stringify(state));
        },
        async readSecrets() {
            const raw = await readOptional(secretsPath);
            if (raw === null) return null;
            try {
                const value = JSON.parse(raw.toString('utf8'));
                const token = secrets.open(value.token);
                const key = Buffer.from(secrets.open(value.key), 'base64');
                if (!token || key.length !== 32) throw new Error('invalid');
                return { token, key: new Uint8Array(key) };
            } catch {
                throw new PisiSyncStateError('SECRETS_UNREADABLE', 'Senkron anahtarı açılamadı.');
            }
        },
        async writeSecrets({ token, key }) {
            const value = { v: 1, token: secrets.seal(token), key: secrets.seal(Buffer.from(key).toString('base64')) };
            await writeFileAtomic(secretsPath, JSON.stringify(value));
        },
        async readBase(fid) {
            const raw = await readOptional(basePath(fid));
            return raw === null ? null : new Uint8Array(raw);
        },
        async writeBase(fid, bytes) {
            await writeFileAtomic(basePath(fid), Buffer.from(bytes));
        },
        async removeBase(fid) {
            await fs.rm(basePath(fid), { force: true });
        },
        /** Removes the whole device state of this project (disconnect, revoked). Project files stay. */
        async destroy() {
            await fs.rm(dir, { recursive: true, force: true });
        }
    };
}
