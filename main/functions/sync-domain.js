import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { dialog, ipcMain } from '../electron-bridge.js';
import * as syncCore from './sync-core.js';
import * as storageLayer from './storage.js';
import * as editorAssets from './editor-asset-store.js';
import { modules, registerMainModule } from '../module-registry.js';

const MANIFEST_RELATIVE = path.join('.pisi-sync', 'manifest.json');
const DEVICES_RELATIVE = path.join('.pisi-sync', 'devices');
const LOCAL_STATE_KEY = '.pisi/sync-state.json';
const MAX_SNAPSHOT_BYTES = 48 * 1024 * 1024;
const SNAPSHOT_CHUNK_BYTES = 4 * 1024 * 1024;
const SNAPSHOT_INDEX_FORMAT = 'pisi-sync-device-index';
const SNAPSHOT_CHUNK_FORMAT = 'pisi-sync-device-chunk';
const runningProjects = new Map();

// The folder-based legacy sync reloaded the whole project after every run and
// could drop unsaved editor text. It stays off until Pisi's own sync replaces it.
// While false, no entry point reads or writes settings, .pisi-sync or sync-state.
const PISI_LEGACY_SYNC_ENABLED = false;
const PISI_SYNC_DISABLED_CODE = 'PISI_SYNC_DISABLED';

function isPisiLegacySyncEnabled() {
    return PISI_LEGACY_SYNC_ENABLED;
}

function pisiSyncDisabledResult() {
    return { ok: false, disabled: true, code: PISI_SYNC_DISABLED_CODE, error: 'Pisi Sync yeni eşleştirme sistemi gelene kadar devre dışı.' };
}

const PISI_SYNC_EDITOR_ASSETS_RELATIVE = path.join('.pisi-sync', 'assets');

function isSameOrInsidePath(candidatePath, rootPath) {
    const candidate = path.resolve(candidatePath);
    const root = path.resolve(rootPath);
    const relative = path.relative(root, candidate);

    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function listPisiSyncEditorAssetReferences(content = '') {
    const references = [];
    const seen = new Set();
    const source = String(content || '');
    const attributePattern = /\sdata-pisi-(?:asset|sheet-asset)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
    let match;

    while ((match = attributePattern.exec(source))) {
        const relativePath = String(match[1] ?? match[2] ?? match[3] ?? '');

        let descriptor = null;
        const paintMatch = relativePath.match(editorAssets.PISI_PAINT_ASSET_PATTERN);
        const sheetMatch = relativePath.match(editorAssets.PISI_SHEET_ASSET_PATTERN);

        if (paintMatch) {
            descriptor = {
                kind: 'paint',
                hash: paintMatch[1],
                relativePath,
                maxBytes: editorAssets.PISI_PAINT_MAX_BYTES
            };
        } else if (sheetMatch) {
            descriptor = {
                kind: 'sheet',
                hash: sheetMatch[1],
                relativePath,
                maxBytes: editorAssets.PISI_SHEET_MAX_BYTES
            };
        }

        if (!descriptor || seen.has(descriptor.relativePath)) continue;

        seen.add(descriptor.relativePath);
        references.push(descriptor);
    }

    return references;
}

function getPisiSyncNodeSidecarPath(projectFolder, entity) {
    const payload = entity?.payload;
    const relativePath = String(payload?.relativePath || '').trim();
    const sidecarName = String(payload?.native?.pisi?.sidecar || '').trim();

    if (!relativePath || !sidecarName || path.basename(sidecarName) !== sidecarName || sidecarName === '.' || sidecarName === '..') {
        return null;
    }

    const nodePath = path.resolve(projectFolder, relativePath);

    if (!isSameOrInsidePath(nodePath, projectFolder) || path.extname(nodePath).toLowerCase() !== '.node') {
        return null;
    }

    const sidecarPath = path.resolve(path.dirname(nodePath), sidecarName);

    return isSameOrInsidePath(sidecarPath, projectFolder) ? sidecarPath : null;
}

function inspectPisiSyncEditorAsset(filePath, descriptor) {
    try {
        if (!fs.existsSync(filePath)) {
            return { exists: false, valid: false };
        }

        const linkStat = fs.lstatSync(filePath);

        if (linkStat.isSymbolicLink()) {
            return {
                exists: true,
                valid: false,
                error: 'Asset sembolik bağlantı olamaz.'
            };
        }

        const stat = fs.statSync(filePath);

        if (!stat.isFile() || stat.size < 1 || stat.size > descriptor.maxBytes) {
            return {
                exists: true,
                valid: false,
                error: 'Asset boyutu veya türü geçersiz.'
            };
        }

        const buffer = fs.readFileSync(filePath);
        const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');

        if (actualHash !== descriptor.hash) {
            return {
                exists: true,
                valid: false,
                error: 'Asset hash doğrulaması başarısız.'
            };
        }

        if (descriptor.kind === 'paint' && !Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).equals(buffer.subarray(0, 8))) {
            return {
                exists: true,
                valid: false,
                error: 'Paint PNG imzası geçersiz.'
            };
        }

        if (descriptor.kind === 'sheet') {
            let snapshot;

            try {
                snapshot = JSON.parse(buffer.toString('utf8'));
            } catch {
                return {
                    exists: true,
                    valid: false,
                    error: 'Sheet asset JSON verisi bozuk.'
                };
            }

            if (
                !snapshot ||
                typeof snapshot !== 'object' ||
                Array.isArray(snapshot) ||
                !Array.isArray(snapshot.fields) ||
                !Array.isArray(snapshot.items) ||
                !Array.isArray(snapshot.views)
            ) {
                return {
                    exists: true,
                    valid: false,
                    error: 'Sheet asset yapısı geçersiz.'
                };
            }
        }

        return { exists: true, valid: true, buffer };
    } catch (error) {
        return {
            exists: true,
            valid: false,
            error: error.message
        };
    }
}

