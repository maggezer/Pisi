import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPisiTaskTodoTag, matchesPisiTodoFilter, parsePisiTodoTagValue } from '../../shared/task-views.mjs';
import { parseTaskDraft } from '../src/screens/pisi/day-model.mjs';
import {
    getEditableTaskFields,
    getTaskChoicePatch,
    getTaskDatePatch,
    getTaskReminderPatch,
    getTaskTimePatch,
    getTaskTitlePatch,
    limitTaskPatch
} from '../src/screens/tasks/task-edit.mjs';
import { PISI_TASK_VIEWS, buildTaskLists, getTaskView, getTaskViewCounts, getTaskViewGroups } from '../src/screens/tasks/view-model.mjs';
import { NOW, TODAY, createMemoryProject } from './data-helpers.mjs';

const titles = (entries) => entries.map((entry) => entry.task.title);

/**
 * The desktop's lists for the same tasks: the task panel hides finished tasks
 * and filters the rest with matchesPisiTodoFilter on the date of the todo tag
 * (renderer/tags/pisi-todo-third-query.mjs, getPisiThirdVisibleMissions).
 */
function desktopList(tasks, filter, now) {
    return tasks
        .filter((task) => task.status !== 'done')
        .filter((task) => matchesPisiTodoFilter({ finishDate: parsePisiTodoTagValue(getPisiTaskTodoTag(task), now)?.finishDate ?? null }, filter, now))
        .map((task) => task.title)
        .sort();
}

describe('Görevler: görünüm modeli', () => {
    it('masaüstünün oluşturduğu projede masaüstü filtreleriyle aynı listeleri verir', () => {
        const fixture = path.resolve(import.meta.dirname, '../../tests/fixtures/desktop-project/.pisi/tasks.json');
        const { tasks } = JSON.parse(fs.readFileSync(fixture, 'utf8'));
        const lists = buildTaskLists(tasks, { today: TODAY });
        const sorted = (entries) => titles(entries).sort();

        expect(sorted(lists.today)).toEqual(desktopList(tasks, 'today', NOW));
        expect(sorted(lists.week)).toEqual(desktopList(tasks, 'upcoming', NOW));
        expect(sorted(lists.overdue)).toEqual(desktopList(tasks, 'overdue', NOW));
        expect(sorted(lists.inbox)).toEqual(desktopList(tasks, 'undated', NOW));
        // Listeler boş değil: karşılaştırma gerçekten bir şey sınıyor.
        expect(titles(lists.today)).toEqual(['Raporu gönder', 'Egzersiz']);
        expect(titles(lists.week)).toEqual(['Sunucu faturasını öde']);
        expect(titles(lists.overdue)).toEqual(['Haftalık özet yaz']);
        expect(titles(lists.inbox)).toEqual(['Okuma listesini düzenle']);
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
            { title: 'geçen yıl', scheduledAt: `${day(-400)}T09:00` },
            { title: 'bugün', dueDate: day(0) },
            { title: 'bugün saatli', scheduledAt: `${day(0)}T23:30` },
            { title: 'yarın', dueDate: day(1) },
            { title: 'yedi gün sonra', deadline: day(7) },
            { title: 'sekiz gün sonra', dueDate: day(8) },
            { title: 'gelecek yıl', dueDate: day(400) },
            { title: 'tarihsiz' },
            { title: 'bitti', dueDate: day(0), status: 'done' },
            { title: 'tarihsiz bitti', status: 'done' }
        ];
        for (const draft of drafts) await project.tasks.upsert(draft);
        const { tasks } = await project.tasks.list();
        const lists = buildTaskLists(tasks, { today: TODAY });
        const sorted = (entries) => titles(entries).sort();

        expect(sorted(lists.today)).toEqual(['bugün', 'bugün saatli']);
        expect(sorted(lists.week)).toEqual(['yarın', 'yedi gün sonra']);
        expect(sorted(lists.later)).toEqual(['gelecek yıl', 'sekiz gün sonra']);
        expect(sorted(lists.overdue)).toEqual(['dün', 'geçen yıl']);
        expect(sorted(lists.inbox)).toEqual(['tarihsiz']);
        expect(sorted(lists.done)).toEqual(['bitti', 'tarihsiz bitti']);
        for (const [list, filter] of [
            ['today', 'today'],
            ['week', 'upcoming'],
            ['overdue', 'overdue'],
            ['inbox', 'undated']
        ]) {
            expect(sorted(lists[list]), filter).toEqual(desktopList(tasks, filter, NOW));
        }
        // "Tümü" masaüstünde açık görevlerin hepsidir; mobilde açık görevler beş listeye eksiksiz dağılır.
        expect([...lists.today, ...lists.week, ...lists.later, ...lists.overdue, ...lists.inbox].map((entry) => entry.task.title).sort()).toEqual(
            desktopList(tasks, 'all', NOW)
        );
    });

    const task = (title, fields = {}) => ({ id: title, title, status: 'todo', priority: 3, manualOrder: 0, ...fields });

    it('sıralama: bugün önce saatliler; yaklaşan ve gecikmiş güne göre; gelen kutusu önceliğe göre; tamamlanan son bitenden', () => {
        const lists = buildTaskLists(
            [
                task('saatsiz', { dueDate: TODAY, priority: 5 }),
                task('saatli', { scheduledAt: `${TODAY}T08:00`, priority: 1 }),
                task('salı', { dueDate: '2026-11-17' }),
                task('pazar', { dueDate: '2026-11-15' }),
                task('eski', { dueDate: '2026-10-01' }),
                task('dün', { dueDate: '2026-11-13' }),
                task('düşük', { priority: 1 }),
                task('yüksek', { priority: 5 }),
                task('önce biten', { status: 'done', completedAt: '2026-11-10T08:00:00.000Z' }),
                task('son biten', { status: 'done', completedAt: '2026-11-13T08:00:00.000Z' })
            ],
            { today: TODAY }
        );
        expect(titles(lists.today)).toEqual(['saatli', 'saatsiz']);
        expect(titles(lists.week)).toEqual(['pazar', 'salı']);
        expect(titles(lists.overdue)).toEqual(['eski', 'dün']);
        expect(titles(lists.inbox)).toEqual(['yüksek', 'düşük']);
        expect(titles(lists.done)).toEqual(['son biten', 'önce biten']);
    });

    it('çip sayıları ve gruplar: "Yaklaşan" 7 gün içini ve daha sonrasını ayrı gösterir', () => {
        const lists = buildTaskLists([task('yarın', { dueDate: '2026-11-15' }), task('uzak', { dueDate: '2026-12-30' }), task('tarihsiz')], { today: TODAY });
        expect(PISI_TASK_VIEWS).toEqual(['today', 'upcoming', 'overdue', 'inbox', 'done']);
        expect(getTaskViewCounts(lists)).toEqual({ today: 0, upcoming: 2, overdue: 0, inbox: 1, done: 0 });
        expect(getTaskViewGroups(lists, 'upcoming').map((group) => [group.id, titles(group.entries)])).toEqual([
            ['week', ['yarın']],
            ['later', ['uzak']]
        ]);
        expect(getTaskViewGroups(lists, 'today')).toEqual([]);
        expect(getTaskView(task('x', { dueDate: '2026-12-30' }), { today: TODAY })).toBe('upcoming');
        expect(getTaskView(task('x'), { today: TODAY })).toBe('inbox');
        expect(getTaskView(task('x', { dueDate: TODAY, status: 'done' }), { today: TODAY })).toBe('done');
    });
});

