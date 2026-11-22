// The one producer of task search records (docs/task-plan.md G5, §3.6): every
// task of tasks.json gives one record, whatever its place: a note, a day's
// diary or none (a version 1 record the phone wrote, §3.1). The record is
// rebuilt from the task store; notes are never read for tasks (the old
// `todo.` marker in a note is an ordinary tag, §3.2.1). Pure: the caller gives
// the note of the task (from the search index or the Explorer tree) and the
// translation.

/** Where a task lives, for search: 'note', 'diary' or 'none'. */
export function getPisiTaskSearchPlace(task) {
    if (task?.noteId) return 'note';
    if (task?.diaryDate) return 'diary';
    return 'none';
}

const identity = (value) => String(value ?? '');

/**
 * The search record of a task.
 * - `note`: `{ path, title, relativePath, nodeItem }` of the task's note, or null when it is not known.
 * - `memberships`: the maps of that note (`[{ mapPath, mapTitle, mapItem }]`).
 * - `translate`, `formatDay`: the user's language and day format.
 * Null for a value that is not a task.
 */
export function makePisiTaskSearchRecord(task, { note = null, memberships = [], translate = identity, formatDay = identity } = {}) {
    if (!task || typeof task !== 'object' || !task.id) return null;
    const place = getPisiTaskSearchPlace(task);
    const known = place === 'note' && note?.path ? note : null;
    const placeLabel =
        place === 'note'
            ? known?.title || translate('Not')
            : place === 'diary'
              ? `${translate('Günlük')} · ${formatDay(task.diaryDate)}`
              : translate('Yeri yok');
    const maps = known && Array.isArray(memberships) ? memberships : [];
    const membership = maps[0] || null;
    const title = String(task.title || '').trim();
    const dueDate = task.dueDate || null;
    const previewParts = [placeLabel, membership?.mapTitle || '', dueDate ? formatDay(dueDate) : ''].filter(Boolean);
    return {
        id: `task:${task.id}`,
        kind: 'task',
        taskId: task.id,
        title: title || translate('Görev'),
        nodeTitle: placeLabel,
        nodePath: known?.path || null,
        nodeItem: known?.nodeItem || null,
        blockId: null,
        place,
        // A task whose place cannot be opened (no place, or its note is not found) opens its detail window.
        opensDetail: place === 'none' || (place === 'note' && !known),
        noteId: task.noteId || null,
        diaryDate: task.diaryDate || null,
        mapPath: membership?.mapPath || null,
        mapTitle: membership?.mapTitle || '',
        mapItem: membership?.mapItem || null,
        memberships: maps,
        relativePath: known?.relativePath || '',
        tag: '',
        tags: [],
        status: task.status || 'todo',
        priority: Number(task.priority) || 3,
        dueDate,
        sourceText: title,
        preview: previewParts.join(' · '),
        canonical: true,
        searchFields: [
            { kind: 'task', value: title, weight: 125 },
            { kind: 'title', value: title, weight: 132 },
            { kind: 'title', value: placeLabel, weight: 88 },
            { kind: 'map', value: membership?.mapTitle || '', weight: 66 },
            { kind: 'path', value: known?.relativePath || '', weight: 48 },
            { kind: 'status', value: task.status || '', weight: 35 },
            { kind: 'priority', value: String(Number(task.priority) || 3), weight: 28 }
        ]
    };
}

/** What a task's record is made of, for the index's change fingerprint. */
export function getPisiTaskSearchFingerprintPart(task, note = null) {
    return [
        'task',
        task?.id || '',
        task?.updatedAt || '',
        task?.status || '',
        task?.priority || '',
        task?.title || '',
        task?.noteId || '',
        task?.diaryDate || '',
        task?.dueDate || '',
        note?.path || '',
        note?.title || ''
    ].join(':');
}
