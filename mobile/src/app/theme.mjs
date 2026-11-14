// Theme choice: follow the system, or force light or dark.

/** Background colours behind the system bars, used when the stylesheet cannot be read. */
export const PISI_THEME_BACKGROUNDS = Object.freeze({ light: '#fbf7f1', dark: '#171310' });

export function resolveTheme(preference, systemPrefersDark) {
    if (preference === 'light' || preference === 'dark') return preference;
    return systemPrefersDark ? 'dark' : 'light';
}
