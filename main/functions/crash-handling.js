import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { app, dialog, shell } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';
import { listRecentPisiLogFiles } from './logger-core.js';

// Crash and hang handling for the main window, plus the Settings → Diagnostics
// actions (open the log folder, save a diagnostics ZIP). Every event is logged
// locally; nothing is sent anywhere. In E2E capture mode dialogs are recorded
// and answered with their first button instead of being shown.

const PISI_DIALOG_CAPTURE_FILE = 'pisi-dialog-capture.json';
const PISI_DIAGNOSTICS_DAYS = 3;
const crashState = { fatalDialogOpen: false, hangDialog: null };

function defaultDeps() {
    return {
        app,
        dialog,
        shell,
        log: (...args) => modules['main.logger']?.logPisiEvent(...args),
        translate: (text) => modules['main.i18n']?.translatePisiMain?.(text) ?? text,
        capture: !app.isPackaged && process.env.PISI_TEST_CAPTURE_DIALOGS === '1'
    };
}

function recordPisiCapturedDialog(deps, entry) {
    const file = path.join(deps.app.getPath('userData'), PISI_DIALOG_CAPTURE_FILE);
    let list = [];
    try {
        list = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        list = [];
    }
    list.push(entry);
    fs.writeFileSync(file, JSON.stringify(list), 'utf8');
}

/** Shows a message box, or records it in capture mode and answers with button 0. */
async function askPisi(deps, window, options) {
    const t = deps.translate;
    const box = {
        type: options.type || 'warning',
        title: t(options.title),
        message: t(options.message),
        detail: options.detail ? t(options.detail) : undefined,
        buttons: options.buttons.map(t),
        defaultId: 0,
        cancelId: options.buttons.length - 1,
        noLink: true,
        signal: options.signal
    };
    if (deps.capture) {
        recordPisiCapturedDialog(deps, { kind: options.kind, title: box.title, message: box.message, buttons: box.buttons });
        return 0;
    }
    const result = window && !window.isDestroyed() ? await deps.dialog.showMessageBox(window, box) : await deps.dialog.showMessageBox(box);
    return result.response;
}

async function handlePisiRendererGone(deps, window, details = {}) {
    deps.log('fatal', 'window', 'Renderer süreci kapandı', null, { reason: String(details.reason || ''), exitCode: Number(details.exitCode) || 0 });
    if (details.reason === 'clean-exit' || window.isDestroyed()) return 'ignored';
    const response = await askPisi(deps, window, {
        kind: 'render-process-gone',
        type: 'error',
        title: 'Pisi',
        message: 'Pencere beklenmedik şekilde kapandı.',
        detail: 'Diske yazılmış notlarınız güvende. Pencereyi yeniden yükleyebilirsiniz.',
        buttons: ['Yeniden yükle', 'Kapat']
    });
    if (window.isDestroyed()) return 'destroyed';
    if (response === 0) {
        deps.log('info', 'window', 'Pencere çökme sonrası yeniden yüklendi');
        window.webContents.reload();
        return 'reloaded';
    }
    window.close();
    return 'closed';
}

async function handlePisiUnresponsive(deps, window) {
    deps.log('warn', 'window', 'Pencere yanıt vermiyor');
    if (crashState.hangDialog) return 'pending';
    const controller = new globalThis.AbortController();
    crashState.hangDialog = controller;
    try {
        const response = await askPisi(deps, window, {
            kind: 'unresponsive',
            type: 'warning',
            title: 'Pisi',
            message: 'Pisi yanıt vermiyor.',
            detail: 'Bir süre bekleyebilir ya da pencereyi yeniden yükleyebilirsiniz. Yeniden yükleme kaydedilmemiş değişiklikleri kaybettirebilir.',
            buttons: ['Bekle', 'Yeniden yükle'],
            signal: controller.signal
        });
        if (controller.signal.aborted || window.isDestroyed()) return 'recovered';
        if (response === 1) {
            deps.log('info', 'window', 'Yanıt vermeyen pencere yeniden yüklendi');
            window.webContents.reload();
            return 'reloaded';
        }
        return 'waiting';
    } finally {
        crashState.hangDialog = null;
    }
}

function handlePisiResponsive(deps) {
    if (!crashState.hangDialog) return false;
    deps.log('info', 'window', 'Pencere yeniden yanıt veriyor');
    crashState.hangDialog.abort();
    return true;
}

/** Installs the crash/hang handlers on the main window. */
function attachPisiCrashHandling(window, deps = defaultDeps()) {
    if (!window) return false;
    window.webContents.on('render-process-gone', (_event, details) => void handlePisiRendererGone(deps, window, details));
    window.on('unresponsive', () => void handlePisiUnresponsive(deps, window));
    window.on('responsive', () => handlePisiResponsive(deps));
    return true;
}

