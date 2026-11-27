// The notifier of a browser debug build and of the tests: the same calls as
// platform/notifications.mjs, kept in memory. Tests (and the E2E tests through
// `window.pisiDeveloper.notifications`) set what Android would answer and tap
// a notification.

export function createMemoryNotifier({ permission = 'prompt', exact = 'granted', grantOnRequest = true } = {}) {
    const state = { permission, exact, channels: new Map(), scheduled: new Map(), requests: 0 };
    const openers = new Set();
    const copy = (item) => ({ ...item, extra: item.extra ? { ...item.extra } : null });

    return {
        async permission() {
            return state.permission;
        },
        async requestPermission() {
            state.requests += 1;
            if (state.permission === 'prompt') state.permission = grantOnRequest ? 'granted' : 'denied';
            return state.permission;
        },
        async exactAlarm() {
            return state.exact;
        },
        async openExactAlarmSettings() {
            state.exact = 'granted';
            return state.exact;
        },
        async ensureChannel(channel) {
            state.channels.set(channel.id, { ...channel });
        },
        async listScheduled() {
            return [...state.scheduled.values()].map((item) => ({ id: item.id, at: item.at, extra: item.extra ? { ...item.extra } : null }));
        },
        async schedule(notifications) {
            for (const item of notifications) state.scheduled.set(item.id, copy(item));
        },
        async cancel(ids) {
            for (const id of ids) state.scheduled.delete(id);
        },
        onOpen(handler) {
            openers.add(handler);
            return () => openers.delete(handler);
        },

        // ----- what a test sees and does -----

        /** The scheduled notifications, soonest first. */
        scheduled: () => [...state.scheduled.values()].map(copy).sort((a, b) => a.at - b.at || a.id - b.id),
        channel: (id) => state.channels.get(id) ?? null,
        requests: () => state.requests,
        setPermission(value) {
            state.permission = value;
        },
        setExact(value) {
            state.exact = value;
        },
        /** The user taps the notification `id`. */
        tap(id) {
            const item = state.scheduled.get(id);
            for (const handler of openers) handler(item?.extra ? { ...item.extra } : null);
        }
    };
}
