// The Tags panel's rule (docs/task-plan.md G6): a tag counts its tagged
// blocks (the active map, the open note and the diaries) and its tagged
// tasks (every task of tasks.json; no note is read for them). Pure: the
// caller gives the blocks, the tasks and the tag normalizer.

const keep = (value) => String(value || '').trim();

/**
 * `{ tags, counts }`: every tag of the blocks and the tasks, sorted (Turkish),
 * and its count (blocks + tasks). A block or task counts once per tag.
 */
export function getPisiTagPanelModel(blocks = [], tasks = [], normalizeTag = keep) {
    const counts = new Map();
    const add = (tags) => {
        for (const tag of new Set((Array.isArray(tags) ? tags : []).map(normalizeTag).filter(Boolean))) counts.set(tag, (counts.get(tag) || 0) + 1);
    };
    for (const block of blocks) add(block?.tags);
    for (const task of tasks) add(task?.tags);
    const tags = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, 'tr'));
    return { tags, counts };
}

/** The tasks that carry `tag`: open ones first, then by title (Turkish). */
export function listPisiTaggedTasks(tasks = [], tag, normalizeTag = keep) {
    const wanted = normalizeTag(tag);
    if (!wanted) return [];
    return tasks
        .filter((task) => Array.isArray(task?.tags) && task.tags.some((item) => normalizeTag(item) === wanted))
        .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || String(a.title).localeCompare(String(b.title), 'tr'));
}