/** After an uncaught exception (already logged): offer a restart; the next open recovers any interrupted write. */
async function handlePisiFatalError(error, deps = defaultDeps()) {
    if (crashState.fatalDialogOpen || !deps.app.isReady()) return 'skipped';
    crashState.fatalDialogOpen = true;
    try {
        const response = await askPisi(deps, globalThis.mainWindow, {
            kind: 'uncaught-exception',
            type: 'error',
            title: 'Pisi',
            message: 'Beklenmeyen bir hata oluştu.',
            detail: `${String(error?.message || error || '').slice(0, 300)}\n\nYarım kalan bir kayıt varsa proje yeniden açıldığında kurtarılır.`,
            buttons: ['Yeniden başlat', 'Devam et']
        });
        if (response === 0 && !deps.capture) {
            deps.app.relaunch();
            deps.app.exit(0);
            return 'relaunched';
        }
        return 'continued';
    } finally {
        crashState.fatalDialogOpen = false;
    }
}

function getPisiDiagnosticsSystemInfo() {
    return {
        app: { name: app.getName(), version: app.getVersion(), packaged: app.isPackaged },
        electron: process.versions.electron || '',
        chrome: process.versions.chrome || '',
        node: process.versions.node || '',
        os: { platform: process.platform, arch: process.arch, release: os.release(), type: os.type() },
        language: modules['main.i18n']?.getPisiLanguage?.() || '',
        createdAt: new Date().toISOString()
    };
}

/** The diagnostics ZIP: the last 3 days of logs and system.json. No note content. */
function buildPisiDiagnosticsBundle(now = Date.now()) {
    const directory = modules['main.logger'].getPisiLogDirectory();
    let names = [];
    try {
        names = fs.readdirSync(directory);
    } catch {
        names = [];
    }
    const entries = listRecentPisiLogFiles(names, now, PISI_DIAGNOSTICS_DAYS).map((name) => ({
        name: `logs/${name}`,
        data: fs.readFileSync(path.join(directory, name))
    }));
    entries.push({ name: 'system.json', data: Buffer.from(JSON.stringify(getPisiDiagnosticsSystemInfo(), null, 2), 'utf8') });
    return { buffer: modules['main.portability'].makePisiStoredZip(entries), files: entries.map((entry) => entry.name) };
}

async function createPisiDiagnosticsBundle(deps = defaultDeps()) {
    const date = new Date().toISOString().slice(0, 10);
    let filePath = '';
    if (deps.capture) {
        filePath = path.join(deps.app.getPath('userData'), `pisi-tanilama-${date}.zip`);
    } else {
        const result = await deps.dialog.showSaveDialog(globalThis.mainWindow, {
            title: deps.translate('Tanılama paketini kaydet'),
            defaultPath: `pisi-tanilama-${date}.zip`,
            filters: [{ name: 'ZIP', extensions: ['zip'] }]
        });
        if (result.canceled || !result.filePath) return { ok: true, canceled: true };
        filePath = result.filePath;
    }
    const bundle = buildPisiDiagnosticsBundle();
    fs.writeFileSync(filePath, bundle.buffer);
    deps.log('info', 'diagnostics', 'Tanılama paketi oluşturuldu', null, { files: bundle.files.length });
    return { ok: true, fileName: path.basename(filePath), files: bundle.files, ...(deps.capture ? { filePath } : {}) };
}

async function openPisiLogFolder(deps = defaultDeps()) {
    const directory = modules['main.logger'].getPisiLogDirectory();
    fs.mkdirSync(directory, { recursive: true });
    if (deps.capture) {
        recordPisiCapturedDialog(deps, { kind: 'open-log-folder' });
        return { ok: true };
    }
    const error = await deps.shell.openPath(directory);
    return error ? { ok: false, code: 'OPEN_FAILED', error } : { ok: true };
}

function installPisiDiagnosticsContracts() {
    const domain = modules['main.domainCommandQuery'];
    if (!domain) return false;
    domain.registerPisiDomainCommand('diagnostics.logs.open.v1', () => openPisiLogFolder());
    domain.registerPisiDomainCommand('diagnostics.bundle.create.v1', () => createPisiDiagnosticsBundle());
    if (defaultDeps().capture) {
        domain.registerPisiDomainQuery('diagnostics.test.state.v1', () => {
            let dialogs = [];
            try {
                dialogs = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), PISI_DIALOG_CAPTURE_FILE), 'utf8'));
            } catch {
                dialogs = [];
            }
            return { ok: true, dialogs, logDirectory: modules['main.logger'].getPisiLogDirectory() };
        });
    }
    return true;
}

const moduleApi = {
    attachPisiCrashHandling,
    handlePisiFatalError,
    createPisiDiagnosticsBundle,
    openPisiLogFolder,
    installPisiDiagnosticsContracts
};

registerMainModule('main.crashHandling', moduleApi);
installPisiDiagnosticsContracts();

export { attachPisiCrashHandling, handlePisiFatalError };
