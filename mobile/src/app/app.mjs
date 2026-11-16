// Starts the app: preferences, language, theme, navigation and the platform
// hooks (back button, pause). Everything that touches the device comes in
// through `platform`, so the same code runs in tests and in a browser.

import { getPisiTodayIsoDate } from '../../../shared/task-model.mjs';
import { PISI_LANGUAGES, createI18n, detectLanguage } from '../i18n/index.mjs';
import { renderCalendarScreen } from '../screens/calendar/index.mjs';
import { renderMapsScreen } from '../screens/maps/index.mjs';
import { createNotesScreen } from '../screens/notes/index.mjs';
import { createNoteScreen } from '../screens/notes/note.mjs';
import { createPisiScreen } from '../screens/pisi/index.mjs';
import { renderSettingsScreen } from '../screens/settings/index.mjs';
import { createTasksScreen } from '../screens/tasks/index.mjs';
import { createTaskController } from '../screens/tasks/task-controller.mjs';
import { createTaskSheets } from '../screens/tasks/task-sheets.mjs';
import { renderChoiceSheet } from '../ui/overlay.mjs';
import { createShell, renderHomeShell, renderShell } from '../ui/shell.mjs';
import { createSnackbarController, renderSnackbar } from '../ui/snackbar.mjs';
import { createLifecycle } from './lifecycle.mjs';
import { PISI_THEME_PREFERENCES, createPreferences } from './preferences.mjs';
import { PISI_HOME_TAB, PISI_TABS, createRouter } from './router.mjs';
import { PISI_THEME_BACKGROUNDS, resolveTheme } from './theme.mjs';

const TAB_SCREENS = Object.freeze({
    calendar: renderCalendarScreen,
    maps: renderMapsScreen
});

/**
 * `project` is the data layer (data/project-repo.mjs) over whatever storage the
 * platform gives; `loadSample` fills it with sample data and is passed only in
 * debug builds, where it shows up as the developer section of Settings.
 */
