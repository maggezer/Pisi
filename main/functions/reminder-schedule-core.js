// Pure reminder rules shared by the main-process reminder service and its
// tests. No Electron, no filesystem.
//
// One model: every reminder resolves to a single instant.
// - An explicit task.reminderAt ("YYYY-MM-DDTHH:MM", local time) wins.
// - Otherwise a relative reminderMode (due-morning, day-before,
//   three-days-before) is derived from task.dueDate at the user's default
//   reminder time. It is derived on every plan, never written back, so a new
//   due date or default time moves the reminder without stale data.
// Presentation state (shown, pending, snoozed) lives in .pisi/reminder-state.json.

const PISI_REMINDER_STATE_VERSION = 1;
const PISI_REMINDER_DEFAULT_TIME = '09:00';
const PISI_REMINDER_SNOOZE_MINUTES = 10;
// The single timer never waits longer than this, so a changed system clock or
// a long sleep is picked up on the next wake and setTimeout's 24.8-day limit is
// never reached.
const PISI_REMINDER_MAX_WAIT_MS = 15 * 60 * 1000;
const PISI_REMINDER_RELATIVE_DAYS = Object.freeze({ 'due-morning': 0, 'day-before': 1, 'three-days-before': 3 });

function normalizePisiReminderTimeOfDay(value) {
    const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? `${match[1]}:${match[2]}` : PISI_REMINDER_DEFAULT_TIME;
}

function parsePisiLocalDateTime(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), 0, 0);
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    return date;
}

function isPisiReminderTaskOpen(task) {
    return Boolean(task && typeof task === 'object' && task.status !== 'done' && !task.completedAt && task.completed !== true);
}

/**
 * Returns the reminder instant (ms since epoch) of a canonical task, or null.
 * @param {any} task
 * @param {{ defaultTime?: string }} [options]
 */
function getPisiTaskReminderTime(task, options = {}) {
    if (!isPisiReminderTaskOpen(task)) return null;
    const explicit = parsePisiLocalDateTime(task.reminderAt);
    if (explicit && /T/.test(String(task.reminderAt))) return explicit.getTime();
    const offset = PISI_REMINDER_RELATIVE_DAYS[String(task.reminderMode || '').toLowerCase()];
    if (offset === undefined) return null;
    const due = parsePisiLocalDateTime(String(task.dueDate || task.deadline || '').slice(0, 10));
    if (!due) return null;
    const [hours, minutes] = normalizePisiReminderTimeOfDay(options.defaultTime).split(':').map(Number);
    // Calendar arithmetic in local time keeps the wall-clock hour across DST changes.
    return new Date(due.getFullYear(), due.getMonth(), due.getDate() - offset, hours, minutes, 0, 0).getTime();
}

function getPisiReminderKey(taskId, time) {
    return `${taskId}@${new Date(time).toISOString()}`;
}

function normalizePisiReminderEntry(value) {
    if (!value || typeof value !== 'object') return null;
    const time = Number(value.time);
    if (!value.key || !value.taskId || !Number.isFinite(time)) return null;
    return {
        key: String(value.key),
        taskId: String(value.taskId),
        time,
        title: String(value.title || ''),
        nodePath: value.nodePath ? String(value.nodePath) : null,
        blockId: value.blockId ? String(value.blockId) : null,
        missed: value.missed === true
    };
}

function normalizePisiReminderState(raw) {
    const state = { version: PISI_REMINDER_STATE_VERSION, shown: {}, pending: {}, snoozed: {} };
    if (!raw || typeof raw !== 'object') return state;
    for (const [key, at] of Object.entries(raw.shown || {})) {
        if (typeof key === 'string' && key.includes('@')) state.shown[key] = String(at || '');
    }
    for (const [key, entry] of Object.entries(raw.pending || {})) {
        const normalized = normalizePisiReminderEntry(entry);
        if (normalized && normalized.key === key) state.pending[key] = normalized;
    }
    for (const [taskId, snooze] of Object.entries(raw.snoozed || {})) {
        const until = Number(snooze?.until);
        if (snooze?.key && Number.isFinite(until)) state.snoozed[taskId] = { key: String(snooze.key), until };
    }
    return state;
}

function makePisiReminderEntry(task, time, key) {
    return {
        key,
        taskId: String(task.id),
        time,
        title: String(task.title || ''),
        nodePath: task.source?.nodePath || null,
        blockId: task.source?.blockId || null,
        missed: false
    };
}

