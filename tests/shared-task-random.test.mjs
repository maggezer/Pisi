// Seeded random checks of the task core (docs/task-plan.md G1): 1,000 cases each.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PISI_TASK_REPEATS, PISI_TASK_STATUSES, completePisiTask, normalizePisiTask, reopenPisiTask } from '../shared/task-model.mjs';
import { diffPisiTaskMembership, insertPisiTaskBlock, listPisiNoteTaskIds, makePisiTaskBlockHtml, removePisiTaskBlock } from '../shared/task-blocks.mjs';
import { listPisiDiaryTaskIds, makePisiDiaryTaskSectionHtml, readPisiDiaryTaskSection, replacePisiDiaryTaskSection } from '../shared/task-diary.mjs';

const CASES = 1000;

// A small linear congruential generator, so a failing case can be replayed from its seed.
function makeRandom(seed) {
    let state = seed >>> 0;
    const next = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
    return {
        next,
        int: (min, max) => min + Math.floor(next() * (max - min + 1)),
        pick: (list) => list[Math.floor(next() * list.length)],
        chance: (probability) => next() < probability
    };
}

const day = (random) => `2026-${String(random.int(1, 12)).padStart(2, '0')}-${String(random.int(1, 28)).padStart(2, '0')}`;
const STATUSES = [...PISI_TASK_STATUSES].filter((status) => status !== 'done');
const REPEATS = [...PISI_TASK_REPEATS];

function randomTask(random, index) {
    const repeat = random.pick(REPEATS);
    const dated = random.chance(0.8);
    const payload = {
        title: `Görev ${index}`,
        status: random.pick(STATUSES),
        priority: random.int(1, 5),
        dueDate: dated ? day(random) : null,
        repeat,
        reminderAt: random.chance(0.4) ? `${day(random)}T0${random.int(0, 9)}:${random.pick(['00', '15', '30'])}` : null,
        ...(random.chance(0.5) ? { noteId: `node_n${random.int(1, 9)}` } : { diaryDate: day(random) })
    };
    if (dated && random.chance(0.5)) payload.dueTime = `1${random.int(0, 9)}:00`;
    if (repeat === 'after-completion') payload.completionOffsetDays = random.int(1, 10);
    const created = new Date(2026, 0, 1, 0, 0, index % 60, index);
    const result = normalizePisiTask(payload, null, { now: created, makeUuid: () => `r${index}-${random.int(1000, 9999)}` });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.task;
}

const randomNow = (random) => new Date(2026, random.int(0, 11), random.int(1, 28), random.int(0, 23), random.int(0, 59));
const withoutUpdatedAt = (task) => ({ ...task, updatedAt: null });

test('tamamla ve geri al kaydı aynen geri verir (updatedAt dışında)', () => {
    for (let seed = 1; seed <= CASES; seed += 1) {
        const random = makeRandom(seed);
        let task = randomTask(random, seed);
        // Completions happen one after another; the latest is the one that can be taken back.
        let clock = randomNow(random).getTime();
        const later = () => new Date((clock += random.int(1, 20 * 86400) * 1000));
        // Some tasks already carry earlier completions.
        for (let index = random.int(0, 2); index > 0 && task.repeat !== 'none'; index -= 1) task = completePisiTask(task, { now: later() }).task;

        const done = completePisiTask(task, { now: later() });
        assert.equal(done.ok, true, `seed ${seed}`);
        const back = reopenPisiTask(done.task, done.completion, { now: later() });
        assert.equal(back.ok, true, `seed ${seed}: ${back.error}`);
        assert.deepEqual(withoutUpdatedAt(back.task), withoutUpdatedAt(task), `seed ${seed}`);
    }
});

const paragraph = (random, index) => {
    const text = random.pick(['Metin', 'A &amp; B', 'çğıöşü', '<b>kalın</b>', '', 'x<br>y']);
    return `<div class="pisi-editor-block" data-pisi-block-id="blk_p${index}">${text}</div>${random.pick(['', '\n', '  '])}`;
};

