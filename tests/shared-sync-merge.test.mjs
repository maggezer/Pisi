// Merge rules of the sync core (docs/sync-plan.md §3.4), one example per
// rule: .node blocks, .map and generic JSON, authority files and conflict copies.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { splitNoteBlocks } from '../shared/note-blocks.mjs';
import {
    PISI_SYNC_CONFLICT_LABELS,
    getPisiSyncContentAssetReferences,
    makePisiSyncConflictContent,
    makePisiSyncConflictCopy,
    makePisiSyncOtherConflictPath
} from '../shared/sync-conflict.mjs';
import {
    enforcePisiSyncRelationshipRules,
    getPisiSyncAuthorityListKey,
    getPisiSyncRelationshipSemanticKey,
    isPisiSyncHierarchyRelationship,
    mergePisiSyncAuthority
} from '../shared/sync-merge-authority.mjs';
import { mergePisiSyncGenericJson, mergePisiSyncMap, pisiSyncJsonEqual, serializePisiSyncJson, stableStringify } from '../shared/sync-merge-json.mjs';
import { mergePisiSyncNode, mergePisiSyncNoteContent, splitPisiSyncNoteUnits } from '../shared/sync-merge-node.mjs';
import { getPisiSyncCompletionKey, mergePisiSyncTaskCompletions } from '../shared/sync-merge-tasks.mjs';
import { makePisiTaskBlockHtml, stripPisiTaskBlocks } from '../shared/task-blocks.mjs';
import { makePisiDiaryTaskSectionHtml, readPisiDiaryTaskSection } from '../shared/task-diary.mjs';

const require = createRequire(import.meta.url);

const block = (id, text, type = 'paragraph') => `<div class="pisi-editor-block" data-pisi-block-id="${id}" data-pisi-block-type="${type}">${text}</div>`;
const note = (content, pisi = {}, extra = {}) => ({
    pisi: {
        version: 1,
        type: 'node',
        id: 'node_aaaa',
        title: 'Not',
        sidecar: 'inv_Not__node_aaaa',
        createdAt: '2026-11-16T10:00:00.000Z',
        updatedAt: '2026-11-16T10:00:00.000Z',
        parentMap: 'none',
        ...pisi
    },
    content,
    ...extra
});
const at = (minute) => `2026-11-16T10:${String(minute).padStart(2, '0')}:00.000Z`;

test('.node: birim kesimi içeriği bayt bayt geri verir; kimliksiz Sheet veritabanı kimliğiyle anahtarlanır', () => {
    const sheet =
        '<div class="pisi-sheet-block" contenteditable="false"><table class="pisi-sheet-table" data-pisi-sheet="1" data-pisi-database-id="database-1"></table></div>';
    const canvas = '<div class="pisi-canvas-block" contenteditable="false"><canvas data-pisi-canvas="1"></canvas></div>';
    const content = `\n${block('blk_a', 'A')}\n${sheet}${canvas}${block('blk_b', 'B')}<!--x-->`;
    const units = splitPisiSyncNoteUnits(content);
    assert.equal(units.ok, true);
    assert.deepEqual(units.order, ['\u0000head', 'blk_a', 'sheet:database-1', 'blk_b']);
    assert.equal(units.order.map((key) => units.html.get(key)).join(''), content);
    assert.equal(units.html.get('sheet:database-1'), sheet + canvas, 'kimliksiz Paint önceki birime eklenir');
    const duplicate = splitPisiSyncNoteUnits(block('blk_a', 'A') + block('blk_a', 'B'));
    assert.deepEqual([duplicate.ok, duplicate.order.length], [false, 1]);
});

test('.node: ortak kurallar (yerel = temel, uzak = temel, yerel = uzak)', () => {
    const base = note(block('blk_a', 'A'));
    const changed = note(block('blk_a', 'A2'), { updatedAt: at(5) });
    assert.equal(mergePisiSyncNode({ base, local: base, remote: changed }).status, 'remote');
    assert.equal(mergePisiSyncNode({ base, local: changed, remote: base }).status, 'local');
    assert.equal(mergePisiSyncNode({ base, local: changed, remote: structuredClone(changed) }).status, 'unchanged');
});

