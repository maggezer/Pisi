import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { signPisiUpdateManifest } from '../main/functions/update-signature-core.js';

// The packaged NSIS updater against a fake HTTPS feed (electron's net.fetch is stubbed).
const FEED = 'https://updates.example.test/pisi/windows/beta/';
const trusted = crypto.generateKeyPairSync('ed25519');
const attacker = crypto.generateKeyPairSync('ed25519');
const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-update-feed-'));
fs.writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify({
        name: 'pisi',
        version: '1.0.0',
        pisiDistribution: 'nsis',
        pisiUpdateChannel: 'beta',
        pisiUpdateFeedUrl: FEED,
        pisiUpdatePublicKeys: trusted.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    })
);
const feed = new Map();
const serve = (name, body, options = {}) => feed.set(FEED + name, { body, status: options.status ?? 200, url: options.url || FEED + name });
const fetches = [];
const originalLoad = Module._load;
Module._load = function pisiUpdateFeedElectronStub(request, parent, isMain) {
    if (request === 'electron') {
        return {
            app: { isPackaged: true, getVersion: () => '1.0.0', getAppPath: () => appDir, getPath: () => appDir, on() {}, once() {}, quit() {} },
            BrowserWindow: { getAllWindows: () => [] },
            dialog: {},
            ipcMain: { handle() {}, on() {} },
            net: {
                fetch: async (url) => {
                    fetches.push(url);
                    const entry = feed.get(url) || { status: 404, body: '', url };
                    return { ok: entry.status >= 200 && entry.status < 300, status: entry.status, url: entry.url, text: async () => entry.body };
                }
            }
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const { modules } = await import('../main/module-registry.js');
await import('../main/functions/auto-update.js');
Module._load = originalLoad;
const updater = modules['main.autoUpdate'];

const warnings = [];
const nativeWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(' '));
test.after(() => {
    console.warn = nativeWarn;
    fs.rmSync(appDir, { recursive: true, force: true });
});

const manifestText = JSON.stringify({
    schemaVersion: 1,
    channel: 'beta',
    version: '1.0.0',
    files: { x64: { url: 'Pisi-1.0.0-Setup-x64.exe', sha256: 'a'.repeat(64) }, arm64: { url: 'Pisi-1.0.0-Setup-arm64.exe', sha256: 'b'.repeat(64) } }
});
const sign = (text, key) => JSON.stringify(signPisiUpdateManifest(Buffer.from(text), key.privateKey));

test('an unsigned manifest is rejected and logged', async () => {
    feed.clear();
    serve('latest.json', manifestText);
    warnings.length = 0;
    const result = await updater.checkPisiForUpdates({ prompt: false });
    assert.equal(result.ok, false);
    assert.match(result.error, /not signed/);
    assert.ok(fetches.includes(FEED + 'latest.json.sig'), 'the signature was looked up next to the manifest');
    assert.ok(
        warnings.some((line) => /Update manifest rejected: UPDATE_SIGNATURE_MISSING/.test(line)),
        warnings
    );
});

test('a manifest signed with an unknown key, or changed after signing, is rejected', async () => {
    feed.clear();
    serve('latest.json', manifestText);
    serve('latest.json.sig', sign(manifestText, attacker));
    assert.match((await updater.checkPisiForUpdates({ prompt: false })).error, /unknown key/);

    feed.clear();
    serve('latest.json', manifestText.replace('a'.repeat(64), 'c'.repeat(64)));
    serve('latest.json.sig', sign(manifestText, trusted));
    assert.match((await updater.checkPisiForUpdates({ prompt: false })).error, /does not match/);
});

test('a manifest signed with the built-in key is accepted', async () => {
    feed.clear();
    serve('latest.json', manifestText);
    serve('latest.json.sig', sign(manifestText, trusted));
    const result = await updater.checkPisiForUpdates({ prompt: false });
    assert.deepEqual(result, { ok: true, updateAvailable: false, version: '1.0.0' });
});

test('the existing HTTPS rule still holds: a signature redirected to HTTP is refused', async () => {
    feed.clear();
    serve('latest.json', manifestText);
    serve('latest.json.sig', sign(manifestText, trusted), { url: 'http://updates.example.test/latest.json.sig' });
    assert.match((await updater.checkPisiForUpdates({ prompt: false })).error, /non-HTTPS/);
    feed.clear();
    serve('latest.json', manifestText, { url: 'http://updates.example.test/latest.json' });
    serve('latest.json.sig', sign(manifestText, trusted));
    assert.match((await updater.checkPisiForUpdates({ prompt: false })).error, /non-HTTPS/);
});

test('installer publisher: skipped and logged without an identity; checked on Windows with one', async () => {
    warnings.length = 0;
    assert.deepEqual(await updater.verifyPisiInstallerPublisher('C:/x.exe', ''), { ok: true, skipped: true });
    assert.ok(warnings.some((line) => /Authenticode check skipped/.test(line)));
    const query = (status, subject) => async (filePath) => {
        assert.equal(filePath, 'C:/Pisi Setup.exe', 'the path is passed as data');
        return JSON.stringify({ Status: status, Subject: subject });
    };
    const windows = { platform: 'win32' };
    assert.equal(
        (await updater.verifyPisiInstallerPublisher('C:/Pisi Setup.exe', 'Pisi Ltd', { ...windows, runQuery: query('Valid', 'CN=Pisi Ltd') })).ok,
        true
    );
    assert.equal(
        (await updater.verifyPisiInstallerPublisher('C:/Pisi Setup.exe', 'Pisi Ltd', { ...windows, runQuery: query('Valid', 'CN=Someone Else') })).code,
        'AUTHENTICODE_PUBLISHER_MISMATCH'
    );
    assert.equal((await updater.verifyPisiInstallerPublisher('C:/Pisi Setup.exe', 'Pisi Ltd', { ...windows, runQuery: query('NotSigned', '') })).ok, false);
    assert.equal(
        (
            await updater.verifyPisiInstallerPublisher('C:/Pisi Setup.exe', 'Pisi Ltd', {
                ...windows,
                runQuery: async () => Promise.reject(new Error('no powershell'))
            })
        ).code,
        'AUTHENTICODE_UNREADABLE'
    );
});
