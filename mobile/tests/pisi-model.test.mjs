import { describe, expect, it } from 'vitest';
import { getDayMarks, getTaskSourceTitle, getTaskTime, getWheelDays, groupDayTasks, parseTaskDraft } from '../src/screens/pisi/day-model.mjs';
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
const task = (id, fields = {}) => ({ id, title: id, status: 'todo', priority: 3, dueDate: null, scheduledAt: null, deadline: null, ...fields });
const ids = (entries) => entries.map((entry) => entry.task.id);

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
    const tasks = [
        task('saatli-geç', { scheduledAt: `${TODAY}T15:00` }),
        task('saatli-erken', { scheduledAt: `${TODAY}T07:30`, priority: 1 }),
        task('saatsiz-yüksek', { dueDate: TODAY, priority: 5 }),
        task('saatsiz-orta', { dueDate: TODAY }),
        task('gecikmiş-eski', { dueDate: '2026-11-01' }),
        task('gecikmiş-yeni', { deadline: '2026-11-13' }),
        task('yarın', { dueDate: '2026-11-15' }),
        task('tarihsiz'),
        task('bitti-bugün', { dueDate: TODAY, status: 'done', completedAt: new Date(2026, 10, 14, 8).toISOString() }),
        task('gecikmişti-bugün-bitti', { dueDate: '2026-11-10', status: 'done', completedAt: new Date(2026, 10, 14, 9).toISOString() }),
        task('dün-bitti', { dueDate: '2026-11-13', status: 'done', completedAt: new Date(2026, 10, 13, 9).toISOString() })
    ];

    it('bugün: gecikmişler, günün görevleri (önce saatliler, sonra öncelik) ve tamamlananlar', () => {
        const groups = groupDayTasks(tasks, { selectedDate: TODAY, today: TODAY });
        expect(ids(groups.overdue)).toEqual(['gecikmiş-eski', 'gecikmiş-yeni']);
        expect(ids(groups.day)).toEqual(['saatli-erken', 'saatli-geç', 'saatsiz-yüksek', 'saatsiz-orta']);
        expect(ids(groups.done)).toEqual(['gecikmişti-bugün-bitti', 'bitti-bugün']);
        expect(groups.overdue[0].day).toBe('2026-11-01');
    });

    it('başka bir günde "Gecikmiş" grubu boştur', () => {
        const tomorrow = groupDayTasks(tasks, { selectedDate: '2026-11-15', today: TODAY });
        expect([ids(tomorrow.overdue), ids(tomorrow.day), ids(tomorrow.done)]).toEqual([[], ['yarın'], []]);
        const yesterday = groupDayTasks(tasks, { selectedDate: '2026-11-13', today: TODAY });
        expect([ids(yesterday.overdue), ids(yesterday.day), ids(yesterday.done)]).toEqual([[], ['gecikmiş-yeni'], ['dün-bitti']]);
    });

    it('noktalar: açık görevi olan günler ve günlüğü olan günler', () => {
        const marks = getDayMarks(tasks, ['2026-11-12', TODAY]);
        expect([...marks.tasks].sort()).toEqual(['2026-11-01', '2026-11-13', TODAY, '2026-11-15']);
        expect([...marks.diary]).toEqual(['2026-11-12', TODAY]);
    });

    it('saat ve kaynak not meta bilgisi', () => {
        expect(getTaskTime(task('a', { scheduledAt: `${TODAY}T10:00` }))).toBe('10:00');
        expect(getTaskTime(task('a', { scheduledAt: TODAY }))).toBe(null);
        expect(getTaskSourceTitle(task('a', { source: { nodeTitle: 'Toplantı Notları', nodePath: 'x/y.node' } }))).toBe('Toplantı Notları');
        expect(getTaskSourceTitle(task('a', { source: { nodeTitle: '', nodePath: 'Projeler/Rapor.node' } }))).toBe('Rapor');
        expect(getTaskSourceTitle(task('a', { source: { nodePath: null } }))).toBe(null);
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
        expect(draft.payload).toMatchObject({ title: 'Süt al', scheduledAt: '2026-11-20', deadline: null, repeat: 'none' });
        expect([draft.day, draft.time, draft.deadline]).toEqual(['2026-11-20', null, false]);
    });

    it('yalnız saat yazılırsa seçili günün o saati olur', () => {
        const draft = parse('10:30 doktor', '2026-11-20');
        expect(draft.payload.scheduledAt).toBe('2026-11-20T10:30');
        expect([draft.day, draft.time]).toEqual(['2026-11-20', '10:30']);
    });

    it('Türkçe doğal tarih seçili günün önüne geçer', () => {
        const tomorrow = parse('yarın 14:00 rapor yaz', '2026-11-20');
        expect(tomorrow.payload).toMatchObject({ title: 'yarın 14:00 rapor yaz', scheduledAt: '2026-11-15T14:00' });
        expect([tomorrow.day, tomorrow.time]).toEqual(['2026-11-15', '14:00']);
        expect(parse('20 Kasım toplantı').day).toBe('2026-11-20');
    });

    it('"kadar" son tarih, "her gün" tekrar olarak okunur', () => {
        const deadline = parse('cuma gününe kadar faturayı öde');
        expect(deadline.payload.scheduledAt).toBe(null);
        expect([deadline.day, deadline.deadline]).toEqual(['2026-11-20', true]);
        const daily = parse('her gün yürüyüş', '2026-11-16');
        expect([daily.repeat, daily.payload.repeat, daily.day]).toEqual(['daily', 'daily', '2026-11-16']);
    });

    it('boş satır görev değildir', () => {
        expect(parse('   ')).toBe(null);
    });
});
