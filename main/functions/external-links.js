import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, ipcMain, shell } from '../electron-bridge.js';
import { registerMainModule } from '../module-registry.js';
import { validatePisiExternalUrl } from './external-url-policy.js';

// The only path from Pisi to the user's browser or mail client. Window-open
// requests, in-page navigations and the renderer bridge all end here.

const PISI_EXTERNAL_LINK_CAPTURE_FILE = 'pisi-external-links.log';

function isPisiExternalLinkCaptureEnabled() {
    // Test-only: E2E runs record the URL instead of launching a browser.
    return !app.isPackaged && process.env.PISI_TEST_CAPTURE_EXTERNAL === '1';
}

async function openPisiExternalUrl(value) {
    const validated = validatePisiExternalUrl(value);
    if (!validated.ok) return validated;
    try {
        if (isPisiExternalLinkCaptureEnabled()) {
            fs.appendFileSync(path.join(app.getPath('userData'), PISI_EXTERNAL_LINK_CAPTURE_FILE), validated.url + '\n', 'utf8');
        } else {
            await shell.openExternal(validated.url);
        }
        return { ok: true, url: validated.url };
    } catch (error) {
        return { ok: false, code: 'URL_OPEN_FAILED', error: error?.message || 'Bağlantı açılamadı.' };
    }
}

/**
 * The application window never leaves index.html: every navigation and popup is
 * cancelled, and a safe external target is handed to the operating system.
 * @param {import('electron').WebContents} webContents
 */
function guardPisiWindowNavigation(webContents) {
    webContents.setWindowOpenHandler(({ url }) => {
        void openPisiExternalUrl(url);
        return { action: 'deny' };
    });
    webContents.on('will-navigate', (event, url) => {
        event.preventDefault();
        if (url !== webContents.getURL()) void openPisiExternalUrl(url);
    });
}

function installPisiExternalLinkIpc() {
    ipcMain.handle('shell:open-external', (_event, url) => openPisiExternalUrl(url));
}

const moduleApi = {
    openPisiExternalUrl,
    guardPisiWindowNavigation,
    installPisiExternalLinkIpc
};

registerMainModule('main.externalLinks', moduleApi);
installPisiExternalLinkIpc();

export { guardPisiWindowNavigation, openPisiExternalUrl };
