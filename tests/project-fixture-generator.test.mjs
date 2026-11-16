// The project generator's task and diary options (scripts/generate-project-fixture.mjs),
// which the mobile large-project test (mobile/e2e/large-project.spec.mjs) relies on:
// the records are the shared rules' own, and the mobile data layer opens the
// project as it is, reads every record and writes nothing.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createNodeFsDriver } from '../mobile/src/data/drivers/node-fs-driver.mjs';
import { createProject } from '../mobile/src/data/project-repo.mjs';
import { generatePisiProjectFixture } from '../scripts/generate-project-fixture.mjs';
import { getPisiDiaryDateFromFileName } from '../shared/diary-rules.mjs';
import { normalizePisiTaskRecord } from '../shared/task-model.mjs';

function snapshot(root) {
    const files = {};
    const walk = (folder) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()) walk(full);
            else files[path.relative(root, full)] = fs.readFileSync(full, 'utf8');
        }
    };
    walk(root);
    return files;
}

test('üretici görevleri ve günlükleri ortak kurallarla yazar; mobil projeyi değiştirmeden okur', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-fixture-tasks-'));
    try {
        const result = await generatePisiProjectFixture(root, { notes: 30, perMap: 10, tasks: 200, diaryDays: 5, today: '2026-11-14' });
        assert.deepEqual([result.notes, result.maps, result.tasks, result.diaryDays], [30, 3, 200, 5]);

        const store = JSON.parse(fs.readFileSync(path.join(root, '.pisi', 'tasks.json'), 'utf8'));
        assert.equal(store.version, 1);
        assert.equal(store.tasks.length, 200);
        assert.equal(new Set(store.tasks.map((task) => task.id)).size, 200);
        // Each record is already in the shared normal form: normalizing it again changes nothing.
        const now = new Date(store.updatedAt);
        for (const task of store.tasks) {
            assert.deepEqual(normalizePisiTaskRecord(task, task, { now, makeUuid: () => 'x', normalizeStoredPath: (value) => value }), {
                ...task,
                updatedAt: now.toISOString()
            });
        }
        assert.equal(store.tasks.filter((task) => task.dueDate === '2026-11-14').length, 12);
        assert.equal(store.tasks.filter((task) => task.status === 'done').length, 38);
        assert.ok(store.tasks.every((task) => task.todoTag === `todo.${task.priority}.${task.dueDate.split('-').reverse().join('-')}`));

        const diary = fs.readdirSync(path.join(root, 'diary')).sort();
        assert.deepEqual(diary, ['.pisi-diary', '2026-11-10.node', '2026-11-11.node', '2026-11-12.node', '2026-11-13.node', '2026-11-14.node']);
        const day = JSON.parse(fs.readFileSync(path.join(root, 'diary', '2026-11-14.node'), 'utf8'));
        assert.deepEqual([day.pisi.title, day.pisi.parentMap, day.pisi.diaryDate], ['14-11-2026', 'diary', '2026-11-14']);
        assert.equal(getPisiDiaryDateFromFileName('2026-11-14.node'), '2026-11-14');

        // Same seeds, same project: runs stay comparable.
        const again = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-fixture-tasks-'));
        try {
            await generatePisiProjectFixture(again, { notes: 30, perMap: 10, tasks: 200, diaryDays: 5, today: '2026-11-14' });
            assert.deepEqual(snapshot(again), snapshot(root));
        } finally {
            fs.rmSync(again, { recursive: true, force: true });
        }

        const before = snapshot(root);
        const project = createProject({
            driver: createNodeFsDriver(root),
            now: () => new Date('2026-11-14T09:30:00+03:00'),
            makeUuid: () => crypto.randomUUID()
        });
        await project.open();
        await project.index.build();
        const listed = await project.tasks.list();
        const notes = project.notes.list();
        assert.equal(listed.tasks.length, 200);
        assert.equal(notes.filter((note) => note.kind === 'note').length, 30);
        assert.equal(notes.filter((note) => note.kind === 'diary').length, 5);
        assert.equal(project.index.getMaps().length, 3);
        assert.deepEqual(project.getIntegrity(), { healthy: true, readOnlyFiles: [] });
        await project.flush();
        assert.deepEqual(snapshot(root), before);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('görev ve günlük istenmezse üretici eskisi gibi yalnız not ve harita yazar', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pisi-fixture-plain-'));
    try {
        const result = await generatePisiProjectFixture(root, { notes: 4, perMap: 2 });
        assert.deepEqual([result.tasks, result.diaryDays], [0, 0]);
        assert.equal(fs.existsSync(path.join(root, '.pisi', 'tasks.json')), false);
        assert.equal(fs.existsSync(path.join(root, 'diary')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
