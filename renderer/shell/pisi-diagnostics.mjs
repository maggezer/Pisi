import { registerModule } from '../core/module-registry.mjs';

// Renderer side of local diagnostics: uncaught `error` and `unhandledrejection`
// events go to the main-process log through window.pisiDiagnostics (main
// validates and rate-limits them), and Settings gets a "Tanılama" section to
// open the log folder or save a diagnostics ZIP. Nothing is sent anywhere.

const PISI_DIAGNOSTICS_IGNORED = /^ResizeObserver loop/;
const pisiDiagnosticsState = { initialized: false };

function pisiDiagnosticsTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function reportPisiRendererError(event) {
    const error = event.error;
    const message = String(error?.message || event.message || '');
    if (!message || PISI_DIAGNOSTICS_IGNORED.test(message)) return false;
    window.pisiDiagnostics?.report?.({
        kind: 'error',
        message: error?.name ? `${error.name}: ${message}` : message,
        stack: String(error?.stack || ''),
        source: String(event.filename || ''),
        line: event.lineno,
        column: event.colno
    });
    return true;
}

function reportPisiRendererRejection(event) {
    const reason = event.reason;
    const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason?.message || reason || '');
    window.pisiDiagnostics?.report?.({ kind: 'unhandledrejection', message, stack: String(reason?.stack || '') });
    return true;
}

async function runPisiDiagnosticsCommand(name, button) {
    if (button) button.disabled = true;
    try {
        const result = await window.pisiDomain?.command?.(name, {});
        if (!result?.ok) pisiNotifyError(result?.error || 'İşlem tamamlanamadı.');
        return result;
    } finally {
        if (button) button.disabled = false;
    }
}

function renderPisiDiagnosticsSettings(container) {
    if (!container || container.querySelector('.pisi-diagnostics-settings')) return;
    const section = document.createElement('section');
    section.className = 'pisi-portable-section pisi-diagnostics-settings';
    const heading = document.createElement('h2');
    heading.textContent = pisiDiagnosticsTranslate('Tanılama');
    const note = document.createElement('p');
    note.className = 'pisi-diagnostics-note';
    note.textContent = pisiDiagnosticsTranslate(
        'Pisi hata kayıtlarını yalnızca bu bilgisayarda tutar ve hiçbir veriyi dışarı göndermez. Kayıtlarda not içeriği ve tam dosya yolları bulunmaz.'
    );
    const actions = document.createElement('div');
    actions.className = 'pisi-portable-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'pisi-secondary-button';
    open.dataset.pisiDiagnosticsAction = 'open-logs';
    open.textContent = pisiDiagnosticsTranslate('Log klasörünü aç');
    open.addEventListener('click', () => void runPisiDiagnosticsCommand('diagnostics.logs.open.v1', open));
    const bundle = document.createElement('button');
    bundle.type = 'button';
    bundle.className = 'pisi-secondary-button';
    bundle.dataset.pisiDiagnosticsAction = 'bundle';
    bundle.textContent = pisiDiagnosticsTranslate('Tanılama paketi oluştur');
    bundle.addEventListener('click', async () => {
        const result = await runPisiDiagnosticsCommand('diagnostics.bundle.create.v1', bundle);
        if (result?.ok && !result.canceled) pisiNotifySuccess(`${pisiDiagnosticsTranslate('Tanılama paketi kaydedildi')}: ${result.fileName}`);
    });
    actions.append(open, bundle);
    section.append(heading, note, actions);
    container.append(section);
}

function initializePisiDiagnostics() {
    if (pisiDiagnosticsState.initialized) return false;
    pisiDiagnosticsState.initialized = true;
    window.addEventListener('error', reportPisiRendererError);
    window.addEventListener('unhandledrejection', reportPisiRendererRejection);
    document.addEventListener('pisi:render-settings-sections', (event) => renderPisiDiagnosticsSettings(event.detail?.container));
    return true;
}

const moduleApi = {
    reportPisiRendererError,
    reportPisiRendererRejection,
    renderPisiDiagnosticsSettings,
    initializePisiDiagnostics
};

registerModule('shell.diagnostics', moduleApi);
initializePisiDiagnostics();