test('.node: farklı bloklar iki tarafta değişir, eklenir ve silinir → çakışmasız birleşir', () => {
    const base = note([block('blk_a', 'A'), block('blk_b', 'B'), block('blk_c', 'C'), block('blk_d', 'D')].join('\n'));
    const local = note([block('blk_a', 'A yerel'), block('blk_b', 'B'), block('blk_x', 'X yerel'), block('blk_c', 'C')].join('\n'), { updatedAt: at(3) });
    const remote = note([block('blk_a', 'A'), block('blk_b', 'B uzak'), block('blk_c', 'C'), block('blk_d', 'D'), block('blk_y', 'Y uzak')].join('\n'), {
        updatedAt: at(4)
    });
    const result = mergePisiSyncNode({ base, local, remote });
    assert.equal(result.status, 'merged');
    assert.deepEqual(result.conflicts, []);
    assert.equal(
        result.value.content,
        [block('blk_a', 'A yerel'), block('blk_b', 'B uzak'), block('blk_x', 'X yerel'), block('blk_c', 'C'), block('blk_y', 'Y uzak')].join('\n'),
        'sıra uzak tarafın; yerelde eklenen blok yereldeki önceki komşusunun arkasında; yerelde silinen D yok'
    );
    assert.equal(result.value.pisi.updatedAt, at(4), 'updatedAt iki taraftan büyük olandır');
});

test('.node: aynı blok iki tarafta farklı → çakışma; birleşik dosyada uzak kazanır, diğer bloklar birleşir', () => {
    const base = note([block('blk_a', 'A'), block('blk_b', 'B')].join(''));
    const local = note([block('blk_a', 'A yerel'), block('blk_b', 'B yerel')].join(''));
    const remote = note([block('blk_a', 'A uzak'), block('blk_b', 'B')].join(''));
    const result = mergePisiSyncNode({ base, local, remote });
    assert.equal(result.status, 'conflict');
    assert.deepEqual(result.conflicts, [{ unit: 'blk_a', reason: 'both-changed' }]);
    assert.equal(result.value.content, [block('blk_a', 'A uzak'), block('blk_b', 'B yerel')].join(''));
});

test('.node: bir tarafta değişip öbüründe silinen blok ve kimliksiz içerik çakışmadır', () => {
    const base = note([block('blk_a', 'A'), block('blk_b', 'B')].join(''));
    const changedHere = mergePisiSyncNoteContent(base.content, block('blk_a', 'A yerel') + block('blk_b', 'B'), block('blk_b', 'B'));
    assert.deepEqual(changedHere.conflicts, [{ unit: 'blk_a', reason: 'changed-deleted' }]);
    assert.equal(changedHere.content, block('blk_b', 'B'));
    const deletedHere = mergePisiSyncNoteContent(base.content, block('blk_b', 'B'), block('blk_a', 'A uzak') + block('blk_b', 'B'));
    assert.deepEqual(deletedHere.content, block('blk_a', 'A uzak') + block('blk_b', 'B'));
    const legacy = mergePisiSyncNoteContent('<p>eski</p>', '<p>eski yerel</p>', '<p>eski uzak</p>');
    assert.deepEqual(legacy, { content: '<p>eski uzak</p>', conflicts: [{ unit: null, reason: 'unidentified' }] });
});

test('.node: pisi ve properties anahtar düzeyinde birleşir; aynı anahtar farklıysa çakışma', () => {
    const base = note(block('blk_a', 'A'), {}, { properties: { durum: 'açık', puan: 1 } });
    const local = note(block('blk_a', 'A'), { title: 'Yeni ad' }, { properties: { durum: 'açık', puan: 2 } });
    const remote = note(block('blk_a', 'A'), { updatedAt: at(9) }, { properties: { durum: 'kapalı', puan: 1, etiket: 'x' } });
    const merged = mergePisiSyncNode({ base, local, remote });
    assert.equal(merged.status, 'merged');
    assert.deepEqual(merged.value.properties, { durum: 'kapalı', puan: 2, etiket: 'x' });
    assert.deepEqual([merged.value.pisi.title, merged.value.pisi.updatedAt], ['Yeni ad', at(9)]);
    const clash = mergePisiSyncNode({ base, local, remote: note(block('blk_a', 'A'), { title: 'Başka ad' }, { properties: base.properties }) });
    assert.deepEqual(clash.conflicts, [{ unit: null, field: 'pisi.title', reason: 'both-changed' }]);
    assert.equal(clash.value.pisi.title, 'Başka ad');
});

test('.node: aynı yolda iki yeni dosya — kimlik farklıysa kopya, aynıysa boş temelle birleşir', () => {
    const remote = note(block('blk_a', 'A'));
    assert.equal(mergePisiSyncNode({ local: note(block('blk_b', 'B'), { id: 'node_bbbb' }), remote }).status, 'conflict');
    const same = mergePisiSyncNode({ local: note(block('blk_a', 'A') + block('blk_b', 'B')), remote });
    assert.deepEqual([same.status, same.value.content], ['merged', block('blk_a', 'A') + block('blk_b', 'B')]);
});

