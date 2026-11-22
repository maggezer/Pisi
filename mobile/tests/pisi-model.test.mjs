import { describe, expect, it } from 'vitest';
import { getDayMarks, getTaskTime, getWheelDays, groupDayTasks, parseTaskDraft } from '../src/screens/pisi/day-model.mjs';
import {
    diffIsoDays,
    formatDayTitle,
    formatMonthShort,
    formatMonthTitle,
    formatShortDay,
    getMonthWeeks,
    getWeekdayNames,
    isoToDate,
    shiftIsoDate,
    shiftMonth
} from '../src/ui/dates.mjs';

// Saturday 14 November 2026, 09:30 local time.
const NOW = new Date(2026, 10, 14, 9, 30);
const TODAY = '2026-11-14';
// Version 2 records (docs/task-plan.md §3.1); the id of each is `task_<name>` in the characters an id may hold.
const task = (name, fields = {}) => ({
    id: `task_${name.replace(/[^A-Za-z0-9-]/g, '_')}`,
    title: name,
    status: 'todo',
    priority: 3,
    dueDate: null,
    dueTime: null,
    repeat: 'none',
    noteId: 'node_aaaa',
    diaryDate: null,
    completions: [],
    createdAt: '2026-11-01T08:00:00.000Z',
    completedAt: null,
    completedOn: null,
    ...fields
});
const ids = (entries) => entries.map((entry) => entry.task.title);

describe('gün yardımcıları', () => {
    it('gün kaydırır, farkı sayar ve geçersiz günü reddeder', () => {
        expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01');
        expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28');
        expect(diffIsoDays('2026-11-14', '2026-12-14')).toBe(30);
        expect(diffIsoDays('2026-11-14', '2026-11-01')).toBe(-13);
        expect(isoToDate('2026-02-30')).toBe(null);
        expect(isoToDate('bugün')).toBe(null);
    });

    it('başlığı "Cumartesi, 14 Kasım" biçiminde yazar; yıl yalnız farklıysa eklenir', () => {
        expect(formatDayTitle(TODAY, 'tr-TR', TODAY)).toBe('Cumartesi, 14 Kasım');
        expect(formatDayTitle('2026-11-12', 'tr-TR', TODAY)).toBe('Perşembe, 12 Kasım');
        expect(formatDayTitle('2027-01-01', 'tr-TR', TODAY)).toBe('Cuma, 1 Ocak 2027');
        expect(formatDayTitle(TODAY, 'en-GB', TODAY)).toBe('Saturday, 14 November');
    });

    it('ay etiketi yerelleştirilir: TR "Kas", ENG "Nov" (G2)', () => {
        expect(formatMonthShort(TODAY, 'tr-TR')).toBe('Kas');
        expect(formatMonthShort(TODAY, 'en-GB')).toBe('Nov');
        expect(formatShortDay('2026-11-12', 'tr-TR', TODAY)).toBe('12 Kas');
        expect(formatShortDay('2027-01-02', 'tr-TR', TODAY)).toBe('2 Oca 2027');
        expect(formatMonthTitle('2026-11', 'tr-TR')).toBe('Kasım 2026');
    });

    it('ay ızgarası pazartesi başlar', () => {
        expect(getWeekdayNames('tr-TR')).toEqual(['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']);
        const weeks = getMonthWeeks('2026-11');
        // 1 November 2026 is a Sunday: six empty cells, then the 1st.
        expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
        expect(weeks.at(-1)).toEqual(['2026-11-30', null, null, null, null, null, null]);
        expect(weeks.every((week) => week.length === 7)).toBe(true);
        expect([shiftMonth('2026-12', 1), shiftMonth('2026-01', -1)]).toEqual(['2027-01', '2025-12']);
    });
});

