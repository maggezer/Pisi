// Task rules shared by desktop and mobile: the todo tag grammar
// (todo.<1-5>.<DD-MM-YYYY|none>), priority, status and repeat values, the next
// date of a repeating task, and the canonical .pisi/tasks.json record.
// Option labels are the desktop's source strings; mobile uses only `value`.

import { formatPisiTaskId, isPisiTaskId, normalizePisiTaskId } from './ids.mjs';

export const PISI_TODO_PRIORITY_OPTIONS = Object.freeze([
    Object.freeze({ value: 1, label: 'very low' }),
    Object.freeze({ value: 2, label: 'low' }),
    Object.freeze({ value: 3, label: 'medium' }),
    Object.freeze({ value: 4, label: 'high' }),
    Object.freeze({ value: 5, label: 'very high' })
]);

export const PISI_TODO_STATUS_OPTIONS = Object.freeze([
    Object.freeze({ value: 'todo', label: 'Yapılacak' }),
    Object.freeze({ value: 'doing', label: 'Devam ediyor' }),
    Object.freeze({ value: 'waiting', label: 'Beklemede' }),
    Object.freeze({ value: 'blocked', label: 'Engellendi' })
]);

export const PISI_TODO_REPEAT_OPTIONS = Object.freeze([
    Object.freeze({ value: 'none', label: 'Tekrarlama yok' }),
    Object.freeze({ value: 'daily', label: 'Her gün' }),
    Object.freeze({ value: 'weekdays', label: 'Hafta içi' }),
    Object.freeze({ value: 'weekly', label: 'Her hafta' }),
    Object.freeze({ value: 'biweekly', label: 'İki haftada bir' }),
    Object.freeze({ value: 'after-completion', label: 'Tamamlandıktan sonra' }),
    Object.freeze({ value: 'monthly', label: 'Her ay' })
]);

export function getPisiTodoPriorityOption(value) {
    const priority = Number(value);
    return PISI_TODO_PRIORITY_OPTIONS.find((item) => item.value === priority) || null;
}

export function getPisiTodoStatusOption(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return PISI_TODO_STATUS_OPTIONS.find((item) => item.value === normalized) || PISI_TODO_STATUS_OPTIONS[0];
}

export function getPisiTodoRepeatOption(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return PISI_TODO_REPEAT_OPTIONS.find((item) => item.value === normalized) || PISI_TODO_REPEAT_OPTIONS[0];
}

export function normalizePisiTodoTagValue(value) {
    return String(value || '')
        .trim()
        .replace(/^(?:\.\.|\/|#)/, '')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '')
        .toLowerCase();
}

function parsePisiTodoIsoDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }

    date.setHours(0, 0, 0, 0);
    return date;
}

export function getPisiTodayIsoDate(now = new Date()) {
    const date = new Date(now);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function formatPisiTodoTag(priorityValue, isoDate) {
    const priority = Number(priorityValue);
    const priorityOption = getPisiTodoPriorityOption(priority);

    if (!priorityOption) return null;

    const normalizedDate = String(isoDate ?? '')
        .trim()
        .toLowerCase();
    if (!normalizedDate || normalizedDate === 'none' || normalizedDate === 'undated') {
        return `todo.${priority}.none`;
    }

    const date = parsePisiTodoIsoDate(normalizedDate);
    if (!date) return null;

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());

    return `todo.${priority}.${day}-${month}-${year}`;
}

export function getNextPisiTodoDate(finishDate, repeatValue, now = new Date(), completionOffsetDays = 1) {
    const repeat = getPisiTodoRepeatOption(repeatValue).value;
    if (repeat === 'none') return null;

    const base = finishDate instanceof Date && !Number.isNaN(finishDate.getTime()) ? new Date(finishDate) : new Date(now);
    base.setHours(0, 0, 0, 0);

    if (repeat === 'daily') {
        base.setDate(base.getDate() + 1);
        return base;
    }

    if (repeat === 'weekdays') {
        do {
            base.setDate(base.getDate() + 1);
        } while (base.getDay() === 0 || base.getDay() === 6);
        return base;
    }

    if (repeat === 'weekly') {
        base.setDate(base.getDate() + 7);
        return base;
    }

    if (repeat === 'biweekly') {
        base.setDate(base.getDate() + 14);
        return base;
    }

    if (repeat === 'after-completion') {
        const completionBase = new Date(now);
        completionBase.setHours(0, 0, 0, 0);
        completionBase.setDate(completionBase.getDate() + Math.max(1, Number(completionOffsetDays) || 1));
        return completionBase;
    }

    if (repeat === 'monthly') {
        const day = base.getDate();
        const targetYear = base.getMonth() === 11 ? base.getFullYear() + 1 : base.getFullYear();
        const targetMonth = (base.getMonth() + 1) % 12;
        const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
        return new Date(targetYear, targetMonth, Math.min(day, lastDay));
    }

    return null;
}

