import { registerModule } from '../core/module-registry.mjs';
import { restorePisiEditorDocument } from '../editor/pisi-editor-restore.mjs';
import { invalidatePisiSearchIndex } from '../search/pisi-search-index.mjs';

// Version history tabs for canonical stores: "Görevler" (.pisi/tasks.json),
// "Bağlantılar" (.pisi/relationships.json) and "Haritalar" (one .map). Each
// version can be compared with the current state ("3 görev geri gelir, 2 görev
// kaldırılır, 12 görev değişir") and restored. A restore runs as one atomic
// domain command (history.store.restore.v1) that first keeps a before-restore
// snapshot; afterwards Project Integrity runs and its result is shown.

const PISI_HISTORY_TABS = Object.freeze([
    { id: 'note', label: 'Not' },
    { id: 'tasks', label: 'Görevler' },
    { id: 'relationships', label: 'Bağlantılar' },
    { id: 'map', label: 'Haritalar' }
]);
const PISI_HISTORY_REASONS = Object.freeze({
    auto: 'Otomatik',
    close: 'Kapanışta',
    quit: 'Uygulama kapanırken',
    'project-change': 'Proje değişirken',
    'before-restore': 'Geri yüklemeden önce'
});
const PISI_HISTORY_DIFF_TEXT = Object.freeze({
    tasks: { restored: '{count} görev geri gelir', removed: '{count} görev kaldırılır', changed: '{count} görev değişir' },
    relationships: { restored: '{count} bağlantı geri gelir', removed: '{count} bağlantı kaldırılır', changed: '{count} bağlantı değişir' },
    map: {
        restored: '{count} not kartı geri gelir',
        removed: '{count} not kartı kaldırılır',
        changed: '{count} not kartının yeri değişir',
        views: '{count} bağlantı görünümü değişir'
    }
});

function pisiStoreHistoryTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function makePisiStoreHistoryButton(label, className = 'pisi-secondary-button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = pisiStoreHistoryTranslate(label);
    return button;
}

/** "3 görev geri gelir · 2 görev kaldırılır · 12 görev değişir", or "Fark yok." */
function formatPisiStoreHistoryDiff(kind, diff = {}) {
    const texts = PISI_HISTORY_DIFF_TEXT[kind] || PISI_HISTORY_DIFF_TEXT.tasks;
    const parts = ['restored', 'removed', 'changed', 'views']
        .filter((field) => texts[field] && Number(diff[field]) > 0)
        .map((field) => pisiStoreHistoryTranslate(texts[field]).replace('{count}', String(diff[field])));
    return parts.length ? parts.join(' · ') : pisiStoreHistoryTranslate('Mevcut durumla fark yok.');
}

function renderPisiStoreHistoryPreview(kind, preview) {
    const root = document.createElement('div');
    root.className = 'pisi-history-preview pisi-store-history-preview';
    const summary = document.createElement('p');
    summary.dataset.pisiStoreHistorySummary = '';
    summary.textContent = `${pisiStoreHistoryTranslate('Geri yüklenirse')}: ${formatPisiStoreHistoryDiff(kind, preview.diff)}`;
    root.append(summary);
    const items = preview.diff?.items || [];
    if (items.length) {
        const list = document.createElement('div');
        list.className = 'pisi-store-history-items';
        list.setAttribute('role', 'list');
        const marks = { restored: '+', removed: '−', changed: '~' };
        for (const item of items) {
            const row = document.createElement('div');
            row.setAttribute('role', 'listitem');
            row.dataset.change = item.change;
            row.textContent = `${marks[item.change] || ''} ${item.label}`;
            list.appendChild(row);
        }
        root.append(list);
        if (preview.diff.truncated) {
            const more = document.createElement('small');
            more.textContent = pisiStoreHistoryTranslate('Liste kısaltıldı.');
            root.append(more);
        }
    }
    return root;
}