describe('günün görev grupları', () => {
    const done = (day, hour) => ({ status: 'done', completedAt: new Date(2026, 10, Number(day.slice(8)), hour).toISOString(), completedOn: day });
    const tasks = [
        task('saatli-geç', { dueDate: TODAY, dueTime: '15:00' }),
        task('saatli-erken', { dueDate: TODAY, dueTime: '07:30', priority: 1 }),
        task('saatsiz-yüksek', { dueDate: TODAY, priority: 5 }),
        task('saatsiz-orta', { dueDate: TODAY }),
        task('gecikmiş-eski', { dueDate: '2026-11-01' }),
        task('gecikmiş-yeni', { dueDate: '2026-11-13', priority: 4 }),
        task('yarın', { dueDate: '2026-11-15' }),
        task('tarihsiz'),
        // Lives in today's diary but is due another day: in today's section with its own day (§3.2.2).
        task('günlükte-yarınlı', { noteId: null, diaryDate: TODAY, dueDate: '2026-11-16' }),
        task('bitti-bugün', { dueDate: TODAY, ...done(TODAY, 8) }),
        task('gecikmişti-bugün-bitti', { dueDate: '2026-11-10', ...done(TODAY, 9) }),
        task('dün-bitti', { dueDate: '2026-11-13', ...done('2026-11-13', 9) }),
        // A daily task completed yesterday and today: today's completion can be taken back, yesterday's is locked (§3.2.3).
        task('spor', {
            repeat: 'daily',
            dueDate: '2026-11-15',
            completions: [
                { date: '2026-11-13', dueDate: '2026-11-13', at: new Date(2026, 10, 13, 7).toISOString() },
                { date: TODAY, dueDate: TODAY, at: new Date(2026, 10, 14, 7).toISOString() }
            ]
        })
    ];

    it('bugün: gecikmişler, günün görevleri (önce o günün saatlileri, sonra öncelik; sonra günlükteki başka günlüler) ve tamamlananlar', () => {
        const groups = groupDayTasks(tasks, { selectedDate: TODAY, today: TODAY });
        expect(ids(groups.overdue)).toEqual(['gecikmiş-eski', 'gecikmiş-yeni']);
        expect(ids(groups.day)).toEqual(['saatli-erken', 'saatli-geç', 'saatsiz-yüksek', 'saatsiz-orta', 'günlükte-yarınlı']);
        expect(ids(groups.done)).toEqual(['gecikmişti-bugün-bitti', 'bitti-bugün', 'spor']);
        expect(groups.overdue[0].day).toBe('2026-11-01');
        expect(groups.day.at(-1)).toMatchObject({ day: '2026-11-16', state: { state: 'dated' } });
        expect(groups.done.at(-1).state).toMatchObject({ state: 'done', locked: false });
    });

    it('başka bir günde "Gecikmiş" grubu boştur; geçmiş günde eski tamamlama kilitlidir', () => {
        const tomorrow = groupDayTasks(tasks, { selectedDate: '2026-11-15', today: TODAY });
        expect([ids(tomorrow.overdue), ids(tomorrow.day), ids(tomorrow.done)]).toEqual([[], ['spor', 'yarın'], []]);
        const yesterday = groupDayTasks(tasks, { selectedDate: '2026-11-13', today: TODAY });
        expect([ids(yesterday.overdue), ids(yesterday.day), ids(yesterday.done)]).toEqual([[], ['gecikmiş-yeni'], ['dün-bitti', 'spor']]);
        expect(yesterday.done.find((entry) => entry.task.title === 'spor').state).toMatchObject({ state: 'done', locked: true });
    });

    it('noktalar: o gün açık görevi olan günler (takvimin kuralı) ve günlüğü olan günler', () => {
        const marks = getDayMarks(tasks, ['2026-11-12', TODAY]);
        expect([...marks.tasks].sort()).toEqual(['2026-11-01', '2026-11-13', TODAY, '2026-11-15', '2026-11-16']);
        expect([...marks.diary]).toEqual(['2026-11-12', TODAY]);
    });

    it('saat yalnız günü olan görevde vardır', () => {
        expect(getTaskTime(task('a', { dueDate: TODAY, dueTime: '10:00' }))).toBe('10:00');
        expect(getTaskTime(task('a', { dueDate: TODAY }))).toBe(null);
        expect(getTaskTime(task('a', { dueTime: '10:00' }))).toBe(null);
    });

    it('çark seçili günün iki yanında eşit sayıda gün gösterir', () => {
        const days = getWheelDays(TODAY, 3);
        expect(days).toEqual(['2026-11-11', '2026-11-12', '2026-11-13', TODAY, '2026-11-15', '2026-11-16', '2026-11-17']);
        expect(getWheelDays(TODAY)).toHaveLength(91);
    });
});

describe('görev ekleme satırı', () => {
    const parse = (text, selectedDate = TODAY) => parseTaskDraft(text, { selectedDate, now: NOW });

    it('tarih yazılmazsa seçili gün kullanılır; başlık yazıldığı gibi kalır', () => {
        const draft = parse('  Süt al  ', '2026-11-20');
        expect(draft.payload).toEqual({ title: 'Süt al', dueDate: '2026-11-20', dueTime: null, reminderAt: null, repeat: 'none', completionOffsetDays: null });
        expect([draft.day, draft.time]).toEqual(['2026-11-20', null]);
    });

    it('yalnız saat yazılırsa seçili günün o saati olur', () => {
        const draft = parse('10:30 doktor', '2026-11-20');
        expect(draft.payload).toMatchObject({ dueDate: '2026-11-20', dueTime: '10:30' });
        expect([draft.day, draft.time]).toEqual(['2026-11-20', '10:30']);
    });

    it('Türkçe doğal tarih seçili günün önüne geçer', () => {
        const tomorrow = parse('yarın 14:00 rapor yaz', '2026-11-20');
        expect(tomorrow.payload).toMatchObject({ title: 'yarın 14:00 rapor yaz', dueDate: '2026-11-15', dueTime: '14:00' });
        expect([tomorrow.day, tomorrow.time]).toEqual(['2026-11-15', '14:00']);
        expect(parse('20 Kasım toplantı').day).toBe('2026-11-20');
    });

    it('"kadar" bitiş günü, "her gün" tekrar olarak okunur; başlıktaki sayı tarih sayılmaz (pisi-error.md §5e)', () => {
        const deadline = parse('cuma gününe kadar faturayı öde');
        expect([deadline.day, deadline.payload.dueDate]).toEqual(['2026-11-20', '2026-11-20']);
        const daily = parse('her gün yürüyüş', '2026-11-16');
        expect([daily.repeat, daily.payload.repeat, daily.day]).toEqual(['daily', 'daily', '2026-11-16']);
        expect(parse('3 kitap oku', '2026-11-16').day).toBe('2026-11-16');
    });

    it('boş satır görev değildir', () => {
        expect(parse('   ')).toBe(null);
    });
});
