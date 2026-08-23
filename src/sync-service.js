import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import {
  exportDatabase, getSetting, installDurableMutationHandler, setSetting
} from './db.js';
import {
  foldDeviceSnapshots, makeDeviceSnapshot, makeSyncManifest,
  hashValue, planMergedRecords, prepareDeviceRecords, summarizeSyncPlan,
  validateSyncManifest
} from './sync-core.js';
import {
  applyMobileSyncRecords, exportMobileSyncEntities, preserveMobileSyncConflicts
} from './sync-adapter.js';
import {
  chooseSyncLayout, formatSyncStoragePath, makeSyncPaths,
  SYNC_LAYOUT_DIRECT, SYNC_LAYOUT_NESTED
} from './sync-folder-layout.js';
import {
  buildWorkspaceProjection, CONFIG_PATHS, parseWorkspaceFiles,
  WORKSPACE_INDEX_FORMAT, WORKSPACE_INDEX_VERSION
} from './workspace-files.js';

const NativeFolder = registerPlugin('PisiSyncFolder');
const STATE_KEY = 'pisiSyncState';
const HANDLE_KEY = 'pisiSyncDirectoryHandle';
const MAX_SNAPSHOT_BYTES = 48 * 1024 * 1024;
const SNAPSHOT_CHUNK_BYTES = 4 * 1024 * 1024;
const SNAPSHOT_INDEX_FORMAT = 'pisi-sync-device-index';
const SNAPSHOT_CHUNK_FORMAT = 'pisi-sync-device-chunk';
const WORKSPACE_DEVICE_ID = 'device_workspace_files';
const WORKSPACE_INDEX_NAME = 'workspace-files.json';
const WORKSPACE_AUTHORITY_PATHS = new Set([
  '.pisi/tasks.json',
  '.pisi/relationships.json',
  ...Object.values(CONFIG_PATHS)
]);

let runningPromise = null;
let autoTimer = null;
let externalTimer = null;
let suppressAutoUntil = 0;
let initialized = false;
let beforeExternalScan = null;

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
    lastAttemptAt: stored?.lastAttemptAt || null,
    lastVerifiedAt: stored?.lastVerifiedAt || null,
    lastExternalScanAt: stored?.lastExternalScanAt || null,
    lastExternalChangeAt: stored?.lastExternalChangeAt || null,
    externalScanCount: Math.max(0, Number(stored?.externalScanCount) || 0),
    lastWorkspaceHash: stored?.lastWorkspaceHash || null,
    lastMigrationBackupPath: stored?.lastMigrationBackupPath || null,
    lastError: stored?.lastError && typeof stored.lastError === 'object'
      ? stored.lastError : null,
    layout: [SYNC_LAYOUT_DIRECT, SYNC_LAYOUT_NESTED].includes(stored?.layout)
      ? stored.layout : null,
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
  if (!root) throw new Error('Önce gerçek Pisi proje klasörünü seçin.');
  if (path && !isSafeWorkspacePath(path)) throw new Error('Geçersiz proje dosyası yolu.');
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
      const lower = relative.toLocaleLowerCase('en-US');
      if (handle.kind === 'directory') {
        if (
          ['.git', 'node_modules', '.pisi-sync'].includes(name.toLocaleLowerCase('en-US')) ||
          lower === '.pisi/sync-trash' || lower.startsWith('.pisi/sync-trash/') ||
          lower === '.pisi/recovery' || lower.startsWith('.pisi/recovery/') ||
          lower === '.pisi-history' || lower.startsWith('.pisi-history/')
        ) continue;
        await visit(handle, relative);
      } else if (
        handle.kind === 'file' &&
        (lower.endsWith('.json') || lower.endsWith('.node') || lower.endsWith('.map'))
      ) files.push(relative);
    }
  };
  await visit(directory);
  return files;
}

async function getWebEntry(path) {
  const segments = normalizeWorkspacePath(path).split('/').filter(Boolean);
  if (!segments.length) return getWebRoot(false);
  const parent = await webPath(segments.slice(0, -1).join('/'));
  const name = segments.at(-1);
  try { return await parent.getFileHandle(name); } catch (error) {
    if (error?.name !== 'TypeMismatchError' && error?.name !== 'NotFoundError') throw error;
  }
  try { return await parent.getDirectoryHandle(name); } catch (error) {
    if (error?.name === 'NotFoundError') return null;
    throw error;
  }
}

