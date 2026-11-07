import { registerMainModule } from '../module-registry.js';
import { app, BrowserWindow, dialog, ipcMain, net } from '../electron-bridge.js';
import { execFile, spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { URL } from 'node:url';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { PISI_UPDATE_SIGNATURE_FILE, evaluatePisiAuthenticodeResult, parsePisiUpdatePublicKeys, verifyPisiUpdateManifest } from './update-signature-core.js';

const PISI_UPDATE_SCHEMA_VERSION = 1;
const PISI_UPDATE_MANIFEST = 'latest.json';
const PISI_UPDATE_CHECK_DELAY_MS = 15 * 1000;
const PISI_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PISI_UPDATE_MANIFEST_MAX_BYTES = 128 * 1024;
const PISI_UPDATE_INSTALLER_MAX_BYTES = 750 * 1024 * 1024;

let updateState = {
    mode: 'uninitialized',
    managedBy: null,
    currentVersion: null,
    channel: null,
    feedConfigured: false,
    checking: false,
    availableVersion: null,
    downloadedVersion: null,
    lastCheckAt: null,
    error: null
};
let pendingInstaller = null;
let checkTimer = null;
let periodicTimer = null;
let currentCheckPromise = null;
let lastPromptedVersion = null;
let initialized = false;

function translateUpdateText(source) {
    try {
        if (typeof globalThis.translatePisiMain === 'function') {
            return globalThis.translatePisiMain(source);
        }
    } catch {}
    return source;
}

function broadcastUpdateState() {
    const snapshot = getPisiUpdateStatus();
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
            window.webContents.send('app:update-status', snapshot);
        }
    }
}

function patchUpdateState(patch) {
    updateState = {
        ...updateState,
        ...patch
    };
    broadcastUpdateState();
    return getPisiUpdateStatus();
}

function getPisiUpdateStatus() {
    return {
        ...updateState,
        pendingInstall: Boolean(pendingInstaller)
    };
}

function readPisiPackageMetadata() {
    try {
        const packagePath = path.join(app.getAppPath(), 'package.json');
        return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    } catch (error) {
        console.warn('[PISI] Update package metadata could not be read:', error.message);
        return {};
    }
}

function normalizeFeedBaseUrl(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return null;

    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new Error('Pisi update feed URL is invalid.');
    }

    if (url.protocol !== 'https:') {
        throw new Error('Pisi update feed must use HTTPS.');
    }
    if (url.username || url.password) {
        throw new Error('Pisi update feed URL must not contain credentials.');
    }

    url.search = '';
    url.hash = '';
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
}

function resolvePisiUpdateConfiguration() {
    const metadata = readPisiPackageMetadata();
    const currentVersion = app.getVersion();

    if (process.windowsStore === true) {
        return {
            mode: 'store',
            managedBy: 'microsoft-store',
            currentVersion,
            channel: 'store',
            feed: null
        };
    }

    if (!app.isPackaged) {
        return {
            mode: 'development',
            managedBy: null,
            currentVersion,
            channel: 'development',
            feed: null
        };
    }

    const distribution = String(metadata.pisiDistribution || '')
        .trim()
        .toLowerCase();

    if (distribution === 'portable') {
        return {
            mode: 'portable',
            managedBy: null,
            currentVersion,
            channel: String(metadata.pisiUpdateChannel || 'beta'),
            feed: null
        };
    }

    if (distribution !== 'nsis') {
        return {
            mode: 'disabled',
            managedBy: null,
            currentVersion,
            channel: String(metadata.pisiUpdateChannel || 'beta'),
            feed: null
        };
    }

    const feed = normalizeFeedBaseUrl(process.env.PISI_UPDATE_FEED_URL || metadata.pisiUpdateFeedUrl);
    // Public keys that may sign latest.json (several during a key rotation) and
    // the expected Authenticode publisher; both are set at build time.
    const publicKeys = parsePisiUpdatePublicKeys(metadata.pisiUpdatePublicKeys);
    const expectedPublisher = String(metadata.pisiUpdatePublisher || '').trim();
    // Without a trusted key a feed is never used: an unsigned manifest could run any installer.
    const mode = !feed ? 'direct-unconfigured' : publicKeys.length ? 'direct' : 'direct-unsigned';

    return {
        mode,
        managedBy: mode === 'direct' ? 'pisi' : null,
        currentVersion,
        channel: String(metadata.pisiUpdateChannel || 'beta').trim() || 'beta',
        feed,
        publicKeys,
        expectedPublisher
    };
}

