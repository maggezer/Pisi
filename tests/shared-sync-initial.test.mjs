// Pure rules of the first transfer (shared/sync-initial.mjs, docs/sync-plan.md S6):
// which project is only a skeleton, which files a phone needs first, and how a
// large turn is cut into batches.

import assert from 'node:assert/strict';
import test from 'node:test';
import { utf8Encode } from '../shared/sync-crypto.mjs';
import {
    getPisiSyncActionDownloadSize,
    getPisiSyncLocalDate,
    isPisiSyncFirstPriorityPath,
    isPisiSyncSkeletonFile,
    isPisiSyncSkeletonProject,
    splitPisiSyncApplyBatches
} from '../shared/sync-initial.mjs';

const json = (value) => utf8Encode(JSON.stringify(value));

test('iskelet: boş .pisi dosyaları ve günlük işareti; kaydı olan ya da okunamayan dosya iskelet değildir', async () => {
    assert.equal(isPisiSyncSkeletonFile('diary/.pisi-diary', null), true);
    assert.equal(isPisiSyncSkeletonFile('.pisi/properties.json', json({ version: 1, definitions: [], conflicts: [] })), true);
    assert.equal(isPisiSyncSkeletonFile('.pisi/tasks.json', json({ version: 1, tasks: [] })), true);
    assert.equal(isPisiSyncSkeletonFile('.pisi/tasks.json', json({ version: 1, tasks: [{ id: 'task_1' }] })), false);
    assert.equal(isPisiSyncSkeletonFile('.pisi-views.json', json({ views: [{ id: 'v' }] })), false);
    assert.equal(isPisiSyncSkeletonFile('.pisi/tasks.json', utf8Encode('{bozuk')), false);
    assert.equal(isPisiSyncSkeletonFile('Not.node', json({ pisi: {} })), false);

    const files = { '.pisi/properties.json': json({ definitions: [] }), 'diary/.pisi-diary': utf8Encode('x') };
    const read = async (path) => files[path];
    assert.equal(
        await isPisiSyncSkeletonProject(
            Object.keys(files).map((path) => ({ path })),
            read
        ),
        true
    );
    assert.equal(
        await isPisiSyncSkeletonProject(
            [...Object.keys(files), 'diary/2026-11-18.node'].map((path) => ({ path })),
            read
        ),
        false
    );
    assert.equal(await isPisiSyncSkeletonProject([], read), true);
});

test('öncelik: otorite dosyaları, günlük işareti ve yalnız bugünün günlüğü', () => {
    const today = getPisiSyncLocalDate(new Date(2026, 10, 18, 23, 30));
    assert.equal(today, '2026-11-18');
    for (const path of ['.pisi/tasks.json', '.pisi/relationships.json', '.pisi/properties.json', 'diary/.pisi-diary', 'diary/2026-11-18.node']) {
        assert.equal(isPisiSyncFirstPriorityPath(path, today), true, path);
    }
    for (const path of ['diary/2026-11-17.node', 'Not.node', '.pisi-views.json', 'Harita.map'])
        assert.equal(isPisiSyncFirstPriorityPath(path, today), false, path);
});

test('partiler: öncelikliler kendi partisinde önde; sonra dosya ve bayt sınırıyla; indirmeyen eylemler sayılmaz', () => {
    const pull = (path, size = 10) => ({ type: 'pull', path, change: { meta: { size } } });
    const actions = [
        pull('a.node'),
        pull('.pisi/tasks.json'),
        { type: 'push-put', path: 'yerel.node' },
        pull('b.node'),
        pull('c.node', 900),
        pull('d.node', 200)
    ];
    const batches = splitPisiSyncApplyBatches(actions, { files: 2, bytes: 1000, priority: (path) => path.startsWith('.pisi/') });
    assert.deepEqual(
        batches.map((batch) => batch.map((action) => action.path)),
        [['.pisi/tasks.json'], ['a.node', 'yerel.node', 'b.node'], ['c.node'], ['d.node']]
    );
    assert.deepEqual(
        splitPisiSyncApplyBatches(actions, { files: 50 }).map((batch) => batch.length),
        [6]
    );
    assert.equal(getPisiSyncActionDownloadSize(pull('x', 42)), 42);
    assert.equal(getPisiSyncActionDownloadSize({ type: 'adopt', change: { meta: { size: 42 } } }), 0);
});
