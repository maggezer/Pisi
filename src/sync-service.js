import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { getSetting, setSetting } from './db.js';
import {
  foldDeviceSnapshots, makeDeviceSnapshot, makeSyncManifest,
  hashValue, planMergedRecords, prepareDeviceRecords, summarizeSyncPlan,
  validateSyncManifest
} from './sync-core.js';
import { applyMobileSyncRecords, exportMobileSyncEntities } from './sync-adapter.js';

const NativeFolder = registerPlugin('PisiSyncFolder');
const STATE_KEY = 'pisiSyncState';
const HANDLE_KEY = 'pisiSyncDirectoryHandle';
const MANIFEST_PATH = '.pisi-sync/manifest.json';
const DEVICES_PATH = '.pisi-sync/devices';
const MAX_SNAPSHOT_BYTES = 48 * 1024 * 1024;
const SNAPSHOT_CHUNK_BYTES = 4 * 1024 * 1024;
const SNAPSHOT_INDEX_FORMAT = 'pisi-sync-device-index';
const SNAPSHOT_CHUNK_FORMAT = 'pisi-sync-device-chunk';

let runningPromise = null;
let autoTimer = null;
let suppressAutoUntil = 0;

function newId(prefix) {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

async function getState() {
  const stored = await getSetting(STATE_KEY, {});
  return {
    projectId: stored?.projectId || null,
    deviceId: stored?.deviceId || newId('device'),
    deviceName: stored?.deviceName || `Android ${navigator.userAgent.includes('Tablet') ? 'tablet' : 'telefon'}`,
    folderName: stored?.folderName || '',
    clock: Math.max(0, Number(stored?.clock) || 0),
    records: Array.isArray(stored?.records) ? stored.records : [],
    handledConflicts: Array.isArray(stored?.handledConflicts)
      ? stored.handledConflicts.slice(-256) : [],
    lastSyncAt: stored?.lastSyncAt || null,
    lastResult: stored?.lastResult || null,
    enabled: stored?.enabled === true
  };
}

async function saveState(state) {
  await setSetting(STATE_KEY, state);
  return state;
}

async function getWebRoot(request = false) {
  let handle = await getSetting(HANDLE_KEY, null);
  if (request) {
    if (!window.showDirectoryPicker) throw new Error('Bu tarayıcı klasör erişimini desteklemiyor.');
    handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await setSetting(HANDLE_KEY, handle);
  }
  if (!handle) return null;
  let permission = await handle.queryPermission?.({ mode: 'readwrite' });
  if (permission !== 'granted' && request) {
    permission = await handle.requestPermission?.({ mode: 'readwrite' });
  }
  return permission === 'granted' ? handle : null;
}

async function webPath(path, { create = false, file = false } = {}) {
  const root = await getWebRoot(false);
  if (!root) throw new Error('Önce bir Pisi Sync klasörü seçin.');
  const segments = String(path || '').split('/').filter(Boolean);
  let directory = root;
  const directorySegments = file ? segments.slice(0, -1) : segments;
  for (const segment of directorySegments) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  if (!file) return directory;
  try {
    return await directory.getFileHandle(segments.at(-1), { create });
  } catch (error) {
    if (error?.name === 'NotFoundError') return null;
    throw error;
  }
}

async function listWebFiles(path) {
  let directory;
  try { directory = await webPath(path); } catch (error) {
    if (error?.name === 'NotFoundError') return [];
    throw error;
  }
  const files = [];
  const visit = async (current, prefix = '') => {
    for await (const [name, handle] of current.entries()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') await visit(handle, relative);
      else if (handle.kind === 'file' && name.endsWith('.json')) files.push(relative);
    }
  };
  await visit(directory);
  return files;
}

const transport = {
  async choose() {
    if (Capacitor.isNativePlatform()) return NativeFolder.chooseFolder();
    const root = await getWebRoot(true);
    return { configured: true, name: root.name };
  },
  async status() {
    if (Capacitor.isNativePlatform()) return NativeFolder.getFolder();
    const root = await getWebRoot(false);
    return { configured: Boolean(root), name: root?.name || '' };
  },
  async read(path) {
    if (Capacitor.isNativePlatform()) {
      const result = await NativeFolder.readText({ path });
      return result.exists ? result.content : null;
    }
    const handle = await webPath(path, { file: true });
    if (!handle) return null;
    return (await handle.getFile()).text();
  },
  async write(path, content) {
    if (new Blob([content]).size > MAX_SNAPSHOT_BYTES) {
      throw new Error('Sync anlık görüntüsü 48 MB sınırını aşıyor. Büyük çizimleri ayrı yedekleyin.');
    }
    if (Capacitor.isNativePlatform()) return NativeFolder.writeText({ path, content });
    const handle = await webPath(path, { create: true, file: true });
    const writable = await handle.createWritable();
    try { await writable.write(content); } finally { await writable.close(); }
    return { ok: true };
  },
  async list(path) {
    if (Capacitor.isNativePlatform()) {
      return (await NativeFolder.listFiles({ path })).files || [];
    }
    return listWebFiles(path);
  },
  async delete(path) {
    if (Capacitor.isNativePlatform()) return NativeFolder.deleteFile({ path });
    const segments = String(path || '').split('/').filter(Boolean);
    if (!segments.length) return { ok: true };
    const parent = await webPath(segments.slice(0, -1).join('/'));
    try { await parent.removeEntry(segments.at(-1)); } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
    }
    return { ok: true };
  },
  async disconnect() {
    if (Capacitor.isNativePlatform()) await NativeFolder.disconnect();
    else await setSetting(HANDLE_KEY, null);
  }
};