async function copyWebEntryVerified(source, targetParent, name) {
  if (source.kind === 'file') {
    const sourceFile = await source.getFile();
    const expected = new Uint8Array(await sourceFile.arrayBuffer());
    const target = await targetParent.getFileHandle(name, { create: true });
    const writable = await target.createWritable();
    try { await writable.write(expected); } finally { await writable.close(); }
    const actual = new Uint8Array(await (await target.getFile()).arrayBuffer());
    if (actual.length !== expected.length || actual.some((byte, index) => byte !== expected[index])) {
      throw new Error(`Tarayıcı sidecar kopyası byte doğrulamasını geçemedi: ${name}`);
    }
    return;
  }
  const target = await targetParent.getDirectoryHandle(name, { create: true });
  for await (const [childName, child] of source.entries()) {
    await copyWebEntryVerified(child, target, childName);
  }
}

const transport = {
  async choose() {
    if (Capacitor.isNativePlatform()) return NativeFolder.chooseFolder();
    const root = await getWebRoot(true);
    return {
      configured: true, name: root.name, readable: true, writable: true,
      permissionPersisted: true, provider: 'browser-file-system'
    };
  },
  async status() {
    if (Capacitor.isNativePlatform()) return NativeFolder.getFolder();
    const root = await getWebRoot(false);
    return {
      configured: Boolean(root), name: root?.name || '',
      readable: Boolean(root), writable: Boolean(root),
      permissionPersisted: Boolean(root), provider: 'browser-file-system'
    };
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
  async write(path, content, options = {}) {
    if (new Blob([content]).size > MAX_SNAPSHOT_BYTES) {
      throw new Error('Sync anlık görüntüsü 48 MB sınırını aşıyor. Büyük çizimleri ayrı yedekleyin.');
    }
    let expectedId = options.expectedId || '';
    let expectedType = options.expectedType || '';
    if (/\.(?:node|map)$/i.test(path)) {
      let parsed;
      try { parsed = JSON.parse(content); } catch {
        throw new Error(`Yazılacak proje dosyası geçerli JSON değil: ${path}`);
      }
      expectedId ||= String(parsed?.pisi?.id || '');
      expectedType ||= String(parsed?.pisi?.type || '');
      const pathType = path.toLocaleLowerCase('en-US').endsWith('.map') ? 'map' : 'node';
      if (!expectedId || expectedType !== pathType) {
        throw new Error(`Yazılacak proje dosyasının Pisi kimliği/türü geçersiz: ${path}`);
      }
    }
    if (Capacitor.isNativePlatform()) {
      const result = await NativeFolder.writeText({
        path, content, expectedId, expectedType
      });
      if (!result?.ok || !result?.verified || !result?.listed || !result?.jsonParsed) {
        throw new Error(`Android dosya sağlayıcısı yazmayı fiziksel olarak doğrulamadı: ${path}`);
      }
      return result;
    }
    const handle = await webPath(path, { create: true, file: true });
    const writable = await handle.createWritable();
    try { await writable.write(content); } finally { await writable.close(); }
    const confirmed = await transport.read(path);
    if (confirmed !== content) throw new Error(`Tarayıcı dosya yazımı geri okunamadı: ${path}`);
    try { JSON.parse(confirmed); } catch {
      throw new Error(`Tarayıcı dosya yazımı JSON doğrulamasını geçemedi: ${path}`);
    }
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const basename = path.slice(path.lastIndexOf('/') + 1);
    const listed = await listWebFiles(parent);
    if (!listed.includes(basename)) throw new Error(`Yazılan dosya klasör listesinde yok: ${path}`);
    return {
      ok: true, verified: true, listed: true, jsonParsed: true,
      bytes: new TextEncoder().encode(content).byteLength,
      completedAt: new Date().toISOString(), path
    };
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
    if (await transport.read(path) != null) throw new Error(`Silinen dosya hâlâ okunabiliyor: ${path}`);
    return { ok: true, verified: true };
  },
  async move(fromPath, toPath) {
    if (Capacitor.isNativePlatform()) {
      const result = await NativeFolder.moveEntry({ fromPath, toPath });
      if (!result?.ok || (!result?.verified && !result?.missing)) {
        throw new Error(`Android sidecar taşımasını doğrulamadı: ${fromPath}`);
      }
      return result;
    }
    const source = await getWebEntry(fromPath);
    if (!source) return { ok: true, verified: false, moved: false, missing: true };
    if (await getWebEntry(toPath)) throw new Error(`Taşıma hedefi zaten var: ${toPath}`);
    const targetSegments = normalizeWorkspacePath(toPath).split('/').filter(Boolean);
    const targetParent = await webPath(targetSegments.slice(0, -1).join('/'), { create: true });
    await copyWebEntryVerified(source, targetParent, targetSegments.at(-1));
    const sourceSegments = normalizeWorkspacePath(fromPath).split('/').filter(Boolean);
    const sourceParent = await webPath(sourceSegments.slice(0, -1).join('/'));
    await sourceParent.removeEntry(sourceSegments.at(-1), { recursive: true });
    if (await getWebEntry(fromPath) || !await getWebEntry(toPath)) {
      throw new Error(`Tarayıcı sidecar taşıması doğrulanamadı: ${fromPath}`);
    }
    return { ok: true, verified: true, moved: true, missing: false };
  },
  async probe() {
    if (Capacitor.isNativePlatform()) {
      const result = await NativeFolder.probeFolder();
      if (
        !result?.ok || !result?.verified || !result?.created || !result?.readBack ||
        !result?.listed || !result?.deleted
      ) throw new Error('Android klasör denemesi tam doğrulama sonucu döndürmedi.');
      return result;
    }
    const token = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const path = `.pisi-write-test-${token}.json`;
    const content = JSON.stringify({ format: 'pisi-storage-probe', token });
    await transport.write(path, content);
    const listed = await transport.list('');
    if (await transport.read(path) !== content || !listed.includes(path)) {
      throw new Error('Tarayıcı klasör deneme dosyası doğrulanamadı.');
    }
    await transport.delete(path);
    return {
      ok: true, verified: true, created: true, readBack: true,
      listed: true, deleted: true, checkedAt: new Date().toISOString()
    };
  },
  async openDriveSync() {
    if (!Capacitor.isNativePlatform()) return { opened: false, installed: false };
    return NativeFolder.openDriveSync();
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

async function inspectManifest(path) {
  const content = await transport.read(path);
  if (content == null) return { status: 'missing', path, manifest: null, error: null };
  let parsed;
  try { parsed = JSON.parse(content); } catch {
    return {
      status: 'invalid', path, manifest: null,
      error: new Error(`Sync manifesti bozuk: ${path}`)
    };
  }
  try {
    return { status: 'valid', path, manifest: validateSyncManifest(parsed), error: null };
  } catch (error) {
    return { status: 'invalid', path, manifest: null, error };
  }
}

async function resolveSyncLayout(folder, state) {
  const directPaths = makeSyncPaths(SYNC_LAYOUT_DIRECT);
  const nestedPaths = makeSyncPaths(SYNC_LAYOUT_NESTED);
  const [direct, nested] = await Promise.all([
    inspectManifest(directPaths.manifest),
    inspectManifest(nestedPaths.manifest)
  ]);
  const choice = chooseSyncLayout({
    folderName: folder.name,
    direct: direct.status,
    nested: nested.status,
    previousMode: state.layout
  });
  const selected = choice.mode === SYNC_LAYOUT_DIRECT ? direct : nested;
  if (selected.status === 'invalid') {
    throw new Error(
      `Seçilen çalışma klasöründeki Pisi Sync bilgisi okunamıyor (${selected.path}). ` +
      'Dosyayı elle değiştirmeyin; doğru ortak klasörü yeniden seçin.'
    );
  }
  const warnings = [];
  if (choice.duplicateProjects) {
    warnings.push(
      choice.mode === SYNC_LAYOUT_DIRECT
        ? 'İç içe iki Sync alanı bulundu; doğrudan seçilen .pisi-sync projesi kullanıldı.'
        : 'İç içe iki Sync alanı bulundu; ortak klasördeki standart .pisi-sync projesi kullanıldı.'
    );
  } else if (choice.recoveredAlternate) {
    warnings.push('Mevcut Pisi Sync projesi otomatik algılandı ve doğru klasör düzeni kullanıldı.');
  }
  return {
    ...makeSyncPaths(choice.mode),
    existingManifest: selected.manifest,
    warnings
  };
}

async function verifyFolderAccess() {
  try {
    const result = await transport.probe();
    return result.checkedAt || new Date().toISOString();
  } catch (error) {
    throw new Error(
      `Seçilen klasör fiziksel oluşturma/yazma/okuma/listeleme/silme doğrulamasını geçemedi: ` +
      `${error.message} Android klasör iznini ve yerel depolama sağlayıcısını kontrol edin.`
    );
  }
}

async function ensureManifest(state, layout) {
  const existing = layout.existingManifest;
  if (existing) {
    const manifest = existing;
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
  await transport.write(layout.manifest, JSON.stringify(manifest, null, 2));
  const confirmed = validateSyncManifest(await readJson(layout.manifest));
  if (confirmed.projectId !== manifest.projectId) {
    throw new Error('Sync manifesti yazıldıktan sonra farklı içerikle okundu.');
  }
  state.projectId = confirmed.projectId;
  return confirmed;
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

async function writeDeviceSnapshot(snapshot, paths) {
  const generation = `g${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const directory = `${paths.devices}/${snapshot.deviceId}`;
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
  await transport.delete(`${paths.devices}/${snapshot.deviceId}.json`).catch(() => {});
  const keep = new Set(['index.json', ...chunks]);
  const oldFiles = await transport.list(directory).catch(() => []);
  for (const name of oldFiles) {
    if (/^[A-Za-z0-9._:-]+\.json$/.test(name) && !keep.has(name)) {
      await transport.delete(`${directory}/${name}`).catch(() => {});
    }
  }
}

async function readSnapshots(projectId, paths) {
  const names = await transport.list(paths.devices);
  const snapshots = [];
  const warnings = [];
  const legacy = names.filter((value) => /^device_[A-Za-z0-9._:-]{4,180}\.json$/.test(value));
  const indexes = names.filter((value) =>
    /^device_[A-Za-z0-9._:-]{4,180}\/index\.json$/.test(value)
  );
  for (const name of legacy.slice(0, 200)) {
    try {
      const snapshot = await readJson(`${paths.devices}/${name}`);
      if (snapshot?.projectId === projectId) snapshots.push(snapshot);
    } catch (error) {
      warnings.push(error.message);
    }
  }
  for (const indexPath of indexes.slice(0, 200)) {
    try {
      const index = await readJson(`${paths.devices}/${indexPath}`);
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
        const chunk = await readJson(`${paths.devices}/${deviceDirectory}/${name}`);
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

function normalizeWorkspacePath(value = '') {
  return String(value).normalize('NFC').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function workspacePathKey(value = '') {
  return normalizeWorkspacePath(value).toLocaleLowerCase('en-US');
}

function isSafeWorkspacePath(value = '') {
  const segments = normalizeWorkspacePath(value).split('/');
  return segments.length > 0 && segments.length <= 24 && segments.every((segment) => (
    segment && segment !== '.' && segment !== '..' && segment.length <= 180 &&
    !/[<>:"|?*\u0000-\u001f]/.test(segment) && !/[. ]$/.test(segment) &&
    !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment)
  ));
}

function isWorkspaceDocumentPath(value = '') {
  const normalized = normalizeWorkspacePath(value);
  if (!isSafeWorkspacePath(normalized)) return false;
  const lower = normalized.toLocaleLowerCase('en-US');
  return lower.endsWith('.node') || lower.endsWith('.map');
}

function isWorkspaceProjectPath(value = '') {
  const path = normalizeWorkspacePath(value);
  const lower = path.toLocaleLowerCase('en-US');
  if (
    !path || lower.startsWith('.pisi-sync/') ||
    lower === '.pisi/sync-trash' || lower.startsWith('.pisi/sync-trash/') ||
    lower === '.pisi/recovery' || lower.startsWith('.pisi/recovery/') ||
    lower === '.pisi-history' || lower.startsWith('.pisi-history/')
  ) return false;
  return isWorkspaceDocumentPath(path) || WORKSPACE_AUTHORITY_PATHS.has(path);
}

function validWorkspaceIndex(value, projectId) {
  return value?.format === WORKSPACE_INDEX_FORMAT &&
    value.version === WORKSPACE_INDEX_VERSION &&
    value.projectId === projectId &&
    value.records && typeof value.records === 'object' && !Array.isArray(value.records);
}

async function readWorkspaceProject(layout, projectId) {
  const listed = await transport.list('');
  const projectPaths = Array.from(new Set(listed
    .map(normalizeWorkspacePath)
    .filter(isWorkspaceProjectPath)));
  const index = await readJson(layout.resolve(WORKSPACE_INDEX_NAME), { optional: true })
    .catch(() => null);

  if (validWorkspaceIndex(index, projectId)) {
    for (const path of Object.values(index.records)) {
      const normalized = normalizeWorkspacePath(path);
      if (!isWorkspaceDocumentPath(normalized) || projectPaths.includes(normalized)) continue;
      const content = await transport.read(normalized);
      if (content != null) projectPaths.push(normalized);
    }
  }

  const rows = [];
  for (const path of projectPaths) {
    const content = await transport.read(path);
    if (content != null) rows.push({ path, content });
  }
  const parsed = parseWorkspaceFiles(rows);
  if (parsed.warnings.length) {
    throw new Error(`Proje dosyaları güvenle okunamadı: ${parsed.warnings[0]}`);
  }
  const entityKeys = new Set(parsed.entities.map(({ kind, id }) => `${kind}:${id}`));
  const rowPaths = new Set(rows.map(({ path }) => workspacePathKey(path)));
  const managedKeys = [];
  if (validWorkspaceIndex(index, projectId)) {
    for (const [key, indexedPath] of Object.entries(index.records)) {
      if (!/^(?:node|map):/.test(key) || entityKeys.has(key)) continue;
      const normalized = workspacePathKey(indexedPath);
      if (rowPaths.has(normalized)) {
        throw new Error(
          `Yönetilen proje dosyasının kimliği veya biçimi değişmiş: ${indexedPath}`
        );
      }
      managedKeys.push(key);
    }
  }
  return { ...parsed, managedKeys };
}

function makeWorkspaceSnapshot(state, baseline, workspace) {
  const entityKeys = new Set(workspace.entities.map(({ kind, id }) => `${kind}:${id}`));
  const relevantKeys = new Set([...entityKeys, ...workspace.managedKeys]);
  if (!relevantKeys.size) return null;
  const prepared = prepareDeviceRecords({
    entities: workspace.entities,
    baseRecords: baseline.records.filter(({ key }) => relevantKeys.has(key)),
    deviceId: WORKSPACE_DEVICE_ID,
    clock: Math.max(state.clock, baseline.clock)
  });
  return makeDeviceSnapshot({
    projectId: state.projectId,
    deviceId: WORKSPACE_DEVICE_ID,
    deviceName: 'Seçilen Pisi proje dosyaları',
    records: prepared.records,
    clock: prepared.clock
  });
}

async function materializeWorkspace(records, layout, projectId) {
  const projection = buildWorkspaceProjection(records);
  const nextVisible = new Set(projection.visibleFiles.map(normalizeWorkspacePath));
  const previousIndex = await readJson(layout.resolve(WORKSPACE_INDEX_NAME), { optional: true })
    .catch(() => null);
  let visibleWrites = 0;
  let authorityWrites = 0;
  let sidecarsMoved = 0;
  const reversibleSidecarMoves = [];
  const trashStamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (validWorkspaceIndex(previousIndex, projectId)) {
    for (const [key, previousValue] of Object.entries(previousIndex.records)) {
      const previousPath = normalizeWorkspacePath(previousValue);
      const nextValue = projection.index.records[key];
      const nextPath = nextValue ? normalizeWorkspacePath(nextValue) : '';
      if (!isWorkspaceDocumentPath(previousPath) || previousPath === nextPath) continue;
      const content = await transport.read(previousPath);
      let sidecar = String(previousIndex.sidecars?.[key] || '').normalize('NFC');
      try {
        const storedSidecar = JSON.parse(content || '{}')?.pisi?.sidecar;
        if (storedSidecar) sidecar = String(storedSidecar).normalize('NFC');
      } catch {}
      if (
        sidecar && !sidecar.includes('/') && !sidecar.includes('\\') &&
        isSafeWorkspacePath(sidecar)
      ) {
        const previousDirectory = previousPath.includes('/')
          ? previousPath.slice(0, previousPath.lastIndexOf('/')) : '';
        const source = previousDirectory ? `${previousDirectory}/${sidecar}` : sidecar;
        const nextDirectory = nextPath && nextPath.includes('/')
          ? nextPath.slice(0, nextPath.lastIndexOf('/')) : '';
        const target = nextPath
          ? (nextDirectory ? `${nextDirectory}/${sidecar}` : sidecar)
          : `.pisi/sync-trash/${trashStamp}/${source}`;
        if (source !== target) {
          const moved = await transport.move(source, target);
          if (moved?.moved) {
            sidecarsMoved += 1;
            reversibleSidecarMoves.push({ source, target });
          }
        }
      }
    }
  }

  try {
    for (const file of projection.files) {
      const existing = await transport.read(file.path);
      if (existing !== file.content) {
        await transport.write(file.path, file.content);
        if (file.visible) visibleWrites += 1;
        else authorityWrites += 1;
      }
      const confirmed = await transport.read(file.path);
      if (confirmed !== file.content) {
        throw new Error(`Gerçek proje dosyası yazıldıktan sonra doğrulanamadı: ${file.path}`);
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const move of reversibleSidecarMoves.reverse()) {
      try { await transport.move(move.target, move.source); } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    if (rollbackErrors.length) {
      error.message += ` Sidecar geri alma uyarısı: ${rollbackErrors.join(' | ')}`;
    }
    throw error;
  }

  let removedFiles = 0;
  if (validWorkspaceIndex(previousIndex, projectId)) {
    for (const previousPath of Object.values(previousIndex.records)) {
      const path = normalizeWorkspacePath(previousPath);
      if (!isWorkspaceDocumentPath(path) || nextVisible.has(path)) continue;
      const trashPath = `.pisi/sync-trash/${trashStamp}/${path}`;
      await transport.move(path, trashPath);
      if (await transport.read(path) != null) {
        throw new Error(`Silinen proje dosyası klasörden kaldırılamadı: ${path}`);
      }
      removedFiles += 1;
    }
  }

  const writtenIndex = {
    ...projection.index,
    projectId,
    verifiedAt: new Date().toISOString(),
    files: projection.visibleFiles.map((path) => ({ path }))
  };
  const indexContent = `${JSON.stringify(writtenIndex, null, 2)}\n`;
  const indexPath = layout.resolve(WORKSPACE_INDEX_NAME);
  if (await transport.read(indexPath) !== indexContent) {
    await transport.write(indexPath, indexContent);
  }
  if (await transport.read(indexPath) !== indexContent) {
    throw new Error('Proje dosyası doğrulama indeksi geri okunamadı.');
  }

  let listed = [];
  let missing = [];
  for (const delay of [0, 180, 420]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    listed = await transport.list('');
    const available = new Set(listed.map(workspacePathKey));
    missing = projection.visibleFiles.filter((path) =>
      !available.has(workspacePathKey(path))
    );
    if (!missing.length) break;
  }
  if (missing.length) {
    throw new Error(
      `Dosya içeriği geri okundu ancak seçilen klasör listesinde görünmedi: ${missing[0]}`
    );
  }

  return {
    filesWritten: visibleWrites,
    authorityFilesWritten: authorityWrites,
    filesVerified: projection.visibleFiles.length,
    authorityFilesVerified: projection.files.length - projection.visibleFiles.length,
    filesRemoved: removedFiles,
    sidecarsMoved,
    nodeFilesFound: projection.visibleFiles.filter((path) => /\.node$/i.test(path)).length,
    mapFilesFound: projection.visibleFiles.filter((path) => /\.map$/i.test(path)).length,
    visibleFiles: projection.visibleFiles.slice(0, 12)
  };
}

function assertWorkspaceRoundTrip(expectedRecords, workspace) {
  const expected = new Set(expectedRecords
    .filter((record) => !record.deleted)
    .map(({ kind, id }) => `${kind}:${id}`));
  const actual = new Set(workspace.entities.map(({ kind, id }) => `${kind}:${id}`));
  for (const key of expected) {
    if (!actual.has(key)) {
      throw new Error(`Fiziksel proje geri okumasında varlık eksik: ${key}`);
    }
  }
}

async function writeMigrationBackup(backup) {
  const hasPrivateData = Boolean(backup?.documents?.length || backup?.tasks?.length);
  if (!hasPrivateData) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `.pisi/recovery/mobile-private-${stamp}.json`;
  const content = `${JSON.stringify({
    ...backup,
    migration: {
      reason: 'before-first-project-folder-merge',
      createdAt: new Date().toISOString()
    }
  }, null, 2)}\n`;
  await transport.write(path, content);
  if (await transport.read(path) !== content) {
    throw new Error('Klasör geçişi öncesi özel veri kurtarma kopyası doğrulanamadı.');
  }
  return path;
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
  if (!folder.configured) throw new Error('Önce gerçek Pisi proje klasörünü seçin.');
  if (folder.readable === false || folder.writable === false) {
    throw new Error('Seçilen çalışma klasörü artık okunabilir ve yazılabilir değil. Klasörü yeniden seçin.');
  }
  const state = await getState();
  state.enabled = true;
  state.folderName = folder.name || state.folderName;
  state.lastAttemptAt = new Date().toISOString();
  const layout = await resolveSyncLayout(folder, state);
  state.layout = layout.mode;
  const verifiedRecently = state.lastVerifiedAt &&
    Date.now() - new Date(state.lastVerifiedAt).getTime() < 24 * 60 * 60 * 1000;
  if (reason === 'manual' || reason === 'folder-selected' || !verifiedRecently) {
    state.lastVerifiedAt = await verifyFolderAccess();
  }
  await ensureManifest(state, layout);

  const remote = await readSnapshots(state.projectId, layout);
  const baselineSnapshots = [...remote.snapshots];
  if (state.records.length) {
    baselineSnapshots.push(makeDeviceSnapshot({
      projectId: state.projectId,
      deviceId: state.deviceId,
      deviceName: state.deviceName,
      records: state.records,
      clock: state.clock
    }));
  }
  const baseline = foldDeviceSnapshots(baselineSnapshots, state.projectId);
  const workspace = await readWorkspaceProject(layout, state.projectId);
  const workspaceHashBefore = hashValue(workspace.entities);
  const externalReason = ['external-scan', 'resume', 'startup', 'visibility'].includes(reason);
  const externalChanged = Boolean(
    externalReason && state.lastWorkspaceHash && state.lastWorkspaceHash !== workspaceHashBefore
  );
  const workspaceSnapshot = makeWorkspaceSnapshot(state, baseline, workspace);
  const sourceSnapshots = workspaceSnapshot
    ? [...remote.snapshots, workspaceSnapshot]
    : remote.snapshots;
  const foldedBefore = foldDeviceSnapshots(sourceSnapshots, state.projectId);
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
    state.records, prepared.records, sourceSnapshots, state.deviceId,
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
  const folded = foldDeviceSnapshots([...sourceSnapshots, localSnapshot], state.projectId);
  const plan = planMergedRecords({
    baseRecords: state.records,
    localRecords: prepared.records,
    remoteRecords: folded.records
  });

  const preserved = preserveMobileSyncConflicts(plan.records, conflicts);
  const workspaceResult = await materializeWorkspace(
    preserved.records, layout, state.projectId
  );
  const verifiedWorkspace = await readWorkspaceProject(layout, state.projectId);
  assertWorkspaceRoundTrip(preserved.records, verifiedWorkspace);
  const finalized = prepareDeviceRecords({
    entities: verifiedWorkspace.entities,
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
  if (!ownSnapshotIsCurrent) await writeDeviceSnapshot(snapshot, layout);
  suppressAutoUntil = Date.now() + 4000;
  const applied = await applyMobileSyncRecords(finalized.records, [], {
    recordsAlreadyPreserved: true,
    conflictLog: preserved.log
  });

  const summary = summarizeSyncPlan(plan);
  const knownDevices = new Set(remote.snapshots.map(({ deviceId }) => deviceId).filter(Boolean));
  knownDevices.add(state.deviceId);
  const result = {
    ...summary,
    ...workspaceResult,
    conflicts: applied.conflicts,
    warnings: [
      ...layout.warnings, ...remote.warnings, ...workspace.warnings,
      ...(workspace.notices || []), ...(verifiedWorkspace.notices || [])
    ],
    fileConflicts: workspace.fileConflicts || [],
    fileConflictCount: (workspace.fileConflicts || []).length,
    devices: knownDevices.size,
    peerDevices: Math.max(0, knownDevices.size - 1),
    uploaded: !ownSnapshotIsCurrent,
    uploadedRecords: ownSnapshotIsCurrent ? 0 : snapshot.records.length,
    storagePath: formatSyncStoragePath(state.folderName, layout.mode),
    workspacePath: state.folderName,
    projectId: state.projectId,
    verifiedAt: state.lastVerifiedAt,
    localFilesVerified: true,
    cloudVerified: false,
    cloudOwner: 'DriveSync (com.ttxapps.drivesync)',
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
    lastAttemptAt: result.syncedAt,
    lastError: null,
    lastWorkspaceHash: hashValue(verifiedWorkspace.entities),
    lastExternalScanAt: externalReason ? result.syncedAt : state.lastExternalScanAt,
    lastExternalChangeAt: externalChanged ? result.syncedAt : state.lastExternalChangeAt,
    externalScanCount: state.externalScanCount + (externalReason ? 1 : 0),
    enabled: true
  });
  document.dispatchEvent(new CustomEvent('pisi:sync-finished', { detail: result }));
  return result;
}

export async function runMobileSync(options = {}) {
  if (options.requireFresh && runningPromise) {
    try { await runningPromise; } catch {}
  }
  if (!runningPromise) {
    const reason = options.reason || 'manual';
    runningPromise = performSync(reason)
      .catch(async (error) => {
        try {
          const state = await getState();
          const at = new Date().toISOString();
          await saveState({
            ...state,
            lastAttemptAt: at,
            lastError: {
              message: String(error?.message || 'Senkronizasyon başarısız.'),
              reason,
              at
            }
          });
        } catch {}
        throw error;
      })
      .finally(() => { runningPromise = null; });
  }
  return runningPromise;
}

export async function selectMobileSyncFolder() {
  const privateBackup = await exportDatabase();
  const selected = await transport.choose();
  const state = await getState();
  const verifiedAt = await verifyFolderAccess();
  const migrationBackupPath = await writeMigrationBackup(privateBackup);
  await saveState({
    ...state,
    enabled: true,
    folderName: selected.name || '',
    layout: null,
    lastVerifiedAt: verifiedAt,
    lastMigrationBackupPath: migrationBackupPath || state.lastMigrationBackupPath,
    lastError: null
  });
  const result = await runMobileSync({ reason: 'folder-selected', requireFresh: true });
  return { ...result, migrationBackupPath };
}

export async function disconnectMobileSync() {
  await transport.disconnect();
  const state = await getState();
  await saveState({
    ...state,
    enabled: false,
    folderName: '',
    layout: null,
    lastError: null
  });
  return { ok: true };
}

export async function getMobileSyncStatus() {
  const [folder, state] = await Promise.all([transport.status(), getState()]);
  const folderName = folder.name || state.folderName || '';
  const accessible = folder.readable !== false && folder.writable !== false;
  return {
    configured: Boolean(folder.configured && accessible),
    folderSelected: Boolean(folder.configured || folder.uri || state.folderName),
    folderReadable: folder.readable !== false,
    folderWritable: folder.writable !== false,
    permissionPersisted: folder.permissionPersisted !== false,
    folderProvider: folder.provider || '',
    folderUri: folder.uri || '',
    storageBackend: folder.storageBackend || (Capacitor.isNativePlatform() ? 'SAF' : 'File System Access API'),
    driveSyncInstalled: folder.driveSyncInstalled === true,
    driveSyncPackage: 'com.ttxapps.drivesync',
    driveSyncCloudStatus: 'unknown-managed-by-drivesync',
    lastLocalWrite: folder.lastLocalWrite || null,
    lastLocalWritePath: folder.lastLocalWritePath || null,
    lastLocalWriteBytes: Number(folder.lastLocalWriteBytes || 0),
    folderName,
    layout: state.layout,
    storagePath: state.layout ? formatSyncStoragePath(folderName, state.layout) : '',
    projectId: state.projectId,
    deviceId: state.deviceId,
    lastSyncAt: state.lastSyncAt,
    lastResult: state.lastResult,
    lastAttemptAt: state.lastAttemptAt,
    lastVerifiedAt: state.lastVerifiedAt,
    lastExternalScanAt: state.lastExternalScanAt,
    lastExternalChangeAt: state.lastExternalChangeAt,
    externalScanCount: state.externalScanCount,
    lastMigrationBackupPath: state.lastMigrationBackupPath,
    lastError: state.lastError,
    running: Boolean(runningPromise)
  };
}

export async function openDriveSyncApp() {
  const result = await transport.openDriveSync();
  if (!result?.installed) {
    throw new Error('DriveSync (com.ttxapps.drivesync) bu cihazda bulunamadı.');
  }
  if (!result?.opened) throw new Error('DriveSync uygulaması açılamadı.');
  return result;
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

async function runExternalScan(reason) {
  const status = await getMobileSyncStatus().catch(() => null);
  if (!status?.configured || runningPromise) return null;
  if (typeof beforeExternalScan === 'function') await beforeExternalScan();
  return runMobileSync({ reason, requireFresh: true });
}

function scheduleExternalScan(reason, delay = 250) {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => runExternalScan(reason).catch((error) => {
    document.dispatchEvent(new CustomEvent('pisi:sync-error', {
      detail: { message: error.message }
    }));
  }), delay);
}

export async function initializeMobileSync(options = {}) {
  beforeExternalScan = typeof options.beforeExternalScan === 'function'
    ? options.beforeExternalScan : beforeExternalScan;
  installDurableMutationHandler(async (detail) => {
    const status = await getMobileSyncStatus().catch(() => null);
    if (!status?.configured) {
      return {
        verified: false,
        storage: 'private-recovery-cache',
        reason: 'project-folder-not-selected',
        operation: detail.operation
      };
    }
    const result = await runMobileSync({
      reason: `durable-${detail.operation}`,
      requireFresh: true
    });
    if (!result?.localFilesVerified) {
      throw new Error('Proje klasörü yazımı fiziksel olarak doğrulanmadı.');
    }
    return {
      verified: true,
      storage: 'selected-project-folder',
      operation: detail.operation,
      id: detail.id,
      path: result.visibleFiles?.find((path) => path.includes(detail.id)) || null,
      verifiedAt: result.syncedAt,
      filesVerified: result.filesVerified
    };
  });
  if (!initialized) {
    initialized = true;
    document.addEventListener('pisi:data-changed', () => scheduleAutoSync('local-change'));
    await App.addListener('resume', () => scheduleExternalScan('resume', 0));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleExternalScan('visibility', 100);
    });
    externalTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') runExternalScan('external-scan').catch((error) => {
        document.dispatchEvent(new CustomEvent('pisi:sync-error', {
          detail: { message: error.message }
        }));
      });
    }, 15000);
  }
  const status = await getMobileSyncStatus().catch(() => null);
  if (status?.configured && options.autoStart !== false) scheduleExternalScan('startup', 0);
  return status;
}
