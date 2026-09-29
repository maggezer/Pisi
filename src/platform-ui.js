import {
  getSetting, inspectDatabaseIntegrity, listDocumentVersions, listTasks, putDocument,
  putTask, removeTask, restoreDocumentVersion, setSetting
} from './db.js';
import { parseTurkishDate, postponeDate } from './date-parser.js';
import { buildRelationshipModel, buildSearchIndex, searchIndex } from './search.js';
import {
  applyStructuredView, applyTemplate, createSavedView, createTemplate,
  generatePropertyMap, normalizePropertySchema, propertyValue
} from './properties.js';
import { makeQuoteBlock } from './research.js';
import { exportDocument, importPortableFile } from './portability.js';
import { initializePlatformApis, invokeExtension, listExtensions } from './extensions.js';
import { escapeHtml, htmlToText, sanitizeRichHtml } from './sanitize.js';
import { lightHaptic, successHaptic } from './native.js';

const TODAY = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function focusField(element) {
  requestAnimationFrame(() => {
    if (!element?.isConnected) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });
}

function routeLabel(route) {
  return ({ notes: 'Notlar', maps: 'Haritalar', tasks: 'Görevler', calendar: 'Takvim', pisi: 'Pisi', data: 'Node sistemi', settings: 'Ayarlar' })[route] || 'Pisi';
}

function taskGroup(task, view) {
  const date = String(task.scheduledAt || task.deadline || '').slice(0, 10);
  if (view === 'done') return task.done;
  if (task.done) return false;
  if (view === 'today') return date === TODAY();
  if (view === 'upcoming') return Boolean(date && date > TODAY());
  return !date;
}

function taskDateLabel(task) {
  const date = task.scheduledAt || task.deadline;
  if (!date) return 'Inbox';
  return new Date(date.length === 10 ? `${date}T12:00:00` : date).toLocaleString('tr-TR', {
    day: 'numeric', month: 'short', ...(date.includes('T') ? { hour: '2-digit', minute: '2-digit' } : {})
  });
}

export class PlatformController {
  constructor(app) {
    this.app = app;
    this.tasks = [];
    this.taskView = 'inbox';
    this.dataTab = 'structured';
    this.schema = [];
    this.savedViews = [];
    this.templates = [];
    this.activeView = { type: 'cards', filters: [], sort: [] };
    this.documentVersions = [];
    this.searchCache = null;
    this.searchSignature = '';
    this.boundHotkeys = false;
  }

  async init() {
    [this.tasks, this.schema, this.savedViews, this.templates] = await Promise.all([
      listTasks(),
      getSetting('propertySchema', []),
      getSetting('savedViews', []),
      getSetting('templates', [])
    ]);
    this.schema = normalizePropertySchema(this.schema);
    initializePlatformApis({
      listDocuments: () => structuredClone(this.app.documents),
      openDocument: (id) => this.app.openDocument(id),
      quickAddTask: (task) => this.createTask(task)
    });
    this.bindKeyboardShortcuts();
  }

  async refreshFromStorage() {
    [this.tasks, this.schema, this.savedViews, this.templates] = await Promise.all([
      listTasks(),
      getSetting('propertySchema', []),
      getSetting('savedViews', []),
      getSetting('templates', [])
    ]);
    this.schema = normalizePropertySchema(this.schema);
    this.searchCache = null;
    this.searchSignature = '';
  }

  async prepareDocument(id) {
    this.documentVersions = await listDocumentVersions(id);
  }

  landscapeRailTemplate(route = this.app.route) {
    const documents = this.app.documents.slice(0, 80);
    return `
      <aside class="landscape-rail" aria-label="Pisi gezinme">
        <div class="landscape-brand"><span class="settings-logo"><i></i></span><strong>Pisi</strong></div>
        <button class="landscape-search" type="button" data-platform-search><span>⌕</span> Her yerde ara <kbd>Ctrl K</kbd></button>
        <nav class="landscape-primary-nav">
          ${['notes', 'maps', 'tasks', 'calendar', 'pisi', 'data', 'settings'].map((item) => `
            <button type="button" class="${route === item ? 'active' : ''}" data-route="${item}">${routeLabel(item)}</button>
          `).join('')}
        </nav>
        <div class="landscape-tree-heading"><strong>Çalışma alanı</strong><button type="button" data-quick-note title="Yeni not">＋</button></div>
        <div class="landscape-document-tree">
          ${documents.map((document) => `
            <div class="landscape-tree-row" style="--depth:${document.parentId ? 1 : 0}">
              <button type="button" data-rail-open="${escapeHtml(document.id)}" title="Tek tık: aç · Çift tık: yeniden adlandır">
                <span>${document.kind === 'canvas' ? '◇' : document.kind === 'source' ? '⌁' : '□'}</span>
                <b>${escapeHtml(document.title || 'Başlıksız')}</b>
              </button>
              <input data-rail-rename="${escapeHtml(document.id)}" value="${escapeHtml(document.title || '')}" hidden />
            </div>
          `).join('')}
        </div>
        <button class="landscape-quick-task" type="button" data-platform-quick-task>＋ Hızlı görev <kbd>Ctrl ⇧ A</kbd></button>
      </aside>`;
  }

