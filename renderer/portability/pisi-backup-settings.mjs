import { registerModule } from '../core/module-registry.mjs';

// Settings → Yedekleme: the backup folder outside the project, the last
// successful backup, "Şimdi yedekle" and "Yedekten geri yükle". When no backup
// has succeeded for more than three days, a warning strip appears after the
// project opens. Backups themselves run in main (external-backup.js).

const pisiBackupSettingsState = { initialized: false, warnedFor: '' };

function pisiBackupTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function formatPisiBackupTime(value) {
    if (!value) return pisiBackupTranslate('Henüz yedek alınmadı.');
    return new Date(value).toLocaleString(window.pisiI18n?.getLanguage?.() === 'eng' ? 'en-US' : 'tr-TR');
}

async function runPisiBackupNow(button = null) {
    if (button) button.disabled = true;
    try {
        const result = await window.pisiDomain?.command?.('backup.run.v1', {});
        if (result?.ok) pisiNotifySuccess(`${pisiBackupTranslate('Yedek alındı')}: ${result.fileName}`);
        else pisiNotifyError(result?.error || 'Yedekleme başarısız.');
        document.dispatchEvent(new CustomEvent('pisi:backup-changed'));
        return result;
    } finally {
        if (button) button.disabled = false;
    }
}

/** Opens a backup ZIP into a new folder and switches to it; the open project is not changed. */
async function restorePisiProjectFromBackup(payload = {}) {
    // Everything of the open project is written first; after the switch its paths are outside the active project.
    if (typeof window.flushPisiPendingSaves === 'function' && !(await window.flushPisiPendingSaves())) return { ok: false };
    const result = await window.pisiDomain?.command?.('backup.restore.v1', payload);
    if (result?.ok && !result.canceled) {
        // The old project's editors must not try to save into the new one.
        window.clearCenterNodeEditor?.();
        window.closeNodeModalWithoutSaving?.();
    }
    if (!result?.ok || result.canceled) {
        if (!result?.ok) pisiNotifyError(result?.error || 'Yedek açılamadı.');
        return result;
    }
    const loaded = await loadProject(result.folderPath);
    if (loaded) pisiNotifySuccess(`${pisiBackupTranslate('Yedek yeni bir klasöre açıldı')}: ${result.folderPath}`);
    return { ...result, loaded };
}

function renderPisiBackupSettings(container) {
    if (!container || container.querySelector('.pisi-backup-settings')) return;
    const section = document.createElement('section');
    section.className = 'pisi-portable-section pisi-backup-settings';
    const heading = document.createElement('h2');
    heading.textContent = pisiBackupTranslate('Yedekleme');
    const note = document.createElement('p');
    note.className = 'pisi-backup-note';
    note.textContent = pisiBackupTranslate(
        'Açık proje günde bir kez ve uygulama kapanırken proje dışındaki bu klasöre tek bir ZIP olarak yedeklenir. Son 14 gün ve son 8 haftanın birer yedeği saklanır.'
    );
    const folder = document.createElement('p');
    folder.dataset.pisiBackupFolder = '';
    const last = document.createElement('p');
    last.dataset.pisiBackupLast = '';
    const warning = document.createElement('p');
    warning.className = 'pisi-backup-warning';
    warning.dataset.pisiBackupWarning = '';
    warning.hidden = true;
    const actions = document.createElement('div');
    actions.className = 'pisi-portable-actions';
    const button = (label, action) => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'pisi-secondary-button';
        element.dataset.pisiBackupAction = action;
        element.textContent = pisiBackupTranslate(label);
        return element;
    };
    const choose = button('Yedek klasörünü seç', 'choose');
    const now = button('Şimdi yedekle', 'run');
    const restore = button('Yedekten geri yükle', 'restore');
    actions.append(choose, now, restore);
    section.append(heading, note, folder, last, warning, actions);
    container.append(section);

    const render = async () => {
        const status = await window.pisiDomain?.query?.('backup.status.v1', {});
        if (!status?.ok) return;
        folder.textContent = `${pisiBackupTranslate('Yedek klasörü')}: ${status.folder || pisiBackupTranslate('Seçilmedi')}`;
        last.textContent = `${pisiBackupTranslate('Son başarılı yedek')}: ${formatPisiBackupTime(status.lastSuccessAt)}`;
        warning.hidden = !status.stale;
        warning.textContent = status.lastError
            ? `${pisiBackupTranslate('3 günden uzun süredir yedek alınamadı')}: ${status.lastError}`
            : pisiBackupTranslate('3 günden uzun süredir yedek alınamadı.');
        now.disabled = !status.folder || status.running;
    };
    choose.addEventListener('click', async () => {
        const result = await window.pisiDomain?.command?.('backup.folder.choose.v1', {});
        if (!result?.ok) pisiNotifyError(result?.error || 'Yedek klasörü seçilemedi.');
        await render();
    });
    now.addEventListener('click', async () => {
        await runPisiBackupNow(now);
        await render();
    });
    restore.addEventListener('click', () => void restorePisiProjectFromBackup());
    document.addEventListener('pisi:backup-changed', () => void render());
    void render();
}

/** After a project opens: warn once per project if the last good backup is older than three days. */
async function checkPisiBackupWarning() {
    const status = await window.pisiDomain?.query?.('backup.status.v1', {});
    if (!status?.ok || !status.stale || pisiBackupSettingsState.warnedFor === window.currentProjectFolder) return false;
    pisiBackupSettingsState.warnedFor = window.currentProjectFolder;
    pisiNotifyWarning(pisiBackupTranslate('3 günden uzun süredir yedek alınamadı.'), {
        detail: status.lastError || '',
        action: { label: 'Şimdi yedekle', run: () => runPisiBackupNow() }
    });
    return true;
}

function initializePisiBackupSettings() {
    if (pisiBackupSettingsState.initialized) return false;
    pisiBackupSettingsState.initialized = true;
    document.addEventListener('pisi:render-settings-sections', (event) => renderPisiBackupSettings(event.detail?.container));
    document.addEventListener('pisi:project-loaded', () => void checkPisiBackupWarning());
    return true;
}

const moduleApi = {
    pisiBackupSettingsState,
    runPisiBackupNow,
    restorePisiProjectFromBackup,
    renderPisiBackupSettings,
    checkPisiBackupWarning,
    initializePisiBackupSettings
};

registerModule('portability.backupSettings', moduleApi);
initializePisiBackupSettings();
