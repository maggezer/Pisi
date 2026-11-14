import { defineConfig } from 'vite';

export default defineConfig({
    // Relative asset URLs work both from the Android WebView and from a static preview.
    base: './',
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
