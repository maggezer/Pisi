// Task reminders as notifications on the phone. When a reminder comes is the
// desktop's rule (shared/reminder-schedule.mjs): the task's `reminderAt`, or
// its `reminderMode` from the due day at the default time set here. Android
// shows a scheduled notification at its minute also while the app is closed,
// so the scheduler hands it the reminders still to come, soonest first, each
// time the tasks change (here or through sync), the app comes back to the
// front or a setting changes. Nothing is written to the project: what is
// scheduled lives in the system, the settings in preferences.
//
// Each task has one notification id (from its id), so a new instant replaces
// the old one; a reminder that is no longer wanted is cancelled, one already
// shown stays in the shade. The desktop keeps its own reminders, so a task
// reminds on both devices.

import { listPisiUpcomingReminders } from '../../../shared/reminder-schedule.mjs';

export const PISI_REMINDER_CHANNEL = 'pisi-reminders';
// Android keeps at most 500 alarms per app; the nearest ones are enough, the rest follow as time passes.
export const PISI_REMINDER_SCHEDULE_LIMIT = 50;
const DEBOUNCE_MS = 300;

/** A stable notification id for a task: a positive 31-bit number (FNV-1a of its id). */
export function getReminderNotificationId(taskId) {
    let hash = 0x811c9dc5;
    for (const char of String(taskId)) {
        hash ^= char.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash & 0x7fffffff || 1;
}

/**
 * The notifications for `upcoming` reminders: one per task, ids made unique
 * within the plan. `extra` carries what a tap needs (the task id) and a
 * signature that changes whenever the notification would look or fire differently.
 */
export function planReminderNotifications(upcoming, { t, exact }) {
    const used = new Set();
    return upcoming.map((reminder) => {
        let id = getReminderNotificationId(reminder.taskId);
        while (used.has(id)) id = (id + 1) & 0x7fffffff || 1;
        used.add(id);
        const title = t('reminders.notificationTitle');
        const body = reminder.title.trim() || t('reminders.untitled');
        return {
            id,
            title,
            body,
            at: reminder.time,
            channelId: PISI_REMINDER_CHANNEL,
            exact,
            extra: { pisi: 'reminder', key: reminder.key, taskId: reminder.taskId, sig: [reminder.key, exact ? 'exact' : 'inexact', title, body].join('\n') }
        };
    });
}

/**
 * `notifier` is platform/notifications.mjs (or the memory notifier; null: no
 * notifications here), `tasks` the task controller, `preferences` the app's
 * preferences, `getT()` the current translator.
 */
export function createReminderScheduler({ notifier, tasks, preferences, getT, now = () => new Date(), setTimer, clearTimer, onError = () => {} }) {
    const listeners = new Set();
    let status = Object.freeze({
        available: Boolean(notifier),
        enabled: preferences.getRemindersEnabled(),
        defaultTime: preferences.getReminderTime(),
        permission: null,
        exact: null,
        count: 0,
        next: null
    });
    let timer = null;
    let chain = Promise.resolve();
    let destroyed = false;

    function setStatus(patch) {
        status = Object.freeze({ ...status, ...patch });
        for (const listener of listeners) listener(status);
    }

    async function run() {
        if (!notifier || destroyed) return;
        const at = now().getTime();
        const enabled = preferences.getRemindersEnabled();
        const defaultTime = preferences.getReminderTime();
        const upcoming =
            enabled && tasks.isLoaded() ? listPisiUpcomingReminders(tasks.getTasks(), { now: at, defaultTime, limit: PISI_REMINDER_SCHEDULE_LIMIT }) : [];
        let permission = await notifier.permission();
        // The first time there is something to remind of, Android is asked once; after that only from Settings.
        if (upcoming.length && permission === 'prompt' && !preferences.wasReminderPermissionAsked()) {
            preferences.markReminderPermissionAsked();
            permission = await notifier.requestPermission();
        }
        const granted = permission === 'granted';
        const exact = granted ? await notifier.exactAlarm() : null;
        const t = getT();
        const wanted = new Map(planReminderNotifications(granted ? upcoming : [], { t, exact: exact === 'granted' }).map((item) => [item.id, item]));
        if (wanted.size)
            await notifier.ensureChannel({ id: PISI_REMINDER_CHANNEL, name: t('reminders.channelName'), description: t('reminders.channelDescription') });

        const ours = (await notifier.listScheduled()).filter((item) => item.extra?.pisi === 'reminder');
        const current = new Map(ours.map((item) => [item.id, item]));
        // Only what is still to come is cancelled; a notification that has been shown stays in the shade.
        await notifier.cancel(ours.filter((item) => !wanted.has(item.id) && item.at !== null && item.at > at).map((item) => item.id));
        await notifier.schedule([...wanted.values()].filter((item) => current.get(item.id)?.extra?.sig !== item.extra.sig));

        const first = [...wanted.values()][0] ?? null;
        setStatus({ enabled, defaultTime, permission, exact, count: wanted.size, next: first ? first.at : null });
    }

    /** Plans again a moment later; several changes in a row make one plan. */
    function refresh() {
        if (!notifier || destroyed) return;
        if (timer !== null) clearTimer(timer);
        timer = setTimer(() => {
            timer = null;
            chain = chain.then(run).catch(onError);
        }, DEBOUNCE_MS);
    }

    /** Plans now, after the plans already waiting. */
    function runNow() {
        if (timer !== null) clearTimer(timer);
        timer = null;
        chain = chain.then(run).catch(onError);
        return chain;
    }

    async function requestPermission() {
        if (!notifier) return;
        preferences.markReminderPermissionAsked();
        try {
            setStatus({ permission: await notifier.requestPermission() });
        } catch (error) {
            onError(error);
        }
        await runNow();
    }

    const stopTasks = tasks.subscribe(refresh);

    return {
        getStatus: () => status,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        refresh,
        /** Resolves when the plans asked for so far are done. */
        settled: () => (timer !== null ? runNow() : chain),

        setEnabled(enabled) {
            preferences.setRemindersEnabled(enabled);
            setStatus({ enabled });
            // Turning reminders on is the user's answer; Android may ask for the permission right away.
            if (enabled && status.permission === 'prompt') return requestPermission();
            return runNow();
        },
        setDefaultTime(time) {
            preferences.setReminderTime(time);
            setStatus({ defaultTime: preferences.getReminderTime() });
            return runNow();
        },
        requestPermission,
        async openExactAlarmSettings() {
            if (!notifier) return;
            try {
                setStatus({ exact: await notifier.openExactAlarmSettings() });
            } catch (error) {
                onError(error);
            }
            await runNow();
        },
        /** `handler(taskId)` runs when the user taps a reminder. Returns the function that stops it. */
        onOpen(handler) {
            if (!notifier) return () => {};
            return notifier.onOpen((extra) => {
                if (extra?.pisi === 'reminder' && extra.taskId) handler(String(extra.taskId));
            });
        },
        destroy() {
            destroyed = true;
            if (timer !== null) clearTimer(timer);
            timer = null;
            stopTasks();
            listeners.clear();
        }
    };
}
