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
