// Calendar-day helpers for the interface. A day is a local `YYYY-MM-DD`
// string, the form the task and diary rules in shared/ use. Names of days and
// months come from Intl in the app's language, never from a fixed list.

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (value) => String(value).padStart(2, '0');

/** Local midnight of an ISO day, or null when the text is not a real day. */
export function isoToDate(isoDate) {
    const match = ISO_DAY.exec(String(isoDate ?? ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getMonth() === Number(match[2]) - 1 ? date : null;
}

export function dateToIso(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function shiftIsoDate(isoDate, days) {
    const date = isoToDate(isoDate);
    date.setDate(date.getDate() + days);
    return dateToIso(date);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffIsoDays(from, to) {
    const start = isoToDate(from);
    const end = isoToDate(to);
    return Math.round(
        (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000
    );
}

const part = (isoDate, locale, options) => new Intl.DateTimeFormat(locale, options).format(isoToDate(isoDate));

/** "Cumartesi, 14 Kasım"; the year is added only when it is not `today`'s year. */
export function formatDayTitle(isoDate, locale, today = isoDate) {
    const title = `${part(isoDate, locale, { weekday: 'long' })}, ${Number(isoDate.slice(8, 10))} ${part(isoDate, locale, { month: 'long' })}`;
    return isoDate.slice(0, 4) === today.slice(0, 4) ? title : `${title} ${isoDate.slice(0, 4)}`;
}

/** "14 Kas"; with the year when it is not `today`'s year. */
export function formatShortDay(isoDate, locale, today = isoDate) {
    const short = `${Number(isoDate.slice(8, 10))} ${formatMonthShort(isoDate, locale)}`;
    return isoDate.slice(0, 4) === today.slice(0, 4) ? short : `${short} ${isoDate.slice(0, 4)}`;
}

/** "Kas" / "Nov", without the full stop some locales add. */
export function formatMonthShort(isoDate, locale) {
    return part(isoDate, locale, { month: 'short' }).replace(/\.$/, '');
}

/** "Kasım 2026" for a `YYYY-MM` month. */
export function formatMonthTitle(month, locale) {
    return part(`${month}-01`, locale, { month: 'long', year: 'numeric' });
}

export function shiftMonth(month, delta) {
    const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** Short weekday names, Monday first (the week starts on Monday in the app). */
export function getWeekdayNames(locale, width = 'short') {
    // 2024-01-01 is a Monday.
    return Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: width }).format(new Date(2024, 0, 1 + index)));
}

/**
 * The weeks of a `YYYY-MM` month, Monday first. Each week has seven cells:
 * an ISO day, or null for the cells that belong to the neighbouring months.
 */
export function getMonthWeeks(month) {
    const year = Number(month.slice(0, 4));
    const monthIndex = Number(month.slice(5, 7)) - 1;
    const days = new Date(year, monthIndex + 1, 0).getDate();
    const lead = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
    const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, index) => `${month}-${pad(index + 1)}`)];
    while (cells.length % 7) cells.push(null);
    return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}
