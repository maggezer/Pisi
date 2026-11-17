import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');

const { app, BrowserWindow, Menu, clipboard, ipcMain, dialog, screen, shell, nativeImage, net, Notification, powerMonitor, Tray, safeStorage } = electron;

export { app, BrowserWindow, Menu, clipboard, ipcMain, dialog, screen, shell, nativeImage, net, Notification, powerMonitor, Tray, safeStorage };
