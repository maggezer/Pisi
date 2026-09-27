export const DB_NAME = 'pisi-mobile';
export const DB_VERSION = 4;

const DOCUMENTS = 'documents';
const SETTINGS = 'settings';
const HISTORIES = 'histories';
const TASKS = 'tasks';
const VALID_KINDS = new Set(['note', 'journal', 'canvas', 'source', 'database']);
const HISTORY_LIMIT = 80;
const MISSING_SETTING = Symbol('missing-setting');

let databasePromise;
let durableMutationHandler = null;

const DURABLE_SETTINGS = new Set(['propertySchema', 'savedViews', 'templates']);

export function installDurableMutationHandler(handler) {
  durableMutationHandler = typeof handler === 'function' ? handler : null;
}

async function commitDurableMutation(detail, options = {}) {
  if (options.durable === false || !durableMutationHandler) {
    return { verified: false, storage: 'private-cache' };
  }
  return durableMutationHandler(structuredClone(detail));
}

function attachDurabilityResult(value, result) {
  if (!value || typeof value !== 'object') return value;
  Object.defineProperty(value, '__pisiStorageResult', {
    value: result,
    enumerable: false,
    configurable: true
  });
  return value;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('İşlem iptal edildi.'));
  });
}

function addIndex(store, name, keyPath, options) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}

