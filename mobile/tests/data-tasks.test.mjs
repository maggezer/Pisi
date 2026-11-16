import { describe, expect, it } from 'vitest';
import { NOW, TODAY, createMemoryProject, storeJson } from './data-helpers.mjs';
import { formatPisiRecurrenceTaskId } from '../../shared/ids.mjs';

const KEY = '.pisi/tasks.json';

function storedTask(overrides = {}) {
    return {
        id: 'task_11111111-1111-4111-8111-111111111111',
        title: 'Raporu gönder',
        status: 'todo',
        priority: 2,
        dueDate: TODAY,
        scheduledAt: `${TODAY}T10:00`,
        deadline: null,
        reminderAt: null,
        reminderMode: 'none',
        durationMinutes: 0,
        actualMinutes: 0,
        repeat: 'none',
        completionOffsetDays: null,
        dependencies: [],
        manualOrder: 100,
        todoTag: 'todo.2.14-11-2026',
        source: { nodePath: 'Inbox.node', blockId: 'blk_1', mapPath: null, nodeTitle: 'Inbox', mapTitle: '' },
        createdAt: '2026-11-01T08:00:00.000Z',
        updatedAt: '2026-11-01T08:00:00.000Z',
        completedAt: null,
        ...overrides
    };
}

const store = (tasks, extra = {}) => storeJson({ version: 1, updatedAt: '2026-11-01T08:00:00.000Z', tasks, ...extra });
const read = (driver) => JSON.parse(driver.snapshot()[KEY]);

