import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, shell } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';
import * as editorAssets from './editor-asset-store.js';
import * as fileAssets from './editor-file-asset-store.js';

const domain = modules['main.domainCommandQuery'];
const electronIpc = modules['main.electronIpc'];
const documentStore = modules['main.documentStore'];

// Image assets live in the owning node's sidecar folder. The renderer only ever
// names a node inside the active project and a content-addressed reference;
// main resolves every filesystem path itself.
function resolvePisiEditorAssetNode(nodePath) {
    const safeNodePath = electronIpc.assertProjectPath(nodePath, { type: 'file', extensions: ['.node'] });
    const ensured = documentStore.ensurePisiFileMetadata(safeNodePath);
    if (!ensured.ok) throw new Error(ensured.error || 'Not okunamadı.');
    if (!ensured.sidecarPath) throw new Error('Not yan klasörü bulunamadı.');
    return ensured.sidecarPath;
}

function toPisiAssetBuffer(bytes) {
    if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
    return null;
}

function storePisiEditorImageAsset(payload = {}) {
    const sidecarPath = resolvePisiEditorAssetNode(payload.nodePath);
    const buffer = toPisiAssetBuffer(payload.bytes);
    if (!buffer) return { ok: false, code: 'IMAGE_EMPTY', error: 'Görsel verisi boş.' };
    return editorAssets.writePisiImageAsset(sidecarPath, buffer);
}

function readPisiEditorImageAsset(payload = {}) {
    const sidecarPath = resolvePisiEditorAssetNode(payload.nodePath);
    const result = editorAssets.readPisiImageAsset(sidecarPath, payload.reference);
    if (!result.ok) return result;
    return { ok: true, reference: result.reference, mime: result.mime, width: result.width, height: result.height, bytes: new Uint8Array(result.buffer) };
}

function storePisiEditorFileAsset(payload = {}) {
    const sidecarPath = resolvePisiEditorAssetNode(payload.nodePath);
    const buffer = toPisiAssetBuffer(payload.bytes);
    if (!buffer) return { ok: false, code: 'FILE_EMPTY', error: 'Dosya boş.' };
    return fileAssets.writePisiFileAsset(sidecarPath, buffer, payload.name);
}

function withoutPisiAssetPath(result) {
    if (!result?.ok) return result;
    const { assetPath: _assetPath, ...rest } = result;
    return rest;
}

function statPisiEditorFileAsset(payload = {}) {
    return withoutPisiAssetPath(fileAssets.statPisiFileAsset(resolvePisiEditorAssetNode(payload.nodePath), payload.reference));
}

function copyPisiEditorFileAsset(payload = {}) {
    const sourceSidecar = resolvePisiEditorAssetNode(payload.sourceNodePath);
    const targetSidecar = resolvePisiEditorAssetNode(payload.nodePath);
    return fileAssets.copyPisiFileAsset(sourceSidecar, targetSidecar, payload.reference);
}

function isPisiFileOpenCaptureEnabled() {
    // Test-only: E2E runs record the request instead of launching another app.
    return !app.isPackaged && process.env.PISI_TEST_CAPTURE_EXTERNAL === '1';
}

/**
 * Opens an attachment in the system's default app. Executables, and requests
 * with reveal: true, are only shown in their folder. The path is resolved by
 * main from a note inside the active project and a content-addressed reference.
 */
async function openPisiEditorFileAsset(payload = {}) {
    const stat = fileAssets.statPisiFileAsset(resolvePisiEditorAssetNode(payload.nodePath), payload.reference);
    if (!stat.ok) return stat;
    const assetPath = electronIpc.assertProjectPath(stat.assetPath, { type: 'file' });
    const action = stat.executable || payload.reveal === true ? 'revealed' : 'opened';
    if (isPisiFileOpenCaptureEnabled()) {
        fs.appendFileSync(path.join(app.getPath('userData'), 'pisi-file-open.log'), `${action} ${assetPath}\n`, 'utf8');
        return { ok: true, action, executable: stat.executable };
    }
    if (action === 'revealed') {
        shell.showItemInFolder(assetPath);
        return { ok: true, action, executable: stat.executable };
    }
    const error = await shell.openPath(assetPath);
    if (error) return { ok: false, code: 'FILE_OPEN_FAILED', error };
    return { ok: true, action, executable: false };
}

function installPisiEditorAssetDomainContracts() {
    domain.registerPisiDomainCommand('editor.asset.store.v1', storePisiEditorImageAsset);
    domain.registerPisiDomainQuery('editor.asset.read.v1', readPisiEditorImageAsset);
    domain.registerPisiDomainCommand('editor.file.store.v1', storePisiEditorFileAsset);
    domain.registerPisiDomainCommand('editor.file.copy.v1', copyPisiEditorFileAsset);
    domain.registerPisiDomainCommand('editor.file.open.v1', openPisiEditorFileAsset);
    domain.registerPisiDomainQuery('editor.file.stat.v1', statPisiEditorFileAsset);
}

const moduleApi = {
    storePisiEditorImageAsset,
    readPisiEditorImageAsset,
    storePisiEditorFileAsset,
    statPisiEditorFileAsset,
    copyPisiEditorFileAsset,
    openPisiEditorFileAsset,
    installPisiEditorAssetDomainContracts
};

registerMainModule('main.editorAssetDomain', moduleApi);
installPisiEditorAssetDomainContracts();
