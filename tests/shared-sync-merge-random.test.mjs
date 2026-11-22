// Invariants of the sync merges over seeded random edits (docs/sync-plan.md S1.4):
// merge(t, t, t) = t, merge(base, a, base) = a, merge(base, base, b) = b,
// no text loss (every block text a side added or changed is in the merged file
// or, after a conflict, in the conflict copy) and determinism.

import assert from 'node:assert/strict';
import test from 'node:test';
import { makePisiSyncConflictCopy } from '../shared/sync-conflict.mjs';
import { mergePisiSyncAuthority } from '../shared/sync-merge-authority.mjs';
import { stableStringify } from '../shared/sync-merge-json.mjs';
import { getPisiSyncChangedUnits, mergePisiSyncNode, splitPisiSyncNoteUnits } from '../shared/sync-merge-node.mjs';
import { getPisiSyncCompletionKey } from '../shared/sync-merge-tasks.mjs';
import { completePisiTask, normalizePisiTask, readPisiTask, reopenPisiTask } from '../shared/task-model.mjs';

const CASES = 1000;

function random(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

const WORDS = ['Pisi', 'kedi', 'çiçek', 'İstanbul', 'ağaç', 'not', '&amp;', 'görev', 'ŞEHİR', '😀', 'x', 'özet'];
const pick = (rand, items) => items[Math.floor(rand() * items.length)];
const text = (rand) => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(rand, WORDS)).join(' ');
const blockHtml = (id, value, type = 'paragraph') => {
    const tag = type === 'heading2' ? 'h2' : 'div';
    return `<${tag} class="pisi-editor-block" data-pisi-block-id="${id}" data-pisi-block-type="${type}">${value}</${tag}>`;
};

function makeNote(blocks, separator, pisi = {}, properties = {}) {
    return {
        pisi: {
            version: 1,
            type: 'node',
            id: 'node_random',
            title: 'Rastgele',
            sidecar: 'inv_Rastgele__node_random',
            createdAt: '2026-11-16T10:00:00.000Z',
            updatedAt: '2026-11-16T10:00:00.000Z',
            parentMap: 'none',
            ...pisi
        },
        content: blocks.map((item) => blockHtml(item.id, item.text, item.type)).join(separator),
        properties
    };
}

/** One side's random edit of the base blocks: change, add, delete or move. */
function edit(rand, blocks, side, counter) {
    const out = blocks.map((item) => ({ ...item }));
    const steps = Math.floor(rand() * 4);
    for (let step = 0; step < steps; step += 1) {
        const roll = rand();
        if (roll < 0.35 && out.length) {
            out[Math.floor(rand() * out.length)].text = `${side} ${text(rand)}`;
        } else if (roll < 0.65) {
            // Now and then both sides add the same id (with the same or a different text).
            const shared = rand() < 0.15;
            const id = shared ? `blk_shared${counter.value % 3}` : `blk_${side}${(counter.value += 1)}`;
            if (out.some((item) => item.id === id)) continue;
            out.splice(Math.floor(rand() * (out.length + 1)), 0, {
                id,
                text: shared && rand() < 0.5 ? 'ortak metin' : `${side} yeni ${text(rand)}`,
                type: rand() < 0.2 ? 'heading2' : 'paragraph'
            });
        } else if (roll < 0.85 && out.length) {
            out.splice(Math.floor(rand() * out.length), 1);
        } else if (out.length > 1) {
            const [moved] = out.splice(Math.floor(rand() * out.length), 1);
            out.splice(Math.floor(rand() * (out.length + 1)), 0, moved);
        }
    }
    return out;
}

function editDocument(rand, base, blocks, side, counter, separator) {
    const pisi = rand() < 0.15 ? { title: `${side} başlık` } : {};
    if (rand() < 0.5) pisi.updatedAt = `2026-11-16T10:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00.000Z`;
    const properties = { ...base.properties };
    if (rand() < 0.2) properties[`alan${Math.floor(rand() * 3)}`] = `${side}-${Math.floor(rand() * 3)}`;
    return makeNote(edit(rand, blocks, side, counter), separator, pisi, properties);
}

function assertNoTextLoss(base, side, merged, copy, label) {
    for (const unit of getPisiSyncChangedUnits(base.content, side.content)) {
        const wanted = unit.html.trimEnd();
        const kept = merged.content.includes(wanted) || (copy && copy.content.includes(wanted));
        assert.ok(kept, `${label}: ${unit.key} metni kayboldu\n${wanted}`);
    }
}