test('.node: aynı gün iki cihazda yazılan günlük tek dosyada birleşir (önce uzak, sonra yerel)', () => {
    const remote = note(block('blk_m1', 'Masaüstü satırı'), {
        id: 'node_desk',
        title: '16-11-2026',
        parentMap: 'diary',
        diaryDate: '2026-11-16',
        updatedAt: at(1)
    });
    const local = note(block('blk_p1', 'Telefon satırı'), {
        id: 'node_phone',
        title: '16-11-2026',
        parentMap: 'diary',
        diaryDate: '2026-11-16',
        updatedAt: at(2)
    });
    const result = mergePisiSyncNode({ local, remote, diary: true });
    assert.equal(result.status, 'merged');
    assert.equal(result.value.pisi.id, 'node_desk', 'uzak dosyanın kimliği korunur');
    assert.equal(result.value.content, block('blk_m1', 'Masaüstü satırı') + block('blk_p1', 'Telefon satırı'));
    assert.equal(result.value.pisi.updatedAt, at(2));
});

// docs/task-plan.md G9: the diary's task section is derived from tasks.json (GV15).
const section = (ids, day = '2026-11-16') => makePisiDiaryTaskSectionHtml(day, ids);
const diary = (content, pisi = {}) => note(content, { title: '16-11-2026', parentMap: 'diary', diaryDate: '2026-11-16', ...pisi });

test('.node: günlük görev bölümü iki tarafta farklı → çakışma değil; uzak bölüm son blok olarak kalır', () => {
    const base = `${block('blk_a', 'Bir')}${block('blk_b', 'İki')}${section(['task_aaaa'])}`;
    const local = `${block('blk_a', 'Bir telefon')}${block('blk_b', 'İki')}${block('blk_l', 'Yerel yeni')}${section(['task_aaaa', 'task_bbbb'])}`;
    const remote = `${block('blk_a', 'Bir')}${block('blk_b', 'İki masaüstü')}${section(['task_aaaa', 'task_cccc'])}`;
    const merged = mergePisiSyncNoteContent(base, local, remote);
    assert.deepEqual(merged.conflicts, []);
    assert.equal(
        merged.content,
        `${block('blk_a', 'Bir telefon')}${block('blk_b', 'İki masaüstü')}${block('blk_l', 'Yerel yeni')}${section(['task_aaaa', 'task_cccc'])}`
    );
    const read = readPisiDiaryTaskSection(merged.content);
    assert.deepEqual([read.count, read.last], [1, true]);

    // A section only one side changed, or only one side has, follows the usual rule.
    assert.equal(mergePisiSyncNoteContent(base, base.replace('Bir', 'Bir!'), remote).content, remote.replace('>Bir<', '>Bir!<'));
    const noSection = `${block('blk_a', 'Bir')}${block('blk_b', 'İki')}`;
    assert.equal(mergePisiSyncNoteContent(base, noSection, base.replace('İki', 'İki!')).content, noSection.replace('İki', 'İki!'));
    // A block added after the section on one side does not push the section from the end.
    const after = mergePisiSyncNoteContent(base, `${base}${block('blk_z', 'Sonra')}`, remote).content;
    assert.equal(readPisiDiaryTaskSection(after).last, true);
    assert.equal(mergePisiSyncNode({ base: diary(base), local: diary(local), remote: diary(remote), diary: true }).status, 'merged');
});

test('.node: iki cihazda oluşan günlük — tek bölüm, boş ilk satır çakışma değil, eski ayraçlar çakışma', () => {
    const remote = diary(`<div><br></div>${section(['task_cccc'])}`, { id: 'node_desk', updatedAt: at(1) });
    const local = diary(`<div><br></div>${block('blk_p', 'Telefon')}${section(['task_bbbb'])}`, { id: 'node_phone', updatedAt: at(2) });
    const result = mergePisiSyncNode({ local, remote, diary: true });
    assert.equal(result.status, 'merged');
    assert.equal(result.value.pisi.id, 'node_desk');
    assert.equal(result.value.content, `<div><br></div>${block('blk_p', 'Telefon')}${section(['task_cccc'])}`);
    const onlyLocal = mergePisiSyncNode({ local, remote: diary(block('blk_m', 'Masaüstü'), { id: 'node_desk' }), diary: true });
    assert.equal(onlyLocal.value.content, `${block('blk_m', 'Masaüstü')}${block('blk_p', 'Telefon')}${section(['task_bbbb'])}`, 'tek bölüm yerelden');
    const text = mergePisiSyncNode({ local: diary(`Yazı${section(['task_bbbb'])}`, { id: 'node_phone' }), remote, diary: true });
    assert.equal(text.status, 'conflict', 'ilk bloktan önceki metin çakışmadır');
    const managed = '<!--PISI_DIARY_MANAGED_START--><div class="pisi-diary-managed-block">x</div><!--PISI_DIARY_MANAGED_END-->';
    assert.equal(mergePisiSyncNode({ local: diary(managed, { id: 'node_p' }), remote: diary(`${managed} `), diary: true }).status, 'conflict');
});

