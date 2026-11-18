// The first transfer of a project against the real PHP test server (docs/sync-plan.md S6):
// - a desktop's first upload and a phone's first download that are killed half way
//   go on after a restart and end byte for byte equal to the desktop's project;
// - the large-project measurement: the desktop uploads a generated project
//   (scripts/generate-project-fixture.mjs) and the phone downloads it; times,
//   requests, bytes, the space the server uses and when the phone's Pisi tab had
//   its files are written to sync-initial-transfer.json.
// The measurement runs at full size (2,000 notes, 5,000 tasks, 60 diary days,
// 300 images, about 200 MB) with PISI_SYNC_TRANSFER_FULL=1, as CI does
// (.github/workflows/sync-server.yml uploads the report); otherwise it runs small.
// `npm run test:sync-server` runs this file.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startSyncTestServer } from '../scripts/start-sync-test-server.mjs';
import { generatePisiProjectFixture } from '../scripts/generate-project-fixture.mjs';
import { grantPisiSyncPairing, pollPisiSyncPairing, startPisiSyncPairing } from '../main/functions/sync-client-pairing.js';
import { createNodeFsDriver } from '../mobile/src/data/drivers/node-fs-driver.mjs';
import { createPhone } from '../mobile/tests/helpers/sync-devices.mjs';
import { getPisiSyncLocalDate } from '../shared/sync-initial.mjs';
import { checkPisiSyncPath, getPisiSyncFileClass } from '../shared/sync-paths.mjs';
import { SYNC_SERVER_SKIP } from './sync-server-client.mjs';
import { createSpaceFor, createTestDevice, makeTempDir, serverUrlOf, subtle } from './sync-client-device.mjs';

const random = (n) => new Uint8Array(crypto.randomBytes(n));
const FULL = process.env.PISI_SYNC_TRANSFER_FULL === '1';
const SIZE = FULL
    ? { notes: 2000, perMap: 250, tasks: 5000, diaryDays: 60, images: 300, imageBytes: 690 * 1024 }
    : { notes: 120, perMap: 60, tasks: 300, diaryDays: 10, images: 6, imageBytes: 160 * 1024 };
const REPORT = process.env.PISI_SYNC_TRANSFER_REPORT || path.join('test-results', 'sync-initial-transfer.json');
const TODAY = getPisiSyncLocalDate(new Date());

/** A fetch that counts requests and bytes, and stops answering once `kill()` was called. */
function meteredFetch() {
    const meter = { requests: 0, sent: 0, received: 0, killed: false, downloadsLeft: Infinity, downloads: 0 };
    meter.fetch = async (url, init = {}) => {
        if (!meter.killed && /\/blobs\/b_/.test(String(url)) && (init.method || 'GET') === 'GET') {
            meter.downloads += 1;
            if ((meter.downloadsLeft -= 1) < 0) meter.killed = true;
        }
        if (meter.killed) throw new TypeError('Failed to fetch');
        meter.requests += 1;
        const body = init.body;
        meter.sent += typeof body === 'string' ? Buffer.byteLength(body) : body?.byteLength || 0;
        const response = await globalThis.fetch(url, init);
        const bytes = new Uint8Array(await response.arrayBuffer());
        meter.received += bytes.length;
        return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
    return meter;
}

/** The desktop answers a pairing: waits for the phone's claim and grants it. */
async function grant(desktop, started) {
    const state = await desktop.store.load();
    const secrets = await desktop.store.readSecrets();
    for (let tries = 0; tries < 200; tries += 1) {
        const view = await pollPisiSyncPairing({ subtle, http: desktop.http, session: started.session });
        if (view.state === 'claimed') {
            await grantPisiSyncPairing({
                subtle,
                http: desktop.http,
                session: started.session,
                keys: desktop.keys,
                projectKey: secrets.key,
                spaceName: state.spaceName,
                random
            });
            return view;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('talep gelmedi');
}

/** A phone over a real folder, paired with `desktop`; its first turn not run yet. */
async function pairPhone(server, desktop, { meter, driverRoot = makeTempDir('pisi-transfer-phone-'), stateDriver, secrets } = {}) {
    const phone = createPhone(server, {
        driver: createNodeFsDriver(driverRoot),
        ...(stateDriver ? { stateDriver } : {}),
        ...(secrets ? { secrets } : {}),
        fetchImpl: meter.fetch,
        allowLoopbackHttp: true,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 200)))
    });
    await phone.project.open();
    await phone.service.init();
    if (!stateDriver) {
        const state = await desktop.store.load();
        const started = await startPisiSyncPairing({ subtle, http: desktop.http, serverUrl: state.serverUrl, spaceId: state.spaceId, random });
        const claimed = await phone.service.startPairing({
            method: 'code',
            serverUrl: serverUrlOf(server),
            code: started.view.code,
            deviceName: 'Pixel 7',
            initial: 'replace'
        });
        await Promise.all([grant(desktop, started), claimed.wait()]);
    }
    return { ...phone, root: driverRoot };
}