test(`${CASES} rastgele .node düzenleme çiftinde birleştirme değişmezleri`, () => {
    let conflicts = 0;
    let merges = 0;
    for (let seed = 1; seed <= CASES; seed += 1) {
        const rand = random(seed);
        const separator = rand() < 0.5 ? '\n' : '';
        const baseBlocks = Array.from({ length: Math.floor(rand() * 7) }, (_, index) => ({ id: `blk_b${index}`, text: text(rand), type: 'paragraph' }));
        const base = makeNote(baseBlocks, separator, {}, { durum: 'açık' });
        const counter = { value: 0 };
        const local = editDocument(rand, base, baseBlocks, 'L', counter, separator);
        const remote = editDocument(rand, base, baseBlocks, 'R', counter, separator);
        const label = `tohum ${seed}`;

        // merge(t, t, t) = t; merge(base, a, base) = a; merge(base, base, b) = b.
        for (const value of [base, local, remote]) {
            const same = mergePisiSyncNode({ base: value, local: value, remote: value });
            assert.equal(same.status, 'unchanged', label);
            assert.equal(stableStringify(same.value), stableStringify(value), label);
        }
        assert.equal(stableStringify(mergePisiSyncNode({ base, local, remote: base }).value), stableStringify(local), label);
        assert.equal(stableStringify(mergePisiSyncNode({ base, local: base, remote }).value), stableStringify(remote), label);

        // Determinism.
        const result = mergePisiSyncNode({ base, local, remote });
        const again = mergePisiSyncNode({ base: structuredClone(base), local: structuredClone(local), remote: structuredClone(remote) });
        assert.equal(stableStringify(again), stableStringify(result), label);

        // The merged content has each block id once (SV6), and no text is lost (SV3).
        assert.equal(splitPisiSyncNoteUnits(result.value.content).ok, true, label);
        let copy = null;
        if (result.status === 'conflict') {
            conflicts += 1;
            copy = makePisiSyncConflictCopy({
                path: 'Rastgele.node',
                document: local,
                deviceName: 'Test',
                now: new Date(2026, 10, 16),
                makeUuid: () => `u${seed}`
            }).document;
        } else if (result.status === 'merged') {
            merges += 1;
        }
        assertNoTextLoss(base, remote, result.value, null, `${label} (uzak)`);
        assertNoTextLoss(base, local, result.value, copy, `${label} (yerel)`);
        for (const [key, value] of Object.entries(local.properties)) {
            if (value !== base.properties[key] && result.status !== 'conflict')
                assert.equal(result.value.properties[key], value, `${label}: properties.${key}`);
        }
    }
    // The generator reaches both outcomes often enough to mean something.
    assert.ok(conflicts > 100 && merges > 100, `çakışma ${conflicts}, birleşme ${merges}`);
});

test(`${CASES} rastgele tasks.json düzenleme çiftinde birleştirme değişmezleri`, () => {
    const statuses = ['todo', 'doing', 'done', 'waiting'];
    for (let seed = 1; seed <= CASES; seed += 1) {
        const rand = random(seed * 7919);
        const minute = () => `2026-11-16T10:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00.000Z`;
        const baseTasks = Array.from({ length: Math.floor(rand() * 6) }, (_, index) => ({
            id: `task_b${index}`,
            title: text(rand),
            status: 'todo',
            priority: 3,
            updatedAt: minute()
        }));
        const editTasks = (side) => {
            const tasks = baseTasks.map((task) => ({ ...task }));
            for (let step = Math.floor(rand() * 4); step > 0; step -= 1) {
                const roll = rand();
                if (roll < 0.5 && tasks.length)
                    Object.assign(tasks[Math.floor(rand() * tasks.length)], {
                        [pick(rand, ['title', 'status', 'priority'])]: pick(rand, [...statuses, 1, 5, `${side} ${text(rand)}`]),
                        updatedAt: minute()
                    });
                else if (roll < 0.8)
                    tasks.push({ id: `task_${side}${step}`, title: `${side} ${text(rand)}`, status: 'todo', priority: 2, updatedAt: minute() });
                else if (tasks.length) tasks.splice(Math.floor(rand() * tasks.length), 1);
            }
            return { version: 1, updatedAt: minute(), tasks };
        };
        const base = { version: 1, updatedAt: '2026-11-16T10:00:00.000Z', tasks: baseTasks };
        const local = editTasks('L');
        const remote = editTasks('R');
        const merge = (b, l, r) => mergePisiSyncAuthority('.pisi/tasks.json', b, l, r);
        for (const value of [base, local, remote]) assert.equal(stableStringify(merge(value, value, value).value), stableStringify(value));
        assert.equal(stableStringify(merge(base, local, base).value), stableStringify(local));
        assert.equal(stableStringify(merge(base, base, remote).value), stableStringify(remote));
        const result = merge(base, local, remote);
        assert.equal(stableStringify(merge(structuredClone(base), structuredClone(local), structuredClone(remote))), stableStringify(result));
        // A task a side added is kept; a lost field value is in the conflict log.
        const ids = new Set(result.value.tasks.map((task) => task.id));
        for (const side of [local, remote])
            for (const task of side.tasks) if (!baseTasks.some((item) => item.id === task.id)) assert.ok(ids.has(task.id), `tohum ${seed}: ${task.id}`);
        assert.equal(ids.size, result.value.tasks.length, `tohum ${seed}: tekrar eden kimlik`);
    }
});

