import { collectTags, documentMatchesTag, normalizeTag, normalizeTags } from './tag-utils.js';

const DB_NAME = 'kedi-mobile';
const DOCUMENTS = 'documents';
const ACTIVE_ID_KEY = 'pisi-active-document-id';
let selectedTag = '';
let observerBusy = false;

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

async function openDatabase() {
  const request = indexedDB.open(DB_NAME);
  return requestToPromise(request);
}

async function listDocuments() {
  const db = await openDatabase();
  const transaction = db.transaction(DOCUMENTS, 'readonly');
  const rows = await requestToPromise(transaction.objectStore(DOCUMENTS).getAll());
  await transactionDone(transaction);
  return rows;
}

async function getDocument(id) {
  if (!id) return null;
  const db = await openDatabase();
  const transaction = db.transaction(DOCUMENTS, 'readonly');
  const row = await requestToPromise(transaction.objectStore(DOCUMENTS).get(id));
  await transactionDone(transaction);
  return row || null;
}

async function saveDocument(document) {
  const db = await openDatabase();
  const transaction = db.transaction(DOCUMENTS, 'readwrite');
  transaction.objectStore(DOCUMENTS).put({
    ...document,
    tags: normalizeTags(document.tags),
    updatedAt: new Date().toISOString()
  });
  await transactionDone(transaction);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function rememberOpenedDocument(event) {
  const opener = event.target.closest?.('[data-open]');
  if (opener?.dataset.open) sessionStorage.setItem(ACTIVE_ID_KEY, opener.dataset.open);
}

document.addEventListener('click', rememberOpenedDocument, true);

function replaceVisibleBranding(root = document) {
  document.title = 'Pisi';
  root.querySelectorAll('h1, h2, strong, p, span, title').forEach((element) => {
    if (element.children.length) return;
    if (/KEDI/.test(element.textContent || '')) {
      element.textContent = element.textContent.replaceAll('KEDI', 'Pisi');
    }
  });
}

function renderTagChips(tags, removable = false) {
  return normalizeTags(tags).map((tag) => `
    <button class="pisi-tag-chip" ${removable ? `data-remove-tag="${escapeHtml(tag)}"` : ''} type="button">
      <span>#</span>${escapeHtml(tag)}${removable ? '<b>×</b>' : ''}
    </button>
  `).join('');
}

async function enhanceCards() {
  const cards = [...document.querySelectorAll('.document-card[data-document-id]')];
  if (!cards.length) return;
  const documents = await listDocuments();
  const byId = new Map(documents.map((document) => [document.id, document]));

  cards.forEach((card) => {
    const document = byId.get(card.dataset.documentId);
    if (!document) return;
    const tags = normalizeTags(document.tags);
    card.dataset.tags = tags.map((tag) => tag.toLocaleLowerCase('tr-TR')).join('|');
    card.dataset.search = `${card.dataset.search || ''} ${tags.join(' ')}`.toLocaleLowerCase('tr-TR');
    card.hidden = !documentMatchesTag(document, selectedTag);

    const badgeRow = card.querySelector('.card-badges');
    if (badgeRow && !badgeRow.querySelector('.pisi-card-tags')) {
      badgeRow.insertAdjacentHTML('beforeend', `<span class="pisi-card-tags">${tags.slice(0, 3).map((tag) => `#${escapeHtml(tag)}`).join(' ')}</span>`);
    }
  });

  const count = document.querySelector('#visible-count');
  if (count) count.textContent = String(cards.filter((card) => !card.hidden).length);
  await enhanceTagFilters(documents);
}

async function enhanceTagFilters(documents) {
  const filterRow = document.querySelector('.filter-row');
  if (!filterRow || document.querySelector('#pisi-tag-filters')) return;
  const tags = collectTags(documents.filter(({ kind }) => kind !== 'canvas'));
  if (!tags.length) return;
  filterRow.insertAdjacentHTML('afterend', `
    <section id="pisi-tag-filters" class="pisi-tag-filters" aria-label="Etiket filtreleri">
      <button type="button" class="pisi-tag-filter ${selectedTag ? '' : 'active'}" data-tag-filter="">Tüm etiketler</button>
      ${tags.map(({ tag, count }) => `<button type="button" class="pisi-tag-filter ${selectedTag === tag ? 'active' : ''}" data-tag-filter="${escapeHtml(tag)}">#${escapeHtml(tag)} <small>${count}</small></button>`).join('')}
    </section>
  `);
  document.querySelectorAll('[data-tag-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedTag = button.dataset.tagFilter || '';
      document.querySelectorAll('[data-tag-filter]').forEach((item) => item.classList.toggle('active', item === button));
      document.querySelectorAll('.document-card[data-document-id]').forEach((card) => {
        card.hidden = Boolean(selectedTag) && !(card.dataset.tags || '').split('|').includes(selectedTag.toLocaleLowerCase('tr-TR'));
      });
      const count = document.querySelector('#visible-count');
      if (count) count.textContent = String([...document.querySelectorAll('.document-card')].filter((card) => !card.hidden).length);
    });
  });
}

async function enhanceEditor() {
  const shell = document.querySelector('.detail-shell');
  if (!shell || shell.querySelector('#pisi-tag-editor')) return;
  const id = sessionStorage.getItem(ACTIVE_ID_KEY);
  const documentRow = await getDocument(id);
  if (!documentRow || documentRow.kind === 'canvas') return;
  const header = shell.querySelector('.detail-header');
  if (!header) return;

  header.insertAdjacentHTML('afterend', `
    <section id="pisi-tag-editor" class="pisi-tag-editor">
      <div class="pisi-tag-editor-heading"><strong>Etiketler</strong><small>Arama ve gruplama için</small></div>
      <div class="pisi-tag-list">${renderTagChips(documentRow.tags, true)}</div>
      <form id="pisi-tag-form" class="pisi-tag-form">
        <input id="pisi-tag-input" maxlength="32" placeholder="Yeni etiket" autocomplete="off" />
        <button type="submit">Ekle</button>
      </form>
    </section>
  `);

  const refresh = async () => {
    const current = await getDocument(id);
    const list = shell.querySelector('.pisi-tag-list');
    if (list && current) list.innerHTML = renderTagChips(current.tags, true);
  };

  shell.querySelector('#pisi-tag-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = shell.querySelector('#pisi-tag-input');
    const tag = normalizeTag(input?.value);
    if (!tag) return;
    const current = await getDocument(id);
    if (!current) return;
    current.tags = normalizeTags([...(current.tags || []), tag]);
    await saveDocument(current);
    input.value = '';
    await refresh();
  });

  shell.querySelector('.pisi-tag-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove-tag]');
    if (!button) return;
    const current = await getDocument(id);
    if (!current) return;
    const removed = button.dataset.removeTag.toLocaleLowerCase('tr-TR');
    current.tags = normalizeTags(current.tags).filter((tag) => tag.toLocaleLowerCase('tr-TR') !== removed);
    await saveDocument(current);
    await refresh();
  });
}

async function enhanceSettings() {
  const summary = document.querySelector('.data-summary');
  if (!summary || summary.querySelector('.pisi-tag-count')) return;
  const tags = collectTags(await listDocuments());
  summary.insertAdjacentHTML('beforeend', `<span class="pisi-tag-count"><strong>${tags.length}</strong><small>Etiket</small></span>`);
}

async function enhance() {
  if (observerBusy) return;
  observerBusy = true;
  try {
    replaceVisibleBranding();
    await enhanceCards();
    await enhanceEditor();
    await enhanceSettings();
  } catch (error) {
    console.error('[Pisi tags]', error);
  } finally {
    observerBusy = false;
  }
}

const observer = new MutationObserver(() => queueMicrotask(enhance));
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('DOMContentLoaded', enhance);
enhance();