export const PISI_TASK_STATUSES = new Set(['todo', 'doing', 'waiting', 'blocked', 'done']);
export const PISI_TASK_REPEATS = new Set(['none', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'after-completion']);

export function normalizePisiFirstClassTaskIso(value, allowTime = true) {
    const raw = String(value || '').trim();
    const expression = allowTime ? /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/ : /^(\d{4})-(\d{2})-(\d{2})$/;
    const match = raw.match(expression);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0));
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    return raw;
}

export function normalizePisiFirstClassTaskStatus(value, completed = false) {
    if (completed === true) return 'done';
    const status = String(value || 'todo')
        .trim()
        .toLowerCase();
    return PISI_TASK_STATUSES.has(status) ? status : 'todo';
}

export function normalizePisiFirstClassTaskRepeat(value) {
    const repeat = String(value || 'none')
        .trim()
        .toLowerCase();
    return PISI_TASK_REPEATS.has(repeat) ? repeat : 'none';
}

export function normalizePisiFirstClassDependencies(value, taskId) {
    return Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter((item) => isPisiTaskId(item)))).filter(
        (item) => item !== taskId
    );
}

export function parsePisiTaskPriority(todoTag, fallback = 3) {
    const match = String(todoTag || '').match(/^todo\.([1-5])\./i);
    return match ? Number(match[1]) : Math.max(1, Math.min(5, Number(fallback) || 3));
}

