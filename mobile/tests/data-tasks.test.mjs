// TaskRepo, version 2 (docs/task-plan.md §3.1–§3.3, G8): records follow
// shared/task-model.mjs, every task has a place, and the diary section of
// each day a change touches is written in the same writer job (GV5, GV15).

import { describe, expect, it } from 'vitest';
import { PISI_DIARY_EMPTY_CONTENT } from '../../shared/diary-rules.mjs';
import { makePisiDiaryTaskSectionHtml } from '../../shared/task-diary.mjs';
import { NOW, TODAY, createMemoryProject, noteFile, paragraph, storeJson } from './data-helpers.mjs';

const KEY = '.pisi/tasks.json';
const diaryKey = (day) => `diary/${day}.node`;
const ID = 'task_11111111-1111-4111-8111-111111111111';
const OTHER = 'task_22222222-2222-4222-8222-222222222222';

function storedTask(overrides = {}) {
    return {
        id: ID,
        title: 'Raporu gönder',
        tags: [],
        status: 'todo',
        priority: 2,
        dueDate: TODAY,
        dueTime: '10:00',
        repeat: 'none',
        completionOffsetDays: null,
        reminderMode: 'none',
        reminderAt: null,
        dependencies: [],
        manualOrder: 100,
        noteId: 'node_00000000-0000-4000-8000-0000000000aa',
        diaryDate: null,
        durationMinutes: 0,
        actualMinutes: 0,
        completions: [],
        createdAt: '2026-11-01T08:00:00.000Z',
        updatedAt: '2026-11-01T08:00:00.000Z',
        completedAt: null,
        completedOn: null,
        ...overrides
    };
}

const store = (tasks, extra = {}) => storeJson({ version: 2, updatedAt: '2026-11-01T08:00:00.000Z', tasks, ...extra });
const read = (driver) => JSON.parse(driver.snapshot()[KEY]);
const readDiary = (driver, day) => JSON.parse(driver.snapshot()[diaryKey(day)]);
const renamed = (driver) => driver.calls.filter(([name]) => name === 'rename').map(([, , target]) => target);
const diaryFile = (day, content) => noteFile({ id: `node_diary-${day}`, title: day, content, pisi: { parentMap: 'diary', diaryDate: day } });

/** A project whose clock the test moves. */
function projectAt(files, start = NOW) {
    const clock = { now: new Date(start) };
    const made = createMemoryProject(files, { now: () => new Date(clock.now) });
    return { ...made, clock };
}

