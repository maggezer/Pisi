// An in-memory Pisi Sync server for tests (docs/sync-protocol.md §5–§9): the
// same endpoints, error codes and rules the PHP server keeps — compare-and-swap
// on baseSeq, commit idempotency, DELETE_NOT_ALLOWED for members, chunked
// uploads, Range downloads, pairing and revocation. It never decrypts anything.
// `server.fetch(url, init)` answers like `fetch`; Playwright routes reach it
// through `server.handle({ method, url, headers, body })`.

import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function concat(parts) {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const LIMITS = Object.freeze({
    maxBlobBytes: 64 * 1024 * 1024,
    partBytes: 4 * 1024 * 1024,
    maxCommitChanges: 200,
    maxChangesPage: 1000,
    maxHeadsPage: 1000,
    maxRequestJsonBytes: 1048576,
    maxCheckBlobs: 500,
    pairingTtlSeconds: 600,
    spaceQuotaBytes: null
});

class HttpError extends Error {
    constructor(status, code, details = undefined, retryable = false) {
        super(code);
        this.status = status;
        this.code = code;
        this.details = details;
        this.retryable = retryable;
    }
}

function response(status, body, headers = {}) {
    const isBytes = body instanceof Uint8Array;
    const text = isBytes || body === null ? '' : JSON.stringify(body);
    const all = new Map(Object.entries({ 'content-type': isBytes ? 'application/octet-stream' : 'application/json; charset=utf-8', ...headers }));
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get: (name) => all.get(String(name).toLowerCase()) ?? null },
        text: async () => text,
        arrayBuffer: async () => (isBytes ? body.slice().buffer : new TextEncoder().encode(text).buffer)
    };
}

