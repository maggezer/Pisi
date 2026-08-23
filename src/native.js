import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';
import { installMobileViewport } from './mobile-viewport.js';

export const isNative = Capacitor.isNativePlatform();
let viewportController;

export async function initializeNativeShell(theme = 'dark') {
  viewportController ||= installMobileViewport({
    keyboard: isNative ? Keyboard : null,
    isNative
  });
  if (!isNative) return;

  const nativeTasks = [
    StatusBar.setStyle({ style: theme === 'light' ? Style.Dark : Style.Light }),
    StatusBar.setBackgroundColor({ color: theme === 'light' ? '#fbf7f1' : '#171310' })
  ];
  if (Capacitor.getPlatform() === 'ios') {
    nativeTasks.push(Keyboard.setResizeMode({ mode: KeyboardResize.Native }));
  }
  await Promise.allSettled(nativeTasks);
}

export function isSoftKeyboardVisible() {
  return viewportController?.isKeyboardVisible() || false;
}

export async function updateNativeTheme(theme) {
  if (!isNative) return;
  const resolved = theme === 'system'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;
  await Promise.allSettled([
    StatusBar.setStyle({ style: resolved === 'light' ? Style.Dark : Style.Light }),
    StatusBar.setBackgroundColor({ color: resolved === 'light' ? '#fbf7f1' : '#171310' })
  ]);
}

export async function lightHaptic() {
  if (!isNative) return;
  await Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

export async function successHaptic() {
  if (!isNative) return;
  await Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}

export async function shareBackup(backup) {
  const json = JSON.stringify(backup, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `Pisi-yedek-${date}.json`;

  if (isNative) {
    const saved = await Filesystem.writeFile({
      path: fileName,
      data: json,
      directory: Directory.Cache,
      encoding: Encoding.UTF8
    });
    await Share.share({
      title: 'Pisi yedeği',
      text: 'Pisi çalışma alanı yedeği',
      files: [saved.uri],
      dialogTitle: 'Yedeği kaydet veya paylaş'
    });
    return;
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function saveAndShareFile(fileName, data, mimeType = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  if (isNative) {
    const saved = await Filesystem.writeFile({
      path: fileName,
      data: await blobToBase64(blob),
      directory: Directory.Cache
    });
    await Share.share({
      title: fileName,
      text: 'Pisi dışa aktarımı',
      files: [saved.uri],
      dialogTitle: 'Dosyayı kaydet veya paylaş'
    });
    return saved.uri;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return fileName;
}

export async function onHardwareBack(callback) {
  if (!isNative) return null;
  return App.addListener('backButton', callback);
}

export async function exitNativeApp() {
  if (!isNative) return;
  await App.exitApp();
}
