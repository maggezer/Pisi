// Task reminders as Android notifications (app/reminders.mjs): Capacitor's
// local notifications. Android's alarm service shows each one at its minute,
// also while the app is closed or after the phone restarts. The plugin is
// loaded on first use, so its web part never enters the main bundle. In a
// browser there is no notifier (null); debug builds use memory-notifier.mjs.

import { Capacitor } from '@capacitor/core';

const ignore = () => {};
// granted | denied | prompt; Capacitor's "prompt-with-rationale" is a prompt the user has already refused once.
const permissionOf = (state) => (state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt');

/**
 * Null where there are no system notifications. Otherwise the notifier the
 * reminder scheduler drives; every call resolves, none throws.
 */
export function createNotifier({ native = Capacitor.isNativePlatform() } = {}) {
    if (!native) return null;
    let plugin = null;
    const load = async () => {
        if (!plugin) plugin = (await import('@capacitor/local-notifications')).LocalNotifications;
        return plugin;
    };

    return {
        /** 'granted', 'denied' or 'prompt' (not asked yet). */
        async permission() {
            const status = await (await load()).checkPermissions();
            return permissionOf(status.display);
        },

        /** Asks Android (13+) for the notification permission; the answer as `permission()` gives it. */
        async requestPermission() {
            const status = await (await load()).requestPermissions();
            return permissionOf(status.display);
        },

        /** Whether a reminder can come at its exact minute (Android 12+ "Alarms & reminders"): 'granted' or 'denied'. */
        async exactAlarm() {
            const status = await (await load()).checkExactNotificationSetting();
            return status.exact_alarm === 'granted' ? 'granted' : 'denied';
        },

        /** Opens the system screen where exact alarms are allowed; the answer once the user is back. */
        async openExactAlarmSettings() {
            const status = await (await load()).changeExactNotificationSetting();
            return status.exact_alarm === 'granted' ? 'granted' : 'denied';
        },

        /** The channel the reminders go to; its name is what Android's notification settings show. */
        async ensureChannel({ id, name, description }) {
            await (await load()).createChannel({ id, name, description, importance: 4, visibility: 1, vibration: true });
        },

        /** What this app has scheduled: `[{ id, at, extra }]`, `at` in ms. */
        async listScheduled() {
            const { notifications } = await (await load()).getPending();
            return notifications.map((item) => ({
                id: item.id,
                at: item.schedule?.at ? new Date(item.schedule.at).getTime() : null,
                extra: item.extra ?? null
            }));
        },

        /**
         * `notifications`: `[{ id, title, body, at, channelId, exact, extra }]`. With `exact` false the
         * plugin does not open the exact-alarm screen; Android shows the reminder within a few minutes.
         */
        async schedule(notifications) {
            if (!notifications.length) return;
            await (
                await load()
            ).schedule({
                notifications: notifications.map((item) => ({
                    id: item.id,
                    title: item.title,
                    body: item.body,
                    channelId: item.channelId,
                    schedule: { at: new Date(item.at), allowWhileIdle: true },
                    isExactNotification: item.exact,
                    autoCancel: true,
                    extra: item.extra
                }))
            });
        },

        async cancel(ids) {
            if (!ids.length) return;
            await (await load()).cancel({ notifications: ids.map((id) => ({ id })) });
        },

        /** `handler(extra)` runs when the user taps a notification (also one that started the app). Returns the function that stops it. */
        onOpen(handler) {
            let handle = null;
            let stopped = false;
            void load()
                .then((loaded) => loaded.addListener('localNotificationActionPerformed', (event) => handler(event?.notification?.extra ?? null)))
                .then((result) => {
                    handle = result;
                    if (stopped) handle.remove().catch(ignore);
                })
                .catch(ignore);
            return () => {
                stopped = true;
                handle?.remove().catch(ignore);
            };
        }
    };
}