/** Restores a version (atomic, in main), reloads an open note and reports Project Integrity. */
async function restorePisiStoreHistoryVersion(payload) {
    const nodePath = window.activeModalNode?.path || window.activeCenterNode?.path || null;
    const run = () => window.pisiDomain?.command?.('history.store.restore.v1', payload);
    // An open note may receive restored task blocks: let the editor save first and reload after.
    const result = nodePath ? await restorePisiEditorDocument(nodePath, run) : await run();
    if (!result?.ok) {
        pisiNotifyError(result?.error || 'Sürüm geri yüklenemedi.');
        return result;
    }
    invalidatePisiSearchIndex('project');
    window.refreshPisiFirstClassTaskStore?.();
    document.dispatchEvent(new CustomEvent('pisi:store-history-restored', { detail: { store: payload.store, result } }));
    const audit = await window.pisiDomain?.query?.('integrity.audit.v1', { projectFolder: window.currentProjectFolder });
    const issues = Array.isArray(audit?.issues) ? audit.issues.length : null;
    if (issues === 0) pisiNotifySuccess(pisiStoreHistoryTranslate('Geri yüklendi. Proje bütünlüğü temiz.'));
    else if (issues) pisiNotifyWarning(pisiStoreHistoryTranslate('Geri yüklendi. Proje bütünlüğünde {count} bulgu var.').replace('{count}', String(issues)));
    else pisiNotifySuccess(pisiStoreHistoryTranslate('Geri yüklendi.'));
    return { ...result, integrityIssues: issues };
}

async function renderPisiStoreHistoryList(container, payload) {
    container.replaceChildren();
    const result = await window.pisiDomain?.query?.('history.store.list.v1', payload);
    if (!result?.ok) throw new Error(result?.error || 'Geçmiş okunamadı.');
    const current = document.createElement('p');
    current.className = 'pisi-store-history-current';
    current.textContent = `${pisiStoreHistoryTranslate('Şu an')}: ${pisiStoreHistoryTranslate(result.current?.summary || '—')}`;
    const list = document.createElement('div');
    list.className = 'pisi-history-list';
    list.dataset.pisiStoreHistoryList = payload.store;
    for (const version of result.versions || []) {
        const row = document.createElement('article');
        row.className = 'pisi-history-row';
        row.dataset.pisiHistoryId = version.historyId;
        const info = document.createElement('div');
        const date = document.createElement('strong');
        date.textContent = new Date(version.capturedAt).toLocaleString();
        const reason = document.createElement('span');
        reason.textContent = `${pisiStoreHistoryTranslate(PISI_HISTORY_REASONS[version.reason] || version.reason)} · ${pisiStoreHistoryTranslate(version.summary || '')}`;
        info.append(date, reason);
        const actions = document.createElement('div');
        const preview = makePisiStoreHistoryButton('Önizle / karşılaştır');
        preview.dataset.pisiStoreHistoryAction = 'preview';
        preview.addEventListener('click', async () => {
            const existing = row.querySelector('.pisi-store-history-preview');
            if (existing) return existing.remove();
            const shown = await window.pisiDomain?.query?.('history.store.preview.v1', { ...payload, historyId: version.historyId });
            if (!shown?.ok) return void pisiNotifyError(shown?.error || 'Sürüm okunamadı.');
            row.append(renderPisiStoreHistoryPreview(payload.store, shown));
        });
        const restore = makePisiStoreHistoryButton('Bu sürümü geri yükle', 'pisi-danger-outline-button');
        restore.dataset.pisiStoreHistoryAction = 'restore';
        restore.addEventListener('click', async () => {
            const shown = await window.pisiDomain?.query?.('history.store.preview.v1', { ...payload, historyId: version.historyId });
            const confirmed = await pisiConfirm(
                `${pisiStoreHistoryTranslate('Bu sürüm geri yüklensin mi? Mevcut durum önce geçmişe kaydedilecek.')}\n\n${shown?.ok ? formatPisiStoreHistoryDiff(payload.store, shown.diff) : ''}`,
                { title: pisiStoreHistoryTranslate('Sürümü geri yükle'), confirmText: pisiStoreHistoryTranslate('Geri yükle'), danger: true }
            );
            if (!confirmed) return;
            restore.disabled = true;
            const restored = await restorePisiStoreHistoryVersion({ ...payload, historyId: version.historyId });
            restore.disabled = false;
            if (restored?.ok) await renderPisiStoreHistoryList(container, payload);
        });
        actions.append(preview, restore);
        row.append(info, actions);
        list.append(row);
    }
    if (!result.versions?.length) list.textContent = pisiStoreHistoryTranslate('Henüz kayıtlı sürüm yok. İlk değişiklikten sonra oluşur.');
    container.append(current, list);
}