test('.map: kimlikli diziler kimliğe göre, kamera çakışmasında uzak kazanır, silme kazanır', () => {
    const map = (nodes, extra = {}) => ({
        pisi: { version: 1, type: 'map', id: 'map_1', title: 'Harita', updatedAt: extra.updatedAt || at(0) },
        map: {
            nodes,
            relationshipViews: extra.views || [],
            relationshipViewVersion: 1,
            collapsedHubs: extra.hubs || [],
            camera: extra.camera || { x: 0, y: 0, zoom: 1 }
        }
    });
    const n = (id, x) => ({ id, x, y: 0, width: 220, height: 92 });
    const base = map([n('node_a', 0), n('node_b', 0), n('node_c', 0)], { hubs: ['node_a'] });
    const local = map([n('node_a', 10), n('node_b', 0), n('node_c', 5), n('node_l', 1)], {
        camera: { x: 5, y: 0, zoom: 1 },
        hubs: ['node_a', 'node_l'],
        updatedAt: at(7)
    });
    const remote = map([n('node_a', 0), n('node_b', 20), n('node_r', 2)], {
        camera: { x: 9, y: 0, zoom: 2 },
        hubs: [],
        views: [{ relationshipId: 'edge_1', sourcePort: 'top' }]
    });
    const { value, conflicts } = mergePisiSyncMap(base, local, remote);
    assert.deepEqual(
        value.map.nodes.map((node) => [node.id, node.x]),
        [
            ['node_a', 10],
            ['node_b', 20],
            ['node_l', 1],
            ['node_r', 2]
        ],
        'node_c uzakta silindi, yerelde değişti: silme kazanır; node_l yereldeki önceki komşusunun (node_b) arkasında'
    );
    assert.deepEqual(value.map.camera, { x: 9, y: 0, zoom: 2 });
    assert.deepEqual(value.map.collapsedHubs, ['node_l']);
    assert.deepEqual(value.map.relationshipViews, [{ relationshipId: 'edge_1', sourcePort: 'top' }]);
    assert.equal(value.pisi.updatedAt, at(7));
    assert.deepEqual(
        conflicts.map((conflict) => [conflict.path, conflict.kept]),
        [
            ['map.nodes[node_c]', 'delete'],
            ['map.camera.x', 'remote']
        ]
    );
});

test('genel JSON: kimlikli kayıtlar birleşir, değişiklik silmeyi yener, updatedAt büyük olandır', () => {
    const base = {
        version: 1,
        views: [
            { id: 'v1', name: 'A' },
            { id: 'v2', name: 'B' }
        ],
        updatedAt: at(0)
    };
    const local = {
        version: 1,
        views: [
            { id: 'v1', name: 'A yerel' },
            { id: 'v3', name: 'C' }
        ],
        updatedAt: at(8)
    };
    const remote = {
        version: 1,
        views: [
            { id: 'v1', name: 'A' },
            { id: 'v2', name: 'B uzak' }
        ],
        updatedAt: at(4)
    };
    const { value } = mergePisiSyncGenericJson(base, local, remote);
    assert.deepEqual(value, {
        version: 1,
        views: [
            { id: 'v1', name: 'A yerel' },
            { id: 'v3', name: 'C' },
            { id: 'v2', name: 'B uzak' }
        ],
        updatedAt: at(8)
    });
    assert.equal(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] }), '{"a":[1,{"d":2}],"b":1}');
    assert.equal(serializePisiSyncJson({ a: 1 }), '{\n  "a": 1\n}');
});

const task = (id, fields = {}) => ({
    id,
    title: id,
    status: 'todo',
    priority: 3,
    dueDate: null,
    source: { nodePath: null, blockId: null },
    createdAt: at(0),
    updatedAt: at(0),
    completedAt: null,
    ...fields
});