describe('TaskRepo', () => {
    it('ilk görevle tasks.json dosyasını masaüstü biçiminde oluşturur', async () => {
        const { project, driver } = createMemoryProject();
        const result = await project.tasks.upsert({ title: '  Süt   al ', priority: 4, dueDate: TODAY, scheduledAt: `${TODAY}T18:00` });

        expect(result).toMatchObject({ ok: true, created: true, changed: true });
        expect(driver.snapshot()[KEY]).toBe(
            storeJson({
                version: 1,
                updatedAt: NOW.toISOString(),
                tasks: [
                    {
                        id: 'task_00000000-0000-4000-8000-000000000001',
                        title: 'Süt al',
                        status: 'todo',
                        priority: 4,
                        dueDate: TODAY,
                        scheduledAt: `${TODAY}T18:00`,
                        deadline: null,
                        reminderAt: null,
                        reminderMode: 'none',
                        durationMinutes: 0,
                        actualMinutes: 0,
                        repeat: 'none',
                        completionOffsetDays: null,
                        dependencies: [],
                        manualOrder: NOW.getTime(),
                        todoTag: 'todo.4.14-11-2026',
                        source: { nodePath: null, blockId: null, mapPath: null, nodeTitle: '', mapTitle: '' },
                        createdAt: NOW.toISOString(),
                        updatedAt: NOW.toISOString(),
                        completedAt: null
                    }
                ]
            })
        );
    });

    it('tarihsiz görev tarihsiz etiket alır; yalnız saat verilirse bitiş günü ondan gelir; boş başlık kaydedilmez', async () => {
        const { project, driver } = createMemoryProject();
        const undated = await project.tasks.upsert({ title: 'Okuma listesi' });
        const scheduled = await project.tasks.upsert({ title: 'Toplantı', priority: 1, scheduledAt: '2026-11-20T14:00' });
        const empty = await project.tasks.upsert({ title: '   ' });

        expect([undated.task.todoTag, undated.task.dueDate]).toEqual(['todo.3.none', null]);
        expect([scheduled.task.todoTag, scheduled.task.dueDate]).toEqual(['todo.1.20-11-2026', '2026-11-20']);
        expect(empty).toEqual({ ok: false, error: 'empty-title' });
        expect(read(driver).tasks).toHaveLength(2);
    });

    it('yalnız ilgili kaydı değiştirir; bilinmeyen alanları ve diğer kayıtları korur (V3, V5)', async () => {
        const other = storedTask({ id: 'task_22222222-2222-4222-8222-222222222222', title: 'Diğer', futureField: [1, 2] });
        const { project, driver } = createMemoryProject({ [KEY]: store([storedTask({ futureField: { keep: true } }), other], { futureSetting: 'kalsın' }) });

        const result = await project.tasks.upsert({ id: storedTask().id, title: 'Raporu bugün gönder', priority: 1 });
        const after = read(driver);

        expect(Object.keys(after)).toEqual(['version', 'updatedAt', 'tasks', 'futureSetting']);
        expect(after.futureSetting).toBe('kalsın');
        expect(after.tasks[1]).toEqual(other);
        expect(after.tasks[0]).toEqual({
            ...storedTask({ futureField: { keep: true } }),
            title: 'Raporu bugün gönder',
            priority: 1,
            updatedAt: NOW.toISOString()
        });
        // The task lives in a note block, so its tag stays the block's tag.
        expect(result.task.todoTag).toBe('todo.2.14-11-2026');
    });

    it('yazmadan hemen önce dosyayı yeniden okur: araya giren kayıt kaybolmaz (V5)', async () => {
        const { project, driver } = createMemoryProject({ [KEY]: store([storedTask()]) });
        await project.tasks.list();
        // Another writer (the desktop, a transfer) adds a task after mobile read the list.
        const outside = storedTask({ id: 'task_33333333-3333-4333-8333-333333333333', title: 'Dışarıdan' });
        await driver.writeText(KEY, store([storedTask(), outside]));

        await project.tasks.setStatus(storedTask().id, 'doing');
        expect(read(driver).tasks.map((task) => [task.title, task.status])).toEqual([
            ['Raporu gönder', 'doing'],
            ['Dışarıdan', 'todo']
        ]);
    });

    it('değişiklik getirmeyen işlem dosyayı yazmaz (V4)', async () => {
        const text = store([storedTask()]);
        const { project, driver } = createMemoryProject({ [KEY]: text });
        const same = await project.tasks.upsert({ id: storedTask().id, title: 'Raporu gönder', priority: 2 });
        const status = await project.tasks.setStatus(storedTask().id, 'todo');
        const missing = await project.tasks.setStatus('task_yok-yok', 'done');

        expect([same.changed, status.changed, missing]).toEqual([false, false, { ok: false, notFound: true, skip: true }]);
        expect(driver.snapshot()[KEY]).toBe(text);
        expect(driver.count('rename')).toBe(0);
    });

    it('tamamlanan görev completedAt alır, yeniden açılınca temizlenir', async () => {
        const { project, driver } = createMemoryProject({ [KEY]: store([storedTask()]) });
        const done = await project.tasks.complete(storedTask().id);
        expect([done.task.status, done.task.completedAt, done.next]).toEqual(['done', NOW.toISOString(), null]);
        expect((await project.tasks.complete(storedTask().id)).changed).toBe(false);

        const reopened = await project.tasks.setStatus(storedTask().id, 'todo');
        expect([reopened.task.status, reopened.task.completedAt]).toEqual(['todo', null]);
        expect(read(driver).tasks).toHaveLength(1);
    });

    it.each([
        ['daily', '14-11-2026', '2026-11-15'],
        ['weekdays', '13-11-2026', '2026-11-16'],
        ['weekly', '13-11-2026', '2026-11-20'],
        ['biweekly', '14-11-2026', '2026-11-28'],
        ['monthly', '31-01-2027', '2027-02-28'],
        ['after-completion', '01-11-2026', '2026-11-17']
    ])('tekrar eden görev (%s) tamamlanınca sonraki tarihle yeni kayıt eklenir', async (repeat, tagDate, nextIso) => {
        const recurring = storedTask({
            repeat,
            todoTag: `todo.2.${tagDate}`,
            completionOffsetDays: repeat === 'after-completion' ? 3 : null,
            durationMinutes: 25
        });
        const { project, driver } = createMemoryProject({ [KEY]: store([recurring]) });

        const result = await project.tasks.complete(recurring.id);
        const [done, next] = read(driver).tasks;
        const [year, month, day] = nextIso.split('-');

        expect(done).toMatchObject({ id: recurring.id, status: 'done', completedAt: NOW.toISOString(), source: recurring.source });
        expect(next).toEqual(result.next);
        expect(next).toMatchObject({
            title: 'Raporu gönder',
            status: 'todo',
            priority: 2,
            repeat,
            dueDate: nextIso,
            scheduledAt: nextIso,
            todoTag: `todo.2.${day}-${month}-${year}`,
            durationMinutes: 25,
            manualOrder: 101,
            completedAt: null,
            // The next occurrence is not tied to a note block (mobile does not create task blocks).
            source: { nodePath: null, blockId: null, mapPath: null, nodeTitle: '', mapTitle: '' }
        });
        // Derived from the completed task and the next date: another device completing it creates the same id.
        expect(next.id).toBe(formatPisiRecurrenceTaskId(recurring.id, nextIso));
        expect(next.id).not.toBe(recurring.id);
    });

    it('aynı tekrar iki cihazda tamamlanınca sonraki tekrar aynı kimliği alır; kimlik doluysa yenisi verilir', async () => {
        const recurring = storedTask({ repeat: 'daily', todoTag: 'todo.2.14-11-2026' });
        const phone = createMemoryProject({ [KEY]: store([recurring]) });
        const tablet = createMemoryProject({ [KEY]: store([recurring]) });
        const fromPhone = await phone.project.tasks.complete(recurring.id);
        const fromTablet = await tablet.project.tasks.complete(recurring.id);
        expect(fromPhone.next.id).toBe(fromTablet.next.id);
        expect(fromPhone.next.id).toMatch(/^task_r_[0-9a-f]{16}$/);

        // Reopened and completed again while the derived record is still there: the new record gets a fresh id.
        await phone.project.tasks.setStatus(recurring.id, 'todo');
        const again = await phone.project.tasks.complete(recurring.id);
        expect(again.next.id).toMatch(/^task_[0-9a-f-]{36}$/);
        expect(new Set(read(phone.driver).tasks.map((task) => task.id)).size).toBe(3);
    });

    it('undoComplete: görevi eski durumuna döndürür; başka kayda dokunmaz', async () => {
        const other = storedTask({ id: 'task_22222222-2222-4222-8222-222222222222', title: 'Başka görev' });
        const doing = storedTask({ status: 'doing' });
        const { project, driver } = createMemoryProject({ [KEY]: store([doing, other], { extra: 'korunur' }) });
        await project.tasks.complete(doing.id);

        const undone = await project.tasks.undoComplete(doing.id, { status: 'doing' });
        expect(undone).toMatchObject({ ok: true, changed: true, removedNext: false });
        const stored = read(driver);
        expect(stored.tasks[0]).toMatchObject({ ...doing, updatedAt: NOW.toISOString(), completedAt: null });
        expect(stored.tasks[1]).toEqual(other);
        expect(stored.extra).toBe('korunur');

        // Nothing to undo: nothing is written (V4).
        const writes = driver.count('writeText');
        expect(await project.tasks.undoComplete(doing.id, { status: 'doing' })).toMatchObject({ ok: true, changed: false });
        expect(await project.tasks.undoComplete('task_yok')).toMatchObject({ ok: false, notFound: true });
        expect(driver.count('writeText')).toBe(writes);
    });

    it('undoComplete: tekrar eden görevin az önce eklenen tekrarını geri alır; değişmiş tekrarı bırakır', async () => {
        const recurring = storedTask({ repeat: 'daily', todoTag: 'todo.2.14-11-2026' });
        const first = createMemoryProject({ [KEY]: store([recurring]) });
        const done = await first.project.tasks.complete(recurring.id);
        expect(read(first.driver).tasks).toHaveLength(2);
        expect(await first.project.tasks.undoComplete(recurring.id, { status: 'todo', next: done.next })).toMatchObject({ changed: true, removedNext: true });
        expect(read(first.driver).tasks.map((task) => [task.id, task.status])).toEqual([[recurring.id, 'todo']]);

        // The next occurrence was edited in the meantime (here: on the desktop). It is someone's data now and stays.
        const second = createMemoryProject({ [KEY]: store([recurring]) });
        const again = await second.project.tasks.complete(recurring.id);
        await second.project.tasks.upsert({ id: again.next.id, title: 'Değişti' });
        expect(await second.project.tasks.undoComplete(recurring.id, { status: 'todo', next: again.next })).toMatchObject({
            changed: true,
            removedNext: false
        });
        expect(read(second.driver).tasks.map((task) => [task.title, task.status])).toEqual([
            ['Raporu gönder', 'todo'],
            ['Değişti', 'todo']
        ]);
    });

    it('bozuk tasks.json ezilmez, salt okunur sayılır (V7)', async () => {
        for (const broken of ['{ "tasks": [', '', '[]', '{"version":1,"tasks":{}}']) {
            const { project, driver } = createMemoryProject({ [KEY]: broken });
            const listed = await project.tasks.list();
            expect(listed).toMatchObject({ ok: false, corrupt: true, readOnly: true, tasks: [] });
            await expect(project.tasks.upsert({ title: 'Yeni' })).rejects.toMatchObject({ code: 'READ_ONLY' });
            await expect(project.tasks.setStatus('task_abcd', 'done')).rejects.toMatchObject({ code: 'READ_ONLY' });
            expect(driver.snapshot()[KEY]).toBe(broken);
            expect(project.getIntegrity()).toEqual({ healthy: false, readOnlyFiles: [KEY] });
        }
    });

    it('update: alanları değiştirir, tarihi kaldırır ve todo etiketini tarihle öncelikten yeniden kurar', async () => {
        const task = storedTask({ source: { nodePath: null, blockId: null, mapPath: null, nodeTitle: '', mapTitle: '' }, mobilde: 'bilinmez' });
        const other = storedTask({ id: 'task_22222222-2222-4222-8222-222222222222', title: 'Öteki' });
        const { project, driver } = createMemoryProject({ [KEY]: store([task, other], { ek: true }) });

        const moved = await project.tasks.update(task.id, { dueDate: '2026-11-20', scheduledAt: '2026-11-20T10:00', priority: 5, reminderMode: 'day-before' });
        expect(moved).toMatchObject({ ok: true, created: false, changed: true });
        expect(read(driver).tasks[0]).toMatchObject({
            dueDate: '2026-11-20',
            scheduledAt: '2026-11-20T10:00',
            priority: 5,
            reminderMode: 'day-before',
            todoTag: 'todo.5.20-11-2026',
            title: 'Raporu gönder',
            mobilde: 'bilinmez',
            createdAt: '2026-11-01T08:00:00.000Z'
        });

        await project.tasks.update(task.id, { dueDate: '', scheduledAt: '', deadline: '' });
        expect(read(driver).tasks[0]).toMatchObject({ dueDate: null, scheduledAt: null, deadline: null, todoTag: 'todo.5.none' });
        expect(read(driver).tasks[1]).toEqual(other);
        expect(read(driver).ek).toBe(true);
    });

    it('update: değişiklik yoksa ya da görev yoksa dosyayı yazmaz, yeni görev oluşturmaz (V4)', async () => {
        const { project, driver } = createMemoryProject({ [KEY]: store([storedTask()]) });
        const text = driver.snapshot()[KEY];
        expect(await project.tasks.update(storedTask().id, { priority: 2, title: 'Raporu gönder' })).toMatchObject({ ok: true, changed: false });
        expect(await project.tasks.update('task_99999999-9999-4999-8999-999999999999', { title: 'Yok' })).toMatchObject({ ok: false, notFound: true });
        expect(driver.snapshot()[KEY]).toBe(text);
        expect(driver.count('writeText')).toBe(0);
    });

    it('update: not bloğundan gelen görevin todo etiketi bloktaki haliyle kalır', async () => {
        const { project, driver } = createMemoryProject({ [KEY]: store([storedTask()]) });
        await project.tasks.update(storedTask().id, { status: 'waiting' });
        expect(read(driver).tasks[0]).toMatchObject({ status: 'waiting', todoTag: 'todo.2.14-11-2026', priority: 2 });
    });

    it('kaynak yolu proje dışına çıkan görevi reddeder', async () => {
        const { project, driver } = createMemoryProject();
        await expect(project.tasks.upsert({ title: 'Kaçak', source: { nodePath: '../dışarı.node' } })).rejects.toMatchObject({ code: 'INVALID_KEY' });
        expect(driver.snapshot()).toEqual({});
    });
});