async function renderPisiMapHistoryTab(container) {
    container.replaceChildren();
    const result = await window.pisiDomain?.query?.('history.maps.list.v1', {});
    if (!result?.ok) throw new Error(result?.error || 'Geçmiş okunamadı.');
    const maps = (result.maps || []).filter((map) => map.mapPath);
    if (!maps.length) {
        container.textContent = pisiStoreHistoryTranslate('Henüz geçmişi olan bir harita yok.');
        return;
    }
    const label = document.createElement('label');
    label.className = 'pisi-store-history-map-picker';
    const text = document.createElement('span');
    text.textContent = pisiStoreHistoryTranslate('Harita');
    const select = document.createElement('select');
    select.dataset.pisiStoreHistoryMap = '';
    for (const map of maps) {
        const option = document.createElement('option');
        option.value = map.mapPath;
        option.textContent = `${map.title} (${map.versions})`;
        select.append(option);
    }
    if (window.activeMapPath && maps.some((map) => map.mapPath === window.activeMapPath)) select.value = window.activeMapPath;
    label.append(text, select);
    const list = document.createElement('div');
    container.append(label, list);
    const render = () => renderPisiStoreHistoryList(list, { store: 'map', mapPath: select.value });
    select.addEventListener('change', () => void render());
    await render();
}

/**
 * The history dialog body with tabs. `renderNoteTab(container)` renders the
 * existing note history (and backups) into the "Not" tab.
 */
async function renderPisiHistoryTabs(body, renderNoteTab, initialTab = 'note') {
    const tabs = document.createElement('div');
    tabs.className = 'pisi-history-tabs';
    tabs.setAttribute('role', 'tablist');
    const panel = document.createElement('div');
    panel.className = 'pisi-history-tab-panel';
    panel.setAttribute('role', 'tabpanel');
    body.append(tabs, panel);
    const buttons = new Map();
    const select = async (id) => {
        for (const [tabId, button] of buttons) {
            button.setAttribute('aria-selected', String(tabId === id));
            button.tabIndex = tabId === id ? 0 : -1;
        }
        panel.replaceChildren();
        panel.setAttribute('aria-busy', 'true');
        try {
            if (id === 'note') await renderNoteTab(panel);
            else if (id === 'map') await renderPisiMapHistoryTab(panel);
            else await renderPisiStoreHistoryList(panel, { store: id });
        } catch (error) {
            panel.textContent = error?.message || pisiStoreHistoryTranslate('Sayfa yüklenemedi.');
        } finally {
            panel.removeAttribute('aria-busy');
        }
    };
    for (const tab of PISI_HISTORY_TABS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-history-tab';
        button.setAttribute('role', 'tab');
        button.dataset.pisiHistoryTab = tab.id;
        button.textContent = pisiStoreHistoryTranslate(tab.label);
        button.addEventListener('click', () => void select(tab.id));
        button.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            const ids = PISI_HISTORY_TABS.map((item) => item.id);
            const next = ids[(ids.indexOf(tab.id) + (event.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
            buttons.get(next)?.focus();
            void select(next);
        });
        buttons.set(tab.id, button);
        tabs.append(button);
    }
    await select(initialTab);
}

const moduleApi = {
    formatPisiStoreHistoryDiff,
    restorePisiStoreHistoryVersion,
    renderPisiHistoryTabs
};

registerModule('portability.storeHistory', moduleApi);

export { formatPisiStoreHistoryDiff, renderPisiHistoryTabs, restorePisiStoreHistoryVersion };
