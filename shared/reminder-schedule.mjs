// When a task's reminder comes (docs/single-source-of-truth.md "Reminders").
// The desktop's reminder service (main/functions/reminder-schedule-core.js)
// and the phone's notifications (mobile/src/app/reminders.mjs) both use these
// rules, so a task reminds at the same minute on every device.
//
// One model: every reminder resolves to a single instant.
// - An explicit task.reminderAt ("YYYY-MM-DDTHH:MM", local time) wins.
// - Otherwise a relative reminderMode (due-morning, day-before,
//   three-days-before) is derived from task.dueDate at the user's default
//   reminder time. It is derived on every plan, never written back, so a new
//   due date or default time moves the reminder without stale data.
// The caller passes the clock (`now`); nothing here reads it.

export const PISI_REMINDER_DEFAULT_TIME = '09:00';
export const PISI_REMINDER_RELATIVE_DAYS = Object.freeze({ 'due-morning': 0, 'day-before': 1, 'three-days-before': 3 });

export function normalizePisiReminderTimeOfDay(value) {
    const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? `${match[1]}:${match[2]}` : PISI_REMINDER_DEFAULT_TIME;
}

export function parsePisiLocalDateTime(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), 0, 0);
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    return date;
}

export function isPisiReminderTaskOpen(task) {
    return Boolean(task && typeof task === 'object' && task.status !== 'done' && !task.completedAt && task.completed !== true);
}

/**
 * Returns the reminder instant (ms since epoch) of a canonical task, or null.
 * @param {any} task
 * @param {{ defaultTime?: string }} [options]
 */
export function getPisiTaskReminderTime(task, options = {}) {
    if (!isPisiReminderTaskOpen(task)) return null;
    const explicit = parsePisiLocalDateTime(task.reminderAt);
    if (explicit && /T/.test(String(task.reminderAt))) return explicit.getTime();
    const offset = PISI_REMINDER_RELATIVE_DAYS[String(task.reminderMode || '').toLowerCase()];
    if (offset === undefined) return null;
    const due = parsePisiLocalDateTime(String(task.dueDate || '').slice(0, 10));
    if (!due) return null;
    const [hours, minutes] = normalizePisiReminderTimeOfDay(options.defaultTime).split(':').map(Number);
    // Calendar arithmetic in local time keeps the wall-clock hour across DST changes.
    return new Date(due.getFullYear(), due.getMonth(), due.getDate() - offset, hours, minutes, 0, 0).getTime();
}

/** One reminder of one task: the task id and the instant. A new instant is a new reminder. */
export function getPisiReminderKey(taskId, time) {
    return `${taskId}@${new Date(time).toISOString()}`;
}

/**
 * The reminders still to come, soonest first: `[{ key, taskId, time, title }]`
 * for every open task whose instant is after `now`, at most `limit` of them.
 * A device that schedules its notifications ahead (the phone) takes these.
 * @param {any[]} tasks
 * @param {{ now: number, defaultTime?: string, limit?: number }} options
 */
export function listPisiUpcomingReminders(tasks, options) {
    const now = Number(options.now);
    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : Infinity;
    const upcoming = [];
    for (const task of Array.isArray(tasks) ? tasks : []) {
        if (!task?.id) continue;
        const time = getPisiTaskReminderTime(task, options);
        if (time === null || !(time > now)) continue;
        upcoming.push({ key: getPisiReminderKey(task.id, time), taskId: String(task.id), time, title: String(task.title || '') });
    }
    upcoming.sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
    return upcoming.slice(0, limit);
}