  landscapeInspectorTemplate(route = this.app.route) {
    if (route === 'editor' && this.app.activeDocument) return this.documentInspectorTemplate(this.app.activeDocument);
    if (route === 'map' && this.app.activeDocument) {
      const map = this.app.activeDocument;
      return `<aside class="landscape-inspector"><div class="inspector-heading"><small>Harita</small><h2>${escapeHtml(map.title)}</h2></div>
        <section><h3>Özet</h3><p>${map.canvas.nodes.length} düğüm · ${map.canvas.edges.length} bağlantı</p></section>
        <section><h3>Yerleşim</h3><button type="button" class="inspector-action" data-platform-map-layout="radial">Radyal yerleşim</button></section>
        <section><h3>Kısayollar</h3><p>Kaydır: taşı · Sıkıştır: yakınlaştır · Bağlantı noktasına dokun: alt dalı aç/kapat</p></section>
      </aside>`;
    }
    return `<aside class="landscape-inspector">
      <div class="inspector-heading"><small>Çalışma alanı</small><h2>${routeLabel(route)}</h2></div>
      <section><h3>Hızlı erişim</h3>
        <button type="button" class="inspector-action" data-platform-search>⌕ Global arama</button>
        <button type="button" class="inspector-action" data-platform-quick-task>✓ Görev yakala</button>
        <button type="button" class="inspector-action" data-route="data">▦ Node sistemi</button>
      </section>
      <section><h3>Durum</h3><p>${this.app.documents.length} belge · ${this.tasks.filter(({ done }) => !done).length} açık görev</p></section>
      <section><h3>Yatay Pisi</h3><p>Geniş ekranda belge ağacı ve derin çalışma araçları görünür; 840 px ve üzerindeki genişliklerde sağ inspector da açılır.</p></section>
    </aside>`;
  }

  documentInspectorTemplate(note) {
    const relationships = buildRelationshipModel(this.app.documents, note.id);
    const schemaNames = new Set(this.schema.flatMap((property) => [property.id, property.name]));
    const adHocProperties = Object.entries(note.properties || {}).filter(([key]) => !schemaNames.has(key));
    const schemaProperties = this.schema.map((property) => {
      const value = propertyValue(note, property, this.app.documents);
      if (property.type === 'rollup') {
        return `<label class="rollup-property"><span>${escapeHtml(property.name)}</span><output>${escapeHtml(value ?? '—')}</output><small>rollup</small></label>`;
      }
      if (property.type === 'relation') {
        const selected = Array.isArray(value) ? value : value ? [value] : [];
        return `<label class="relation-property"><span>${escapeHtml(property.name)}</span><select data-relation-property="${escapeHtml(property.name)}" multiple>${this.app.documents.filter(({ id }) => id !== note.id).map((row) => `<option value="${row.id}" ${selected.includes(row.id) ? 'selected' : ''}>${escapeHtml(row.title)}</option>`).join('')}</select><small>relation</small></label>`;
      }
      return `<label><span>${escapeHtml(property.name)}</span><input data-property-key="${escapeHtml(property.name)}" type="${property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : property.type === 'checkbox' ? 'checkbox' : property.type === 'url' ? 'url' : 'text'}" ${property.type === 'checkbox' ? (value ? 'checked' : '') : `value="${escapeHtml(Array.isArray(value) ? value.join(', ') : value ?? '')}"`}><button type="button" data-property-delete="${escapeHtml(property.name)}">×</button></label>`;
    });
    const propertyRows = [...schemaProperties, ...adHocProperties.map(([key, value]) => `<label><span>${escapeHtml(key)}</span><input data-property-key="${escapeHtml(key)}" value="${escapeHtml(Array.isArray(value) ? value.join(', ') : value)}"><button type="button" data-property-delete="${escapeHtml(key)}">×</button></label>`)];
    const sources = this.app.documents.filter(({ kind }) => kind === 'source');
    const graphLinks = [
      ...relationships.inbound.map((row) => ({ row, type: 'backlink' })),
      ...relationships.outbound.map((row) => ({ row, type: 'link' })),
      ...relationships.unlinked.map((row) => ({ row, type: 'mention' })),
      ...relationships.blockInbound.map((row) => ({ row, type: 'block' }))
    ].slice(0, 8);
    const graphSvg = `<svg class="mini-relation-graph" viewBox="0 0 240 140" role="img" aria-label="Blok ve node ilişki grafiği"><circle cx="120" cy="70" r="20" class="graph-center"/><text x="120" y="74" text-anchor="middle">${escapeHtml(note.title.slice(0, 8))}</text>${graphLinks.map(({ row, type }, index) => {
      const angle = index / Math.max(1, graphLinks.length) * Math.PI * 2 - Math.PI / 2;
      const x = 120 + Math.cos(angle) * 84;
      const y = 70 + Math.sin(angle) * 48;
      return `<line x1="120" y1="70" x2="${x}" y2="${y}" class="graph-edge ${type}"/><circle cx="${x}" cy="${y}" r="12" class="graph-node ${type}"/><text x="${x}" y="${y + 3}" text-anchor="middle">${escapeHtml(row.title.slice(0, 5))}</text>`;
    }).join('')}</svg>`;
    const relationRow = (title, rows, type) => `<div class="inspector-link-group"><strong>${title}<span>${rows.length}</span></strong>${rows.length
      ? rows.slice(0, 8).map((row) => `<div class="inspector-link-row"><button type="button" data-inspector-open="${row.id}" data-link-type="${type}">${escapeHtml(row.title)}</button>${type === 'mention' ? `<button type="button" data-convert-mention="${row.id}" title="Bahsetmeyi bağlantıya çevir">⌁</button>` : ''}</div>`).join('')
      : '<small>Kayıt yok</small>'}</div>`;
    return `<aside class="landscape-inspector document-inspector" data-document-inspector="${note.id}">
      <div class="inspector-heading"><small>${note.kind === 'source' ? 'Kaynak' : 'Belge'}</small><h2>${escapeHtml(note.title)}</h2></div>
      <details open><summary>Özellikler <span>${propertyRows.length}</span></summary>
        <div class="property-list">${propertyRows.join('')}</div>
        <form class="property-add-form"><input name="key" placeholder="Özellik"><input name="value" placeholder="Değer"><button>Ekle</button></form>
      </details>
      <details open><summary>Bağlantılar</summary>
        ${graphSvg}
        ${relationRow('Backlink', relationships.inbound, 'backlink')}
        ${relationRow('Bağlantısız bahsetme', relationships.unlinked, 'mention')}
        ${relationRow('Blok backlink', relationships.blockInbound, 'block')}
        <div class="direct-relations">${(note.relations || []).map((relation) => {
          const target = this.app.documents.find(({ id }) => id === relation.targetId);
          return target ? `<div><button type="button" data-inspector-open="${target.id}">${escapeHtml(target.title)}</button><small>${escapeHtml(relation.type || 'relation')}</small><button type="button" data-relation-delete="${escapeHtml(target.id)}">×</button></div>` : '';
        }).join('')}</div>
        <form class="relation-add-form"><select name="targetId">${this.app.documents.filter(({ id }) => id !== note.id).map((row) => `<option value="${row.id}">${escapeHtml(row.title)}</option>`).join('')}</select><select name="type"><option value="relation">relation</option><option value="sub-node">sub-node</option><option value="reference">reference</option><option value="map">map</option></select><button>Ekle</button></form>
      </details>
      <details><summary>Kaynaklar <span>${(note.sources || []).length}</span></summary>
        <div class="source-picker">${sources.slice(0, 12).map((source) => `<div><button type="button" data-inspector-open="${source.id}">${escapeHtml(source.title)}</button><button type="button" data-attach-source="${source.id}" title="Kaynağı bağla">＋</button><button type="button" data-cite-source="${source.id}" title="Alıntı ekle">❞</button></div>`).join('') || '<small>Henüz kaynak node’u yok.</small>'}</div>
      </details>
      <details><summary>Sürüm geçmişi <span>${this.documentVersions.length}</span></summary>
        <div class="history-list">${this.documentVersions.slice(0, 12).map((version) => `<button type="button" data-restore-version="${version.id}"><span>r${version.revision}</span><time>${new Date(version.createdAt).toLocaleString('tr-TR')}</time></button>`).join('') || '<small>Önceki sürüm yok.</small>'}</div>
      </details>
      <details><summary>Taşınabilirlik</summary><div class="export-grid">${['md', 'pdf', 'html', 'docx'].map((format) => `<button type="button" data-export-format="${format}">.${format}</button>`).join('')}</div></details>
      <details><summary>Şablonlar</summary>
        <button type="button" class="inspector-action" data-save-template>Bu belgeden şablon oluştur</button>
        ${this.templates.map((template) => `<button type="button" class="inspector-action" data-apply-template="${template.id}">${escapeHtml(template.name)}</button>`).join('')}
      </details>
    </aside>`;
  }

