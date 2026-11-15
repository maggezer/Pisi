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

const systemTheme = {
    prefersDark: () => darkScheme.matches,
    subscribe(listener) {
        darkScheme.addEventListener('change', listener);
        return () => darkScheme.removeEventListener('change', listener);
    }
};
const root = document.getElementById('app');

// The component gallery exists only in development builds: `import.meta.env.DEV`
// is false in a production build, so the bundler drops the gallery with this branch.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('gallery')) {
    void import('./gallery/gallery.mjs').then(({ mountGallery }) => mountGallery({ root, systemTheme }));
} else {
    createApp({
        root,
        platform: createCapacitorPlatform(),
        storage: readStorage(),
        deviceLanguage: navigator.language,
        systemTheme,
        onError: (error) => console.error('[Pisi]', error)
    });
}
