import test from 'node:test';
import assert from 'node:assert/strict';
import { completePisiTask, normalizePisiTask, reopenPisiTask } from '../shared/task-model.mjs';
import {
    getPisiTaskCalendarSummary,
    getPisiTaskDayChanges,
    getPisiTaskDays,
    getPisiTaskStateOnDay,
    groupPisiTasksByDay,
    listPisiDiaryTaskIds,
    listPisiOverdueTasks,
    makePisiDiaryTaskSectionHtml,
    readPisiDiaryTaskSection,
    replacePisiDiaryTaskSection
} from '../shared/task-diary.mjs';

const NOTE = 'node_0b6a3c1e';
const at = (day, hour = 9) => new Date(2026, 10, day, hour);
let uuid = 0;
const create = (payload, now = at(10)) => {
    const result = normalizePisiTask({ noteId: NOTE, ...payload }, null, { now, makeUuid: () => `u-${String(++uuid).padStart(4, '0')}` });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    return result.task;
};

test('§3.2.3: her gün tekrar eden "Spor" adım adım (tablo)', () => {
    let spor = create({ title: 'Spor', dueDate: '2026-11-21', repeat: 'daily' });
    const states = (task, days) => Object.fromEntries(days.map((day) => [day, getPisiTaskStateOnDay(task, day)?.state ?? null]));
    let last = null;
    const steps = [
        {
            name: '1. 21-11de tamamlanır: completions bir kayıt, görev 22-11e ilerler, durum todo',
            run: (task) => (last = completePisiTask(task, { now: at(21, 7) })).task,
            expect: (task, before) => {
                assert.deepEqual(task.completions, [{ date: '2026-11-21', dueDate: '2026-11-21', at: at(21, 7).toISOString() }]);
                assert.deepEqual([task.dueDate, task.status], ['2026-11-22', 'todo']);
                assert.deepEqual(getPisiTaskDayChanges(before, task), { added: ['2026-11-22'], removed: [], days: ['2026-11-22'] });
            }
        },
        {
            name: '2. 21-11de satır ☑ ve kilitsiz, 22-11de ☐; takvimde 21-11 tamamlanmış, 22-11 açık',
            run: (task) => task,
            expect: (task) => {
                assert.deepEqual(states(task, ['2026-11-21', '2026-11-22']), { '2026-11-21': 'done', '2026-11-22': 'open' });
                assert.equal(getPisiTaskStateOnDay(task, '2026-11-21').locked, false);
                assert.deepEqual(listPisiDiaryTaskIds('2026-11-21', [task]), [task.id]);
                assert.deepEqual(listPisiDiaryTaskIds('2026-11-22', [task]), [task.id]);
                const summary = getPisiTaskCalendarSummary([task]);
                assert.deepEqual(summary.get('2026-11-21'), { total: 1, open: 0, completed: 1 });
                assert.deepEqual(summary.get('2026-11-22'), { total: 1, open: 1, completed: 0 });
            }
        },
        {
            name: '3. 21-11de ☑ kaldırılır: tamamlama geri alınır, görev 21-11e döner, 22-11 satırı kalkar',
            run: (task) => reopenPisiTask(task, last.completion, { now: at(21, 8) }).task,
            expect: (task, before) => {
                assert.deepEqual([task.dueDate, task.completions], ['2026-11-21', []]);
                assert.deepEqual(getPisiTaskDayChanges(before, task), { added: [], removed: ['2026-11-22'], days: ['2026-11-22'] });
                assert.deepEqual(listPisiDiaryTaskIds('2026-11-22', [task]), []);
            }
        },
        {
            name: '4. 21-11 ve 22-11de tamamlanmışsa 21-11deki ☑ kilitlidir',
            run: (task) => {
                const first = completePisiTask(task, { now: at(21, 7) });
                last = completePisiTask(first.task, { now: at(22, 7) });
                assert.equal(reopenPisiTask(last.task, first.completion, { now: at(22, 8) }).error, 'locked');
                return last.task;
            },
            expect: (task) => {
                assert.deepEqual([getPisiTaskStateOnDay(task, '2026-11-21').locked, getPisiTaskStateOnDay(task, '2026-11-22').locked], [true, false]);
                assert.equal(task.dueDate, '2026-11-23');
            }
        },
        {
            name: '5. 23-11deki tekrar yapılmadan 25-11 gelir: gecikende; 25-11de tamamlanınca 26-11e ilerler, 23-11den kalkar',
            run: (task) => {
                assert.deepEqual(
                    listPisiOverdueTasks([task], '2026-11-25').map((item) => item.id),
                    [task.id]
                );
                return completePisiTask(task, { now: at(25, 20) }).task;
            },
            expect: (task, before) => {
                assert.deepEqual(task.completions.at(-1), { date: '2026-11-25', dueDate: '2026-11-23', at: at(25, 20).toISOString() });
                assert.equal(task.dueDate, '2026-11-26');
                assert.deepEqual(getPisiTaskDayChanges(before, task), {
                    added: ['2026-11-25', '2026-11-26'],
                    removed: ['2026-11-23'],
                    days: ['2026-11-23', '2026-11-25', '2026-11-26']
                });
                assert.deepEqual(states(task, ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']), {
                    '2026-11-23': null,
                    '2026-11-24': null,
                    '2026-11-25': 'done',
                    '2026-11-26': 'open'
                });
                assert.deepEqual(listPisiOverdueTasks([task], '2026-11-25'), []);
            }
        }
    ];
    for (const step of steps) {
        const before = spor;
        spor = step.run(spor);
        step.expect(spor, before);
    }
});

