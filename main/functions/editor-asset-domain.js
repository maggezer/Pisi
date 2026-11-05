import { modules, registerMainModule } from '../module-registry.js';
import * as editorAssets from './editor-asset-store.js';

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

function installPisiEditorAssetDomainContracts() {
    domain.registerPisiDomainCommand('editor.asset.store.v1', storePisiEditorImageAsset);
    domain.registerPisiDomainQuery('editor.asset.read.v1', readPisiEditorImageAsset);
}

const moduleApi = {
    storePisiEditorImageAsset,
    readPisiEditorImageAsset,
    installPisiEditorAssetDomainContracts
};

registerMainModule('main.editorAssetDomain', moduleApi);
installPisiEditorAssetDomainContracts();
