import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, BrowserWindow, Menu, clipboard } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';
import { validatePisiExternalUrl } from './external-url-policy.js';
import {
    buildPisiContextMenuTemplate,
    getPisiSpellCheckerLanguages,
    listPisiZoomLevels,
    normalizePisiShellSettings,
    stepPisiZoomFactor
} from './window-shell-core.js';

// The application menu is removed (Menu.setApplicationMenu(null)), so the
// window shell supplies what it used to: a native context menu, spell checker
// languages, interface zoom and printing. A page that handles `contextmenu`
// itself (map, Sheet, task menus call preventDefault) gets no native menu,
// because Chromium does not emit `context-menu` for a cancelled event.

const PISI_SHELL_CAPTURE_FILE = 'pisi-shell-capture.json';
const domain = modules['main.domainCommandQuery'];
const pathSecurity = modules['main.pathSecurity'];
const i18n = modules['main.i18n'];
const portability = modules['main.portability'];
const electronIpc = modules['main.electronIpc'];
const externalLinks = modules['main.externalLinks'];

function isPisiShellCaptureEnabled() {
    // Test-only: E2E runs record menus and print jobs instead of showing them.
    return !app.isPackaged && process.env.PISI_TEST_CAPTURE_SHELL === '1';
}

function getPisiShellWindow() {
    const window = globalThis.mainWindow;
    return window && !window.isDestroyed() ? window : null;
}

function getPisiShellSettings() {
    return normalizePisiShellSettings(pathSecurity.readSettings()?.shell);
}

function savePisiShellSettings(next) {
    const settings = pathSecurity.readSettings();
    settings.shell = normalizePisiShellSettings(next);
    pathSecurity.writeSettings(settings);
    return settings.shell;
}

function readPisiShellCapture() {
    try {
        return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), PISI_SHELL_CAPTURE_FILE), 'utf8'));
    } catch {
        return { menus: [], prints: [] };
    }
}

function recordPisiShellCapture(kind, entry) {
    const capture = readPisiShellCapture();
    capture[kind] = [...(capture[kind] || []), entry];
    fs.writeFileSync(path.join(app.getPath('userData'), PISI_SHELL_CAPTURE_FILE), JSON.stringify(capture), 'utf8');
}

function applyPisiSpellChecker(window = getPisiShellWindow()) {
    const session = window?.webContents?.session;
    if (!session) return false;
    const settings = getPisiShellSettings();
    session.setSpellCheckerEnabled(settings.spellcheck);
    // macOS always uses the system spell checker and ignores this list.
    if (settings.spellcheck && process.platform !== 'darwin') {
        const languages = getPisiSpellCheckerLanguages(i18n.getPisiLanguage(), session.availableSpellCheckerLanguages || []);
        try {
            if (languages.length) session.setSpellCheckerLanguages(languages);
        } catch (error) {
            console.warn('[PISI] Yazım denetimi dilleri ayarlanamadı:', error?.message || error);
        }
    }
    return true;
}

function applyPisiZoom(window = getPisiShellWindow(), factor = getPisiShellSettings().zoomFactor) {
    if (!window) return factor;
    window.webContents.setZoomFactor(factor);
    return factor;
}

function performPisiContextMenuAction(window, item) {
    if (item.action === 'replace-misspelling') window.webContents.replaceMisspelling(item.value);
    else if (item.action === 'add-to-dictionary') window.webContents.session.addWordToSpellCheckerDictionary(item.value);
    else if (item.action === 'open-link') void externalLinks.openPisiExternalUrl(item.value);
    else if (item.action === 'copy-link') clipboard.writeText(item.value);
}