function writePisiSyncEditorAsset(destinationPath, buffer) {
    const directory = path.dirname(destinationPath);
    const temporaryPath = path.join(directory, `.${path.basename(destinationPath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    let descriptor = null;

    globalThis.markInternalFileChange?.(directory, destinationPath, temporaryPath);

    fs.mkdirSync(directory, { recursive: true });

    try {
        descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
        fs.writeFileSync(descriptor, buffer);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;

        if (fs.existsSync(destinationPath)) {
            fs.unlinkSync(destinationPath);
        }

        fs.renameSync(temporaryPath, destinationPath);

        globalThis.sealInternalFileChange?.(directory, destinationPath, temporaryPath);
    } catch (error) {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor);
            } catch {}
        }

        try {
            if (fs.existsSync(temporaryPath)) {
                fs.unlinkSync(temporaryPath);
            }
        } catch {}

        globalThis.sealInternalFileChange?.(temporaryPath);
        throw error;
    }
}

function reconcilePisiSyncEditorAssets(projectFolder, syncFolder, entities = []) {
    const warnings = [];
    let uploaded = 0;
    let downloaded = 0;

    for (const entity of entities) {
        if (entity?.kind !== 'node') continue;

        const references = listPisiSyncEditorAssetReferences(entity?.payload?.content || '');

        if (!references.length) continue;

        const sidecarPath = getPisiSyncNodeSidecarPath(projectFolder, entity);

        if (!sidecarPath) {
            warnings.push(`Editor asset sidecar yolu çözülemedi: ${entity?.id || 'node'}`);
            continue;
        }

        for (const descriptor of references) {
            const parts = descriptor.relativePath.split('/');
            const localPath = path.join(sidecarPath, ...parts);
            const remotePath = path.join(syncFolder, PISI_SYNC_EDITOR_ASSETS_RELATIVE, ...parts);

            const local = inspectPisiSyncEditorAsset(localPath, descriptor);
            const remote = inspectPisiSyncEditorAsset(remotePath, descriptor);

            try {
                if (local.valid && !remote.valid) {
                    writePisiSyncEditorAsset(remotePath, local.buffer);
                    uploaded += 1;
                    continue;
                }

                if (!local.valid && remote.valid) {
                    writePisiSyncEditorAsset(localPath, remote.buffer);
                    downloaded += 1;
                    continue;
                }

                if (!local.valid && !remote.valid) {
                    warnings.push(`Editor asset bulunamadı veya bozuk: ${descriptor.relativePath}`);
                }
            } catch (error) {
                warnings.push(`Editor asset sync hatası (${descriptor.relativePath}): ${error.message}`);
            }
        }
    }

    return {
        uploaded,
        downloaded,
        warnings
    };
}

function projectKey(projectFolder) {
    return crypto.createHash('sha256').update(path.resolve(projectFolder).toLowerCase()).digest('hex').slice(0, 24);
}

function defaultDeviceName() {
    return `${String(os.hostname() || 'Bilgisayar').slice(0, 80)} · Masaüstü`;
}

function getGlobalConfig() {
    const settings = modules['main.pathSecurity'].readSettings();
    const sync = settings.pisiSync && typeof settings.pisiSync === 'object' ? settings.pisiSync : {};
    return {
        settings,
        sync: {
            deviceId: /^device_[A-Za-z0-9._:-]{4,180}$/.test(String(sync.deviceId || '')) ? sync.deviceId : `device_${crypto.randomUUID()}`,
            deviceName: String(sync.deviceName || defaultDeviceName()).slice(0, 120),
            projects: sync.projects && typeof sync.projects === 'object' ? sync.projects : {}
        }
    };
}

function saveGlobalConfig(settings, sync) {
    settings.pisiSync = sync;
    modules['main.pathSecurity'].writeSettings(settings);
}

function activeProject() {
    const folder = globalThis.activeProjectFolder;
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        throw new Error('Önce bir Pisi projesi açın.');
    }
    return fs.realpathSync.native(folder);
}

function configuredFolder(projectFolder) {
    const config = getGlobalConfig();
    const project = config.sync.projects[projectKey(projectFolder)] || {};
    const folder = project.folderPath ? path.resolve(project.folderPath) : null;
    return { ...config, project, folder };
}

function assertFolder(folderPath, projectFolder) {
    const folder = fs.realpathSync.native(folderPath);
    if (!fs.statSync(folder).isDirectory()) throw new Error('Sync hedefi bir klasör olmalı.');
    const relativeFromProject = path.relative(projectFolder, folder);
    const relativeFromSync = path.relative(folder, projectFolder);
    if (relativeFromProject === '') return folder;
    const nested = (relative) => relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    if (nested(relativeFromProject) || nested(relativeFromSync)) {
        throw new Error('Proje kökünün kendisini seçin; proje içindeki bir alt klasör veya üst klasör kullanılamaz.');
    }
    return folder;
}

function atomicWriteJson(filePath, value) {
    const content = JSON.stringify(value);
    if (Buffer.byteLength(content, 'utf8') > MAX_SNAPSHOT_BYTES) {
        throw new Error('Sync anlık görüntüsü 48 MB sınırını aşıyor. Büyük çizimleri ayrı yedekleyin.');
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    const previous = `${temporary}.previous`;
    let descriptor = null;
    try {
        descriptor = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(descriptor, content, 'utf8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;
        if (process.platform === 'win32' && fs.existsSync(filePath)) {
            fs.renameSync(filePath, previous);
            try {
                fs.renameSync(temporary, filePath);
            } catch (error) {
                fs.renameSync(previous, filePath);
                throw error;
            }
            fs.unlinkSync(previous);
        } else {
            fs.renameSync(temporary, filePath);
        }
    } finally {
        if (descriptor !== null)
            try {
                fs.closeSync(descriptor);
            } catch {}
        if (fs.existsSync(temporary))
            try {
                fs.unlinkSync(temporary);
            } catch {}
        if (fs.existsSync(previous) && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(previous);
            } catch {}
        }
    }
}

function readJson(filePath, options = {}) {
    if (!fs.existsSync(filePath)) {
        if (options.optional) return null;
        throw new Error(`Sync dosyası bulunamadı: ${path.basename(filePath)}`);
    }
    const linkStat = fs.lstatSync(filePath);
    if (linkStat.isSymbolicLink()) throw new Error('Sync dosyası sembolik bağlantı olamaz.');
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) {
        throw new Error(`Sync dosyası geçersiz veya çok büyük: ${path.basename(filePath)}`);
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        throw new Error(`Sync dosyası bozuk: ${path.basename(filePath)}`);
    }
}

function snapshotChunkGroups(records) {
    const groups = [];
    let current = [];
    let currentBytes = 0;
    for (const record of records || []) {
        const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8') + 2;
        if (bytes > MAX_SNAPSHOT_BYTES - 1024) {
            throw new Error(`Tek bir Sync kaydı 48 MB sınırını aşıyor: ${record.key}`);
        }
        if (current.length && currentBytes + bytes > SNAPSHOT_CHUNK_BYTES) {
            groups.push(current);
            current = [];
            currentBytes = 0;
        }
        current.push(record);
        currentBytes += bytes;
    }
    if (current.length || !groups.length) groups.push(current);
    return groups;
}

function writeDeviceSnapshot(folder, snapshot) {
    const generation = `g${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
    const directory = path.join(folder, DEVICES_RELATIVE, snapshot.deviceId);
    fs.mkdirSync(directory, { recursive: true });
    const chunks = [];
    const groups = snapshotChunkGroups(snapshot.records);
    for (let index = 0; index < groups.length; index += 1) {
        const name = `${generation}_${String(index + 1).padStart(4, '0')}.json`;
        atomicWriteJson(path.join(directory, name), {
            format: SNAPSHOT_CHUNK_FORMAT,
            version: 1,
            projectId: snapshot.projectId,
            deviceId: snapshot.deviceId,
            index,
            records: groups[index]
        });
        chunks.push(name);
    }
    atomicWriteJson(path.join(directory, 'index.json'), {
        format: SNAPSHOT_INDEX_FORMAT,
        version: 1,
        projectId: snapshot.projectId,
        deviceId: snapshot.deviceId,
        deviceName: snapshot.deviceName,
        clock: snapshot.clock,
        createdAt: snapshot.createdAt,
        chunks
    });
    const keep = new Set(['index.json', ...chunks]);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && /^[A-Za-z0-9._:-]+\.json$/.test(entry.name) && !keep.has(entry.name)) {
            try {
                fs.unlinkSync(path.join(directory, entry.name));
            } catch {}
        }
    }
}