function canonicalTaskId(value) {
  const raw = String(value || '');
  if (/^task_[A-Za-z0-9._:-]{4,180}$/.test(raw)) return raw;
  const source = raw || (globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`);
  const cleaned = source.replace(/^task[-_:]?/i, '')
    .replace(/[^A-Za-z0-9._:-]+/g, '_').slice(0, 150) || 'mobile';
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `task_${cleaned}_${hash.toString(16).padStart(8, '0')}`;
}

function normalizeTaskForStorage(task = {}, options = {}) {
  const now = options.updatedAt || new Date().toISOString();
  const idMap = options.idMap instanceof Map ? options.idMap : new Map();
  const remapTaskId = (id) => idMap.get(String(id)) || canonicalTaskId(id);
  const status = ['todo', 'doing', 'waiting', 'blocked', 'done'].includes(task.status)
    ? task.status : (task.done ? 'done' : 'todo');
  const priority = Math.max(1, Math.min(5, Number(task.priority) || ({
    low: 1, normal: 3, high: 4, urgent: 5
  })[task.importance] || 3));
  const title = String(task.title ?? task.text ?? '').trim().slice(0, 500);
  const source = {
    documentId: task.source?.documentId || task.documentId || null,
    blockId: task.source?.blockId || task.blockId || null,
    mapId: task.source?.mapId || null,
    nodeTitle: String(task.source?.nodeTitle || ''),
    mapTitle: String(task.source?.mapTitle || '')
  };
  return {
    id: task.id ? remapTaskId(task.id) : makeId('task'),
    title,
    status,
    priority,
    dueDate: task.dueDate || null,
    scheduledAt: task.scheduledAt || null,
    deadline: task.deadline || null,
    reminderAt: task.reminderAt || null,
    reminderMode: task.reminderMode || 'none',
    durationMinutes: Math.max(0, Number(task.durationMinutes) || 0),
    actualMinutes: Math.max(0, Number(task.actualMinutes) || 0),
    repeat: task.repeat || 'none',
    completionOffsetDays: Number.isFinite(Number(task.completionOffsetDays))
      ? Number(task.completionOffsetDays) : null,
    dependencies: Array.from(new Set([
      ...(Array.isArray(task.dependencies) ? task.dependencies : []),
      ...(task.parentId ? [task.parentId] : [])
    ].filter(Boolean).map(remapTaskId))),
    manualOrder: Number(task.manualOrder) || Date.now(),
    todoTag: task.todoTag || `todo.${priority}.none`,
    source,
    text: title,
    done: status === 'done',
    importance: priority >= 5 ? 'urgent' : priority >= 4 ? 'high' : priority <= 1 ? 'low' : 'normal',
    documentId: source.documentId,
    blockId: source.blockId,
    parentId: null,
    completedAt: status === 'done' ? (task.completedAt || now) : null,
    createdAt: task.createdAt || now,
    updatedAt: now
  };
}

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const documents = db.objectStoreNames.contains(DOCUMENTS)
        ? request.transaction.objectStore(DOCUMENTS)
        : db.createObjectStore(DOCUMENTS, { keyPath: 'id' });
      addIndex(documents, 'kind', 'kind');
      addIndex(documents, 'updatedAt', 'updatedAt');
      addIndex(documents, 'dateKey', 'dateKey');
      addIndex(documents, 'parentId', 'parentId');

      if (!db.objectStoreNames.contains(SETTINGS)) {
        db.createObjectStore(SETTINGS, { keyPath: 'key' });
      }

      const histories = db.objectStoreNames.contains(HISTORIES)
        ? request.transaction.objectStore(HISTORIES)
        : db.createObjectStore(HISTORIES, { keyPath: 'id' });
      addIndex(histories, 'documentId', 'documentId');
      addIndex(histories, 'createdAt', 'createdAt');

      const tasks = db.objectStoreNames.contains(TASKS)
        ? request.transaction.objectStore(TASKS)
        : db.createObjectStore(TASKS, { keyPath: 'id' });
      addIndex(tasks, 'documentId', 'documentId');
      addIndex(tasks, 'scheduledAt', 'scheduledAt');
      addIndex(tasks, 'done', 'done');

      // Team/Plugins were retired in the desktop source of truth. Version 4
      // removes the obsolete mobile-only event store and upgrades legacy
      // subtask rows to the first-class task/dependency contract.
      if (db.objectStoreNames.contains('teamEvents')) {
        db.deleteObjectStore('teamEvents');
      }
      request.transaction.objectStore(SETTINGS).delete('teamConfig');
      if (event.oldVersion < 4) {
        const allTasks = tasks.getAll();
        allTasks.onsuccess = () => {
          const rows = allTasks.result || [];
          const idMap = new Map(rows.map((row) => [String(row.id), canonicalTaskId(row.id)]));
          tasks.clear();
          rows.forEach((row) => tasks.put(normalizeTaskForStorage(row, {
            idMap,
            updatedAt: row.updatedAt || new Date().toISOString()
          })));
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

export function makeId(prefix = 'doc') {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const canonicalPrefix = ({
    note: 'node', journal: 'node', source: 'node', database: 'node',
    canvas: 'map', doc: 'node', history: 'history', task: 'task',
    edge: 'edge', block: 'blk'
  })[prefix] || String(prefix || 'node').replace(/[^A-Za-z0-9.-]/g, '');
  return `${canonicalPrefix}_${random}`;
}

export function createDocument(kind = 'note', overrides = {}) {
  const now = new Date().toISOString();
  const safeKind = VALID_KINDS.has(kind) ? kind : 'note';
  const titles = {
    canvas: 'Yeni Fikir Haritası',
    source: 'Yeni Kaynak',
    database: 'Yeni Veritabanı'
  };
  const base = {
    id: makeId(safeKind),
    kind: safeKind,
    title: titles[safeKind] || 'Yeni Not',
    content: '<p><br></p>',
    blocks: [],
    tags: [],
    properties: {},
    relations: [],
    sources: [],
    parentId: null,
    templateId: null,
    drawing: null,
    sheet: { rows: 12, cols: 6, cells: {} },
    canvas: {
      nodes: [],
      references: [],
      edges: [],
      collapsedHubs: [],
      generated: null,
      camera: { x: 36, y: 42, zoom: 1 }
    },
    view: { type: 'document', filters: [], sort: [] },
    dateKey: null,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    revision: 1
  };
  return { ...base, ...overrides };
}

function normalizeDocumentForStorage(document = {}) {
  const base = createDocument(document.kind, document);
  return {
    ...base,
    title: String(base.title || 'Başlıksız').slice(0, 300),
    tags: Array.from(new Set((Array.isArray(base.tags) ? base.tags : [])
      .map((tag) => String(tag || '').trim()).filter(Boolean))),
    properties: base.properties && typeof base.properties === 'object' ? base.properties : {},
    relations: Array.isArray(base.relations) ? base.relations : [],
    sources: Array.isArray(base.sources) ? base.sources : [],
    blocks: Array.isArray(base.blocks) ? base.blocks : [],
    revision: Math.max(1, Number(base.revision) || 1),
    updatedAt: base.updatedAt || new Date().toISOString()
  };
}

function snapshotValue(document) {
  const { updatedAt, revision, ...content } = normalizeDocumentForStorage(document);
  return JSON.stringify(content);
}

async function getAll(storeName) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readonly');
  const rows = await requestToPromise(transaction.objectStore(storeName).getAll());
  await transactionDone(transaction);
  return rows;
}

export async function listDocuments() {
  const rows = await getAll(DOCUMENTS);
  return rows.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
}

export async function getDocument(id) {
  const db = await openDatabase();
  const transaction = db.transaction(DOCUMENTS, 'readonly');
  const result = await requestToPromise(transaction.objectStore(DOCUMENTS).get(id));
  await transactionDone(transaction);
  return result;
}

export async function putDocument(document, options = {}) {
  const previous = document?.id ? await getDocument(document.id) : null;
  const now = new Date().toISOString();
  const next = normalizeDocumentForStorage({
    ...document,
    updatedAt: options.preserveUpdatedAt ? document.updatedAt : now,
    revision: previous ? Math.max(Number(previous.revision) || 1, Number(document.revision) || 1) + 1 : 1
  });
  const shouldRecord = options.recordHistory !== false
    && previous
    && snapshotValue(previous) !== snapshotValue(next);
  const stores = shouldRecord ? [DOCUMENTS, HISTORIES] : [DOCUMENTS];
  const historyId = shouldRecord ? makeId('history') : null;
  const db = await openDatabase();
  const transaction = db.transaction(stores, 'readwrite');
  transaction.objectStore(DOCUMENTS).put(next);
  if (shouldRecord) {
    transaction.objectStore(HISTORIES).put({
      id: historyId,
      documentId: previous.id,
      revision: Number(previous.revision) || 1,
      createdAt: now,
      title: previous.title,
      snapshot: structuredClone(previous)
    });
  }
  await transactionDone(transaction);
  let durability;
  try {
    durability = await commitDurableMutation({
      operation: 'put-document',
      entityKind: next.kind === 'canvas' ? 'map' : 'node',
      id: next.id
    }, options);
  } catch (error) {
    const rollback = db.transaction(stores, 'readwrite');
    if (previous) rollback.objectStore(DOCUMENTS).put(previous);
    else rollback.objectStore(DOCUMENTS).delete(next.id);
    if (historyId) rollback.objectStore(HISTORIES).delete(historyId);
    await transactionDone(rollback);
    throw error;
  }
  if (shouldRecord) await trimDocumentHistory(next.id);
  if (options.notify !== false) {
    documentEvent('document', next.id);
  }
  return attachDurabilityResult(next, durability);
}

async function trimDocumentHistory(documentId) {
  const versions = await listDocumentVersions(documentId);
  if (versions.length <= HISTORY_LIMIT) return;
  const db = await openDatabase();
  const transaction = db.transaction(HISTORIES, 'readwrite');
  versions.slice(HISTORY_LIMIT).forEach(({ id }) => transaction.objectStore(HISTORIES).delete(id));
  await transactionDone(transaction);
}

export async function removeDocument(id, options = {}) {
  const previous = await getDocument(id);
  const versions = await listDocumentVersions(id);
  const tasks = (await listTasks()).filter((task) => task.documentId === id);
  const db = await openDatabase();
  const transaction = db.transaction([DOCUMENTS, HISTORIES, TASKS], 'readwrite');
  transaction.objectStore(DOCUMENTS).delete(id);
  versions.forEach((version) => transaction.objectStore(HISTORIES).delete(version.id));
  tasks.forEach((task) => transaction.objectStore(TASKS).delete(task.id));
  await transactionDone(transaction);
  let durability;
  try {
    durability = await commitDurableMutation({
      operation: 'delete-document',
      entityKind: previous?.kind === 'canvas' ? 'map' : 'node',
      id
    }, options);
  } catch (error) {
    const rollback = db.transaction([DOCUMENTS, HISTORIES, TASKS], 'readwrite');
    if (previous) rollback.objectStore(DOCUMENTS).put(previous);
    versions.forEach((version) => rollback.objectStore(HISTORIES).put(version));
    tasks.forEach((task) => rollback.objectStore(TASKS).put(task));
    await transactionDone(rollback);
    throw error;
  }
  documentEvent('document', id, true);
  return attachDurabilityResult({ id, deleted: true }, durability);
}

export async function getSetting(key, fallback = null) {
  const db = await openDatabase();
  const transaction = db.transaction(SETTINGS, 'readonly');
  const row = await requestToPromise(transaction.objectStore(SETTINGS).get(key));
  await transactionDone(transaction);
  return row ? row.value : fallback;
}

export async function setSetting(key, value, options = {}) {
  const previous = await getSetting(key, MISSING_SETTING);
  const db = await openDatabase();
  const transaction = db.transaction(SETTINGS, 'readwrite');
  transaction.objectStore(SETTINGS).put({ key, value });
  await transactionDone(transaction);
  if (DURABLE_SETTINGS.has(key)) {
    try {
      await commitDurableMutation({ operation: 'put-setting', entityKind: 'config', id: key }, options);
    } catch (error) {
      const rollback = db.transaction(SETTINGS, 'readwrite');
      if (previous === MISSING_SETTING) rollback.objectStore(SETTINGS).delete(key);
      else rollback.objectStore(SETTINGS).put({ key, value: previous });
      await transactionDone(rollback);
      throw error;
    }
  }
  return value;
}

export async function listDocumentVersions(documentId) {
  const rows = await getAll(HISTORIES);
  return rows.filter((row) => row.documentId === documentId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function restoreDocumentVersion(historyId) {
  const db = await openDatabase();
  const read = db.transaction(HISTORIES, 'readonly');
  const history = await requestToPromise(read.objectStore(HISTORIES).get(historyId));
  await transactionDone(read);
  if (!history?.snapshot) throw new Error('Sürüm bulunamadı.');
  return putDocument({ ...history.snapshot, updatedAt: new Date().toISOString() });
}

export async function listTasks() {
  return (await getAll(TASKS)).sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    return String(a.scheduledAt || '9999').localeCompare(String(b.scheduledAt || '9999'))
      || String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

async function getTask(id) {
  const db = await openDatabase();
  const transaction = db.transaction(TASKS, 'readonly');
  const result = await requestToPromise(transaction.objectStore(TASKS).get(id));
  await transactionDone(transaction);
  return result;
}

export async function putTask(task = {}, options = {}) {
  const next = normalizeTaskForStorage(task);
  if (!next.title) throw new Error('Görev metni boş olamaz.');
  const previous = await getTask(next.id);
  const db = await openDatabase();
  const transaction = db.transaction(TASKS, 'readwrite');
  transaction.objectStore(TASKS).put(next);
  await transactionDone(transaction);
  let durability;
  try {
    durability = await commitDurableMutation({
      operation: 'put-task', entityKind: 'task', id: next.id
    }, options);
  } catch (error) {
    const rollback = db.transaction(TASKS, 'readwrite');
    if (previous) rollback.objectStore(TASKS).put(previous);
    else rollback.objectStore(TASKS).delete(next.id);
    await transactionDone(rollback);
    throw error;
  }
  documentEvent('task', next.id);
  return attachDurabilityResult(next, durability);
}

export async function removeTask(id, options = {}) {
  const previous = await getTask(id);
  const db = await openDatabase();
  const transaction = db.transaction(TASKS, 'readwrite');
  transaction.objectStore(TASKS).delete(id);
  await transactionDone(transaction);
  let durability;
  try {
    durability = await commitDurableMutation(
      { operation: 'delete-task', entityKind: 'task', id }, options
    );
  } catch (error) {
    if (previous) {
      const rollback = db.transaction(TASKS, 'readwrite');
      rollback.objectStore(TASKS).put(previous);
      await transactionDone(rollback);
    }
    throw error;
  }
  documentEvent('task', id, true);
  return attachDurabilityResult({ id, deleted: true }, durability);
}

export async function inspectDatabaseIntegrity() {
  const [documents, tasks, histories] = await Promise.all([
    listDocuments(), listTasks(), getAll(HISTORIES)
  ]);
  const ids = new Set(documents.map(({ id }) => id));
  const issues = [];
  documents.forEach((document) => {
    if (!document.id || !VALID_KINDS.has(document.kind)) {
      issues.push({ type: 'invalid-document', documentId: document.id || null });
    }
    if (document.parentId && !ids.has(document.parentId)) {
      issues.push({ type: 'missing-parent', documentId: document.id, targetId: document.parentId });
    }
    (document.relations || []).forEach((relation) => {
      if (relation.targetId && !ids.has(relation.targetId)) {
        issues.push({ type: 'missing-relation', documentId: document.id, targetId: relation.targetId });
      }
    });
    if (document.kind === 'canvas') {
      const nodeIds = new Set((document.canvas?.nodes || []).map(({ id }) => id));
      (document.canvas?.edges || []).forEach((edge) => {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
          issues.push({ type: 'broken-map-edge', documentId: document.id, edgeId: edge.id });
        }
      });
    }
  });
  tasks.forEach((task) => {
    if (task.documentId && !ids.has(task.documentId)) {
      issues.push({ type: 'orphan-task', taskId: task.id, documentId: task.documentId });
    }
  });
  histories.forEach((history) => {
    if (!ids.has(history.documentId)) {
      issues.push({ type: 'orphan-history', historyId: history.id, documentId: history.documentId });
    }
  });
  return {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    counts: { documents: documents.length, tasks: tasks.length, histories: histories.length },
    issues
  };
}

export async function exportDatabase() {
  const [documents, settingsRows, histories, tasks] = await Promise.all([
    listDocuments(), getAll(SETTINGS), getAll(HISTORIES), listTasks()
  ]);
  return {
    format: 'pisi-backup',
    version: 4,
    exportedAt: new Date().toISOString(),
    documents,
    tasks,
    histories,
    settings: Object.fromEntries(settingsRows.map(({ key, value }) => [key, value]))
  };
}

function validateBackup(backup) {
  if (!backup || backup.format !== 'pisi-backup' || ![3, 4].includes(backup.version)) {
    throw new Error('Bu dosya geçerli bir Pisi yedeği değil.');
  }
  if (!Array.isArray(backup.documents) || typeof backup.settings !== 'object') {
    throw new Error('Yedek dosyasının içeriği eksik.');
  }
}

export async function importDatabase(backup, { replace = true, durable = true } = {}) {
  validateBackup(backup);
  const previous = await Promise.all([
    getAll(DOCUMENTS), getAll(SETTINGS), getAll(HISTORIES), getAll(TASKS)
  ]);
  const db = await openDatabase();
  const storeNames = [DOCUMENTS, SETTINGS, HISTORIES, TASKS];
  const transaction = db.transaction(storeNames, 'readwrite');
  const stores = Object.fromEntries(storeNames.map((name) => [name, transaction.objectStore(name)]));
  if (replace) storeNames.forEach((name) => stores[name].clear());
  backup.documents.forEach((document) => {
    if (document?.id && VALID_KINDS.has(document.kind)) stores[DOCUMENTS].put(normalizeDocumentForStorage(document));
  });
  Object.entries(backup.settings || {}).forEach(([key, value]) => stores[SETTINGS].put({ key, value }));
  (backup.histories || []).forEach((row) => row?.id && stores[HISTORIES].put(row));
  (backup.tasks || []).forEach((row) => row?.id && stores[TASKS].put(row));
  await transactionDone(transaction);
  let durability;
  try {
    durability = await commitDurableMutation({
      operation: 'import-workspace', entityKind: 'workspace', id: 'backup-import'
    }, { durable });
  } catch (error) {
    const rollback = db.transaction(storeNames, 'readwrite');
    storeNames.forEach((name) => rollback.objectStore(name).clear());
    previous.forEach((rows, index) => {
      rows.forEach((row) => rollback.objectStore(storeNames[index]).put(row));
    });
    await transactionDone(rollback);
    throw error;
  }
  documentEvent('workspace', 'backup-import');
  return durability;
}

function documentEvent(kind, id, deleted = false) {
  try {
    document.dispatchEvent(new CustomEvent('pisi:data-changed', {
      detail: { kind, id, deleted }
    }));
  } catch {}
}

export async function replaceSyncedWorkspace({ documents = [], tasks = [], settings = {} } = {}) {
  const db = await openDatabase();
  const transaction = db.transaction([DOCUMENTS, TASKS, HISTORIES, SETTINGS], 'readwrite');
  const documentStore = transaction.objectStore(DOCUMENTS);
  const taskStore = transaction.objectStore(TASKS);
  const historyStore = transaction.objectStore(HISTORIES);
  const settingsStore = transaction.objectStore(SETTINGS);
  const liveDocumentIds = new Set(documents.map(({ id }) => id));

  documentStore.clear();
  taskStore.clear();
  documents.forEach((row) => row?.id && documentStore.put(normalizeDocumentForStorage(row)));
  tasks.forEach((row) => row?.id && taskStore.put(row));
  for (const [key, value] of Object.entries(settings)) {
    settingsStore.put({ key, value });
  }

  const histories = await requestToPromise(historyStore.getAll());
  histories.forEach((row) => {
    if (!liveDocumentIds.has(row.documentId)) historyStore.delete(row.id);
  });
  await transactionDone(transaction);
  documentEvent('workspace', 'sync-apply');
}

export async function seedDatabase() {
  return listDocuments();
}
