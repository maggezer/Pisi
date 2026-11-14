import { createApp } from './app/app.mjs';
import { createCapacitorPlatform } from './platform/capacitor-platform.mjs';

const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

function readStorage() {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

createApp({
    root: document.getElementById('app'),
    platform: createCapacitorPlatform(),
    storage: readStorage(),
    deviceLanguage: navigator.language,
    systemTheme: {
        prefersDark: () => darkScheme.matches,
        subscribe(listener) {
            darkScheme.addEventListener('change', listener);
            return () => darkScheme.removeEventListener('change', listener);
        }
    },
    onError: (error) => console.error('[Pisi]', error)
});