describe('TaskRepo sürüm 2', () => {
    it('günlükte oluşturulan görev o günün günlüğünde durur, o gün bitişlidir; günlük yoksa masaüstü biçiminde oluşur', async () => {
        const { project, driver } = createMemoryProject();
        const result = await project.tasks.create({ title: '  Süt   al ', priority: 4, dueTime: '18:00' }, { diaryDate: TODAY });

        expect(result).toMatchObject({ ok: true, created: true, days: { days: [TODAY], created: [TODAY], written: [] } });
        const stored = read(driver);
        expect(Object.keys(stored)).toEqual(['version', 'updatedAt', 'tasks']);
        expect(stored.version).toBe(2);
        expect(stored.tasks).toEqual([
            {
                id: 'task_00000000-0000-4000-8000-000000000001',
                title: 'Süt al',
                tags: [],
                status: 'todo',
                priority: 4,
                dueDate: TODAY,
                dueTime: '18:00',
                repeat: 'none',
                completionOffsetDays: null,
                reminderMode: 'none',
                reminderAt: null,
                dependencies: [],
                manualOrder: NOW.getTime(),
                noteId: null,
                diaryDate: TODAY,
                durationMinutes: 0,
                actualMinutes: 0,
                completions: [],
                createdAt: NOW.toISOString(),
                updatedAt: NOW.toISOString(),
                completedAt: null,
                completedOn: null
            }
        ]);
        // The diary the desktop would make: its empty content and the section with the task's id only (§3.2.2).
        const diary = readDiary(driver, TODAY);
        expect(diary.pisi).toMatchObject({ type: 'node', parentMap: 'diary', diaryDate: TODAY, title: '14-11-2026' });
        expect(diary.content).toBe(PISI_DIARY_EMPTY_CONTENT + makePisiDiaryTaskSectionHtml(TODAY, [stored.tasks[0].id]));
        expect(diary.content).not.toContain('Süt');
        expect(driver.snapshot()['diary/.pisi-diary']).toBeDefined();
        expect(await driver.stat(`diary/${diary.pisi.sidecar}`)).toMatchObject({ type: 'directory' });
    });

    it('notta oluşturulan tarihsiz görev hiçbir günlüğe dokunmaz; yer verilmeyen ya da geçersiz alanlı görev yazılmaz', async () => {
        const { project, driver } = createMemoryProject();
        const inNote = await project.tasks.create({ title: 'Nottaki görev', dueDate: null }, { noteId: 'node_00000000-0000-4000-8000-0000000000aa' });
        expect(inNote.task).toMatchObject({ noteId: 'node_00000000-0000-4000-8000-0000000000aa', diaryDate: null, dueDate: null });
        expect(inNote.days).toEqual({ days: [], written: [], created: [], skipped: [] });

        expect(await project.tasks.create({ title: 'Yersiz' })).toEqual({ ok: false, error: 'target-required' });
        const invalid = await project.tasks.create({ title: 'Kötü', priority: 9 }, { diaryDate: TODAY });
        expect(invalid).toMatchObject({ ok: false, errors: [{ field: 'priority', code: 'invalid' }] });
        expect(read(driver).tasks).toHaveLength(1);
        expect(Object.keys(driver.snapshot()).filter((key) => key.startsWith('diary/'))).toEqual([]);
    });

    it('yalnız ilgili kaydı değiştirir; bilinmeyen alanları, sürüm 1 alanlarını ve diğer kayıtları korur (GV12, V5)', async () => {
        const other = storedTask({ id: OTHER, title: 'Diğer', futureField: [1, 2] });
        const legacy = { ...storedTask({ futureField: { keep: true } }), todoTag: 'todo.2.14-11-2026', source: { nodePath: 'Eski.node' } };
        const { project, driver } = createMemoryProject({ [KEY]: storeJson({ version: 1, updatedAt: 'x', tasks: [legacy, other], futureSetting: 'kalsın' }) });

        await project.tasks.update(ID, { title: 'Raporu bugün gönder', priority: 1 });
        const after = read(driver);

        expect(Object.keys(after)).toEqual(['version', 'updatedAt', 'tasks', 'futureSetting']);
        expect([after.version, after.futureSetting]).toEqual([2, 'kalsın']);
        expect(after.tasks[1]).toEqual(other);
        expect(after.tasks[0]).toEqual({ ...legacy, title: 'Raporu bugün gönder', priority: 1, updatedAt: NOW.toISOString() });
    });

    it('yazmadan hemen önce dosyayı yeniden okur: araya giren kayıt kaybolmaz (V5)', async () => {
        const { project, driver } = createMemoryProject({ [KEY]: store([storedTask()]) });
        await project.tasks.list();
        // Another writer (the desktop, a transfer) adds a task after mobile read the list.
        await driver.writeText(KEY, store([storedTask(), storedTask({ id: OTHER, title: 'Dışarıdan' })]));

        await project.tasks.update(ID, { status: 'doing' });
        expect(read(driver).tasks.map((task) => [task.title, task.status])).toEqual([
            ['Raporu gönder', 'doing'],
            ['Dışarıdan', 'todo']
        ]);
    });

    it('değişiklik getirmeyen işlem ve bilinmeyen kimlik dosya yazmaz (V4)', async () => {
        const text = store([storedTask()]);
        const { project, driver } = createMemoryProject({ [KEY]: text });
        expect(await project.tasks.update(ID, { title: 'Raporu gönder', priority: 2 })).toMatchObject({ ok: true, changed: false });
        expect(await project.tasks.update('task_yok-yok', { status: 'done' })).toEqual({ ok: false, notFound: true });
        expect(await project.tasks.reopen(ID)).toMatchObject({ ok: true, changed: false });
        expect(driver.snapshot()[KEY]).toBe(text);
        expect(driver.count('rename')).toBe(0);
    });

    it('alan değişikliği (başlık, durum, öncelik, saat, hatırlatma) hiçbir not ya da günlük dosyası yazmaz (GV5)', async () => {
        const section = makePisiDiaryTaskSectionHtml(TODAY, [ID]);
        const { project, driver } = createMemoryProject({
            [KEY]: store([storedTask()]),
            [diaryKey(TODAY)]: diaryFile(TODAY, `${paragraph('blk_a', 'Gün')}${section}`)
        });
        await project.tasks.update(ID, {
            title: 'Yeni',
            status: 'doing',
            priority: 5,
            dueTime: '11:30',
            reminderMode: 'day-before',
            reminderAt: `${TODAY}T08:00`
        });
        expect(renamed(driver)).toEqual([KEY]);
    });

    it('bitiş günü değişince eski günün bölümünden çıkar, yeni günün günlüğü oluşur; öbür bloklar bayt bayt kalır', async () => {
        const before = `${paragraph('blk_a', 'Sabah yazısı')}${makePisiDiaryTaskSectionHtml(TODAY, [ID, OTHER])}`;
        const files = {
            [KEY]: store([storedTask(), storedTask({ id: OTHER, title: 'Kalan', createdAt: '2026-11-02T08:00:00.000Z' })]),
            [diaryKey(TODAY)]: diaryFile(TODAY, before)
        };
        const { project, driver } = createMemoryProject(files);
        const result = await project.tasks.update(ID, { dueDate: '2026-11-20' });

        expect(result.days).toEqual({ days: [TODAY, '2026-11-20'], written: [TODAY], created: ['2026-11-20'], skipped: [] });
        expect(readDiary(driver, TODAY).content).toBe(`${paragraph('blk_a', 'Sabah yazısı')}${makePisiDiaryTaskSectionHtml(TODAY, [OTHER])}`);
        expect(readDiary(driver, TODAY).pisi.updatedAt).toBe(NOW.toISOString());
        expect(readDiary(driver, '2026-11-20').content).toBe(PISI_DIARY_EMPTY_CONTENT + makePisiDiaryTaskSectionHtml('2026-11-20', [ID]));
        // The time of day stays with the task; taking the day away takes the time too.
        expect(result.task.dueTime).toBe('10:00');
        expect((await project.tasks.update(ID, { dueDate: null })).task).toMatchObject({ dueDate: null, dueTime: null });
    });

    it('son görevi çıkan günün bölümü kalkar; silinmiş günlük yeniden oluşturulmaz (§3.3)', async () => {
        const files = {
            [KEY]: store([storedTask()]),
            [diaryKey(TODAY)]: diaryFile(TODAY, `${paragraph('blk_a', 'Not')}${makePisiDiaryTaskSectionHtml(TODAY, [ID])}`)
        };
        const { project, driver } = createMemoryProject(files);
        await project.tasks.update(ID, { dueDate: '2026-11-13' });
        expect(readDiary(driver, TODAY).content).toBe(paragraph('blk_a', 'Not'));
        // 13-11 was joined, so it was created; moving back to 14-11 rewrites 14-11 and empties 13-11 without deleting it.
        await project.tasks.update(ID, { dueDate: TODAY });
        expect(readDiary(driver, '2026-11-13').content).toBe(PISI_DIARY_EMPTY_CONTENT);
        expect(readDiary(driver, TODAY).content).toBe(`${paragraph('blk_a', 'Not')}${makePisiDiaryTaskSectionHtml(TODAY, [ID])}`);
    });

    it('tekrarsız görev tamamlanınca done olur; geç tamamlanırsa tamamlandığı günün günlüğüne de girer; geri açılır', async () => {
        const { project, driver, clock } = projectAt({ [KEY]: store([storedTask({ dueDate: '2026-11-12', dueTime: null })]) });
        const done = await project.tasks.complete(ID);
        expect(done.task).toMatchObject({ status: 'done', completedAt: NOW.toISOString(), completedOn: TODAY });
        expect(done.completion).toEqual({ date: TODAY, dueDate: '2026-11-12', at: NOW.toISOString(), status: 'todo' });
        expect(done.days).toMatchObject({ days: [TODAY], created: [TODAY] });
        expect(readDiary(driver, TODAY).content).toContain(`data-pisi-task-ref="${ID}"`);
        expect((await project.tasks.complete(ID)).changed).toBe(false);

        clock.now = new Date(2026, 10, 14, 10, 0);
        const reopened = await project.tasks.reopen(ID, done.completion);
        expect(reopened.task).toMatchObject({ status: 'todo', completedAt: null, completedOn: null });
        expect(readDiary(driver, TODAY).content).toBe(PISI_DIARY_EMPTY_CONTENT);
    });

    it.each([
        ['daily', '2026-11-14', '2026-11-15'],
        ['weekdays', '2026-11-13', '2026-11-16'],
        ['weekly', '2026-11-13', '2026-11-20'],
        ['biweekly', '2026-11-14', '2026-11-28'],
        ['monthly', '2026-10-31', '2026-11-30'],
        ['after-completion', '2026-11-01', '2026-11-17']
    ])('tekrar eden görev (%s) yeni kayıt açmaz: tamamlama completions’a yazılır, görev sonraki tekrara ilerler', async (repeat, due, next) => {
        const task = storedTask({ repeat, dueDate: due, completionOffsetDays: repeat === 'after-completion' ? 3 : null });
        const { project, driver } = createMemoryProject({ [KEY]: store([task]) });
        const result = await project.tasks.complete(ID);
        const stored = read(driver).tasks;
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ status: 'todo', dueDate: next, completions: [{ date: TODAY, dueDate: due, at: NOW.toISOString() }] });
        expect(result.completion).toMatchObject({ date: TODAY, dueDate: due });
    });

    it('§3.2.3: günlük tekrar 21-11’de tamamlanır, 22-11’e ilerler; en son tamamlama geri alınır, öncekiler kilitli; geciken tekrar atlanır', async () => {
        const daily = storedTask({ id: ID, title: 'Spor', repeat: 'daily', dueDate: '2026-11-21', dueTime: '07:30', noteId: null, diaryDate: '2026-11-21' });
        const files = { [KEY]: store([daily]), [diaryKey('2026-11-21')]: diaryFile('2026-11-21', makePisiDiaryTaskSectionHtml('2026-11-21', [ID])) };
        const { project, driver, clock } = projectAt(files, new Date(2026, 10, 21, 7, 52));
        const refs = (day) => (driver.snapshot()[diaryKey(day)] ? readDiary(driver, day).content.match(/data-pisi-task-ref="[^"]+"/g)?.length || 0 : null);

        // 1–2: done on 21-11; the task moves to 22-11; the 22-11 diary is created with the row.
        const first = await project.tasks.complete(ID);
        expect(first.task).toMatchObject({ status: 'todo', dueDate: '2026-11-22', completions: [{ date: '2026-11-21', dueDate: '2026-11-21' }] });
        expect([refs('2026-11-21'), refs('2026-11-22')]).toEqual([1, 1]);

        // 3: the latest completion is taken back: the task is due 21-11 again and leaves 22-11; the 22-11 diary stays.
        clock.now = new Date(2026, 10, 21, 8, 0);
        const undone = await project.tasks.reopen(ID, first.completion);
        expect(undone.task).toMatchObject({ dueDate: '2026-11-21', completions: [] });
        expect([refs('2026-11-21'), refs('2026-11-22')]).toEqual([1, 0]);

        // 4: completed on 21-11 and 22-11: the 21-11 completion is locked.
        await project.tasks.complete(ID);
        clock.now = new Date(2026, 10, 22, 7, 40);
        await project.tasks.complete(ID);
        const earlier = read(driver).tasks[0].completions[0];
        expect(await project.tasks.reopen(ID, earlier)).toEqual({ ok: false, error: 'locked' });

        // 5: 23-11 is not done; on 25-11 the task is overdue and completing it skips the missed days.
        clock.now = new Date(2026, 10, 25, 9, 0);
        const late = await project.tasks.complete(ID);
        expect(late.task.dueDate).toBe('2026-11-26');
        expect(late.task.completions.at(-1)).toMatchObject({ date: '2026-11-25', dueDate: '2026-11-23' });
        expect([refs('2026-11-23'), refs('2026-11-25'), refs('2026-11-26')]).toEqual([0, 1, 1]);
    });

    it('bozuk tasks.json ezilmez, salt okunur sayılır; günlük bölümü yazılmaz (V7, GV11)', async () => {
        const { project, driver } = createMemoryProject({ [KEY]: '{"version": 2, "tasks": [' });
        expect(await project.tasks.list()).toMatchObject({ ok: false, corrupt: true, readOnly: true, tasks: [] });
        await expect(project.tasks.create({ title: 'Yeni' }, { diaryDate: TODAY })).rejects.toMatchObject({ code: 'READ_ONLY' });
        expect(driver.snapshot()[KEY]).toBe('{"version": 2, "tasks": [');
        expect(driver.snapshot()[diaryKey(TODAY)]).toBeUndefined();
        expect(project.getIntegrity().readOnlyFiles).toEqual([KEY]);
    });

    it('okunamayan günlük ezilmez: tasks.json yazılır, o günün bölümü atlanır', async () => {
        const { project, driver } = createMemoryProject({ [KEY]: store([]), [diaryKey(TODAY)]: '{"pisi": ' });
        const result = await project.tasks.create({ title: 'Yeni' }, { diaryDate: TODAY });
        expect(result.days.skipped).toEqual([TODAY]);
        expect(driver.snapshot()[diaryKey(TODAY)]).toBe('{"pisi": ');
        expect(read(driver).tasks).toHaveLength(1);
    });

    it('yeri olmayan eski kayıt tamamlanır ve düzenlenir; yeri yine yoktur (§3.1)', async () => {
        const legacy = { id: ID, title: 'Eski görev', status: 'todo', priority: 3, todoTag: 'todo.3.none', source: { nodePath: null } };
        const { project, driver } = createMemoryProject({ [KEY]: storeJson({ version: 1, tasks: [legacy] }) });
        expect((await project.tasks.update(ID, { title: 'Eski görev (telefon)' })).ok).toBe(true);
        const done = await project.tasks.complete(ID);
        expect(done.task).toMatchObject({ status: 'done', noteId: null, diaryDate: null, todoTag: 'todo.3.none' });
        expect(read(driver).tasks[0].source).toEqual({ nodePath: null });
    });
});

