import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, Menu, Notification, Tray, nativeImage, powerMonitor } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';
import * as storageLayer from './storage.js';
import { PISI_REMINDER_DEFAULT_TIME, normalizePisiReminderTimeOfDay } from './reminder-schedule-core.js';
import { createPisiReminderService } from './reminder-service-core.js';

// Wires the reminder service to Electron: native notifications, power events,
// the project's .pisi/reminder-state.json, app settings and the optional tray.
// The renderer's permission policy stays closed; notifications come from main.

const PISI_REMINDER_STATE_KEY = '.pisi/reminder-state.json';
const PISI_REMINDER_EVENT_CHANNEL = 'pisi:reminder';
const domain = modules['main.domainCommandQuery'];
const pathSecurity = modules['main.pathSecurity'];
const taskStore = modules['main.taskStore'];
const i18n = modules['main.i18n'];

const pisiReminderRuntime = { tray: null, quitRequested: false, changeTimer: null, service: null };

function getPisiReminderWindow() {
    const window = globalThis.mainWindow;
    return window && !window.isDestroyed() ? window : null;
}

function getPisiReminderSettings() {
    const settings = pathSecurity.readSettings()?.reminders || {};
    return {
        defaultTime: normalizePisiReminderTimeOfDay(settings.defaultTime || PISI_REMINDER_DEFAULT_TIME),
        keepRunningInTray: settings.keepRunningInTray === true
    };
}

function updatePisiReminderSettings(payload = {}) {
    const current = getPisiReminderSettings();
    const next = { ...current };
    if (payload.defaultTime !== undefined) {
        if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(String(payload.defaultTime)))
            return { ok: false, code: 'REMINDER_TIME_INVALID', error: 'Saat SS:DD biçiminde olmalı.' };
        next.defaultTime = String(payload.defaultTime);
    }
    if (payload.keepRunningInTray !== undefined) next.keepRunningInTray = payload.keepRunningInTray === true;
    const settings = pathSecurity.readSettings() || {};
    pathSecurity.writeSettings({ ...settings, reminders: next });
    syncPisiReminderTray();
    pisiReminderRuntime.service?.reschedule('settings');
    return { ok: true, settings: { ...next, trayAvailable: Boolean(pisiReminderRuntime.tray) || !next.keepRunningInTray } };
}

function showPisiReminderWindow() {
    const window = getPisiReminderWindow();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.webContents?.focus?.();
}

function isPisiReminderCaptureEnabled() {
    return !app.isPackaged && process.env.PISI_TEST_CAPTURE_EXTERNAL === '1';
}

function readPisiReminderState(projectFolder) {
    return storageLayer.getPisiProjectStorage(projectFolder).readJson(PISI_REMINDER_STATE_KEY, { allowMissing: true });
}

function writePisiReminderState(projectFolder, state) {
    const storage = storageLayer.getPisiProjectStorage(projectFolder);
    const ensured = storage.ensureDirectory('.pisi', { hidden: true });
    if (!ensured.ok) return ensured;
    return storage.writeJson(PISI_REMINDER_STATE_KEY, { ...state, updatedAt: new Date().toISOString() }, { backup: false, newline: true, hiddenParent: true });
}

function createPisiReminderRuntimeService() {
    return createPisiReminderService({
        Notification,
        powerMonitor,
        platform: process.platform,
        getProjectFolder: () => modules['main.runtime']?.activeProjectFolder || null,
        readTasks: (projectFolder) => taskStore.listPisiFirstClassTasks(projectFolder).tasks,
        readState: readPisiReminderState,
        writeState: writePisiReminderState,
        getSettings: getPisiReminderSettings,
        showWindow: showPisiReminderWindow,
        sendToRenderer: (payload) => getPisiReminderWindow()?.webContents.send(PISI_REMINDER_EVENT_CHANNEL, payload),
        translate: (text) => i18n?.translatePisiMain?.(text) ?? text,
        capture: isPisiReminderCaptureEnabled()
            ? (record) => fs.appendFileSync(path.join(app.getPath('userData'), 'pisi-notifications.log'), JSON.stringify(record) + '\n', 'utf8')
            : null,
        iconPath: path.join(app.getAppPath(), 'assets', 'pisi.png')
    });
}

