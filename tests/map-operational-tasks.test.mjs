// Map badges and the dependency layer read tasks by their note id (docs/task-plan.md G5, §3.6).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPisiOperationalNodeStates,
    buildPisiTaskDependencyProjections,
    isPisiOperationalTaskOverdue
} from '../renderer/map/pisi-map-operational-core.mjs';

const node = (id, noteId = id) => ({ id, fullPath: `/project/${id}.node`, metadata: { id: noteId, title: id }, properties: {} });
const task = (id, fields = {}) => ({ id, title: id, status: 'todo', priority: 3, dependencies: [], noteId: null, diaryDate: null, dueDate: null, ...fields });
const NOON = new Date(2026, 10, 22, 12).getTime();

test('görev haritadaki notuna noteId ile bağlanır; günlükteki ve yeri olmayan görev hiçbir karta düşmez', () => {
    const nodes = [node('node_A'), node('node_B')];
    const tasks = [
        task('task_1', { noteId: 'node_A' }),
        task('task_2', { noteId: 'node_A', status: 'done' }),
        task('task_3', { diaryDate: '2026-11-22' }),
        // Eski kayıt: notun yolunu taşıyan sahte kaynak okunmaz (GV12).
        task('task_4', { source: { nodePath: '/project/node_B.node' } })
    ];
    const states = buildPisiOperationalNodeStates(nodes, tasks, NOON);
    assert.deepEqual(
        states.get('node_A').tasks.map((item) => item.id),
        ['task_1', 'task_2']
    );
    assert.deepEqual(
        states.get('node_A').openTasks.map((item) => item.id),
        ['task_1']
    );
    assert.equal(states.get('node_B').tasks.length, 0);
    assert.equal(states.get('node_B').missingNextAction, true);
});

test('kart notun kimliğiyle (metadata.id) bulunur; harita düğümünün kimliğinden farklı olsa da', () => {
    const states = buildPisiOperationalNodeStates([node('box_1', 'node_X')], [task('task_1', { noteId: 'node_X' })], NOON);
    assert.equal(states.get('box_1').openTasks.length, 1);
});

test('gecikme yalnız dueDate ile ve yerel güne göredir: bugün biten gecikmiş değildir, scheduledAt ve deadline okunmaz', () => {
    assert.equal(isPisiOperationalTaskOverdue(task('t', { dueDate: '2026-11-21' }), NOON), true);
    assert.equal(isPisiOperationalTaskOverdue(task('t', { dueDate: '2026-11-22' }), NOON), false);
    assert.equal(isPisiOperationalTaskOverdue(task('t', { dueDate: '2026-11-21', status: 'done' }), NOON), false);
    assert.equal(isPisiOperationalTaskOverdue(task('t', { deadline: '2026-01-01', scheduledAt: '2026-01-01T09:00' }), NOON), false);
});

test('bağımlılık katmanı iki notun görevleri arasında çizilir; günlükteki bağımlılık çizilmez', () => {
    const nodes = [node('node_A'), node('node_B')];
    const tasks = [
        task('task_a', { noteId: 'node_A' }),
        task('task_b', { noteId: 'node_B', dependencies: ['task_a', 'task_d'] }),
        task('task_d', { diaryDate: '2026-11-22' })
    ];
    assert.deepEqual(buildPisiTaskDependencyProjections(nodes, tasks, new Set(['node_A', 'node_B'])), [
        { id: 'task-dependency:node_A->node_B', sourceId: 'node_A', targetId: 'node_B', blockedTaskId: 'task_b', dependencyTaskId: 'task_a' }
    ]);
});
