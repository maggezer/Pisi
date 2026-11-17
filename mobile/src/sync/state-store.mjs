// Device state of Pisi Sync on the phone (docs/sync-plan.md §3.2, §3.8, rules
// SV1, SV2). It lives outside the project, in Directory.Data/sync/:
//   current.json             which space this phone is bound to
//   <space>/state.json       server, device, cursor, index, dseq, conflict log …
//   <space>/base/<hex>       last synced content of mergeable files (text)
// The token and the project key never go into these files: `secrets`
// (platform/secrets.mjs, the Android Keystore plugin) keeps them, wrapped.
// An unreadable state file is never replaced; the user is told to pair again
// (docs/sync-protocol.md §10). Project files are never touched here.

import { fromBase64Url, toBase64Url, utf8Decode, utf8Encode } from '../../../shared/sync-crypto.mjs';
import { joinKey, parentKey } from '../data/drivers/keys.mjs';
import { readTextOrNull } from '../data/json-file.mjs';

export const PISI_MOBILE_SYNC_STATE_VERSION = 1;
export const PISI_MOBILE_SYNC_CONFLICT_LOG_LIMIT = 200;
const CURRENT_KEY = 'current.json';

export class PisiSyncStateError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'PisiSyncStateError';
        this.code = code;
    }
}

/** A fresh state for a phone bound to a space; the same fields as the desktop's, without a project path. */
export function makeMobileSyncState({ serverUrl, spaceId, deviceId, role, spaceName = '', deviceName = '', now = new Date() }) {
    return {
        stateVersion: PISI_MOBILE_SYNC_STATE_VERSION,
        serverUrl,
        spaceId,
        deviceId,
        role,
        spaceName,
        deviceName,
        createdAt: now.toISOString(),
        limits: null,
        cursor: 0,
        dseq: 0,
        lastDseq: {},
        index: {},
        hashCache: {},
        remoteOnly: {},
        pendingRemote: [],
        pendingCommit: null,
        conflicts: [],
        issues: [],
        lastRun: null,
        stopped: null
    };
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function validState(value, spaceId) {
    if (!isPlainObject(value) || value.stateVersion !== PISI_MOBILE_SYNC_STATE_VERSION || value.spaceId !== spaceId) return false;
    for (const key of ['serverUrl', 'deviceId', 'role']) if (typeof value[key] !== 'string') return false;
    if (!Number.isSafeInteger(value.cursor) || !Number.isSafeInteger(value.dseq)) return false;
    return isPlainObject(value.index) && isPlainObject(value.lastDseq);
}

const hexOf = (text) => Array.from(utf8Encode(text), (byte) => byte.toString(16).padStart(2, '0')).join('');
const secretName = (spaceId) => `sync-${spaceId}`;

/**
 * `driver` is a StorageDriver rooted at the sync folder (not the project);
 * `secrets` is `{ get(name), put(name, value), remove(name) }`; `makeToken()`
 * names temporary files.
 */
export function createSyncStateStore({ driver, secrets, makeToken }) {
    let spaceId = null;

    async function writeAtomic(key, text) {
        const parent = parentKey(key);
        if (parent) await driver.mkdir(parent);
        const temp = `${key}.${makeToken()}.tmp`;
        try {
            await driver.writeText(temp, text);
            await driver.rename(temp, key);
        } catch (error) {
            await driver.remove(temp).catch(() => {});
            throw error;
        }
    }

    async function removeTree(key) {
        const stat = await driver.stat(key);
        if (!stat) return;
        if (stat.type === 'file') return driver.remove(key);
        for (const entry of await driver.list(key)) await removeTree(joinKey(key, entry.name));
        await driver.removeDirectory(key);
    }

    async function readCurrent() {
        const text = await readTextOrNull(driver, CURRENT_KEY);
        if (text === null) return null;
        try {
            const value = JSON.parse(text);
            return typeof value?.spaceId === 'string' ? value.spaceId : null;
        } catch {
            return null;
        }
    }

    const at = (name) => joinKey(spaceId, name);
    const baseKey = (fid) => at(`base/${hexOf(String(fid))}`);
    const requireSpace = () => {
        if (!spaceId) throw new PisiSyncStateError('NOT_CONFIGURED', 'Senkron bağlı değil.');
    };

    return {
        /** The space this phone is bound to, or null. Reads `current.json` once. */
        async getSpaceId() {
            if (!spaceId) spaceId = await readCurrent();
            return spaceId;
        },

        /** The state, or null when not bound. Throws STATE_UNREADABLE for a broken file (it stays on disk). */
        async load() {
            if (!(await this.getSpaceId())) return null;
            const text = await readTextOrNull(driver, at('state.json'));
            if (text === null) return null;
            let value;
            try {
                value = JSON.parse(text);
            } catch {
                throw new PisiSyncStateError('STATE_UNREADABLE', 'Senkron durumu okunamadı.');
            }
            if (!validState(value, spaceId)) throw new PisiSyncStateError('STATE_UNREADABLE', 'Senkron durumu okunamadı.');
            for (const key of ['hashCache', 'remoteOnly']) if (!isPlainObject(value[key])) value[key] = {};
            for (const key of ['conflicts', 'issues', 'pendingRemote']) if (!Array.isArray(value[key])) value[key] = [];
            return value;
        },

        async save(state) {
            requireSpace();
            if (state.conflicts.length > PISI_MOBILE_SYNC_CONFLICT_LOG_LIMIT) state.conflicts = state.conflicts.slice(-PISI_MOBILE_SYNC_CONFLICT_LOG_LIMIT);
            await writeAtomic(at('state.json'), JSON.stringify(state));
        },

        async readSecrets() {
            requireSpace();
            const raw = await secrets.get(secretName(spaceId));
            if (raw === null || raw === undefined) return null;
            try {
                const value = JSON.parse(raw);
                const key = fromBase64Url(value.key);
                if (typeof value.token !== 'string' || !value.token || key.length !== 32) throw new Error('invalid');
                return { token: value.token, key };
            } catch {
                throw new PisiSyncStateError('SECRETS_UNREADABLE', 'Senkron anahtarı açılamadı.');
            }
        },

        async readBase(fid) {
            requireSpace();
            const text = await readTextOrNull(driver, baseKey(fid));
            return text === null ? null : utf8Encode(text);
        },
        async writeBase(fid, bytes) {
            requireSpace();
            await writeAtomic(baseKey(fid), utf8Decode(bytes));
        },
        async removeBase(fid) {
            requireSpace();
            await driver.remove(baseKey(fid));
        },

        /** Binds the phone to a space: secrets first, then the state, then `current.json` (SV2). */
        async bind(state, { token, key }) {
            spaceId = state.spaceId;
            await secrets.put(secretName(spaceId), JSON.stringify({ v: 1, token, key: toBase64Url(key) }));
            await writeAtomic(at('state.json'), JSON.stringify(state));
            await writeAtomic(CURRENT_KEY, JSON.stringify({ v: 1, spaceId }));
        },

        /** Removes the binding, the secrets and every state file of the space (unpaired, revoked). Project files stay. */
        async destroy() {
            const current = await this.getSpaceId();
            await driver.remove(CURRENT_KEY);
            if (current) {
                await secrets.remove(secretName(current));
                await removeTree(current);
            }
            spaceId = null;
        }
    };
}
