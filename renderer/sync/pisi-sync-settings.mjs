import { registerModule } from '../core/module-registry.mjs';

let pisiSyncAutoTimer = null;
let pisiSyncBusy = false;

function pisiSyncTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function formatPisiSyncTime(value) {
    if (!value) return pisiSyncTranslate('Henüz senkronize edilmedi');
    try { return new Date(value).toLocaleString(); } catch { return String(value); }
}

async function getPisiRendererSyncStatus() {
    return window.pisiSync?.getStatus?.() || {
        ok: false, configured: false, error: pisiSyncTranslate('Sync köprüsü kullanılamıyor.')
    };
}

function makePisiSyncButton(label, className = 'pisi-sync-button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = pisiSyncTranslate(label);
    return button;
}

async function refreshPisiSyncSettings(section) {
    if (!section?.isConnected) return;
    const status = await getPisiRendererSyncStatus();
    const state = section.querySelector('.pisi-sync-state');
    const detail = section.querySelector('.pisi-sync-detail');
    const run = section.querySelector('[data-pisi-sync-run]');
    const disconnect = section.querySelector('[data-pisi-sync-disconnect]');
    const select = section.querySelector('[data-pisi-sync-select]');
    section.dataset.configured = status.configured ? 'true' : 'false';
    section.setAttribute('aria-busy', pisiSyncBusy || status.running ? 'true' : 'false');
    state.textContent = status.configured
        ? `${pisiSyncTranslate('Bağlı klasör')}: ${status.folderName}`
        : pisiSyncTranslate('Ortak klasör bağlı değil');
    detail.textContent = status.configured
        ? `${pisiSyncTranslate('Son senkronizasyon')}: ${formatPisiSyncTime(status.lastSyncAt)}`
        : (status.error || pisiSyncTranslate('Google Drive, OneDrive veya başka bir ortak klasör seçin.'));
    run.hidden = !status.configured;
    disconnect.hidden = !status.configured;
    run.disabled = pisiSyncBusy || status.running;
    select.disabled = pisiSyncBusy || status.running;
    select.textContent = pisiSyncTranslate(status.configured ? 'Klasörü değiştir' : 'Ortak klasör seç');
    const result = section.querySelector('.pisi-sync-result');
    if (status.lastResult) {
        result.hidden = false;
        result.textContent = [
            `${Number(status.lastResult.filesVerified || 0)} ${pisiSyncTranslate('gerçek proje dosyası')}`,
            `${Number(status.lastResult.changed || 0)} ${pisiSyncTranslate('değişiklik')}`,
            `${Number(status.lastResult.conflicts || 0)} ${pisiSyncTranslate('çakışma kopyası')}`,
            `${Number(status.lastResult.devices || 1)} ${pisiSyncTranslate('cihaz')}`
        ].join(' · ');
    } else {
        result.hidden = true;
    }
}

async function runPisiRendererSync(reason = 'manual', section = null) {
    if (pisiSyncBusy) return null;
    pisiSyncBusy = true;
    if (section) await refreshPisiSyncSettings(section);
    try {
        const result = await window.pisiSync?.run?.({ reason });
        if (window.currentProjectFolder && typeof window.loadProject === 'function') {
            await window.loadProject(window.currentProjectFolder);
        }
        document.dispatchEvent(new CustomEvent('pisi:sync-finished', { detail: result }));
        return result;
    } finally {
        pisiSyncBusy = false;
        if (section?.isConnected) await refreshPisiSyncSettings(section);
    }
}

