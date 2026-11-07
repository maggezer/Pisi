import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, dialog } from '../electron-bridge.js';
import { modules, registerMainModule } from '../module-registry.js';
import {
    formatPisiBackupFileName,
    isPisiBackupDue,
    isPisiBackupStale,
    sanitizePisiBackupProjectName,
    selectPisiBackupRetention,
    validatePisiBackupFolder
} from './external-backup-core.js';

// Automatic backups of the open project into a folder outside it: once a day
// while the app is open and when it quits, one ZIP per run
// (Pisi-<proje>-YYYY-MM-DD-HHmm.zip; version history and temporary files are
// left out), kept for 14 days plus one per week for 8 weeks. "Yedekten geri
// yükle" opens a backup into a new folder; the open project is never
// overwritten. The ZIP is written and read by the project read worker.

const PISI_BACKUP_CHECK_MS = 60 * 60 * 1000;
const PISI_BACKUP_QUIT_TIMEOUT_MS = 60 * 1000;
const domain = modules['main.domainCommandQuery'];
const pathSecurity = modules['main.pathSecurity'];
const backupState = { running: null, quitHandled: false, timer: null };

function isPisiBackupTestMode() {
    // Test-only: E2E runs pass folders instead of answering native dialogs.
    return !app.isPackaged && process.env.PISI_TEST_BACKUP_DIALOGS === '1';
}

function getPisiBackupSettings() {
    const value = pathSecurity.readSettings()?.backups;
    return {
        folder: typeof value?.folder === 'string' ? value.folder : '',
        projects: value?.projects && typeof value.projects === 'object' ? value.projects : {}
    };
}

function savePisiBackupSettings(next) {
    const settings = pathSecurity.readSettings();
    settings.backups = next;
    pathSecurity.writeSettings(settings);
}

function getPisiBackupProjectKey(projectFolder) {
    try {
        return fs.realpathSync.native(projectFolder);
    } catch {
        return path.resolve(projectFolder);
    }
}

function getPisiBackupStatus() {
    const projectFolder = globalThis.activeProjectFolder || null;
    const settings = getPisiBackupSettings();
    const record = projectFolder ? settings.projects[getPisiBackupProjectKey(projectFolder)] || {} : {};
    const now = Date.now();
    return {
        ok: true,
        folder: settings.folder,
        projectName: projectFolder ? path.basename(projectFolder) : '',
        lastSuccessAt: record.lastSuccessAt || null,
        lastFile: record.lastFile || null,
        lastError: record.lastError || null,
        running: Boolean(backupState.running),
        due: Boolean(settings.folder && projectFolder && isPisiBackupDue(record.lastSuccessAt, now)),
        stale: Boolean(settings.folder && projectFolder && isPisiBackupStale(record.lastSuccessAt, now))
    };
}

function checkPisiBackupFolder(folder, projectFolder) {
    let realFolder;
    try {
        realFolder = fs.realpathSync.native(folder);
        if (!fs.statSync(realFolder).isDirectory()) return { ok: false, code: 'BACKUP_FOLDER_INVALID', error: 'Yedek klasörü bir klasör değil.' };
    } catch {
        return { ok: false, code: 'BACKUP_FOLDER_MISSING', error: 'Yedek klasörü bulunamadı.' };
    }
    return projectFolder ? validatePisiBackupFolder(realFolder, getPisiBackupProjectKey(projectFolder)) : { ok: true, folder: realFolder };
}

async function choosePisiBackupFolder(payload = {}) {
    let folder = '';
    if (isPisiBackupTestMode() && typeof payload.folder === 'string') {
        folder = payload.folder;
    } else {
        const result = await dialog.showOpenDialog(globalThis.mainWindow, {
            title: modules['main.i18n']?.translatePisiMain?.('Yedek klasörünü seç') || 'Yedek klasörünü seç',
            properties: ['openDirectory', 'createDirectory']
        });
        if (result.canceled || !result.filePaths?.[0]) return { ok: true, canceled: true };
        folder = result.filePaths[0];
    }
    const checked = checkPisiBackupFolder(folder, globalThis.activeProjectFolder);
    if (!checked.ok) return checked;
    savePisiBackupSettings({ ...getPisiBackupSettings(), folder: checked.folder });
    return { ...getPisiBackupStatus(), ok: true };
}