function readLocalState(projectFolder, deviceId) {
    const storage = storageLayer.getPisiProjectStorage(projectFolder);
    const read = storage.readJson(LOCAL_STATE_KEY, { allowMissing: true });
    const data = read.ok && !read.missing ? read.data : {};
    if (data?.deviceId !== deviceId) {
        return {
            deviceId,
            projectId: null,
            clock: 0,
            records: [],
            handledConflicts: [],
            lastSyncAt: null,
            lastResult: null
        };
    }
    return {
        deviceId,
        projectId: data.projectId || null,
        clock: Math.max(0, Number(data.clock) || 0),
        records: Array.isArray(data.records) ? data.records : [],
        handledConflicts: Array.isArray(data.handledConflicts) ? data.handledConflicts.slice(-256) : [],
        lastSyncAt: data.lastSyncAt || null,
        lastResult: data.lastResult || null
    };
}

function writeLocalState(projectFolder, state) {
    const storage = storageLayer.getPisiProjectStorage(projectFolder);
    const result = storage.writeJson(LOCAL_STATE_KEY, state, {
        backup: false,
        newline: true,
        hiddenParent: true
    });
    if (!result.ok) throw new Error(result.error || 'Yerel sync durumu yazılamadı.');
}

function ensureManifest(folder, state, deviceId) {
    const filePath = path.join(folder, MANIFEST_RELATIVE);
    const existing = readJson(filePath, { optional: true });
    if (existing) {
        const manifest = syncCore.validateSyncManifest(existing);
        if (state.projectId && state.projectId !== manifest.projectId) {
            state.records = [];
            state.clock = 0;
            state.handledConflicts = [];
        }
        state.projectId = manifest.projectId;
        return manifest;
    }
    const manifest = syncCore.makeSyncManifest({
        projectId: state.projectId || `project_${crypto.randomUUID()}`,
        createdBy: deviceId
    });
    atomicWriteJson(filePath, manifest);
    state.projectId = manifest.projectId;
    return manifest;
}

