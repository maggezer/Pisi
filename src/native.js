import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';

export const isNative = Capacitor.isNativePlatform();

export async function initializeNativeShell(theme = 'dark') {
  if (!isNative) return;

  await Promise.allSettled([
    StatusBar.setStyle({ style: theme === 'light' ? Style.Dark : Style.Light }),
    StatusBar.setBackgroundColor({ color: theme === 'light' ? '#fbf7f1' : '#171310' }),
    Keyboard.setResizeMode({ mode: 'body' })
  ]);
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
  const fileName = `KEDI-yedek-${date}.json`;

  if (isNative) {
    const saved = await Filesystem.writeFile({
      path: fileName,
      data: json,
      directory: Directory.Cache,
      encoding: Encoding.UTF8
    });
    await Share.share({
      title: 'KEDI yedeği',
      text: 'KEDI not ve harita yedeği',
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

export async function onHardwareBack(callback) {
  if (!isNative) return null;
  return App.addListener('backButton', callback);
}

export async function exitNativeApp() {
  if (!isNative) return;
  await App.exitApp();
}
