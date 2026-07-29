const { app, BrowserWindow, dialog, ipcMain, Menu, session } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const moment = require('moment-hijri');
const { Lunar, LunarMonth } = require('lunar-javascript');

const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MONTH_NAMES = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];
const HIJRI_MONTH_NAMES = [
    'Muharrem', 'Safer', 'Rebiülevvel', 'Rebiülahir', 'Cemaziyelevvel', 'Cemaziyelahir',
    'Recep', 'Şaban', 'Ramazan', 'Şevval', 'Zilkade', 'Zilhicce'
];

let mainWindow = null;
let workspaceRoot = null;

function assertTrustedSender(event) {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
        throw new Error('Güvenilmeyen pencere isteği reddedildi.');
    }
}

function isInside(basePath, candidatePath) {
    const relative = path.relative(basePath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertWorkspacePath(inputPath) {
    if (!workspaceRoot) {
        throw new Error('Önce bir KEDI çalışma alanı seçin.');
    }
    if (typeof inputPath !== 'string' || inputPath.includes('\0')) {
        throw new Error('Geçersiz dosya yolu.');
    }

    const lexicalPath = path.resolve(inputPath);
    if (!isInside(workspaceRoot, lexicalPath)) {
        throw new Error('Dosya çalışma alanının dışında.');
    }

    let existingAncestor = lexicalPath;
    while (!fs.existsSync(existingAncestor)) {
        const parent = path.dirname(existingAncestor);
        if (parent === existingAncestor) {
            throw new Error('Dosya yolu doğrulanamadı.');
        }
        existingAncestor = parent;
    }

    const canonicalAncestor = fs.realpathSync(existingAncestor);
    const unresolvedSuffix = path.relative(existingAncestor, lexicalPath);
    const canonicalCandidate = path.resolve(canonicalAncestor, unresolvedSuffix);
    if (!isInside(workspaceRoot, canonicalCandidate)) {
        throw new Error('Sembolik bağlantı çalışma alanının dışına çıkıyor.');
    }

    return lexicalPath;
}

function assertRegularFile(filePath, maxBytes) {
    const safePath = assertWorkspacePath(filePath);
    const stat = fs.statSync(safePath);
    if (!stat.isFile()) {
        throw new Error('İstenen yol bir dosya değil.');
    }
    if (stat.size > maxBytes) {
        throw new Error('Dosya izin verilen boyutu aşıyor.');
    }
    return safePath;
}

function atomicWrite(filePath, data, encoding) {
    const safePath = assertWorkspacePath(filePath);
    const parentPath = assertWorkspacePath(path.dirname(safePath));
    if (!fs.statSync(parentPath).isDirectory()) {
        throw new Error('Hedef klasör bulunamadı.');
    }

    const tempPath = path.join(
        parentPath,
        `.kedi-${process.pid}-${crypto.randomUUID()}.tmp`
    );

    try {
        fs.writeFileSync(tempPath, data, { encoding, flag: 'wx' });
        fs.renameSync(tempPath, safePath);
    } catch (error) {
        try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch {
            // Asıl yazma hatasını koru.
        }
        throw error;
    }
}

function handleFileOperation(operation, args = {}) {
    switch (operation) {
        case 'exists':
            try {
                return fs.existsSync(assertWorkspacePath(args.path));
            } catch {
                return false;
            }
        case 'readText': {
            const filePath = assertRegularFile(args.path, MAX_TEXT_BYTES);
            return fs.readFileSync(filePath, 'utf8');
        }
        case 'readBase64': {
            const filePath = assertRegularFile(args.path, MAX_IMAGE_BYTES);
            return fs.readFileSync(filePath, 'base64');
        }
        case 'writeText': {
            if (typeof args.data !== 'string' || Buffer.byteLength(args.data, 'utf8') > MAX_TEXT_BYTES) {
                throw new Error('Metin içeriği izin verilen boyutu aşıyor.');
            }
            atomicWrite(args.path, args.data, 'utf8');
            return true;
        }
        case 'writeBase64': {
            if (typeof args.data !== 'string' || args.data.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4) {
                throw new Error('Görsel içeriği izin verilen boyutu aşıyor.');
            }
            const buffer = Buffer.from(args.data, 'base64');
            if (buffer.length > MAX_IMAGE_BYTES) {
                throw new Error('Görsel içeriği izin verilen boyutu aşıyor.');
            }
            atomicWrite(args.path, buffer);
            return true;
        }
        case 'mkdir': {
            const dirPath = assertWorkspacePath(args.path);
            fs.mkdirSync(dirPath, { recursive: true });
            return true;
        }
        case 'rename': {
            const oldPath = assertWorkspacePath(args.oldPath);
            const newPath = assertWorkspacePath(args.newPath);
            if (!fs.existsSync(oldPath)) throw new Error('Kaynak bulunamadı.');
            if (oldPath !== newPath && fs.existsSync(newPath)) throw new Error('Hedef zaten var.');
            fs.renameSync(oldPath, newPath);
            return true;
        }
        case 'removeFile': {
            const filePath = assertWorkspacePath(args.path);
            const stat = fs.lstatSync(filePath);
            if (!stat.isFile() || stat.isSymbolicLink()) {
                throw new Error('Yalnızca normal dosyalar silinebilir.');
            }
            fs.unlinkSync(filePath);
            return true;
        }
        case 'listDirectory': {
            const dirPath = assertWorkspacePath(args.path);
            if (!fs.statSync(dirPath).isDirectory()) {
                throw new Error('İstenen yol bir klasör değil.');
            }
            return fs.readdirSync(dirPath, { withFileTypes: true })
                .slice(0, 5000)
                .map((entry) => ({
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' : (entry.isFile() ? 'file' : 'other')
                }));
        }
        default:
            throw new Error('Desteklenmeyen dosya işlemi.');
    }
}

function normalizeInteger(value, label) {
    if (!Number.isInteger(value)) throw new Error(`Geçersiz ${label}.`);
    return value;
}

function calendarInitialState() {
    const now = new Date();
    const hijriNow = moment();
    const lunarNow = Lunar.fromDate(now);
    return {
        gregorian: { year: now.getFullYear(), month: now.getMonth() },
        hijri: { year: hijriNow.iYear(), month: hijriNow.iMonth() },
        lunar: { year: lunarNow.getYear(), month: lunarNow.getMonth() }
    };
}

function mondayIndex(dayOfWeek) {
    return dayOfWeek === 0 ? 6 : dayOfWeek - 1;
}

function calendarMonthData(type, state) {
    const year = normalizeInteger(state && state.year, 'yıl');
    const month = normalizeInteger(state && state.month, 'ay');
    const today = new Date();

    if (type === 'gregorian') {
        if (month < 0 || month > 11) throw new Error('Geçersiz Miladi ay.');
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDay = mondayIndex(new Date(year, month, 1).getDay());
        return {
            year,
            month,
            daysInMonth,
            firstDay,
            title: `${MONTH_NAMES[month]} ${year}`,
            fileMonth: String(month + 1).padStart(2, '0'),
            filePrefix: 'Miladi',
            todayDay: today.getFullYear() === year && today.getMonth() === month ? today.getDate() : null
        };
    }

    if (type === 'hijri') {
        if (month < 0 || month > 11) throw new Error('Geçersiz Hicri ay.');
        const firstMoment = moment(`${year}/${month + 1}/1`, 'iYYYY/iM/iD');
        const hijriToday = moment();
        return {
            year,
            month,
            daysInMonth: moment.iDaysInMonth(year, month),
            firstDay: mondayIndex(firstMoment.day()),
            title: `${HIJRI_MONTH_NAMES[month]} ${year}`,
            fileMonth: String(month + 1).padStart(2, '0'),
            filePrefix: 'Hicri',
            todayDay: hijriToday.iYear() === year && hijriToday.iMonth() === month
                ? hijriToday.iDate()
                : null
        };
    }

    if (type === 'lunar') {
        const lunarMonth = LunarMonth.fromYm(year, month);
        if (!lunarMonth) throw new Error('Geçersiz Çin takvimi ayı.');
        const firstDay = mondayIndex(Lunar.fromYmd(year, month, 1).getSolar().getWeek());
        const lunarToday = Lunar.fromDate(today);
        const monthLabel = month < 0 ? `Artık ${Math.abs(month)}. Ay` : `${month}. Ay`;
        return {
            year,
            month,
            daysInMonth: lunarMonth.getDayCount(),
            firstDay,
            title: `(Çin) ${monthLabel} ${year}`,
            fileMonth: month < 0 ? `L${String(Math.abs(month)).padStart(2, '0')}` : String(month).padStart(2, '0'),
            filePrefix: 'Cin',
            todayDay: lunarToday.getYear() === year && lunarToday.getMonth() === month
                ? lunarToday.getDay()
                : null
        };
    }

    throw new Error('Desteklenmeyen takvim türü.');
}

function shiftCalendarMonth(type, state, delta) {
    const year = normalizeInteger(state && state.year, 'yıl');
    const month = normalizeInteger(state && state.month, 'ay');
    const offset = normalizeInteger(delta, 'ay farkı');
    if (Math.abs(offset) > 1200) throw new Error('Ay farkı çok büyük.');

    if (type === 'gregorian') {
        const date = new Date(year, month + offset, 1);
        return { year: date.getFullYear(), month: date.getMonth() };
    }
    if (type === 'hijri') {
        const shifted = moment(`${year}/${month + 1}/1`, 'iYYYY/iM/iD').add(offset, 'iMonth');
        return { year: shifted.iYear(), month: shifted.iMonth() };
    }
    if (type === 'lunar') {
        const shifted = LunarMonth.fromYm(year, month);
        if (!shifted) throw new Error('Geçersiz Çin takvimi ayı.');
        const result = shifted.next(offset);
        return { year: result.getYear(), month: result.getMonth() };
    }
    throw new Error('Desteklenmeyen takvim türü.');
}

function handleSyncRequest(request) {
    if (!request || typeof request !== 'object') throw new Error('Geçersiz istek.');
    const { scope, operation, args } = request;

    if (scope === 'fs') return handleFileOperation(operation, args);
    if (scope === 'path') {
        const parts = args && args.parts;
        if (operation === 'join' && Array.isArray(parts) && parts.every((part) => typeof part === 'string')) {
            return path.join(...parts);
        }
        if (operation === 'basename' && typeof args.path === 'string') return path.basename(args.path);
        if (operation === 'dirname' && typeof args.path === 'string') return path.dirname(args.path);
        if (operation === 'extname' && typeof args.path === 'string') return path.extname(args.path);
        throw new Error('Desteklenmeyen yol işlemi.');
    }
    if (scope === 'calendar') {
        if (operation === 'initialState') return calendarInitialState();
        if (operation === 'monthData') return calendarMonthData(args.type, args.state);
        if (operation === 'shiftMonth') return shiftCalendarMonth(args.type, args.state, args.delta);
        throw new Error('Desteklenmeyen takvim işlemi.');
    }
    throw new Error('Desteklenmeyen istek kapsamı.');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 750,
        frame: false,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true
        }
    });

    const indexPath = path.join(__dirname, 'index.html');
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
    mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
        try {
            const targetPath = fileURLToPath(targetUrl);
            if (path.resolve(targetPath) !== path.resolve(indexPath)) event.preventDefault();
        } catch {
            event.preventDefault();
        }
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.maximize();
        mainWindow.show();
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
        workspaceRoot = null;
    });
    mainWindow.loadFile(indexPath);
}