export function createApp({
    root,
    platform,
    storage,
    deviceLanguage,
    systemTheme,
    project = null,
    loadSample = null,
    now = () => new Date(),
    onError = () => {}
}) {
    const documentRoot = root.ownerDocument.documentElement;
    const preferences = createPreferences(storage, PISI_LANGUAGES);
    const lifecycle = createLifecycle({ onError });
    let today = getPisiTodayIsoDate(now());
    const router = createRouter({ today });
    let i18n = createI18n(preferences.getLanguage() ?? detectLanguage(deviceLanguage));
    let focusAfterRender = null;
    let focusedOverlay = null;
    let focusedDepth = 0;
    let destroyed = false;
    // The chrome of the Pisi tab, and of a screen that is built once (Tasks, Notes, a note), while it is on
    // screen; it is kept between redraws so that what is being typed keeps its focus.
    let home = null;
    let kept = null;
    // What Settings shows about the project; `counts` is null until the files have been read.
    const projectState = { counts: null, readOnlyFiles: [] };
    const view = root.ownerDocument.defaultView;
    const snackbar = createSnackbarController({
        onChange: () => !destroyed && render(),
        setTimer: (callback, delay) => view.setTimeout(callback, delay),
        clearTimer: (timer) => view.clearTimeout(timer)
    });

    // One task list for both tabs that show tasks, and the task sheets either of them opens.
    const tasks = createTaskController({ project, platform, snackbar, now, getT: () => i18n.t, onError });
    const taskSheets = createTaskSheets({
        tasks,
        getContext: () => ({ t: i18n.t, locale: i18n.locale, today }),
        onOpenOverlay: (overlay) => router.openOverlay(overlay),
        onCloseOverlay: () => closeOverlay(),
        onOpenNote: (note) => openNote(note)
    });

    // The start screen and the Tasks tab are built once and updated in place.
    const pisi = createPisiScreen({
        project,
        tasks,
        platform,
        snackbar,
        now,
        setTimer: (callback, delay) => view.setTimeout(callback, delay),
        clearTimer: (timer) => view.clearTimeout(timer),
        onError,
        onSelectDate: (isoDate) => router.setSelectedDate(isoDate),
        onOpenOverlay: (overlay) => router.openOverlay(overlay),
        onCloseOverlay: () => closeOverlay(),
        onOpenTask: taskSheets.open,
        onMenu: (screen) => navigate(() => (screen === 'settings' ? router.push('settings') : router.selectTab(screen))),
        onChange: () => !destroyed && render()
    });
    const tasksScreen = createTasksScreen({
        tasks,
        snackbar,
        now,
        onOpenTask: taskSheets.open,
        onOpenOverlay: (overlay) => router.openOverlay(overlay),
        onCloseOverlay: () => closeOverlay()
    });
    const openNote = (note) => navigate(() => router.openNote(note));
    const notesScreen = createNotesScreen({
        project,
        snackbar,
        onOpenNote: openNote,
        onOpenOverlay: (overlay) => router.openOverlay(overlay),
        onCloseOverlay: () => closeOverlay(),
        onError
    });
    const noteScreen = createNoteScreen({
        project,
        tasks,
        snackbar,
        setTimer: (callback, delay) => view.setTimeout(callback, delay),
        clearTimer: (timer) => view.clearTimeout(timer),
        onOpenTask: taskSheets.open,
        onOpenNote: openNote,
        // A diary day edited as a note is the same file the Pisi tab shows.
        onSaved: (key) => key.startsWith('diary/') && void pisi.reload(),
        onError
    });
    const openerOf = (overlay) =>
        taskSheets.getOverlayOpener(overlay) ??
        tasksScreen.getOverlayOpener(overlay) ??
        notesScreen.getOverlayOpener(overlay) ??
        pisi.getOverlayOpener(overlay) ??
        `[data-setting="${overlay}"]`;

    async function refreshProject() {
        await project.index.build();
        const listed = await project.tasks.list();
        projectState.counts = { tasks: listed.tasks.length, notes: project.notes.list().length, maps: project.maps.list().length };
        projectState.readOnlyFiles = project.getIntegrity().readOnlyFiles;
        if (!destroyed) render();
    }

    async function openProject() {
        try {
            await project.open();
            // The start screen reads its own two files and shows them before the whole project has been walked (M5).
            await Promise.all([tasks.reload(), pisi.load()]);
            await refreshProject();
            // A file that cannot be read is never overwritten; the user is told (rule V7).
            if (projectState.readOnlyFiles.length) snackbar.show({ message: i18n.t('project.readOnlyNotice', { count: projectState.readOnlyFiles.length }) });
        } catch (error) {
            onError(error);
            if (!destroyed) snackbar.show({ message: i18n.t('project.openFailed') });
        }
    }

    async function handleLoadSample() {
        try {
            const added = await loadSample(project, { now });
            await Promise.all([refreshProject(), tasks.reload(), pisi.reload()]);
            snackbar.show({ message: i18n.t('developer.sampleLoaded', added) });
        } catch (error) {
            onError(error);
            snackbar.show({ message: i18n.t('developer.sampleFailed') });
        }
    }

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
        if (result === 'overlay-closed') focusAfterRender = openerOf(closing);
        if (result === 'minimize') platform.minimizeApp();
        if (result !== 'minimize') render();
        return result;
    }

    function closeOverlay() {
        focusAfterRender = openerOf(router.getState().overlays.at(-1));
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
        // The Notes tab is always asked, so that it lets go of its sheet once that has closed.
        const notesSheet = notesScreen.renderOverlay(overlay);
        return taskSheets.renderOverlay(overlay, state.overlays, render) ?? tasksScreen.renderOverlay(overlay) ?? notesSheet ?? pisi.renderOverlay(overlay);
    }

    function render() {
        const state = router.getState();
        const subScreen = state.stack.at(-1);
        const context = { t: i18n.t, locale: i18n.locale, selectedDate: state.selectedDate, today };
        const sheet = renderSheet(state);
        const snack = snackbar.getCurrent() ? renderSnackbar(snackbar.getCurrent()) : null;

        const chrome = {
            t: i18n.t,
            tabs: PISI_TABS.map((id) => ({ id, icon: id, label: i18n.t(`tab.${id}`) })),
            activeTab: state.tab,
            onSelectTab: (tab) => navigate(() => router.selectTab(tab)),
            onOpenSettings: () => navigate(() => router.push('settings')),
            onBack: handleBack
        };

        // A screen that is built once: its shell is made when it comes on screen and only its layer is replaced after that.
        const keep = (key, title, screen, layer) => {
            screen.update(context);
            if (kept?.key !== key || kept.t !== i18n.t) {
                kept = { key, t: i18n.t, ...createShell({ ...chrome, title, inSubScreen: Boolean(subScreen), body: screen.element }) };
                root.replaceChildren(kept.element);
                screen.attach?.(kept.element.querySelector('.pisi-main'));
            }
            kept.setLayer(typeof layer === 'function' ? layer() : layer);
            focusAfterDraw(state);
        };

        if (state.tab === PISI_HOME_TAB && !subScreen) {
            kept = null;
            pisi.update(context);
            if (!home) {
                home = renderHomeShell({ body: pisi.element });
                root.replaceChildren(home.element);
                pisi.attach();
            }
            home.setLayer({ sheet, snackbar: snack });
            focusAfterDraw(state);
            return;
        }
        home = null;

        if (subScreen === 'note') {
            const title = state.note.title || i18n.t('screen.note');
            context.note = state.note;
            return keep(`note:${state.note.path ?? ''}:${title}`, title, noteScreen, { sheet, snackbar: snack });
        }
        if (state.tab === 'tasks' && !subScreen) return keep('tasks', i18n.t('tab.tasks'), tasksScreen, { sheet, snackbar: snack });
        if (state.tab === 'notes' && !subScreen) {
            return keep('notes', i18n.t('tab.notes'), notesScreen, () => ({ sheet, snackbar: snack, fab: sheet ? null : notesScreen.renderFab() }));
        }
        kept = null;

        const body =
            subScreen === 'settings'
                ? renderSettingsScreen({
                      ...context,
                      themePreference: preferences.getTheme(),
                      language: i18n.language,
                      openOverlay: router.openOverlay,
                      project: project ? projectState : null,
                      developer: Boolean(loadSample),
                      onLoadSample: handleLoadSample
                  })
                : TAB_SCREENS[state.tab](context);

        const title = subScreen === 'settings' ? i18n.t('screen.settings') : i18n.t(`tab.${state.tab}`);
        root.replaceChildren(renderShell({ ...chrome, title, inSubScreen: Boolean(subScreen), body, sheet, snackbar: snack }));

        focusAfterDraw(state);
    }

    // A sheet that has just opened takes the focus; when it closes, the focus returns to what opened it,
    // which may be a row of the sheet under it.
    function focusAfterDraw(state) {
        const overlay = state.overlays.at(-1) ?? null;
        const depth = state.overlays.length;
        const opened = overlay && (depth > focusedDepth || (depth === focusedDepth && overlay !== focusedOverlay));
        focusedOverlay = overlay;
        focusedDepth = depth;
        const target = opened ? '.pisi-sheet-option[aria-checked="true"], [data-sheet] [data-autofocus]' : focusAfterRender;
        if (!opened) focusAfterRender = null;
        if (target) root.querySelector(target)?.focus();
    }

    function handleResume() {
        applyTheme();
        // Midnight may have passed in the background. The selected day stays; what counts as today moves on.
        const current = getPisiTodayIsoDate(now());
        if (current === today) return;
        today = current;
        render();
    }

    const stops = [
        router.subscribe(render),
        // The task sheets show a task as it is stored; they are drawn again when the tasks change.
        tasks.subscribe(() => !destroyed && render()),
        systemTheme.subscribe(applyTheme),
        platform.onBackButton(handleBack),
        platform.onPause(() => lifecycle.flush()),
        platform.onResume(handleResume),
        // Diary and note text still waiting and writes still in the queue are finished when the app pauses,
        // the screen changes or back is pressed (§3.3). The text goes first so that its write is in the queue.
        lifecycle.registerFlush(async () => {
            await Promise.all([pisi.flush(), noteScreen.flush()]);
            await project?.flush();
        })
    ];

    applyLanguage();
    applyTheme();
    render();
    const ready = project ? openProject() : Promise.resolve();

    return {
        router,
        lifecycle,
        handleBack,
        /** Resolves when the project has been opened and counted (or opening failed). */
        ready,
        destroy() {
            destroyed = true;
            snackbar.dismiss();
            pisi.destroy();
            tasksScreen.destroy();
            notesScreen.destroy();
            noteScreen.destroy();
            tasks.destroy();
            for (const stop of stops) stop?.();
            root.replaceChildren();
        }
    };
}