/** Every synced file of a folder (`key → bytes`); `withAttachments: false` leaves the attachments out. */
function syncedFiles(root, { withAttachments = true } = {}) {
    const files = new Map();
    const walk = (folder) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const full = path.join(folder, entry.name);
            const key = path.relative(root, full).split(path.sep).join('/');
            if (entry.isDirectory()) walk(full);
            else if (checkPisiSyncPath(key).ok && (withAttachments || getPisiSyncFileClass(key) !== 'asset')) files.set(key, fs.readFileSync(full));
        }
    };
    walk(root);
    return files;
}

function assertSameFiles(actual, expected, label) {
    assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), label);
    for (const [key, bytes] of expected) assert.ok(actual.get(key).equals(bytes), `${label}: ${key}`);
}

describe('ilk aktarım (S6)', { skip: SYNC_SERVER_SKIP }, () => {
    let server;
    before(async () => {
        server = await startSyncTestServer();
    });
    after(async () => {
        await server?.stop();
    });

    test('%50de kesilen ilk yükleme ve ilk indirme yeniden başlatılınca tamamlanır; sonuç kesilmeyenle bayt bayt aynı', async () => {
        const project = makeTempDir('pisi-transfer-cut-');
        await generatePisiProjectFixture(project, { notes: 60, perMap: 30, tasks: 40, diaryDays: 3, images: 4, imageBytes: 64 * 1024, today: TODAY });
        const meter = meteredFetch();
        const desktop = createTestDevice(server, { name: 'Masaüstü', project, fetchImpl: meter.fetch });
        await createSpaceFor(server, desktop, { spaceName: 'Kesilen' });
        let half = 0;
        const cut = await desktop
            .sync('setup', {
                onProgress: (progress) => {
                    if (progress.phase === 'upload' && !half && progress.files.done >= progress.files.total / 2) {
                        half = progress.files.done;
                        meter.killed = true;
                    }
                }
            })
            .catch((error) => ({ ok: false, code: error.code }));
        assert.equal(cut.ok, false);
        assert.ok(half > 0);
        meter.killed = false;
        desktop.restart();
        assert.equal((await desktop.sync()).ok, true);
        const heads = Number(server.sql('SELECT COUNT(*) AS n FROM heads').rows.at(-1).n);
        assert.ok(heads >= syncedFiles(project).size);

        // The phone: killed half way through its first download, then started again with the same storage.
        const phoneMeter = meteredFetch();
        const phone = await pairPhone(server, desktop, { meter: phoneMeter });
        // Killed once half of the files (the attachments stay on the server) have come down.
        const toDownload = [...syncedFiles(project, { withAttachments: false }).keys()].length;
        phoneMeter.downloadsLeft = Math.floor(toDownload / 2);
        await phone.service.sync('test');
        const downloaded = phoneMeter.downloads;
        assert.ok(fs.existsSync(path.join(phone.root, '.pisi', 'tasks.json')), 'the first batch came down before the kill');
        assert.ok(downloaded > 0);
        phone.service.destroy();
        phoneMeter.killed = false;
        phoneMeter.downloadsLeft = Infinity;
        const restarted = await pairPhone(server, desktop, {
            meter: phoneMeter,
            driverRoot: phone.root,
            stateDriver: phone.stateDriver,
            secrets: phone.secrets
        });
        assert.equal((await restarted.service.sync('test'))?.ok, true);

        // The same as an uninterrupted download, and as the desktop's project (attachments come when opened).
        const whole = await pairPhone(server, desktop, { meter: meteredFetch() });
        assert.equal((await whole.service.sync('test'))?.ok, true);
        assertSameFiles(syncedFiles(restarted.root), syncedFiles(whole.root), 'kesilen ve kesilmeyen indirme');
        assertSameFiles(syncedFiles(restarted.root), syncedFiles(project, { withAttachments: false }), 'telefon ve masaüstü');
        restarted.service.destroy();
        whole.service.destroy();
    });

    test(`büyük proje ölçümü (${FULL ? 'tam boyut' : 'küçük boyut'}): ilk yükleme ve ilk indirme`, { timeout: 30 * 60 * 1000 }, async () => {
        const project = makeTempDir('pisi-transfer-large-');
        const generated = await generatePisiProjectFixture(project, { ...SIZE, today: TODAY });
        const local = syncedFiles(project);
        const projectBytes = [...local.values()].reduce((total, bytes) => total + bytes.length, 0);

        const upMeter = meteredFetch();
        const desktop = createTestDevice(server, { name: 'Masaüstü', project, fetchImpl: upMeter.fetch });
        const created = await createSpaceFor(server, desktop, { spaceName: 'Büyük proje' });
        const uploadStarted = performance.now();
        const uploaded = await desktop.sync('setup', { onProgress: () => (desktop.requests.length = 0) });
        const uploadMs = performance.now() - uploadStarted;
        assert.equal(uploaded.ok, true, JSON.stringify(uploaded));
        desktop.requests.length = 0;
        const space = server.sql('SELECT usage_bytes AS used, head FROM spaces WHERE space_id = ?', [created.spaceId]).rows[0];
        const blobs = server.sql('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM blobs WHERE space_id = ?', [created.spaceId]).rows[0];

        const downMeter = meteredFetch();
        const phone = await pairPhone(server, desktop, { meter: downMeter });
        downMeter.requests = 0;
        downMeter.sent = 0;
        downMeter.received = 0;
        const firstAt = {};
        const downloadStarted = performance.now();
        phone.project.writer.onFileChanged((key, info) => {
            if (info.source !== 'sync') return;
            const at = performance.now() - downloadStarted;
            if (key === '.pisi/tasks.json') firstAt.tasks ??= at;
            if (key === `diary/${TODAY}.node`) firstAt.today ??= at;
            if (getPisiSyncFileClass(key) === 'node' && !key.startsWith('diary/')) firstAt.note ??= at;
        });
        const downloaded = await phone.service.sync('test');
        const downloadMs = performance.now() - downloadStarted;
        assert.equal(downloaded?.ok, true, JSON.stringify(downloaded));
        assertSameFiles(syncedFiles(phone.root), syncedFiles(project, { withAttachments: false }), 'telefon ve masaüstü');
        // The Pisi tab's files come before the first note (S6 step 2).
        assert.ok(firstAt.tasks < firstAt.note && firstAt.today < firstAt.note, JSON.stringify(firstAt));
        const remoteOnly = Object.keys((await phone.service.store.load()).remoteOnly).length;
        assert.equal(remoteOnly, generated.images);
        phone.service.destroy();

        const report = {
            size: FULL ? 'full' : 'small',
            project: {
                notes: generated.notes,
                maps: generated.maps,
                tasks: generated.tasks,
                diaryDays: generated.diaryDays,
                images: generated.images,
                files: local.size,
                bytes: projectBytes
            },
            upload: { ms: Math.round(uploadMs), requests: upMeter.requests, bytesSent: upMeter.sent, bytesReceived: upMeter.received, pushed: uploaded.pushed },
            server: { head: Number(space.head), usageBytes: Number(space.used), blobs: Number(blobs.n), blobBytes: Number(blobs.bytes) },
            download: {
                ms: Math.round(downloadMs),
                requests: downMeter.requests,
                bytesReceived: downMeter.received,
                files: local.size - generated.images,
                attachmentsLeftOnServer: remoteOnly,
                tasksJsonAtMs: Math.round(firstAt.tasks),
                todayDiaryAtMs: Math.round(firstAt.today),
                firstNoteAtMs: Math.round(firstAt.note)
            },
            environment: { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length }
        };
        fs.mkdirSync(path.dirname(REPORT), { recursive: true });
        fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
        console.log(`[S6] sync-initial-transfer: ${JSON.stringify(report)}`);
    });
});