describe('Görevler: hızlı ekle satırının okunması', () => {
    const read = (text) => parseTaskDraft(text, { now: NOW });

    it('tarih yazılmazsa görev tarihsiz kalır; başlık yazıldığı gibidir', () => {
        const draft = read('  Okuma listesini   düzenle ');
        expect(draft).toMatchObject({ day: null, time: null, repeat: 'none' });
        expect(draft.payload).toMatchObject({ title: 'Okuma listesini düzenle', scheduledAt: null, deadline: null });
    });

    it('yalnız saat yazılırsa bugünün o saati olur', () => {
        expect(read('saat 18 spor')).toMatchObject({ day: TODAY, time: '18:00' });
        expect(read('15:30 toplantı').payload.scheduledAt).toBe(`${TODAY}T15:30`);
    });

    it('doğal dil: gün, saat, tekrar ve son tarih', () => {
        expect(read('yarın 14:00 rapor')).toMatchObject({ day: '2026-11-15', time: '14:00' });
        expect(read('bugün market')).toMatchObject({ day: TODAY, time: null });
        expect(read('her pazartesi saat 9 toplantı')).toMatchObject({ day: '2026-11-16', time: '09:00', repeat: 'weekly' });
        expect(read('20.11 kira')).toMatchObject({ day: '2026-11-20', time: null });
        expect(read('20 kasıma kadar rapor')).toMatchObject({ day: '2026-11-20', deadline: true });
        expect(read('her gün ilaç')).toMatchObject({ day: null, repeat: 'daily' });
        expect(read('   ')).toBe(null);
    });
});