function readSnapshots(folder, projectId) {
    const directory = path.join(folder, DEVICES_RELATIVE);
    if (!fs.existsSync(directory)) return { snapshots: [], warnings: [] };
    const snapshots = [];
    const warnings = [];
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    const names = entries
        .filter((entry) => entry.isFile() && /^device_[A-Za-z0-9._:-]{4,180}\.json$/.test(entry.name))
        .map((entry) => entry.name)
        .sort()
        .slice(0, 200);
    for (const name of names) {
        try {
            const snapshot = readJson(path.join(directory, name));
            if (snapshot?.projectId === projectId) snapshots.push(snapshot);
        } catch (error) {
            warnings.push(error.message);
        }
    }
    const deviceDirectories = entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && /^device_[A-Za-z0-9._:-]{4,180}$/.test(entry.name))
        .slice(0, 200);
    for (const entry of deviceDirectories) {
        try {
            const deviceDirectory = path.join(directory, entry.name);
            const index = readJson(path.join(deviceDirectory, 'index.json'));
            if (
                index?.format !== SNAPSHOT_INDEX_FORMAT ||
                index.version !== 1 ||
                index.projectId !== projectId ||
                !Array.isArray(index.chunks) ||
                index.chunks.length > 500
            )
                continue;
            const records = [];
            for (const name of index.chunks) {
                if (!/^g[A-Za-z0-9_:-]{4,80}_\d{4}\.json$/.test(String(name))) {
                    throw new Error('Sync parça adı geçersiz.');
                }
                const chunk = readJson(path.join(deviceDirectory, name));
                if (
                    chunk?.format !== SNAPSHOT_CHUNK_FORMAT ||
                    chunk.version !== 1 ||
                    chunk.projectId !== projectId ||
                    chunk.deviceId !== index.deviceId ||
                    !Array.isArray(chunk.records)
                )
                    throw new Error('Sync parçası doğrulanamadı.');
                records.push(...chunk.records);
            }
            snapshots.push(syncCore.makeDeviceSnapshot({ ...index, records }));
        } catch (error) {
            warnings.push(error.message);
        }
    }
    return { snapshots, warnings };
}