function parseSemver(version) {
    const match = String(version || '')
        .trim()
        .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!match) return null;

    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ? match[4].split('.') : []
    };
}

function comparePrerelease(left, right) {
    if (!left.length && !right.length) return 0;
    if (!left.length) return 1;
    if (!right.length) return -1;

    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const a = left[index];
        const b = right[index];
        if (a === undefined) return -1;
        if (b === undefined) return 1;
        if (a === b) continue;

        const aNumeric = /^\d+$/.test(a);
        const bNumeric = /^\d+$/.test(b);

        if (aNumeric && bNumeric) {
            const delta = Number(a) - Number(b);
            if (delta !== 0) return Math.sign(delta);
            continue;
        }
        if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
        return a < b ? -1 : 1;
    }
    return 0;
}

function compareSemver(leftVersion, rightVersion) {
    const left = parseSemver(leftVersion);
    const right = parseSemver(rightVersion);
    if (!left || !right) {
        throw new Error('Update version is not valid semantic versioning.');
    }

    for (const field of ['major', 'minor', 'patch']) {
        if (left[field] !== right[field]) {
            return Math.sign(left[field] - right[field]);
        }
    }

    return comparePrerelease(left.prerelease, right.prerelease);
}

function normalizeManifestFile(manifest, arch, feed) {
    const file = manifest?.files?.[arch];
    if (!file || typeof file !== 'object') {
        throw new Error('Update feed does not provide an installer for this architecture.');
    }

    const sha256 = String(file.sha256 || '')
        .trim()
        .toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
        throw new Error('Update installer SHA-256 is missing or invalid.');
    }

    const rawUrl = String(file.url || '').trim();
    if (!rawUrl) throw new Error('Update installer URL is missing.');

    const downloadUrl = new URL(rawUrl, feed);
    if (downloadUrl.protocol !== 'https:') {
        throw new Error('Update installer must use HTTPS.');
    }
    if (downloadUrl.username || downloadUrl.password) {
        throw new Error('Update installer URL must not contain credentials.');
    }
    if (downloadUrl.origin !== feed.origin) {
        throw new Error('Update installer must originate from the configured update feed.');
    }

    return {
        url: downloadUrl,
        sha256
    };
}

/** latest.json.sig from the feed, with the same HTTPS rules as the manifest; null when it is not there. */
async function fetchPisiUpdateManifestSignature(configuration) {
    const signatureUrl = new URL(PISI_UPDATE_SIGNATURE_FILE, configuration.feed);
    const response = await net.fetch(signatureUrl.href, {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
        headers: {
            Accept: 'application/json'
        }
    });
    if (response.status === 404) return null;
    if (!response.ok) {
        throw new Error('Update feed signature returned HTTP ' + response.status + '.');
    }
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== 'https:') {
        throw new Error('Update feed signature redirected to a non-HTTPS URL.');
    }
    return response.text();
}