function renderPisiSyncSettings(container) {
    if (!container || container.querySelector('.pisi-sync-settings')) return;
    const section = document.createElement('section');
    section.className = 'pisi-portable-section pisi-sync-settings';

    const heading = document.createElement('h2');
    heading.textContent = pisiSyncTranslate('Cihazlar arası senkronizasyon');
    const description = document.createElement('p');
    description.className = 'pisi-sync-description';
    description.textContent = pisiSyncTranslate(
        'Proje dosyalarını Google Drive, OneDrive veya başka bir ortak klasör üzerinden masaüstü ve Android ile eşitler.'
    );
    const statusBox = document.createElement('div');
    statusBox.className = 'pisi-sync-status-box';
    const state = document.createElement('strong');
    state.className = 'pisi-sync-state';
    const detail = document.createElement('span');
    detail.className = 'pisi-sync-detail';
    statusBox.append(state, detail);

    const actions = document.createElement('div');
    actions.className = 'pisi-sync-actions';
    const select = makePisiSyncButton('Ortak klasör seç');
    select.dataset.pisiSyncSelect = '';
    const run = makePisiSyncButton('Şimdi senkronize et', 'pisi-sync-button pisi-sync-primary');
    run.dataset.pisiSyncRun = '';
    const disconnect = makePisiSyncButton('Bağlantıyı kes', 'pisi-sync-button pisi-sync-danger');
    disconnect.dataset.pisiSyncDisconnect = '';
    actions.append(select, run, disconnect);
    const result = document.createElement('small');
    result.className = 'pisi-sync-result';
    result.hidden = true;
    section.append(heading, description, statusBox, actions, result);
    container.appendChild(section);

    select.addEventListener('click', async () => {
        pisiSyncBusy = true;
        await refreshPisiSyncSettings(section);
        try {
            const selected = await window.pisiSync?.selectFolder?.();
            if (selected?.ok && window.currentProjectFolder && typeof window.loadProject === 'function') {
                await window.loadProject(window.currentProjectFolder);
            }
        } catch (error) {
            window.alert(error?.message || pisiSyncTranslate('Sync klasörü seçilemedi.'));
        } finally {
            pisiSyncBusy = false;
            await refreshPisiSyncSettings(section);
        }
    });
    run.addEventListener('click', () => runPisiRendererSync('manual', section).catch((error) => {
        window.alert(error?.message || pisiSyncTranslate('Senkronizasyon başarısız.'));
    }));
    disconnect.addEventListener('click', async () => {
        if (!window.confirm(pisiSyncTranslate('Sync bağlantısı kesilsin mi? Yerel proje dosyaları korunur.'))) return;
        await window.pisiSync?.disconnect?.();
        await refreshPisiSyncSettings(section);
    });
    void refreshPisiSyncSettings(section);
}

function schedulePisiAutoSync(reason = 'local-change', delay = 5000) {
    clearTimeout(pisiSyncAutoTimer);
    pisiSyncAutoTimer = setTimeout(async () => {
        const status = await getPisiRendererSyncStatus();
        if (!status.configured || pisiSyncBusy) return;
        try { await runPisiRendererSync(reason); } catch (error) {
            console.warn('[PISI Sync]', error.message);
        }
    }, delay);
}

function initializePisiSyncSettings() {
    if (initializePisiSyncSettings.bound) return;
    initializePisiSyncSettings.bound = true;
    document.addEventListener('pisi:render-settings-sections', (event) => {
        renderPisiSyncSettings(event.detail?.container);
    });
    document.addEventListener('pisi:task-store-updated', () => schedulePisiAutoSync('task-change'));
    document.addEventListener('pisi:node-properties-changed', () => schedulePisiAutoSync('property-change'));
    document.addEventListener('input', (event) => {
        if (event.target?.closest?.('.pisi-rich-editor, [contenteditable="true"]')) {
            schedulePisiAutoSync('editor-change');
        }
    });
    window.pisiProject?.onFileSystemChanged?.((payload = {}) => {
        const relevant = (payload.changedPaths || []).some((filePath) => {
            const normalized = `/${String(filePath).replace(/\\/g, '/').replace(/^\/+/, '')}`;
            return !normalized.includes('/.pisi/sync-state.json') &&
                !normalized.includes('/.pisi/sync-trash/');
        });
        if (relevant) schedulePisiAutoSync('filesystem-change', 2500);
    });
    window.addEventListener('focus', () => schedulePisiAutoSync('focus', 1200));
    setInterval(() => schedulePisiAutoSync('interval', 0), 60000);
    setTimeout(() => schedulePisiAutoSync('startup', 0), 1800);
}

const moduleApi = {
    pisiSyncTranslate,
    formatPisiSyncTime,
    getPisiRendererSyncStatus,
    makePisiSyncButton,
    refreshPisiSyncSettings,
    runPisiRendererSync,
    renderPisiSyncSettings,
    schedulePisiAutoSync,
    initializePisiSyncSettings
};

registerModule('sync.settings', moduleApi);
initializePisiSyncSettings();

export {
    formatPisiSyncTime,
    getPisiRendererSyncStatus,
    initializePisiSyncSettings,
    renderPisiSyncSettings,
    runPisiRendererSync,
    schedulePisiAutoSync
};
