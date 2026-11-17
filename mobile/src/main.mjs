import { createApp } from './app/app.mjs';
import { createProject } from './data/project-repo.mjs';
import { addSampleMap } from './data/sample-map.mjs';
import { loadSampleProject } from './data/sample-project.mjs';
import { createCapacitorFsDriver } from './platform/capacitor-fs-driver.mjs';
import { createCapacitorPlatform } from './platform/capacitor-platform.mjs';
import { createQrScanner } from './platform/qr-scanner.mjs';
import { createSecrets } from './platform/secrets.mjs';
import { createSyncCodec } from './sync/codec.mjs';
import { createSyncService } from './sync/sync-service.mjs';

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
    const onError = (error) => console.error('[Pisi]', error);
    // Debug builds (the dev server and the test APK, which CI builds with VITE_PISI_DEVELOPER=1) get the developer menu.
    const developer = import.meta.env.DEV || import.meta.env.VITE_PISI_DEVELOPER === '1';
    const project = createProject({ driver: createCapacitorFsDriver(), makeUuid: () => window.crypto.randomUUID(), onError });
    // Debug builds only: a stand-in for another device, so tests can change files "from outside" (docs/sync-plan.md S4).
    if (developer) {
        void import('./data/external-source.mjs').then(({ createExternalSource }) => {
            window.pisiDeveloper = Object.freeze({ external: createExternalSource(project) });
        });
    }
    const platform = createCapacitorPlatform();
    let app = null;
    // Pisi Sync (docs/sync-plan.md S5): device state in Directory.Data/sync/, outside the project (SV2);
    // token and key in the Keystore plugin. Before a turn the screens write what they hold (SV4).
    const sync = createSyncService({
        project,
        stateDriver: createCapacitorFsDriver({ root: 'sync' }),
        secrets: createSecrets(),
        subtle: window.crypto.subtle,
        random: (length) => window.crypto.getRandomValues(new Uint8Array(length)),
        uuid: () => window.crypto.randomUUID(),
        fetchImpl: (url, init) => window.fetch(url, init),
        setTimer: (callback, delay) => window.setTimeout(callback, delay),
        clearTimer: (timer) => window.clearTimeout(timer),
        AbortControllerImpl: window.AbortController,
        codec: createSyncCodec({ CompressionStreamImpl: window.CompressionStream, DecompressionStreamImpl: window.DecompressionStream }),
        flushPending: () => app?.lifecycle.flush(),
        platformName: platform.isNative ? 'android' : 'web',
        onError
    });
    app = createApp({
        root,
        platform,
        sync,
        qrScanner: createQrScanner(),
        project,
        loadSample: developer ? loadSampleProject : null,
        loadSampleMap: developer ? addSampleMap : null,
        // Both come from the build (vite.config.mjs): package.json's version and, in CI, the APK's version code.
        version: { name: import.meta.env.PISI_APP_VERSION, build: import.meta.env.PISI_BUILD_NUMBER },
        storage: readStorage(),
        deviceLanguage: navigator.language,
        systemTheme,
        onError
    });
}