test('tasks.json: kayıtlar kimliğe göre, alanlar ayrı ayrı birleşir; aynı alanda updatedAt büyük olan kazanır', () => {
    const base = { version: 1, updatedAt: at(0), tasks: [task('task_a'), task('task_b'), task('task_c')] };
    const local = {
        version: 1,
        updatedAt: at(6),
        futureSetting: { keep: true },
        tasks: [
            task('task_a', { status: 'done', completedAt: at(6), updatedAt: at(6) }),
            task('task_b', { priority: 5, updatedAt: at(2) }),
            task('task_c', { title: 'C yerel', updatedAt: at(1) }),
            task('task_l')
        ]
    };
    const remote = {
        version: 1,
        updatedAt: at(5),
        tasks: [task('task_a', { title: 'A uzak', updatedAt: at(5) }), task('task_b', { priority: 1, updatedAt: at(3) }), task('task_r', { futureField: 1 })]
    };
    const { value, conflicts } = mergePisiSyncAuthority('.pisi/tasks.json', base, local, remote);
    assert.deepEqual(Object.keys(value), ['version', 'updatedAt', 'tasks', 'futureSetting']);
    assert.equal(value.updatedAt, at(6));
    assert.deepEqual(value.futureSetting, { keep: true });
    const byId = Object.fromEntries(value.tasks.map((record) => [record.id, record]));
    assert.deepEqual(Object.keys(byId), ['task_a', 'task_b', 'task_l', 'task_r']);
    assert.deepEqual(
        [byId.task_a.status, byId.task_a.title, byId.task_a.updatedAt],
        ['done', 'A uzak', at(6)],
        'telefon tamamladı, masaüstü başlığı değiştirdi: ikisi de kalır'
    );
    assert.equal(byId.task_b.priority, 1, 'aynı alan: updatedAt büyük olan (uzak) kazanır');
    assert.equal(byId.task_r.futureField, 1, 'bilinmeyen alan korunur');
    assert.deepEqual(
        conflicts.map((conflict) => [conflict.recordId, conflict.field, conflict.kind, conflict.winner, conflict.lost]),
        [
            ['task_b', 'priority', 'field', 'remote', 5],
            ['task_c', null, 'deleted-changed', 'remote', task('task_c', { title: 'C yerel', updatedAt: at(1) })]
        ]
    );
    const tie = mergePisiSyncAuthority(
        '.pisi/tasks.json',
        base,
        { ...base, tasks: [task('task_a', { priority: 4 })] },
        { ...base, tasks: [task('task_a', { priority: 2 })] }
    );
    assert.equal(tie.value.tasks[0].priority, 2, 'updatedAt eşitse uzak kazanır');
    assert.equal(getPisiSyncAuthorityListKey('.pisi/Properties.json'), 'definitions');
});

// docs/task-plan.md G9: completions merge by occurrence.
const repeating = (fields = {}) =>
    task('task_r', { repeat: 'daily', dueDate: '2026-11-21', reminderAt: '2026-11-21T07:00', completions: [], source: undefined, ...fields });
const done = (dueDate, minute, date = dueDate) => ({ date, dueDate, at: at(minute) });
const merge = (base, local, remote) => {
    const result = mergePisiSyncAuthority('.pisi/tasks.json', { version: 2, tasks: [base] }, { version: 2, tasks: [local] }, { version: 2, tasks: [remote] });
    return { record: result.value.tasks[0], conflicts: result.conflicts };
};

test('tasks.json: aynı tekrar iki tarafta tamamlanırsa önce tamamlanan kalır, tek ilerleme', () => {
    const base = repeating();
    const { record, conflicts } = merge(
        base,
        repeating({ dueDate: '2026-11-22', reminderAt: '2026-11-22T07:00', completions: [done('2026-11-21', 30)], updatedAt: at(30) }),
        repeating({ dueDate: '2026-11-22', reminderAt: '2026-11-22T07:00', completions: [done('2026-11-21', 10)], updatedAt: at(10) })
    );
    assert.deepEqual(record.completions, [done('2026-11-21', 10)]);
    assert.equal(record.dueDate, '2026-11-22');
    assert.equal(record.updatedAt, at(30));
    assert.deepEqual(
        conflicts.map((c) => [c.field, c.kind, c.winner, c.lost]),
        [['completions', 'completion', 'remote', done('2026-11-21', 30)]]
    );
});

test('tasks.json: farklı tekrarların tamamlamaları birleşir; ilerleme geri gitmez', () => {
    const base = repeating({ completions: [done('2026-11-20', 1)] });
    const local = repeating({ title: 'Yeni ad', completions: [done('2026-11-20', 1)], updatedAt: at(50) });
    const remote = repeating({
        dueDate: '2026-11-23',
        reminderAt: '2026-11-23T07:00',
        completions: [done('2026-11-20', 1), done('2026-11-21', 20), done('2026-11-22', 21)],
        updatedAt: at(21)
    });
    assert.deepEqual(merge(base, local, remote).record.completions, remote.completions, 'yalnız bir taraf değiştirdi');

    const localDone = repeating({
        dueDate: '2026-11-22',
        reminderAt: '2026-11-22T07:00',
        completions: [done('2026-11-20', 1), done('2026-11-21', 40)],
        updatedAt: at(50)
    });
    const { record, conflicts } = merge(base, localDone, remote);
    assert.deepEqual(record.completions, [done('2026-11-20', 1), done('2026-11-21', 20), done('2026-11-22', 21)], '"at" sırasıyla');
    assert.deepEqual([record.dueDate, record.reminderAt], ['2026-11-23', '2026-11-23T07:00'], 'tamamlanmış bir tekrara geri dönülmez');
    assert.deepEqual(
        conflicts.map((c) => [c.field, c.kind, c.winner]),
        [
            ['completions', 'completion', 'remote'],
            ['dueDate', 'progress', 'remote']
        ]
    );
});

