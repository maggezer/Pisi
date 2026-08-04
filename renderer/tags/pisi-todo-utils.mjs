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

export const PISI_TODO_FILTER_OPTIONS = Object.freeze([
    Object.freeze({ value: 'all', label: 'Tümü' }),
    Object.freeze({ value: 'today', label: 'Bugün' }),
    Object.freeze({ value: 'upcoming', label: 'Yaklaşan' }),
    Object.freeze({ value: 'overdue', label: 'Geciken' }),
    Object.freeze({ value: 'undated', label: 'Tarihsiz' })
]);

export function getPisiTodoPriorityOption(value) {
    const priority = Number(value);
    return PISI_TODO_PRIORITY_OPTIONS.find((item) => item.value === priority) || null;
}

export function getPisiTodoStatusOption(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return PISI_TODO_STATUS_OPTIONS.find((item) => item.value === normalized) ||
        PISI_TODO_STATUS_OPTIONS[0];
}

export function getPisiTodoFilterOption(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return PISI_TODO_FILTER_OPTIONS.find((item) => item.value === normalized) ||
        PISI_TODO_FILTER_OPTIONS[0];
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

    if (!priorityOption) return null;

    const normalizedDate = String(isoDate ?? '').trim().toLowerCase();
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

export function getPisiTodoDateBucket(finishDate, now = new Date()) {
    if (!(finishDate instanceof Date) || Number.isNaN(finishDate.getTime())) {
        return 'undated';
    }

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const due = new Date(finishDate);
    due.setHours(0, 0, 0, 0);

    const daysLeft = Math.floor((due.getTime() - today.getTime()) / 86400000);
    if (daysLeft < 0) return 'overdue';
    if (daysLeft === 0) return 'today';
    if (daysLeft <= 7) return 'upcoming';
    return 'later';
}

export function matchesPisiTodoFilter(todo, filterValue, now = new Date()) {
    const filter = getPisiTodoFilterOption(filterValue).value;
    if (filter === 'all') return true;
    return getPisiTodoDateBucket(todo?.finishDate, now) === filter;
}


export function extractPisiTodoMetadataFromBlock(block, normalizeTag = normalizePisiTodoTagValue) {
    const todoStates = {};
    const todoSources = {};
    if (!block?.querySelectorAll) return { todoStates, todoSources };

    const normalize = (value) => String(normalizeTag(value) || '').toLowerCase();
    const sourceElements = Array.from(
        block.querySelectorAll('.pisi-todo-source[data-pisi-todo-for]')
    );

    for (const tagEl of block.querySelectorAll('.pisi-user-tag[data-pisi-tag]')) {
        const normalizedTag = normalize(
            tagEl.dataset.pisiTag || tagEl.textContent || ''
        );
        if (!/^todo\./i.test(normalizedTag)) continue;

        todoStates[normalizedTag] = String(
            tagEl.dataset.pisiTodoStatus || 'todo'
        ).toLowerCase();

        const sourceEl = sourceElements.find((candidate) => {
            return normalize(candidate.dataset.pisiTodoFor || '') === normalizedTag;
        });
        if (sourceEl) {
            todoSources[normalizedTag] = String(sourceEl.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
        }
    }

    return { todoStates, todoSources };
}

export function parsePisiTodoTagValue(tag, now = new Date()) {
    const normalized = normalizePisiTodoTagValue(tag);
    const match = normalized.match(
        /^todo\.([1-9])\.(?:(\d{2})-(\d{2})-(\d{2}|\d{4})|none)$/
    );

    if (!match) return null;

    const rawPriority = Number(match[1]);
    const priority = Math.min(rawPriority, 5);
    const priorityOption = getPisiTodoPriorityOption(priority);
    let finishDate = null;

    if (match[2]) {
        const day = Number(match[2]);
        const month = Number(match[3]);
        const year = match[4].length === 2
            ? 2000 + Number(match[4])
            : Number(match[4]);
        finishDate = new Date(year, month - 1, day);

        if (
            finishDate.getFullYear() !== year ||
            finishDate.getMonth() !== month - 1 ||
            finishDate.getDate() !== day
        ) {
            return null;
        }

        finishDate.setHours(0, 0, 0, 0);
    }

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const daysLeft = finishDate
        ? Math.floor((finishDate.getTime() - today.getTime()) / 86400000)
        : null;

    return {
        tag: normalized,
        rawPriority,
        priority,
        priorityLabel: priorityOption.label,
        legacyPriority: rawPriority > 5,
        finishDate,
        daysLeft,
        dateBucket: getPisiTodoDateBucket(finishDate, now),
        workorder: finishDate ? daysLeft / priority : Number.POSITIVE_INFINITY
    };
}
