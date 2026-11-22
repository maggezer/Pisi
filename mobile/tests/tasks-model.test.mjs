import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPisiTask } from '../../shared/task-model.mjs';
import { filterPisiTasks } from '../../shared/task-views.mjs';
import { parseTaskDraft } from '../src/screens/pisi/day-model.mjs';
import { getTaskChoicePatch, getTaskDatePatch, getTaskReminderPatch, getTaskTimePatch, getTaskTitlePatch } from '../src/screens/tasks/task-edit.mjs';
import { PISI_TASK_VIEWS, buildTaskLists, getTaskView, getTaskViewCounts, getTaskViewGroups } from '../src/screens/tasks/view-model.mjs';
import { NOW, TODAY, createMemoryProject } from './data-helpers.mjs';

const titles = (entries) => entries.map((entry) => entry.task.title);

/**
 * The desktop's lists for the same tasks: the task panel hides finished tasks
 * and puts the rest in buckets by their due day (shared/task-views.mjs,
 * filterPisiTasks over the version 2 records the task service reads).
 */
function desktopList(tasks, filter) {
    return filterPisiTasks(tasks.map(readPisiTask), { dateFilter: filter, today: TODAY })
        .map((task) => task.title)
        .sort();
}

describe('Görevler: görünüm modeli', () => {
    it('masaüstünün oluşturduğu projede masaüstü filtreleriyle aynı listeleri verir', () => {
        const fixture = path.resolve(import.meta.dirname, '../../tests/fixtures/desktop-project/.pisi/tasks.json');
        const { tasks } = JSON.parse(fs.readFileSync(fixture, 'utf8'));
        const lists = buildTaskLists(tasks, { today: TODAY });
        const sorted = (entries) => titles(entries).sort();

        expect(sorted(lists.today)).toEqual(desktopList(tasks, 'today'));
        expect(sorted(lists.week)).toEqual(desktopList(tasks, 'upcoming'));
        expect(sorted(lists.overdue)).toEqual(desktopList(tasks, 'overdue'));
        expect(sorted(lists.undated)).toEqual(desktopList(tasks, 'undated'));
        // Listeler boş değil: karşılaştırma gerçekten bir şey sınıyor.
        // Bugün listesinde önce saati olan görev (dueTime, §3.1), sonra öncelik.
        expect(titles(lists.today)).toEqual(['Raporu gönder', 'Egzersiz']);
        expect(titles(lists.week)).toEqual(['Sunucu faturasını öde']);
        expect(titles(lists.overdue)).toEqual(['Haftalık özet yaz']);
        expect(titles(lists.undated)).toEqual(['Okuma listesini düzenle']);
        expect(titles(lists.done)).toEqual(['Toplantı odasını ayır']);
    });

    it('mobilin yazdığı görevler sınır günlerinde de masaüstüyle aynı kovaya düşer', async () => {
        const { project } = createMemoryProject();
        await project.open();
        const day = (offset) => {
            const date = new Date(NOW);
            date.setDate(date.getDate() + offset);
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        };
        const drafts = [
            { title: 'dün', dueDate: day(-1) },
            { title: 'geçen yıl', dueDate: day(-400), dueTime: '09:00' },
            { title: 'bugün', dueDate: day(0) },
            { title: 'bugün saatli', dueDate: day(0), dueTime: '23:30' },
            { title: 'yarın', dueDate: day(1) },
            { title: 'yedi gün sonra', dueDate: day(7) },
            { title: 'sekiz gün sonra', dueDate: day(8) },
            { title: 'gelecek yıl', dueDate: day(400) },
            { title: 'tarihsiz', dueDate: null },
            { title: 'bitti', dueDate: day(0), status: 'done' },
            { title: 'tarihsiz bitti', dueDate: null, status: 'done' }
        ];
        // Everything added on the phone lives in today's diary (docs/task-plan.md G8).
        for (const draft of drafts) expect((await project.tasks.create(draft, { diaryDate: TODAY })).ok).toBe(true);
        const { tasks } = await project.tasks.list();
        const lists = buildTaskLists(tasks, { today: TODAY });
        const sorted = (entries) => titles(entries).sort();

        expect(sorted(lists.today)).toEqual(['bugün', 'bugün saatli']);
        expect(sorted(lists.week)).toEqual(['yarın', 'yedi gün sonra']);
        expect(sorted(lists.later)).toEqual(['gelecek yıl', 'sekiz gün sonra']);
        expect(sorted(lists.overdue)).toEqual(['dün', 'geçen yıl']);
        expect(sorted(lists.undated)).toEqual(['tarihsiz']);
        expect(sorted(lists.done)).toEqual(['bitti', 'tarihsiz bitti']);
        for (const [list, filter] of [
            ['today', 'today'],
            ['week', 'upcoming'],
            ['overdue', 'overdue'],
            ['undated', 'undated']
        ]) {
            expect(sorted(lists[list]), filter).toEqual(desktopList(tasks, filter));
        }
        // "Tümü" masaüstünde açık görevlerin hepsidir; mobilde açık görevler beş listeye eksiksiz dağılır.
        expect([...lists.today, ...lists.week, ...lists.later, ...lists.overdue, ...lists.undated].map((entry) => entry.task.title).sort()).toEqual(
            desktopList(tasks, 'all')
        );
    });

    const task = (title, fields = {}) => ({ id: title, title, status: 'todo', priority: 3, manualOrder: 0, dueDate: null, dueTime: null, ...fields });

    it('sıralama: bugün önce saatliler; yaklaşan ve gecikmiş güne göre; tarihsiz önceliğe göre; tamamlanan son bitenden', () => {
        const lists = buildTaskLists(
            [
                task('saatsiz', { dueDate: TODAY, priority: 5 }),
                task('saatli', { dueDate: TODAY, dueTime: '08:00', priority: 1 }),
                task('salı', { dueDate: '2026-11-17' }),
                task('pazar', { dueDate: '2026-11-15' }),
                task('eski', { dueDate: '2026-10-01' }),
                task('dün', { dueDate: '2026-11-13' }),
                task('düşük', { priority: 1 }),
                task('yüksek', { priority: 5 }),
                task('önce biten', { status: 'done', completedAt: '2026-11-10T08:00:00.000Z' }),
                task('son biten', { status: 'done', completedAt: '2026-11-13T08:00:00.000Z' }),
                // A repeating task is never done: its completions move it on, it stays in its day's list.
                task('tekrar', { repeat: 'daily', dueDate: '2026-11-15', completions: [{ date: TODAY, dueDate: TODAY, at: '2026-11-14T07:00:00.000Z' }] })
            ],
            { today: TODAY }
        );
        expect(titles(lists.today)).toEqual(['saatli', 'saatsiz']);
        expect(titles(lists.week)).toEqual(['pazar', 'tekrar', 'salı']);
        expect(titles(lists.overdue)).toEqual(['eski', 'dün']);
        expect(titles(lists.undated)).toEqual(['yüksek', 'düşük']);
        expect(titles(lists.done)).toEqual(['son biten', 'önce biten']);
    });

    it('çip sayıları ve gruplar: "Yaklaşan" 7 gün içini ve daha sonrasını ayrı gösterir', () => {
        const lists = buildTaskLists([task('yarın', { dueDate: '2026-11-15' }), task('uzak', { dueDate: '2026-12-30' }), task('tarihsiz')], { today: TODAY });
        expect(PISI_TASK_VIEWS).toEqual(['today', 'upcoming', 'overdue', 'undated', 'done']);
        expect(getTaskViewCounts(lists)).toEqual({ today: 0, upcoming: 2, overdue: 0, undated: 1, done: 0 });
        expect(getTaskViewGroups(lists, 'upcoming').map((group) => [group.id, titles(group.entries)])).toEqual([
            ['week', ['yarın']],
            ['later', ['uzak']]
        ]);
        expect(getTaskViewGroups(lists, 'today')).toEqual([]);
        expect(getTaskView(task('x', { dueDate: '2026-12-30' }), { today: TODAY })).toBe('upcoming');
        expect(getTaskView(task('x'), { today: TODAY })).toBe('undated');
        expect(getTaskView(task('x', { dueDate: TODAY, status: 'done' }), { today: TODAY })).toBe('done');
    });
});

