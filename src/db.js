const DB_NAME = 'kedi-mobile';
const DB_VERSION = 1;
const DOCUMENTS = 'documents';
const SETTINGS = 'settings';

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

export function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(DOCUMENTS)) {
        const documents = db.createObjectStore(DOCUMENTS, { keyPath: 'id' });
        documents.createIndex('kind', 'kind');
        documents.createIndex('updatedAt', 'updatedAt');
        documents.createIndex('dateKey', 'dateKey');
      }

      if (!db.objectStoreNames.contains(SETTINGS)) {
        db.createObjectStore(SETTINGS, { keyPath: 'key' });
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
  return `${prefix}-${random}`;
}

export function createDocument(kind = 'note', overrides = {}) {
  const now = new Date().toISOString();
  const base = {
    id: makeId(kind),
    kind,
    title: kind === 'canvas' ? 'Yeni Fikir Haritası' : 'Yeni Not',
    content: '<p><br></p>',
    drawing: null,
    sheet: { rows: 12, cols: 6, cells: {} },
    canvas: {
      nodes: [],
      edges: [],
      camera: { x: 36, y: 42, zoom: 1 }
    },
    dateKey: null,
    pinned: false,
    createdAt: now,
    updatedAt: now
  };

  return { ...base, ...overrides };
}

export async function listDocuments() {
  const db = await openDatabase();
  const transaction = db.transaction(DOCUMENTS, 'readonly');
  const result = await requestToPromise(transaction.objectStore(DOCUMENTS).getAll());
  await transactionDone(transaction);
  return result.sort((a, b) => {
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

export async function putDocument(document) {
  const db = await openDatabase();
  const next = {
    ...document,
    updatedAt: document.updatedAt || new Date().toISOString()
  };
  const transaction = db.transaction(DOCUMENTS, 'readwrite');
  transaction.objectStore(DOCUMENTS).put(next);
  await transactionDone(transaction);
  return next;
}

export async function removeDocument(id) {
  const db = await openDatabase();
  const transaction = db.transaction(DOCUMENTS, 'readwrite');
  transaction.objectStore(DOCUMENTS).delete(id);
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
}

export async function exportDatabase() {
  const db = await openDatabase();
  const transaction = db.transaction([DOCUMENTS, SETTINGS], 'readonly');
  const documents = await requestToPromise(transaction.objectStore(DOCUMENTS).getAll());
  const settingsRows = await requestToPromise(transaction.objectStore(SETTINGS).getAll());
  await transactionDone(transaction);

  return {
    format: 'kedi-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    documents,
    settings: Object.fromEntries(settingsRows.map(({ key, value }) => [key, value]))
  };
}

function validateBackup(backup) {
  if (!backup || backup.format !== 'kedi-backup' || backup.version !== 1) {
    throw new Error('Bu dosya geçerli bir KEDI yedeği değil.');
  }
  if (!Array.isArray(backup.documents) || typeof backup.settings !== 'object') {
    throw new Error('Yedek dosyasının içeriği eksik.');
  }
}

export async function importDatabase(backup, { replace = true } = {}) {
  validateBackup(backup);
  const db = await openDatabase();
  const transaction = db.transaction([DOCUMENTS, SETTINGS], 'readwrite');
  const documents = transaction.objectStore(DOCUMENTS);
  const settings = transaction.objectStore(SETTINGS);

  if (replace) {
    documents.clear();
    settings.clear();
  }

  backup.documents.forEach((document) => {
    if (!document?.id || !['note', 'journal', 'canvas'].includes(document.kind)) return;
    documents.put(document);
  });

  Object.entries(backup.settings).forEach(([key, value]) => {
    settings.put({ key, value });
  });

  await transactionDone(transaction);
}

export async function seedDatabase() {
  const documents = await listDocuments();
  if (documents.length > 0) return documents;

  const welcome = createDocument('note', {
    title: 'KEDI’ye hoş geldin',
    pinned: true,
    content: `
      <h1>Merhaba 👋</h1>
      <p>KEDI artık telefonunda. Bu notta üç ayrı çalışma alanın var:</p>
      <ul>
        <li><strong>Yazı</strong> ile biçimlendirilmiş notlar,</li>
        <li><strong>Çizim</strong> ile hızlı eskizler,</li>
        <li><strong>Tablo</strong> ile formüllü küçük hesaplar.</li>
      </ul>
      <p>Alt menüden fikir haritasına ve takvim günlüklerine de ulaşabilirsin.</p>
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
      camera: { x: -390, y: -255, zoom: 1 }
    }
  });
  canvas.canvas.edges.push({
    id: makeId('edge'),
    from: canvas.canvas.nodes[0].id,
    to: canvas.canvas.nodes[1].id
  });

  await putDocument(welcome);
  await putDocument(canvas);
  return listDocuments();
}

