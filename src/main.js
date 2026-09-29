import './styles.css';
import './platform.css';
import {
  createDocument,
  exportDatabase,
  getSetting,
  importDatabase,
  listDocuments,
  makeId,
  putDocument,
  removeDocument,
  seedDatabase,
  setSetting
} from './db.js';
import {
  createCalendarCursor,
  getCalendarMonth,
  shiftCalendarCursor
} from './calendar-utils.js';
import { columnName, evaluateSheet, FORMULA_CATALOG } from './spreadsheet.js';
import { escapeHtml, htmlToText, sanitizeRichHtml } from './sanitize.js';
import { bindPisiBlocks, insertTodoAtSelection, serializeBlocks } from './blocks.js';
import { PlatformController } from './platform-ui.js';
import { parseTurkishDate } from './date-parser.js';
import {
  initializeNativeShell,
  isSoftKeyboardVisible,
  lightHaptic,
  onHardwareBack,
  exitNativeApp,
  shareBackup,
  successHaptic,
  updateNativeTheme
} from './native.js';
import {
  disconnectMobileSync, getMobileSyncStatus, initializeMobileSync,
  openDriveSyncApp, runMobileSync, selectMobileSyncFolder
} from './sync-service.js';
import {
  isHierarchyMapEdge,
  mapEdgeToRelationship,
  normalizeMapEdgeProjections,
  normalizeRelationshipCollection,
  prepareMapConnection
} from './map-connections.js';

const root = document.querySelector('#app');

const NAV_ITEMS = [
  { id: 'notes', icon: '⌂', label: 'Notlar' },
  { id: 'maps', icon: '⌘', label: 'Haritalar' },
  { id: 'tasks', icon: '✓', label: 'Görevler' },
  { id: 'calendar', icon: '□', label: 'Takvim' },
  { id: 'pisi', icon: '▤', label: 'Pisi' },
  { id: 'settings', icon: '◉', label: 'Ayarlar' }
];

const WEEKDAYS = {
  tr: ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'],
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
};

function localDateKey(date = new Date()) {
  const value = new Date(date);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0')
  ].join('-');
}

function dateFromKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  return new Date(year, Math.max(0, month - 1), day || 1, 12);
}

function shiftDateKey(dateKey, amount) {
  const date = dateFromKey(dateKey);
  date.setDate(date.getDate() + Number(amount || 0));
  return localDateKey(date);
}

function englishMonthShort(dateKey) {
  return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(dateFromKey(dateKey));
}

function normalizeCollapsedHubs(canvas = {}) {
  return Array.from(new Set(
    (Array.isArray(canvas.collapsedHubs) ? canvas.collapsedHubs : [])
      .map((value) => String(value || ''))
      .filter((value) => (
        /^node_[A-Za-z0-9_-]+::(?:top|right|bottom|left)$/.test(value)
      ))
  )).slice(0, 10000);
}

function normalizeDocument(document) {
  const sheet = document.sheet || {};
  const canvas = document.canvas || {};
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : [];
  const validNodeIds = new Set(nodes.map(({ id }) => id).filter(Boolean));
  const edges = normalizeMapEdgeProjections(
    Array.isArray(canvas.edges) ? canvas.edges : [],
    validNodeIds
  );
  return {
    ...createDocument(document.kind || 'note'),
    ...document,
    content: sanitizeRichHtml(document.content || '<p><br></p>'),
    blocks: Array.isArray(document.blocks) ? document.blocks : [],
    tags: Array.isArray(document.tags) ? document.tags : [],
    properties: document.properties && typeof document.properties === 'object' ? document.properties : {},
    relations: Array.isArray(document.relations) ? document.relations : [],
    sources: Array.isArray(document.sources) ? document.sources : [],
    sheet: {
      rows: Math.max(6, Number(sheet.rows) || 12),
      cols: Math.max(4, Number(sheet.cols) || 6),
      cells: sheet.cells && typeof sheet.cells === 'object' ? sheet.cells : {}
    },
    canvas: {
      nodes,
      references: (Array.isArray(canvas.references) ? canvas.references : [])
        .map((reference) => ({ id: String(reference?.id || '') }))
        .filter((reference, index, all) => (
          /^node_[A-Za-z0-9_-]+$/.test(reference.id)
          && all.findIndex((item) => item.id === reference.id) === index
        )),
      edges,
      collapsedHubs: normalizeCollapsedHubs(canvas),
      generated: canvas.generated && typeof canvas.generated === 'object'
        ? structuredClone(canvas.generated)
        : null,
      camera: {
        x: Number(canvas.camera?.x) || 0,
        y: Number(canvas.camera?.y) || 0,
        zoom: Math.min(2.2, Math.max(0.35, Number(canvas.camera?.zoom) || 1))
      }
    }
  };
}