function collectConflicts(baseRecords, localRecords, snapshots, ownDeviceId, handled = []) {
    const unique = new Map();
    const handledSet = new Set(handled);
    for (const snapshot of snapshots) {
        if (snapshot.deviceId === ownDeviceId) continue;
        const plan = syncCore.planMergedRecords({
            baseRecords,
            localRecords,
            remoteRecords: snapshot.records || []
        });
        for (const conflict of plan.conflicts) {
            const signature = `${conflict.key}:${conflict.loser?.hash}:${conflict.loser?.version?.deviceId}`;
            if (!handledSet.has(signature)) unique.set(signature, conflict);
        }
    }
    return {
        conflicts: Array.from(unique.values()),
        signatures: Array.from(unique.keys())
    };
}

function preserveRemoteDefaultsOnFirstJoin(entities, remoteRecords, stateRecords) {
    if (stateRecords.length) return entities;
    const remote = new Set((remoteRecords || []).filter((record) => !record.deleted).map((record) => record.key));
    return entities.filter((entity) => {
        if (entity.kind !== 'config' || !remote.has(`config:${entity.id}`)) return true;
        const value = entity.payload?.value;
        return !(Array.isArray(value) && value.length === 0);
    });
}

async function performPisiSync(projectFolder, folder, reason = 'manual') {
    const globalConfig = getGlobalConfig();
    const { deviceId, deviceName } = globalConfig.sync;
    const state = readLocalState(projectFolder, deviceId);
    ensureManifest(folder, state, deviceId);
    const remote = readSnapshots(folder, state.projectId);
    const foldedBefore = syncCore.foldDeviceSnapshots(remote.snapshots, state.projectId);
    const entities = preserveRemoteDefaultsOnFirstJoin(
        modules['main.syncProjectAdapter'].exportPisiSyncEntities(projectFolder),
        foldedBefore.records,
        state.records
    );
    const editorAssetsBefore = reconcilePisiSyncEditorAssets(projectFolder, folder, entities);
    const prepared = syncCore.prepareDeviceRecords({
        entities,
        baseRecords: state.records,
        deviceId,
        clock: Math.max(state.clock, foldedBefore.clock)
    });
    const detectedConflicts = collectConflicts(state.records, prepared.records, remote.snapshots, deviceId, state.handledConflicts);
    const conflicts = detectedConflicts.conflicts;
    const localSnapshot = syncCore.makeDeviceSnapshot({
        projectId: state.projectId,
        deviceId,
        deviceName,
        records: prepared.records,
        clock: prepared.clock
    });
    const folded = syncCore.foldDeviceSnapshots([...remote.snapshots, localSnapshot], state.projectId);
    const plan = syncCore.planMergedRecords({
        baseRecords: state.records,
        localRecords: prepared.records,
        remoteRecords: folded.records
    });
    const applied =
        plan.apply.length || conflicts.length
            ? await Promise.resolve(
                  modules['main.atomicMutation'].runPisiAtomicMutation(projectFolder, 'sync.apply.v1', () =>
                      modules['main.syncProjectAdapter'].applyPisiSyncRecords(projectFolder, plan.records, conflicts)
                  )
              )
            : { documents: 0, tasks: 0, conflicts: 0, recoveredToSyncTrash: 0 };
    const finalEntities = modules['main.syncProjectAdapter'].exportPisiSyncEntities(projectFolder);
    const editorAssetsAfter = reconcilePisiSyncEditorAssets(projectFolder, folder, finalEntities);
    const finalized = syncCore.prepareDeviceRecords({
        entities: finalEntities,
        baseRecords: plan.records,
        deviceId,
        clock: Math.max(prepared.clock, folded.clock)
    });
    const snapshot = syncCore.makeDeviceSnapshot({
        projectId: state.projectId,
        deviceId,
        deviceName,
        records: finalized.records,
        clock: finalized.clock
    });
    const ownSnapshotIsCurrent = remote.snapshots.some(
        (item) => item.deviceId === deviceId && syncCore.hashValue(item.records || []) === syncCore.hashValue(snapshot.records)
    );
    if (!ownSnapshotIsCurrent) writeDeviceSnapshot(folder, snapshot);
    const baseSummary = syncCore.summarizeSyncPlan(plan);
    const result = {
        ...baseSummary,
        conflicts: applied.conflicts,
        recoveredToSyncTrash: applied.recoveredToSyncTrash,
        filesVerified: finalized.records.filter((record) => !record.deleted && (record.kind === 'node' || record.kind === 'map')).length,
        warnings: [...remote.warnings, ...editorAssetsBefore.warnings, ...editorAssetsAfter.warnings],
        editorAssetsUploaded: editorAssetsBefore.uploaded + editorAssetsAfter.uploaded,
        editorAssetsDownloaded: editorAssetsBefore.downloaded + editorAssetsAfter.downloaded,
        devices:
            new Set(remote.snapshots.map((item) => item.deviceId).filter(Boolean)).size + (remote.snapshots.some((item) => item.deviceId === deviceId) ? 0 : 1),
        reason,
        syncedAt: new Date().toISOString()
    };
    writeLocalState(projectFolder, {
        deviceId,
        projectId: state.projectId,
        clock: finalized.clock,
        records: finalized.records,
        handledConflicts: Array.from(new Set([...state.handledConflicts, ...detectedConflicts.signatures])).slice(-256),
        lastSyncAt: result.syncedAt,
        lastResult: result
    });
    return result;
}