test('günün görevleri: günlükteki, o gün biten ve o gün tamamlanan görevler; oluşturulma sırasıyla', () => {
    const inDiary = create({ title: 'Günlükte', noteId: null, diaryDate: '2026-11-21', dueDate: '2026-11-25' }, at(12));
    const due = create({ title: 'Bugün biter', dueDate: '2026-11-21' }, at(11));
    const late = completePisiTask(create({ title: 'Geç biten', dueDate: '2026-11-19' }, at(10)), { now: at(21, 15) }).task;
    const other = create({ title: 'Başka gün', dueDate: '2026-11-22' }, at(9));
    const undated = create({ title: 'Tarihsiz' }, at(8));
    const tasks = [inDiary, due, late, other, undated];

    assert.deepEqual(listPisiDiaryTaskIds('2026-11-21', tasks), [late.id, due.id, inDiary.id]);
    assert.deepEqual(listPisiDiaryTaskIds('2026-11-19', tasks), [late.id], 'geç tamamlanan görev bitiş gününde de kalır');
    assert.deepEqual(listPisiDiaryTaskIds('2026-11-25', tasks), [inDiary.id]);
    assert.deepEqual(getPisiTaskDays(undated), []);
    assert.deepEqual(listPisiDiaryTaskIds('bozuk', tasks), []);

    assert.deepEqual(getPisiTaskStateOnDay(inDiary, '2026-11-21'), { state: 'dated', status: 'todo', dueDate: '2026-11-25' });
    assert.deepEqual(getPisiTaskStateOnDay(due, '2026-11-21'), { state: 'open', status: 'todo' });
    assert.deepEqual(getPisiTaskStateOnDay(late, '2026-11-21'), { state: 'done', at: at(21, 15).toISOString(), dueDate: '2026-11-19', locked: false });
    assert.equal(getPisiTaskStateOnDay(late, '2026-11-19').state, 'done');
    assert.equal(getPisiTaskStateOnDay(other, '2026-11-21'), null);

    const grouped = groupPisiTasksByDay(tasks);
    assert.deepEqual([...grouped.keys()], ['2026-11-19', '2026-11-21', '2026-11-22', '2026-11-25']);
    assert.deepEqual(grouped.get('2026-11-21'), listPisiDiaryTaskIds('2026-11-21', tasks));
});

test('tekrarsız görevin tamamlanma günü completedOn; sürüm 1 kaydında completedAt yerel günü', () => {
    const legacy = { id: 'task_legacy1', status: 'done', dueDate: '2026-11-18', completedAt: at(20, 12).toISOString() };
    assert.deepEqual(getPisiTaskDays(legacy), ['2026-11-18', '2026-11-20']);
    assert.deepEqual(getPisiTaskDays({ ...legacy, completedOn: '2026-11-19' }), ['2026-11-18', '2026-11-19']);
    assert.deepEqual(getPisiTaskDays({ ...legacy, status: 'todo' }), ['2026-11-18']);
});

test('bugünün gecikenleri: açık, bugünden önce biten ve bugünün bölümünde olmayan görevler', () => {
    const old = create({ title: 'Eski', dueDate: '2026-11-15', priority: 2 });
    const older = create({ title: 'Daha eski', dueDate: '2026-11-10' });
    const urgent = create({ title: 'Acil', dueDate: '2026-11-15', priority: 5 });
    const done = completePisiTask(create({ title: 'Bitti', dueDate: '2026-11-12' }), { now: at(13) }).task;
    const inToday = create({ title: 'Bugünün günlüğünde', noteId: null, diaryDate: '2026-11-21', dueDate: '2026-11-14' });
    assert.deepEqual(
        listPisiOverdueTasks([old, older, urgent, done, inToday], '2026-11-21').map((task) => task.title),
        ['Daha eski', 'Acil', 'Eski']
    );
});

test("bölüm HTML'i §3.2.2 biçiminde; boş günde bölüm yok; geçersiz ve tekrarlanan kimlik düşer", () => {
    assert.equal(
        makePisiDiaryTaskSectionHtml('2026-11-21', ['task_aaaa', 'task_bbbb', 'task_aaaa', 'kötü']),
        '<div class="pisi-editor-block pisi-diary-tasks" data-pisi-block-id="blk_diary-tasks-2026-11-21" data-pisi-block-type="diary-tasks" contenteditable="false">\n    <div data-pisi-task-ref="task_aaaa"></div>\n    <div data-pisi-task-ref="task_bbbb"></div>\n</div>'
    );
    assert.equal(makePisiDiaryTaskSectionHtml('2026-11-21', []), '');
    assert.throws(() => makePisiDiaryTaskSectionHtml('21-11-2026', ['task_aaaa']), TypeError);
});

