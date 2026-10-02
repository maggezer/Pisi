import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';

function getWindowsAppIdentity(app, executable = process.execPath) {
    const root = app.getAppPath();
    const suffix = crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 12);
    const appId = app.isPackaged ? 'com.mumin.pisi' : `com.mumin.pisi.dev.${suffix}`;
    return {
        appId,
        appIconPath: path.join(root, 'assets', 'pisi.ico'),
        appIconIndex: 0,
        relaunchCommand: app.isPackaged ? `"${executable}"` : `"${executable}" "${root}"`,
        relaunchDisplayName: app.isPackaged ? 'Pisi' : 'Pisi (Development)'
    };
}

function ensureWindowsDevShortcut(app, shell, executable = process.execPath) {
    if (process.platform !== 'win32' || app.isPackaged) return;
    const identity = getWindowsAppIdentity(app, executable);
    const directory = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const shortcut = path.join(directory, `Pisi Development ${identity.appId.split('.').pop()}.lnk`);
    const details = {
        target: executable,
        cwd: app.getAppPath(),
        args: `"${app.getAppPath()}"`,
        description: 'Pisi development workspace',
        icon: identity.appIconPath,
        iconIndex: 0,
        appUserModelId: identity.appId
    };
    try {
        fs.mkdirSync(directory, { recursive: true });
        if (fs.existsSync(shortcut)) {
            const previous = shell.readShortcutLink(shortcut);
            if (Object.entries(details).every(([key, value]) => previous[key] === value)) return;
        }
        if (!shell.writeShortcutLink(shortcut, 'create', details)) {
            console.warn('[PISI] Windows development shortcut could not be written.');
        }
    } catch (error) {
        console.warn('[PISI] Windows development shortcut could not be updated:', error.message);
    }
}

export { getWindowsAppIdentity, ensureWindowsDevShortcut };