  bindChrome(scope = document) {
    scope.querySelectorAll('[data-platform-search]').forEach((button) => button.addEventListener('click', () => this.openGlobalSearch()));
    scope.querySelectorAll('[data-platform-quick-task]').forEach((button) => button.addEventListener('click', () => this.openQuickTask()));
    scope.querySelectorAll('[data-quick-note]').forEach((button) => button.addEventListener('click', () => this.app.createNote()));
    scope.querySelectorAll('[data-platform-map-layout]').forEach((button) => button.addEventListener('click', async () => {
      const nodes = await invokeExtension('mapLayout', button.dataset.platformMapLayout, { nodes: this.app.activeDocument.canvas.nodes });
      this.app.activeDocument.canvas.nodes = nodes;
      await this.app.saveActive();
      this.app.renderMapEditor();
    }));
    scope.querySelectorAll('[data-rail-open]').forEach((button) => {
      let timer;
      button.addEventListener('click', () => {
        clearTimeout(timer);
        timer = setTimeout(() => this.app.openDocument(button.dataset.railOpen, this.app.route), 230);
      });
      button.addEventListener('dblclick', (event) => {
        event.preventDefault();
        clearTimeout(timer);
        const input = button.parentElement.querySelector('[data-rail-rename]');
        button.hidden = true;
        input.hidden = false;
        input.focus();
        input.select();
      });
    });
    scope.querySelectorAll('[data-rail-rename]').forEach((input) => {
      const finish = async (save = true) => {
        const row = input.closest('.landscape-tree-row');
        const button = row.querySelector('[data-rail-open]');
        if (save && input.value.trim()) {
          const item = this.app.documents.find(({ id }) => id === input.dataset.railRename);
          if (item) {
            item.title = input.value.trim();
            await putDocument(item);
          }
        }
        input.hidden = true;
        button.hidden = false;
        await this.app.reloadDocuments();
        this.app.render();
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); finish(true); }
        if (event.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
    });
    this.bindDocumentInspector(scope);
  }