export function parsePisiTaskDueDateFromTag(todoTag) {
    const match = String(todoTag || '').match(/^todo\.[1-5]\.(\d{2})-(\d{2})-(\d{4})$/i);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/**
 * Source reference of a task. `normalizeStoredPath` turns a note or map path
 * into the project-relative form that is stored (or null), and throws when the
 * path points outside the project.
 */
export function normalizePisiTaskSource(source = {}, fallback = {}, normalizeStoredPath) {
    const nodePath = source.nodePath || fallback.nodePath || null;
    const mapPath = source.mapPath || fallback.mapPath || null;
    return {
        nodePath: normalizeStoredPath(nodePath),
        blockId: String(source.blockId || fallback.blockId || '').trim() || null,
        mapPath: normalizeStoredPath(mapPath),
        nodeTitle: String(source.nodeTitle || fallback.nodeTitle || '').trim(),
        mapTitle: String(source.mapTitle || fallback.mapTitle || '').trim()
    };
}

/**
 * The canonical tasks.json record for `payload`, merged over `existing` (the
 * stored record it replaces, or null). What is not a pure rule comes from the
 * caller: `now` (a Date), `makeUuid` (called only when a new id is needed)
 * and `normalizeStoredPath` (see normalizePisiTaskSource).
 */
export function normalizePisiTaskRecord(payload = {}, existing = null, { now, makeUuid, normalizeStoredPath }) {
    const nowIso = now.toISOString();
    const id = existing?.id || normalizePisiTaskId(payload.id) || formatPisiTaskId(makeUuid());
    const priority = Math.max(1, Math.min(5, Number(payload.priority ?? existing?.priority ?? 3) || 3));
    const status = normalizePisiFirstClassTaskStatus(payload.status ?? existing?.status ?? 'todo', payload.completed === true);
    const dueDate = normalizePisiFirstClassTaskIso(payload.dueDate ?? existing?.dueDate ?? '', false);
    const scheduledAt = normalizePisiFirstClassTaskIso(payload.scheduledAt ?? existing?.scheduledAt ?? '');
    const deadline = normalizePisiFirstClassTaskIso(payload.deadline ?? existing?.deadline ?? '');
    const reminderAt = normalizePisiFirstClassTaskIso(payload.reminderAt ?? existing?.reminderAt ?? '');
    const title = String(payload.title ?? payload.text ?? existing?.title ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    const repeat = normalizePisiFirstClassTaskRepeat(payload.repeat ?? existing?.repeat ?? 'none');
    const durationMinutes = Math.max(0, Math.min(1440, Number(payload.durationMinutes ?? existing?.durationMinutes ?? 0) || 0));
    const actualMinutes = Math.max(0, Math.min(100000, Number(payload.actualMinutes ?? existing?.actualMinutes ?? 0) || 0));
    const completionOffsetDays = Math.max(0, Math.min(3650, Number(payload.completionOffsetDays ?? existing?.completionOffsetDays ?? 0) || 0));
    const rawOrder = Number(payload.manualOrder ?? existing?.manualOrder ?? now.getTime());
    const manualOrder = Number.isFinite(rawOrder) ? rawOrder : now.getTime();
    const todoTag = String(payload.todoTag ?? existing?.todoTag ?? `todo.${priority}.none`)
        .trim()
        .toLowerCase();
    const reminderMode =
        String(payload.reminderMode ?? existing?.reminderMode ?? 'none')
            .trim()
            .toLowerCase() || 'none';
    const source = normalizePisiTaskSource(payload.source || {}, existing?.source || {}, normalizeStoredPath);

    return {
        id,
        title,
        status,
        priority,
        dueDate,
        scheduledAt,
        deadline,
        reminderAt,
        reminderMode,
        durationMinutes,
        actualMinutes,
        repeat,
        completionOffsetDays: completionOffsetDays || null,
        dependencies: normalizePisiFirstClassDependencies(payload.dependencies ?? existing?.dependencies ?? [], id),
        manualOrder,
        todoTag,
        source,
        createdAt: existing?.createdAt || payload.createdAt || nowIso,
        updatedAt: nowIso,
        completedAt: status === 'done' ? payload.completedAt || existing?.completedAt || nowIso : null
    };
}

// ---------------------------------------------------------------------------
// tasks.json version 2 (docs/task-plan.md §3.1). Every field of a task lives in
// the record; a note or a diary holds only the task id. Dates are calendar
// days (`YYYY-MM-DD`): day arithmetic runs on UTC timestamps, so no time zone
// or daylight saving change moves a day. Only "today" depends on the caller's
// clock (`now`, local time). The rules above for version 1 stay until G2/G8.

export const PISI_TASK_STORE_VERSION = 2;
export const PISI_TASK_REMINDER_MODES = Object.freeze(['none', 'due-morning', 'day-before', 'three-days-before']);
export const PISI_TASK_TITLE_MAX_LENGTH = 500;
export const PISI_TASK_TAG_LIMIT = 20;
export const PISI_TASK_TAG_MAX_LENGTH = 64;

// A task tag follows the note tag rule (renderer/tags/pisi-tag-editor.mjs):
// letters, digits, `_` and `-`, with `.` between levels; no leading `#`.
const TAG_CHARS = 'A-Za-z0-9ğüşöçıİĞÜŞÖÇ_-';
const TASK_TAG = new RegExp(`^[${TAG_CHARS}]+(?:\\.[${TAG_CHARS}]+)*$`);

/** One tag as stored (`#` and stray dots dropped, the note tag rule), or null when it is not a tag. */
export function normalizePisiTaskTag(value) {
    if (typeof value !== 'string') return null;
    const tag = value
        .normalize('NFC')
        .trim()
        .replace(/^#+/, '')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '');
    return tag && tag.length <= PISI_TASK_TAG_MAX_LENGTH && TASK_TAG.test(tag) ? tag : null;
}

/**
 * The tags of a task as stored (docs/task-plan.md G6): valid tags only, the
 * first spelling of a tag kept (case-insensitive, Turkish), in the given
 * order, at most PISI_TASK_TAG_LIMIT. A value that is not a list gives [].
 */
export function normalizePisiTaskTags(value) {
    if (!Array.isArray(value)) return [];
    const tags = [];
    const seen = new Set();
    for (const item of value) {
        const tag = normalizePisiTaskTag(item);
        const key = tag?.toLocaleLowerCase('tr-TR');
        if (!tag || seen.has(key)) continue;
        seen.add(key);
        tags.push(tag);
        if (tags.length === PISI_TASK_TAG_LIMIT) break;
    }
    return tags;
}

/** Whether two tags are the same tag (case-insensitive, Turkish). */
export function isSamePisiTaskTag(a, b) {
    const left = normalizePisiTaskTag(a);
    return Boolean(left) && left.toLocaleLowerCase('tr-TR') === normalizePisiTaskTag(b)?.toLocaleLowerCase('tr-TR');
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const REMINDER_AT = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;
const NOTE_ID = /^node_[A-Za-z0-9_-]{1,96}$/;
const DAY_MS = 86400000;
const MAX_REPEAT_STEPS = 100000;

/** Milliseconds (UTC midnight) of a valid `YYYY-MM-DD`, else null. */
function dayToUtc(value) {
    const match = ISO_DAY.exec(String(value ?? ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const time = Date.UTC(year, month - 1, day);
    const date = new Date(time);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return time;
}

function utcToDay(time) {
    const date = new Date(time);
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${String(date.getUTCFullYear()).padStart(4, '0')}-${month}-${day}`;
}

/** The day when it is a valid `YYYY-MM-DD`, else null. */
export function normalizePisiTaskDay(value) {
    return dayToUtc(value) === null ? null : String(value);
}

/** `day` moved by `days` calendar days. */
export function addPisiTaskDays(day, days) {
    const time = dayToUtc(day);
    return time === null ? null : utcToDay(time + Math.trunc(days) * DAY_MS);
}

/** Calendar days from `from` to `to` (negative when `to` is earlier); null when either is not a day. */
export function getPisiTaskDaysBetween(from, to) {
    const a = dayToUtc(from);
    const b = dayToUtc(to);
    return a === null || b === null ? null : Math.round((b - a) / DAY_MS);
}

/** The local calendar day of a Date or an ISO timestamp, or null. */
export function getPisiLocalDay(value) {
    const date = value instanceof Date ? value : new Date(String(value ?? ''));
    return Number.isNaN(date.getTime()) ? null : getPisiTodayIsoDate(date);
}

const isIsoTimestamp = (value) => typeof value === 'string' && value.length >= 10 && !Number.isNaN(new Date(value).getTime());
const normalizeTime = (value) => (HH_MM.test(String(value ?? '')) ? String(value) : null);
const normalizeReminderAt = (value) => {
    const match = REMINDER_AT.exec(String(value ?? ''));
    return match && dayToUtc(match[1]) !== null ? String(value) : null;
};
const normalizeNoteId = (value) => (NOTE_ID.test(String(value ?? '')) ? String(value) : null);
const clampInteger = (value, min, max) => (Number.isInteger(value) && value >= min && value <= max ? value : null);

function normalizeCompletion(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const date = normalizePisiTaskDay(entry.date);
    const dueDate = entry.dueDate === null || entry.dueDate === undefined ? null : normalizePisiTaskDay(entry.dueDate);
    if (!date || (entry.dueDate !== null && entry.dueDate !== undefined && !dueDate) || !isIsoTimestamp(entry.at)) return null;
    return { date, dueDate, at: entry.at };
}

/**
 * Reads one field of a version 2 task the way it is stored: an invalid value
 * gives the field's empty value. Used for records on disk; requests are
 * checked strictly by normalizePisiTask.
 */
const LENIENT_READERS = Object.freeze({
    title: (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, PISI_TASK_TITLE_MAX_LENGTH) : ''),
    tags: (value) => normalizePisiTaskTags(value),
    status: (value) => (PISI_TASK_STATUSES.has(value) ? value : 'todo'),
    priority: (value) => clampInteger(value, 1, 5) ?? 3,
    dueDate: (value) => normalizePisiTaskDay(value),
    dueTime: (value) => normalizeTime(value),
    repeat: (value) => (PISI_TASK_REPEATS.has(value) ? value : 'none'),
    completionOffsetDays: (value) => clampInteger(value, 1, 3650),
    reminderMode: (value) => (PISI_TASK_REMINDER_MODES.includes(value) ? value : 'none'),
    reminderAt: (value) => normalizeReminderAt(value),
    dependencies: (value) => (Array.isArray(value) ? Array.from(new Set(value.filter((item) => isPisiTaskId(item)))) : []),
    manualOrder: (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0),
    noteId: (value) => normalizeNoteId(value),
    diaryDate: (value) => normalizePisiTaskDay(value),
    durationMinutes: (value) => clampInteger(value, 0, 1440) ?? 0,
    actualMinutes: (value) => clampInteger(value, 0, 100000) ?? 0,
    completions: (value) => (Array.isArray(value) ? value.map(normalizeCompletion).filter(Boolean) : []),
    createdAt: (value) => (isIsoTimestamp(value) ? value : null),
    updatedAt: (value) => (isIsoTimestamp(value) ? value : null),
    completedAt: (value) => (isIsoTimestamp(value) ? value : null),
    completedOn: (value) => normalizePisiTaskDay(value)
});

/** The version 2 fields in the order a new record is written (§3.1, plus `completedOn`). */
export const PISI_TASK_FIELDS = Object.freeze([
    'id',
    'title',
    'tags',
    'status',
    'priority',
    'dueDate',
    'dueTime',
    'repeat',
    'completionOffsetDays',
    'reminderMode',
    'reminderAt',
    'dependencies',
    'manualOrder',
    'noteId',
    'diaryDate',
    'durationMinutes',
    'actualMinutes',
    'completions',
    'createdAt',
    'updatedAt',
    'completedAt',
    'completedOn'
]);

/**
 * A stored task (version 1 or 2) with every version 2 field read leniently.
 * Unknown fields and the old version 1 fields stay as they are (GV12); they
 * are not read. Returns null for something that is not a task object.
 */
export function readPisiTask(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || !isPisiTaskId(record.id)) return null;
    const task = { ...record };
    for (const [field, read] of Object.entries(LENIENT_READERS)) task[field] = read(record[field]);
    if (!task.dueDate) task.dueTime = null;
    if (task.noteId && task.diaryDate) task.diaryDate = null;
    if (task.repeat !== 'after-completion') task.completionOffsetDays = null;
    else if (task.completionOffsetDays === null) task.completionOffsetDays = 1;
    if (task.status !== 'done') {
        task.completedAt = null;
        task.completedOn = null;
    }
    task.dependencies = task.dependencies.filter((id) => id !== task.id);
    return task;
}

/** Where a task lives: a note, a day's diary, or nowhere (a version 1 record, §3.1). */
export function getPisiTaskLocation(task) {
    const noteId = normalizeNoteId(task?.noteId);
    if (noteId) return { kind: 'note', noteId };
    const date = normalizePisiTaskDay(task?.diaryDate);
    return date ? { kind: 'diary', date } : null;
}

/** Checks one requested field value. Returns `{ value }` or `{ error }`. */
function checkRequestedField(field, value, taskId) {
    const invalid = { error: 'invalid' };
    switch (field) {
        case 'title':
            return typeof value === 'string' ? { value: LENIENT_READERS.title(value) } : invalid;
        case 'tags': {
            // Every item must be a tag; duplicates fold. More than the limit is an error, not a cut.
            if (!Array.isArray(value) || !value.every((item) => normalizePisiTaskTag(item))) return invalid;
            const tags = normalizePisiTaskTags(value);
            const distinct = new Set(value.map((item) => normalizePisiTaskTag(item).toLocaleLowerCase('tr-TR'))).size;
            return distinct > PISI_TASK_TAG_LIMIT ? { error: 'too-many' } : { value: tags };
        }
        case 'status':
            return PISI_TASK_STATUSES.has(value) ? { value } : invalid;
        case 'priority':
            return clampInteger(value, 1, 5) === null ? invalid : { value };
        case 'dueDate':
        case 'diaryDate':
        case 'completedOn':
            return value === null || normalizePisiTaskDay(value) ? { value } : invalid;
        case 'dueTime':
            return value === null || normalizeTime(value) ? { value } : invalid;
        case 'repeat':
            return PISI_TASK_REPEATS.has(value) ? { value } : invalid;
        case 'completionOffsetDays':
            return value === null || clampInteger(value, 1, 3650) !== null ? { value } : invalid;
        case 'reminderMode':
            return PISI_TASK_REMINDER_MODES.includes(value) ? { value } : invalid;
        case 'reminderAt':
            return value === null || normalizeReminderAt(value) ? { value } : invalid;
        case 'dependencies': {
            if (!Array.isArray(value) || !value.every((id) => isPisiTaskId(id))) return invalid;
            if (value.includes(taskId)) return { error: 'self-dependency' };
            return { value: Array.from(new Set(value)) };
        }
        case 'manualOrder':
            return typeof value === 'number' && Number.isFinite(value) ? { value } : invalid;
        case 'noteId':
            return value === null || normalizeNoteId(value) ? { value } : invalid;
        case 'durationMinutes':
            return clampInteger(value, 0, 1440) === null ? invalid : { value };
        case 'actualMinutes':
            return clampInteger(value, 0, 100000) === null ? invalid : { value };
        case 'completions': {
            if (!Array.isArray(value)) return invalid;
            const entries = value.map(normalizeCompletion);
            return entries.every(Boolean) ? { value: entries } : invalid;
        }
        case 'createdAt':
        case 'completedAt':
            return value === null || isIsoTimestamp(value) ? { value } : invalid;
        default:
            return { value };
    }
}

/**
 * The version 2 record for `payload` laid over `existing` (the stored record,
 * or null for a new task). Only the fields named in `payload` change; each is
 * checked strictly and an invalid value is an error, not a silent fix. What
 * `existing` holds is read leniently, and its unknown fields stay (GV12).
 *
 * - A new task needs a place: exactly one of `noteId` and `diaryDate`. Setting
 *   one clears the other. A stored task without a place (version 1) keeps
 *   having none until a request gives it one.
 * - `dueTime` needs `dueDate`; clearing `dueDate` clears the time.
 * - A repeating task is not marked done here: completePisiTask moves it on.
 * - `completedAt` / `completedOn` follow `status` unless the request sets them.
 *
 * `now` is a Date; `makeUuid` is called only for a new task without an id.
 * Returns `{ ok: true, task }` or `{ ok: false, errors: [{ field, code }] }`.
 */
export function normalizePisiTask(payload = {}, existing = null, { now, makeUuid }) {
    const errors = [];
    const stored = existing ? readPisiTask(existing) : null;
    if (existing && !stored) return { ok: false, errors: [{ field: 'id', code: 'invalid' }] };

    let id = stored?.id ?? null;
    if (!id) {
        id = payload.id === undefined || payload.id === null || payload.id === '' ? formatPisiTaskId(makeUuid()) : payload.id;
        if (!isPisiTaskId(id)) return { ok: false, errors: [{ field: 'id', code: 'invalid' }] };
    } else if (payload.id !== undefined && payload.id !== id) {
        errors.push({ field: 'id', code: 'immutable' });
    }

    const nowIso = now.toISOString();
    const base = stored ?? { ...readPisiTask({ id }), manualOrder: now.getTime(), createdAt: nowIso };
    const task = { ...base, id };
    const requested = new Set();
    for (const field of PISI_TASK_FIELDS) {
        // `id` is given once; `updatedAt` is always the clock's.
        if (field === 'id' || field === 'updatedAt' || payload[field] === undefined) continue;
        const checked = checkRequestedField(field, payload[field], id);
        if (checked.error) errors.push({ field, code: checked.error });
        else {
            task[field] = checked.value;
            requested.add(field);
        }
    }

    if (requested.has('noteId') && task.noteId && !requested.has('diaryDate')) task.diaryDate = null;
    if (requested.has('diaryDate') && task.diaryDate && !requested.has('noteId')) task.noteId = null;
    if (task.noteId && task.diaryDate) errors.push({ field: 'noteId', code: 'location-conflict' });
    const placeTouched = requested.has('noteId') || requested.has('diaryDate');
    if (!task.noteId && !task.diaryDate && (!stored || placeTouched)) errors.push({ field: 'noteId', code: 'location-required' });

    if (!task.dueDate && task.dueTime) {
        if (requested.has('dueTime')) errors.push({ field: 'dueTime', code: 'time-without-date' });
        else task.dueTime = null;
    }
    if (task.repeat !== 'after-completion') task.completionOffsetDays = null;
    else if (task.completionOffsetDays === null) task.completionOffsetDays = 1;
    if (task.repeat !== 'none' && task.status === 'done' && requested.has('status')) errors.push({ field: 'status', code: 'use-complete' });

    if (task.status === 'done') {
        const wasDone = stored?.status === 'done';
        if (!requested.has('completedAt')) task.completedAt = wasDone && stored.completedAt ? stored.completedAt : nowIso;
        if (!requested.has('completedOn')) task.completedOn = wasDone && stored.completedOn ? stored.completedOn : getPisiLocalDay(now);
    } else {
        task.completedAt = null;
        task.completedOn = null;
    }
    task.updatedAt = nowIso;

    if (errors.length) return { ok: false, errors };
    return { ok: true, task: stored ? task : orderFields(task) };
}

function orderFields(task) {
    const ordered = {};
    for (const field of PISI_TASK_FIELDS) ordered[field] = task[field];
    for (const [key, value] of Object.entries(task)) if (!(key in ordered)) ordered[key] = value;
    return ordered;
}

/** True when two records differ only in `updatedAt` (an unchanged task is not written, V4). */
export function isSamePisiTask(a, b) {
    const strip = (task) => JSON.stringify({ ...task, updatedAt: null });
    return strip(a) === strip(b);
}

/**
 * Reads a parsed tasks.json document of version 1 or 2. Returns
 * `{ ok: true, version, tasks }` (task objects as stored) or
 * `{ ok: false, error }` for a document that must stay read-only (GV11).
 */
export function readPisiTaskStore(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'not-an-object' };
    const version = data.version ?? 1;
    if (version !== 1 && version !== 2) return { ok: false, error: 'unsupported-version' };
    if (!Array.isArray(data.tasks)) return { ok: false, error: 'tasks-not-a-list' };
    return { ok: true, version, tasks: data.tasks.filter((task) => task && typeof task === 'object' && !Array.isArray(task)) };
}

/** The tasks.json document to write: every other top-level key stays where it was (GV12). */
export function makePisiTaskStoreData(data, tasks, { now }) {
    return { ...(data && typeof data === 'object' ? data : {}), version: PISI_TASK_STORE_VERSION, updatedAt: now.toISOString(), tasks };
}

function stepRepeat(day, repeat) {
    const time = dayToUtc(day);
    const date = new Date(time);
    if (repeat === 'daily') return utcToDay(time + DAY_MS);
    if (repeat === 'weekly') return utcToDay(time + 7 * DAY_MS);
    if (repeat === 'biweekly') return utcToDay(time + 14 * DAY_MS);
    if (repeat === 'weekdays') {
        let next = time + DAY_MS;
        while ([0, 6].includes(new Date(next).getUTCDay())) next += DAY_MS;
        return utcToDay(next);
    }
    // monthly: the same day of the next month, or its last day (31 Jan -> 28 Feb), as getNextPisiTodoDate.
    const year = date.getUTCFullYear() + (date.getUTCMonth() === 11 ? 1 : 0);
    const month = (date.getUTCMonth() + 1) % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return utcToDay(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

/**
 * The next due day of a repeating task completed on `today` (§3.2.3): the
 * first day of its repeat rule after both its due day and today; missed
 * occurrences are skipped. `after-completion` is today plus its day count. A
 * repeating task without a due day counts from today. Null for `none`.
 */
export function getNextPisiTaskDueDate(task, today) {
    const repeat = PISI_TASK_REPEATS.has(task?.repeat) ? task.repeat : 'none';
    if (repeat === 'none' || !normalizePisiTaskDay(today)) return null;
    if (repeat === 'after-completion') return addPisiTaskDays(today, clampInteger(task.completionOffsetDays, 1, 3650) ?? 1);
    let day = normalizePisiTaskDay(task.dueDate) ?? today;
    for (let step = 0; step < MAX_REPEAT_STEPS; step += 1) {
        day = stepRepeat(day, repeat);
        if (day > today) return day;
    }
    return null;
}

function shiftReminderAt(reminderAt, days) {
    if (!reminderAt || !days) return reminderAt;
    return `${addPisiTaskDays(reminderAt.slice(0, 10), days)}${reminderAt.slice(10)}`;
}

/** The completion that can still be taken back: the one done last. Null when there is none. */
export function getPisiTaskLatestCompletion(task) {
    const entries = LENIENT_READERS.completions(task?.completions);
    let latest = null;
    for (const entry of entries) {
        if (!latest || entry.at > latest.at || (entry.at === latest.at && String(entry.dueDate) > String(latest.dueDate))) latest = entry;
    }
    return latest;
}

const sameCompletion = (a, b) => a.date === b.date && a.dueDate === b.dueDate && a.at === b.at;

/**
 * Completes a task on the local day of `now` (§3.2.3).
 * - A task that does not repeat becomes `done`, with `completedAt` and
 *   `completedOn`. An already done task does not change.
 * - A repeating task gets `{ date, dueDate, at }` in `completions` and moves
 *   on to getNextPisiTaskDueDate; `reminderAt` moves by the same number of
 *   days and the status is `todo` again.
 * Returns `{ ok: true, changed, task, completion }`. `completion` is what
 * reopenPisiTask needs to take this back: the entry plus the status before.
 */
export function completePisiTask(task, { now }) {
    const current = readPisiTask(task);
    if (!current) return { ok: false, error: 'invalid-task' };
    const nowIso = now.toISOString();
    const today = getPisiLocalDay(now);

    if (current.repeat === 'none') {
        if (current.status === 'done') return { ok: true, changed: false, task, completion: null };
        const completion = { date: today, dueDate: current.dueDate, at: nowIso, status: current.status };
        return { ok: true, changed: true, task: { ...current, status: 'done', completedAt: nowIso, completedOn: today, updatedAt: nowIso }, completion };
    }

    const nextDue = getNextPisiTaskDueDate(current, today);
    if (!nextDue) return { ok: false, error: 'no-next-date' };
    const entry = { date: today, dueDate: current.dueDate, at: nowIso };
    const moved = getPisiTaskDaysBetween(current.dueDate ?? today, nextDue);
    const next = {
        ...current,
        status: 'todo',
        dueDate: nextDue,
        reminderAt: shiftReminderAt(current.reminderAt, moved),
        completions: [...current.completions, entry],
        completedAt: null,
        completedOn: null,
        updatedAt: nowIso
    };
    return { ok: true, changed: true, task: next, completion: { ...entry, status: current.status === 'done' ? 'todo' : current.status } };
}

/**
 * Takes a completion back (§3.2.3).
 * - Repeating task: `completion` (or, when it is omitted, the latest one) is
 *   taken out of `completions` and the task returns to that occurrence's due
 *   day; `reminderAt` moves back with it. Only the latest completion can be
 *   taken back: an earlier one gives `{ ok: false, error: 'locked' }`.
 * - A done task that does not repeat goes back to `completion.status`, else `todo`.
 * - Anything else does not change.
 * `updatedAt` becomes the time of `now`: undoing is a change of its own.
 */
export function reopenPisiTask(task, completion = null, { now }) {
    const current = readPisiTask(task);
    if (!current) return { ok: false, error: 'invalid-task' };
    const nowIso = now.toISOString();
    const restoreStatus = (fallback) =>
        completion && PISI_TASK_STATUSES.has(completion.status) && completion.status !== 'done' ? completion.status : fallback;

    const entry = completion ? normalizeCompletion(completion) : null;
    const target = entry
        ? current.completions.find((item) => sameCompletion(item, entry))
        : current.repeat !== 'none'
          ? getPisiTaskLatestCompletion(current)
          : null;
    if (completion && !target && current.repeat !== 'none') return { ok: false, error: 'not-found' };

    if (target) {
        const latest = getPisiTaskLatestCompletion(current);
        if (!sameCompletion(latest, target)) return { ok: false, error: 'locked' };
        const back = getPisiTaskDaysBetween(current.dueDate ?? target.date, target.dueDate ?? target.date) ?? 0;
        return {
            ok: true,
            changed: true,
            task: {
                ...current,
                status: restoreStatus(current.status === 'done' ? 'todo' : current.status),
                dueDate: target.dueDate,
                reminderAt: shiftReminderAt(current.reminderAt, back),
                completions: current.completions.filter((item) => !sameCompletion(item, target)),
                updatedAt: nowIso
            }
        };
    }

    if (current.status !== 'done') return { ok: true, changed: false, task };
    return { ok: true, changed: true, task: { ...current, status: restoreStatus('todo'), completedAt: null, completedOn: null, updatedAt: nowIso } };
}

/**
 * Would giving `taskId` the dependencies `dependencyIds` close a loop? Returns
 * the loop as a list of ids that starts and ends with `taskId`
 * (`[a, b, c, a]`), or null. A task that depends on itself is `[a, a]`.
 */
export function findPisiTaskDependencyCycle(tasks, taskId, dependencyIds) {
    const edges = new Map();
    for (const task of Array.isArray(tasks) ? tasks : []) {
        if (task && isPisiTaskId(task.id)) edges.set(task.id, Array.isArray(task.dependencies) ? task.dependencies : []);
    }
    edges.set(taskId, Array.isArray(dependencyIds) ? dependencyIds : []);

    const visited = new Set();
    const path = [taskId];
    const walk = (id) => {
        for (const next of edges.get(id) || []) {
            if (next === taskId) return [...path, taskId];
            if (visited.has(next)) continue;
            visited.add(next);
            path.push(next);
            const found = walk(next);
            if (found) return found;
            path.pop();
        }
        return null;
    };
    return walk(taskId);
}

// Fields a copy of a task takes over (docs/task-plan.md §3.3: the editor's
// copy and paste, the map's note copy). A copy is open, lives where it is put
// and has no completions, dependencies or order of its own.
const PISI_TASK_COPY_FIELDS = Object.freeze([
    'title',
    'tags',
    'status',
    'priority',
    'dueDate',
    'dueTime',
    'repeat',
    'completionOffsetDays',
    'reminderMode',
    'reminderAt',
    'durationMinutes'
]);

/** The fields of a new task that copies `task`; a done task's copy is `todo`. */
export function makePisiTaskCopyFields(task) {
    const fields = {};
    for (const field of PISI_TASK_COPY_FIELDS) if (task && task[field] !== undefined) fields[field] = task[field];
    if (fields.tags !== undefined) fields.tags = normalizePisiTaskTags(fields.tags);
    if (fields.status === 'done') fields.status = 'todo';
    return fields;
}