/** Task writes happen inside atomic mutations; plan after the write settles. */
function handlePisiReminderTasksChanged() {
    clearTimeout(pisiReminderRuntime.changeTimer);
    pisiReminderRuntime.changeTimer = setTimeout(() => pisiReminderRuntime.service?.reschedule('tasks'), 250);
}

function handlePisiReminderProjectChanged() {
    handlePisiReminderTasksChanged();
}

function quitPisiFromTray() {
    pisiReminderRuntime.quitRequested = true;
    const window = getPisiReminderWindow();
    if (!window) {
        app.quit();
        return;
    }
    // The normal close path runs: pending saves are flushed before the window closes.
    window.once('closed', () => app.quit());
    window.close();
}

function syncPisiReminderTray() {
    const wanted = getPisiReminderSettings().keepRunningInTray;
    if (!wanted) {
        pisiReminderRuntime.tray?.destroy();
        pisiReminderRuntime.tray = null;
        return;
    }
    if (pisiReminderRuntime.tray || !app.isReady()) return;
    try {
        const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', 'pisi.png')).resize({ width: 16, height: 16 });
        const tray = new Tray(icon);
        const translate = (text) => i18n?.translatePisiMain?.(text) ?? text;
        tray.setToolTip('Pisi');
        tray.setContextMenu(
            Menu.buildFromTemplate([
                { label: translate("Pisi'yi aç"), click: showPisiReminderWindow },
                { type: 'separator' },
                { label: translate('Çık'), click: quitPisiFromTray }
            ])
        );
        tray.on('click', showPisiReminderWindow);
        pisiReminderRuntime.tray = tray;
    } catch (error) {
        // Without a tray the window closes normally; the setting has no effect.
        console.warn('[PISI] Sistem tepsisi oluşturulamadı:', error?.message || error);
        pisiReminderRuntime.tray = null;
    }
}

/** Closing the window hides it while the tray keeps Pisi and its reminders running. */
function shouldPisiHideWindowOnClose() {
    return Boolean(pisiReminderRuntime.tray) && !pisiReminderRuntime.quitRequested && getPisiReminderSettings().keepRunningInTray;
}

function installPisiReminderDomainContracts() {
    domain.registerPisiDomainQuery('reminder.settings.get.v1', () => ({
        ok: true,
        settings: { ...getPisiReminderSettings(), trayAvailable: Boolean(pisiReminderRuntime.tray) || !getPisiReminderSettings().keepRunningInTray }
    }));
    domain.registerPisiDomainCommand('reminder.settings.update.v1', (payload) => updatePisiReminderSettings(payload));
    domain.registerPisiDomainQuery('reminder.pending.list.v1', () => pisiReminderRuntime.service?.listPending() || { ok: true, entries: [] });
    domain.registerPisiDomainCommand('reminder.snooze.v1', (payload = {}) => pisiReminderRuntime.service.snooze(payload.key, payload.minutes));
    domain.registerPisiDomainCommand('reminder.dismiss.v1', (payload = {}) => pisiReminderRuntime.service.dismiss(payload.keys || []));
    domain.registerPisiDomainCommand('reminder.complete.v1', (payload = {}) => pisiReminderRuntime.service.complete(payload.key));
    if (isPisiReminderCaptureEnabled()) {
        domain.registerPisiDomainCommand('reminder.test.activate.v1', (payload = {}) => pisiReminderRuntime.service.activateCaptured(payload.index));
    }
}

function startPisiReminderService() {
    if (pisiReminderRuntime.service) return pisiReminderRuntime.service;
    pisiReminderRuntime.service = createPisiReminderRuntimeService();
    syncPisiReminderTray();
    pisiReminderRuntime.service.start();
    app.on('activate', showPisiReminderWindow);
    app.on('before-quit', () => {
        pisiReminderRuntime.quitRequested = true;
    });
    return pisiReminderRuntime.service;
}

const moduleApi = {
    getPisiReminderSettings,
    updatePisiReminderSettings,
    handlePisiReminderTasksChanged,
    handlePisiReminderProjectChanged,
    shouldPisiHideWindowOnClose,
    startPisiReminderService,
    installPisiReminderDomainContracts
};

registerMainModule('main.reminderService', moduleApi);
installPisiReminderDomainContracts();
void app.whenReady().then(startPisiReminderService);