// docs/task-plan.md G9: both devices complete, take back and rename one repeating
// task with the real task rules; the merge loses no completion, keeps one per
// occurrence and never leaves the task due on an occurrence that is done.
test(`${CASES} rastgele tekrar eden görev düzenlemesinde tamamlama değişmezleri`, () => {
    let uuid = 0;
    const makeUuid = () => `00000000-0000-4000-8000-${String((uuid += 1)).padStart(12, '0')}`;
    const repeats = ['daily', 'weekdays', 'weekly', 'after-completion'];
    let keyedCases = 0;
    for (let seed = 1; seed <= CASES; seed += 1) {
        const rand = random(seed * 104729);
        // A device's clock only goes forward: every call is a later minute of the day `offset`.
        let tick = 0;
        const day = (offset) => new Date(Date.UTC(2026, 10, 10 + offset, 8, (tick += 1)));
        const repeat = pick(rand, repeats);
        let base = normalizePisiTask(
            { title: 'Spor', repeat, completionOffsetDays: repeat === 'after-completion' ? 2 : null, dueDate: '2026-11-10', diaryDate: '2026-11-10' },
            null,
            { now: day(0), makeUuid }
        ).task;
        for (let step = 1, count = Math.floor(rand() * 3); step <= count; step += 1) base = completePisiTask(base, { now: day(step) }).task;
        const edit = (side) => {
            let task = structuredClone(base);
            let offset = 3;
            for (let step = 1 + Math.floor(rand() * 4); step > 0; step -= 1) {
                offset += Math.floor(rand() * 3);
                const now = day(offset);
                const roll = rand();
                const next =
                    roll < 0.55
                        ? completePisiTask(task, { now })
                        : roll < 0.8
                          ? reopenPisiTask(task, null, { now })
                          : normalizePisiTask({ title: `${side} ${text(rand)}` }, task, { now, makeUuid });
                if (next.ok && next.task) task = next.task;
            }
            return task;
        };
        const local = edit('L');
        const remote = edit('R');
        const file = (task) => ({ version: 2, updatedAt: task.updatedAt, tasks: [task] });
        const merge = (b, l, r) => mergePisiSyncAuthority('.pisi/tasks.json', file(b), file(l), file(r));
        for (const value of [base, local, remote]) assert.equal(stableStringify(merge(value, value, value).value.tasks[0]), stableStringify(value));
        assert.equal(stableStringify(merge(base, local, base).value.tasks[0]), stableStringify(local));
        assert.equal(stableStringify(merge(base, base, remote).value.tasks[0]), stableStringify(remote));
        const result = merge(base, local, remote);
        assert.equal(stableStringify(merge(structuredClone(base), structuredClone(local), structuredClone(remote))), stableStringify(result), `tohum ${seed}`);
        const merged = result.value.tasks[0];
        const keys = merged.completions.map(getPisiSyncCompletionKey);
        // An 'after-completion' task completed twice on one day repeats a due day; such a list merges as a whole.
        const keyed = [base, local, remote].every((side) => new Set(side.completions.map(getPisiSyncCompletionKey)).size === side.completions.length);
        if (keyed) {
            keyedCases += 1;
            assert.equal(new Set(keys).size, keys.length, `tohum ${seed}: bir tekrar bir kez`);
            const baseKeys = new Set(base.completions.map(getPisiSyncCompletionKey));
            for (const side of [local, remote])
                for (const entry of side.completions)
                    if (!baseKeys.has(getPisiSyncCompletionKey(entry)))
                        assert.ok(keys.includes(getPisiSyncCompletionKey(entry)), `tohum ${seed}: tamamlama kayboldu`);
            const lastDone = merged.completions
                .map((entry) => entry.dueDate)
                .sort()
                .at(-1);
            if (lastDone)
                assert.ok(
                    repeat === 'after-completion' ? merged.dueDate >= lastDone : merged.dueDate > lastDone,
                    `tohum ${seed}: ${merged.dueDate} ≤ ${lastDone}`
                );
        }
        assert.ok(readPisiTask(merged), `tohum ${seed}: birleşik kayıt okunur`);
    }
    assert.ok(keyedCases > CASES * 0.8, `anahtarlanan durum ${keyedCases}`);
});
