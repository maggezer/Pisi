// The Tags panel and the links panel count tasks (docs/task-plan.md G6):
// tags come from the task records, links from [[…]] text in task titles. No
// note is read for either.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getPisiTagPanelModel, listPisiTaggedTasks } from '../renderer/tags/pisi-tag-panel-core.mjs';
import { buildPisiRelationshipModel, pisiSearchPathKey } from '../renderer/search/pisi-search-core.mjs';

const normalizeTag = (value) =>
    String(value || '')
        .trim()
        .replace(/^#/, '');

test('a tag counts its blocks and its tasks; a task counts once per tag', () => {
    const blocks = [
        { blockId: 'blk_1', tags: ['proje', '#proje'] },
        { blockId: 'blk_2', tags: ['toplantı'] }
    ];
    const tasks = [
        { id: 'task_a1', title: 'A', tags: ['proje', 'acil'] },
        { id: 'task_b2', title: 'B', tags: ['acil'] },
        { id: 'task_c3', title: 'C' }
    ];
    const model = getPisiTagPanelModel(blocks, tasks, normalizeTag);
    assert.deepEqual(model.tags, ['acil', 'proje', 'toplantı']);
    assert.deepEqual(Object.fromEntries(model.counts), { proje: 2, toplantı: 1, acil: 2 });
    assert.deepEqual(getPisiTagPanelModel([], [], normalizeTag).tags, []);
});

test('the tasks of a tag: open ones first, then by title', () => {
    const tasks = [
        { id: 'task_a1', title: 'Zeki', status: 'todo', tags: ['acil'] },
        { id: 'task_b2', title: 'Ali', status: 'done', tags: ['acil'] },
        { id: 'task_c3', title: 'Çiçek', status: 'doing', tags: ['acil', 'ev'] },
        { id: 'task_d4', title: 'Başka', status: 'todo', tags: ['ev'] }
    ];
    assert.deepEqual(
        listPisiTaggedTasks(tasks, '#acil', normalizeTag).map((task) => task.id),
        ['task_c3', 'task_a1', 'task_b2']
    );
    assert.deepEqual(listPisiTaggedTasks(tasks, '', normalizeTag), []);
});

function makeIndex(...documents) {
    return { documents: new Map(documents.map((document) => [pisiSearchPathKey(document.path), document])), maps: [] };
}

const note = (path, title, metadata) => ({ path, title, metadata, directTitles: [], directIds: [], directPaths: [], memberships: [] });

test('backlinks count the tasks whose title links to the note; a note links out through its own tasks', () => {
    const plan = note('/p/Proje Planı.node', 'Proje Planı', { id: 'node_plan' });
    const meeting = note('/p/Toplantı.node', 'Toplantı', { id: 'node_meeting' });
    const diary = note('/p/diary/2026-11-22.node', '22 Kasım', { id: 'node_diary', diaryDate: '2026-11-22' });
    const index = makeIndex(plan, meeting, diary);
    const tasks = [
        { id: 'task_in_meeting', title: 'Bütçeyi [[proje planı]] ile karşılaştır', noteId: 'node_meeting' },
        { id: 'task_in_diary', title: 'Oku: [[Proje Planı#blk_a1]], [[Toplantı]]', diaryDate: '2026-11-22' },
        { id: 'task_own', title: 'Kendi [[Proje Planı]] bağlantısı', noteId: 'node_plan' },
        { id: 'task_other', title: 'İlgisiz [[Başka]]', noteId: 'node_meeting' }
    ];

    const toPlan = buildPisiRelationshipModel(index, plan.path, { tasks });
    assert.deepEqual(
        toPlan.inboundTasks.map((task) => task.id),
        ['task_in_meeting', 'task_in_diary'],
        "the note's own task is not a backlink"
    );
    assert.deepEqual(toPlan.inbound, [], 'tasks are not counted as note backlinks');

    const fromDiary = buildPisiRelationshipModel(index, diary.path, { tasks });
    assert.deepEqual(
        fromDiary.outbound.map((item) => [item.path, item.types]),
        [
            [plan.path, ['task']],
            [meeting.path, ['task']]
        ]
    );
    const fromMeeting = buildPisiRelationshipModel(index, meeting.path, { tasks });
    assert.deepEqual(
        fromMeeting.outbound.map((item) => item.path),
        [plan.path],
        'a link to a missing note is not shown'
    );
    assert.deepEqual(buildPisiRelationshipModel(index, plan.path).inboundTasks, [], 'without tasks nothing is counted');
});