test('tasks.json: geri alınan tamamlama ile öbür taraftaki değişiklik', () => {
    const base = repeating({ dueDate: '2026-11-22', completions: [done('2026-11-21', 5)], updatedAt: at(5) });
    const reopened = repeating({ dueDate: '2026-11-21', completions: [], updatedAt: at(8) });
    const renamed = { ...base, title: 'Telefon adı', updatedAt: at(9) };
    const one = merge(base, reopened, renamed);
    assert.deepEqual([one.record.completions, one.record.dueDate, one.record.title], [[], '2026-11-21', 'Telefon adı']);
    assert.deepEqual(one.conflicts, []);

    // Taken back on one side, completed again later on the other: the record's updatedAt decides.
    const again = { ...base, completions: [done('2026-11-21', 30)], updatedAt: at(30) };
    const two = merge(base, reopened, again);
    assert.deepEqual([two.record.completions, two.record.dueDate], [[done('2026-11-21', 30)], '2026-11-22'], 'tamamlanan tekrara geri dönülmez');
    assert.deepEqual(
        two.conflicts.map((c) => [c.field, c.kind, c.winner]),
        [
            ['completions', 'completion', 'remote'],
            ['dueDate', 'progress', 'remote']
        ]
    );
});

test('tasks.json: tekrarsız görev iki tarafta tamamlanırsa önce tamamlanan kalır', () => {
    const base = task('task_n', { completedOn: null });
    const { record, conflicts } = merge(
        base,
        task('task_n', { status: 'done', completedAt: at(7), completedOn: '2026-11-16', updatedAt: at(40) }),
        task('task_n', { status: 'done', completedAt: at(9), completedOn: '2026-11-17', updatedAt: at(9) })
    );
    assert.deepEqual([record.completedAt, record.completedOn, record.updatedAt], [at(7), '2026-11-16', at(40)]);
    assert.deepEqual(
        conflicts.map((c) => [c.field, c.kind, c.winner, c.lost]),
        [['completedAt', 'completion', 'local', { completedAt: at(9), completedOn: '2026-11-17' }]]
    );
});

test('tamamlama anahtarı tekrarın bitiş günüdür; anahtarlanamayan liste bütün olarak birleşir', () => {
    assert.equal(getPisiSyncCompletionKey(done('2026-11-21', 1, '2026-11-24')), 'due:2026-11-21');
    assert.equal(getPisiSyncCompletionKey({ date: '2026-11-24', dueDate: null, at: at(1) }), 'day:2026-11-24');
    assert.equal(getPisiSyncCompletionKey('x'), null);
    assert.equal(mergePisiSyncTaskCompletions({ base: [], local: [done('2026-11-21', 1), done('2026-11-21', 2)], remote: [] }), null);
    const { record, conflicts } = merge(
        repeating(),
        repeating({ completions: 'bozuk', updatedAt: at(2) }),
        repeating({ completions: [done('2026-11-21', 1)], updatedAt: at(1) })
    );
    assert.equal(record.completions, 'bozuk', 'eski kural: updatedAt büyük olan');
    assert.deepEqual(
        conflicts.map((c) => [c.field, c.kind]),
        [['completions', 'field']]
    );
});

test('properties.json: tanımlar kimliğe göre birleşir; boş temelle iki yeni dosya birleşir', () => {
    const local = {
        version: 1,
        definitions: [
            { id: 'systemRole', name: 'Sistem rolü', type: 'text', system: true },
            { id: 'durum', name: 'Durum', type: 'text' }
        ],
        conflicts: [],
        updatedAt: at(1)
    };
    const remote = {
        version: 1,
        definitions: [
            { id: 'systemRole', name: 'Sistem rolü', type: 'text', system: true },
            { id: 'puan', name: 'Puan', type: 'number' }
        ],
        conflicts: [],
        updatedAt: at(2)
    };
    const { value, conflicts } = mergePisiSyncAuthority('.pisi/properties.json', null, local, remote);
    assert.deepEqual(
        value.definitions.map((definition) => definition.id),
        ['systemRole', 'durum', 'puan']
    );
    assert.deepEqual([value.updatedAt, conflicts], [at(2), []]);
});

