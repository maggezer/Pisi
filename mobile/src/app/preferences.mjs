// App preferences (theme, language). They are device settings, not project
// data, so they live in the WebView's localStorage and never in the project.

export const PISI_THEME_PREFERENCES = Object.freeze(['system', 'light', 'dark']);

const THEME_KEY = 'pisi.mobile.theme';
const LANGUAGE_KEY = 'pisi.mobile.language';

export function createPreferences(storage, languages) {
    const read = (key) => {
        try {
            return storage?.getItem(key) ?? null;
        } catch {
            return null;
        }
    };
    const write = (key, value) => {
        try {
            storage?.setItem(key, value);
        } catch {
            // Storage can be unavailable (private mode, quota); the choice then lasts for this run only.
        }
    };

    return {
        getTheme() {
            const stored = read(THEME_KEY);
            return PISI_THEME_PREFERENCES.includes(stored) ? stored : 'system';
        },
        setTheme(theme) {
            if (PISI_THEME_PREFERENCES.includes(theme)) write(THEME_KEY, theme);
        },
        /** The stored language, or null when the user has not chosen one. */
        getLanguage() {
            const stored = read(LANGUAGE_KEY);
            return languages.includes(stored) ? stored : null;
        },
        setLanguage(language) {
            if (languages.includes(language)) write(LANGUAGE_KEY, language);
        }
    };
}
