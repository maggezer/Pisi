import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8'));

export default defineConfig({
    // Relative asset URLs work both from the Android WebView and from a static preview.
    base: './',
    // Settings shows the version the APK is built with: versionName comes from package.json (android/app/build.gradle)
    // and versionCode from PISI_ANDROID_VERSION_CODE, which CI sets to the run number.
    define: {
        'import.meta.env.PISI_APP_VERSION': JSON.stringify(version),
        'import.meta.env.PISI_BUILD_NUMBER': JSON.stringify(process.env.PISI_ANDROID_VERSION_CODE || '')
    },
    server: {
        // shared/ (pure rules used by desktop and mobile) lives next to this package.
        fs: { allow: ['..'] }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022'
    },
    test: {
        environment: 'happy-dom',
        include: ['tests/**/*.test.mjs']
    }
});
