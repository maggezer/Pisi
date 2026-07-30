import './styles.css';
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
import { columnName, evaluateSheet } from './spreadsheet.js';
import { escapeHtml, htmlToText, sanitizeRichHtml } from './sanitize.js';
import {
  initializeNativeShell,
  lightHaptic,
  onHardwareBack,
  exitNativeApp,
  shareBackup,
  successHaptic,
  updateNativeTheme
} from './native.js';

const root = document.querySelector('#app');

const NAV_ITEMS = [
  { id: 'notes', icon: '⌂', label: 'Notlar' },
  { id: 'maps', icon: '⌘', label: 'Haritalar' },
  { id: 'calendar', icon: '□', label: 'Takvim' },
  { id: 'settings', icon: '◉', label: 'Ayarlar' }
];

const WEEKDAYS = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];

function normalizeDocument(document) {
  const sheet = document.sheet || {};
  const canvas = document.canvas || {};
  return {
    ...createDocument(document.kind || 'note'),
    ...document,
    content: sanitizeRichHtml(document.content || '<p><br></p>'),
    sheet: {
      rows: Math.max(6, Number(sheet.rows) || 12),
      cols: Math.max(4, Number(sheet.cols) || 6),
      cells: sheet.cells && typeof sheet.cells === 'object' ? sheet.cells : {}
    },
    canvas: {
      nodes: Array.isArray(canvas.nodes) ? canvas.nodes : [],
      edges: Array.isArray(canvas.edges) ? canvas.edges : [],
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
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

function kindLabel(kind) {
  if (kind === 'journal') return 'Günlük';
  if (kind === 'canvas') return 'Harita';
  return 'Not';
}

function resolveTheme(theme) {
  if (theme === 'system') {
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return theme;
}

function debounce(callback, delay = 450) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    return callback(...args);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

class KediApp {
  constructor() {
    this.route = 'notes';
    this.returnRoute = 'notes';
    this.documents = [];
    this.activeDocument = null;
    this.noteFilter = 'all';
    this.editorTab = 'write';
    this.theme = 'system';
    this.calendarType = 'gregorian';
    this.calendarCursor = createCalendarCursor('gregorian');
    this.selectedMapNode = null;
    this.connectFrom = null;
    this.mapEditingNode = null;
    this.sheetSelection = 'A1';
    this.drawTool = 'pen';
    this.drawColor = '#e99a2e';
    this.drawWidth = 4;
    this.saveActiveDebounced = debounce(() => this.saveActive(), 500);
  }

  async init() {
    try {
      this.theme = await getSetting('theme', 'system');
      this.calendarType = await getSetting('calendarType', 'gregorian');
      this.calendarCursor = createCalendarCursor(this.calendarType);
      this.applyTheme();
      await initializeNativeShell(resolveTheme(this.theme));
      this.documents = (await seedDatabase()).map(normalizeDocument);
      await this.bindNativeBack();
      this.render();
    } catch (error) {
      console.error(error);
      root.innerHTML = `
        <main class="fatal-screen">
          <div class="cat-orbit">!</div>
          <h1>KEDI açılamadı</h1>
          <p>${escapeHtml(error?.message || 'Bilinmeyen bir hata oluştu.')}</p>
          <button class="primary-button" onclick="location.reload()">Yeniden dene</button>
        </main>
      `;
    }
  }

  async bindNativeBack() {
    await onHardwareBack(() => {
      if (['editor', 'map'].includes(this.route)) {
        this.leaveDetail();
        return;
      }
      if (this.mapEditingNode) {
        this.mapEditingNode = null;
        this.render();
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
    this.theme = theme;
    await setSetting('theme', theme);
    this.applyTheme();
    await updateNativeTheme(theme);
    this.render();
  }

  async reloadDocuments() {
    this.documents = (await listDocuments()).map(normalizeDocument);
  }

  navigate(route) {
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
    await putDocument(structuredClone(this.activeDocument));

    const index = this.documents.findIndex(({ id }) => id === this.activeDocument.id);
    if (index >= 0) this.documents[index] = normalizeDocument(structuredClone(this.activeDocument));
    else this.documents.unshift(normalizeDocument(structuredClone(this.activeDocument)));
    this.showSaveState();
  }

  showSaveState() {
    const status = document.querySelector('#save-state');
    if (!status) return;
    status.textContent = 'Kaydedildi';
    status.classList.add('visible');
    clearTimeout(this.saveStateTimer);
    this.saveStateTimer = setTimeout(() => status.classList.remove('visible'), 1400);
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
    if (this.route === 'calendar') return this.renderCalendar();
    if (this.route === 'settings') return this.renderSettings();
    return this.renderNotes();
  }

  shell({ title, eyebrow = '', actions = '', content, fab = '', route = this.route }) {
    root.innerHTML = `
      <div class="app-shell">
        <header class="page-header">
          <div>
            ${eyebrow ? `<span class="eyebrow">${escapeHtml(eyebrow)}</span>` : ''}
            <h1>${escapeHtml(title)}</h1>
          </div>
          <div class="header-actions">${actions}</div>
        </header>
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
      title: 'KEDI',
      eyebrow: 'Sessizce düzenle',
      actions: '<button class="round-button" data-route="settings" aria-label="Ayarlar">◉</button>',
      content: `
        <section class="welcome-strip">
          <div>
            <span>Bugün neyi çözüyoruz?</span>
            <strong>${searchable.length} not, tek sakin alan.</strong>
          </div>
          <div class="mini-cat" aria-hidden="true"><span></span><i></i></div>
        </section>
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
      title: 'Fikir haritaları',
      eyebrow: 'Bağlantıları gör',
      content: `
        <section class="map-intro">
          <div class="map-orbit"><span></span><span></span><i></i></div>
          <div>
            <h2>Fikirlerini serbest bırak.</h2>
            <p>Düğümleri dokunarak taşı, bağla ve ayrıntılandır.</p>
          </div>
        </section>
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

  async createMap() {
    const centerNode = {
      id: makeId('node'),
      title: 'Ana fikir',
      content: '',
      x: 640,
      y: 440
    };
    const document = normalizeDocument(createDocument('canvas', {
      canvas: {
        nodes: [centerNode],
        edges: [],
        camera: { x: -500, y: -330, zoom: 1 }
      }
    }));
    await putDocument(document);
    this.documents.unshift(document);
    await successHaptic();
    this.openDocument(document.id, 'maps');
  }

  renderCalendar() {
    let month;
    try {
      month = getCalendarMonth(this.calendarType, this.calendarCursor);
    } catch (error) {
      console.error(error);
      this.calendarType = 'gregorian';
      this.calendarCursor = createCalendarCursor('gregorian');
      month = getCalendarMonth('gregorian', this.calendarCursor);
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
      title: 'Takvim',
      eyebrow: 'Günlere not düş',
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
          <div class="weekdays">${WEEKDAYS.map((day) => `<span>${day}</span>`).join('')}</div>
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
    this.shell({
      title: 'Ayarlar',
      eyebrow: 'Kendi düzenin',
      content: `
        <section class="settings-profile">
          <div class="settings-logo"><span></span><i></i></div>
          <div><strong>KEDI Mobile</strong><span>Yerel, sakin ve çevrimdışı.</span></div>
        </section>
        <section class="settings-group">
          <h2>Görünüm</h2>
          <div class="segmented-control">
            ${[
              ['system', 'Sistem'],
              ['dark', 'Koyu'],
              ['light', 'Açık']
            ].map(([theme, label]) => `
              <button class="${this.theme === theme ? 'active' : ''}" data-theme="${theme}">${label}</button>
            `).join('')}
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
            <span><strong>Yedeği geri yükle</strong><small>Bir KEDI yedek dosyası seç</small></span>
            <b>›</b>
          </button>
          <input id="backup-file" type="file" accept="application/json,.json" hidden />
        </section>
        <section class="settings-group about-group">
          <h2>Hakkında</h2>
          <p>KEDI 2.0 · Android mobil sürüm</p>
          <p>Notların bu cihazda saklanır; sen dışa aktarmadıkça başka yere gönderilmez.</p>
        </section>
      `
    });

    document.querySelectorAll('[data-theme]').forEach((button) => {
      button.addEventListener('click', () => this.setTheme(button.dataset.theme));
    });
    document.querySelector('#calendar-setting')?.addEventListener('change', async (event) => {
      this.calendarType = event.target.value;
      this.calendarCursor = createCalendarCursor(this.calendarType);
      await setSetting('calendarType', this.calendarType);
      this.toast('Takvim tercihi kaydedildi.');
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
      if (!confirm('Mevcut KEDI verileri bu yedekle değiştirilsin mi?')) return;
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
      <div class="detail-shell">
        <header class="detail-header">
          <button class="back-button" id="detail-back" aria-label="Geri">‹</button>
          <div class="detail-title-wrap">
            <span>${isJournal ? 'Günlük' : 'Not'}</span>
            <input id="note-title" value="${escapeHtml(note.title)}" aria-label="Not başlığı" />
          </div>
          <button class="round-button danger-quiet" id="delete-note" aria-label="Notu sil">×</button>
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
        <div id="save-state" class="save-state">Kaydedildi</div>
      </div>
    `;
    this.bindEditor();
  }

  writingTemplate() {
    return `
      <section class="writing-workspace">
        <div class="format-toolbar" role="toolbar" aria-label="Metin biçimlendirme">
          <button data-command="bold" aria-label="Kalın"><b>B</b></button>
          <button data-command="italic" aria-label="İtalik"><i>I</i></button>
          <button data-command="underline" aria-label="Altı çizili"><u>U</u></button>
          <span></span>
          <button data-block="H1">H1</button>
          <button data-block="H2">H2</button>
          <button data-command="insertUnorderedList" aria-label="Liste">≡</button>
          <label class="color-tool" aria-label="Yazı rengi">
            <input type="color" id="text-color" value="#e99a2e" />
            <i>A</i>
          </label>
        </div>
        <article id="rich-editor" class="rich-editor" contenteditable="true" spellcheck="true"
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
          <span>SUM · AVERAGE · MIN · MAX</span>
        </div>
      </section>
    `;
  }

  bindEditor() {
    document.querySelector('#detail-back')?.addEventListener('click', () => this.leaveDetail());
    document.querySelector('#note-title')?.addEventListener('input', (event) => {
      this.activeDocument.title = event.target.value;
      this.scheduleSave();
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
  }

  async captureEditorState() {
    const editor = document.querySelector('#rich-editor');
    if (editor) this.activeDocument.content = sanitizeRichHtml(editor.innerHTML);
    await this.saveActiveDebounced.flush();
  }

  bindWritingEditor() {
    const editor = document.querySelector('#rich-editor');
    editor?.addEventListener('input', () => {
      this.activeDocument.content = editor.innerHTML;
      this.scheduleSave();
    });
    document.querySelectorAll('[data-command], [data-block]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        editor?.focus();
        if (button.dataset.block) document.execCommand('formatBlock', false, button.dataset.block);
        else document.execCommand(button.dataset.command, false);
        this.activeDocument.content = editor?.innerHTML || '';
        this.scheduleSave();
      });
    });
    document.querySelector('#text-color')?.addEventListener('input', (event) => {
      editor?.focus();
      document.execCommand('foreColor', false, event.target.value);
      this.activeDocument.content = editor?.innerHTML || '';
      this.scheduleSave();
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

  async deleteActiveDocument() {
    if (!this.activeDocument) return;
    const noun = this.activeDocument.kind === 'canvas' ? 'harita' : 'not';
    if (!confirm(`Bu ${noun} kalıcı olarak silinsin mi?`)) return;
    const id = this.activeDocument.id;
    await removeDocument(id);
    this.documents = this.documents.filter((document) => document.id !== id);
    this.activeDocument = null;
    await lightHaptic();
    this.navigate(this.returnRoute || 'notes');
  }

  renderMapEditor() {
    const map = this.activeDocument;
    if (!map) return this.navigate('maps');
    const canvas = map.canvas;
    root.innerHTML = `
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
              ${canvas.nodes.map((node) => `
                <article class="map-node ${this.selectedMapNode === node.id ? 'selected' : ''}"
                  data-node-id="${node.id}" style="left:${Number(node.x) || 0}px;top:${Number(node.y) || 0}px">
                  <button class="node-edit" data-edit-node="${node.id}" aria-label="Düğümü düzenle">✎</button>
                  <h3>${escapeHtml(node.title || 'Başlıksız')}</h3>
                  <p>${escapeHtml(htmlToText(node.content || '').slice(0, 90) || 'Ayrıntı ekle')}</p>
                  <i class="node-anchor"></i>
                </article>
              `).join('')}
            </div>
          </div>
          <div class="map-tip ${this.connectFrom ? 'active' : ''}">
            ${this.connectFrom ? 'Bağlanacak ikinci düğüme dokun' : 'Boş alanda sürükle · düğümü seçip taşı'}
          </div>
        </main>
        <div class="map-toolbar">
          <button id="map-add-node"><span>＋</span> Düğüm</button>
          <button id="map-connect" ${this.selectedMapNode ? '' : 'disabled'} class="${this.connectFrom ? 'active' : ''}">
            <span>⌁</span> Bağla
          </button>
          <button id="map-unlink" ${this.selectedMapNode ? '' : 'disabled'}><span>⌫</span> Ayır</button>
          <button id="map-delete-node" ${this.selectedMapNode ? '' : 'disabled'} class="danger-tool"><span>×</span> Sil</button>
        </div>
        ${this.mapEditingNode ? this.mapNodeSheetTemplate() : ''}
        <div id="save-state" class="save-state">Kaydedildi</div>
      </div>
    `;
    this.applyMapTransform();
    this.bindMapEditor();
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
          <label>Başlık<input id="node-sheet-title" value="${escapeHtml(node.title || '')}" /></label>
          <label>Not<textarea id="node-sheet-content" rows="8" placeholder="Bu fikirle ilgili ayrıntılar…">${escapeHtml(htmlToText(node.content || ''))}</textarea></label>
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
    document.querySelector('#map-connect')?.addEventListener('click', () => this.startConnection());
    document.querySelector('#map-unlink')?.addEventListener('click', () => this.unlinkSelectedNode());
    document.querySelector('#map-delete-node')?.addEventListener('click', () => this.deleteSelectedNode());

    document.querySelectorAll('[data-edit-node]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.mapEditingNode = button.dataset.editNode;
        this.renderMapEditor();
      });
    });

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
        panStart = {
          pointerX: currentPoint.x,
          pointerY: currentPoint.y,
          cameraX: this.activeDocument.canvas.camera.x,
          cameraY: this.activeDocument.canvas.camera.y
        };
      } else if (pointers.size === 2) {
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
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) {
        panStart = null;
        this.scheduleSave();
      }
    };
    viewport.addEventListener('pointerup', release);
    viewport.addEventListener('pointercancel', release);
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
        if (event.target.closest('.node-edit')) return;
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
    if (this.connectFrom && this.connectFrom !== id) {
      const duplicate = this.activeDocument.canvas.edges.some((edge) =>
        (edge.from === this.connectFrom && edge.to === id)
        || (edge.to === this.connectFrom && edge.from === id)
      );
      if (!duplicate) {
        this.activeDocument.canvas.edges.push({ id: makeId('edge'), from: this.connectFrom, to: id });
        this.scheduleSave();
        successHaptic();
      }
      this.connectFrom = null;
      this.selectedMapNode = id;
      this.renderMapEditor();
      return;
    }
    this.selectedMapNode = id;
    document.querySelectorAll('.map-node').forEach((element) => {
      element.classList.toggle('selected', element.dataset.nodeId === id);
    });
    document.querySelectorAll('#map-connect, #map-unlink, #map-delete-node').forEach((button) => {
      button.disabled = false;
    });
    lightHaptic();
  }

  addMapNode() {
    const viewport = document.querySelector('#map-viewport');
    const camera = this.activeDocument.canvas.camera;
    const rect = viewport?.getBoundingClientRect() || { width: innerWidth, height: innerHeight };
    const node = {
      id: makeId('node'),
      title: 'Yeni fikir',
      content: '',
      x: (rect.width / 2 - camera.x) / camera.zoom - 90,
      y: (rect.height / 2 - camera.y) / camera.zoom - 45
    };
    this.activeDocument.canvas.nodes.push(node);
    this.selectedMapNode = node.id;
    this.mapEditingNode = node.id;
    this.scheduleSave();
    this.renderMapEditor();
  }

  startConnection() {
    if (!this.selectedMapNode) return;
    this.connectFrom = this.connectFrom ? null : this.selectedMapNode;
    this.renderMapEditor();
  }

  unlinkSelectedNode() {
    if (!this.selectedMapNode) return;
    this.activeDocument.canvas.edges = this.activeDocument.canvas.edges.filter(
      ({ from, to }) => from !== this.selectedMapNode && to !== this.selectedMapNode
    );
    this.scheduleSave();
    this.renderMapEditor();
  }

  deleteSelectedNode() {
    if (!this.selectedMapNode) return;
    if (!confirm('Seçili düğüm ve bağlantıları silinsin mi?')) return;
    const id = this.selectedMapNode;
    this.activeDocument.canvas.nodes = this.activeDocument.canvas.nodes.filter((node) => node.id !== id);
    this.activeDocument.canvas.edges = this.activeDocument.canvas.edges.filter(
      ({ from, to }) => from !== id && to !== id
    );
    this.selectedMapNode = null;
    this.scheduleSave();
    this.renderMapEditor();
  }

  bindMapNodeSheet() {
    if (!this.mapEditingNode) return;
    const node = this.activeDocument.canvas.nodes.find(({ id }) => id === this.mapEditingNode);
    if (!node) return;
    const close = () => {
      this.mapEditingNode = null;
      this.renderMapEditor();
    };
    document.querySelector('#close-node-sheet')?.addEventListener('click', close);
    document.querySelector('#node-sheet-overlay')?.addEventListener('click', (event) => {
      if (event.target.id === 'node-sheet-overlay') close();
    });
    document.querySelector('#node-sheet-title')?.addEventListener('input', (event) => {
      node.title = event.target.value;
      this.scheduleSave();
    });
    document.querySelector('#node-sheet-content')?.addEventListener('input', (event) => {
      node.content = `<p>${escapeHtml(event.target.value).replaceAll('\n', '<br>')}</p>`;
      this.scheduleSave();
    });
  }

  drawMapLines() {
    const svg = document.querySelector('#map-lines');
    if (!svg || !this.activeDocument) return;
    svg.innerHTML = this.activeDocument.canvas.edges.map((edge) => {
      const from = document.querySelector(`[data-node-id="${CSS.escape(edge.from)}"]`);
      const to = document.querySelector(`[data-node-id="${CSS.escape(edge.to)}"]`);
      if (!from || !to) return '';
      const x1 = from.offsetLeft + from.offsetWidth / 2;
      const y1 = from.offsetTop + from.offsetHeight / 2;
      const x2 = to.offsetLeft + to.offsetWidth / 2;
      const y2 = to.offsetTop + to.offsetHeight / 2;
      const bend = Math.max(70, Math.abs(x2 - x1) * 0.45);
      const direction = x2 >= x1 ? 1 : -1;
      return `<path d="M${x1},${y1} C${x1 + bend * direction},${y1} ${x2 - bend * direction},${y2} ${x2},${y2}" />`;
    }).join('');
  }

  fitMap() {
    const viewport = document.querySelector('#map-viewport');
    const nodes = this.activeDocument.canvas.nodes;
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

const application = new KediApp();
application.init();

matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (application.theme === 'system') {
    application.applyTheme();
    updateNativeTheme('system');
  }
});