function runPisiSync(options = {}) {
    if (!isPisiLegacySyncEnabled()) return Promise.resolve(pisiSyncDisabledResult());
    const projectFolder = activeProject();
    const configured = configuredFolder(projectFolder);
    if (!configured.folder || !fs.existsSync(configured.folder)) {
        return Promise.reject(new Error('Önce bir Pisi Sync klasörü seçin.'));
    }
    const folder = assertFolder(configured.folder, projectFolder);
    const key = projectKey(projectFolder);
    if (!runningProjects.has(key)) {
        runningProjects.set(
            key,
            Promise.resolve()
                .then(() => performPisiSync(projectFolder, folder, String(options.reason || 'manual')))
                .finally(() => runningProjects.delete(key))
        );
    }
    return runningProjects.get(key);
}

async function selectPisiSyncFolder() {
    if (!isPisiLegacySyncEnabled()) return pisiSyncDisabledResult();
    const projectFolder = activeProject();
    /** @type {import('electron').OpenDialogOptions} */
    const options = {
        title: 'Açık Pisi projesinin kök klasörünü seç',
        defaultPath: projectFolder,
        properties: ['openDirectory', 'createDirectory']
    };
    const owner = globalThis.mainWindow;
    const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: false, canceled: true };
    const folder = assertFolder(selection.filePaths[0], projectFolder);
    const config = getGlobalConfig();
    config.sync.projects[projectKey(projectFolder)] = {
        projectPath: projectFolder,
        folderPath: folder
    };
    saveGlobalConfig(config.settings, config.sync);
    const result = await runPisiSync({ reason: 'folder-selected' });
    return { ok: true, folderName: path.basename(folder), folderPath: folder, result };
}

