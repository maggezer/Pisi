export const DB_NAME = 'pisi-mobile';
export const DB_VERSION = 3;

const DOCUMENTS = 'documents';
const SETTINGS = 'settings';
const HISTORIES = 'histories';
const TASKS = 'tasks';
const TEAM_EVENTS = 'teamEvents';
const VALID_KINDS = new Set(['note', 'journal', 'canvas', 'source', 'database']);
const HISTORY_LIMIT = 80;

let databasePromise;

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

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
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

      const events = db.objectStoreNames.contains(TEAM_EVENTS)
        ? request.transaction.objectStore(TEAM_EVENTS)
        : db.createObjectStore(TEAM_EVENTS, { keyPath: 'id' });
      addIndex(events, 'createdAt', 'createdAt');
      addIndex(events, 'type', 'type');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

export function makeId(prefix = 'doc') {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
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
      edges: [],
      collapsedAnchors: [],
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
  const db = await openDatabase();
  const transaction = db.transaction(stores, 'readwrite');
  transaction.objectStore(DOCUMENTS).put(next);
  if (shouldRecord) {
    transaction.objectStore(HISTORIES).put({
      id: makeId('history'),
      documentId: previous.id,
      revision: Number(previous.revision) || 1,
      createdAt: now,
      title: previous.title,
      snapshot: structuredClone(previous)
    });
  }
  await transactionDone(transaction);
  if (shouldRecord) await trimDocumentHistory(next.id);
  return next;
}

async function trimDocumentHistory(documentId) {
  const versions = await listDocumentVersions(documentId);
  if (versions.length <= HISTORY_LIMIT) return;
  const db = await openDatabase();
  const transaction = db.transaction(HISTORIES, 'readwrite');
  versions.slice(HISTORY_LIMIT).forEach(({ id }) => transaction.objectStore(HISTORIES).delete(id));
  await transactionDone(transaction);
}

export async function removeDocument(id) {
  const versions = await listDocumentVersions(id);
  const tasks = (await listTasks()).filter((task) => task.documentId === id);
  const db = await openDatabase();
  const transaction = db.transaction([DOCUMENTS, HISTORIES, TASKS], 'readwrite');
  transaction.objectStore(DOCUMENTS).delete(id);
  versions.forEach((version) => transaction.objectStore(HISTORIES).delete(version.id));
  tasks.forEach((task) => transaction.objectStore(TASKS).delete(task.id));
  await transactionDone(transaction);
}