describe('DiaryRepo ve görev bölümü', () => {
    it('günlük metni yazılırken görev bölümü bayt bayt kalır; yeni günlük o günün bölümüyle oluşur (GV15)', async () => {
        const task = storedTask({ noteId: null, diaryDate: '2026-11-15', dueDate: '2026-11-15' });
        const section = makePisiDiaryTaskSectionHtml(TODAY, [ID]);
        const files = { [KEY]: store([storedTask(), { ...task, id: OTHER }]), [diaryKey(TODAY)]: diaryFile(TODAY, `${paragraph('blk_a', 'Bir')}${section}`) };
        const { project, driver } = createMemoryProject(files);

        await project.diary.setText(TODAY, 'Bir\n\nİki');
        const content = readDiary(driver, TODAY).content;
        expect(content.endsWith(section)).toBe(true);
        expect((await project.diary.read(TODAY)).text).toBe('Bir\n\nİki');

        // 15-11 has no diary yet, but a task of that day: the diary is written with its text and then the section.
        await project.diary.setText('2026-11-15', 'Yarın');
        const created = readDiary(driver, '2026-11-15').content;
        expect(created.endsWith(makePisiDiaryTaskSectionHtml('2026-11-15', [OTHER]))).toBe(true);
        expect((await project.diary.read('2026-11-15')).text).toBe('Yarın');
    });
});