ipcMain.on('kedi:sync', (event, request) => {
    try {
        assertTrustedSender(event);
        event.returnValue = { ok: true, value: handleSyncRequest(request) };
    } catch (error) {
        event.returnValue = { ok: false, error: error.message || 'İşlem başarısız.' };
    }
});

ipcMain.handle('workspace:openDirectory', async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Bir KEDI Çalışma Alanı (Klasörü) Seçin',
        properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const selectedPath = fs.realpathSync(result.filePaths[0]);
    if (!fs.statSync(selectedPath).isDirectory()) {
        throw new Error('Seçilen yol bir klasör değil.');
    }
    workspaceRoot = selectedPath;
    return workspaceRoot;
});

ipcMain.on('window:minimize', (event) => {
    assertTrustedSender(event);
    mainWindow.minimize();
});
ipcMain.on('window:maximize', (event) => {
    assertTrustedSender(event);
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
});
ipcMain.on('window:close', (event) => {
    assertTrustedSender(event);
    mainWindow.close();
});
ipcMain.on('window:enterFullscreen', (event) => {
    assertTrustedSender(event);
    mainWindow.setFullScreen(true);
});
ipcMain.on('window:exitFullscreen', (event) => {
    assertTrustedSender(event);
    mainWindow.setFullScreen(false);
});
ipcMain.handle('window:isFullscreen', (event) => {
    assertTrustedSender(event);
    return mainWindow.isFullScreen();
});

app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'"
                ]
            }
        });
    });
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