export async function getSetting(key, fallback = null) {
  const db = await openDatabase();
  const transaction = db.transaction(SETTINGS, 'readonly');
  const row = await requestToPromise(transaction.objectStore(SETTINGS).get(key));
  await transactionDone(transaction);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  const db = await openDatabase();
  const transaction = db.transaction(SETTINGS, 'readwrite');
  transaction.objectStore(SETTINGS).put({ key, value });
  await transactionDone(transaction);
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

export async function putTask(task = {}) {
  const now = new Date().toISOString();
  const next = {
    id: task.id || makeId('task'),
    text: String(task.text || '').trim().slice(0, 500),
    documentId: task.documentId || null,
    blockId: task.blockId || null,
    parentId: task.parentId || null,
    importance: ['low', 'normal', 'high', 'urgent'].includes(task.importance)
      ? task.importance : 'normal',
    scheduledAt: task.scheduledAt || null,
    deadline: task.deadline || null,
    reminderAt: task.reminderAt || null,
    durationMinutes: Math.max(0, Number(task.durationMinutes) || 0),
    repeat: task.repeat || 'none',
    done: Boolean(task.done),
    completedAt: task.done ? (task.completedAt || now) : null,
    createdAt: task.createdAt || now,
    updatedAt: now
  };
  if (!next.text) throw new Error('Görev metni boş olamaz.');
  const db = await openDatabase();
  const transaction = db.transaction(TASKS, 'readwrite');
  transaction.objectStore(TASKS).put(next);
  await transactionDone(transaction);
  return next;
}

export async function removeTask(id) {
  const db = await openDatabase();
  const transaction = db.transaction(TASKS, 'readwrite');
  transaction.objectStore(TASKS).delete(id);
  await transactionDone(transaction);
}

export async function appendTeamEvent(event = {}) {
  const next = {
    id: event.id || makeId('event'),
    type: String(event.type || 'change').slice(0, 80),
    actorId: event.actorId || 'local',
    target: event.target || null,
    payload: event.payload && typeof event.payload === 'object' ? event.payload : {},
    createdAt: event.createdAt || new Date().toISOString()
  };
  const db = await openDatabase();
  const transaction = db.transaction(TEAM_EVENTS, 'readwrite');
  transaction.objectStore(TEAM_EVENTS).put(next);
  await transactionDone(transaction);
  return next;
}

export async function listTeamEvents(limit = 100) {
  return (await getAll(TEAM_EVENTS))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Math.max(1, Number(limit) || 100));
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
    if (task.parentId && !tasks.some(({ id }) => id === task.parentId)) {
      issues.push({ type: 'orphan-subtask', taskId: task.id, parentId: task.parentId });
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
  const [documents, settingsRows, histories, tasks, teamEvents] = await Promise.all([
    listDocuments(), getAll(SETTINGS), getAll(HISTORIES), listTasks(), getAll(TEAM_EVENTS)
  ]);
  return {
    format: 'pisi-backup',
    version: 3,
    exportedAt: new Date().toISOString(),
    documents,
    tasks,
    histories,
    teamEvents,
    settings: Object.fromEntries(settingsRows.map(({ key, value }) => [key, value]))
  };
}

function validateBackup(backup) {
  if (!backup || backup.format !== 'pisi-backup' || backup.version !== 3) {
    throw new Error('Bu dosya geçerli bir Pisi 3 yedeği değil.');
  }
  if (!Array.isArray(backup.documents) || typeof backup.settings !== 'object') {
    throw new Error('Yedek dosyasının içeriği eksik.');
  }
}

export async function importDatabase(backup, { replace = true } = {}) {
  validateBackup(backup);
  const db = await openDatabase();
  const storeNames = [DOCUMENTS, SETTINGS, HISTORIES, TASKS, TEAM_EVENTS];
  const transaction = db.transaction(storeNames, 'readwrite');
  const stores = Object.fromEntries(storeNames.map((name) => [name, transaction.objectStore(name)]));
  if (replace) storeNames.forEach((name) => stores[name].clear());
  backup.documents.forEach((document) => {
    if (document?.id && VALID_KINDS.has(document.kind)) stores[DOCUMENTS].put(normalizeDocumentForStorage(document));
  });
  Object.entries(backup.settings || {}).forEach(([key, value]) => stores[SETTINGS].put({ key, value }));
  (backup.histories || []).forEach((row) => row?.id && stores[HISTORIES].put(row));
  (backup.tasks || []).forEach((row) => row?.id && stores[TASKS].put(row));
  (backup.teamEvents || []).forEach((row) => row?.id && stores[TEAM_EVENTS].put(row));
  await transactionDone(transaction);
}

export async function seedDatabase() {
  const documents = await listDocuments();
  if (documents.length > 0) return documents;
  const welcome = createDocument('note', {
    title: 'Pisi’ye hoş geldin',
    pinned: true,
    tags: ['başlangıç'],
    properties: { durum: 'aktif', alan: 'kişisel' },
    content: `
      <h1>Merhaba 👋</h1>
      <p>Pisi artık telefonunda ve tabletinde. Bu çalışma alanında:</p>
      <ul>
        <li>Bağlantılı not, blok ve görevlerini arayabilir,</li>
        <li>Yazı, çizim, tablo ve fikir haritaları oluşturabilir,</li>
        <li>Özellikler, kaynaklar ve sürüm geçmişiyle güvenle çalışabilirsin.</li>
      </ul>
      <p><strong>[[İlk fikir haritam]]</strong> bağlantısını açmayı dene.</p>
    `
  });
  const canvas = createDocument('canvas', {
    title: 'İlk fikir haritam',
    canvas: {
      nodes: [
        { id: makeId('node'), title: 'Ana fikir', content: 'Buradan başla', x: 520, y: 360 },
        { id: makeId('node'), title: 'Bir sonraki adım', content: 'Düğüme dokunup düzenle', x: 820, y: 540 }
      ],
      edges: [],
      collapsedAnchors: [],
      camera: { x: -390, y: -255, zoom: 1 }
    }
  });
  canvas.canvas.edges.push({
    id: makeId('edge'),
    from: canvas.canvas.nodes[0].id,
    to: canvas.canvas.nodes[1].id,
    fromAnchor: 'right',
    toAnchor: 'left'
  });
  await putDocument(welcome, { recordHistory: false });
  await putDocument(canvas, { recordHistory: false });
  return listDocuments();
}