function recordPisiBackupResult(projectFolder, patch) {
    const settings = getPisiBackupSettings();
    const key = getPisiBackupProjectKey(projectFolder);
    settings.projects[key] = { ...(settings.projects[key] || {}), ...patch };
    savePisiBackupSettings(settings);
}

function prunePisiBackups(folder, projectName) {
    const { remove } = selectPisiBackupRetention(fs.readdirSync(folder), projectName, Date.now());
    for (const name of remove) {
        try {
            fs.rmSync(path.join(folder, name), { force: true });
        } catch {
            // A backup that cannot be removed now is tried again next time.
        }
    }
    return remove.length;
}

/**
 * Backs up the open project now. `timeoutMs` stops a run that takes too long
 * (on quit); the half-written file is removed and the last backup stays valid.
 */
async function runPisiProjectBackup(reason = 'manual', options = {}) {
    if (backupState.running) return backupState.running;
    const projectFolder = globalThis.activeProjectFolder;
    const settings = getPisiBackupSettings();
    if (!projectFolder) return { ok: false, code: 'NO_PROJECT', error: 'Açık proje yok.' };
    if (!settings.folder) return { ok: false, code: 'BACKUP_FOLDER_MISSING', error: 'Yedek klasörü seçilmedi.' };
    const checked = checkPisiBackupFolder(settings.folder, projectFolder);
    if (!checked.ok) {
        recordPisiBackupResult(projectFolder, { lastError: checked.error, lastErrorAt: new Date().toISOString() });
        return checked;
    }
    const projectName = path.basename(projectFolder);
    let fileName = formatPisiBackupFileName(projectName, Date.now());
    for (let index = 1; fs.existsSync(path.join(checked.folder, fileName)); index += 1) fileName = fileName.replace(/(?:-\d+)?\.zip$/, `-${index}.zip`);
    const outputPath = path.join(checked.folder, fileName);
    const reader = modules['main.projectRead'];
    const logEvent = modules['main.logger']?.logPisiEvent;
    const run = (async () => {
        const started = Date.now();
        try {
            const work = reader.runPisiProjectRead('backupZip', { root: projectFolder, outputPath });
            const result = options.timeoutMs
                ? await Promise.race([
                      work,
                      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Yedekleme süre sınırını aştı.')), options.timeoutMs).unref?.())
                  ])
                : await work;
            const removed = prunePisiBackups(checked.folder, projectName);
            recordPisiBackupResult(projectFolder, { lastSuccessAt: new Date().toISOString(), lastFile: fileName, lastError: null });
            logEvent?.('info', 'backup', 'Proje yedeklendi', null, { reason, files: result.files, ms: Date.now() - started, removed });
            return { ok: true, fileName, files: result.files, bytes: result.bytes, removed };
        } catch (error) {
            if (/süre sınırını/.test(String(error?.message))) await reader.stopPisiReadWorker();
            fs.rmSync(`${outputPath}.tmp`, { force: true });
            recordPisiBackupResult(projectFolder, { lastError: error?.message || String(error), lastErrorAt: new Date().toISOString() });
            logEvent?.('error', 'backup', 'Proje yedeklenemedi', error, { reason });
            return { ok: false, code: 'BACKUP_FAILED', error: error?.message || 'Yedekleme başarısız.' };
        }
    })();
    backupState.running = run;
    try {
        return await run;
    } finally {
        backupState.running = null;
    }
}

function checkPisiDailyBackup() {
    const status = getPisiBackupStatus();
    if (status.due && !status.running) void runPisiProjectBackup('daily');
    return status.due;
}

function makePisiRestoreFolderName(projectName, time) {
    const stamp = formatPisiBackupFileName('x', time).replace(/^Pisi-x-|\.zip$/g, '');
    return `${sanitizePisiBackupProjectName(projectName)} (yedek ${stamp})`;
}

/**
 * Opens a backup ZIP into a new folder and makes it the open project. The
 * folder must not exist and must not be inside the open project.
 */