function showPisiContextMenu(window, params) {
    const translate = (text) => i18n.translatePisiMain(text);
    const items = buildPisiContextMenuTemplate(params, {
        translate,
        spellcheck: getPisiShellSettings().spellcheck,
        isLinkAllowed: (url) => validatePisiExternalUrl(url).ok
    });
    if (!items.length) return null;
    if (isPisiShellCaptureEnabled()) {
        recordPisiShellCapture('menus', { x: params.x, y: params.y, items: items.map((item) => item.id || item.type) });
        return items;
    }
    const template = items.map((item) => {
        if (item.type === 'separator') return { type: 'separator' };
        const entry = { label: item.label, enabled: item.enabled !== false };
        if (item.role) return { ...entry, role: item.role };
        return { ...entry, click: () => performPisiContextMenuAction(window, item) };
    });
    Menu.buildFromTemplate(/** @type {any} */ (template)).popup({ window });
    return items;
}

/** Called once for the main window right after it is created. */
function attachPisiWindowShell(window) {
    if (!window) return false;
    window.webContents.on('context-menu', (_event, params) => showPisiContextMenu(window, params));
    window.webContents.on('did-finish-load', () => applyPisiZoom(window));
    applyPisiSpellChecker(window);
    return true;
}

function updatePisiShellSettings(payload = {}) {
    const next = { ...getPisiShellSettings() };
    if (payload.zoomFactor !== undefined) next.zoomFactor = payload.zoomFactor;
    if (payload.spellcheck !== undefined) next.spellcheck = payload.spellcheck === true;
    const saved = savePisiShellSettings(next);
    applyPisiZoom(getPisiShellWindow(), saved.zoomFactor);
    applyPisiSpellChecker();
    return { ok: true, settings: { ...saved, zoomLevels: listPisiZoomLevels() } };
}

function stepPisiZoom(payload = {}) {
    return updatePisiShellSettings({ zoomFactor: stepPisiZoomFactor(getPisiShellSettings().zoomFactor, Number(payload.direction) || 0) });
}

async function printPisiNode(payload = {}) {
    const nodePath = electronIpc.assertProjectPath(payload.nodePath, { type: 'file', extensions: ['.node'] });
    const document = portability.buildPisiNodePrintHtml(nodePath);
    if (!document.ok) return document;
    const options = { silent: false, printBackground: true };
    if (isPisiShellCaptureEnabled()) {
        recordPisiShellCapture('prints', { title: document.title, html: document.html, options });
        return { ok: true, captured: true };
    }
    const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    try {
        await printWindow.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(document.html, 'utf8').toString('base64')}`);
        const result = await new Promise((resolve) => {
            printWindow.webContents.print(options, (success, reason) => resolve({ success, reason }));
        });
        if (result.success) return { ok: true };
        if (/cancel/i.test(String(result.reason || ''))) return { ok: true, canceled: true };
        return { ok: false, code: 'PRINT_FAILED', error: result.reason || 'Yazdırılamadı.' };
    } finally {
        if (!printWindow.isDestroyed()) printWindow.destroy();
    }
}

function installPisiWindowShellContracts() {
    domain.registerPisiDomainQuery('shell.settings.get.v1', () => ({ ok: true, settings: { ...getPisiShellSettings(), zoomLevels: listPisiZoomLevels() } }));
    domain.registerPisiDomainCommand('shell.settings.update.v1', (payload) => updatePisiShellSettings(payload || {}));
    domain.registerPisiDomainCommand('shell.zoom.step.v1', (payload) => stepPisiZoom(payload || {}));
    domain.registerPisiDomainCommand('note.print.v1', (payload) => printPisiNode(payload || {}));
    if (isPisiShellCaptureEnabled()) {
        domain.registerPisiDomainQuery('shell.test.capture.v1', () => ({
            ok: true,
            ...readPisiShellCapture(),
            zoomFactor: getPisiShellWindow()?.webContents.getZoomFactor() ?? null
        }));
    }
}

const moduleApi = {
    getPisiShellSettings,
    updatePisiShellSettings,
    applyPisiSpellChecker,
    attachPisiWindowShell,
    printPisiNode,
    installPisiWindowShellContracts
};

registerMainModule('main.windowShell', moduleApi);
installPisiWindowShellContracts();
