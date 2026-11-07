import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, ipcMain } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';
import { createPisiLogger, createPisiRateLimiter } from './logger-core.js';

// The local diagnostic log (userData/logs). Loaded right after path-security so
// the test userData path is already set. console.warn/error in main also go to
// the log, renderer errors arrive through a narrow, rate-limited channel, and
// uncaught exceptions / unhandled rejections are written synchronously before
// anything else happens. The logger writes only into its own folder, so a
// failure in the middle of a project write leaves the atomic mutation journal
// untouched for the next open to recover. Nothing is ever sent anywhere.

const PISI_APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PISI_RENDERER_REPORT_CHANNEL = 'pisi:diagnostics-report';
const PISI_RENDERER_REPORT_LIMIT = 20;
const nativeConsole = { warn: console.warn.bind(console), error: console.error.bind(console) };

function getPisiLogDirectory() {
    return path.join(app.getPath('userData'), 'logs');
}

const pisiLogger = createPisiLogger({
    directory: getPisiLogDirectory,
    roots: () => ({ projectFolder: modules['main.runtime']?.activeProjectFolder || null, appRoot: PISI_APP_ROOT, homeDir: os.homedir() })
});
const pisiRendererReportLimiter = createPisiRateLimiter(PISI_RENDERER_REPORT_LIMIT, 60000);

/** Writes one entry; never throws. level: debug | info | warn | error | fatal. */
function logPisiEvent(level, module, message, error = null, context = undefined) {
    return pisiLogger.write({ level, module, message, error, context });
}

function describePisiConsoleArgument(value) {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined || typeof value !== 'object') return String(value);
    // Objects may carry note content: keep only their identifying fields.
    const fields = ['code', 'error', 'message', 'reason'].filter((key) => typeof value[key] === 'string' || typeof value[key] === 'number');
    return fields.length ? fields.map((key) => `${key}=${value[key]}`).join(' ') : `[${value.constructor?.name || 'Object'}]`;
}

function forwardPisiConsole(level, args) {
    const error = args.find((value) => value instanceof Error) || null;
    const parts = args.filter((value) => value !== error).map(describePisiConsoleArgument);
    const tag = /^\[([^\]]{1,40})\]\s*/.exec(parts[0] || '');
    if (tag) parts[0] = parts[0].slice(tag[0].length);
    logPisiEvent(level, tag ? tag[1].toLowerCase() : 'main', parts.join(' ').trim(), error);
}

function installPisiConsoleForwarding() {
    console.warn = (...args) => {
        nativeConsole.warn(...args);
        forwardPisiConsole('warn', args);
    };
    console.error = (...args) => {
        nativeConsole.error(...args);
        forwardPisiConsole('error', args);
    };
}

function clip(value, limit) {
    return typeof value === 'string' ? value.slice(0, limit) : '';
}

/** A renderer `error` / `unhandledrejection` report (fields are validated and clipped). */
function handlePisiRendererReport(event, payload) {
    const window = globalThis.mainWindow;
    if (!window || window.isDestroyed() || event.sender !== window.webContents) return false;
    const { allowed, suppressed } = pisiRendererReportLimiter.take(Date.now());
    if (suppressed) logPisiEvent('warn', 'renderer', `${suppressed} renderer hata kaydı hız sınırı nedeniyle atlandı.`);
    if (!allowed) return false;
    const report = payload && typeof payload === 'object' ? payload : {};
    const kind = report.kind === 'unhandledrejection' ? 'unhandledrejection' : 'error';
    const location = clip(report.source, 300) ? `${clip(report.source, 300)}:${Number(report.line) || 0}:${Number(report.column) || 0}` : '';
    return pisiLogger.write({
        level: 'error',
        module: 'renderer',
        message: `${kind}: ${clip(report.message, 2000)}`,
        stack: clip(report.stack, 8000),
        context: location ? { location } : undefined
    });
}

function handlePisiProcessFailure(kind, error) {
    logPisiEvent(kind === 'uncaughtException' ? 'fatal' : 'error', 'process', kind, error);
    if (kind === 'uncaughtException') modules['main.crashHandling']?.handlePisiFatalError?.(error);
}

function installPisiProcessHandlers() {
    process.on('uncaughtException', (error) => handlePisiProcessFailure('uncaughtException', error));
    process.on('unhandledRejection', (reason) => handlePisiProcessFailure('unhandledRejection', reason));
}

function installPisiLogger() {
    installPisiConsoleForwarding();
    installPisiProcessHandlers();
    ipcMain.on(PISI_RENDERER_REPORT_CHANNEL, handlePisiRendererReport);
    logPisiEvent('info', 'app', `Pisi ${app.getVersion()} başladı`, null, {
        electron: process.versions.electron || '',
        platform: process.platform,
        arch: process.arch
    });
}

const moduleApi = {
    logPisiEvent,
    getPisiLogDirectory,
    handlePisiRendererReport,
    installPisiLogger
};

registerMainModule('main.logger', moduleApi);
installPisiLogger();

export { getPisiLogDirectory, logPisiEvent };