/** `now()` gives the server's clock (ms). */
export function createFakeSyncServer({ setupKey = 'kurulum-anahtari', now = () => Date.now() } = {}) {
    const spaces = new Map();
    const devicesByToken = new Map();
    const pairings = new Map();
    const requests = [];
    let offline = false;
    const iso = () => new Date(now()).toISOString();

    function makeCode() {
        const bytes = randomBytes(8);
        const code = Array.from(bytes, (byte) => ALPHABET[byte % 32]).join('');
        return `${code.slice(0, 4)}-${code.slice(4)}`;
    }
    const normalizeCode = (value) =>
        String(value || '')
            .toUpperCase()
            .replace(/-/g, '');

    function authDevice(headers, spaceId = null) {
        const header = headers.authorization || '';
        if (!header.startsWith('Bearer ')) throw new HttpError(401, 'AUTH_REQUIRED');
        const device = devicesByToken.get(sha256Hex(header.slice(7)));
        if (!device) throw new HttpError(401, 'TOKEN_INVALID');
        if (device.revokedAt) throw new HttpError(403, 'DEVICE_REVOKED');
        if (spaceId && device.spaceId !== spaceId) throw new HttpError(404, 'NOT_FOUND');
        device.lastSeenAt = iso();
        return device;
    }
    const requireAdmin = (device) => {
        if (device.role !== 'admin') throw new HttpError(403, 'FORBIDDEN_ROLE');
    };
    const spaceOf = (id) => {
        const space = spaces.get(id);
        if (!space) throw new HttpError(404, 'NOT_FOUND');
        return space;
    };

    function deviceView(device) {
        return {
            deviceId: device.deviceId,
            role: device.role,
            label: device.label,
            createdAt: device.createdAt,
            lastSeenAt: device.lastSeenAt,
            lastProtocol: 1,
            revokedAt: device.revokedAt
        };
    }

    function commit(space, device, body) {
        const changes = body.changes;
        if (!Array.isArray(changes) || !changes.length) throw new HttpError(400, 'INVALID_FIELD', { field: 'changes' });
        if (changes.length > LIMITS.maxCommitChanges) throw new HttpError(422, 'BATCH_TOO_LARGE');
        if (new Set(changes.map((change) => change.fid)).size !== changes.length) throw new HttpError(422, 'DUPLICATE_FID');
        if (device.role !== 'admin' && changes.some((change) => change.op === 'delete')) throw new HttpError(403, 'DELETE_NOT_ALLOWED');
        const bodyHash = sha256Hex(JSON.stringify(body));
        const previous = space.commits.get(body.commitId);
        if (previous) {
            if (previous.bodyHash !== bodyHash || previous.deviceId !== device.deviceId) throw new HttpError(409, 'COMMIT_ID_REUSED');
            return { commitId: body.commitId, seqs: previous.seqs, head: space.head };
        }
        const stale = changes
            .map((change) => ({ fid: change.fid, baseSeq: change.baseSeq, headSeq: space.heads.get(change.fid)?.seq ?? 0 }))
            .filter((entry) => entry.baseSeq !== entry.headSeq);
        if (stale.length) throw new HttpError(409, 'STALE_BASE', { head: space.head, stale }, true);
        for (const change of changes) {
            const head = space.heads.get(change.fid);
            if (change.op === 'delete' && (!head || head.op === 'delete')) throw new HttpError(422, 'INVALID_CHANGE');
            if (change.op === 'put') {
                const blob = space.blobs.get(change.blob);
                if (!blob) throw new HttpError(422, 'BLOB_MISSING');
                if (blob.length !== change.size) throw new HttpError(422, 'SIZE_MISMATCH');
            }
        }
        const seqs = [];
        for (const change of changes) {
            space.head += 1;
            const row = {
                seq: space.head,
                fid: change.fid,
                op: change.op,
                blob: change.op === 'put' ? change.blob : null,
                size: change.op === 'put' ? change.size : 0,
                device: device.deviceId,
                commit: body.commitId,
                at: iso(),
                meta: change.meta
            };
            space.changes.push(row);
            space.heads.set(change.fid, row);
            seqs.push(row.seq);
        }
        space.commits.set(body.commitId, { bodyHash, deviceId: device.deviceId, seqs });
        return { commitId: body.commitId, seqs, head: space.head };
    }

    function pairingFor(id) {
        const pairing = pairings.get(id);
        if (!pairing) throw new HttpError(404, 'PAIRING_NOT_FOUND');
        if (['open', 'claimed', 'granted'].includes(pairing.state) && now() > pairing.expiresAt) pairing.state = 'expired';
        return pairing;
    }

    async function route({ method, path, query, headers, body, bytes }) {
        let match;
        if (method === 'GET' && path === '/v1/info')
            return [200, { service: 'pisi-sync', protocol: { min: 1, max: 1, revision: 1 }, limits: LIMITS, time: iso() }];
        if (headers['pisi-sync-protocol'] !== '1') throw new HttpError(426, 'PROTOCOL_UNSUPPORTED', { min: 1, max: 1 });

        if (method === 'POST' && path === '/v1/spaces') {
            if (headers['pisi-setup-key'] !== setupKey) throw new HttpError(403, 'SETUP_KEY_INVALID');
            if (spaces.has(body.spaceId)) throw new HttpError(409, 'ID_TAKEN');
            const space = {
                spaceId: body.spaceId,
                name: body.spaceName,
                head: 0,
                prunedThrough: 0,
                changes: [],
                heads: new Map(),
                blobs: new Map(),
                uploads: new Map(),
                commits: new Map(),
                devices: new Map()
            };
            spaces.set(space.spaceId, space);
            addDevice(space, { deviceId: body.deviceId, role: 'admin', tokenHash: body.tokenHash, label: body.deviceLabel });
            return [201, { spaceId: space.spaceId, deviceId: body.deviceId, role: 'admin', head: 0, createdAt: iso() }];
        }
        if (method === 'POST' && path === '/v1/pairings/lookup') {
            const code = normalizeCode(body.code);
            const pairing = [...pairings.values()].find((entry) => entry.state === 'open' && entry.code === code && now() <= entry.expiresAt);
            if (!pairing) throw new HttpError(404, 'PAIRING_NOT_FOUND');
            return [
                200,
                { pairingId: pairing.pairingId, spaceId: pairing.spaceId, desktopKey: pairing.desktopKey, expiresAt: new Date(pairing.expiresAt).toISOString() }
            ];
        }
        if ((match = /^\/v1\/pairings\/(pr_[\w-]+)\/claim$/.exec(path)) && method === 'POST') {
            const pairing = pairingFor(match[1]);
            if (pairing.state === 'expired') throw new HttpError(410, 'PAIRING_EXPIRED');
            if (pairing.state !== 'open') throw new HttpError(409, 'PAIRING_STATE', { state: pairing.state });
            if (body.method === 'code' && normalizeCode(body.code) !== pairing.code) {
                pairing.failed += 1;
                if (pairing.failed >= 5) pairing.state = 'expired';
                throw new HttpError(403, 'PAIRING_CODE_INVALID');
            }
            Object.assign(pairing, {
                state: 'claimed',
                method: body.method,
                deviceKey: body.deviceKey,
                proof: body.proof,
                label: body.label,
                tokenHash: body.tokenHash,
                code: null
            });
            return [202, { state: 'claimed', expiresAt: new Date(pairing.expiresAt).toISOString() }];
        }
        if ((match = /^\/v1\/pairings\/(pr_[\w-]+)\/result$/.exec(path)) && method === 'GET') {
            const pairing = pairingFor(match[1]);
            const header = headers.authorization || '';
            if (!header.startsWith('Bearer ')) throw new HttpError(401, 'AUTH_REQUIRED');
            if (sha256Hex(header.slice(7)) !== pairing.tokenHash) throw new HttpError(401, 'TOKEN_INVALID');
            if (pairing.state === 'claimed') return [202, { state: 'claimed' }];
            if (pairing.state === 'rejected') throw new HttpError(403, 'PAIRING_REJECTED');
            if (pairing.state === 'expired') throw new HttpError(410, 'PAIRING_EXPIRED');
            if (pairing.state !== 'granted') throw new HttpError(409, 'PAIRING_STATE', { state: pairing.state });
            const wrappedKey = pairing.wrappedKey;
            pairing.state = 'collected';
            pairing.wrappedKey = null;
            return [
                200,
                { state: 'granted', spaceId: pairing.spaceId, deviceId: pairing.deviceId, role: pairing.role, wrappedKey, desktopKey: pairing.desktopKey }
            ];
        }

        match = /^\/v1\/spaces\/(sp_[\w-]+)(\/.*)?$/.exec(path);
        if (!match) throw new HttpError(404, 'NOT_FOUND');
        const device = authDevice(headers, match[1]);
        const space = spaceOf(match[1]);
        const rest = match[2] || '';

        if (method === 'GET' && rest === '')
            return [200, { spaceId: space.spaceId, spaceName: space.name, keyEpoch: 1, head: space.head, prunedThrough: space.prunedThrough }];
        if (method === 'GET' && rest === '/head') return [200, { head: space.head, prunedThrough: space.prunedThrough }];
        if (method === 'GET' && rest === '/changes') {
            const after = Number(query.get('after') || 0);
            if (after < space.prunedThrough) throw new HttpError(410, 'CURSOR_EXPIRED', undefined, true);
            const limit = Math.min(Number(query.get('limit') || LIMITS.maxChangesPage), LIMITS.maxChangesPage);
            const rows = space.changes.filter((row) => row.seq > after);
            let page = rows.slice(0, limit);
            // A page never ends inside a commit.
            while (page.length < rows.length && rows[page.length].commit === page.at(-1)?.commit) page = rows.slice(0, page.length + 1);
            return [200, { changes: page, head: space.head, more: page.length < rows.length }];
        }
        if (method === 'GET' && rest === '/heads') {
            const after = query.get('after') || '';
            const limit = Math.min(Number(query.get('limit') || LIMITS.maxHeadsPage), LIMITS.maxHeadsPage);
            const all = [...space.heads.values()].sort((a, b) => (a.fid < b.fid ? -1 : 1)).filter((row) => row.fid > after);
            const page = all.slice(0, limit).map(({ commit: _commit, ...row }) => row);
            return [200, { asOfSeq: space.head, heads: page, next: all.length > limit ? page.at(-1).fid : null }];
        }
        if (method === 'POST' && rest === '/commit') return [200, commit(space, device, body)];
        if (method === 'POST' && rest === '/blobs/check') return [200, { missing: body.blobs.filter((blob) => !space.blobs.has(blob)) }];
        if ((match = /^\/blobs\/(b_[\w-]+)\/uploads$/.exec(rest)) && method === 'POST') {
            if (space.blobs.has(match[1])) return [200, { exists: true }];
            if (body.size > LIMITS.maxBlobBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE');
            const uploadId = `up_${randomBytes(16).toString('base64url')}`;
            const parts = Math.max(1, Math.ceil(body.size / LIMITS.partBytes));
            space.uploads.set(uploadId, { blob: match[1], size: body.size, sha256: body.sha256, parts, received: new Map() });
            return [201, { uploadId, partBytes: LIMITS.partBytes, parts, expiresAt: new Date(now() + 86400000).toISOString() }];
        }
        if ((match = /^\/uploads\/(up_[\w-]+)\/parts\/(\d+)$/.exec(rest)) && method === 'PUT') {
            const upload = space.uploads.get(match[1]);
            if (!upload) throw new HttpError(404, 'UPLOAD_NOT_FOUND');
            if (sha256Hex(bytes) !== headers['pisi-part-sha256']) throw new HttpError(422, 'HASH_MISMATCH', undefined, true);
            upload.received.set(Number(match[2]), bytes);
            return [200, { part: Number(match[2]), received: [...upload.received.values()].reduce((sum, part) => sum + part.length, 0) }];
        }
        if ((match = /^\/uploads\/(up_[\w-]+)\/complete$/.exec(rest)) && method === 'POST') {
            const upload = space.uploads.get(match[1]);
            if (!upload) throw new HttpError(404, 'UPLOAD_NOT_FOUND');
            const missing = [];
            for (let part = 1; part <= upload.parts; part += 1) if (!upload.received.has(part)) missing.push(part);
            if (missing.length) throw new HttpError(422, 'UPLOAD_INCOMPLETE', { missing }, true);
            const joined = concat([...Array(upload.parts)].map((_, at) => upload.received.get(at + 1)));
            space.uploads.delete(match[1]);
            if (joined.length !== upload.size || sha256Hex(joined) !== upload.sha256) throw new HttpError(422, 'HASH_MISMATCH', undefined, true);
            space.blobs.set(upload.blob, joined);
            return [201, { blob: upload.blob, size: joined.length }];
        }
        if ((match = /^\/blobs\/(b_[\w-]+)$/.exec(rest)) && method === 'GET') {
            const blob = space.blobs.get(match[1]);
            if (!blob) throw new HttpError(404, 'BLOB_NOT_FOUND');
            const range = /^bytes=(\d+)-(\d+)$/.exec(headers.range || '');
            if (range) {
                const end = Math.min(Number(range[2]), blob.length - 1);
                return [206, blob.slice(Number(range[1]), end + 1), { 'content-range': `bytes ${range[1]}-${end}/${blob.length}` }];
            }
            return [200, blob, { 'pisi-blob-sha256': sha256Hex(blob) }];
        }
        if (method === 'GET' && rest === '/devices') {
            requireAdmin(device);
            return [200, { devices: [...space.devices.values()].map(deviceView) }];
        }
        if (method === 'GET' && rest === '/devices/me') return [200, deviceView(device)];
        if ((match = /^\/devices\/(me|dv_[\w-]+)$/.exec(rest)) && method === 'DELETE') {
            const target = match[1] === 'me' ? device : space.devices.get(match[1]);
            if (!target) throw new HttpError(404, 'NOT_FOUND');
            if (target !== device) requireAdmin(device);
            // The last active admin cannot leave (protocol §6.5).
            const admins = [...space.devices.values()].filter((other) => other.role === 'admin' && !other.revokedAt);
            if (!target.revokedAt && target.role === 'admin' && admins.length === 1) throw new HttpError(409, 'LAST_ADMIN');
            target.revokedAt = target.revokedAt || iso();
            return [204, null];
        }
        if (method === 'DELETE' && rest === '') {
            // Deleting the whole space (§6.2): its tokens get TOKEN_INVALID from now on.
            requireAdmin(device);
            if (body.confirm !== space.spaceId) throw new HttpError(400, 'INVALID_FIELD', { field: 'confirm' });
            for (const member of space.devices.values()) devicesByToken.delete(member.tokenHash);
            spaces.delete(space.spaceId);
            return [204, null];
        }
        if (method === 'POST' && rest === '/pairings') {
            requireAdmin(device);
            const code = makeCode();
            pairings.set(body.pairingId, {
                pairingId: body.pairingId,
                spaceId: space.spaceId,
                deviceId: body.deviceId,
                desktopKey: body.desktopKey,
                code: normalizeCode(code),
                state: 'open',
                failed: 0,
                expiresAt: now() + LIMITS.pairingTtlSeconds * 1000
            });
            return [201, { pairingId: body.pairingId, code, expiresAt: new Date(now() + LIMITS.pairingTtlSeconds * 1000).toISOString() }];
        }
        if ((match = /^\/pairings\/(pr_[\w-]+)(\/grant|\/reject)?$/.exec(rest))) {
            requireAdmin(device);
            const pairing = pairingFor(match[1]);
            if (method === 'GET' && !match[2]) {
                const { pairingId, state, method: way, deviceKey, proof, label } = pairing;
                return [200, { pairingId, state, method: way, deviceKey, proof, label, expiresAt: new Date(pairing.expiresAt).toISOString() }];
            }
            if (method === 'POST' && match[2] === '/grant') {
                if (pairing.state !== 'claimed') throw new HttpError(409, 'PAIRING_STATE', { state: pairing.state });
                Object.assign(pairing, { state: 'granted', role: body.role, wrappedKey: body.wrappedKey, expiresAt: now() + LIMITS.pairingTtlSeconds * 1000 });
                addDevice(space, { deviceId: pairing.deviceId, role: body.role, tokenHash: pairing.tokenHash, label: body.label });
                return [200, { state: 'granted', deviceId: pairing.deviceId }];
            }
            if (method === 'POST' && match[2] === '/reject') {
                pairing.state = 'rejected';
                return [200, { state: 'rejected' }];
            }
            if (method === 'DELETE' && !match[2]) {
                if (['open', 'claimed'].includes(pairing.state)) pairing.state = 'cancelled';
                return [204, null];
            }
        }
        throw new HttpError(404, 'NOT_FOUND');
    }

    function addDevice(space, { deviceId, role, tokenHash, label }) {
        const device = { deviceId, spaceId: space.spaceId, role, tokenHash, label, createdAt: iso(), lastSeenAt: null, revokedAt: null };
        space.devices.set(deviceId, device);
        devicesByToken.set(tokenHash, device);
    }

    /** One request: `{ method, url, headers, body }` (body: string, bytes or null). Resolves a Response-like object. */
    async function handle({ method, url, headers = {}, body = null }) {
        const parsed = new URL(url);
        const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
        if (lower.authorization === undefined && lower['x-pisi-token']) lower.authorization = `Bearer ${lower['x-pisi-token']}`;
        const at = parsed.pathname.indexOf('/v1/');
        const path = at >= 0 ? parsed.pathname.slice(at) : parsed.pathname;
        const isJson = typeof body === 'string';
        const record = { method, path, query: parsed.search, body: isJson ? body : null };
        requests.push(record);
        try {
            let json = null;
            if (isJson && body) {
                try {
                    json = JSON.parse(body);
                } catch {
                    throw new HttpError(400, 'INVALID_JSON');
                }
            }
            const bytes = body instanceof Uint8Array ? body : body?.buffer ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : null;
            const [status, out, extra] = await route({ method, path, query: parsed.searchParams, headers: lower, body: json ?? {}, bytes });
            return response(status, out, extra);
        } catch (error) {
            if (!(error instanceof HttpError)) throw error;
            const payload = { error: { code: error.code, message: error.code, retryable: error.retryable } };
            if (error.details) payload.error.details = error.details;
            return response(error.status, payload);
        }
    }

    return {
        setupKey,
        requests,
        spaces,
        /** A fetch for the shared HTTP client. `server.offline = true` makes every request fail like a dead network. */
        async fetch(url, init = {}) {
            if (offline) throw new TypeError('Failed to fetch');
            return handle({ method: init.method || 'GET', url: String(url), headers: init.headers || {}, body: init.body ?? null });
        },
        handle,
        set offline(value) {
            offline = Boolean(value);
        },
        get offline() {
            return offline;
        },
        /** Every commit body the server accepted or refused, parsed. */
        commits: () => requests.filter((request) => request.method === 'POST' && /\/commit$/.test(request.path)).map((request) => JSON.parse(request.body)),
        /**
         * A database backup of every space as it is now. Calling the returned function puts the
         * server back to it: head, log, heads and commit records (docs/sync-plan.md S7 scenario 12).
         */
        snapshot() {
            const saved = [...spaces.values()].map((space) => ({
                space,
                head: space.head,
                prunedThrough: space.prunedThrough,
                changes: [...space.changes],
                heads: new Map(space.heads),
                commits: new Map(space.commits)
            }));
            return () => {
                for (const { space, ...state } of saved) Object.assign(space, state);
            };
        },
        /** Revokes a device directly, as the desktop's device list would. */
        revoke(deviceId) {
            for (const space of spaces.values()) {
                const device = space.devices.get(deviceId);
                if (device) device.revokedAt = iso();
            }
        }
    };
}
