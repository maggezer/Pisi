import moment from 'moment-hijri';
import { Lunar, LunarMonth } from 'lunar-javascript';

const GREGORIAN_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

const HIJRI_MONTHS = [
  'Muharrem', 'Safer', 'Rebiülevvel', 'Rebiülahir',
  'Cemaziyelevvel', 'Cemaziyelahir', 'Recep', 'Şaban',
  'Ramazan', 'Şevval', 'Zilkade', 'Zilhicce'
];

function mondayIndex(day) {
  return day === 0 ? 6 : day - 1;
}

export function solarDateKey(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isTodayKey(dateKey) {
  const today = new Date();
  return dateKey === solarDateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
}

export function createCalendarCursor(type, date = new Date()) {
  if (type === 'hijri') {
    const current = moment(date);
    return { year: current.iYear(), month: current.iMonth() };
  }
  if (type === 'lunar') {
    const current = Lunar.fromDate(date);
    return { year: current.getYear(), month: current.getMonth() };
  }
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function shiftCalendarCursor(type, cursor, amount) {
  if (type === 'hijri') {
    const current = moment(`${cursor.year}/${cursor.month + 1}/1`, 'iYYYY/iM/iD').add(amount, 'iMonth');
    return { year: current.iYear(), month: current.iMonth() };
  }
  if (type === 'lunar') {
    const month = LunarMonth.fromYm(cursor.year, cursor.month)?.next(amount);
    return month
      ? { year: month.getYear(), month: month.getMonth() }
      : cursor;
  }
  const date = new Date(cursor.year, cursor.month + amount, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function getCalendarMonth(type, cursor) {
  if (type === 'hijri') return getHijriMonth(cursor);
  if (type === 'lunar') return getLunarMonth(cursor);
  return getGregorianMonth(cursor);
}

function getGregorianMonth(cursor) {
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const firstDay = mondayIndex(new Date(cursor.year, cursor.month, 1).getDay());
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const dateKey = solarDateKey(cursor.year, cursor.month + 1, day);
    return {
      day,
      dateKey,
      isToday: isTodayKey(dateKey),
      journalTitle: `${day} ${GREGORIAN_MONTHS[cursor.month]} ${cursor.year} Günlüğü`
    };
  });

  return {
    title: `${GREGORIAN_MONTHS[cursor.month]} ${cursor.year}`,
    firstDay,
    days
  };
}

function getHijriMonth(cursor) {
  const daysInMonth = moment.iDaysInMonth(cursor.year, cursor.month);
  const first = moment(`${cursor.year}/${cursor.month + 1}/1`, 'iYYYY/iM/iD');
  const firstDay = mondayIndex(first.day());
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const solar = moment(`${cursor.year}/${cursor.month + 1}/${day}`, 'iYYYY/iM/iD');
    const dateKey = solarDateKey(solar.year(), solar.month() + 1, solar.date());
    return {
      day,
      dateKey,
      isToday: isTodayKey(dateKey),
      journalTitle: `${day} ${HIJRI_MONTHS[cursor.month]} ${cursor.year} Günlüğü`
    };
  });

  return {
    title: `${HIJRI_MONTHS[cursor.month]} ${cursor.year}`,
    firstDay,
    days
  };
}

function getLunarMonth(cursor) {
  const lunarMonth = LunarMonth.fromYm(cursor.year, cursor.month);
  if (!lunarMonth) {
    return { title: 'Ay bilgisi bulunamadı', firstDay: 0, days: [] };
  }
  const daysInMonth = lunarMonth.getDayCount();
  const firstSolar = Lunar.fromYmd(cursor.year, cursor.month, 1).getSolar();
  const firstDay = mondayIndex(firstSolar.getWeek());
  const monthNumber = Math.abs(cursor.month);
  const monthLabel = cursor.month < 0 ? `Artık ${monthNumber}. Ay` : `${monthNumber}. Ay`;
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const solar = Lunar.fromYmd(cursor.year, cursor.month, day).getSolar();
    const dateKey = solarDateKey(solar.getYear(), solar.getMonth(), solar.getDay());
    return {
      day,
      dateKey,
      isToday: isTodayKey(dateKey),
      journalTitle: `${day} ${monthLabel} ${cursor.year} Günlüğü`
    };
  });

  return {
    title: `${monthLabel} ${cursor.year}`,
    firstDay,
    days
  };
}

