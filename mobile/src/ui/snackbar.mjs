// Snackbar: a short message at the bottom, optionally with an undo button.
// One is shown at a time; a new one replaces the current one.

import { h } from './dom.mjs';
import { icon } from './icons.mjs';

export const PISI_SNACKBAR_DURATION_MS = 5000;

export function renderSnackbar({ message, actionLabel = null, onAction = null }) {
    return h(
        'div',
        { class: 'pisi-snackbar', role: 'status', 'aria-live': 'polite' },
        h('span', { class: 'pisi-snackbar-message' }, message),
        actionLabel
            ? h('button', { type: 'button', class: 'pisi-snackbar-action', dataset: { action: 'undo' }, onClick: onAction }, icon('undo'), actionLabel)
            : null
    );
}

/**
 * Holds the snackbar that is on screen. `onChange` is called with the
 * current snackbar (or null) whenever it changes, so the owner can re-render.
 * The undo callback runs at most once and hides the snackbar; without a tap
 * the snackbar goes away after `duration`. Timers come from outside so that
 * tests control the clock.
 */
export function createSnackbarController({ onChange, setTimer, clearTimer, duration = PISI_SNACKBAR_DURATION_MS }) {
    let current = null;
    let timer = null;

    function set(next) {
        if (timer !== null) clearTimer(timer);
        timer = null;
        current = next;
        if (next) timer = setTimer(() => set(null), duration);
        onChange(current);
    }

    return {
        getCurrent: () => current,
        show({ message, actionLabel = null, onUndo = null }) {
            const snackbar = {
                message,
                actionLabel: onUndo ? actionLabel : null,
                onAction: onUndo
                    ? () => {
                          if (current !== snackbar) return;
                          set(null);
                          onUndo();
                      }
                    : null
            };
            set(snackbar);
        },
        dismiss: () => current && set(null)
    };
}