function formatDate(value) {
  const date = new Date(value);
  const today = new Date();
  const locale = document.documentElement.lang === 'en' ? 'en-US' : 'tr-TR';
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

function kindLabel(kind) {
  if (kind === 'journal') return 'Günlük';
  if (kind === 'canvas') return 'Harita';
  if (kind === 'source') return 'Kaynak';
  if (kind === 'database') return 'Veritabanı';
  return 'Not';
}

function describeSyncResult(result = {}) {
  const received = Number(result.changed || 0);
  const files = Number(result.filesVerified || 0);
  const fileProof = files
    ? `${files} gerçek .node/.map dosyası yazılıp geri okunarak doğrulandı`
    : 'Klasörün fiziksel yazma-okuma-listeleme-silme denemesi doğrulandı; görünür not dosyası yok';
  const changes = received ? `; ${received} klasör değişikliği önbelleğe alındı` : '';
  return `${fileProof}${changes}. DriveSync bulut aktarımı Pisi tarafından doğrulanmaz.`;
}

function resolveTheme(theme) {
  if (theme === 'system') {
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return theme;
}

const PISI_EDITOR_FONT_FAMILIES = Object.freeze([
  'Vincendo',
  'Segoe UI',
  'Arial',
  'Calibri',
  'Times New Roman',
  'Georgia',
  'Consolas',
  'Comic Sans MS'
]);

const PISI_EDITOR_FONT_SIZES = Object.freeze([
  ['1', '8'],
  ['2', '10'],
  ['3', '12'],
  ['4', '14'],
  ['5', '18'],
  ['6', '24'],
  ['7', '32']
]);

function collectDocumentFontFamilies(html = '') {
  const template = document.createElement('template');
  template.innerHTML = sanitizeRichHtml(html);
  const fonts = new Set();

  template.content.querySelectorAll('[style]').forEach((element) => {
    const family = String(element.style?.fontFamily || '')
      .split(',')[0]
      .trim()
      .replace(/^["']|["']$/g, '');
    if (family) fonts.add(family);
  });
  template.content.querySelectorAll('font[face]').forEach((element) => {
    const family = String(element.getAttribute('face') || '').trim();
    if (family) fonts.add(family);
  });
  return [...fonts];
}

function debounce(callback, delay = 450, onError = console.error) {
  let timer = null;
  let pendingArgs = [];
  const wrapped = (...args) => {
    clearTimeout(timer);
    pendingArgs = args;
    timer = setTimeout(() => {
      timer = null;
      const currentArgs = pendingArgs;
      pendingArgs = [];
      Promise.resolve(callback(...currentArgs)).catch(onError);
    }, delay);
  };
  wrapped.flush = (...args) => {
    if (timer == null) return Promise.resolve(undefined);
    clearTimeout(timer);
    timer = null;
    const currentArgs = args.length ? args : pendingArgs;
    pendingArgs = [];
    return callback(...currentArgs);
  };
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
    pendingArgs = [];
  };
  return wrapped;
}

class PisiApp {
  constructor() {
    this.route = 'notes';
    this.returnRoute = 'notes';
    this.documents = [];
    this.activeDocument = null;
    this.noteFilter = 'all';
    this.editorTab = 'write';
    this.theme = 'system';
    this.calendarType = 'gregorian';
    this.locale = 'tr';
    this.calendarCursor = createCalendarCursor('gregorian');
    this.pisiDateKey = localDateKey();
    this.selectedMapNode = null;
    this.connectFrom = null;
    this.mapEditingNode = null;
    this.sheetSelection = 'A1';
    this.drawTool = 'pen';
    this.drawColor = '#e99a2e';
    this.drawWidth = 4;
    this.richTextRange = null;
    this.richSelectionChangeHandler = null;
    this.platform = new PlatformController(this);
    this.syncStatus = { configured: false, running: false };
    this.saveActiveDebounced = debounce(
      () => this.saveActive(),
      500,
      (error) => this.showSaveFailure(error)
    );
  }

  async init() {
    try {
      this.theme = await getSetting('theme', 'system');
      this.calendarType = await getSetting('calendarType', 'gregorian');
      this.locale = await getSetting('locale', 'tr');
      document.documentElement.lang = this.locale;
      this.calendarCursor = createCalendarCursor(this.calendarType);
      this.applyTheme();
      await initializeNativeShell(resolveTheme(this.theme));
      this.syncStatus = await initializeMobileSync({
        autoStart: false,
        beforeExternalScan: async () => {
          if (this.activeDocument) await this.saveActiveDebounced.flush();
        }
      }) || this.syncStatus;
      if (this.syncStatus.configured) {
        await runMobileSync({ reason: 'startup', requireFresh: true }).catch((error) => {
          console.error('Startup project scan failed', error);
        });
        this.syncStatus = await getMobileSyncStatus().catch(() => this.syncStatus);
        this.documents = (await listDocuments()).map(normalizeDocument);
      } else {
        this.documents = (await seedDatabase()).map(normalizeDocument);
      }
      await this.platform.init();
      document.addEventListener('pisi:sync-finished', async () => {
        await this.reloadDocuments();
        await this.platform.refreshFromStorage();
        this.syncStatus = await getMobileSyncStatus();
        if (this.route === 'settings') this.renderSettings();
      });
      document.addEventListener('pisi:sync-error', async (event) => {
        this.syncStatus = await getMobileSyncStatus().catch(() => this.syncStatus);
        this.toast(event.detail?.message || 'Senkronizasyon başarısız.', 'error');
        if (this.route === 'settings') this.renderSettings();
      });
      await this.bindNativeBack();
      this.render();
    } catch (error) {
      console.error(error);
      root.innerHTML = `
        <main class="fatal-screen">
          <div class="cat-orbit">!</div>
          <h1>Pisi açılamadı</h1>
          <p>${escapeHtml(error?.message || 'Bilinmeyen bir hata oluştu.')}</p>
          <button class="primary-button" onclick="location.reload()">Yeniden dene</button>
        </main>
      `;
    }
  }

  async bindNativeBack() {
    await onHardwareBack(() => {
      if (isSoftKeyboardVisible()) return;

      const overlay = document.querySelector(
        '#platform-overlay, #todo-options-overlay, #map-edge-menu-overlay'
      );
      if (overlay) {
        if (overlay.id === 'map-edge-menu-overlay') this.closeMapEdgeMenu();
        else overlay.remove();
        return;
      }
      if (this.mapEditingNode) {
        this.mapEditingNode = null;
        this.renderMapEditor();
        return;
      }
      if (['editor', 'map'].includes(this.route)) {
        this.leaveDetail();
        return;
      }
      if (this.route !== 'notes') this.navigate('notes');
      else exitNativeApp();
    });
  }

  applyTheme() {
    document.documentElement.dataset.theme = resolveTheme(this.theme);
    document.documentElement.style.colorScheme = resolveTheme(this.theme);
  }

  async setTheme(theme) {
    if (!['system', 'dark', 'light'].includes(theme)) return;
    this.theme = theme;
    this.applyTheme();
    document.querySelectorAll('button[data-theme-option]').forEach((button) => {
      button.classList.toggle('active', button.dataset.themeOption === theme);
    });
    await setSetting('theme', theme);
    await updateNativeTheme(theme);
  }

  async reloadDocuments() {
    this.documents = (await listDocuments()).map(normalizeDocument);
  }

  navigate(route) {
    this.closeMapEdgeMenu();
    this.route = route;
    this.activeDocument = null;
    this.selectedMapNode = null;
    this.connectFrom = null;
    this.mapEditingNode = null;
    this.render();
    window.scrollTo(0, 0);
  }

  async openDocument(id, returnRoute = this.route) {
    const found = this.documents.find((document) => document.id === id);
    if (!found) return;
    this.returnRoute = returnRoute;
    this.activeDocument = normalizeDocument(structuredClone(found));
    this.editorTab = 'write';
    this.sheetSelection = 'A1';
    this.route = found.kind === 'canvas' ? 'map' : 'editor';
    await this.platform.prepareDocument(id);
    this.render();
  }

  async leaveDetail() {
    await this.saveActiveDebounced.flush();
    await this.reloadDocuments();
    this.navigate(this.returnRoute || 'notes');
  }

  async saveActive() {
    if (!this.activeDocument) return;
    this.activeDocument.updatedAt = new Date().toISOString();
    this.activeDocument.content = sanitizeRichHtml(this.activeDocument.content);
    const stored = await putDocument(structuredClone(this.activeDocument));
    const storageResult = stored.__pisiStorageResult;
    this.activeDocument = normalizeDocument(stored);
    await this.platform.syncDocumentTasks(this.activeDocument);

    const index = this.documents.findIndex(({ id }) => id === this.activeDocument.id);
    if (index >= 0) this.documents[index] = normalizeDocument(structuredClone(this.activeDocument));
    else this.documents.unshift(normalizeDocument(structuredClone(this.activeDocument)));
    this.showSaveState(storageResult);
  }

  showSaveState(storageResult = {}) {
    const status = document.querySelector('#save-state');
    if (!status) return;
    status.textContent = storageResult.verified
      ? 'Proje klasörüne yazıldı ✓'
      : storageResult.reason === 'project-folder-not-selected'
        ? 'Yalnızca cihaz kurtarma kopyasında — klasör seçilmedi veya erişilemiyor'
        : 'Yalnızca cihaz kurtarma kopyasında — fiziksel dosya doğrulanmadı';
    status.classList.add('visible');
    clearTimeout(this.saveStateTimer);
    this.saveStateTimer = setTimeout(() => status.classList.remove('visible'), 2200);
  }

  showSaveFailure(error) {
    const message = error?.message || 'Proje dosyası yazılamadı.';
    const status = document.querySelector('#save-state');
    if (status) {
      status.textContent = `Kaydedilmedi: ${message}`;
      status.classList.add('visible');
    }
    this.toast(message, 'error');
  }

  scheduleSave() {
    const status = document.querySelector('#save-state');
    if (status) {
      status.textContent = 'Kaydediliyor…';
      status.classList.add('visible');
    }
    this.saveActiveDebounced();
  }

  render() {
    if (this.route === 'editor') return this.renderEditor();
    if (this.route === 'map') return this.renderMapEditor();
    if (this.route === 'maps') return this.renderMaps();
    if (this.route === 'tasks') return this.platform.renderTasks();
    if (this.route === 'data') return this.platform.renderData();
    if (this.route === 'calendar') return this.renderCalendar();
    if (this.route === 'pisi') return this.renderPisiDay();
    if (this.route === 'settings') return this.renderSettings();
    return this.renderNotes();
  }

  shell({ title = '', eyebrow = '', actions = '', content, fab = '', route = this.route, header = true }) {
    root.innerHTML = `
      <div class="responsive-layout">
        ${this.platform.landscapeRailTemplate(route)}
      <div class="app-shell ${header ? '' : 'headerless'}">
        ${header ? `
          <header class="page-header">
            <div>
              ${eyebrow ? `<span class="eyebrow">${escapeHtml(eyebrow)}</span>` : ''}
              <h1>${escapeHtml(title)}</h1>
            </div>
            <div class="header-actions">${actions}</div>
          </header>
        ` : ''}
        <main class="page-content">${content}</main>
        ${fab}
        <nav class="bottom-nav" aria-label="Ana menü">
          ${NAV_ITEMS.map((item) => `
            <button class="nav-button ${route === item.id ? 'active' : ''}" data-route="${item.id}">
              <span class="nav-icon" aria-hidden="true">${item.icon}</span>
              <span>${item.label}</span>
            </button>
          `).join('')}
        </nav>
      </div>
      ${this.platform.landscapeInspectorTemplate(route)}
      </div>
    `;
    this.bindShell();
  }

  bindShell() {
    document.querySelectorAll('[data-route]').forEach((button) => {
      button.addEventListener('click', () => {
        lightHaptic();
        this.navigate(button.dataset.route);
      });
    });
    this.platform.bindChrome();
  }

  renderNotes() {
    const searchable = this.documents.filter(({ kind }) => kind !== 'canvas');
    const visible = searchable.filter((document) => {
      if (this.noteFilter === 'pinned') return document.pinned;
      if (this.noteFilter === 'journal') return document.kind === 'journal';
      if (this.noteFilter === 'note') return document.kind === 'note';
      return true;
    });

    const cards = visible.length
      ? visible.map((document) => this.noteCard(document)).join('')
      : `
        <div class="empty-state">
          <div class="empty-cat"><i></i></div>
          <h2>Burada henüz bir şey yok</h2>
          <p>Yeni bir not oluşturduğunda burada görünecek.</p>
        </div>
      `;

    this.shell({
      header: false,
      content: `
        <label class="search-box">
          <span aria-hidden="true">⌕</span>
          <input id="note-search" type="search" placeholder="Notlarda ara" autocomplete="off" />
        </label>
        <div class="filter-row" role="group" aria-label="Not filtreleri">
          ${[
            ['all', 'Tümü'],
            ['note', 'Notlar'],
            ['journal', 'Günlükler'],
            ['pinned', 'Sabitlenenler']
          ].map(([value, label]) => `
            <button class="filter-chip ${this.noteFilter === value ? 'active' : ''}" data-filter="${value}">
              ${label}
            </button>
          `).join('')}
        </div>
        <section class="document-section">
          <div class="section-heading">
            <h2>Son notlar</h2>
            <span id="visible-count">${visible.length}</span>
          </div>
          <div class="document-grid" id="note-grid">${cards}</div>
        </section>
      `,
      fab: '<button class="fab" id="new-note" aria-label="Yeni not"><span>＋</span></button>'
    });

    document.querySelector('#new-note')?.addEventListener('click', () => this.createNote());
    document.querySelectorAll('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        this.noteFilter = button.dataset.filter;
        this.renderNotes();
      });
    });
    this.bindDocumentCards('notes');
    this.bindSearch();
  }

  noteCard(document) {
    const excerpt = htmlToText(document.content).slice(0, 150) || 'Boş not';
    const drawingBadge = document.drawing ? '<span>Çizim</span>' : '';
    const sheetBadge = Object.keys(document.sheet?.cells || {}).length ? '<span>Tablo</span>' : '';
    const search = `${document.title} ${excerpt}`.toLocaleLowerCase('tr-TR');
    return `
      <article class="document-card" data-document-id="${document.id}" data-search="${escapeHtml(search)}">
        <button class="document-open" data-open="${document.id}">
          <div class="document-meta">
            <span class="kind-pill ${document.kind}">${kindLabel(document.kind)}</span>
            <time>${formatDate(document.updatedAt)}</time>
          </div>
          <h3>${escapeHtml(document.title || 'Başlıksız')}</h3>
          <p>${escapeHtml(excerpt)}</p>
          <div class="card-badges">${drawingBadge}${sheetBadge}</div>
        </button>
        <button class="pin-button ${document.pinned ? 'active' : ''}" data-pin="${document.id}" aria-label="Sabitle">
          ${document.pinned ? '◆' : '◇'}
        </button>
      </article>
    `;
  }

  bindDocumentCards(returnRoute) {
    document.querySelectorAll('[data-open]').forEach((button) => {
      button.addEventListener('click', () => this.openDocument(button.dataset.open, returnRoute));
    });
    document.querySelectorAll('[data-pin]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const document = this.documents.find(({ id }) => id === button.dataset.pin);
        if (!document) return;
        document.pinned = !document.pinned;
        document.updatedAt = new Date().toISOString();
        await putDocument(document);
        await lightHaptic();
        this.render();
      });
    });
  }

  bindSearch() {
    const input = document.querySelector('#note-search');
    const cards = [...document.querySelectorAll('.document-card')];
    const count = document.querySelector('#visible-count');
    input?.addEventListener('input', () => {
      const query = input.value.trim().toLocaleLowerCase('tr-TR');
      let visible = 0;
      cards.forEach((card) => {
        const matches = !query || card.dataset.search.includes(query);
        card.hidden = !matches;
        if (matches) visible += 1;
      });
      if (count) count.textContent = String(visible);
    });
  }

  async createNote(overrides = {}) {
    const document = normalizeDocument(createDocument('note', overrides));
    await putDocument(document);
    this.documents.unshift(document);
    await successHaptic();
    this.openDocument(document.id, 'notes');
  }

  renderMaps() {
    const maps = this.documents.filter(({ kind }) => kind === 'canvas');
    this.shell({
      header: false,
      content: `
        <div class="map-list">
          ${maps.length ? maps.map((map) => {
            const nodes = map.canvas?.nodes?.length || 0;
            const edges = map.canvas?.edges?.length || 0;
            return `
              <article class="map-card">
                <button data-open="${map.id}" class="map-card-open">
                  <div class="map-card-visual">
                    <i></i><i></i><i></i>
                    <svg viewBox="0 0 120 70" aria-hidden="true">
                      <path d="M23 35C44 8 63 58 94 25M23 35C50 40 64 45 98 53"/>
                    </svg>
                  </div>
                  <div class="map-card-copy">
                    <h3>${escapeHtml(map.title || 'Başlıksız harita')}</h3>
                    <p>${nodes} düğüm · ${edges} bağlantı</p>
                    <time>${formatDate(map.updatedAt)}</time>
                  </div>
                </button>
              </article>
            `;
          }).join('') : `
            <div class="empty-state">
              <div class="empty-cat"><i></i></div>
              <h2>İlk haritanı oluştur</h2>
              <p>Bir konunun parçalarını yan yana görmek için güzel bir yer.</p>
            </div>
          `}
        </div>
      `,
      fab: '<button class="fab" id="new-map" aria-label="Yeni fikir haritası"><span>＋</span></button>'
    });
    document.querySelector('#new-map')?.addEventListener('click', () => this.createMap());
    this.bindDocumentCards('maps');
  }

  async createMap(options = {}) {
    const centerNode = {
      id: makeId('node'),
      title: 'Ana fikir',
      content: '',
      x: 640,
      y: 440
    };
    const document = normalizeDocument(createDocument('canvas', {
      title: options.title || 'Yeni Fikir Haritası',
      canvas: options.canvas || {
        nodes: [centerNode],
        edges: [],
        collapsedHubs: [],
        camera: { x: -500, y: -330, zoom: 1 }
      }
    }));
    await putDocument(document);
    this.documents.unshift(document);
    await successHaptic();
    if (options.open !== false) this.openDocument(document.id, 'maps');
    return document;
  }

  renderCalendar() {
    let month;
    try {
      month = getCalendarMonth(this.calendarType, this.calendarCursor, this.locale);
    } catch (error) {
      console.error(error);
      this.calendarType = 'gregorian';
      this.calendarCursor = createCalendarCursor('gregorian');
      month = getCalendarMonth('gregorian', this.calendarCursor, this.locale);
    }
    const journalDates = new Set(
      this.documents.filter(({ kind }) => kind === 'journal').map(({ dateKey }) => dateKey)
    );

    const blanks = Array.from({ length: month.firstDay }, () => '<span class="calendar-day blank"></span>').join('');
    const days = month.days.map((day) => `
      <button class="calendar-day ${day.isToday ? 'today' : ''} ${journalDates.has(day.dateKey) ? 'has-journal' : ''}"
        data-date-key="${day.dateKey}" data-journal-title="${escapeHtml(day.journalTitle)}">
        <span>${day.day}</span>
        ${journalDates.has(day.dateKey) ? '<i></i>' : ''}
      </button>
    `).join('');

    const recentJournals = this.documents.filter(({ kind }) => kind === 'journal').slice(0, 3);
    this.shell({
      header: false,
      content: `
        <div class="calendar-type-switch" role="group" aria-label="Takvim türü">
          ${[
            ['gregorian', 'Miladi'],
            ['hijri', 'Hicri'],
            ['lunar', 'Çin']
          ].map(([type, label]) => `
            <button class="${this.calendarType === type ? 'active' : ''}" data-calendar-type="${type}">
              ${label}
            </button>
          `).join('')}
        </div>
        <section class="calendar-card">
          <div class="calendar-heading">
            <button id="month-prev" aria-label="Önceki ay">‹</button>
            <h2>${escapeHtml(month.title)}</h2>
            <button id="month-next" aria-label="Sonraki ay">›</button>
          </div>
          <div class="weekdays">${WEEKDAYS[this.locale].map((day) => `<span>${day}</span>`).join('')}</div>
          <div class="calendar-grid">${blanks}${days}</div>
          <p class="calendar-hint"><i></i> Noktalı günlerde bir günlük notu var.</p>
        </section>
        <section class="document-section compact">
          <div class="section-heading"><h2>Son günlükler</h2></div>
          <div class="journal-list">
            ${recentJournals.length ? recentJournals.map((journal) => `
              <button class="journal-row" data-open="${journal.id}">
                <span class="journal-date">${escapeHtml(journal.dateKey?.slice(8, 10) || '—')}</span>
                <span><strong>${escapeHtml(journal.title)}</strong><small>${formatDate(journal.updatedAt)}</small></span>
                <b>›</b>
              </button>
            `).join('') : '<p class="soft-empty">Bir güne dokunarak ilk günlüğünü açabilirsin.</p>'}
          </div>
        </section>
      `
    });

    document.querySelectorAll('[data-calendar-type]').forEach((button) => {
      button.addEventListener('click', async () => {
        this.calendarType = button.dataset.calendarType;
        this.calendarCursor = createCalendarCursor(this.calendarType);
        await setSetting('calendarType', this.calendarType);
        this.renderCalendar();
      });
    });
    document.querySelector('#month-prev')?.addEventListener('click', () => {
      this.calendarCursor = shiftCalendarCursor(this.calendarType, this.calendarCursor, -1);
      this.renderCalendar();
    });
    document.querySelector('#month-next')?.addEventListener('click', () => {
      this.calendarCursor = shiftCalendarCursor(this.calendarType, this.calendarCursor, 1);
      this.renderCalendar();
    });
    document.querySelectorAll('[data-date-key]').forEach((button) => {
      button.addEventListener('click', () => this.openJournal(
        button.dataset.dateKey,
        button.dataset.journalTitle
      ));
    });
    document.querySelectorAll('.journal-row[data-open]').forEach((button) => {
      button.addEventListener('click', () => this.openDocument(button.dataset.open, 'calendar'));
    });
  }

  pisiDayTemplate(dateKey = this.pisiDateKey) {
    const journals = this.documents.filter(
      (document) => document.kind === 'journal' && document.dateKey === dateKey
    );
    const tasks = (this.platform.tasks || []).filter((task) => {
      const scheduled = String(task.scheduledAt || '').slice(0, 10);
      const deadline = String(task.deadline || '').slice(0, 10);
      return scheduled === dateKey || (!scheduled && deadline === dateKey);
    });
    const journalHtml = journals.length
      ? journals.map((journal) => {
          const excerpt = htmlToText(journal.content || '').trim() || 'Boş günlük notu';
          return `<button type="button" class="pisi-diary-card" data-pisi-journal="${escapeHtml(journal.id)}">
            <strong>${escapeHtml(journal.title || dateKey)}</strong>
            <p>${escapeHtml(excerpt.slice(0, 520))}</p>
          </button>`;
        }).join('')
      : '<p class="pisi-day-empty">Bu tarihte günlük notu yok.</p>';
    const taskHtml = tasks.length
      ? tasks.map((task) => `<article class="pisi-day-task ${task.done ? 'done' : ''}" data-pisi-task="${escapeHtml(task.id)}">
          <button type="button" class="pisi-day-check" data-pisi-task-toggle aria-label="Tamamlandı">${task.done ? '✓' : ''}</button>
          <span><strong>${escapeHtml(task.text || 'Görev')}</strong>${task.durationMinutes ? `<small>${task.durationMinutes} dk</small>` : ''}</span>
        </article>`).join('')
      : '<p class="pisi-day-empty">Bu tarihte görev yok.</p>';

    return `<section class="pisi-day-diary">
        <h2>Diary</h2>
        <div class="pisi-day-diary-list">${journalHtml}</div>
      </section>
      <section class="pisi-day-tasks">
        <h2>Tasks</h2>
        <div class="pisi-day-task-list">${taskHtml}</div>
      </section>`;
  }

  renderPisiDay() {
    const dates = Array.from({ length: 731 }, (_, index) => shiftDateKey(this.pisiDateKey, index - 365));
    this.shell({
      header: false,
      route: 'pisi',
      content: `<div class="pisi-day-page">
        <div class="pisi-day-main" id="pisi-day-main">${this.pisiDayTemplate(this.pisiDateKey)}</div>
        <aside class="pisi-date-rail" aria-label="Tarih seçici">
          <div class="pisi-date-month" id="pisi-date-month">${englishMonthShort(this.pisiDateKey)}</div>
          <div class="pisi-date-scroll" id="pisi-date-scroll" tabindex="0">
            ${dates.map((dateKey) => `<button type="button"
              class="pisi-date-item ${dateKey === this.pisiDateKey ? 'active' : ''}"
              data-pisi-date="${dateKey}"
              aria-label="${dateKey}">${Number(dateKey.slice(8, 10))}</button>`).join('')}
          </div>
        </aside>
      </div>`
    });
    this.bindPisiDay();
  }

  setPisiDate(dateKey) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return;
    if (dateKey === this.pisiDateKey) return;
    this.pisiDateKey = dateKey;
    const main = document.querySelector('#pisi-day-main');
    if (main) {
      main.innerHTML = this.pisiDayTemplate(dateKey);
      this.bindPisiDayContent(main);
    }
    const month = document.querySelector('#pisi-date-month');
    if (month) month.textContent = englishMonthShort(dateKey);
    document.querySelectorAll('[data-pisi-date]').forEach((button) => {
      button.classList.toggle('active', button.dataset.pisiDate === dateKey);
    });
    lightHaptic();
  }

  bindPisiDayContent(scope = document) {
    scope.querySelectorAll('[data-pisi-journal]').forEach((button) => {
      button.addEventListener('click', () => this.openDocument(button.dataset.pisiJournal, 'pisi'));
    });
    scope.querySelectorAll('[data-pisi-task-toggle]').forEach((button) => {
      button.addEventListener('click', async () => {
        const row = button.closest('[data-pisi-task]');
        const task = (this.platform.tasks || []).find(({ id }) => id === row?.dataset.pisiTask);
        if (!task) return;
        await this.platform.toggleTask(task);
        const main = document.querySelector('#pisi-day-main');
        if (main) {
          main.innerHTML = this.pisiDayTemplate(this.pisiDateKey);
          this.bindPisiDayContent(main);
        }
      });
    });
  }

  bindPisiDay() {
    const scroller = document.querySelector('#pisi-date-scroll');
    if (!scroller) return;
    this.bindPisiDayContent(document);
    document.querySelectorAll('[data-pisi-date]').forEach((button) => {
      button.addEventListener('click', () => this.setPisiDate(button.dataset.pisiDate));
    });

    const selected = scroller.querySelector(`[data-pisi-date="${this.pisiDateKey}"]`);
    requestAnimationFrame(() => selected?.scrollIntoView?.({ block: 'center' }));

    let scrollTimer = null;
    scroller.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const railBox = scroller.getBoundingClientRect();
        const center = railBox.top + railBox.height / 2;
        let closest = null;
        let distance = Infinity;
        scroller.querySelectorAll('[data-pisi-date]').forEach((button) => {
          const box = button.getBoundingClientRect();
          const delta = Math.abs((box.top + box.height / 2) - center);
          if (delta < distance) {
            closest = button;
            distance = delta;
          }
        });
        if (closest) this.setPisiDate(closest.dataset.pisiDate);
      }, 80);
    }, { passive: true });

    let dragStartY = 0;
    let dragStartScroll = 0;
    scroller.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse') return;
      dragStartY = event.clientY;
      dragStartScroll = scroller.scrollTop;
      scroller.classList.add('dragging');
      scroller.setPointerCapture?.(event.pointerId);
    });
    scroller.addEventListener('pointermove', (event) => {
      if (!scroller.classList.contains('dragging')) return;
      scroller.scrollTop = dragStartScroll - (event.clientY - dragStartY);
    });
    const finishDrag = () => scroller.classList.remove('dragging');
    scroller.addEventListener('pointerup', finishDrag);
    scroller.addEventListener('pointercancel', finishDrag);
  }

  async openJournal(dateKey, title) {
    const existing = this.documents.find(
      (document) => document.kind === 'journal' && document.dateKey === dateKey
    );
    if (existing) return this.openDocument(existing.id, 'calendar');

    const journal = normalizeDocument(createDocument('journal', {
      title,
      dateKey,
      content: `<h1>${escapeHtml(title)}</h1><p><br></p>`
    }));
    await putDocument(journal);
    this.documents.unshift(journal);
    await successHaptic();
    return this.openDocument(journal.id, 'calendar');
  }

  renderSettings() {
    const countNotes = this.documents.filter(({ kind }) => kind !== 'canvas').length;
    const countMaps = this.documents.filter(({ kind }) => kind === 'canvas').length;
    const sync = this.syncStatus || {};
    const localDate = (value) => value
      ? new Date(value).toLocaleString(this.locale === 'en' ? 'en-US' : 'tr-TR')
      : '—';
    const syncDate = sync.lastSyncAt
      ? new Date(sync.lastSyncAt).toLocaleString(this.locale === 'en' ? 'en-US' : 'tr-TR')
      : 'Henüz klasör denetlenmedi';
    const syncError = sync.lastError?.message || '';
    const syncErrorDate = sync.lastError?.at
      ? new Date(sync.lastError.at).toLocaleString(this.locale === 'en' ? 'en-US' : 'tr-TR')
      : '';
    const syncName = sync.folderName || 'Pisi Sync';
    const syncStateTitle = sync.configured
      ? syncName
      : sync.folderSelected
        ? `${syncName} erişilemiyor`
        : 'Çalışma klasörü bağlı değil';
    const projectFingerprint = sync.projectId
      ? String(sync.projectId).replace(/^project_/, '').slice(0, 12)
      : '';
    const permissionReady = sync.permissionPersisted &&
      sync.folderReadable !== false && sync.folderWritable !== false;
    const visibleFiles = Array.isArray(sync.lastResult?.visibleFiles)
      ? sync.lastResult.visibleFiles.slice(0, 3) : [];
    this.shell({
      header: false,
      content: `
        <section class="settings-profile">
          <div class="settings-logo"><span></span><i></i></div>
          <div><strong>Pisi Mobile</strong><span>Yerel, sakin ve çevrimdışı.</span></div>
        </section>
        <section class="settings-group">
          <h2>Görünüm</h2>
          <div class="segmented-control">
            ${[
              ['system', 'Sistem'],
              ['dark', 'Koyu'],
              ['light', 'Açık']
            ].map(([theme, label]) => `
              <button class="${this.theme === theme ? 'active' : ''}" data-theme-option="${theme}">${label}</button>
            `).join('')}
          </div>
        </section>
        <section class="settings-group">
          <h2>Dil / Language</h2>
          <div class="segmented-control language-control">
            <button class="${this.locale === 'tr' ? 'active' : ''}" data-locale="tr">Türkçe</button>
            <button class="${this.locale === 'en' ? 'active' : ''}" data-locale="en">English</button>
          </div>
        </section>
        <section class="settings-group">
          <h2>Varsayılan takvim</h2>
          <label class="setting-row">
            <span><strong>Takvim motoru</strong><small>Günlük ekranında ilk açılacak takvim</small></span>
            <select id="calendar-setting">
              <option value="gregorian" ${this.calendarType === 'gregorian' ? 'selected' : ''}>Miladi</option>
              <option value="hijri" ${this.calendarType === 'hijri' ? 'selected' : ''}>Hicri</option>
              <option value="lunar" ${this.calendarType === 'lunar' ? 'selected' : ''}>Çin</option>
            </select>
          </label>
        </section>
        <section class="settings-group">
          <h2>Çalışma alanı</h2>
          <button class="setting-action standalone" data-route="data">
            <span class="setting-icon">▦</span>
            <span><strong>Node sistemi ve taşınabilirlik</strong><small>Özellikler, görünümler, şablonlar ve dışa aktarma</small></span>
            <b>›</b>
          </button>
        </section>
        <section class="settings-group sync-settings" aria-busy="${sync.running ? 'true' : 'false'}">
          <h2>Not çalışma klasörü</h2>
          <p class="sync-description">Seçtiğin klasör gerçek Pisi proje köküdür. Notlar ve haritalar burada görünür <strong>.node/.map</strong> dosyaları olarak tutulur; telefon veritabanı yalnız yeniden oluşturulabilir çalışma önbelleğidir. DriveSync’te aynı klasörü yerel taraf, masaüstünün Google Drive klasörünü uzak taraf ve modu <strong>Two-way</strong> olarak eşleştir.</p>
          <div class="sync-status ${sync.configured ? 'connected' : ''}">
            <span class="setting-icon">${sync.configured ? '✓' : '↔'}</span>
            <span><strong>${escapeHtml(syncStateTitle)}</strong><small>${escapeHtml(syncDate)}</small>${sync.folderSelected ? `<small>Erişim: Read ${sync.folderReadable !== false ? '✓' : '✗'} · Write ${sync.folderWritable !== false ? '✓' : '✗'} · Persisted ${sync.permissionPersisted ? '✓' : '✗'}${permissionReady ? '' : ' — klasörü yeniden seç'}</small>` : ''}${sync.storagePath ? `<small>Sync metadatası: ${escapeHtml(sync.storagePath)}</small>` : ''}${projectFingerprint ? `<small>Proje: ${escapeHtml(projectFingerprint)}</small>` : ''}</span>
          </div>
          <small class="sync-permission-note">Android ayrıca “tüm dosyalar” izni istemez. Sistem seçicisindeki <strong>Bu klasörü kullan</strong> onayı yalnız seçtiğin klasöre kalıcı okuma-yazma yetkisi verir. Android 11+ depolama kökünü ve İndirilenler kökünü seçtirmez; DriveSync için ayrı bir alt klasör kullan. DriveSync bulut kuyruğu ve Google Drive sonucu Pisi tarafından görülemez; burada yalnız fiziksel yerel klasör kanıtı gösterilir.</small>
          ${syncError ? `<div class="sync-error" role="alert"><strong>Son senkronizasyon tamamlanamadı</strong><span>${escapeHtml(syncError)}</span>${syncErrorDate ? `<small>${escapeHtml(syncErrorDate)}</small>` : ''}</div>` : ''}
          <div class="sync-actions">
            <button class="setting-action" id="sync-folder-button">
              <span><strong>${sync.folderSelected ? 'Klasör iznini yenile / değiştir' : 'Not çalışma klasörü seç'}</strong><small>Gerçek Pisi proje klasörünü sistem seçicisinde yetkilendir</small></span><b>›</b>
            </button>
            ${sync.configured ? `<button class="setting-action" id="sync-now-button" ${sync.running ? 'disabled' : ''}>
              <span><strong>${sync.running ? 'Dosyalar denetleniyor…' : 'Dosyaları şimdi denetle'}</strong><small>Gerçek dosyaları yaz, geri oku ve klasör listesinde doğrula</small></span><b>↻</b>
            </button><button class="setting-action" id="open-drivesync-button">
              <span><strong>DriveSync’i aç</strong><small>${sync.driveSyncInstalled ? 'Klasör çiftini ve bulut kuyruğunu DriveSync’te denetle' : 'com.ttxapps.drivesync bu cihazda görünmüyor'}</small></span><b>↗</b>
            </button><button class="setting-action danger" id="sync-disconnect-button" ${sync.running ? 'disabled' : ''}><span><strong>Bağlantıyı kes</strong><small>Yerel veriler silinmez</small></span><b>×</b></button>` : ''}
          </div>
          ${sync.lastResult ? `<small class="sync-result">Son yerel işlem: ${Number(sync.lastResult.filesVerified || 0)} gerçek dosya doğrulandı · ${Number(sync.lastResult.filesWritten || 0)} dosya yazıldı · ${Number(sync.lastResult.changed || 0)} değişiklik önbelleğe alındı · ${Number(sync.lastResult.conflicts || 0)} eşzamanlı düzenleme kopyası · ${Number(sync.lastResult.fileConflictCount || 0)} DriveSync dosya çakışması</small>` : ''}
          ${sync.lastResult ? `<small class="sync-result">Bulunan dosyalar: ${Number(sync.lastResult.nodeFilesFound || 0)} node · ${Number(sync.lastResult.mapFilesFound || 0)} map</small>` : ''}
          ${visibleFiles.length ? `<small class="sync-result">Dosya kanıtı: ${visibleFiles.map(escapeHtml).join(' · ')}</small>` : ''}
          ${sync.configured ? `<small class="sync-result">Depolama: ${escapeHtml(sync.storageBackend || 'SAF')} · sağlayıcı: ${escapeHtml(sync.folderProvider || '—')}</small>
          <small class="sync-result">URI: ${escapeHtml(sync.folderUri || '—')}</small>
          <small class="sync-result">Son fiziksel yazma: ${escapeHtml(localDate(sync.lastLocalWrite))}${sync.lastLocalWritePath ? ` · ${escapeHtml(sync.lastLocalWritePath)} · ${Number(sync.lastLocalWriteBytes || 0)} byte` : ''}</small>
          <small class="sync-result">Son dış değişiklik taraması: ${escapeHtml(localDate(sync.lastExternalScanAt))} · algılanan son değişiklik: ${escapeHtml(localDate(sync.lastExternalChangeAt))}</small>
` : ''}
          <small class="sync-warning">Bulut durumu: doğrulanmadı — DriveSync yönetiyor.</small>
          ${sync.lastResult?.fileConflictCount ? '<small class="sync-warning">DriveSync çakışma dosyaları ayrı not/harita kopyaları olarak korundu; içerikleri karşılaştırıp birleştir.</small>' : ''}
        </section>
        <section class="settings-group">
          <h2>Verilerin</h2>
          <div class="data-summary">
            <span><strong>${countNotes}</strong><small>Not ve günlük</small></span>
            <span><strong>${countMaps}</strong><small>Fikir haritası</small></span>
          </div>
          <button class="setting-action" id="backup-button">
            <span class="setting-icon">⇧</span>
            <span><strong>Yedek oluştur</strong><small>Tüm verileri JSON olarak kaydet veya paylaş</small></span>
            <b>›</b>
          </button>
          <button class="setting-action" id="import-button">
            <span class="setting-icon">⇩</span>
            <span><strong>Yedeği geri yükle</strong><small>Bir Pisi 3 yedek dosyası seç</small></span>
            <b>›</b>
          </button>
          <input id="backup-file" type="file" accept="application/json,.json" hidden />
        </section>
        <section class="settings-group about-group">
          <h2>Hakkında</h2>
          <p>Pisi 3.2.0 · Android Dikey/Yatay Pisi sürümü</p>
          <p>Okunabilir .node/.map proje dosyaları asıl veridir; telefon önbelleği yeniden oluşturulabilir çalışma kopyasıdır.</p>
        </section>
      `
    });

    document.querySelectorAll('button[data-theme-option]').forEach((button) => {
      button.addEventListener('click', () => this.setTheme(button.dataset.themeOption));
    });
    document.querySelectorAll('[data-locale]').forEach((button) => {
      button.addEventListener('click', async () => {
        this.locale = button.dataset.locale;
        document.documentElement.lang = this.locale;
        await setSetting('locale', this.locale);
        this.calendarCursor = createCalendarCursor(this.calendarType);
        this.renderSettings();
      });
    });
    document.querySelector('#calendar-setting')?.addEventListener('change', async (event) => {
      this.calendarType = event.target.value;
      this.calendarCursor = createCalendarCursor(this.calendarType);
      await setSetting('calendarType', this.calendarType);
      this.toast('Takvim tercihi kaydedildi.');
    });
    document.querySelector('#sync-folder-button')?.addEventListener('click', async () => {
      try {
        this.syncStatus = { ...this.syncStatus, running: true };
        this.renderSettings();
        const result = await selectMobileSyncFolder();
        this.syncStatus = await getMobileSyncStatus();
        await this.reloadDocuments();
        await this.platform.refreshFromStorage();
        await successHaptic();
        this.toast(describeSyncResult(result));
      } catch (error) {
        this.syncStatus = await getMobileSyncStatus().catch(() => this.syncStatus);
        this.toast(error?.message || 'Sync klasörü seçilemedi.', 'error');
      }
      this.renderSettings();
    });
    document.querySelector('#sync-now-button')?.addEventListener('click', async () => {
      try {
        if (this.activeDocument) await this.saveActiveDebounced.flush();
        this.syncStatus = { ...this.syncStatus, running: true };
        this.renderSettings();
        const result = await runMobileSync({ reason: 'manual', requireFresh: true });
        this.syncStatus = await getMobileSyncStatus();
        await this.reloadDocuments();
        await this.platform.refreshFromStorage();
        await successHaptic();
        this.toast(describeSyncResult(result));
      } catch (error) {
        this.syncStatus = await getMobileSyncStatus().catch(() => this.syncStatus);
        this.toast(error?.message || 'Senkronizasyon başarısız.', 'error');
      }
      this.renderSettings();
    });
    document.querySelector('#open-drivesync-button')?.addEventListener('click', async () => {
      try {
        await openDriveSyncApp();
      } catch (error) {
        this.toast(error?.message || 'DriveSync açılamadı.', 'error');
      }
    });
    document.querySelector('#sync-disconnect-button')?.addEventListener('click', async () => {
      if (!confirm('Sync klasörü bağlantısı kesilsin mi? Yerel veriler korunur.')) return;
      await disconnectMobileSync();
      this.syncStatus = await getMobileSyncStatus();
      this.renderSettings();
    });
    document.querySelector('#backup-button')?.addEventListener('click', async () => {
      try {
        await shareBackup(await exportDatabase());
        await successHaptic();
        this.toast('Yedek hazırlandı.');
      } catch (error) {
        this.toast(error?.message || 'Yedek oluşturulamadı.', 'error');
      }
    });
    document.querySelector('#import-button')?.addEventListener('click', () => {
      document.querySelector('#backup-file')?.click();
    });
    document.querySelector('#backup-file')?.addEventListener('change', (event) => {
      this.restoreBackup(event.target.files?.[0]);
    });
  }

  async restoreBackup(file) {
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (!confirm('Mevcut Pisi verileri bu yedekle değiştirilsin mi?')) return;
      await importDatabase(backup, { replace: true });
      await this.reloadDocuments();
      await successHaptic();
      this.toast('Yedek geri yüklendi.');
      this.renderSettings();
    } catch (error) {
      this.toast(error?.message || 'Yedek okunamadı.', 'error');
    }
  }

  renderEditor() {
    const note = this.activeDocument;
    if (!note) return this.navigate('notes');
    const isJournal = note.kind === 'journal';
    root.innerHTML = `
      <div class="responsive-layout detail-layout">
      ${this.platform.landscapeRailTemplate('editor')}
      <div class="detail-shell">
        <header class="detail-header">
          <button class="back-button" id="detail-back" aria-label="Geri">‹</button>
          <div class="detail-title-wrap">
            <span>${isJournal ? 'Günlük' : note.kind === 'source' ? 'Kaynak' : note.kind === 'database' ? 'Veritabanı' : 'Not'}</span>
            <input id="note-title" value="${escapeHtml(note.title)}" aria-label="Not başlığı"
              autocomplete="off" autocapitalize="sentences" enterkeyhint="next" />
          </div>
          <div class="detail-actions"><button class="round-button" id="document-tools" aria-label="Belge araçları">•••</button><button class="round-button danger-quiet" id="delete-note" aria-label="Notu sil">×</button></div>
        </header>
        <div class="editor-mode-tabs">
          <button class="${this.editorTab === 'write' ? 'active' : ''}" data-editor-tab="write">
            <span>✎</span> Yazı
          </button>
          <button class="${this.editorTab === 'draw' ? 'active' : ''}" data-editor-tab="draw">
            <span>⌁</span> Çizim
          </button>
          <button class="${this.editorTab === 'sheet' ? 'active' : ''}" data-editor-tab="sheet">
            <span>▦</span> Tablo
          </button>
        </div>
        <main class="editor-stage">
          ${this.editorTab === 'draw'
            ? this.drawingTemplate()
            : this.editorTab === 'sheet'
              ? this.sheetTemplate()
              : this.writingTemplate()}
        </main>
        <div id="save-state" class="save-state">Henüz doğrulanmadı</div>
      </div>
      ${this.platform.documentInspectorTemplate(note)}
      </div>
    `;
    this.bindEditor();
  }

  writingTemplate() {
    const documentFonts = collectDocumentFontFamilies(this.activeDocument.content);
    const fontFamilies = [...new Set([
      ...PISI_EDITOR_FONT_FAMILIES,
      ...documentFonts
    ])];
    const fontOptions = fontFamilies.map((font) => (
      `<option value="${escapeHtml(font)}">${escapeHtml(font)}${documentFonts.includes(font) && !PISI_EDITOR_FONT_FAMILIES.includes(font) ? ' · belgede' : ''}</option>`
    )).join('');

    return `
      <section class="writing-workspace">
        <div class="format-toolbar portrait-format-toolbar" data-portrait-format-toolbar role="toolbar" aria-label="Hızlı metin biçimlendirme">
          <button data-command="bold" aria-label="Kalın"><b>B</b></button>
          <button data-command="italic" aria-label="İtalik"><i>I</i></button>
          <select class="compact-block-select" data-format-block-select aria-label="Paragraf türü">
            <option value="P">Normal</option>
            <option value="H1">H1</option>
            <option value="H2">H2</option>
            <option value="BLOCKQUOTE">Alıntı</option>
          </select>
          <button data-command="insertUnorderedList" aria-label="Liste">≡</button>
          <button data-todo-button aria-label="Görev ekle" title="Görev /todo">☐</button>
          <button data-command="createLink" data-link-button aria-label="Bağlantı">⌁</button>
        </div>

        <div class="landscape-format-toolbar" data-landscape-format-toolbar role="toolbar" aria-label="Gelişmiş metin biçimlendirme">
          <div class="landscape-format-row landscape-format-row-primary">
            <select class="landscape-font-select" data-font-family-select aria-label="Yazı tipi">
              ${fontOptions}
            </select>
            <select class="landscape-size-select" data-font-size-select aria-label="Yazı boyutu">
              ${PISI_EDITOR_FONT_SIZES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
            </select>
            <span class="format-separator"></span>
            <button data-command="bold" aria-label="Kalın"><b>B</b></button>
            <button data-command="italic" aria-label="İtalik"><i>I</i></button>
            <button data-command="underline" aria-label="Altı çizili"><u>U</u></button>
            <button data-command="strikeThrough" aria-label="Üstü çizili"><s>S</s></button>
            <label class="landscape-color-tool" aria-label="Yazı rengi" title="Yazı rengi">
              <input type="color" data-text-color value="#e99a2e" />
              <i>A</i>
            </label>
            <label class="landscape-color-tool highlight-tool" aria-label="Vurgu rengi" title="Vurgu rengi">
              <input type="color" data-highlight-color value="#fff2a8" />
              <i>▰</i>
            </label>
          </div>
          <div class="landscape-format-row landscape-format-row-secondary">
            <select class="landscape-block-select" data-format-block-select aria-label="Paragraf türü">
              <option value="P">Normal</option>
              <option value="H1">Başlık 1</option>
              <option value="H2">Başlık 2</option>
              <option value="H3">Başlık 3</option>
              <option value="BLOCKQUOTE">Alıntı</option>
              <option value="PRE">Kod</option>
            </select>
            <span class="format-separator"></span>
            <button data-command="justifyLeft" aria-label="Sola hizala">≡←</button>
            <button data-command="justifyCenter" aria-label="Ortala">≡</button>
            <button data-command="justifyRight" aria-label="Sağa hizala">→≡</button>
            <span class="format-separator"></span>
            <button data-command="insertUnorderedList" aria-label="Madde listesi">•≡</button>
            <button data-command="insertOrderedList" aria-label="Numaralı liste">1.</button>
            <button data-todo-button aria-label="Görev ekle" title="Görev /todo">☐</button>
            <button data-command="createLink" data-link-button aria-label="Bağlantı">⌁</button>
            <button data-command="removeFormat" aria-label="Biçimlendirmeyi temizle">Tx</button>
            ${this.platform.toolbarExtensionsTemplate()}
          </div>
        </div>

        <article id="rich-editor" class="rich-editor" contenteditable="true" spellcheck="true"
          inputmode="text" enterkeyhint="enter" autocapitalize="sentences"
          data-placeholder="Yazmaya başla…">${sanitizeRichHtml(this.activeDocument.content)}</article>
      </section>
    `;
  }

  drawingTemplate() {
    return `
      <section class="drawing-workspace">
        <div class="drawing-toolbar">
          <button class="${this.drawTool === 'pen' ? 'active' : ''}" data-draw-tool="pen">Kalem</button>
          <button class="${this.drawTool === 'eraser' ? 'active' : ''}" data-draw-tool="eraser">Silgi</button>
          <label class="draw-color"><input id="draw-color" type="color" value="${this.drawColor}" /><span></span></label>
          <label class="stroke-size">İnce
            <input id="draw-width" type="range" min="2" max="24" value="${this.drawWidth}" />
            Kalın
          </label>
          <button class="quiet-danger" id="clear-drawing">Temizle</button>
        </div>
        <div class="drawing-paper">
          <canvas id="drawing-canvas" aria-label="Çizim alanı"></canvas>
          <p id="drawing-placeholder">Parmağınla çizmeye başla</p>
        </div>
      </section>
    `;
  }

  sheetTemplate() {
    const sheet = this.activeDocument.sheet;
    const results = evaluateSheet(sheet.cells);
    const headers = Array.from({ length: sheet.cols }, (_, col) => `<th>${columnName(col)}</th>`).join('');
    const rows = Array.from({ length: sheet.rows }, (_, row) => `
      <tr>
        <th>${row + 1}</th>
        ${Array.from({ length: sheet.cols }, (_, col) => {
          const key = `${columnName(col)}${row + 1}`;
          const raw = String(sheet.cells[key] ?? '');
          const shown = raw.startsWith('=') ? results[key] : raw;
          return `<td><input data-cell="${key}" data-raw="${escapeHtml(raw)}" value="${escapeHtml(shown)}" inputmode="decimal" /></td>`;
        }).join('')}
      </tr>
    `).join('');

    return `
      <section class="sheet-workspace">
        <div class="formula-bar">
          <strong id="selected-cell">${this.sheetSelection}</strong>
          <span>fx</span>
          <input id="formula-input" value="${escapeHtml(String(sheet.cells[this.sheetSelection] ?? ''))}"
            placeholder="Değer veya =SUM(A1:A3)" />
        </div>
        <div class="sheet-scroll">
          <table class="spreadsheet">
            <thead><tr><th></th>${headers}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="sheet-actions">
          <button id="add-sheet-row">＋ Satır</button>
          <button id="add-sheet-column">＋ Sütun</button>
          <details class="formula-catalog"><summary>Formüller</summary>
            ${Object.entries(FORMULA_CATALOG).map(([group, formulas]) => `<div><strong>${group}</strong>${formulas.map((formula) => `<button type="button" data-formula-name="${formula}">${formula}</button>`).join('')}</div>`).join('')}
          </details>
        </div>
      </section>
    `;
  }

  bindEditor() {
    document.querySelector('#detail-back')?.addEventListener('click', () => this.leaveDetail());
    document.querySelector('#document-tools')?.addEventListener('click', () => this.platform.openDocumentPanel());
    const titleInput = document.querySelector('#note-title');
    titleInput?.addEventListener('input', (event) => {
      this.activeDocument.title = event.target.value;
      this.scheduleSave();
    });
    titleInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      document.querySelector('#rich-editor')?.focus({ preventScroll: true });
    });
    document.querySelector('#delete-note')?.addEventListener('click', () => this.deleteActiveDocument());
    document.querySelectorAll('[data-editor-tab]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.captureEditorState();
        this.editorTab = button.dataset.editorTab;
        this.renderEditor();
      });
    });

    if (this.editorTab === 'write') this.bindWritingEditor();
    if (this.editorTab === 'draw') this.bindDrawingEditor();
    if (this.editorTab === 'sheet') this.bindSheetEditor();
    this.platform.bindChrome();
    this.platform.bindToolbarExtensions();
  }

  async captureEditorState() {
    const editor = document.querySelector('#rich-editor');
    if (editor) {
      this.activeDocument.blocks = serializeBlocks(editor);
      this.activeDocument.content = sanitizeRichHtml(editor.innerHTML);
    }
    await this.saveActiveDebounced.flush();
  }

  bindWritingEditor() {
    const editor = document.querySelector('#rich-editor');
    if (!editor) return;

    const selection = () => document.getSelection();
    const selectionIsInsideEditor = () => {
      const current = selection();
      if (!current?.rangeCount) return false;
      const range = current.getRangeAt(0);
      const node = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      return Boolean(node && (node === editor || editor.contains(node)));
    };
    const rememberSelection = () => {
      if (!selectionIsInsideEditor()) return;
      this.richTextRange = selection().getRangeAt(0).cloneRange();
    };
    const restoreSelection = () => {
      const current = selection();
      if (
        !this.richTextRange
        || !editor.isConnected
        || !editor.contains(this.richTextRange.commonAncestorContainer)
      ) return false;
      current.removeAllRanges();
      current.addRange(this.richTextRange);
      return true;
    };
    const commitRichText = () => {
      this.activeDocument.blocks = serializeBlocks(editor);
      this.activeDocument.content = editor.innerHTML;
      rememberSelection();
      this.scheduleSave();
    };
    const runCommand = (command, value = null) => {
      editor.focus({ preventScroll: true });
      restoreSelection();
      let applied = document.execCommand(command, false, value);
      if (command === 'hiliteColor' && applied === false) {
        applied = document.execCommand('backColor', false, value);
      }
      commitRichText();
      syncToolbarState();
    };
    const ensureSelectOption = (select, value, label = value) => {
      if (!select || !value) return;
      select.querySelectorAll('option[data-context-only="true"]').forEach((option) => {
        if (option.value !== value) option.remove();
      });
      const exists = [...select.options].some((option) => option.value === value);
      if (!exists) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.dataset.contextOnly = 'true';
        select.prepend(option);
      }
      select.value = value;
    };
    const currentElement = () => {
      const current = selection();
      if (!current?.rangeCount) return null;
      const node = current.anchorNode;
      return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement || null;
    };
    const syncToolbarState = () => {
      if (!selectionIsInsideEditor()) return;
      const element = currentElement();
      const style = element ? getComputedStyle(element) : null;

      document.querySelectorAll('[data-command]').forEach((button) => {
        const command = button.dataset.command;
        if (!['bold', 'italic', 'underline', 'strikeThrough'].includes(command)) return;
        let active = false;
        try { active = document.queryCommandState(command); } catch {}
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });

      const fontSelect = document.querySelector('[data-font-family-select]');
      const family = String(style?.fontFamily || '')
        .split(',')[0]
        .trim()
        .replace(/^["']|["']$/g, '');
      if (family) ensureSelectOption(fontSelect, family, `${family} · geçerli`);

      const sizeSelect = document.querySelector('[data-font-size-select]');
      let sizeValue = '';
      try { sizeValue = String(document.queryCommandValue('fontSize') || ''); } catch {}
      if (PISI_EDITOR_FONT_SIZES.some(([value]) => value === sizeValue)) {
        sizeSelect.value = sizeValue;
      } else if (style?.fontSize) {
        const currentLabel = String(style.fontSize).replace(/px$/i, '');
        const currentValue = `current:${style.fontSize}`;
        ensureSelectOption(sizeSelect, currentValue, `${currentLabel} · geçerli`);
      }

      const block = element?.closest?.('h1,h2,h3,blockquote,pre,p,div');
      const tag = block?.tagName || 'P';
      document.querySelectorAll('[data-format-block-select]').forEach((select) => {
        if ([...select.options].some((option) => option.value === tag)) select.value = tag;
      });
    };

    this.blockBinding = bindPisiBlocks(editor, {
      onChange: (blocks) => {
        this.activeDocument.blocks = blocks;
        this.activeDocument.content = editor.innerHTML;
        rememberSelection();
        this.scheduleSave();
      },
      onTaskToggle: () => lightHaptic()
    });

    editor.addEventListener('keyup', () => {
      rememberSelection();
      syncToolbarState();
    });
    editor.addEventListener('pointerup', () => {
      rememberSelection();
      syncToolbarState();
    });
    editor.addEventListener('input', () => {
      rememberSelection();
      syncToolbarState();
    });
    if (this.richSelectionChangeHandler) {
      document.removeEventListener('selectionchange', this.richSelectionChangeHandler);
    }
    this.richSelectionChangeHandler = () => {
      if (!selectionIsInsideEditor()) return;
      rememberSelection();
      syncToolbarState();
    };
    document.addEventListener('selectionchange', this.richSelectionChangeHandler);

    document.querySelectorAll('[data-command]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        rememberSelection();
        if (button.dataset.linkButton !== undefined) {
          const value = prompt('Bağlantı adresi veya [[Node adı]]');
          if (!value) return;
          if (value.startsWith('[[')) runCommand('insertText', value);
          else if (/^(https?:\/\/|mailto:)/i.test(value)) runCommand('createLink', value);
          else this.toast('Bağlantı http, https, mailto veya [[Node]] olmalı.', 'error');
          return;
        }
        runCommand(button.dataset.command, button.dataset.commandValue || null);
      });
    });

    document.querySelectorAll('[data-format-block-select]').forEach((select) => {
      select.addEventListener('pointerdown', rememberSelection);
      select.addEventListener('change', () => runCommand('formatBlock', select.value));
    });

    document.querySelector('[data-font-family-select]')?.addEventListener('pointerdown', rememberSelection);
    document.querySelector('[data-font-family-select]')?.addEventListener('change', (event) => {
      runCommand('fontName', event.target.value);
    });

    document.querySelector('[data-font-size-select]')?.addEventListener('pointerdown', rememberSelection);
    document.querySelector('[data-font-size-select]')?.addEventListener('change', (event) => {
      if (String(event.target.value).startsWith('current:')) return;
      runCommand('fontSize', event.target.value);
    });

    document.querySelectorAll('[data-text-color]').forEach((input) => {
      input.addEventListener('pointerdown', rememberSelection);
      input.addEventListener('input', (event) => runCommand('foreColor', event.target.value));
    });
    document.querySelectorAll('[data-highlight-color]').forEach((input) => {
      input.addEventListener('pointerdown', rememberSelection);
      input.addEventListener('input', (event) => runCommand('hiliteColor', event.target.value));
    });

    document.querySelectorAll('[data-todo-button]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        rememberSelection();
        const current = selection();
        const selectedText = current?.toString().trim() || '';
        const savedRange = this.richTextRange?.cloneRange() || null;
        document.querySelector('#todo-options-overlay')?.remove();
        document.body.insertAdjacentHTML('beforeend', `<div id="todo-options-overlay" class="platform-overlay todo-options-overlay"><form class="todo-options-card"><header><strong>Görev ayrıntıları</strong><button type="button" data-todo-cancel>×</button></header><label>Önem<select name="importance"><option value="normal">Normal</option><option value="high">Yüksek</option><option value="urgent">Acil</option><option value="low">Düşük</option></select></label><label>Tarih<input name="date" placeholder="yarın, cuma 14:00"></label><button class="primary-button">Checkbox ekle</button></form></div>`);
        const overlay = document.querySelector('#todo-options-overlay');
        const restoreEditorFocus = () => requestAnimationFrame(() => {
          if (savedRange && editor.isConnected) {
            current.removeAllRanges();
            current.addRange(savedRange);
            this.richTextRange = savedRange.cloneRange();
          }
          editor.focus({ preventScroll: true });
        });
        overlay.querySelector('[data-todo-cancel]').addEventListener('click', () => {
          overlay.remove();
          restoreEditorFocus();
        });
        overlay.querySelector('form').addEventListener('submit', (submitEvent) => {
          submitEvent.preventDefault();
          const values = Object.fromEntries(new FormData(submitEvent.currentTarget));
          if (savedRange) {
            current.removeAllRanges();
            current.addRange(savedRange);
          }
          const parsed = parseTurkishDate(values.date);
          insertTodoAtSelection(editor, {
            text: selectedText || undefined,
            importance: values.importance,
            scheduledAt: parsed.scheduledAt,
            deadline: parsed.deadline,
            durationMinutes: parsed.durationMinutes,
            repeat: parsed.repeat
          });
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
          overlay.remove();
          restoreEditorFocus();
        });
      });
    });

    requestAnimationFrame(() => {
      if (selectionIsInsideEditor()) {
        rememberSelection();
        syncToolbarState();
      }
    });
  }

  bindDrawingEditor() {
    const canvas = document.querySelector('#drawing-canvas');
    const placeholder = document.querySelector('#drawing-placeholder');
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    const paper = canvas.parentElement;
    let drawing = false;
    let lastPoint = null;
    let restoredImage = null;

    const resize = () => {
      const rect = paper.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 3);
      const saved = canvas.width ? canvas.toDataURL() : null;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      const source = restoredImage || saved;
      if (source) {
        const image = new Image();
        image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
        image.src = source;
      }
      restoredImage = null;
    };

    restoredImage = this.activeDocument.drawing;
    if (restoredImage) placeholder?.classList.add('hidden');
    requestAnimationFrame(resize);

    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      drawing = true;
      lastPoint = point(event);
      placeholder?.classList.add('hidden');
      context.beginPath();
      context.moveTo(lastPoint.x, lastPoint.y);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drawing) return;
      event.preventDefault();
      const next = point(event);
      context.globalCompositeOperation = this.drawTool === 'eraser' ? 'destination-out' : 'source-over';
      context.strokeStyle = this.drawColor;
      context.lineWidth = this.drawWidth;
      context.beginPath();
      context.moveTo(lastPoint.x, lastPoint.y);
      context.lineTo(next.x, next.y);
      context.stroke();
      lastPoint = next;
    });
    const finish = () => {
      if (!drawing) return;
      drawing = false;
      context.globalCompositeOperation = 'source-over';
      this.activeDocument.drawing = canvas.toDataURL('image/png');
      this.scheduleSave();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    document.querySelectorAll('[data-draw-tool]').forEach((button) => {
      button.addEventListener('click', () => {
        this.drawTool = button.dataset.drawTool;
        document.querySelectorAll('[data-draw-tool]').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
      });
    });
    document.querySelector('#draw-color')?.addEventListener('input', (event) => {
      this.drawColor = event.target.value;
      this.drawTool = 'pen';
    });
    document.querySelector('#draw-width')?.addEventListener('input', (event) => {
      this.drawWidth = Number(event.target.value);
    });
    document.querySelector('#clear-drawing')?.addEventListener('click', () => {
      if (!confirm('Bu çizim temizlensin mi?')) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      this.activeDocument.drawing = null;
      placeholder?.classList.remove('hidden');
      this.scheduleSave();
    });
  }

  bindSheetEditor() {
    const inputs = [...document.querySelectorAll('[data-cell]')];
    const formulaInput = document.querySelector('#formula-input');
    const selectedLabel = document.querySelector('#selected-cell');

    const refreshValues = (keepFocused = true) => {
      const results = evaluateSheet(this.activeDocument.sheet.cells);
      inputs.forEach((input) => {
        if (keepFocused && input === document.activeElement) return;
        const raw = String(this.activeDocument.sheet.cells[input.dataset.cell] ?? '');
        input.dataset.raw = raw;
        input.value = raw.startsWith('=') ? results[input.dataset.cell] : raw;
        input.classList.toggle('cell-error', String(input.value).startsWith('#'));
      });
    };

    inputs.forEach((input) => {
      input.addEventListener('focus', () => {
        this.sheetSelection = input.dataset.cell;
        input.value = String(this.activeDocument.sheet.cells[this.sheetSelection] ?? '');
        if (formulaInput) formulaInput.value = input.value;
        if (selectedLabel) selectedLabel.textContent = this.sheetSelection;
        input.select();
      });
      input.addEventListener('input', () => {
        this.activeDocument.sheet.cells[input.dataset.cell] = input.value;
        input.dataset.raw = input.value;
        if (formulaInput) formulaInput.value = input.value;
        this.scheduleSave();
      });
      input.addEventListener('blur', () => refreshValues(false));
    });

    formulaInput?.addEventListener('input', () => {
      this.activeDocument.sheet.cells[this.sheetSelection] = formulaInput.value;
      const cell = document.querySelector(`[data-cell="${this.sheetSelection}"]`);
      if (cell) {
        cell.value = formulaInput.value;
        cell.dataset.raw = formulaInput.value;
      }
      this.scheduleSave();
    });
    formulaInput?.addEventListener('blur', () => refreshValues(false));

    document.querySelectorAll('[data-formula-name]').forEach((button) => {
      button.addEventListener('click', () => {
        const name = button.dataset.formulaName;
        const suggestions = {
          IF: '=IF(A1>0,"Evet","Hayır")', AND: '=AND(A1>0,B1>0)', OR: '=OR(A1>0,B1>0)',
          NOT: '=NOT(A1>0)', XOR: '=XOR(A1>0,B1>0)', IFERROR: '=IFERROR(A1/B1,0)',
          CONCAT: '=CONCAT(A1," ",B1)', TEXTJOIN: '=TEXTJOIN(", ",TRUE,A1:A5)',
          SUM: '=SUM(A1:A5)', AVERAGE: '=AVERAGE(A1:A5)', PI: '=PI()'
        };
        const value = suggestions[name] || `=${name}(A1)`;
        this.activeDocument.sheet.cells[this.sheetSelection] = value;
        if (formulaInput) { formulaInput.value = value; formulaInput.focus(); }
        const cell = document.querySelector(`[data-cell="${this.sheetSelection}"]`);
        if (cell) cell.value = value;
        this.scheduleSave();
      });
    });

    document.querySelector('#add-sheet-row')?.addEventListener('click', async () => {
      this.activeDocument.sheet.rows += 1;
      await this.saveActive();
      this.renderEditor();
    });
    document.querySelector('#add-sheet-column')?.addEventListener('click', async () => {
      this.activeDocument.sheet.cols += 1;
      await this.saveActive();
      this.renderEditor();
    });
  }

  async purgeSemanticRelationshipsForNode(nodeId) {
    const clean = (document) => {
      let changed = false;
      if (document.kind === 'canvas') {
        const beforeEdges = document.canvas?.edges?.length || 0;
        document.canvas.edges = (document.canvas?.edges || []).filter(
          ({ sourceId, targetId }) => sourceId !== nodeId && targetId !== nodeId
        );
        changed ||= document.canvas.edges.length !== beforeEdges;

        document.canvas.nodes = (document.canvas?.nodes || []).map((node) => {
          if (node.id === nodeId) return node;
          const relations = (node.relations || []).filter((relation) => (
            relation.targetId !== nodeId && relation.sourceId !== nodeId
          ));
          if (relations.length !== (node.relations || []).length) {
            changed = true;
            return { ...node, relations };
          }
          return node;
        });

        const beforeCollapsed = document.canvas.collapsedHubs || [];
        const nextCollapsed = beforeCollapsed.filter((key) => {
          const match = String(key || '').match(
            /^(node_[A-Za-z0-9_-]+)::(top|right|bottom|left)$/
          );
          if (!match || match[1] === nodeId) return false;
          return document.canvas.edges.some((edge) => (
            isHierarchyMapEdge(edge)
            && edge.sourceId === match[1]
            && edge.sourcePort === match[2]
          ));
        });
        if (nextCollapsed.length !== beforeCollapsed.length) changed = true;
        document.canvas.collapsedHubs = nextCollapsed;
      } else {
        const relations = (document.relations || []).filter((relation) => (
          relation.targetId !== nodeId && relation.sourceId !== nodeId
        ));
        if (relations.length !== (document.relations || []).length) {
          document.relations = relations;
          changed = true;
        }
      }
      return changed;
    };

    for (let index = 0; index < this.documents.length; index += 1) {
      const document = this.documents[index];
      if (document.id === this.activeDocument?.id) continue;
      const copy = structuredClone(document);
      if (!clean(copy)) continue;
      const stored = await putDocument(copy, {
        durable: false,
        notify: false,
        recordHistory: false
      });
      this.documents[index] = normalizeDocument(stored);
    }
    if (this.activeDocument) clean(this.activeDocument);
  }

  async deleteActiveDocument() {
    if (!this.activeDocument) return;
    const noun = this.activeDocument.kind === 'canvas' ? 'harita' : 'not';
    if (!confirm(`Bu ${noun} kalıcı olarak silinsin mi?`)) return;
    const id = this.activeDocument.id;
    const removedNodeIds = this.activeDocument.kind === 'canvas'
      ? (this.activeDocument.canvas?.nodes || []).map(({ id: nodeId }) => nodeId)
      : [id];
    for (const nodeId of removedNodeIds) {
      await this.purgeSemanticRelationshipsForNode(nodeId);
    }
    await removeDocument(id);
    this.documents = this.documents.filter((document) => document.id !== id);
    this.activeDocument = null;
    await lightHaptic();
    this.navigate(this.returnRoute || 'notes');
  }

  visibleMapGraph() {
    const canvas = this.activeDocument?.canvas || { nodes: [], edges: [], collapsedHubs: [] };
    const hidden = new Set();
    const outgoing = new Map();
    canvas.edges.filter(isHierarchyMapEdge).forEach((edge) => {
      if (!outgoing.has(edge.sourceId)) outgoing.set(edge.sourceId, []);
      outgoing.get(edge.sourceId).push(edge);
    });
    const hideBranch = (nodeId, visited = new Set()) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      hidden.add(nodeId);
      (outgoing.get(nodeId) || []).forEach((edge) => hideBranch(edge.targetId, visited));
    };
    (canvas.collapsedHubs || []).forEach((key) => {
      const match = String(key || '').match(
        /^(node_[A-Za-z0-9_-]+)::(top|right|bottom|left)$/
      );
      if (!match) return;
      const [, nodeId, anchor] = match;
      (outgoing.get(nodeId) || [])
        .filter((edge) => edge.sourcePort === anchor)
        .forEach((edge) => hideBranch(edge.targetId, new Set([nodeId])));
    });
    return {
      nodes: canvas.nodes.filter(({ id }) => !hidden.has(id)),
      edges: canvas.edges.filter(({ sourceId, targetId }) => (
        !hidden.has(sourceId) && !hidden.has(targetId)
      )),
      hidden
    };
  }

  toggleMapAnchor(key) {
    const match = String(key || '').match(
      /^(node_[A-Za-z0-9_-]+)::(top|right|bottom|left)$/
    );
    if (!match) return;
    const canonicalKey = `${match[1]}::${match[2]}`;
    const collapsed = this.activeDocument.canvas.collapsedHubs ||= [];
    const index = collapsed.indexOf(canonicalKey);
    if (index >= 0) collapsed.splice(index, 1);
    else collapsed.push(canonicalKey);
    this.scheduleSave();
    this.renderMapEditor();
  }

  collectSemanticRelationships() {
    const documents = this.documents.map((document) => (
      this.activeDocument?.id === document.id ? this.activeDocument : document
    ));
    if (
      this.activeDocument
      && !documents.some((document) => document.id === this.activeDocument.id)
    ) {
      documents.push(this.activeDocument);
    }

    const raw = [];
    const addRelations = (sourceId, relations = []) => {
      for (const relation of Array.isArray(relations) ? relations : []) {
        raw.push({ ...structuredClone(relation), sourceId });
      }
    };

    for (const document of documents) {
      if (document.kind === 'canvas') {
        for (const edge of document.canvas?.edges || []) {
          const relationship = mapEdgeToRelationship(edge);
          if (relationship) raw.push(relationship);
        }
        for (const node of document.canvas?.nodes || []) {
          addRelations(node.id, node.relations);
        }
      } else {
        addRelations(document.id, document.relations);
      }
    }
    return normalizeRelationshipCollection(raw).relationships;
  }

  renderMapEditor() {
    this.closeMapEdgeMenu();
    const map = this.activeDocument;
    if (!map) return this.navigate('maps');
    const canvas = map.canvas;
    const graph = this.visibleMapGraph();
    root.innerHTML = `
      <div class="responsive-layout map-layout">
      ${this.platform.landscapeRailTemplate('map')}
      <div class="map-detail-shell">
        <header class="map-header">
          <button class="back-button" id="map-back" aria-label="Geri">‹</button>
          <input id="map-title" value="${escapeHtml(map.title)}" aria-label="Harita başlığı" />
          <button class="round-button" id="map-fit" aria-label="Haritayı ekrana sığdır">◎</button>
        </header>
        <main id="map-viewport" class="map-viewport">
          <div id="map-world" class="map-world">
            <svg id="map-lines" class="map-lines" width="3000" height="2400" aria-hidden="true"></svg>
            <div id="map-nodes">
              ${graph.nodes.map((node) => `
                <article class="map-node ${this.selectedMapNode === node.id ? 'selected' : ''}"
                  data-node-id="${node.id}" style="left:${Number(node.x) || 0}px;top:${Number(node.y) || 0}px">
                  <button class="node-edit" data-edit-node="${node.id}" aria-label="Düğümü düzenle">✎</button>
                  <h3>${escapeHtml(node.title || 'Başlıksız')}</h3>
                  <p>${escapeHtml(htmlToText(node.content || '').slice(0, 90) || 'Ayrıntı ekle')}</p>
                  ${['top', 'right', 'bottom', 'left'].map((anchor) => {
                    const isConnectionStart = this.connectFrom?.nodeId === node.id && this.connectFrom?.anchor === anchor;
                    const isCollapsed = canvas.collapsedHubs.includes(`${node.id}::${anchor}`);
                    return `<button type="button" class="node-anchor anchor-${anchor} ${isCollapsed ? 'collapsed' : ''} ${isConnectionStart ? 'connection-start' : ''}" data-map-anchor="${node.id}::${anchor}" aria-label="${anchor} bağlantı noktası" aria-pressed="${isConnectionStart}"></button>`;
                  }).join('')}
                </article>
              `).join('')}
            </div>
          </div>
          <div class="map-tip ${this.connectFrom ? 'active' : ''}">
            ${this.connectFrom ? 'Diğer node’un bağlantı noktasına dokun' : 'Noktaya dokun: bağla · çift dokun: düğüm ekle'}
          </div>
        </main>
        <div class="map-toolbar">
          <button id="map-add-node"><span>＋</span> Düğüm</button>
          <button id="map-unlink" ${this.selectedMapNode ? '' : 'disabled'}><span>⌫</span> Ayır</button>
          <button id="map-delete-node" ${this.selectedMapNode ? '' : 'disabled'} class="danger-tool"><span>×</span> Sil</button>
        </div>
        ${this.mapEditingNode ? this.mapNodeSheetTemplate() : ''}
        <div id="save-state" class="save-state">Henüz doğrulanmadı</div>
      </div>
      ${this.platform.landscapeInspectorTemplate('map')}
      </div>
    `;
    this.applyMapTransform();
    this.bindMapEditor();
    this.platform.bindChrome();
    requestAnimationFrame(() => this.drawMapLines());
  }

  mapNodeSheetTemplate() {
    const node = this.activeDocument.canvas.nodes.find(({ id }) => id === this.mapEditingNode);
    if (!node) return '';
    return `
      <div class="sheet-overlay" id="node-sheet-overlay">
        <section class="node-sheet">
          <div class="sheet-handle"></div>
          <div class="node-sheet-header">
            <h2>Düğümü düzenle</h2>
            <button id="close-node-sheet">Bitti</button>
          </div>
          <label>Başlık<input id="node-sheet-title" value="${escapeHtml(node.title || '')}"
            autocomplete="off" autocapitalize="sentences" enterkeyhint="next" /></label>
          <label>Not<textarea id="node-sheet-content" rows="8" placeholder="Bu fikirle ilgili ayrıntılar…"
            autocapitalize="sentences" enterkeyhint="done">${escapeHtml(htmlToText(node.content || ''))}</textarea></label>
        </section>
      </div>
    `;
  }

  applyMapTransform() {
    const world = document.querySelector('#map-world');
    if (!world || !this.activeDocument) return;
    const { x, y, zoom } = this.activeDocument.canvas.camera;
    world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  }

  bindMapEditor() {
    document.querySelector('#map-back')?.addEventListener('click', () => this.leaveDetail());
    document.querySelector('#map-title')?.addEventListener('input', (event) => {
      this.activeDocument.title = event.target.value;
      this.scheduleSave();
    });
    document.querySelector('#map-fit')?.addEventListener('click', () => this.fitMap());
    document.querySelector('#map-add-node')?.addEventListener('click', () => this.addMapNode());
    document.querySelector('#map-unlink')?.addEventListener('click', () => this.unlinkSelectedNode());
    document.querySelector('#map-delete-node')?.addEventListener('click', () => {
      this.deleteSelectedNode().catch((error) => this.showSaveFailure(error));
    });

    document.querySelectorAll('[data-edit-node]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const nodeId = button.dataset.editNode;
        const isReference = (this.activeDocument.canvas.references || [])
          .some((reference) => reference.id === nodeId);
        if (isReference) {
          this.openDocument(nodeId, 'map');
          return;
        }
        this.mapEditingNode = nodeId;
        this.renderMapEditor();
      });
    });
    document.querySelectorAll('[data-map-anchor]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.handleMapAnchorConnection(button.dataset.mapAnchor);
      });
    });

    this.bindMapEdgeInteractions();
    this.bindMapPan();
    this.bindMapNodes();
    this.bindMapNodeSheet();
  }

  bindMapPan() {
    const viewport = document.querySelector('#map-viewport');
    if (!viewport) return;
    const pointers = new Map();
    let panStart = null;
    let pinchStart = null;
    let tapStart = null;
    let lastTap = null;
    const doubleTapDelay = 340;
    const tapMoveTolerance = 12;
    const doubleTapDistance = 36;
    const localPoint = (event) => {
      const rect = viewport.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const distance = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const midpoint = () => {
      const [a, b] = [...pointers.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    viewport.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.map-node') || event.target.closest('.map-toolbar')) return;
      event.preventDefault();
      viewport.setPointerCapture(event.pointerId);
      const currentPoint = localPoint(event);
      pointers.set(event.pointerId, currentPoint);
      if (pointers.size === 1) {
        tapStart = {
          pointerId: event.pointerId,
          point: currentPoint,
          startedAt: performance.now(),
          moved: false
        };
        panStart = {
          pointerX: currentPoint.x,
          pointerY: currentPoint.y,
          cameraX: this.activeDocument.canvas.camera.x,
          cameraY: this.activeDocument.canvas.camera.y
        };
      } else if (pointers.size === 2) {
        tapStart = null;
        lastTap = null;
        pinchStart = {
          distance: distance(),
          midpoint: midpoint(),
          camera: { ...this.activeDocument.canvas.camera }
        };
      }
    });

    viewport.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      const currentPoint = localPoint(event);
      pointers.set(event.pointerId, currentPoint);
      if (tapStart?.pointerId === event.pointerId
        && Math.hypot(currentPoint.x - tapStart.point.x, currentPoint.y - tapStart.point.y) > tapMoveTolerance) {
        tapStart.moved = true;
      }
      const camera = this.activeDocument.canvas.camera;
      if (pointers.size === 1 && panStart) {
        camera.x = panStart.cameraX + currentPoint.x - panStart.pointerX;
        camera.y = panStart.cameraY + currentPoint.y - panStart.pointerY;
      } else if (pointers.size === 2 && pinchStart) {
        const nextMidpoint = midpoint();
        const nextZoom = Math.min(2.2, Math.max(0.35,
          pinchStart.camera.zoom * (distance() / Math.max(1, pinchStart.distance))
        ));
        const worldX = (pinchStart.midpoint.x - pinchStart.camera.x) / pinchStart.camera.zoom;
        const worldY = (pinchStart.midpoint.y - pinchStart.camera.y) / pinchStart.camera.zoom;
        camera.zoom = nextZoom;
        camera.x = nextMidpoint.x - worldX * nextZoom;
        camera.y = nextMidpoint.y - worldY * nextZoom;
      }
      this.applyMapTransform();
    });

    const release = (event) => {
      if (!pointers.has(event.pointerId)) return;
      const releasedPoint = localPoint(event);
      const wasTap = pointers.size === 1
        && tapStart?.pointerId === event.pointerId
        && !tapStart.moved
        && performance.now() - tapStart.startedAt <= 260;

      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) {
        panStart = null;
        this.scheduleSave();
      }

      if (wasTap) {
        const now = performance.now();
        const isDoubleTap = lastTap
          && now - lastTap.at <= doubleTapDelay
          && Math.hypot(releasedPoint.x - lastTap.point.x, releasedPoint.y - lastTap.point.y) <= doubleTapDistance;
        if (isDoubleTap) {
          lastTap = null;
          tapStart = null;
          this.addMapNode(releasedPoint);
          return;
        }
        lastTap = { at: now, point: releasedPoint };
      } else {
        lastTap = null;
      }
      tapStart = null;
    };
    viewport.addEventListener('pointerup', release);
    viewport.addEventListener('pointercancel', (event) => {
      lastTap = null;
      tapStart = null;
      release(event);
    });
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      const camera = this.activeDocument.canvas.camera;
      const rect = viewport.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const worldX = (x - camera.x) / camera.zoom;
      const worldY = (y - camera.y) / camera.zoom;
      camera.zoom = Math.min(2.2, Math.max(0.35, camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
      camera.x = x - worldX * camera.zoom;
      camera.y = y - worldY * camera.zoom;
      this.applyMapTransform();
      this.scheduleSave();
    }, { passive: false });
  }

  bindMapNodes() {
    document.querySelectorAll('.map-node').forEach((element) => {
      let start = null;
      let moved = false;
      const id = element.dataset.nodeId;
      const node = this.activeDocument.canvas.nodes.find((item) => item.id === id);
      if (!node) return;

      element.addEventListener('pointerdown', (event) => {
        if (event.target.closest('.node-edit, .node-anchor')) return;
        event.preventDefault();
        event.stopPropagation();
        element.setPointerCapture(event.pointerId);
        start = {
          x: event.clientX,
          y: event.clientY,
          nodeX: Number(node.x) || 0,
          nodeY: Number(node.y) || 0
        };
        moved = false;
      });
      element.addEventListener('pointermove', (event) => {
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.hypot(dx, dy) > 4) moved = true;
        if (!moved) return;
        const zoom = this.activeDocument.canvas.camera.zoom;
        node.x = start.nodeX + dx / zoom;
        node.y = start.nodeY + dy / zoom;
        element.style.left = `${node.x}px`;
        element.style.top = `${node.y}px`;
        this.drawMapLines();
      });
      const release = () => {
        if (!start) return;
        if (moved) this.scheduleSave();
        else this.selectMapNode(id);
        start = null;
      };
      element.addEventListener('pointerup', release);
      element.addEventListener('pointercancel', () => { start = null; });
    });
  }

  selectMapNode(id) {
    this.selectedMapNode = id;
    document.querySelectorAll('.map-node').forEach((element) => {
      element.classList.toggle('selected', element.dataset.nodeId === id);
    });
    document.querySelectorAll('#map-unlink, #map-delete-node').forEach((button) => {
      button.disabled = false;
    });
    lightHaptic();
  }

  closeMapEdgeMenu() {
    document.querySelector('#map-edge-menu-overlay')?.remove();
    document.querySelectorAll('.map-edge-visible.menu-open').forEach((path) => {
      path.classList.remove('menu-open');
    });
  }

  bindMapEdgeInteractions() {
    document.querySelectorAll('[data-map-edge-hit]').forEach((path) => {
      path.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
      });
      path.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openMapEdgeMenu(path.dataset.edgeId);
      });
    });
  }

  openMapEdgeMenu(edgeId) {
    const edge = this.activeDocument?.canvas?.edges
      ?.find((candidate) => candidate.id === edgeId);
    if (!edge) return;

    this.closeMapEdgeMenu();
    document.querySelector(
      `.map-edge-visible[data-edge-id="${CSS.escape(edgeId)}"]`
    )?.classList.add('menu-open');

    const labels = {
      'down-hub': ['Hub', 'Parent → child'],
      'co-level': ['Co-level', 'Aynı seviyede'],
      stream: ['Stream', 'Yönlü akış']
    };
    const options = ['down-hub', 'co-level', 'stream'].map((type) => {
      const [label, description] = labels[type];
      return `
        <button type="button"
          class="map-edge-type-option ${edge.type === type ? 'active' : ''}"
          data-map-edge-type="${type}">
          <span class="map-edge-type-swatch map-edge-type-swatch-${type}" aria-hidden="true"></span>
          <span><strong>${label}</strong><small>${description}</small></span>
          <i aria-hidden="true">${edge.type === type ? '✓' : ''}</i>
        </button>
      `;
    }).join('');

    const overlay = document.createElement('div');
    overlay.id = 'map-edge-menu-overlay';
    overlay.className = 'map-edge-menu-overlay';
    overlay.innerHTML = `
      <section class="map-edge-menu-sheet" role="dialog" aria-modal="true"
        aria-label="Bağlantı seçenekleri">
        <div class="sheet-handle"></div>
        <div class="map-edge-menu-header">
          <div>
            <span>Bağlantı</span>
            <strong>Tipini değiştir veya sil</strong>
          </div>
          <button type="button" data-close-map-edge-menu aria-label="Kapat">×</button>
        </div>
        <div class="map-edge-type-options">${options}</div>
        <button type="button" class="map-edge-delete-action" data-delete-map-edge>
          <span>×</span> Bağlantıyı sil
        </button>
      </section>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-close-map-edge-menu]')) {
        this.closeMapEdgeMenu();
      }
    });
    overlay.querySelectorAll('[data-map-edge-type]').forEach((button) => {
      button.addEventListener('click', () => {
        this.changeMapEdgeType(edgeId, button.dataset.mapEdgeType);
      });
    });
    overlay.querySelector('[data-delete-map-edge]')?.addEventListener('click', () => {
      this.deleteMapEdge(edgeId);
    });
    lightHaptic();
  }

  pruneMapCollapsedHubs() {
    const canvas = this.activeDocument?.canvas;
    if (!canvas) return;
    canvas.collapsedHubs = (canvas.collapsedHubs || []).filter((key) => {
      const match = String(key || '').match(
        /^(node_[A-Za-z0-9_-]+)::(top|right|bottom|left)$/
      );
      if (!match) return false;
      const [, nodeId, port] = match;
      return canvas.edges.some((edge) => (
        isHierarchyMapEdge(edge)
        && edge.sourceId === nodeId
        && edge.sourcePort === port
      ));
    });
  }

  changeMapEdgeType(edgeId, nextType) {
    if (!['down-hub', 'co-level', 'stream'].includes(nextType)) return;
    const canvas = this.activeDocument?.canvas;
    const edge = canvas?.edges?.find((candidate) => candidate.id === edgeId);
    if (!canvas || !edge) return;
    if (edge.type === nextType) {
      this.closeMapEdgeMenu();
      return;
    }

    const currentRelationships = this.collectSemanticRelationships();
    let prepared = prepareMapConnection(currentRelationships, {
      ...edge,
      type: nextType
    });

    if (prepared.code === 'SECOND_PARENT_CONFIRM_REQUIRED') {
      const confirmed = confirm(
        'Bu node zaten bir parent’a sahip. Bağlantı hiyerarşi yerine stream ilişkisi olarak kaydedilsin mi?'
      );
      if (!confirmed) return;
      prepared = prepareMapConnection(currentRelationships, {
        ...edge,
        type: nextType
      }, {
        confirmSecondParentAsStream: true
      });
    }

    if (!prepared.ok) {
      this.toast(prepared.error || 'Bağlantı tipi değiştirilemedi.', 'error');
      return;
    }
    if (prepared.unchanged) {
      this.toast('Aynı ilişki zaten mevcut.', 'error');
      return;
    }

    canvas.edges = canvas.edges.map((candidate) => (
      candidate.id === edgeId ? prepared.edge : candidate
    ));
    this.pruneMapCollapsedHubs();
    this.closeMapEdgeMenu();
    this.scheduleSave();
    successHaptic();
    this.renderMapEditor();
  }

  deleteMapEdge(edgeId) {
    const canvas = this.activeDocument?.canvas;
    const edge = canvas?.edges?.find((candidate) => candidate.id === edgeId);
    if (!canvas || !edge) return;
    if (!confirm('Bu bağlantı silinsin mi?')) return;

    canvas.edges = canvas.edges.filter((candidate) => candidate.id !== edgeId);
    this.pruneMapCollapsedHubs();
    this.closeMapEdgeMenu();
    this.scheduleSave();
    successHaptic();
    this.renderMapEditor();
  }

  handleMapAnchorConnection(key) {
    const match = String(key || '').match(
      /^(node_[A-Za-z0-9_-]+)::(top|right|bottom|left)$/
    );
    if (!match) return;
    const [, nodeId, anchor] = match;
    if (!this.activeDocument?.canvas?.nodes?.some((node) => node.id === nodeId)) return;

    if (!this.connectFrom) {
      this.connectFrom = { nodeId, anchor };
      this.selectedMapNode = nodeId;
      lightHaptic();
      this.renderMapEditor();
      return;
    }

    if (this.connectFrom.nodeId === nodeId) {
      if (this.connectFrom.anchor === anchor) {
        const hasOutgoingHub = this.activeDocument.canvas.edges.some((edge) => (
          isHierarchyMapEdge(edge)
          && edge.sourceId === nodeId
          && edge.sourcePort === anchor
        ));
        this.connectFrom = null;
        if (hasOutgoingHub) {
          this.toggleMapAnchor(`${nodeId}::${anchor}`);
          return;
        }
      } else {
        this.connectFrom = { nodeId, anchor };
      }
      this.selectedMapNode = nodeId;
      lightHaptic();
      this.renderMapEditor();
      return;
    }

    const source = this.connectFrom;
    const rawEdge = {
      id: makeId('edge'),
      sourceId: source.nodeId,
      targetId: nodeId,
      sourcePort: source.anchor,
      targetPort: anchor,
      type: 'down-hub',
      sourceRole: 'down-hub',
      targetRole: 'up-hub'
    };

    const currentRelationships = this.collectSemanticRelationships();
    let prepared = prepareMapConnection(currentRelationships, rawEdge);
    if (prepared.code === 'SECOND_PARENT_CONFIRM_REQUIRED') {
      const confirmed = confirm(
        'Bu node zaten bir parent’a sahip. Bağlantı hiyerarşi yerine stream ilişkisi olarak kaydedilsin mi?'
      );
      if (confirmed) {
        prepared = prepareMapConnection(currentRelationships, rawEdge, {
          confirmSecondParentAsStream: true
        });
      } else {
        this.connectFrom = null;
        this.selectedMapNode = nodeId;
        this.renderMapEditor();
        return;
      }
    }

    if (!prepared.ok) {
      this.connectFrom = null;
      this.selectedMapNode = nodeId;
      this.toast(prepared.error || 'Bağlantı oluşturulamadı.', 'error');
      lightHaptic();
      this.renderMapEditor();
      return;
    }

    if (!prepared.unchanged) {
      this.activeDocument.canvas.edges.push(prepared.edge);
      this.scheduleSave();
      successHaptic();
      if (prepared.edge.type === 'stream') {
        this.toast('İkinci parent bağlantısı stream olarak eklendi.');
      }
    } else {
      lightHaptic();
    }

    this.connectFrom = null;
    this.selectedMapNode = nodeId;
    this.renderMapEditor();
  }

  focusMapNode(id) {
    const node = this.activeDocument?.canvas?.nodes?.find((item) => item.id === id);
    if (!node) return;
    this.selectedMapNode = id;
    if (this.visibleMapGraph().hidden.has(id)) {
      this.activeDocument.canvas.collapsedHubs = [];
    }
    this.renderMapEditor();
    requestAnimationFrame(() => {
      const viewport = document.querySelector('#map-viewport');
      if (!viewport) return;
      const camera = this.activeDocument.canvas.camera;
      camera.x = viewport.clientWidth / 2 - ((Number(node.x) || 0) + 105) * camera.zoom;
      camera.y = viewport.clientHeight / 2 - ((Number(node.y) || 0) + 52) * camera.zoom;
      this.applyMapTransform();
      this.scheduleSave();
    });
  }

  addMapNode(viewportPoint = null) {
    const viewport = document.querySelector('#map-viewport');
    const camera = this.activeDocument.canvas.camera;
    const rect = viewport?.getBoundingClientRect() || { width: innerWidth, height: innerHeight };
    const point = viewportPoint || { x: rect.width / 2, y: rect.height / 2 };
    const node = {
      id: makeId('node'),
      title: 'Yeni fikir',
      content: '',
      x: (point.x - camera.x) / camera.zoom - 90,
      y: (point.y - camera.y) / camera.zoom - 45
    };
    this.activeDocument.canvas.nodes.push(node);
    this.selectedMapNode = node.id;
    this.mapEditingNode = node.id;
    this.scheduleSave();
    this.renderMapEditor();
  }

  unlinkSelectedNode() {
    if (!this.selectedMapNode) return;
    this.activeDocument.canvas.edges = this.activeDocument.canvas.edges.filter(
      ({ sourceId, targetId }) => (
        sourceId !== this.selectedMapNode && targetId !== this.selectedMapNode
      )
    );
    this.scheduleSave();
    this.renderMapEditor();
  }

  async deleteSelectedNode() {
    if (!this.selectedMapNode) return;
    const id = this.selectedMapNode;
    const isReference = (this.activeDocument.canvas.references || [])
      .some((reference) => reference.id === id);
    const promptText = isReference
      ? 'Bu referans haritadan kaldırılsın mı? Orijinal node silinmez.'
      : 'Seçili düğüm ve bağlantıları silinsin mi?';
    if (!confirm(promptText)) return;

    if (isReference) {
      this.activeDocument.canvas.references = this.activeDocument.canvas.references
        .filter((reference) => reference.id !== id);
      this.activeDocument.canvas.edges = this.activeDocument.canvas.edges.filter(
        ({ sourceId, targetId }) => sourceId !== id && targetId !== id
      );
    } else {
      await this.purgeSemanticRelationshipsForNode(id);
    }

    this.activeDocument.canvas.nodes = this.activeDocument.canvas.nodes.filter(
      (node) => node.id !== id
    );
    this.pruneMapCollapsedHubs();
    this.selectedMapNode = null;
    this.scheduleSave();
    this.renderMapEditor();
  }

  bindMapNodeSheet() {
    if (!this.mapEditingNode) return;
    const editingNodeId = this.mapEditingNode;
    const currentNode = () => this.activeDocument?.canvas?.nodes
      ?.find(({ id }) => id === editingNodeId);
    if (!currentNode()) return;

    const close = async () => {
      await this.saveActiveDebounced.flush();
      this.mapEditingNode = null;
      this.renderMapEditor();
    };
    document.querySelector('#close-node-sheet')?.addEventListener('click', () => {
      close().catch((error) => this.showSaveFailure(error));
    });
    document.querySelector('#node-sheet-overlay')?.addEventListener('click', (event) => {
      if (event.target.id === 'node-sheet-overlay') {
        close().catch((error) => this.showSaveFailure(error));
      }
    });
    document.querySelector('#node-sheet-title')?.addEventListener('input', (event) => {
      const node = currentNode();
      if (!node) return;
      node.title = event.target.value;
      this.scheduleSave();
    });
    document.querySelector('#node-sheet-title')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      document.querySelector('#node-sheet-content')?.focus({ preventScroll: true });
    });
    document.querySelector('#node-sheet-content')?.addEventListener('input', (event) => {
      const node = currentNode();
      if (!node) return;
      node.content = `<p>${escapeHtml(event.target.value).replaceAll('\n', '<br>')}</p>`;
      this.scheduleSave();
    });
  }

  drawMapLines() {
    const svg = document.querySelector('#map-lines');
    if (!svg || !this.activeDocument) return;
    const point = (element, anchor = 'right') => {
      const left = element.offsetLeft;
      const top = element.offsetTop;
      if (anchor === 'left') return { x: left, y: top + element.offsetHeight / 2 };
      if (anchor === 'top') return { x: left + element.offsetWidth / 2, y: top };
      if (anchor === 'bottom') return { x: left + element.offsetWidth / 2, y: top + element.offsetHeight };
      return { x: left + element.offsetWidth, y: top + element.offsetHeight / 2 };
    };
    const paths = this.visibleMapGraph().edges.map((edge) => {
      const from = document.querySelector(`[data-node-id="${CSS.escape(edge.sourceId)}"]`);
      const to = document.querySelector(`[data-node-id="${CSS.escape(edge.targetId)}"]`);
      if (!from || !to) return '';
      const sourcePort = edge.sourcePort || 'bottom';
      const targetPort = edge.targetPort || 'top';
      const start = point(from, sourcePort);
      const end = point(to, targetPort);
      const horizontal = ['left', 'right'].includes(sourcePort);
      const bend = Math.max(
        70,
        horizontal ? Math.abs(end.x - start.x) * 0.45 : Math.abs(end.y - start.y) * 0.45
      );
      const sx = sourcePort === 'left' ? -1 : 1;
      const sy = sourcePort === 'top' ? -1 : 1;
      const ex = targetPort === 'left' ? -1 : 1;
      const ey = targetPort === 'top' ? -1 : 1;
      const control1 = horizontal
        ? `${start.x + bend * sx},${start.y}`
        : `${start.x},${start.y + bend * sy}`;
      const targetHorizontal = ['left', 'right'].includes(targetPort);
      const control2 = targetHorizontal
        ? `${end.x + bend * ex},${end.y}`
        : `${end.x},${end.y + bend * ey}`;
      const d = `M${start.x},${start.y} C${control1} ${control2} ${end.x},${end.y}`;
      const markerId = edge.type === 'co-level'
        ? 'pisi-map-arrow-co-level'
        : edge.type === 'stream'
          ? 'pisi-map-arrow-stream'
          : 'pisi-map-arrow-down-hub';
      const markerStart = edge.type === 'co-level'
        ? ` marker-start="url(#${markerId})"`
        : '';
      return `
        <path class="map-edge-hit" data-map-edge-hit data-edge-id="${edge.id}" d="${d}" />
        <path class="map-edge-visible map-edge-${edge.type}" data-edge-id="${edge.id}"
          d="${d}"${markerStart} marker-end="url(#${markerId})" />
      `;
    }).join('');
    svg.innerHTML = `
      <defs>
        <marker id="pisi-map-arrow-down-hub" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M0 0L10 5L0 10Z" class="map-arrow-head map-arrow-head-down-hub" />
        </marker>
        <marker id="pisi-map-arrow-stream" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M0 0L10 5L0 10Z" class="map-arrow-head map-arrow-head-stream" />
        </marker>
        <marker id="pisi-map-arrow-co-level" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
          <path d="M0 0L10 5L0 10Z" class="map-arrow-head map-arrow-head-co-level" />
        </marker>
      </defs>
      ${paths}
    `;
    this.bindMapEdgeInteractions();
  }

  fitMap() {
    const viewport = document.querySelector('#map-viewport');
    const nodes = this.visibleMapGraph().nodes;
    if (!viewport || !nodes.length) return;
    const minX = Math.min(...nodes.map((node) => Number(node.x) || 0));
    const maxX = Math.max(...nodes.map((node) => (Number(node.x) || 0) + 210));
    const minY = Math.min(...nodes.map((node) => Number(node.y) || 0));
    const maxY = Math.max(...nodes.map((node) => (Number(node.y) || 0) + 105));
    const padding = 70;
    const zoom = Math.min(1.25, Math.max(0.35,
      Math.min(
        (viewport.clientWidth - padding * 2) / Math.max(1, maxX - minX),
        (viewport.clientHeight - padding * 2) / Math.max(1, maxY - minY)
      )
    ));
    this.activeDocument.canvas.camera = {
      zoom,
      x: (viewport.clientWidth - (minX + maxX) * zoom) / 2,
      y: (viewport.clientHeight - (minY + maxY) * zoom) / 2
    };
    this.applyMapTransform();
    this.scheduleSave();
  }

  toast(message, type = 'success') {
    let host = document.querySelector('#toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      document.body.appendChild(host);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    host.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 250);
    }, 2600);
  }
}

const application = new PisiApp();
application.init();

matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (application.theme === 'system') {
    application.applyTheme();
    updateNativeTheme('system');
  }
});