/**
 * Plans reminders for one project.
 * - due: open reminders whose instant (or snooze end) has passed and that were
 *   never shown, oldest first. Those older than `missedBefore` are flagged
 *   missed: they came due while Pisi was not running.
 * - nextAt: the earliest future instant, or null.
 * @param {any[]} tasks
 * @param {any} state
 * @param {{ now: number, defaultTime?: string, missedBefore?: number | null }} options
 */
function planPisiReminders(tasks, state, options) {
    const now = Number(options.now);
    const normalized = normalizePisiReminderState(state);
    const due = [];
    let nextAt = null;
    for (const task of Array.isArray(tasks) ? tasks : []) {
        if (!task?.id) continue;
        const time = getPisiTaskReminderTime(task, options);
        if (time === null) continue;
        const key = getPisiReminderKey(task.id, time);
        if (normalized.shown[key]) continue;
        const snooze = normalized.snoozed[task.id];
        const fireAt = snooze && snooze.key === key ? snooze.until : time;
        if (fireAt > now) {
            if (nextAt === null || fireAt < nextAt) nextAt = fireAt;
            continue;
        }
        const entry = makePisiReminderEntry(task, time, key);
        entry.missed = !snooze && Number.isFinite(options.missedBefore) && time < options.missedBefore;
        due.push(entry);
    }
    due.sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
    return { due, nextAt };
}

function getPisiReminderDelay(nextAt, now) {
    if (nextAt === null || !Number.isFinite(nextAt)) return PISI_REMINDER_MAX_WAIT_MS;
    return Math.max(0, Math.min(PISI_REMINDER_MAX_WAIT_MS, nextAt - now));
}

/** Records entries as shown and pending (awaiting the user's acknowledgement). */
function markPisiRemindersShown(state, entries, now) {
    const next = normalizePisiReminderState(state);
    const at = new Date(now).toISOString();
    for (const entry of entries) {
        next.shown[entry.key] = at;
        next.pending[entry.key] = { ...entry };
        if (next.snoozed[entry.taskId]?.key === entry.key) delete next.snoozed[entry.taskId];
    }
    return next;
}

function snoozePisiReminder(state, key, now, minutes = PISI_REMINDER_SNOOZE_MINUTES) {
    const next = normalizePisiReminderState(state);
    const entry = next.pending[key];
    const taskId = entry?.taskId || String(key).split('@')[0];
    delete next.pending[key];
    delete next.shown[key];
    next.snoozed[taskId] = { key, until: now + Math.max(1, Number(minutes) || PISI_REMINDER_SNOOZE_MINUTES) * 60 * 1000 };
    return next;
}

function dismissPisiReminders(state, keys = []) {
    const next = normalizePisiReminderState(state);
    for (const key of keys) delete next.pending[key];
    return next;
}

/**
 * Drops records of deleted tasks, pending entries of finished tasks, shown keys
 * that no longer match the task's current instant, and stale snoozes.
 */
function prunePisiReminderState(state, tasks, options = {}) {
    const next = normalizePisiReminderState(state);
    const currentKeys = new Map();
    for (const task of Array.isArray(tasks) ? tasks : []) {
        if (!task?.id) continue;
        const time = getPisiTaskReminderTime(task, options);
        currentKeys.set(String(task.id), time === null ? null : getPisiReminderKey(task.id, time));
    }
    for (const key of Object.keys(next.shown)) {
        if (currentKeys.get(key.split('@')[0]) !== key) delete next.shown[key];
    }
    for (const [key, entry] of Object.entries(next.pending)) {
        if (currentKeys.get(entry.taskId) !== key) delete next.pending[key];
    }
    for (const [taskId, snooze] of Object.entries(next.snoozed)) {
        if (currentKeys.get(taskId) !== snooze.key) delete next.snoozed[taskId];
    }
    return next;
}

function listPisiPendingReminders(state) {
    return Object.values(normalizePisiReminderState(state).pending).sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
}

function isPisiReminderStateEqual(a, b) {
    return JSON.stringify(normalizePisiReminderState(a)) === JSON.stringify(normalizePisiReminderState(b));
}

export {
    PISI_REMINDER_STATE_VERSION,
    PISI_REMINDER_DEFAULT_TIME,
    PISI_REMINDER_SNOOZE_MINUTES,
    PISI_REMINDER_MAX_WAIT_MS,
    PISI_REMINDER_RELATIVE_DAYS,
    normalizePisiReminderTimeOfDay,
    parsePisiLocalDateTime,
    getPisiTaskReminderTime,
    getPisiReminderKey,
    normalizePisiReminderState,
    planPisiReminders,
    getPisiReminderDelay,
    markPisiRemindersShown,
    snoozePisiReminder,
    dismissPisiReminders,
    prunePisiReminderState,
    listPisiPendingReminders,
    isPisiReminderStateEqual
};
