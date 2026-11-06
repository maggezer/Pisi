import {
    PISI_REMINDER_SNOOZE_MINUTES,
    dismissPisiReminders,
    getPisiReminderDelay,
    isPisiReminderStateEqual,
    listPisiPendingReminders,
    markPisiRemindersShown,
    normalizePisiReminderState,
    planPisiReminders,
    prunePisiReminderState,
    snoozePisiReminder
} from './reminder-schedule-core.js';

// The reminder service runs in the main process. Every dependency on Electron,
// the filesystem and the clock is injected, so the same code runs in the app
// (main/functions/reminder-service.js) and in tests with stubs.
//
// One timer: after each pass it sleeps until the next reminder, capped at
// PISI_REMINDER_MAX_WAIT_MS. Task writes, project changes, settings changes
// and power resume/unlock trigger an immediate pass.

const PISI_REMINDER_SUMMARY_THRESHOLD = 3;
// A reminder that came due more than a minute before the project was opened
// was missed while Pisi was not running.
const PISI_REMINDER_MISSED_GRACE_MS = 60 * 1000;

/**
 * @param {{
 *   Notification?: any,
 *   powerMonitor?: { on: Function, removeListener?: Function },
 *   platform?: string,
 *   now?: () => number,
 *   setTimeout?: Function,
 *   clearTimeout?: Function,
 *   getProjectFolder: () => string | null,
 *   readTasks: (projectFolder: string) => any[],
 *   readState: (projectFolder: string) => { ok: boolean, data?: any, missing?: boolean, error?: string },
 *   writeState: (projectFolder: string, state: any) => { ok: boolean, error?: string },
 *   getSettings?: () => { defaultTime?: string },
 *   showWindow?: () => void,
 *   sendToRenderer?: (payload: any) => void,
 *   translate?: (text: string) => string,
 *   capture?: ((record: any) => void) | null,
 *   iconPath?: string | null,
 *   log?: (message: string, error?: any) => void
 * }} deps
 */