  async syncDocumentTasks(document) {
    if (!document?.id) return;
    const blocks = (document.blocks || []).filter(({ type }) => type === 'todo');
    const existing = this.tasks.filter((task) => task.documentId === document.id && task.blockId);
    const activeIds = new Set();
    for (const block of blocks) {
      const id = `task_${document.id}_${block.id}`.slice(0, 180);
      activeIds.add(id);
      const previous = this.tasks.find((task) => task.id === id);
      const candidate = {
        ...previous, id, documentId: document.id, blockId: block.id, text: block.text,
        done: Boolean(block.done), importance: block.importance,
        scheduledAt: block.scheduledAt, deadline: block.deadline,
        durationMinutes: block.durationMinutes, repeat: block.repeat
      };
      const changed = !previous || ['text', 'done', 'importance', 'scheduledAt', 'deadline', 'durationMinutes', 'repeat']
        .some((key) => String(previous[key] ?? '') !== String(candidate[key] ?? ''));
      if (changed) await putTask(candidate);
    }
    for (const task of existing) if (!activeIds.has(task.id)) await removeTask(task.id);
    this.tasks = await listTasks();
  }

  async createTask(input = {}) {
    const parsed = parseTurkishDate(input.dateExpression || input.text || '');
    const task = await putTask({
      text: input.text,
      importance: input.importance || 'normal',
      scheduledAt: input.scheduledAt || parsed.scheduledAt,
      deadline: input.deadline || parsed.deadline,
      reminderAt: parsed.reminderAt,
      repeat: parsed.repeat,
      durationMinutes: Number(input.durationMinutes) || parsed.durationMinutes
    });
    this.tasks = await listTasks();
    await successHaptic();
    return task;
  }

  orderedTasksForView(view) {
    return this.tasks.filter((task) => taskGroup(task, view)).map((task) => ({ task, depth: 0 }));
  }

  renderTasks() {
    const visible = this.orderedTasksForView(this.taskView);
    this.app.shell({
      header: false, route: 'tasks',
      content: `<section class="task-capture-card"><form id="task-capture-form">
          <input name="text" placeholder="Görev yaz; ör. rapor yarın 14:00 45 dk" autocomplete="off"
            autocapitalize="sentences" enterkeyhint="send" required>
          <button type="submit">Ekle</button></form><small>Türkçe tarih, saat, tekrar ve süre ifadelerini anlayabilir.</small></section>
        <div class="task-view-tabs">${[['inbox', 'Inbox'], ['today', 'Bugün'], ['upcoming', 'Yaklaşan'], ['done', 'Tamamlanan']].map(([id, label]) => `<button class="${this.taskView === id ? 'active' : ''}" data-task-view="${id}">${label}<span>${this.tasks.filter((task) => taskGroup(task, id)).length}</span></button>`).join('')}<button type="button" class="task-add-button" data-platform-quick-task><b>＋</b> Görev ekle</button></div>
        <section class="task-list">${visible.length ? visible.map(({ task, depth }) => `<article class="task-row ${task.done ? 'done' : ''}" data-task-id="${task.id}" style="--task-depth:${Math.min(depth, 4)}">
          <button type="button" class="task-check" data-task-toggle aria-label="Tamamlandı">${task.done ? '✓' : ''}</button>
          <div><strong>${escapeHtml(task.text)}</strong><span><i class="importance ${task.importance}"></i>${taskDateLabel(task)}${task.durationMinutes ? ` · ${task.durationMinutes} dk` : ''}${task.repeat !== 'none' ? ` · ${escapeHtml(task.repeat)}` : ''}${task.dependencies?.length ? ` · ${task.dependencies.length} bağımlılık` : ''}</span></div>
          <div class="task-row-actions"><button type="button" class="task-more" data-task-snooze title="Yarına ertele">›</button></div>
        </article>`).join('') : '<div class="soft-empty task-empty">Bu görünümde görev yok.</div>'}</section>`
    });
    this.bindTaskView();
  }

