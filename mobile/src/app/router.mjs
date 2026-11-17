// The one place that holds navigation state (docs/mobile-plan.md §3.4):
// the active tab, the sub-screens stacked on it, the open sheets or dialogs,
// the day the Pisi tab shows, the note the note screen shows and the map the map viewer shows.

export const PISI_HOME_TAB = 'pisi';
export const PISI_TABS = Object.freeze(['pisi', 'tasks', 'notes', 'calendar', 'maps']);
export const PISI_SUB_SCREENS = Object.freeze(['settings', 'sync-pair', 'map', 'note']);

export function createRouter({ today }) {
    let state = Object.freeze({ tab: PISI_HOME_TAB, stack: Object.freeze([]), overlays: Object.freeze([]), selectedDate: today, note: null, map: null });
    const listeners = new Set();

    function update(patch) {
        state = Object.freeze({ ...state, ...patch });
        for (const listener of listeners) listener(state);
        return state;
    }

    return {
        getState: () => state,

        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        /** Switches tab. Sub-screens and sheets of the tab being left are closed. */
        selectTab(tab) {
            if (!PISI_TABS.includes(tab)) return state;
            if (tab === state.tab && !state.stack.length && !state.overlays.length) return state;
            return update({ tab, stack: Object.freeze([]), overlays: Object.freeze([]) });
        },

        /** Opens a sub-screen over the current tab. The note screen and the map viewer are opened with `openNote` and `openMap`. */
        push(screen) {
            if (screen === 'note' || screen === 'map' || !PISI_SUB_SCREENS.includes(screen) || state.stack.at(-1) === screen) return state;
            return update({ stack: Object.freeze([...state.stack, screen]), overlays: Object.freeze([]) });
        },

        /** Opens the note screen for `{ path, title }` (the note's project-relative path). Open sheets are closed. */
        openNote(note) {
            const title = String(note?.title ?? '').trim();
            const path = String(note?.path ?? '').trim() || null;
            if (!title && !path) return state;
            const stack = state.stack.filter((screen) => screen !== 'note');
            return update({ stack: Object.freeze([...stack, 'note']), overlays: Object.freeze([]), note: Object.freeze({ path, title }) });
        },

        /**
         * Opens the map viewer for `{ key, title }` (the map's project-relative key).
         * A note opened from the map goes on top of it, so back returns to the map.
         */
        openMap(map) {
            const key = String(map?.key ?? '').trim();
            if (!key) return state;
            const title = String(map?.title ?? '').trim();
            const stack = state.stack.filter((screen) => screen !== 'map' && screen !== 'note');
            return update({ stack: Object.freeze([...stack, 'map']), overlays: Object.freeze([]), map: Object.freeze({ key, title }) });
        },

        /**
         * Takes the note screen off the stack (its note was deleted elsewhere):
         * the screen under it comes back, with the sheets of the note closed.
         */
        closeNote() {
            if (!state.stack.includes('note')) return state;
            return update({ stack: Object.freeze(state.stack.filter((screen) => screen !== 'note')), overlays: Object.freeze([]), note: null });
        },

        /** The day the Pisi tab shows (YYYY-MM-DD). Sheets stay as they are; whoever picked the day closes its own. */
        setSelectedDate(isoDate) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate)) || isoDate === state.selectedDate) return state;
            return update({ selectedDate: isoDate });
        },

        /**
         * Opens the Pisi tab on `isoDate` in one step, from another tab (the Calendar).
         * Sub-screens and sheets of the tab being left are closed.
         */
        openDay(isoDate) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate))) return state;
            return update({ tab: PISI_HOME_TAB, stack: Object.freeze([]), overlays: Object.freeze([]), selectedDate: isoDate });
        },

        openOverlay(overlay) {
            if (!overlay || state.overlays.at(-1) === overlay) return state;
            return update({ overlays: Object.freeze([...state.overlays, overlay]) });
        },

        closeOverlay() {
            if (!state.overlays.length) return state;
            return update({ overlays: Object.freeze(state.overlays.slice(0, -1)) });
        },

        /**
         * Android back button (docs/mobile-plan.md M2):
         * an open sheet or dialog closes; else a sub-screen returns to its tab;
         * else another tab returns to the Pisi tab; on the Pisi tab the app is
         * sent to the background ('minimize'), never closed.
         */
        back() {
            if (state.overlays.length) {
                update({ overlays: Object.freeze(state.overlays.slice(0, -1)) });
                return 'overlay-closed';
            }
            if (state.stack.length) {
                update({ stack: Object.freeze(state.stack.slice(0, -1)) });
                return 'screen-closed';
            }
            if (state.tab !== PISI_HOME_TAB) {
                update({ tab: PISI_HOME_TAB });
                return 'home';
            }
            return 'minimize';
        }
    };
}
