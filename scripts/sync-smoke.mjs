#!/usr/bin/env node
// Pisi Sync: a smoke test against a real hosting (docs/sync-plan.md S7 step 2).
//
//   macOS / Linux:       PISI_SYNC_SETUP_KEY=… npm run sync:smoke -- --server https://sunucu.ornek/pisi
//   Windows PowerShell:  $env:PISI_SYNC_SETUP_KEY="…"; npm run sync:smoke -- --server https://sunucu.ornek/pisi
//   Windows cmd:         set "PISI_SYNC_SETUP_KEY=…" && npm run sync:smoke -- --server https://sunucu.ornek/pisi
//
// From a checkout of the repository after `npm ci --ignore-scripts` (Node 24); the
// Electron binary and the mobile package are not needed. docs/sync-server-cpanel.md §11.2.
//
// Run on your own computer. It opens a temporary space with the setup key, pairs a
// desktop (the desktop app's sync engine) and a phone (Pisi Mobil's data layer and
// sync service) on the code path, runs scenarios 1, 2, 5 and 8 of the S7 matrix, checks
// both copies with the desktop's Project Integrity audit and deletes the space again,
// also when a step fails. Both devices work in temporary folders that are removed.
//
// The setup key is read from the environment only. Neither the key, the server address,
// the token nor the project key is printed: the output can be pasted into a PR as it is.
// `--json` prints the result as JSON as well. Exit code 0 when every step passed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateSync as zlibDeflate } from 'node:zlib';
import { grantPisiSyncPairing, pollPisiSyncPairing, startPisiSyncPairing } from '../main/functions/sync-client-pairing.js';
import { createSpaceFor, createTestDevice, nodeDoc, subtle } from '../tests/sync-client-device.mjs';
import { auditProjectFolder } from './sync-e2e/desktop-audit.mjs';

// Pisi Mobil's modules are loaded by URL: they belong to the mobile package, with its own lint
// and type rules, not to the desktop's checkJs.
const mobileModule = (relative) => import(new URL(`../mobile/${relative}`, import.meta.url).href);
const { createNodeFsDriver } = await mobileModule('src/data/drivers/node-fs-driver.mjs');
const { applyBlockPatch, textToBlockHtml } = await mobileModule('src/data/note-patch.mjs');
const { createPhone } = await mobileModule('tests/helpers/sync-devices.mjs');

const random = (n) => new Uint8Array(crypto.randomBytes(n));
const argValue = (name) => {
    const index = process.argv.indexOf(name);
    if (index >= 0) return process.argv[index + 1] || '';
    const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
    return inline ? inline.slice(name.length + 1) : '';
};

const serverUrl = argValue('--server').replace(/\/+$/, '');
const setupKey = process.env.PISI_SYNC_SETUP_KEY || '';
// Only for tests/sync-server-contract-smoke.test.mjs, which runs this script against the local PHP test server.
const loopback = process.env.PISI_SYNC_SMOKE_ALLOW_LOOPBACK === '1';
const asJson = process.argv.includes('--json');

/** Every printed line goes through here: the address, the key and any token-looking text are blanked. */
function redact(text) {
    let out = String(text ?? '');
    for (const secret of [setupKey, serverUrl, serverUrl && new URL(serverUrl).host].filter(Boolean)) out = out.split(secret).join('<gizli>');
    return out.replace(/\b(psk|tok|pst)_[A-Za-z0-9_-]{8,}/g, '<gizli>');
}
const say = (line) => console.log(redact(line));

if (!serverUrl || !setupKey) {
    say('Kullanım (macOS, Linux):    PISI_SYNC_SETUP_KEY=<kurulum anahtarı> npm run sync:smoke -- --server https://<sunucu>/<yol>');
    say('Kullanım (Windows PowerShell): $env:PISI_SYNC_SETUP_KEY="<kurulum anahtarı>"; npm run sync:smoke -- --server https://<sunucu>/<yol>');
    say('Kullanım (Windows cmd):     set "PISI_SYNC_SETUP_KEY=<kurulum anahtarı>" && npm run sync:smoke -- --server https://<sunucu>/<yol>');
    say('Kurulum anahtarı yalnız ortam değişkeninden okunur; hiçbir yere yazılmaz.');
    process.exit(2);
}
let parsedUrl;
try {
    parsedUrl = new URL(serverUrl);
} catch {
    say('Sunucu adresi geçerli bir URL değil.');
    process.exit(2);
}
if (parsedUrl.protocol !== 'https:' && !loopback) {
    say('Sunucu adresi https:// ile başlamalı.');
    process.exit(2);
}