test('üyelik farkı ile blok ekleme ve kaldırma birbirini tutar; blok dışındaki baytlar değişmez', () => {
    for (let seed = 1; seed <= CASES; seed += 1) {
        const random = makeRandom(seed * 7919);
        const parts = [];
        const present = [];
        for (let index = 0; index < random.int(0, 8); index += 1) {
            if (random.chance(0.4)) {
                const taskId = `task_b${seed}-${index}`;
                present.push(taskId);
                parts.push(makePisiTaskBlockHtml({ blockId: `blk_t${index}`, taskId }));
            } else parts.push(paragraph(random, index));
        }
        const before = parts.join('');
        const anchors = [...before.matchAll(/data-pisi-block-id="([^"]+)"/g)].map((match) => match[1]);

        let after = before;
        const added = [];
        const removed = [];
        for (let op = 0; op < random.int(1, 5); op += 1) {
            const current = listPisiNoteTaskIds(after);
            if (current.length && random.chance(0.45)) {
                const taskId = random.pick(current);
                after = removePisiTaskBlock(after, taskId);
                if (added.includes(taskId)) added.splice(added.indexOf(taskId), 1);
                else removed.push(taskId);
            } else {
                const taskId = `task_n${seed}-${op}`;
                const next = insertPisiTaskBlock(
                    after,
                    { blockId: `blk_n${op}`, taskId },
                    { afterBlockId: anchors.length && random.chance(0.7) ? random.pick(anchors) : null }
                );
                // Inserting adds exactly the block; removing it again gives the note back byte for byte.
                assert.equal(next.length - after.length, makePisiTaskBlockHtml({ blockId: `blk_n${op}`, taskId }).length, `seed ${seed}`);
                assert.equal(removePisiTaskBlock(next, taskId), after, `seed ${seed}`);
                after = next;
                added.push(taskId);
            }
        }
        const diff = diffPisiTaskMembership(before, after);
        assert.deepEqual([...diff.added].sort(), [...added].sort(), `seed ${seed}`);
        assert.deepEqual([...diff.removed].sort(), [...removed].sort(), `seed ${seed}`);
        assert.deepEqual([...diff.kept].sort(), present.filter((id) => !removed.includes(id)).sort(), `seed ${seed}`);
        // Every byte that is not a task block is the same, in the same order.
        const strip = (html) => html.replace(/<div class="pisi-editor-block pisi-task-block"[^>]*><\/div>/g, '');
        assert.equal(strip(after), strip(before), `seed ${seed}`);
    }
});

test('bölüm baytları aynı girdiden aynı çıkar; bölüm dışındaki baytlar değişmez', () => {
    for (let seed = 1; seed <= CASES; seed += 1) {
        const random = makeRandom(seed * 104729);
        const tasks = Array.from({ length: random.int(0, 12) }, (_, index) => randomTask(random, seed * 100 + index));
        const date = day(random);
        const ids = listPisiDiaryTaskIds(date, tasks);
        // The order does not depend on the order of tasks.json.
        assert.deepEqual(listPisiDiaryTaskIds(date, [...tasks].reverse()), ids, `seed ${seed}`);

        const body = Array.from({ length: random.int(0, 5) }, (_, index) => paragraph(random, index)).join('');
        const stale = random.chance(0.5) ? makePisiDiaryTaskSectionHtml(date, ['task_stale1']) : '';
        const html = random.chance(0.5) ? body + stale : stale + body;
        const once = replacePisiDiaryTaskSection(html, date, ids);
        assert.equal(replacePisiDiaryTaskSection(html, date, [...ids]), once, `seed ${seed}`);
        assert.equal(replacePisiDiaryTaskSection(once, date, ids), once, `seed ${seed}: doğru bölüm yeniden yazılmaz`);
        assert.equal(once.replace(makePisiDiaryTaskSectionHtml(date, ids), ''), body, `seed ${seed}`);
        const read = readPisiDiaryTaskSection(once);
        assert.deepEqual([read.count, read.taskIds], [ids.length ? 1 : 0, ids], `seed ${seed}`);
        if (ids.length) assert.equal(read.last, true, `seed ${seed}`);
    }
});
