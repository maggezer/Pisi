export const PISI_TODO_PRIORITY_OPTIONS = Object.freeze([
    Object.freeze({ value: 1, label: 'very low' }),
    Object.freeze({ value: 2, label: 'low' }),
    Object.freeze({ value: 3, label: 'medium' }),
    Object.freeze({ value: 4, label: 'high' }),
    Object.freeze({ value: 5, label: 'very high' })
]);

export function getPisiTodoPriorityOption(value) {
    const priority = Number(value);
    return PISI_TODO_PRIORITY_OPTIONS.find((item) => item.value === priority) || null;
}

function normalizePisiTodoTagValue(value) {
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

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
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
    const date = parsePisiTodoIsoDate(isoDate);

    if (!priorityOption || !date) return null;

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());

    return `todo.${priority}.${day}-${month}-${year}`;
}

export function parsePisiTodoTagValue(tag, now = new Date()) {
    const normalized = normalizePisiTodoTagValue(tag);
    const match = normalized.match(
        /^todo\.([1-9])\.(\d{2})-(\d{2})-(\d{2}|\d{4})$/
    );

    if (!match) return null;

    const rawPriority = Number(match[1]);
    const priority = Math.min(rawPriority, 5);
    const priorityOption = getPisiTodoPriorityOption(priority);
    const day = Number(match[2]);
    const month = Number(match[3]);
    const year = match[4].length === 2
        ? 2000 + Number(match[4])
        : Number(match[4]);
    const finishDate = new Date(year, month - 1, day);

    if (
        finishDate.getFullYear() !== year ||
        finishDate.getMonth() !== month - 1 ||
        finishDate.getDate() !== day
    ) {
        return null;
    }

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    finishDate.setHours(0, 0, 0, 0);

    const daysLeft = Math.floor(
        (finishDate.getTime() - today.getTime()) / 86400000
    );

    return {
        tag: normalized,
        rawPriority,
        priority,
        priorityLabel: priorityOption.label,
        legacyPriority: rawPriority > 5,
        finishDate,
        daysLeft,
        workorder: daysLeft / priority
    };
}