describe('Görevler: hızlı ekle satırının okunması', () => {
    const read = (text) => parseTaskDraft(text, { now: NOW });

    it('tarih yazılmazsa görev tarihsiz kalır; başlık yazıldığı gibidir', () => {
        const draft = read('  Okuma listesini   düzenle ');
        expect(draft).toMatchObject({ day: null, time: null, repeat: 'none' });
        expect(draft.payload).toMatchObject({ title: 'Okuma listesini düzenle', dueDate: null, dueTime: null });
    });

    it('yalnız saat yazılırsa bugünün o saati olur', () => {
        expect(read('saat 18 spor')).toMatchObject({ day: TODAY, time: '18:00' });
        expect(read('15:30 toplantı').payload).toMatchObject({ dueDate: TODAY, dueTime: '15:30' });
    });

    it('doğal dil: gün, saat, tekrar ve bitiş günü', () => {
        expect(read('yarın 14:00 rapor')).toMatchObject({ day: '2026-11-15', time: '14:00' });
        expect(read('bugün market')).toMatchObject({ day: TODAY, time: null });
        expect(read('her pazartesi saat 9 toplantı')).toMatchObject({ day: '2026-11-16', time: '09:00', repeat: 'weekly' });
        expect(read('20.11 kira')).toMatchObject({ day: '2026-11-20', time: null });
        expect(read('20 kasıma kadar rapor').payload).toMatchObject({ dueDate: '2026-11-20' });
        expect(read('her gün ilaç')).toMatchObject({ day: null, repeat: 'daily' });
        expect(read('   ')).toBe(null);
    });
});