async function readJson(path, { optional = false } = {}) {
  const content = await transport.read(path);
  if (content == null) {
    if (optional) return null;
    throw new Error(`Sync dosyası bulunamadı: ${path}`);
  }
  try { return JSON.parse(content); } catch {
    throw new Error(`Sync dosyası bozuk: ${path}`);
  }
}

async function ensureManifest(state) {
  const existing = await readJson(MANIFEST_PATH, { optional: true });
  if (existing) {
    const manifest = validateSyncManifest(existing);
    if (state.projectId && state.projectId !== manifest.projectId) {
      state.records = [];
      state.clock = 0;
      state.handledConflicts = [];
    }
    state.projectId = manifest.projectId;
    return manifest;
  }
  const manifest = makeSyncManifest({
    projectId: state.projectId || newId('project'), createdBy: state.deviceId
  });
  await transport.write(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  state.projectId = manifest.projectId;
  return manifest;
}

function snapshotChunkGroups(records) {
  const encoder = new TextEncoder();
  const groups = [];
  let current = [];
  let currentBytes = 0;
  for (const record of records || []) {
    const bytes = encoder.encode(JSON.stringify(record)).byteLength + 2;
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

async function writeDeviceSnapshot(snapshot) {
  const generation = `g${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const directory = `${DEVICES_PATH}/${snapshot.deviceId}`;
  const chunks = [];
  const groups = snapshotChunkGroups(snapshot.records);
  for (let index = 0; index < groups.length; index += 1) {
    const name = `${generation}_${String(index + 1).padStart(4, '0')}.json`;
    const chunk = {
      format: SNAPSHOT_CHUNK_FORMAT,
      version: 1,
      projectId: snapshot.projectId,
      deviceId: snapshot.deviceId,
      index,
      records: groups[index]
    };
    await transport.write(`${directory}/${name}`, JSON.stringify(chunk));
    chunks.push(name);
  }
  const index = {
    format: SNAPSHOT_INDEX_FORMAT,
    version: 1,
    projectId: snapshot.projectId,
    deviceId: snapshot.deviceId,
    deviceName: snapshot.deviceName,
    clock: snapshot.clock,
    createdAt: snapshot.createdAt,
    chunks
  };
  await transport.write(`${directory}/index.json`, JSON.stringify(index));
  await transport.delete(`${DEVICES_PATH}/${snapshot.deviceId}.json`).catch(() => {});
  const keep = new Set(['index.json', ...chunks]);
  const oldFiles = await transport.list(directory).catch(() => []);
  for (const name of oldFiles) {
    if (/^[A-Za-z0-9._:-]+\.json$/.test(name) && !keep.has(name)) {
      await transport.delete(`${directory}/${name}`).catch(() => {});
    }
  }
}

async function readSnapshots(projectId) {
  const names = await transport.list(DEVICES_PATH);
  const snapshots = [];
  const warnings = [];
  const legacy = names.filter((value) => /^device_[A-Za-z0-9._:-]{4,180}\.json$/.test(value));
  const indexes = names.filter((value) =>
    /^device_[A-Za-z0-9._:-]{4,180}\/index\.json$/.test(value)
  );
  for (const name of legacy.slice(0, 200)) {
    try {
      const snapshot = await readJson(`${DEVICES_PATH}/${name}`);
      if (snapshot?.projectId === projectId) snapshots.push(snapshot);
    } catch (error) {
      warnings.push(error.message);
    }
  }
  for (const indexPath of indexes.slice(0, 200)) {
    try {
      const index = await readJson(`${DEVICES_PATH}/${indexPath}`);
      if (
        index?.format !== SNAPSHOT_INDEX_FORMAT || index.version !== 1 ||
        index.projectId !== projectId || !Array.isArray(index.chunks) || index.chunks.length > 500
      ) continue;
      const deviceDirectory = indexPath.slice(0, -'/index.json'.length);
      const records = [];
      for (const name of index.chunks) {
        if (!/^g[A-Za-z0-9_:-]{4,80}_\d{4}\.json$/.test(String(name))) {
          throw new Error('Sync parça adı geçersiz.');
        }
        const chunk = await readJson(`${DEVICES_PATH}/${deviceDirectory}/${name}`);
        if (
          chunk?.format !== SNAPSHOT_CHUNK_FORMAT || chunk.version !== 1 ||
          chunk.projectId !== projectId || chunk.deviceId !== index.deviceId ||
          !Array.isArray(chunk.records)
        ) throw new Error('Sync parçası doğrulanamadı.');
        records.push(...chunk.records);
      }
      snapshots.push(makeDeviceSnapshot({ ...index, records }));
    } catch (error) {
      warnings.push(error.message);
    }
  }
  return { snapshots, warnings };
}

function collectConflicts(baseRecords, localRecords, snapshots, ownDeviceId, handled = []) {
  const bySignature = new Map();
  const handledSet = new Set(handled);
  for (const snapshot of snapshots) {
    if (snapshot.deviceId === ownDeviceId) continue;
    const plan = planMergedRecords({
      baseRecords, localRecords, remoteRecords: snapshot.records || []
    });
    for (const conflict of plan.conflicts) {
      const signature = `${conflict.key}:${conflict.loser?.hash}:${conflict.loser?.version?.deviceId}`;
      if (!handledSet.has(signature)) bySignature.set(signature, conflict);
    }
  }
  return {
    conflicts: Array.from(bySignature.values()),
    signatures: Array.from(bySignature.keys())
  };
}

function preserveRemoteDefaultsOnFirstJoin(entities, remoteRecords, stateRecords) {
  if (stateRecords.length) return entities;
  const remote = new Set((remoteRecords || [])
    .filter((record) => !record.deleted)
    .map((record) => record.key));
  return entities.filter((entity) => {
    if (entity.kind !== 'config' || !remote.has(`config:${entity.id}`)) return true;
    const value = entity.payload?.value;
    return !(Array.isArray(value) && value.length === 0);
  });
}

async function performSync(reason = 'manual') {
  const folder = await transport.status();
  if (!folder.configured) throw new Error('Önce bir Pisi Sync klasörü seçin.');
  const state = await getState();
  state.enabled = true;
  state.folderName = folder.name || state.folderName;
  await ensureManifest(state);

  const remote = await readSnapshots(state.projectId);
  const foldedBefore = foldDeviceSnapshots(remote.snapshots, state.projectId);
  const entities = preserveRemoteDefaultsOnFirstJoin(
    await exportMobileSyncEntities(), foldedBefore.records, state.records
  );
  const prepared = prepareDeviceRecords({
    entities,
    baseRecords: state.records,
    deviceId: state.deviceId,
    clock: Math.max(state.clock, foldedBefore.clock)
  });
  const detectedConflicts = collectConflicts(
    state.records, prepared.records, remote.snapshots, state.deviceId,
    state.handledConflicts
  );
  const conflicts = detectedConflicts.conflicts;
  const localSnapshot = makeDeviceSnapshot({
    projectId: state.projectId,
    deviceId: state.deviceId,
    deviceName: state.deviceName,
    records: prepared.records,
    clock: prepared.clock
  });
  const folded = foldDeviceSnapshots([...remote.snapshots, localSnapshot], state.projectId);
  const plan = planMergedRecords({
    baseRecords: state.records,
    localRecords: prepared.records,
    remoteRecords: folded.records
  });

  suppressAutoUntil = Date.now() + 4000;
  const applied = await applyMobileSyncRecords(plan.records, conflicts);
  const finalEntities = await exportMobileSyncEntities();
  const finalized = prepareDeviceRecords({
    entities: finalEntities,
    baseRecords: plan.records,
    deviceId: state.deviceId,
    clock: Math.max(prepared.clock, folded.clock)
  });
  const snapshot = makeDeviceSnapshot({
    projectId: state.projectId,
    deviceId: state.deviceId,
    deviceName: state.deviceName,
    records: finalized.records,
    clock: finalized.clock
  });
  const ownSnapshotIsCurrent = remote.snapshots.some((item) =>
    item.deviceId === state.deviceId &&
    hashValue(item.records || []) === hashValue(snapshot.records)
  );
  if (!ownSnapshotIsCurrent) await writeDeviceSnapshot(snapshot);

  const summary = summarizeSyncPlan(plan);
  const result = {
    ...summary,
    conflicts: applied.conflicts,
    warnings: remote.warnings,
    devices: new Set(remote.snapshots.map(({ deviceId }) => deviceId).filter(Boolean)).size +
      (remote.snapshots.some(({ deviceId }) => deviceId === state.deviceId) ? 0 : 1),
    reason,
    syncedAt: new Date().toISOString()
  };
  await saveState({
    ...state,
    clock: finalized.clock,
    records: finalized.records,
    handledConflicts: Array.from(new Set([
      ...state.handledConflicts,
      ...detectedConflicts.signatures
    ])).slice(-256),
    lastSyncAt: result.syncedAt,
    lastResult: result,
    enabled: true
  });
  document.dispatchEvent(new CustomEvent('pisi:sync-finished', { detail: result }));
  return result;
}

export function runMobileSync(options = {}) {
  if (!runningPromise) {
    runningPromise = performSync(options.reason || 'manual')
      .finally(() => { runningPromise = null; });
  }
  return runningPromise;
}

export async function selectMobileSyncFolder() {
  const selected = await transport.choose();
  const state = await getState();
  await saveState({ ...state, enabled: true, folderName: selected.name || '' });
  return runMobileSync({ reason: 'folder-selected' });
}

export async function disconnectMobileSync() {
  await transport.disconnect();
  const state = await getState();
  await saveState({ ...state, enabled: false, folderName: '' });
  return { ok: true };
}

export async function getMobileSyncStatus() {
  const [folder, state] = await Promise.all([transport.status(), getState()]);
  return {
    configured: Boolean(folder.configured && state.enabled),
    folderName: folder.name || state.folderName || '',
    projectId: state.projectId,
    deviceId: state.deviceId,
    lastSyncAt: state.lastSyncAt,
    lastResult: state.lastResult,
    running: Boolean(runningPromise)
  };
}

function scheduleAutoSync(reason) {
  if (Date.now() < suppressAutoUntil) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(async () => {
    const status = await getMobileSyncStatus().catch(() => null);
    if (status?.configured) runMobileSync({ reason }).catch((error) => {
      document.dispatchEvent(new CustomEvent('pisi:sync-error', { detail: { message: error.message } }));
    });
  }, 1800);
}

export async function initializeMobileSync() {
  document.addEventListener('pisi:data-changed', () => scheduleAutoSync('local-change'));
  await App.addListener('resume', () => scheduleAutoSync('resume'));
  const status = await getMobileSyncStatus().catch(() => null);
  if (status?.configured) scheduleAutoSync('startup');
  return status;
}
