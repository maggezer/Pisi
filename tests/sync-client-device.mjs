// A Pisi Sync device for tests: the desktop's engine (main/functions/sync-client-*.js)
// on a temporary project folder and a temporary state folder, talking to a test
// server (scripts/start-sync-test-server.mjs) or to any `fetchImpl`.
// Every request body the device sends is kept in `device.requests` so tests can
// scan them for plain paths, titles and content (docs/sync-plan.md S3).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPisiSyncEngine } from '../main/functions/sync-client-engine.js';
import { createPisiSyncProjectFiles } from '../main/functions/sync-client-files.js';
import { createPisiSyncHttp } from '../main/functions/sync-client-http.js';
import {
    claimPisiSyncPairingWithCode,
    createPisiSyncSpace,
    grantPisiSyncPairing,
    pollPisiSyncJoinResult,
    pollPisiSyncPairing,
    startPisiSyncPairing
} from '../main/functions/sync-client-pairing.js';
import { createPisiSyncStateStore, makePisiSyncState } from '../main/functions/sync-client-state.js';
import { openPisiSyncSpaceKeys } from '../shared/sync-crypto.mjs';

export const subtle = globalThis.crypto.subtle;
const random = (n) => new Uint8Array(crypto.randomBytes(n));
const plainSecrets = { seal: (text) => Buffer.from(text, 'utf8').toString('base64'), open: (text) => Buffer.from(text, 'base64').toString('utf8'), weak: true };

/** `https://127.0.0.1:port` of a test server: the client sends it as loopback http. */
export const serverUrlOf = (server) => server.baseUrl.replace(/^http:/, 'https:');

export function makeTempDir(prefix) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

/**
 * A device. `project` is the project folder (created when missing).
 * Options: `name`, `files` (adapter options), `isDirty`, `fetchImpl`.
 */
/**
 * @param {any} server
 * @param {{ name?: string, project?: string, files?: any, isDirty?: (path: string) => boolean, fetchImpl?: any }} [options]
 * @returns {any}
 */
export function createTestDevice(
    server,
    { name = 'Masaüstü', project = makeTempDir('pisi-sync-project-'), files: fileOptions = {}, isDirty = (_path) => false, fetchImpl } = {}
) {
    fs.mkdirSync(project, { recursive: true });
    const stateRoot = makeTempDir('pisi-sync-state-');
    const requests = [];
    const applied = [];
    const http = createPisiSyncHttp({
        baseUrl: serverUrlOf(server),
        allowLoopbackHttp: true,
        fetchImpl,
        sleep: async () => {},
        onRequest: (request) => requests.push(request)
    });
    const store = createPisiSyncStateStore({ root: stateRoot, projectPath: project, secrets: plainSecrets });
    const files = createPisiSyncProjectFiles(project, fileOptions);
    const device = {
        name,
        project,
        stateRoot,
        requests,
        applied,
        http,
        store,
        files,
        dirty: new Set(),
        write(relative, content) {
            const absolute = path.join(project, ...relative.split('/'));
            fs.mkdirSync(path.dirname(absolute), { recursive: true });
            fs.writeFileSync(absolute, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
            // A new mtime well in the past keeps the hash cache honest about real changes only.
            const past = new Date(Date.now() - 10000 - Math.floor(Math.random() * 1000));
            fs.utimesSync(absolute, past, past);
        },
        read(relative) {
            const absolute = path.join(project, ...relative.split('/'));
            return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null;
        },
        readJson(relative) {
            const text = device.read(relative);
            return text === null ? null : JSON.parse(text);
        },
        remove(relative) {
            fs.rmSync(path.join(project, ...relative.split('/')), { recursive: true, force: true });
        },
        list() {
            const out = [];
            const walk = (dir) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) walk(full);
                    else out.push(path.relative(project, full).split(path.sep).join('/'));
                }
            };
            walk(project);
            return out.sort();
        }
    };
    device.engine = createPisiSyncEngine({
        subtle,
        http,
        store,
        files,
        isDirty: (relative) => device.dirty.has(relative) || isDirty(relative),
        random,
        uuid: () => crypto.randomUUID(),
        onApplied: (change) => applied.push(change)
    });
    device.sync = (reason = 'test') => device.engine.runTurn({ reason });
    return device;
}

