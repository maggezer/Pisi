// Test doubles for what the app receives from outside: the platform bridge,
// preference storage and the system theme.

export function createFakePlatform() {
    const handlers = { back: null, pause: null, resume: null };
    const calls = { minimize: 0, systemBars: [] };
    return {
        calls,
        isNative: false,
        onBackButton(handler) {
            handlers.back = handler;
            return () => (handlers.back = null);
        },
        onPause(handler) {
            handlers.pause = handler;
            return () => (handlers.pause = null);
        },
        onResume(handler) {
            handlers.resume = handler;
            return () => (handlers.resume = null);
        },
        minimizeApp() {
            calls.minimize += 1;
        },
        setSystemBars(options) {
            calls.systemBars.push(options);
        },
        pressBack: () => handlers.back?.(),
        pause: () => handlers.pause?.(),
        resume: () => handlers.resume?.()
    };
}

export function createFakeStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => void values.set(key, String(value))
    };
}

export function createFakeSystemTheme(dark = false) {
    const listeners = new Set();
    let prefersDark = dark;
    return {
        prefersDark: () => prefersDark,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        set(value) {
            prefersDark = value;
            for (const listener of listeners) listener();
        }
    };
}