test('bölüm yazma: son blok ve tek; doğruysa aynı metin döner; öbür baytlar korunur', () => {
    const body = '<div class="pisi-editor-block" data-pisi-block-id="blk_a">Bugün &amp; yarın</div>\n';
    const section = (ids) => makePisiDiaryTaskSectionHtml('2026-11-21', ids);

    const withSection = replacePisiDiaryTaskSection(body, '2026-11-21', ['task_aaaa']);
    assert.equal(withSection, body + section(['task_aaaa']));
    assert.equal(replacePisiDiaryTaskSection(withSection, '2026-11-21', ['task_aaaa']), withSection, 'değişmeyen günlük yazılmaz');
    assert.equal(replacePisiDiaryTaskSection(`${withSection}\n`, '2026-11-21', ['task_aaaa', 'task_bbbb']), `${body}${section(['task_aaaa', 'task_bbbb'])}\n`);
    assert.equal(replacePisiDiaryTaskSection(withSection, '2026-11-21', []), body, 'görev kalmayınca bölüm kalkar');

    // A section that is not last, or two of them, is put right: one section at the end.
    const misplaced = `${section(['task_old1'])}${body}${section(['task_old2'])}<div>son</div>`;
    assert.equal(replacePisiDiaryTaskSection(misplaced, '2026-11-21', ['task_aaaa']), `${body}<div>son</div>${section(['task_aaaa'])}`);
    assert.equal(replacePisiDiaryTaskSection('<div', '2026-11-21', ['task_aaaa']), null);
});

test('bölüm okuma yalnız denetim içindir: sayı, kimlikler, blok kimliği ve son blok olup olmadığı', () => {
    const html = `<div>Metin</div>${makePisiDiaryTaskSectionHtml('2026-11-21', ['task_aaaa', 'task_bbbb'])}`;
    assert.deepEqual(readPisiDiaryTaskSection(html), { count: 1, taskIds: ['task_aaaa', 'task_bbbb'], blockId: 'blk_diary-tasks-2026-11-21', last: true });
    assert.deepEqual(readPisiDiaryTaskSection('<div>Metin</div>'), { count: 0, taskIds: [], blockId: null, last: false });
    assert.equal(readPisiDiaryTaskSection(`${html}<div>sonra</div>`).last, false);
    assert.equal(readPisiDiaryTaskSection('<div><b></div>'), null);
});

test('gün değişiklikleri: başlık, durum, öncelik, saat ve hatırlatma hiçbir günü değiştirmez', () => {
    const task = create({ title: 'Toplantı', dueDate: '2026-11-24', dueTime: '10:00' });
    const edit = (payload) => normalizePisiTask(payload, task, { now: at(11), makeUuid: () => 'never' }).task;
    for (const payload of [{ title: 'Yeni ad' }, { status: 'doing' }, { priority: 5 }, { dueTime: '11:00' }, { reminderMode: 'day-before' }]) {
        assert.deepEqual(getPisiTaskDayChanges(task, edit(payload)).days, [], JSON.stringify(payload));
    }
    assert.deepEqual(getPisiTaskDayChanges(task, edit({ dueDate: '2026-11-25' })), {
        added: ['2026-11-25'],
        removed: ['2026-11-24'],
        days: ['2026-11-24', '2026-11-25']
    });
    assert.deepEqual(getPisiTaskDayChanges(null, task), { added: ['2026-11-24'], removed: [], days: ['2026-11-24'] }, 'oluşturma');
    assert.deepEqual(getPisiTaskDayChanges(task, null), { added: [], removed: ['2026-11-24'], days: ['2026-11-24'] }, 'silme');
    // A task that does not repeat, completed on its own day, stays in that one section.
    assert.deepEqual(getPisiTaskDayChanges(task, completePisiTask(task, { now: at(24) }).task).days, []);
    assert.deepEqual(getPisiTaskDayChanges(task, completePisiTask(task, { now: at(26) }).task).added, ['2026-11-26']);
});

test('takvim özeti: günlükte duran ama başka güne tarihli görev kendi durumuyla sayılır', () => {
    const inDiary = create({ title: 'Günlükte', noteId: null, diaryDate: '2026-11-21', dueDate: '2026-11-25' });
    const done = completePisiTask(create({ title: 'Bitti', dueDate: '2026-11-21' }), { now: at(21) }).task;
    const summary = getPisiTaskCalendarSummary([inDiary, done]);
    assert.deepEqual(summary.get('2026-11-21'), { total: 2, open: 1, completed: 1 });
    assert.deepEqual(summary.get('2026-11-25'), { total: 1, open: 1, completed: 0 });
});