describe('Görevler: düzenleme kuralları', () => {
    const base = {
        id: 'task_1',
        title: 'Rapor',
        status: 'todo',
        priority: 3,
        dueDate: TODAY,
        scheduledAt: `${TODAY}T10:00`,
        deadline: null,
        reminderAt: null,
        reminderMode: 'none',
        repeat: 'none',
        source: { nodePath: null, blockId: null }
    };

    it('tarih: saat korunur; günü veren alan taşınır; değişmeyen tarih yama üretmez', () => {
        expect(getTaskDatePatch(base, '2026-11-20')).toEqual({ dueDate: '2026-11-20', scheduledAt: '2026-11-20T10:00' });
        expect(getTaskDatePatch({ ...base, scheduledAt: null }, '2026-11-20')).toEqual({ dueDate: '2026-11-20' });
        expect(getTaskDatePatch({ ...base, dueDate: null, scheduledAt: null, deadline: '2026-11-18T17:00' }, '2026-11-20')).toEqual({
            dueDate: '2026-11-20',
            deadline: '2026-11-20T17:00'
        });
        expect(getTaskDatePatch({ ...base, dueDate: null, scheduledAt: null }, '2026-11-20')).toEqual({ dueDate: '2026-11-20' });
        expect(getTaskDatePatch(base, null)).toEqual({ dueDate: '', scheduledAt: '', deadline: '' });
        expect(getTaskDatePatch(base, TODAY)).toBe(null);
        expect(getTaskDatePatch({ ...base, dueDate: null, scheduledAt: null }, null)).toBe(null);
    });

    it('saat: günü olan göreve yazılır ya da kaldırılır; tarihsiz görevin saati olmaz', () => {
        expect(getTaskTimePatch(base, '15:30')).toEqual({ scheduledAt: `${TODAY}T15:30` });
        expect(getTaskTimePatch(base, '')).toEqual({ scheduledAt: TODAY });
        expect(getTaskTimePatch(base, '10:00')).toBe(null);
        expect(getTaskTimePatch({ ...base, scheduledAt: null }, '09:00')).toEqual({ scheduledAt: `${TODAY}T09:00` });
        expect(getTaskTimePatch({ ...base, dueDate: null, scheduledAt: null }, '09:00')).toBe(null);
        expect(getTaskTimePatch({ ...base, scheduledAt: TODAY }, '')).toBe(null);
    });

    it('başlık, hatırlatma ve seçim alanları yalnız değişince yama üretir', () => {
        expect(getTaskTitlePatch(base, '  Yeni   başlık ')).toEqual({ title: 'Yeni başlık' });
        expect(getTaskTitlePatch(base, 'Rapor ')).toBe(null);
        expect(getTaskTitlePatch(base, '   ')).toBe(null);
        expect(getTaskReminderPatch(base, '2026-11-13T09:00')).toEqual({ reminderAt: '2026-11-13T09:00' });
        expect(getTaskReminderPatch({ ...base, reminderAt: '2026-11-13T09:00' }, '')).toEqual({ reminderAt: '' });
        expect(getTaskReminderPatch(base, '')).toBe(null);
        expect(getTaskChoicePatch(base, 'priority', '5')).toEqual({ priority: 5 });
        expect(getTaskChoicePatch(base, 'priority', '3')).toBe(null);
        expect(getTaskChoicePatch(base, 'repeat', 'weekly')).toEqual({ repeat: 'weekly' });
        expect(getTaskChoicePatch({ ...base, reminderMode: undefined }, 'reminderMode', 'none')).toBe(null);
        expect(getTaskChoicePatch(base, 'reminderMode', 'day-before')).toEqual({ reminderMode: 'day-before' });
    });

    it('kaynağı not bloğu olan görevde yalnız durum değişir', () => {
        const noteTask = { ...base, source: { nodePath: 'Inbox.node', blockId: 'blk_1' } };
        expect(getEditableTaskFields(noteTask)).toEqual(['status']);
        expect(getEditableTaskFields(base)).toContain('title');
        expect(limitTaskPatch(noteTask, { title: 'x', priority: 5, dueDate: '2026-11-20', status: 'doing' })).toEqual({ status: 'doing' });
        expect(limitTaskPatch(noteTask, { title: 'x' })).toBe(null);
        expect(limitTaskPatch(base, { title: 'x', dueDate: '', bilinmeyen: 1 })).toEqual({ title: 'x', dueDate: '' });
        // Kaynağı yalnız bir not olan (bloğu olmayan) görev serbestçe düzenlenir.
        expect(getEditableTaskFields({ ...base, source: { nodePath: 'Ev.node', blockId: null } })).toContain('date');
    });
});
