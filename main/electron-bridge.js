import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');

const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell, nativeImage, net, Notification, powerMonitor, Tray } = electron;

export { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell, nativeImage, net, Notification, powerMonitor, Tray };