const server = { baseUrl: serverUrl, setupKey };
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-sync-smoke-')));
const phoneRoot = path.join(work, 'phone');
fs.mkdirSync(phoneRoot, { recursive: true });
const NOTE = 'Duman Notu.node';
const NOTE_ID = 'node_5a0e5a0e-0000-4000-8000-000000000001';
const DELETED = 'Silinecek Not.node';
const DELETED_ID = 'node_5a0e5a0e-0000-4000-8000-000000000002';
const IMAGE_NOTE = 'Görselli Not.node';
const IMAGE_NOTE_ID = 'node_5a0e5a0e-0000-4000-8000-000000000003';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const steps = [];
/** @type {any} */
let desktop = null;
/** @type {any} */
let phone = null;
let spaceId = null;

function check(condition, message, detail) {
    if (!condition) throw new Error(message + (detail === undefined ? '' : `: ${JSON.stringify(detail)}`));
}

async function step(name, run) {
    const started = Date.now();
    try {
        await run();
        steps.push({ name, ok: true, ms: Date.now() - started });
        say(`  ✓ ${name} (${Date.now() - started} ms)`);
    } catch (error) {
        steps.push({ name, ok: false, ms: Date.now() - started, error: redact(error?.code ? `${error.code}: ${error.message}` : error?.message || error) });
        say(`  ✗ ${name}: ${redact(error?.code ? `${error.code}: ${error.message}` : error?.message || error)}`);
        throw error;
    }
}

async function desktopSync(label) {
    const result = await desktop.sync('smoke');
    check(result.ok, `${label}: masaüstü turu`, { code: result.code });
    return result;
}

async function phoneSync(label) {
    const result = await phone.service.sync('smoke');
    check(result?.ok, `${label}: telefon turu`, { code: result?.code ?? phone.service.getStatus().code });
    return result;
}

async function phoneText(key) {
    return (await phone.driver.exists(key)) ? phone.driver.readText(key) : null;
}

async function editOnPhone(key, blockId, text) {
    const { data } = await phone.project.notes.read(key);
    await phone.project.notes.updateContent(key, [{ op: 'replace', blockId, html: textToBlockHtml(text) }], { expectedContent: data.content });
}

const setBlock = (doc, blockId, text) => ({ ...doc, content: applyBlockPatch(doc.content, [{ op: 'replace', blockId, html: textToBlockHtml(text) }]) });
const conflictCopies = (keys) => keys.filter((key) => /çakışma/.test(key) && key.endsWith('.node'));
const phoneKeys = () => {
    const out = [];
    const walk = (folder) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()) walk(full);
            else out.push(path.relative(phoneRoot, full).split(path.sep).join('/'));
        }
    };
    walk(phoneRoot);
    return out.sort();
};

const issueKey = (issue) => [issue.code, issue.path || '', issue.message || ''].join('|');
let desktopBaseline = new Set();
let phoneBaseline = new Set();
function integrity(label) {
    const fromDesktop = auditProjectFolder(desktop.project).issues.filter((issue) => !desktopBaseline.has(issueKey(issue)));
    check(fromDesktop.length === 0, `${label}: masaüstü kopyasında yeni Integrity bulgusu`, fromDesktop.map(issueKey));
    // An attachment that has not come down yet waits on the server; it is not "missing" (S6).
    const fromPhone = auditProjectFolder(phoneRoot).issues.filter((issue) => !phoneBaseline.has(issueKey(issue)) && issue.code !== 'attachment-target-missing');
    check(fromPhone.length === 0, `${label}: telefon kopyasında yeni Integrity bulgusu`, fromPhone.map(issueKey));
}