  bindTaskView() {
    document.querySelector('#task-capture-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = event.currentTarget.elements.text;
      await this.createTask({ text: input.value.trim() });
      this.renderTasks();
    });
    document.querySelectorAll('[data-task-view]').forEach((button) => button.addEventListener('click', () => {
      this.taskView = button.dataset.taskView;
      this.renderTasks();
    }));
    document.querySelectorAll('[data-task-id]').forEach((row) => {
      const task = this.tasks.find(({ id }) => id === row.dataset.taskId);
      row.querySelector('[data-task-toggle]')?.addEventListener('click', async () => {
        await this.toggleTask(task);
        this.renderTasks();
      });
      row.querySelector('[data-task-snooze]')?.addEventListener('click', async () => {
        await putTask({ ...task, scheduledAt: postponeDate('yarın') });
        this.tasks = await listTasks();
        this.renderTasks();
      });
    });
  }

  async toggleTask(task) {
    if (!task) return;
    task = await putTask({ ...task, done: !task.done });
    if (task.documentId && task.blockId) {
      const rowDocument = this.app.documents.find(({ id }) => id === task.documentId);
      if (rowDocument) {
        const block = (rowDocument.blocks || []).find(({ id }) => id === task.blockId);
        if (block) block.done = task.done;
        const host = document.createElement('div');
        host.innerHTML = rowDocument.content;
        const element = host.querySelector(`[data-block-id="${CSS.escape(task.blockId)}"]`);
        if (element) {
          element.dataset.taskDone = String(task.done);
          element.classList.toggle('pisi-task-done', task.done);
          const checkbox = element.querySelector('.pisi-task-checkbox');
          if (checkbox) { checkbox.dataset.done = String(task.done); checkbox.textContent = task.done ? '✓' : ''; }
          rowDocument.content = sanitizeRichHtml(host.innerHTML);
        }
        await putDocument(rowDocument);
        await this.app.reloadDocuments();
      }
    }
    this.tasks = await listTasks();
    await lightHaptic();
  }

  openQuickTask() {
    document.querySelector('#platform-overlay')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div id="platform-overlay" class="platform-overlay"><section class="quick-task-sheet"><header><div><small>Global Quick Add</small><h2>Görevi yakala</h2></div><button type="button" data-overlay-close>×</button></header>
      <form id="quick-task-form"><label>Görev<input name="text" required placeholder="Ne yapılacak?" autocomplete="off" autocapitalize="sentences" enterkeyhint="next"></label><label>Tarih ifadesi<input name="dateExpression" placeholder="yarın 14:00, cuma, 12 Eylül" autocomplete="off" enterkeyhint="next"></label><div class="quick-task-fields"><label>Önem<select name="importance"><option value="normal">Normal</option><option value="high">Yüksek</option><option value="urgent">Acil</option><option value="low">Düşük</option></select></label><label>Süre<input name="durationMinutes" type="number" min="0" step="5" inputmode="numeric" placeholder="dk" enterkeyhint="done"></label></div><output id="quick-task-preview"></output><button class="primary-button">Inbox’a ekle</button></form></section></div>`);
    const overlay = document.querySelector('#platform-overlay');
    const form = overlay.querySelector('#quick-task-form');
    const preview = overlay.querySelector('#quick-task-preview');
    const update = () => {
      const parsed = parseTurkishDate(`${form.elements.text.value} ${form.elements.dateExpression.value}`);
      preview.textContent = parsed.scheduledAt ? `Plan: ${parsed.scheduledAt}` : 'Tarih yok: Inbox';
    };
    form.addEventListener('input', update);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await this.createTask(Object.fromEntries(new FormData(form)));
      overlay.remove();
      if (this.app.route === 'tasks') this.renderTasks();
      else this.app.toast('Görev Inbox’a eklendi.');
    });
    overlay.querySelector('[data-overlay-close]').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
    focusField(form.elements.text);
  }

  openGlobalSearch() {
    document.querySelector('#platform-overlay')?.remove();
    const signature = `${this.app.documents.map(({ id, updatedAt, revision }) => `${id}:${revision || updatedAt}`).join('|')}::${this.tasks.map(({ id, updatedAt }) => `${id}:${updatedAt}`).join('|')}`;
    if (!this.searchCache || signature !== this.searchSignature) {
      this.searchCache = buildSearchIndex(this.app.documents, this.tasks);
      this.searchSignature = signature;
    }
    const index = this.searchCache;
    document.body.insertAdjacentHTML('beforeend', `<div id="platform-overlay" class="platform-overlay search-overlay"><section class="global-search-panel"><header><span>⌕</span><input id="global-search-input" placeholder="Not, blok, görev, özellik veya harita düğümü ara" autocomplete="off" enterkeyhint="search"><kbd>Esc</kbd><button data-overlay-close>×</button></header><div id="global-search-results" class="global-search-results"></div></section></div>`);
    const overlay = document.querySelector('#platform-overlay');
    const input = overlay.querySelector('#global-search-input');
    const results = overlay.querySelector('#global-search-results');
    const render = () => {
      const rows = searchIndex(index, input.value, 60);
      results.innerHTML = rows.length ? rows.map((row) => `<button type="button" data-search-result="${row.id}"><span class="search-kind">${row.kind}</span><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.subtitle || '')}</small>${row.kind === 'map-node' ? '<b>Haritada göster</b>' : ''}</button>`).join('') : '<p>Sonuç bulunamadı.</p>';
      results.querySelectorAll('[data-search-result]').forEach((button) => button.addEventListener('click', () => {
        const row = rows.find(({ id }) => id === button.dataset.searchResult);
        overlay.remove();
        if (row.kind === 'task') { this.taskView = row.done ? 'done' : 'inbox'; this.app.navigate('tasks'); return; }
        this.app.openDocument(row.documentId, this.app.route).then(() => {
          if (row.mapNodeId) this.app.focusMapNode(row.mapNodeId);
          if (row.blockId) requestAnimationFrame(() => document.querySelector(`[data-block-id="${CSS.escape(row.blockId)}"]`)?.scrollIntoView({ block: 'center' }));
        });
      }));
    };
    input.addEventListener('input', render);
    overlay.querySelector('[data-overlay-close]').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
    render();
    focusField(input);
  }

  structuredTemplate() {
    const propertyNames = Array.from(new Set(this.app.documents.flatMap((document) => Object.keys(document.properties || {}))));
    const documents = applyStructuredView(this.app.documents.filter(({ kind }) => kind !== 'canvas'), this.activeView, this.schema);
    return `<section class="structured-toolbar"><div class="segmented-control"><button class="${this.activeView.type === 'table' ? 'active' : ''}" data-structured-type="table">Tablo</button><button class="${this.activeView.type === 'cards' ? 'active' : ''}" data-structured-type="cards">Kart</button></div>
      <form id="structured-filter-form"><select name="property"><option value="">Özellik seç</option>${propertyNames.map((name) => `<option>${escapeHtml(name)}</option>`).join('')}</select><input name="value" placeholder="Filtre değeri"><button>Filtrele</button></form></section>
      <div class="saved-view-row">${this.savedViews.map((view) => `<button data-saved-view="${view.id}">${escapeHtml(view.name)}</button>`).join('')}<button data-save-view>＋ Görünümü kaydet</button></div>
      ${this.activeView.type === 'table' ? `<div class="structured-table-wrap"><table class="structured-table"><thead><tr><th>Node</th>${propertyNames.map((name) => `<th>${escapeHtml(name)}</th>`).join('')}</tr></thead><tbody>${documents.map((row) => `<tr data-data-open="${row.id}"><th>${escapeHtml(row.title)}</th>${propertyNames.map((name) => `<td>${escapeHtml(row.properties?.[name] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        : `<div class="structured-cards">${documents.map((row) => `<button data-data-open="${row.id}"><strong>${escapeHtml(row.title)}</strong><span>${Object.entries(row.properties || {}).slice(0, 4).map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(value)}`).join('<br>') || 'Özellik yok'}</span></button>`).join('')}</div>`}
      <section class="data-admin-grid"><form id="property-schema-form"><h3>Node özelliği</h3><input name="name" placeholder="Özellik adı" required><select name="type">${['text', 'number', 'multiselect', 'relation', 'rollup'].map((type) => `<option>${type}</option>`).join('')}</select><div class="rollup-config"><input name="relationProperty" placeholder="Relation özelliği"><input name="targetProperty" placeholder="Hedef özellik"><select name="operation"><option value="count">count</option><option value="sum">sum</option><option value="average">average</option><option value="min">min</option><option value="max">max</option><option value="join">join</option></select></div><button>Ekle</button></form>
      <form id="property-map-form"><h3>Özelliğe göre map</h3><select name="property" required>${propertyNames.map((name) => `<option>${escapeHtml(name)}</option>`).join('')}</select><button>Map üret</button></form></section>`;
  }

  portabilityTemplate() {
    return `<div class="portability-grid"><section class="data-form-card"><h3>Markdown / HTML içe aktarma</h3><p>Dosya yeni bir Pisi node’u olarak eklenir.</p><button type="button" data-portable-import>Dosya seç</button><input id="portable-file" type="file" accept=".md,.markdown,.html,.htm,text/markdown,text/html" hidden></section>
      <section class="data-form-card"><h3>Proje bütünlüğü</h3><p>Node, relation, map edge, görev ve sürüm bağlantılarını denetler.</p><button type="button" data-integrity-check>Denetimi çalıştır</button><output id="integrity-result"></output></section></div>
      <section class="data-form-card"><h3>Dışa aktarma</h3><p>Bir node seçip Markdown, PDF, HTML veya DOCX olarak kaydet.</p><select id="portable-document">${this.app.documents.filter(({ kind }) => kind !== 'canvas').map((row) => `<option value="${row.id}">${escapeHtml(row.title)}</option>`).join('')}</select><div class="export-grid">${['md', 'pdf', 'html', 'docx'].map((format) => `<button type="button" data-portable-export="${format}">.${format}</button>`).join('')}</div></section>`;
  }

  renderData() {
    const content = this.dataTab === 'portability'
      ? this.portabilityTemplate() : this.structuredTemplate();
    this.app.shell({
      header: false, route: 'data',
      content: `<div class="data-tabs">${[['structured', 'Node sistemi'], ['portability', 'Taşınabilirlik']].map(([id, label]) => `<button class="${this.dataTab === id ? 'active' : ''}" data-data-tab="${id}">${label}</button>`).join('')}</div><div class="data-workspace">${content}</div>`
    });
    this.bindData();
  }

  bindData() {
    document.querySelectorAll('[data-data-tab]').forEach((button) => button.addEventListener('click', () => {
      this.dataTab = button.dataset.dataTab;
      this.renderData();
    }));
    document.querySelectorAll('[data-data-open]').forEach((button) => button.addEventListener('click', () => this.app.openDocument(button.dataset.dataOpen, 'data')));
    document.querySelectorAll('[data-structured-type]').forEach((button) => button.addEventListener('click', () => {
      this.activeView.type = button.dataset.structuredType;
      this.renderData();
    }));
    document.querySelector('#structured-filter-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      this.activeView.filters = data.get('property') ? [{ propertyId: data.get('property'), operator: 'contains', value: data.get('value') }] : [];
      this.renderData();
    });
    document.querySelector('[data-save-view]')?.addEventListener('click', async () => {
      const name = prompt('Görünüm adı');
      if (!name) return;
      this.savedViews.push(createSavedView(name, this.activeView));
      await setSetting('savedViews', this.savedViews);
      this.renderData();
    });
    document.querySelectorAll('[data-saved-view]').forEach((button) => button.addEventListener('click', () => {
      const view = this.savedViews.find(({ id }) => id === button.dataset.savedView);
      if (view) { this.activeView = structuredClone(view); this.renderData(); }
    }));
    document.querySelector('#property-schema-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      if (data.type === 'rollup') data.rollup = {
        relationProperty: data.relationProperty,
        targetProperty: data.targetProperty,
        operation: data.operation
      };
      this.schema = normalizePropertySchema([...this.schema, data]);
      await setSetting('propertySchema', this.schema);
      this.app.toast('Node özelliği eklendi.');
      this.renderData();
    });
    document.querySelector('#property-map-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const property = new FormData(event.currentTarget).get('property');
      const map = await this.app.createMap({ title: `${property} haritası`, canvas: generatePropertyMap(this.app.documents, property), open: false });
      this.app.openDocument(map.id, 'data');
    });
    document.querySelector('[data-portable-import]')?.addEventListener('click', () => document.querySelector('#portable-file').click());
    document.querySelector('#portable-file')?.addEventListener('change', async (event) => {
      try {
        const documentRow = await importPortableFile(event.target.files?.[0]);
        await putDocument(documentRow);
        await this.app.reloadDocuments();
        this.app.toast('Belge içe aktarıldı.');
        this.app.openDocument(documentRow.id, 'data');
      } catch (error) { this.app.toast(error.message, 'error'); }
    });
    document.querySelectorAll('[data-portable-export]').forEach((button) => button.addEventListener('click', async () => {
      const documentRow = this.app.documents.find(({ id }) => id === document.querySelector('#portable-document').value);
      if (documentRow) await exportDocument(documentRow, button.dataset.portableExport);
    }));
    document.querySelector('[data-integrity-check]')?.addEventListener('click', async () => {
      const output = document.querySelector('#integrity-result');
      output.textContent = 'Denetleniyor…';
      output.className = '';
      try {
        const report = await inspectDatabaseIntegrity();
        output.textContent = report.ok ? `Sorun bulunmadı · ${report.counts.documents} node denetlendi.` : `${report.issues.length} sorun bulundu.`;
        output.className = report.ok ? 'ok' : 'error';
      } catch (error) {
        output.textContent = error?.message || 'Proje bütünlüğü denetlenemedi.';
        output.className = 'error';
      }
    });
  }

  bindDocumentInspector(scope = document) {
    scope.querySelectorAll('[data-document-inspector]').forEach((inspector) => {
      const documentId = inspector.dataset.documentInspector;
      const getDocument = () => this.app.documents.find(({ id }) => id === documentId) || this.app.activeDocument;
      inspector.querySelectorAll('[data-inspector-open]').forEach((button) => button.addEventListener('click', () => this.app.openDocument(button.dataset.inspectorOpen, 'notes')));
      inspector.querySelectorAll('[data-convert-mention]').forEach((button) => button.addEventListener('click', async () => {
        const source = this.app.documents.find(({ id }) => id === button.dataset.convertMention);
        const target = getDocument();
        if (!source || !target) return;
        const pattern = new RegExp(`(^|[^\\[])(${target.title.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')})(?![^<]*>)`, 'i');
        source.content = String(source.content).replace(pattern, `$1[[${target.title}]]`);
        await putDocument(source);
        await this.app.reloadDocuments();
        this.app.toast('Bahsetme bağlantıya çevrildi.');
        this.app.renderEditor();
      }));
      inspector.querySelectorAll('[data-property-key]').forEach((input) => input.addEventListener('change', async () => {
        const row = getDocument();
        row.properties ||= {};
        row.properties[input.dataset.propertyKey] = input.type === 'checkbox'
          ? input.checked
          : input.value.includes(',') ? input.value.split(',').map((value) => value.trim()).filter(Boolean) : input.value;
        await putDocument(row);
        if (this.app.activeDocument?.id === row.id) this.app.activeDocument = structuredClone(row);
        await this.app.reloadDocuments();
      }));
      inspector.querySelectorAll('[data-relation-property]').forEach((select) => select.addEventListener('change', async () => {
        const row = getDocument();
        row.properties ||= {};
        row.properties[select.dataset.relationProperty] = Array.from(select.selectedOptions, ({ value }) => value);
        await putDocument(row);
        if (this.app.activeDocument?.id === row.id) this.app.activeDocument.properties = structuredClone(row.properties);
        await this.app.reloadDocuments();
      }));
      inspector.querySelectorAll('[data-property-delete]').forEach((button) => button.addEventListener('click', async () => {
        const row = getDocument();
        delete row.properties[button.dataset.propertyDelete];
        await putDocument(row);
        await this.app.reloadDocuments();
        await this.prepareDocument(row.id);
        this.app.renderEditor();
      }));
      inspector.querySelector('.property-add-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        if (!values.key.trim()) return;
        const row = getDocument();
        row.properties ||= {};
        row.properties[values.key.trim()] = values.value;
        await putDocument(row);
        this.app.activeDocument.properties = row.properties;
        await this.app.reloadDocuments();
        await this.prepareDocument(row.id);
        this.app.renderEditor();
      });
      inspector.querySelector('.relation-add-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        if (!values.targetId) return;
        const row = getDocument();
        row.relations ||= [];
        const existing = row.relations.find((relation) => relation.targetId === values.targetId);
        if (existing) existing.type = values.type;
        else row.relations.push({ targetId: values.targetId, type: values.type });
        await putDocument(row);
        this.app.activeDocument.relations = structuredClone(row.relations);
        await this.app.reloadDocuments();
        await this.prepareDocument(row.id);
        this.app.renderEditor();
      });
      inspector.querySelectorAll('[data-relation-delete]').forEach((button) => button.addEventListener('click', async () => {
        const row = getDocument();
        row.relations = (row.relations || []).filter(({ targetId }) => targetId !== button.dataset.relationDelete);
        await putDocument(row);
        this.app.activeDocument.relations = structuredClone(row.relations);
        await this.app.reloadDocuments();
        this.app.renderEditor();
      }));
      inspector.querySelectorAll('[data-attach-source]').forEach((button) => button.addEventListener('click', async () => {
        const row = getDocument();
        row.sources ||= [];
        if (!row.sources.some((source) => source.documentId === button.dataset.attachSource)) row.sources.push({ documentId: button.dataset.attachSource });
        await putDocument(row);
        this.app.toast('Kaynak node’a bağlandı.');
      }));
      inspector.querySelectorAll('[data-cite-source]').forEach((button) => button.addEventListener('click', () => {
        const source = this.app.documents.find(({ id }) => id === button.dataset.citeSource);
        const quote = prompt('Alıntılanacak metin');
        if (!quote || !source) return;
        const editor = document.querySelector('#rich-editor');
        if (editor) {
          editor.insertAdjacentHTML('beforeend', makeQuoteBlock(quote, source));
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        }
      }));
      inspector.querySelectorAll('[data-restore-version]').forEach((button) => button.addEventListener('click', async () => {
        if (!confirm('Bu sürüme geri dönülsün mü? Mevcut durum da geçmişe kaydedilir.')) return;
        const restored = await restoreDocumentVersion(button.dataset.restoreVersion);
        await this.app.reloadDocuments();
        await this.app.openDocument(restored.id, this.app.returnRoute);
      }));
      inspector.querySelectorAll('[data-export-format]').forEach((button) => button.addEventListener('click', async () => {
        try { await exportDocument(getDocument(), button.dataset.exportFormat); }
        catch (error) { this.app.toast(error.message, 'error'); }
      }));
      inspector.querySelector('[data-save-template]')?.addEventListener('click', async () => {
        const name = prompt('Şablon adı', `${getDocument().title} şablonu`);
        if (!name) return;
        this.templates.push(createTemplate(name, getDocument()));
        await setSetting('templates', this.templates);
        this.app.toast('Şablon kaydedildi.');
      });
      inspector.querySelectorAll('[data-apply-template]').forEach((button) => button.addEventListener('click', async () => {
        const template = this.templates.find(({ id }) => id === button.dataset.applyTemplate);
        if (!template) return;
        this.app.activeDocument = applyTemplate(this.app.activeDocument, template);
        await this.app.saveActive();
        this.app.renderEditor();
      }));
    });
  }

  openDocumentPanel() {
    document.querySelector('#platform-overlay')?.remove();
    const markup = this.documentInspectorTemplate(this.app.activeDocument).replace('<aside ', '<section ');
    document.body.insertAdjacentHTML('beforeend', `<div id="platform-overlay" class="platform-overlay inspector-overlay"><div class="portrait-inspector-sheet"><button class="portrait-sheet-close" data-overlay-close>×</button>${markup.replace('</aside>', '</section>')}</div></div>`);
    const overlay = document.querySelector('#platform-overlay');
    this.bindDocumentInspector(overlay);
    overlay.querySelector('[data-overlay-close]').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
  }

  toolbarExtensionsTemplate() {
    return listExtensions('toolbarTool').map((tool) => `<button type="button" data-extension-toolbar="${tool.id}" title="${escapeHtml(tool.label)}">${escapeHtml(tool.icon || tool.label)}</button>`).join('');
  }

  bindToolbarExtensions(scope = document) {
    scope.querySelectorAll('[data-extension-toolbar]').forEach((button) => button.addEventListener('pointerdown', async (event) => {
      event.preventDefault();
      await invokeExtension('toolbarTool', button.dataset.extensionToolbar, { app: this.app, document: this.app.activeDocument });
    }));
  }

  bindKeyboardShortcuts() {
    if (this.boundHotkeys) return;
    this.boundHotkeys = true;
    window.addEventListener('keydown', (event) => {
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLocaleLowerCase('en-US') === 'k') {
        event.preventDefault();
        this.openGlobalSearch();
      } else if (command && event.shiftKey && event.key.toLocaleLowerCase('en-US') === 'a') {
        event.preventDefault();
        this.openQuickTask();
      } else if (command && event.key.toLocaleLowerCase('en-US') === 'n') {
        event.preventDefault();
        this.app.createNote();
      } else if (command && event.key.toLocaleLowerCase('en-US') === 's' && this.app.activeDocument) {
        event.preventDefault();
        this.app.captureEditorState?.();
      } else if (event.altKey && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        this.app.navigate(({ 1: 'notes', 2: 'maps', 3: 'tasks', 4: 'calendar' })[event.key]);
      } else if (event.key === 'Escape') {
        document.querySelector('#platform-overlay')?.remove();
      }
    });
  }
}