function createPisiReminderService(deps) {
    const now = deps.now || (() => Date.now());
    const schedule = deps.setTimeout || setTimeout;
    const cancel = deps.clearTimeout || clearTimeout;
    const translate = deps.translate || ((text) => text);
    const log = deps.log || ((message, error) => console.warn('[PISI]', message, error || ''));
    const live = new Set();
    const captured = [];
    const service = {
        timer: null,
        nextAt: null,
        projectFolder: null,
        openedAt: null,
        memoryState: null,
        started: false
    };

    function onPowerChange() {
        reschedule('power');
    }

    function readState(projectFolder) {
        const result = deps.readState(projectFolder);
        if (result?.ok) {
            service.memoryState = null;
            return { state: normalizePisiReminderState(result.data), writable: true };
        }
        if (result?.missing) return { state: normalizePisiReminderState(null), writable: true };
        // A corrupt state file is never replaced with an empty one. Reminders
        // still show; their state is kept in memory until the file is fixed.
        log('Hatırlatma durumu okunamadı; dosya değiştirilmeyecek.', result?.error);
        return { state: normalizePisiReminderState(service.memoryState), writable: false };
    }

    function saveState(projectFolder, previous, next, writable) {
        if (isPisiReminderStateEqual(previous, next)) return;
        if (!writable) {
            service.memoryState = next;
            return;
        }
        const written = deps.writeState(projectFolder, next);
        if (!written?.ok) {
            service.memoryState = next;
            log('Hatırlatma durumu yazılamadı.', written?.error);
        }
    }

    function getSettings() {
        return deps.getSettings?.() || {};
    }

    function send(payload) {
        try {
            deps.sendToRenderer?.(payload);
        } catch (error) {
            log('Hatırlatma olayı gönderilemedi.', error);
        }
    }

    function activate(target) {
        deps.showWindow?.();
        if (target.kind === 'summary') send({ type: 'show-pending' });
        else send({ type: 'open', key: target.key, taskId: target.taskId, nodePath: target.nodePath, blockId: target.blockId });
    }

    function showNotification(target) {
        const supportsActions = deps.platform === 'darwin' && target.kind === 'entry';
        const actions = supportsActions
            ? [
                  { type: 'button', text: translate('10 dk ertele') },
                  { type: 'button', text: translate('Tamamlandı') }
              ]
            : [];
        const record = {
            kind: target.kind,
            title: target.title,
            body: target.body,
            key: target.key || null,
            taskId: target.taskId || null,
            actions: actions.length
        };
        if (deps.capture) {
            captured.push({ record, target });
            deps.capture(record);
            return record;
        }
        const Notification = deps.Notification;
        if (!Notification || (typeof Notification.isSupported === 'function' && !Notification.isSupported())) return null;
        const notification = new Notification({ title: target.title, body: target.body, icon: deps.iconPath || undefined, actions });
        live.add(notification);
        notification.on('click', () => {
            live.delete(notification);
            activate(target);
        });
        notification.on('action', (_event, index) => {
            live.delete(notification);
            if (index === 0) snooze(target.key);
            if (index === 1) complete(target.key);
        });
        notification.on('close', () => live.delete(notification));
        notification.show();
        return record;
    }

    function notify(entries) {
        const missed = entries.filter((entry) => entry.missed);
        const fresh = entries.filter((entry) => !entry.missed);
        const title = translate('Pisi görev hatırlatması');
        if (missed.length) {
            showNotification({ kind: 'summary', title, body: translate('{count} hatırlatma kaçırıldı').replace('{count}', String(missed.length)) });
        }
        if (fresh.length > PISI_REMINDER_SUMMARY_THRESHOLD) {
            showNotification({ kind: 'summary', title, body: translate('{count} hatırlatmanın zamanı geldi').replace('{count}', String(fresh.length)) });
            return;
        }
        for (const entry of fresh) {
            showNotification({ ...entry, kind: 'entry', title, body: entry.title || translate('Adsız görev') });
        }
    }

    function clearTimer() {
        if (service.timer !== null) cancel(service.timer);
        service.timer = null;
        service.nextAt = null;
    }

    function pass() {
        clearTimer();
        const projectFolder = deps.getProjectFolder();
        if (!projectFolder) {
            service.projectFolder = null;
            return { ok: true, idle: true };
        }
        if (projectFolder !== service.projectFolder) {
            service.projectFolder = projectFolder;
            service.openedAt = now();
            service.memoryState = null;
        }
        const time = now();
        let tasks = [];
        try {
            tasks = deps.readTasks(projectFolder) || [];
        } catch (error) {
            // tasks.json is unreadable: try again on the next wake.
            log('Görevler okunamadı; hatırlatmalar sonra yeniden denenecek.', error);
            service.timer = schedule(pass, getPisiReminderDelay(null, time));
            return { ok: false };
        }
        const settings = getSettings();
        const { state: stored, writable } = readState(projectFolder);
        let state = prunePisiReminderState(stored, tasks, settings);
        const plan = planPisiReminders(tasks, state, {
            now: time,
            defaultTime: settings.defaultTime,
            missedBefore: service.openedAt - PISI_REMINDER_MISSED_GRACE_MS
        });
        if (plan.due.length) state = markPisiRemindersShown(state, plan.due, time);
        saveState(projectFolder, stored, state, writable);
        if (plan.due.length) {
            notify(plan.due);
            send({ type: 'pending', entries: listPisiPendingReminders(state) });
        }
        service.nextAt = plan.nextAt;
        service.timer = schedule(pass, getPisiReminderDelay(plan.nextAt, time));
        return { ok: true, due: plan.due, nextAt: plan.nextAt };
    }

    function reschedule(_reason = 'change') {
        try {
            return pass();
        } catch (error) {
            log('Hatırlatmalar planlanamadı.', error);
            clearTimer();
            service.timer = schedule(pass, getPisiReminderDelay(null, now()));
            return { ok: false, error: error?.message || String(error) };
        }
    }

    function updateState(mutate) {
        const projectFolder = deps.getProjectFolder();
        if (!projectFolder) return { ok: false, code: 'NO_PROJECT' };
        const { state, writable } = readState(projectFolder);
        const next = mutate(state);
        saveState(projectFolder, state, next, writable);
        send({ type: 'pending', entries: listPisiPendingReminders(next) });
        reschedule('state');
        return { ok: true, entries: listPisiPendingReminders(next) };
    }

    function snooze(key, minutes = PISI_REMINDER_SNOOZE_MINUTES) {
        if (!key) return { ok: false, code: 'REMINDER_KEY_REQUIRED' };
        return updateState((state) => snoozePisiReminder(state, String(key), now(), minutes));
    }

    function dismiss(keys = []) {
        return updateState((state) => dismissPisiReminders(state, (Array.isArray(keys) ? keys : [keys]).map(String)));
    }

    /** Completion runs in the renderer so the task's note markup is updated too. */
    function complete(key) {
        if (!key) return { ok: false, code: 'REMINDER_KEY_REQUIRED' };
        const taskId = String(key).split('@')[0];
        deps.showWindow?.();
        send({ type: 'complete', key: String(key), taskId });
        return dismiss([key]);
    }

    function listPending() {
        const projectFolder = deps.getProjectFolder();
        if (!projectFolder) return { ok: true, entries: [] };
        return { ok: true, entries: listPisiPendingReminders(readState(projectFolder).state) };
    }

    function start() {
        if (!service.started) {
            service.started = true;
            deps.powerMonitor?.on?.('resume', onPowerChange);
            deps.powerMonitor?.on?.('unlock-screen', onPowerChange);
        }
        return reschedule('start');
    }

    function stop() {
        clearTimer();
        if (service.started) {
            deps.powerMonitor?.removeListener?.('resume', onPowerChange);
            deps.powerMonitor?.removeListener?.('unlock-screen', onPowerChange);
        }
        service.started = false;
    }

    /** Test-only: behaves as if the user clicked the n-th captured notification. */
    function activateCaptured(index = captured.length - 1) {
        const item = captured[index];
        if (!item) return { ok: false, code: 'NOT_FOUND' };
        activate(item.target);
        return { ok: true, record: item.record };
    }

    return {
        start,
        stop,
        reschedule,
        snooze,
        dismiss,
        complete,
        listPending,
        activateCaptured,
        getNextAt: () => service.nextAt,
        hasTimer: () => service.timer !== null,
        liveNotificationCount: () => live.size
    };
}

export { PISI_REMINDER_SUMMARY_THRESHOLD, PISI_REMINDER_MISSED_GRACE_MS, createPisiReminderService };