/** A small valid PNG: 8×8, one colour. */
function makePng() {
    const crc = (bytes) => {
        let c = 0xffffffff;
        for (const byte of bytes) {
            c ^= byte;
            for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const sum = Buffer.alloc(4);
        sum.writeUInt32BE(crc(body));
        return Buffer.concat([length, body, sum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(8, 0);
    header.writeUInt32BE(8, 4);
    header[8] = 8;
    header[9] = 2;
    const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([0, ...Array.from({ length: 8 }, () => [232, 155, 66]).flat()])));
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', zlibDeflate(rows)),
        chunk('IEND', Buffer.alloc(0))
    ]);
}
let exitCode = 0;
say('Pisi Sync duman testi (sunucu adresi ve anahtar gizli)');
try {
    await step('sunucu yanıt veriyor (GET /v1/info)', async () => {
        const response = await fetch(`${serverUrl}/v1/info`, { headers: loopback ? { 'x-forwarded-proto': 'https' } : {} });
        check(response.ok, 'info', { status: response.status });
        const info = await response.json();
        check(info.service === 'pisi-sync' && info.protocol?.min <= 1 && info.protocol?.max >= 1, 'protokol 1 desteklenmeli', info.protocol);
    });

    await step('geçici alan açıldı, masaüstü projeyi yükledi', async () => {
        desktop = createTestDevice(server, { name: 'Duman testi masaüstü' });
        desktop.write('.pisi/tasks.json', { version: 1, updatedAt: '2026-11-18T08:00:00.000Z', tasks: [] });
        desktop.write('diary/.pisi-diary', 'Pisi diary folder\n');
        desktop.write(
            NOTE,
            nodeDoc(NOTE_ID, 'Duman Notu', [
                ['b1', 'Birinci paragraf'],
                ['b2', 'İkinci paragraf'],
                ['b3', 'Üçüncü paragraf'],
                ['b4', 'Dördüncü paragraf']
            ])
        );
        desktop.write(DELETED, nodeDoc(DELETED_ID, 'Silinecek Not', [['d1', 'Silinecek metin']]));
        for (const [title, id] of [
            ['Duman Notu', NOTE_ID],
            ['Silinecek Not', DELETED_ID]
        ])
            fs.mkdirSync(path.join(desktop.project, `inv_${title}__${id}`), { recursive: true });
        desktopBaseline = new Set(auditProjectFolder(desktop.project).issues.map(issueKey));
        const created = await createSpaceFor(server, desktop, { spaceName: 'Pisi duman testi' });
        spaceId = created.spaceId;
        await desktopSync('ilk yükleme');
    });

    await step('telefon kodla eşleşti (doğrulama numarası iki tarafta aynı) ve projeyi indirdi', async () => {
        phone = createPhone(server, {
            driver: createNodeFsDriver(phoneRoot),
            fetchImpl: (url, init) => globalThis.fetch(url, init),
            allowLoopbackHttp: loopback,
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 1000)))
        });
        await phone.project.open();
        await phone.service.init();
        const state = await desktop.store.load();
        const started = await startPisiSyncPairing({ subtle, http: desktop.http, serverUrl: state.serverUrl, spaceId: state.spaceId, random });
        const claimed = await phone.service.startPairing({
            method: 'code',
            serverUrl: state.serverUrl,
            code: started.view.code,
            deviceName: 'Duman testi telefonu',
            initial: 'merge'
        });
        let view = null;
        for (let tries = 0; tries < 200 && view?.state !== 'claimed'; tries += 1) {
            view = await pollPisiSyncPairing({ subtle, http: desktop.http, session: started.session });
            if (view.state !== 'claimed') await new Promise((resolve) => setTimeout(resolve, 300));
        }
        check(view?.state === 'claimed' && view.valid === true, 'telefonun talebi gelmeli', { state: view?.state });
        check(view.sas === claimed.sas, 'iki ekranda aynı doğrulama numarası');
        const secrets = await desktop.store.readSecrets();
        await grantPisiSyncPairing({
            subtle,
            http: desktop.http,
            session: started.session,
            keys: desktop.keys,
            projectKey: secrets.key,
            spaceName: state.spaceName,
            random
        });
        await claimed.wait();
        await phoneSync('ilk indirme');
        check((await phoneText(NOTE)) === desktop.read(NOTE), 'not bayt bayt aynı inmeli');
        phoneBaseline = new Set(auditProjectFolder(phoneRoot).issues.map(issueKey));
        integrity('eşleşme');
    });

    await step('1. aynı notun farklı blokları iki cihazda değişir: ikisi de kalır, kopya yok', async () => {
        desktop.write(NOTE, setBlock(desktop.readJson(NOTE), 'b1', 'Birinci paragraf (masaüstü)'));
        await editOnPhone(NOTE, 'b3', 'Üçüncü paragraf (telefon)');
        await desktopSync('1');
        await phoneSync('1');
        await desktopSync('1');
        const text = desktop.read(NOTE);
        check(text.includes('Birinci paragraf (masaüstü)') && text.includes('Üçüncü paragraf (telefon)'), 'iki değişiklik de kalmalı');
        check(text === (await phoneText(NOTE)), 'iki cihaz aynı');
        check(conflictCopies(desktop.list()).length === 0, 'çakışma kopyası olmamalı');
        integrity('1');
    });

    await step('2. aynı blok iki cihazda değişir: tek çakışma kopyası, iki metin de var', async () => {
        desktop.write(NOTE, setBlock(desktop.readJson(NOTE), 'b2', 'İkinci paragraf (masaüstü sürümü)'));
        await editOnPhone(NOTE, 'b2', 'İkinci paragraf (telefon sürümü)');
        await desktopSync('2');
        await phoneSync('2');
        await desktopSync('2');
        const copies = conflictCopies(desktop.list());
        check(copies.length === 1, 'tek çakışma kopyası', copies.length);
        check(JSON.stringify(conflictCopies(phoneKeys())) === JSON.stringify(copies), 'kopya iki cihazda aynı');
        const both = desktop.read(NOTE) + desktop.read(copies[0]);
        check(both.includes('masaüstü sürümü') && both.includes('telefon sürümü'), 'iki metin de kalmalı');
        integrity('2');
    });

    await step('5. masaüstü notu siler: telefondan kalkar', async () => {
        check((await phoneText(DELETED)) !== null, 'not önce telefonda');
        desktop.remove(DELETED);
        desktop.remove(`inv_Silinecek Not__${DELETED_ID}`);
        await desktopSync('5');
        await phoneSync('5');
        check((await phoneText(DELETED)) === null, 'not telefondan kalkmalı');
        integrity('5');
    });

    await step('8. masaüstü görsel ekler: telefona açılınca iner, özeti aynı', async () => {
        const png = makePng();
        const reference = `image/${sha(png)}.png`;
        const sidecar = `inv_Görselli Not__${IMAGE_NOTE_ID}`;
        const doc = nodeDoc(IMAGE_NOTE_ID, 'Görselli Not', [['g1', 'Görsel aşağıda']]);
        doc.content += `<div class="pisi-editor-block pisi-image-block" data-pisi-block-id="g2" data-pisi-block-type="image" contenteditable="false"><img data-pisi-image-asset="${reference}" alt="Duman testi görseli"></div>`;
        fs.mkdirSync(path.join(desktop.project, sidecar, 'image'), { recursive: true });
        fs.writeFileSync(path.join(desktop.project, sidecar, ...reference.split('/')), png);
        desktop.write(IMAGE_NOTE, doc);
        await desktopSync('8');
        await phoneSync('8');
        check((await phoneText(IMAGE_NOTE)) !== null, 'not telefona inmeli');
        check(!(await phone.driver.exists(`${sidecar}/${reference}`)), 'görsel açılmadan inmemeli');
        const fetched = await phone.service.fetchAttachment(`${sidecar}/${reference}`);
        check(fetched?.ok, 'görsel açılınca inmeli', { code: fetched?.code });
        check(sha(fs.readFileSync(path.join(phoneRoot, sidecar, ...reference.split('/')))) === sha(png), 'özet aynı');
        integrity('8');
    });
} catch {
    exitCode = 1;
} finally {
    if (spaceId && desktop) {
        try {
            await desktop.http.request('DELETE', `/v1/spaces/${spaceId}`, { json: { confirm: spaceId } });
            say('  ✓ geçici alan sunucudan silindi');
            steps.push({ name: 'geçici alan silindi', ok: true });
        } catch (error) {
            exitCode = 1;
            say(`  ✗ geçici alan silinemedi (${redact(error?.code || error?.message)}); alan kimliği: ${spaceId}`);
            steps.push({ name: 'geçici alan silindi', ok: false });
        }
    }
    phone?.service.destroy?.();
    fs.rmSync(work, { recursive: true, force: true });
}
say(exitCode === 0 ? 'Sonuç: GEÇTİ' : 'Sonuç: BAŞARISIZ');
if (asJson) console.log(redact(JSON.stringify({ ok: exitCode === 0, steps, node: process.version, platform: `${process.platform} ${process.arch}` })));
process.exit(exitCode);
