const { app, BrowserWindow, ipcMain, dialog, Menu, session } = require('electron');

let mainWindow; // Tüm pencere işlemleri için ana değişken
let customCalendars = []; 

// İsteğe bağlı: Üst menüyü (File, Edit vb.) gizlemek veya özelleştirmek istersen
function getFileMenuTemplate() {
  const calSubmenu = [
    { label: 'Miladi Takvim (Gregorian)', type: 'radio', checked: true, click: () => mainWindow.webContents.send('change-calendar', 'gregorian') },
    { label: 'Hicri Takvim (Hijri)', type: 'radio', click: () => mainWindow.webContents.send('change-calendar', 'hijri') },
    { label: 'Çin Takvimi (Lunar)', type: 'radio', click: () => mainWindow.webContents.send('change-calendar', 'lunar') },
    { type: 'separator' }
  ];

  customCalendars.forEach(cal => {
    calSubmenu.push({ label: cal.name, type: 'radio', click: () => mainWindow.webContents.send('change-calendar', cal.id, cal.path) });
  });

  calSubmenu.push({ type: 'separator' });
  calSubmenu.push({ label: '➕ Add Your Calendar...', click: addCustomCalendar });

  return [
    { label: 'Preferences', submenu: [{ label: 'Calendar', submenu: calSubmenu }] },
    { type: 'separator' },
    { role: 'quit', label: 'Çıkış (Exit)' }
  ];
}

async function addCustomCalendar() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Özel Takvim Eklentisi Seç',
    filters: [{ name: 'JavaScript Files', extensions: ['js'] }],
    properties: ['openFile']
  });

  if (!canceled) {
    const filePath = filePaths[0];
    try {
        const plugin = require(filePath);
        if(plugin.id && plugin.name) {
            customCalendars.push({ id: plugin.id, name: plugin.name, path: filePath });
            mainWindow.webContents.send('change-calendar', plugin.id, filePath);
        } else dialog.showErrorBox("Hata", "Seçilen dosya geçerli bir takvim eklentisi değil.");
    } catch (e) { dialog.showErrorBox("Eklenti Hatası", e.message); }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000, 
    height: 750,
    frame: false, // Kendi KEDI titlebar'ımızı kullandığımız için
    webPreferences: { 
        nodeIntegration: true, 
        contextIsolation: false 
    }
  });

  mainWindow.maximize();
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// ==========================================
// IPC DİNLEYİCİLERİ (FRONTEND İLE HABERLEŞME)
// ==========================================

// 1. Başlık Çubuğu (Titlebar) Butonları
ipcMain.on('window-min', () => { 
    if(mainWindow) mainWindow.minimize(); 
});

ipcMain.on('window-max', () => { 
    if(mainWindow) { 
        if(mainWindow.isMaximized()) mainWindow.unmaximize(); 
        else mainWindow.maximize(); 
    }
});

ipcMain.on('window-close', () => { 
    if(mainWindow) mainWindow.close(); 
});

// 2. Gerçek Tam Ekran (Native Fullscreen) Sinyalleri
ipcMain.on('enter-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setFullScreen(true);
});

ipcMain.on('exit-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setFullScreen(false);
});

ipcMain.handle('is-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isFullScreen() : false;
});

// ==========================================
// YENİ EKLENEN: İŞLETİM SİSTEMİ DİYALOG PENCERELERİ (Klasör ve Dosya Seçimi)
// ==========================================

// "KEDI'yi Aç" butonuna basıldığında Klasör seçtirir
ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Bir KEDI Çalışma Alanı (Klasörü) Seçin',
        properties: ['openDirectory', 'createDirectory'] // Mac için createDirectory izni
    });
    
    if (canceled) {
        return null;
    } else {
        return filePaths[0];
    }
});

// Ayarlardan "Özel Takvim JS Dosyası" seçileceğinde Dosya seçtirir
ipcMain.handle('dialog:openFile', async (event, options) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Dosya Seç',
        filters: options.filters,
        properties: ['openFile']
    });

    if (canceled) {
        return null;
    } else {
        return filePaths;
    }
});