const rel = (id, sourceId, targetId, type = 'down-hub', updatedAt = at(0)) => ({
    id,
    sourceId,
    targetId,
    type,
    sourceRole: type === 'down-hub' ? 'down-hub' : type === 'stream' ? 'downstream' : 'co-level',
    targetRole: type === 'down-hub' ? 'up-hub' : type === 'stream' ? 'upstream' : 'co-level',
    direction: type === 'co-level' ? 'undirected' : 'directed',
    createdAt: at(0),
    updatedAt
});

test('relationships.json: masaüstü kuralını çiğneten yerel değişiklik bırakılır ve günlüğe yazılır', () => {
    const base = { version: 1, relationships: [rel('edge_1', 'node_p', 'node_c')] };
    // Remote gives node_x a parent; local gives it another one, makes a cycle and duplicates edge_1.
    const remote = { version: 1, relationships: [rel('edge_1', 'node_p', 'node_c'), rel('edge_2', 'node_p', 'node_x')] };
    const local = {
        version: 1,
        relationships: [
            rel('edge_1', 'node_p', 'node_c'),
            rel('edge_3', 'node_q', 'node_x'),
            rel('edge_4', 'node_c', 'node_p'),
            rel('edge_5', 'node_p', 'node_c'),
            rel('edge_6', 'node_c', 'node_y', 'stream')
        ]
    };
    const { value, conflicts } = mergePisiSyncAuthority('.pisi/relationships.json', base, local, remote);
    assert.deepEqual(
        value.relationships.map((record) => record.id),
        ['edge_1', 'edge_6', 'edge_2']
    );
    assert.deepEqual(
        conflicts.map((conflict) => [conflict.recordId, conflict.reason]),
        [
            ['edge_3', 'second-parent'],
            ['edge_4', 'hierarchy-cycle'],
            ['edge_5', 'semantic-duplicate']
        ]
    );
    const selfLink = enforcePisiSyncRelationshipRules([rel('edge_9', 'node_a', 'node_a')], [], []);
    assert.deepEqual(selfLink, []);
});

test('ilişki kuralları masaüstünün filesystem-core kurallarıyla aynı', () => {
    const { loadPisiMainStores } = require('./main-store-harness.cjs');
    const filesystemCore = loadPisiMainStores()['main.filesystemCore'];
    const samples = [
        rel('edge_1', 'node_a', 'node_b'),
        rel('edge_2', 'node_b', 'node_a', 'co-level'),
        rel('edge_3', 'node_a', 'node_b', 'stream'),
        { ...rel('edge_4', 'node_a', 'node_b'), sourceRole: 'downstream' },
        rel('edge_5', 'node_a', 'node_a'),
        rel('edge_6', 'node_a', 'map_b'),
        { ...rel('edge_7', 'node_a', 'node_b'), type: 'odd' }
    ];
    for (const sample of samples) {
        assert.equal(getPisiSyncRelationshipSemanticKey(sample), filesystemCore.getPisiEdgeSemanticKey(sample), sample.id);
        assert.equal(isPisiSyncHierarchyRelationship(sample), filesystemCore.isHierarchyEdge(sample), sample.id);
    }
});

