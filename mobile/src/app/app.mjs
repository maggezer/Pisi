// Starts the app: preferences, language, theme, navigation and the platform
// hooks (back button, pause). Everything that touches the device comes in
// through `platform`, so the same code runs in tests and in a browser.

import { getPisiTodayIsoDate } from '../../../shared/task-model.mjs';
import { PISI_LANGUAGES, createI18n, detectLanguage } from '../i18n/index.mjs';
import { renderCalendarScreen } from '../screens/calendar/index.mjs';
import { renderMapsScreen } from '../screens/maps/index.mjs';
import { renderNotesScreen } from '../screens/notes/index.mjs';
import { renderPisiScreen } from '../screens/pisi/index.mjs';
import { renderSettingsScreen } from '../screens/settings/index.mjs';
import { renderTasksScreen } from '../screens/tasks/index.mjs';
import { renderChoiceSheet } from '../ui/sheet.mjs';
import { renderShell } from '../ui/shell.mjs';
import { createLifecycle } from './lifecycle.mjs';
import { PISI_THEME_PREFERENCES, createPreferences } from './preferences.mjs';
import { PISI_TABS, createRouter } from './router.mjs';
import { PISI_THEME_BACKGROUNDS, resolveTheme } from './theme.mjs';

const TAB_SCREENS = Object.freeze({
    pisi: renderPisiScreen,
    tasks: renderTasksScreen,
    notes: renderNotesScreen,
    calendar: renderCalendarScreen,
    maps: renderMapsScreen
});

export function createApp({ root, platform, storage, deviceLanguage, systemTheme, now = () => new Date(), onError = () => {} }) {
    const documentRoot = root.ownerDocument.documentElement;
    const preferences = createPreferences(storage, PISI_LANGUAGES);
    const lifecycle = createLifecycle({ onError });
    const today = getPisiTodayIsoDate(now());
    const router = createRouter({ today });
    let i18n = createI18n(preferences.getLanguage() ?? detectLanguage(deviceLanguage));
    let focusAfterRender = null;

    function applyLanguage() {
        documentRoot.lang = i18n.language === 'tr' ? 'tr' : 'en';
        root.ownerDocument.title = i18n.t('app.name');
    }

    function applyTheme() {
        const theme = resolveTheme(preferences.getTheme(), systemTheme.prefersDark());
        documentRoot.dataset.theme = theme;
        const view = root.ownerDocument.defaultView;
        const background = view?.getComputedStyle(documentRoot).getPropertyValue('--pisi-bg').trim() || PISI_THEME_BACKGROUNDS[theme];
        root.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
        platform.setSystemBars({ dark: theme === 'dark', color: background });
    }

    // A screen change is one of the moments pending saves are written (§3.3).
    function navigate(action) {
        void lifecycle.flush();
        action();
    }

    function handleBack() {
        void lifecycle.flush();
        const closing = router.getState().overlays.at(-1);
        const result = router.back();
        if (result === 'overlay-closed') focusAfterRender = `[data-setting="${closing}"]`;
        if (result === 'minimize') platform.minimizeApp();
        if (result !== 'minimize') render();
        return result;
    }

    function closeOverlay() {
        focusAfterRender = `[data-setting="${router.getState().overlays.at(-1)}"]`;
        router.closeOverlay();
    }

    function renderSheet(state) {
        const overlay = state.overlays.at(-1);
        if (overlay === 'theme') {
            return renderChoiceSheet({
                id: 'theme',
                title: i18n.t('settings.theme'),
                options: PISI_THEME_PREFERENCES.map((value) => ({ value, label: i18n.t(`theme.${value}`) })),
                selected: preferences.getTheme(),
                closeLabel: i18n.t('action.close'),
                onClose: closeOverlay,
                onSelect(value) {
                    preferences.setTheme(value);
                    applyTheme();
                    closeOverlay();
                }
            });
        }
        if (overlay === 'language') {
            return renderChoiceSheet({
                id: 'language',
                title: i18n.t('settings.language'),
                options: PISI_LANGUAGES.map((value) => ({ value, label: i18n.t(`language.${value}`) })),
                selected: i18n.language,
                closeLabel: i18n.t('action.close'),
                onClose: closeOverlay,
                onSelect(value) {
                    preferences.setLanguage(value);
                    i18n = createI18n(value);
                    applyLanguage();
                    closeOverlay();
                }
            });
        }
        return null;
    }

    function render() {
        const state = router.getState();
        const subScreen = state.stack.at(-1);
        const context = { t: i18n.t, locale: i18n.locale, selectedDate: state.selectedDate, today };
        const body =
            subScreen === 'settings'
                ? renderSettingsScreen({ ...context, themePreference: preferences.getTheme(), language: i18n.language, openOverlay: router.openOverlay })
                : TAB_SCREENS[state.tab](context);

        root.replaceChildren(
            renderShell({
                t: i18n.t,
                title: subScreen === 'settings' ? i18n.t('screen.settings') : i18n.t(`tab.${state.tab}`),
                tabs: PISI_TABS.map((id) => ({ id, label: i18n.t(`tab.${id}`) })),
                activeTab: state.tab,
                inSubScreen: Boolean(subScreen),
                body,
                sheet: renderSheet(state),
                onSelectTab: (tab) => navigate(() => router.selectTab(tab)),
                onOpenSettings: () => navigate(() => router.push('settings')),
                onBack: handleBack
            })
        );

        const focusTarget = state.overlays.length ? '.pisi-sheet-option[aria-checked="true"]' : focusAfterRender;
        if (!state.overlays.length) focusAfterRender = null;
        if (focusTarget) root.querySelector(focusTarget)?.focus();
    }

    const stops = [
        router.subscribe(render),
        systemTheme.subscribe(applyTheme),
        platform.onBackButton(handleBack),
        platform.onPause(() => lifecycle.flush()),
        platform.onResume(applyTheme)
    ];

    applyLanguage();
    applyTheme();
    render();

    return {
        router,
        lifecycle,
        handleBack,
        destroy() {
            for (const stop of stops) stop?.();
            root.replaceChildren();
        }
    };
}
