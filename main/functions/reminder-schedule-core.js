// Pure reminder rules shared by the main-process reminder service and its
// tests. No Electron, no filesystem.
//
// When a reminder comes is decided in shared/reminder-schedule.mjs, which the
// phone uses too; this file keeps the desktop's own part: the single timer and
// the presentation state (shown, pending, snoozed) in .pisi/reminder-state.json.

import {
    PISI_REMINDER_DEFAULT_TIME,
    PISI_REMINDER_RELATIVE_DAYS,
    getPisiReminderKey,
    getPisiTaskReminderTime,
    normalizePisiReminderTimeOfDay,
    parsePisiLocalDateTime
} from '../../shared/reminder-schedule.mjs';

const PISI_REMINDER_STATE_VERSION = 1;
const PISI_REMINDER_SNOOZE_MINUTES = 10;
// The single timer never waits longer than this, so a changed system clock or
// a long sleep is picked up on the next wake and setTimeout's 24.8-day limit is
// never reached.
const PISI_REMINDER_MAX_WAIT_MS = 15 * 60 * 1000;

function normalizePisiReminderEntry(value) {
    if (!value || typeof value !== 'object') return null;
    const time = Number(value.time);
    if (!value.key || !value.taskId || !Number.isFinite(time)) return null;
    return {
        key: String(value.key),
        taskId: String(value.taskId),
        time,
        title: String(value.title || ''),
        noteId: value.noteId ? String(value.noteId) : null,
        diaryDate: value.diaryDate ? String(value.diaryDate) : null,
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
        // Where the task lives (docs/task-plan.md §3.1): the renderer opens that note or diary.
        noteId: typeof task.noteId === 'string' ? task.noteId : null,
        diaryDate: typeof task.diaryDate === 'string' ? task.diaryDate : null,
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
