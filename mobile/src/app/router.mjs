// The one place that holds navigation state (docs/mobile-plan.md §3.4):
// the active tab, the sub-screens stacked on it, the open sheets or dialogs
// and the day the Pisi tab shows.

export const PISI_HOME_TAB = 'pisi';
export const PISI_TABS = Object.freeze(['pisi', 'tasks', 'notes', 'calendar', 'maps']);
export const PISI_SUB_SCREENS = Object.freeze(['settings']);

export function createRouter({ today }) {
    let state = Object.freeze({ tab: PISI_HOME_TAB, stack: Object.freeze([]), overlays: Object.freeze([]), selectedDate: today });
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

        /** Opens a sub-screen over the current tab. */
        push(screen) {
            if (!PISI_SUB_SCREENS.includes(screen) || state.stack.at(-1) === screen) return state;
            return update({ stack: Object.freeze([...state.stack, screen]), overlays: Object.freeze([]) });
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