async function fetchPisiUpdateManifest(configuration) {
    const manifestUrl = new URL(PISI_UPDATE_MANIFEST, configuration.feed);
    const response = await net.fetch(manifestUrl.href, {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
        headers: {
            Accept: 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error('Update feed returned HTTP ' + response.status + '.');
    }

    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== 'https:') {
        throw new Error('Update feed redirected to a non-HTTPS URL.');
    }

    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > PISI_UPDATE_MANIFEST_MAX_BYTES) {
        throw new Error('Update feed manifest is unexpectedly large.');
    }

    // The manifest names the installer and its SHA-256, so it must be signed by a built-in key.
    const signature = await fetchPisiUpdateManifestSignature(configuration);
    const verified = verifyPisiUpdateManifest(Buffer.from(text, 'utf8'), signature, configuration.publicKeys);
    if (!verified.ok) {
        console.warn('[PISI] Update manifest rejected:', verified.code, verified.error);
        throw new Error(verified.error);
    }

    let manifest;
    try {
        manifest = JSON.parse(text);
    } catch {
        throw new Error('Update feed returned invalid JSON.');
    }

    if (manifest?.schemaVersion !== PISI_UPDATE_SCHEMA_VERSION) {
        throw new Error('Unsupported Pisi update feed schema.');
    }

    const version = String(manifest.version || '').trim();
    if (!parseSemver(version)) {
        throw new Error('Update feed version is invalid.');
    }

    const channel = String(manifest.channel || '').trim();
    if (channel !== configuration.channel) {
        return {
            compatible: false,
            version,
            channel
        };
    }

    if (!['x64', 'arm64'].includes(process.arch)) {
        throw new Error('Pisi auto-update does not support this Windows architecture.');
    }

    return {
        compatible: true,
        version,
        channel,
        file: normalizeManifestFile(manifest, process.arch, configuration.feed)
    };
}

async function hashFileSha256(filePath) {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest('hex');
}

async function ensureDownloadedInstaller(version, file) {
    const updateDirectory = path.join(app.getPath('userData'), 'updates');
    await fs.promises.mkdir(updateDirectory, { recursive: true });

    const safeVersion = String(version).replace(/[^0-9A-Za-z.-]/g, '_');
    const finalPath = path.join(updateDirectory, 'Pisi-' + safeVersion + '-Setup-' + process.arch + '.exe');
    const tempPath = finalPath + '.download';

    try {
        if (fs.existsSync(finalPath)) {
            const existingHash = await hashFileSha256(finalPath);
            if (existingHash === file.sha256) return finalPath;
            await fs.promises.rm(finalPath, { force: true });
        }

        await fs.promises.rm(tempPath, { force: true });

        const response = await net.fetch(file.url.href, {
            method: 'GET',
            redirect: 'follow',
            cache: 'no-store'
        });

        if (!response.ok || !response.body) {
            throw new Error('Update installer download failed with HTTP ' + response.status + '.');
        }

        const finalUrl = new URL(response.url);
        if (finalUrl.protocol !== 'https:') {
            throw new Error('Update installer redirected to a non-HTTPS URL.');
        }

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(contentLength) && contentLength > PISI_UPDATE_INSTALLER_MAX_BYTES) {
            throw new Error('Update installer is unexpectedly large.');
        }

        await pipeline(Readable.fromWeb(/** @type {any} */ (response.body)), fs.createWriteStream(tempPath, { flags: 'wx' }));

        const stat = await fs.promises.stat(tempPath);
        if (stat.size <= 0 || stat.size > PISI_UPDATE_INSTALLER_MAX_BYTES) {
            throw new Error('Downloaded update installer has an invalid size.');
        }

        const actualHash = await hashFileSha256(tempPath);
        if (actualHash !== file.sha256) {
            throw new Error('Downloaded update installer failed SHA-256 verification.');
        }

        await fs.promises.rename(tempPath, finalPath);
        return finalPath;
    } catch (error) {
        await fs.promises.rm(tempPath, { force: true }).catch(() => {});
        throw error;
    }
}

async function showDownloadedUpdatePrompt(version) {
    if (lastPromptedVersion === version) return;
    lastPromptedVersion = version;

    /** @type {import('electron').MessageBoxOptions} */
    const options = {
        type: 'info',
        title: translateUpdateText('Pisi güncellemesi hazır'),
        message: translateUpdateText('Yeni bir Pisi sürümü indirildi.'),
        detail: 'Pisi ' + version + ' ' + translateUpdateText('yüklenmeye hazır. Güncelleme için uygulama kapatılacak.'),
        buttons: [translateUpdateText('Şimdi yükle'), translateUpdateText('Daha sonra')],
        defaultId: 0,
        cancelId: 1,
        noLink: true
    };

    const owner = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);

    if (result.response === 0) {
        await installPendingPisiUpdate();
    }
}