async function restorePisiProjectBackup(payload = {}) {
    let zipPath = '';
    let parentFolder = '';
    if (isPisiBackupTestMode() && payload.zipPath && payload.parentFolder) {
        ({ zipPath, parentFolder } = payload);
    } else {
        const settings = getPisiBackupSettings();
        const zip = await dialog.showOpenDialog(globalThis.mainWindow, {
            title: modules['main.i18n']?.translatePisiMain?.('Geri yüklenecek yedeği seç') || 'Geri yüklenecek yedeği seç',
            defaultPath: settings.folder || undefined,
            properties: ['openFile'],
            filters: [{ name: 'Pisi yedeği', extensions: ['zip'] }]
        });
        if (zip.canceled || !zip.filePaths?.[0]) return { ok: true, canceled: true };
        const parent = await dialog.showOpenDialog(globalThis.mainWindow, {
            title: modules['main.i18n']?.translatePisiMain?.('Yedeğin açılacağı klasörü seç') || 'Yedeğin açılacağı klasörü seç',
            properties: ['openDirectory', 'createDirectory']
        });
        if (parent.canceled || !parent.filePaths?.[0]) return { ok: true, canceled: true };
        zipPath = zip.filePaths[0];
        parentFolder = parent.filePaths[0];
    }
    const nameMatch = /^Pisi-(.+)-\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?\.zip$/.exec(path.basename(zipPath));
    const projectName = nameMatch ? nameMatch[1] : path.basename(zipPath, '.zip');
    let realParent;
    try {
        realParent = fs.realpathSync.native(parentFolder);
    } catch {
        return { ok: false, code: 'RESTORE_FOLDER_MISSING', error: 'Hedef klasör bulunamadı.' };
    }
    const active = globalThis.activeProjectFolder;
    if (active) {
        const relation = path.relative(getPisiBackupProjectKey(active), realParent);
        if (relation === '' || (!relation.startsWith('..') && !path.isAbsolute(relation))) {
            return { ok: false, code: 'RESTORE_FOLDER_INSIDE_PROJECT', error: 'Yedek açık projenin içine açılamaz.' };
        }
    }
    let target = path.join(realParent, makePisiRestoreFolderName(projectName, Date.now()));
    for (let index = 2; fs.existsSync(target); index += 1) target = path.join(realParent, `${makePisiRestoreFolderName(projectName, Date.now())} ${index}`);
    try {
        const extracted = await modules['main.projectRead'].runPisiProjectRead('extractZip', { zipPath, target });
        const locked = modules['main.electronIpc'].tryLockProjectFolder(target);
        if (!locked.ok) return locked;
        const settings = pathSecurity.readSettings();
        settings.lastProjectFolder = locked.folderPath;
        pathSecurity.writeSettings(settings);
        modules['main.logger']?.logPisiEvent?.('info', 'backup', 'Yedek yeni klasöre açıldı', null, { files: extracted.files });
        return { ok: true, folderPath: locked.folderPath, files: extracted.files };
    } catch (error) {
        fs.rmSync(target, { recursive: true, force: true });
        return { ok: false, code: 'RESTORE_FAILED', error: error?.message || 'Yedek açılamadı.' };
    }
}

function handlePisiBackupBeforeQuit(event) {
    if (backupState.quitHandled) return;
    backupState.quitHandled = true;
    const status = getPisiBackupStatus();
    if (!status.folder || !globalThis.activeProjectFolder) return;
    // One backup on quit, at most a minute; then quit for real.
    event.preventDefault();
    void runPisiProjectBackup('quit', { timeoutMs: PISI_BACKUP_QUIT_TIMEOUT_MS }).finally(() => app.quit());
}

function installPisiExternalBackup() {
    domain.registerPisiDomainQuery('backup.status.v1', () => getPisiBackupStatus());
    domain.registerPisiDomainCommand('backup.folder.choose.v1', (payload) => choosePisiBackupFolder(payload || {}));
    domain.registerPisiDomainCommand('backup.run.v1', () => runPisiProjectBackup('manual'));
    domain.registerPisiDomainCommand('backup.restore.v1', (payload) => restorePisiProjectBackup(payload || {}));
    backupState.timer = globalThis.setInterval(checkPisiDailyBackup, PISI_BACKUP_CHECK_MS);
    backupState.timer.unref?.();
    app.on('before-quit', handlePisiBackupBeforeQuit);
}

/** Called when a project is opened: a daily backup is taken shortly after if one is due. */
function handlePisiBackupProjectOpened() {
    const timer = setTimeout(checkPisiDailyBackup, 30 * 1000);
    timer.unref?.();
    return true;
}

const moduleApi = {
    getPisiBackupStatus,
    choosePisiBackupFolder,
    runPisiProjectBackup,
    restorePisiProjectBackup,
    handlePisiBackupProjectOpened,
    installPisiExternalBackup
};

registerMainModule('main.externalBackup', moduleApi);
installPisiExternalBackup();