/** Opens a space with the test server's setup key and binds the device's project to it. */
export async function createSpaceFor(server, device, { spaceName = 'Pisi Projem' } = {}) {
    const created = await createPisiSyncSpace({
        subtle,
        http: device.http,
        setupKey: server.setupKey,
        spaceName,
        deviceName: device.name,
        platform: 'linux',
        random
    });
    await bind(server, device, { ...created, spaceName });
    return created;
}

async function bind(server, device, { spaceId, deviceId, token, key, role, spaceName }) {
    await device.store.writeSecrets({ token, key });
    await device.store.save(
        makePisiSyncState({ projectPath: device.project, serverUrl: serverUrlOf(server), spaceId, deviceId, role, spaceName, deviceName: device.name })
    );
    device.http.setToken(token);
    device.spaceId = spaceId;
    device.deviceId = deviceId;
    device.token = token;
    device.key = key;
    device.role = role;
    device.keys = await openPisiSyncSpaceKeys(subtle, key, spaceId);
}

/** Pairs `joiner` (a second desktop, code path) through `admin`; both see the same verification number. */
export async function joinWithCode(server, admin, joiner, { platform = 'linux' } = {}) {
    const state = await admin.store.load();
    const started = await startPisiSyncPairing({ subtle, http: admin.http, serverUrl: state.serverUrl, spaceId: state.spaceId, random });
    const claimed = await claimPisiSyncPairingWithCode({ subtle, http: joiner.http, code: started.view.code, deviceName: joiner.name, platform, random });
    const view = await pollPisiSyncPairing({ subtle, http: admin.http, session: started.session });
    if (view.sas !== claimed.view.sas) throw new Error('doğrulama numaraları farklı');
    const secrets = await admin.store.readSecrets();
    await grantPisiSyncPairing({
        subtle,
        http: admin.http,
        session: started.session,
        keys: admin.keys,
        projectKey: secrets.key,
        spaceName: state.spaceName,
        random
    });
    const result = await pollPisiSyncJoinResult({ subtle, http: joiner.http, session: claimed.session });
    await bind(server, joiner, { ...result, spaceName: result.spaceName });
    return { view, result };
}

export const nodeDoc = (id, title, blocks, extra = {}) => ({
    pisi: {
        version: 1,
        type: 'node',
        id,
        title,
        sidecar: `inv_${title}__${id}`,
        parentMap: 'none',
        createdAt: '2026-11-17T08:00:00.000Z',
        updatedAt: '2026-11-17T08:00:00.000Z',
        ...extra
    },
    content: blocks
        .map(([blockId, text]) => `<div class="pisi-editor-block" data-pisi-block-id="${blockId}" data-pisi-block-type="paragraph">${text}</div>`)
        .join('')
});

/**
 * Claim side of a pairing for a test device (code path, §6.6): claims with `code`
 * and returns `{ sas, finish }`; `finish()` polls the result until the desktop
 * grants it and binds the device.
 */
export async function claimWithCode(server, device, code, { platform = 'android' } = {}) {
    const claimed = await claimPisiSyncPairingWithCode({ subtle, http: device.http, code, deviceName: device.name, platform, random });
    return {
        sas: claimed.view.sas,
        async finish({ timeoutMs = 30000 } = {}) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const result = await pollPisiSyncJoinResult({ subtle, http: device.http, session: claimed.session });
                if (result.state === 'granted') {
                    await bind(server, device, result);
                    return result;
                }
                await new Promise((resolve) => setTimeout(resolve, 300));
            }
            throw new Error('eşleştirme onaylanmadı');
        }
    };
}