async function checkPisiForUpdates(options = {}) {
    if (currentCheckPromise) return currentCheckPromise;

    currentCheckPromise = (async () => {
        let configuration;
        try {
            configuration = resolvePisiUpdateConfiguration();
        } catch (error) {
            patchUpdateState({
                checking: false,
                error: error.message
            });
            return {
                ok: false,
                error: error.message
            };
        }

        patchUpdateState({
            mode: configuration.mode,
            managedBy: configuration.managedBy,
            currentVersion: configuration.currentVersion,
            channel: configuration.channel,
            feedConfigured: Boolean(configuration.feed),
            checking: configuration.mode === 'direct',
            error: null
        });

        if (configuration.mode === 'store') {
            return {
                ok: true,
                managedBy: 'microsoft-store',
                updateAvailable: false
            };
        }

        if (configuration.mode !== 'direct') {
            return {
                ok: true,
                disabled: true,
                mode: configuration.mode,
                updateAvailable: false
            };
        }

        try {
            const manifest = await fetchPisiUpdateManifest(configuration);
            const lastCheckAt = new Date().toISOString();

            if (!manifest.compatible || compareSemver(manifest.version, configuration.currentVersion) <= 0) {
                patchUpdateState({
                    checking: false,
                    availableVersion: null,
                    downloadedVersion: null,
                    lastCheckAt,
                    error: null
                });
                return {
                    ok: true,
                    updateAvailable: false,
                    version: manifest.version
                };
            }

            patchUpdateState({
                checking: false,
                availableVersion: manifest.version,
                lastCheckAt,
                error: null
            });

            const installerPath = await ensureDownloadedInstaller(manifest.version, manifest.file);

            pendingInstaller = {
                version: manifest.version,
                path: installerPath,
                sha256: manifest.file.sha256
            };

            patchUpdateState({
                downloadedVersion: manifest.version,
                error: null
            });

            if (options.prompt !== false) {
                await showDownloadedUpdatePrompt(manifest.version);
            }

            return {
                ok: true,
                updateAvailable: true,
                downloaded: true,
                version: manifest.version
            };
        } catch (error) {
            console.warn('[PISI] Auto-update check failed:', error.message);
            patchUpdateState({
                checking: false,
                error: error.message,
                lastCheckAt: new Date().toISOString()
            });
            return {
                ok: false,
                error: error.message
            };
        }
    })();

    try {
        return await currentCheckPromise;
    } finally {
        currentCheckPromise = null;
    }
}

/** Get-AuthenticodeSignature for one file, as JSON { Status, Subject }. The path goes in through the environment, never the command text. */
function runPisiAuthenticodeQuery(filePath) {
    const command =
        '$s = Get-AuthenticodeSignature -LiteralPath $env:PISI_UPDATE_INSTALLER; ' +
        '[pscustomobject]@{ Status = [string]$s.Status; Subject = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress';
    return new Promise((resolve, reject) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
            { env: { ...process.env, PISI_UPDATE_INSTALLER: filePath }, windowsHide: true, timeout: 30 * 1000 },
            (error, stdout) => (error ? reject(error) : resolve(String(stdout || '')))
        );
    });
}

/**
 * With a configured publisher, the installer must carry a valid Authenticode
 * signature from that publisher. Without one the check is skipped and logged.
 */
async function verifyPisiInstallerPublisher(filePath, expectedPublisher, options = {}) {
    if (!String(expectedPublisher || '').trim()) {
        console.warn('[PISI] Authenticode check skipped: no signing identity is configured for this build.');
        return { ok: true, skipped: true };
    }
    if ((options.platform || process.platform) !== 'win32')
        return { ok: false, code: 'AUTHENTICODE_UNAVAILABLE', error: 'The installer signature can only be checked on Windows.' };
    let output = '';
    try {
        output = await (options.runQuery || runPisiAuthenticodeQuery)(filePath);
    } catch (error) {
        console.warn('[PISI] Authenticode check failed:', error?.message || error);
        return { ok: false, code: 'AUTHENTICODE_UNREADABLE', error: 'The installer signature could not be checked.' };
    }
    const result = evaluatePisiAuthenticodeResult(output, expectedPublisher);
    if (!result.ok) console.warn('[PISI] Update installer rejected:', result.code, result.error);
    return result;
}