test('çakışma kopyası: başlık, yeni kimlik, sidecar, ekler ve salt metin görev', () => {
    const content = [
        block('blk_a', 'Metin &amp; daha'),
        '<div class="pisi-editor-block" data-pisi-block-id="blk_t"><span class="pisi-todo-source" data-pisi-todo-for="todo.2.14-11-2026">Raporu gönder</span> <span class="pisi-user-tag" data-pisi-tag="todo.2.14-11-2026" data-pisi-todo-status="todo" contenteditable="false">todo.2.14-11-2026</span></div>',
        '<div class="pisi-editor-block pisi-image-block" data-pisi-block-id="blk_i" data-pisi-block-type="image"><img data-pisi-image-asset="image/abc.png" alt=""></div>'
    ].join('');
    const original = note(
        content,
        { id: 'node_orig', title: 'Toplantı', sidecar: 'inv_Toplantı__node_orig', parentMap: 'map_1' },
        { properties: { durum: 'açık' } }
    );
    const taken = new Set(['notlar/toplantı (çakışma 16-11-2026 13.05 pixel 7).node']);
    const copy = makePisiSyncConflictCopy({
        path: 'notlar/Toplantı.node',
        document: original,
        deviceName: 'Pixel 7',
        now: new Date(2026, 10, 16, 13, 5),
        makeUuid: () => '1111-2222',
        isTaken: (path) => taken.has(path.toLowerCase())
    });
    assert.equal(copy.document.pisi.title, 'Toplantı (çakışma 16-11-2026 13.05 Pixel 7)');
    assert.equal(copy.path, 'notlar/Toplantı (çakışma 16-11-2026 13.05 Pixel 7)__node_1111-2222.node', 'ad doluysa kimlik eklenir');
    assert.deepEqual(
        [copy.document.pisi.id, copy.document.pisi.parentMap, copy.document.pisi.sidecar, copy.sidecar],
        [
            'node_1111-2222',
            'map_1',
            'inv_Toplantı (çakışma 16-11-2026 13.05 Pixel 7)__node_1111-2222',
            'notlar/inv_Toplantı (çakışma 16-11-2026 13.05 Pixel 7)__node_1111-2222'
        ]
    );
    assert.deepEqual(copy.document.properties, { durum: 'açık' });
    assert.deepEqual(copy.assets, [
        { from: 'notlar/inv_Toplantı__node_orig/image/abc.png', to: 'notlar/inv_Toplantı (çakışma 16-11-2026 13.05 Pixel 7)__node_1111-2222/image/abc.png' }
    ]);
    const blocks = splitNoteBlocks(copy.document.content).map((segment) => [segment.blockId, segment.blockType]);
    assert.deepEqual(blocks, [
        ['blk_a', 'paragraph'],
        ['blk_t', 'paragraph'],
        ['blk_i', 'image']
    ]);
    assert.match(copy.document.content, /data-pisi-block-id="blk_t" data-pisi-block-type="paragraph">Raporu gönder<\/div>/);
    assert.equal(original.content, content, 'girdi değişmez');
    assert.deepEqual(getPisiSyncContentAssetReferences(content), ['image/abc.png']);
});

test('günlük çakışması kökte normal not olur; görev bölümü kopyaya girmez', () => {
    const content = `${block('blk_a', 'Gün')}\n<h3 class="pisi-editor-block" data-pisi-block-id="blk_h">Görevler</h3>\n<!--PISI_DIARY_MANAGED_START-->\n<div class="pisi-diary-managed-block" data-pisi-task-id="task_1">x</div>\n<!--PISI_DIARY_MANAGED_END-->`;
    const copy = makePisiSyncConflictCopy({
        path: 'diary/2026-11-14.node',
        document: note(content, { id: 'node_day', title: '14-11-2026', sidecar: 'inv_14-11-2026__node_day', parentMap: 'diary', diaryDate: '2026-11-14' }),
        deviceName: 'Pixel 7',
        now: new Date(2026, 10, 16, 9, 0),
        makeUuid: () => 'u1'
    });
    assert.equal(copy.path, 'Günlük çakışması 14-11-2026 (Pixel 7).node');
    assert.equal(copy.document.pisi.parentMap, 'none');
    assert.equal('diaryDate' in copy.document.pisi, false);
    assert.equal(makePisiSyncConflictContent(content), `${block('blk_a', 'Gün')}\n\n`);
    assert.equal(PISI_SYNC_CONFLICT_LABELS.conflict, 'çakışma');
});

test('çakışma kopyası görev bloklarını ve günlük görev bölümünü almaz (G9)', () => {
    const content = [
        block('blk_a', 'Metin'),
        makePisiTaskBlockHtml({ blockId: 'blk_t', taskId: 'task_aaaa' }),
        block('blk_b', 'Son'),
        section(['task_aaaa', 'task_bbbb'], '2026-11-14')
    ].join('\n');
    const copy = makePisiSyncConflictCopy({
        path: 'diary/2026-11-14.node',
        document: note(content, { id: 'node_day', title: '14-11-2026', parentMap: 'diary', diaryDate: '2026-11-14' }),
        now: new Date(2026, 10, 16, 9, 0),
        makeUuid: () => 'u2'
    });
    assert.equal(copy.document.content, stripPisiTaskBlocks(content));
    assert.equal(copy.document.content, `${block('blk_a', 'Metin')}\n\n${block('blk_b', 'Son')}\n`);
});

test('diğer dosyalarda çakışma kopyasının adı', () => {
    const now = new Date(2026, 10, 16, 8, 7);
    assert.equal(
        makePisiSyncOtherConflictPath({ path: 'ekler/rapor.pdf', deviceName: 'Masa/üstü', now }),
        'ekler/rapor (çakışma 16-11-2026 08.07 Masa_üstü).pdf'
    );
    assert.equal(
        makePisiSyncOtherConflictPath({ path: 'BENİOKU', now, isTaken: (path) => path === 'BENİOKU (çakışma 16-11-2026 08.07)' }),
        'BENİOKU (çakışma 16-11-2026 08.07 2)'
    );
    assert.equal(pisiSyncJsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
});
