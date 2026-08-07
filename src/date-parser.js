const MONTHS = Object.freeze({
  ocak: 0, subat: 1, mart: 2, nisan: 3, mayis: 4, haziran: 5,
  temmuz: 6, agustos: 7, eylul: 8, ekim: 9, kasim: 10, aralik: 11
});
const WEEKDAYS = Object.freeze({
  pazar: 0, pazartesi: 1, sali: 2, carsamba: 3, persembe: 4, cuma: 5, cumartesi: 6
});
const NUMBERS = Object.freeze({
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9,
  on: 10, onbir: 11, oniki: 12, onuc: 13, ondort: 14, onbes: 15, yirmi: 20, otuz: 30
});

export function normalizeTurkishExpression(value = '') {
  return String(value || '').toLocaleLowerCase('tr-TR')
    .replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c')
    .replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
}

export function localIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localIsoDateTime(date, withTime) {
  if (!withTime) return localIsoDate(date);
  return `${localIsoDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function nextWeekday(now, weekday) {
  const result = startOfDay(now);
  const offset = (weekday - result.getDay() + 7) % 7 || 7;
  result.setDate(result.getDate() + offset);
  return result;
}

function parseTime(expression) {
  const clock = expression.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (clock) return { hour: Number(clock[1]), minute: Number(clock[2]) };
  const named = expression.match(/\bsaat\s+([0-2]?\d)(?:\s*(sabah|aksam|gece))?\b/);
  if (named) {
    let hour = Math.min(23, Number(named[1]));
    if (['aksam', 'gece'].includes(named[2]) && hour < 12) hour += 12;
    return { hour, minute: 0 };
  }
  if (/\bbu aksam\b/.test(expression)) return { hour: 19, minute: 0 };
  return null;
}

function explicitDate(expression, now) {
  const numeric = expression.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    const result = new Date(year, Number(numeric[2]) - 1, Number(numeric[1]));
    if (!numeric[3] && result < startOfDay(now)) result.setFullYear(year + 1);
    if (result.getDate() === Number(numeric[1]) && result.getMonth() === Number(numeric[2]) - 1) return result;
  }
  const named = expression.match(new RegExp(`\\b(\\d{1,2})\\s+(${Object.keys(MONTHS).join('|')})(?:a|e)?(?:\\s+(\\d{4}))?\\b`));
  if (!named) return null;
  const result = new Date(Number(named[3]) || now.getFullYear(), MONTHS[named[2]], Number(named[1]));
  if (!named[3] && result < startOfDay(now)) result.setFullYear(result.getFullYear() + 1);
  return result;
}

export function parseDuration(value = '') {
  const expression = normalizeTurkishExpression(value);
  const hour = expression.match(/\b(\d+(?:[.,]\d+)?)\s*(?:saat|sa|hour|hours|h)\b/);
  const minute = expression.match(/\b(\d+)\s*(?:dakika|dk|minute|minutes|min)\b/);
  return Math.round((hour ? Number(hour[1].replace(',', '.')) * 60 : 0) + (minute ? Number(minute[1]) : 0));
}

export function parseTurkishDate(value, nowValue = new Date()) {
  const expression = normalizeTurkishExpression(value);
  const now = new Date(nowValue);
  const result = {
    input: String(value || ''), normalized: expression, scheduledAt: null, deadline: null,
    reminderAt: null, repeat: 'none', durationMinutes: parseDuration(expression), matched: [], confidence: 0
  };
  if (!expression) return result;
  const time = parseTime(expression);
  let target = null;
  if (/\bbugun\b/.test(expression)) {
    target = startOfDay(now);
    result.matched.push('today');
  } else if (/\byarin\b/.test(expression)) {
    target = startOfDay(now);
    target.setDate(target.getDate() + 1);
    result.matched.push('tomorrow');
  } else if (/\bgelecek hafta\b/.test(expression)) {
    target = nextWeekday(now, 1);
    result.matched.push('next-week');
  } else if (/\bhafta sonu\b/.test(expression)) {
    target = nextWeekday(now, 6);
    result.matched.push('weekend');
  } else {
    target = explicitDate(expression, now);
    if (target) result.matched.push('explicit-date');
  }
  if (!target) {
    const weekday = Object.keys(WEEKDAYS).find((name) => new RegExp(`\\b${name}\\b`).test(expression));
    if (weekday) {
      target = nextWeekday(now, WEEKDAYS[weekday]);
      result.matched.push('weekday');
    }
  }
  if (target) {
    if (time) target.setHours(time.hour, time.minute, 0, 0);
    const serialized = localIsoDateTime(target, Boolean(time));
    if (/\bkadar\b|\bson tarih\b|\bdeadline\b/.test(expression)) result.deadline = serialized;
    else result.scheduledAt = serialized;
    if (/\bhatirlat\b/.test(expression)) result.reminderAt = localIsoDateTime(target, true);
  }
  if (/\bher gun\b/.test(expression)) result.repeat = 'daily';
  else if (/\bher\s+pazartesi\b/.test(expression)) {
    result.repeat = 'weekly';
    result.scheduledAt ||= localIsoDateTime(nextWeekday(now, 1), Boolean(time));
  } else if (/\biki haftada bir\b/.test(expression)) result.repeat = 'biweekly';
  else {
    const after = expression.match(/\btamamlandiktan\s+([a-z0-9]+)\s+gun sonra\b/);
    if (after) {
      result.repeat = 'after-completion';
      result.completionOffsetDays = Number(after[1]) || NUMBERS[after[1]] || 1;
    }
  }
  result.confidence = Math.min(1, (result.matched.length + (result.repeat !== 'none' ? 1 : 0)) / 2);
  return result;
}

export function postponeDate(preset, nowValue = new Date()) {
  const now = startOfDay(nowValue);
  const normalized = normalizeTurkishExpression(preset);
  if (['remove', 'tarihi kaldir'].includes(normalized)) return null;
  if (['tomorrow', 'yarin'].includes(normalized)) now.setDate(now.getDate() + 1);
  else if (['tonight', 'bu aksam'].includes(normalized)) { now.setHours(19); return localIsoDateTime(now, true); }
  else if (['weekend', 'hafta sonu'].includes(normalized)) return localIsoDate(nextWeekday(now, 6));
  else if (['next-monday', 'gelecek pazartesi'].includes(normalized)) return localIsoDate(nextWeekday(now, 1));
  else if (['next-week', 'gelecek hafta'].includes(normalized)) now.setDate(now.getDate() + 7);
  else return null;
  return localIsoDate(now);
}