async function installPendingPisiUpdate() {
    const installer = pendingInstaller;
    if (!installer) {
        return {
            ok: false,
            error: 'No downloaded Pisi update is waiting to be installed.'
        };
    }

    if (!fs.existsSync(installer.path)) {
        pendingInstaller = null;
        patchUpdateState({ downloadedVersion: null });
        return {
            ok: false,
            error: 'Downloaded Pisi update installer is missing.'
        };
    }

    const actualHash = await hashFileSha256(installer.path);
    if (actualHash !== installer.sha256) {
        pendingInstaller = null;
        await fs.promises.rm(installer.path, { force: true }).catch(() => {});
        patchUpdateState({
            downloadedVersion: null,
            error: 'Downloaded update failed final SHA-256 verification.'
        });
        return {
            ok: false,
            error: 'Downloaded Pisi update failed verification.'
        };
    }

    const publisher = await verifyPisiInstallerPublisher(installer.path, resolvePisiUpdateConfiguration().expectedPublisher);
    if (!publisher.ok) {
        pendingInstaller = null;
        await fs.promises.rm(installer.path, { force: true }).catch(() => {});
        patchUpdateState({ downloadedVersion: null, error: publisher.error });
        return {
            ok: false,
            error: 'Downloaded Pisi update failed verification.'
        };
    }

    app.once('will-quit', () => {
        try {
            const child = spawn(installer.path, [], {
                detached: true,
                stdio: 'ignore',
                windowsHide: false
            });
            child.unref();
        } catch (error) {
            console.error('[PISI] Update installer could not be launched:', error);
        }
    });

    app.quit();
    return {
        ok: true,
        installing: true,
        version: installer.version
    };
}

function schedulePisiUpdateChecks() {
    clearTimeout(checkTimer);
    clearInterval(periodicTimer);

    checkTimer = setTimeout(() => {
        void checkPisiForUpdates({ prompt: true });
    }, PISI_UPDATE_CHECK_DELAY_MS);
    checkTimer.unref?.();

    periodicTimer = setInterval(() => {
        void checkPisiForUpdates({ prompt: true });
    }, PISI_UPDATE_CHECK_INTERVAL_MS);
    periodicTimer.unref?.();
}

function initializePisiAutoUpdate() {
    if (initialized) return getPisiUpdateStatus();
    initialized = true;

    let configuration;
    try {
        configuration = resolvePisiUpdateConfiguration();
    } catch (error) {
        patchUpdateState({
            mode: 'disabled',
            managedBy: null,
            currentVersion: app.getVersion(),
            feedConfigured: false,
            checking: false,
            error: error.message
        });
        return getPisiUpdateStatus();
    }

    patchUpdateState({
        mode: configuration.mode,
        managedBy: configuration.managedBy,
        currentVersion: configuration.currentVersion,
        channel: configuration.channel,
        feedConfigured: Boolean(configuration.feed),
        checking: false,
        error: null
    });

    if (configuration.mode === 'store') {
        console.log('[PISI] Updates are managed by Microsoft Store.');
        return getPisiUpdateStatus();
    }

    if (configuration.mode === 'direct') {
        console.log('[PISI] Direct auto-update feed enabled:', configuration.feed.origin);
        schedulePisiUpdateChecks();
    } else if (configuration.mode === 'direct-unsigned') {
        console.warn('[PISI] Direct auto-update disabled: the feed is configured but no update signing key is built in.');
    } else {
        console.log('[PISI] Direct auto-update disabled for distribution mode:', configuration.mode);
    }

    return getPisiUpdateStatus();
}

ipcMain.handle('app:get-update-status', () => getPisiUpdateStatus());
ipcMain.handle('app:check-for-updates', () => checkPisiForUpdates({ prompt: true }));
ipcMain.handle('app:install-update', () => installPendingPisiUpdate());

const moduleApi = {
    initializePisiAutoUpdate,
    checkPisiForUpdates,
    verifyPisiInstallerPublisher
};

registerMainModule('main.autoUpdate', moduleApi);
