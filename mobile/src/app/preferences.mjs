// App preferences (theme, language, reminders). They are device settings, not
// project data, so they live in the WebView's localStorage and never in the project.

import { PISI_REMINDER_DEFAULT_TIME, normalizePisiReminderTimeOfDay } from '../../../shared/reminder-schedule.mjs';

export const PISI_THEME_PREFERENCES = Object.freeze(['system', 'light', 'dark']);

const THEME_KEY = 'pisi.mobile.theme';
const LANGUAGE_KEY = 'pisi.mobile.language';
const REMINDERS_KEY = 'pisi.mobile.reminders';
const REMINDER_TIME_KEY = 'pisi.mobile.reminderTime';
const REMINDER_ASKED_KEY = 'pisi.mobile.reminderPermissionAsked';

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
        },
        /** Task reminders as notifications: on unless the user turned them off. */
        getRemindersEnabled: () => read(REMINDERS_KEY) !== 'off',
        setRemindersEnabled(enabled) {
            write(REMINDERS_KEY, enabled ? 'on' : 'off');
        },
        /** The time of day of a reminder set relative to the due day (due morning, the day before…). */
        getReminderTime: () => normalizePisiReminderTimeOfDay(read(REMINDER_TIME_KEY) ?? PISI_REMINDER_DEFAULT_TIME),
        setReminderTime(time) {
            write(REMINDER_TIME_KEY, normalizePisiReminderTimeOfDay(time));
        },
        /** Android is asked for the notification permission by itself once; after that only from Settings. */
        wasReminderPermissionAsked: () => read(REMINDER_ASKED_KEY) === 'yes',
        markReminderPermissionAsked() {
            write(REMINDER_ASKED_KEY, 'yes');
        }
    };
}
