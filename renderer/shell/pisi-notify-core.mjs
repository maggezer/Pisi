// Pure rules for in-app notifications: kinds, durations, merging of repeated
// messages, the visible limit and accessibility attributes. No DOM; unit-tested.

export const PISI_NOTIFY_TYPES = Object.freeze(['info', 'success', 'warning', 'error']);
export const PISI_NOTIFY_DURATIONS = Object.freeze({ info: 4000, success: 4000, warning: 6000, error: 0 });
export const PISI_NOTIFY_MAX_VISIBLE = 4;
const PISI_NOTIFY_MAX_TEXT = 600;
const PISI_NOTIFY_MAX_DETAIL = 8000;

export function normalizePisiNotifyType(type) {
    return PISI_NOTIFY_TYPES.includes(type) ? type : 'info';
}

/** Milliseconds before the strip closes by itself; 0 means it stays (errors). */
export function getPisiNotifyDuration(type, requested) {
    const kind = normalizePisiNotifyType(type);
    if (kind === 'error') return 0;
    const value = Number(requested);
    return Number.isFinite(value) && value > 0 ? value : PISI_NOTIFY_DURATIONS[kind];
}

/** Errors and warnings interrupt the screen reader; the rest wait their turn. */
export function getPisiNotifyAria(type) {
    const kind = normalizePisiNotifyType(type);
    return kind === 'error' || kind === 'warning' ? { role: 'alert', live: 'assertive' } : { role: 'status', live: 'polite' };
}

function toText(value, limit) {
    if (value instanceof Error) return String(value.message || value).slice(0, limit);
    return String(value ?? '')
        .trim()
        .slice(0, limit);
}

/**
 * @param {{ type?: string, message?: unknown, detail?: unknown, duration?: number,
 *   action?: { label: string, run: Function } | null }} input
 */
export function normalizePisiNotification(input = {}) {
    const type = normalizePisiNotifyType(input.type);
    const message = toText(input.message, PISI_NOTIFY_MAX_TEXT);
    const detail = toText(input.detail, PISI_NOTIFY_MAX_DETAIL);
    const action = input.action && typeof input.action.run === 'function' ? { label: toText(input.action.label, 80), run: input.action.run } : null;
    return { type, message, detail: detail === message ? '' : detail, duration: getPisiNotifyDuration(type, input.duration), action };
}

export function getPisiNotifyKey(notification) {
    return `${notification.type}\u0000${notification.message}\u0000${notification.detail}`;
}

/**
 * A queue of visible notifications. `push` either merges into the open strip
 * with the same type, message and detail (count + 1, timer restarts) or adds a
 * new one; past the limit the oldest non-error strip (else the oldest) leaves.
 */
export function createPisiNotifyQueue(maxVisible = PISI_NOTIFY_MAX_VISIBLE) {
    let nextId = 1;
    /** @type {Array<ReturnType<typeof normalizePisiNotification> & { id: number, key: string, count: number }>} */
    const items = [];
    return {
        items,
        push(input) {
            const notification = normalizePisiNotification(input);
            if (!notification.message) return { item: null, merged: false, removed: [] };
            const key = getPisiNotifyKey(notification);
            const existing = items.find((item) => item.key === key);
            if (existing) {
                existing.count += 1;
                if (notification.action) existing.action = notification.action;
                return { item: existing, merged: true, removed: [] };
            }
            const item = { ...notification, id: nextId++, key, count: 1 };
            items.push(item);
            const removed = [];
            while (items.length > maxVisible) {
                const index = items.findIndex((entry) => entry.type !== 'error');
                removed.push(...items.splice(index >= 0 ? index : 0, 1));
            }
            return { item, merged: false, removed };
        },
        remove(id) {
            const index = items.findIndex((item) => item.id === id);
            return index >= 0 ? items.splice(index, 1)[0] : null;
        },
        clear() {
            return items.splice(0, items.length);
        }
    };
}
