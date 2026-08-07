import moment from 'moment-hijri';
import { Lunar, LunarMonth } from 'lunar-javascript';

const GREGORIAN_MONTHS = {
  tr: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
};

const HIJRI_MONTHS = {
  tr: ['Muharrem', 'Safer', 'Rebiülevvel', 'Rebiülahir', 'Cemaziyelevvel', 'Cemaziyelahir', 'Recep', 'Şaban', 'Ramazan', 'Şevval', 'Zilkade', 'Zilhicce'],
  en: ['Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Awwal', 'Jumada al-Thani', 'Rajab', 'Sha’ban', 'Ramadan', 'Shawwal', 'Dhu al-Qadah', 'Dhu al-Hijjah']
};

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

export function getCalendarMonth(type, cursor, locale = 'tr') {
  const language = locale === 'en' ? 'en' : 'tr';
  if (type === 'hijri') return getHijriMonth(cursor, language);
  if (type === 'lunar') return getLunarMonth(cursor, language);
  return getGregorianMonth(cursor, language);
}

function getGregorianMonth(cursor, locale) {
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const firstDay = mondayIndex(new Date(cursor.year, cursor.month, 1).getDay());
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const dateKey = solarDateKey(cursor.year, cursor.month + 1, day);
    return {
      day,
      dateKey,
      isToday: isTodayKey(dateKey),
      journalTitle: locale === 'en' ? `${GREGORIAN_MONTHS.en[cursor.month]} ${day}, ${cursor.year} Journal` : `${day} ${GREGORIAN_MONTHS.tr[cursor.month]} ${cursor.year} Günlüğü`
    };
  });

  return {
    title: `${GREGORIAN_MONTHS[locale][cursor.month]} ${cursor.year}`,
    firstDay,
    days
  };
}

function getHijriMonth(cursor, locale) {
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
      journalTitle: locale === 'en' ? `${day} ${HIJRI_MONTHS.en[cursor.month]} ${cursor.year} Journal` : `${day} ${HIJRI_MONTHS.tr[cursor.month]} ${cursor.year} Günlüğü`
    };
  });

  return {
    title: `${HIJRI_MONTHS[locale][cursor.month]} ${cursor.year}`,
    firstDay,
    days
  };
}

function getLunarMonth(cursor, locale) {
  const lunarMonth = LunarMonth.fromYm(cursor.year, cursor.month);
  if (!lunarMonth) {
    return { title: locale === 'en' ? 'Month unavailable' : 'Ay bilgisi bulunamadı', firstDay: 0, days: [] };
  }
  const daysInMonth = lunarMonth.getDayCount();
  const firstSolar = Lunar.fromYmd(cursor.year, cursor.month, 1).getSolar();
  const firstDay = mondayIndex(firstSolar.getWeek());
  const monthNumber = Math.abs(cursor.month);
  const monthLabel = locale === 'en'
    ? (cursor.month < 0 ? `Leap Month ${monthNumber}` : `Month ${monthNumber}`)
    : (cursor.month < 0 ? `Artık ${monthNumber}. Ay` : `${monthNumber}. Ay`);
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const solar = Lunar.fromYmd(cursor.year, cursor.month, day).getSolar();
    const dateKey = solarDateKey(solar.getYear(), solar.getMonth(), solar.getDay());
    return {
      day,
      dateKey,
      isToday: isTodayKey(dateKey),
      journalTitle: locale === 'en' ? `${monthLabel} ${day}, ${cursor.year} Journal` : `${day} ${monthLabel} ${cursor.year} Günlüğü`
    };
  });

  return {
    title: `${monthLabel} ${cursor.year}`,
    firstDay,
    days
  };
}