function getPisiSyncStatus() {
    if (!isPisiLegacySyncEnabled()) return { ok: true, enabled: false, configured: false, running: false };
    try {
        const projectFolder = activeProject();
        const config = configuredFolder(projectFolder);
        const state = readLocalState(projectFolder, config.sync.deviceId);
        return {
            ok: true,
            enabled: true,
            configured: Boolean(config.folder && fs.existsSync(config.folder)),
            folderName: config.folder ? path.basename(config.folder) : '',
            folderPath: config.folder || '',
            usesProjectRoot: Boolean(config.folder && path.resolve(config.folder) === path.resolve(projectFolder)),
            projectId: state.projectId,
            deviceId: config.sync.deviceId,
            lastSyncAt: state.lastSyncAt,
            lastResult: state.lastResult,
            running: runningProjects.has(projectKey(projectFolder))
        };
    } catch (error) {
        return { ok: false, enabled: true, configured: false, running: false, error: error.message };
    }
}

function disconnectPisiSync() {
    if (!isPisiLegacySyncEnabled()) return pisiSyncDisabledResult();
    const projectFolder = activeProject();
    const config = getGlobalConfig();
    delete config.sync.projects[projectKey(projectFolder)];
    saveGlobalConfig(config.settings, config.sync);
    return { ok: true };
}

function installPisiSyncIpc() {
    ipcMain.handle('pisi-sync:status', () => getPisiSyncStatus());
    ipcMain.handle('pisi-sync:select-folder', () => selectPisiSyncFolder());
    ipcMain.handle('pisi-sync:run', (_event, options) => runPisiSync(options || {}));
    ipcMain.handle('pisi-sync:disconnect', () => disconnectPisiSync());
}

const moduleApi = {
    PISI_SYNC_DISABLED_CODE,
    isPisiLegacySyncEnabled,
    MANIFEST_RELATIVE,
    DEVICES_RELATIVE,
    atomicWriteJson,
    assertFolder,
    readSnapshots,
    performPisiSync,
    runPisiSync,
    selectPisiSyncFolder,
    getPisiSyncStatus,
    disconnectPisiSync,
    installPisiSyncIpc
};

registerMainModule('main.syncDomain', moduleApi);
installPisiSyncIpc();