describe('Görevler: düzenleme kuralları', () => {
    const base = {
        id: 'task_rapor',
        title: 'Rapor',
        status: 'todo',
        priority: 3,
        dueDate: TODAY,
        dueTime: '10:00',
        reminderAt: null,
        reminderMode: 'none',
        repeat: 'none',
        noteId: 'node_aaaa',
        diaryDate: null
    };

    it('tarih: gün değişir (saat kayıtta kalır); değişmeyen ya da geçersiz tarih yama üretmez', () => {
        expect(getTaskDatePatch(base, '2026-11-20')).toEqual({ dueDate: '2026-11-20' });
        expect(getTaskDatePatch({ ...base, dueDate: null, dueTime: null }, '2026-11-20')).toEqual({ dueDate: '2026-11-20' });
        expect(getTaskDatePatch(base, null)).toEqual({ dueDate: null });
        expect(getTaskDatePatch(base, TODAY)).toBe(null);
        expect(getTaskDatePatch(base, '2026-02-30')).toBe(null);
        expect(getTaskDatePatch({ ...base, dueDate: null }, null)).toBe(null);
    });

    it('saat: günü olan göreve yazılır ya da kaldırılır; tarihsiz görevin saati olmaz', () => {
        expect(getTaskTimePatch(base, '15:30')).toEqual({ dueTime: '15:30' });
        expect(getTaskTimePatch(base, '')).toEqual({ dueTime: null });
        expect(getTaskTimePatch(base, '10:00')).toBe(null);
        expect(getTaskTimePatch({ ...base, dueTime: null }, '09:00')).toEqual({ dueTime: '09:00' });
        expect(getTaskTimePatch({ ...base, dueDate: null, dueTime: null }, '09:00')).toBe(null);
        expect(getTaskTimePatch({ ...base, dueTime: null }, '')).toBe(null);
    });

    it('başlık, hatırlatma ve seçim alanları yalnız değişince yama üretir; nottaki görev de bütün alanlarıyla düzenlenir', () => {
        expect(getTaskTitlePatch(base, '  Yeni   başlık ')).toEqual({ title: 'Yeni başlık' });
        expect(getTaskTitlePatch(base, 'Rapor ')).toBe(null);
        expect(getTaskTitlePatch(base, '   ')).toBe(null);
        expect(getTaskReminderPatch(base, '2026-11-13T09:00')).toEqual({ reminderAt: '2026-11-13T09:00' });
        expect(getTaskReminderPatch({ ...base, reminderAt: '2026-11-13T09:00' }, '')).toEqual({ reminderAt: null });
        expect(getTaskReminderPatch(base, '')).toBe(null);
        expect(getTaskChoicePatch(base, 'priority', '5')).toEqual({ priority: 5 });
        expect(getTaskChoicePatch(base, 'priority', '3')).toBe(null);
        expect(getTaskChoicePatch(base, 'repeat', 'weekly')).toEqual({ repeat: 'weekly' });
        expect(getTaskChoicePatch({ ...base, reminderMode: undefined }, 'reminderMode', 'none')).toBe(null);
        expect(getTaskChoicePatch(base, 'reminderMode', 'day-before')).toEqual({ reminderMode: 'day-before' });
    });
});
