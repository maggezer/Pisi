// Turkish natural-date parsing for Quick Add. Shared by the desktop renderer
// (renderer/productivity/pisi-date-parser.mjs re-exports it) and the mobile app.
// shared/ modules use only the language built-ins: see scripts/shared-purity.js.

const PISI_TURKISH_MONTHS = Object.freeze({
    ocak: 0,
    subat: 1,
    mart: 2,
    nisan: 3,
    mayis: 4,
    haziran: 5,
    temmuz: 6,
    agustos: 7,
    eylul: 8,
    ekim: 9,
    kasim: 10,
    aralik: 11
});

const PISI_TURKISH_WEEKDAYS = Object.freeze({
    pazar: 0,
    pazartesi: 1,
    sali: 2,
    carsamba: 3,
    persembe: 4,
    cuma: 5,
    cumartesi: 6
});

const PISI_TURKISH_NUMBERS = Object.freeze({
    bir: 1,
    iki: 2,
    uc: 3,
    dort: 4,
    bes: 5,
    alti: 6,
    yedi: 7,
    sekiz: 8,
    dokuz: 9,
    on: 10,
    onbir: 11,
    oniki: 12,
    onuc: 13,
    ondort: 14,
    onbes: 15,
    yirmi: 20,
    otuz: 30
});

function normalizePisiTurkishExpression(value = '') {
    return String(value || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/[ıİ]/g, 'i')
        .replace(/[şŞ]/g, 's')
        .replace(/[ğĞ]/g, 'g')
        .replace(/[üÜ]/g, 'u')
        .replace(/[öÖ]/g, 'o')
        .replace(/[çÇ]/g, 'c')
        .replace(/[’']/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function makePisiLocalDate(date, hour = 0, minute = 0) {
    const result = new Date(date);
    result.setHours(hour, minute, 0, 0);
    return result;
}

function pisiLocalIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function pisiLocalIsoDateTime(date, includeTime = true) {
    if (!includeTime) return pisiLocalIsoDate(date);
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${pisiLocalIsoDate(date)}T${hour}:${minute}`;
}

function parsePisiTurkishNumber(value) {
    const normalized = normalizePisiTurkishExpression(value).replace(/\s+/g, '');
    if (/^\d+$/.test(normalized)) return Number(normalized);
    return PISI_TURKISH_NUMBERS[normalized] || null;
}

/**
 * The next `weekday` after `now` (today's own name means a week later). With
 * `nextWeek` it is that day of the week after this one, weeks starting on
 * Monday: on a Thursday, "gelecek cuma" is not tomorrow but the Friday after.
 */
function getPisiNextWeekday(now, weekday, nextWeek = false) {
    const date = makePisiLocalDate(now);
    let offset = (weekday - date.getDay() + 7) % 7;
    if (offset === 0) offset += 7;
    if (nextWeek) offset = ((8 - date.getDay()) % 7 || 7) + ((weekday + 6) % 7);
    date.setDate(date.getDate() + offset);
    return date;
}

function getPisiLastBusinessDay(now) {
    const date = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    while (date.getDay() === 0 || date.getDay() === 6) {
        date.setDate(date.getDate() - 1);
    }
    if (date < makePisiLocalDate(now)) {
        date.setMonth(date.getMonth() + 2, 0);
        while (date.getDay() === 0 || date.getDay() === 6) {
            date.setDate(date.getDate() - 1);
        }
    }
    return date;
}

function parsePisiTime(expression) {
    const colon = expression.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
    if (colon) return { hour: Number(colon[1]), minute: Number(colon[2]), matched: colon[0] };

    const hourMatch = expression.match(/\bsaat\s+([0-2]?\d)(?:\s*(?:bu\s*)?(sabah|aksam|gece))?\b/);
    if (hourMatch) {
        let hour = Math.min(23, Number(hourMatch[1]));
        if (['aksam', 'gece'].includes(hourMatch[2]) && hour < 12) hour += 12;
        return { hour, minute: 0, matched: hourMatch[0] };
    }

    if (/\bbu aksam\b/.test(expression)) {
        return { hour: 19, minute: 0, matched: 'bu aksam' };
    }
    return null;
}

/**
 * A numeric date: day, month and year (`5/9/27`, `12.11.2026`, `3-4-2027`), or
 * without a year day and a two-digit month after a dot or a slash (`12.11`,
 * `5.03`). Numbers in a title are not dates (pisi-error.md §5e): `3-4 sayfa`,
 * `1.5 kg` and `2/3` are left alone. A pair after "saat" is a time of day.
 */
const PISI_NUMERIC_DATE_WITH_YEAR = /(?<![\d.,/-])(?<!\bsaat )\b(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})(?![\d.,/-]*\d)/;
const PISI_NUMERIC_DATE_WITHOUT_YEAR = /(?<![\d.,/-])(?<!\bsaat )\b(\d{1,2})[./](\d{2})(?![\d.,/-]*\d)/;

function readPisiNumericDate(expression, now) {
    const full = expression.match(PISI_NUMERIC_DATE_WITH_YEAR);
    const short = full ? null : expression.match(PISI_NUMERIC_DATE_WITHOUT_YEAR);
    const match = full || short;
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(full ? match[3] : match[2]);
    let year = full ? Number(match[4]) : now.getFullYear();
    if (year < 100) year += 2000;
    const result = new Date(year, month - 1, day);
    if (result.getDate() !== day || result.getMonth() !== month - 1) return null;
    if (!full && result < makePisiLocalDate(now)) result.setFullYear(year + 1);
    return { date: result, matched: match[0] };
}

/**
 * A date written out in the expression: `{ date, matched }`, or null.
 * `matched` is the text the date was read from.
 */
function parsePisiExplicitDate(expression, now) {
    const numeric = readPisiNumericDate(expression, now);
    if (numeric) return numeric;

    const names = Object.keys(PISI_TURKISH_MONTHS).join('|');
    const named = expression.match(new RegExp(`\\b(\\d{1,2})\\s+(${names})(?:a|e)?(?:\\s+(\\d{4}))?\\b`));
    if (!named) return null;
    const year = Number(named[3]) || now.getFullYear();
    const result = new Date(year, PISI_TURKISH_MONTHS[named[2]], Number(named[1]));
    if (!named[3] && result < makePisiLocalDate(now)) result.setFullYear(year + 1);
    return { date: result, matched: named[0] };
}

function getPisiPostponePreset(value, now = new Date()) {
    const preset = normalizePisiTurkishExpression(value);
    const date = makePisiLocalDate(now);
    let includeTime = false;

    if (['tomorrow', 'yarin'].includes(preset)) date.setDate(date.getDate() + 1);
    else if (['tonight', 'bu aksam'].includes(preset)) {
        date.setHours(19, 0, 0, 0);
        includeTime = true;
    } else if (['weekend', 'hafta sonu'].includes(preset)) {
        const offset = (6 - date.getDay() + 7) % 7 || 7;
        date.setDate(date.getDate() + offset);
    } else if (['next-monday', 'gelecek pazartesi'].includes(preset)) {
        return pisiLocalIsoDate(getPisiNextWeekday(date, 1, true));
    } else if (['next-week', 'bir hafta ertele', 'gelecek hafta'].includes(preset)) {
        date.setDate(date.getDate() + 7);
    } else if (['remove', 'tarihi kaldir'].includes(preset)) {
        return null;
    } else {
        return null;
    }

    return pisiLocalIsoDateTime(date, includeTime);
}

function parsePisiTurkishDateExpression(value, nowValue = new Date()) {
    const expression = normalizePisiTurkishExpression(value);
    const now = new Date(nowValue);
    const result = {
        input: String(value || ''),
        normalized: expression,
        scheduledAt: null,
        deadline: null,
        reminderAt: null,
        repeat: 'none',
        completionOffsetDays: null,
        matched: [],
        confidence: expression ? 0 : 1
    };
    if (!expression) return result;

    let target = null;
    // The text of a written-out date, so that "12.11" is not read a second time as 12:11.
    let dateText = null;

    if (/\bayin son is gunu\b/.test(expression)) {
        target = getPisiLastBusinessDay(now);
        result.matched.push('last-business-day');
    } else if (/\byarin\b/.test(expression)) {
        target = makePisiLocalDate(now);
        target.setDate(target.getDate() + 1);
        result.matched.push('tomorrow');
    } else if (/\bbugun\b|\bbu aksam\b/.test(expression)) {
        target = makePisiLocalDate(now);
        result.matched.push('today');
    } else if (/\bgelecek hafta\b/.test(expression)) {
        target = getPisiNextWeekday(now, 1, true);
        result.matched.push('next-week');
    } else {
        const explicit = parsePisiExplicitDate(expression, now);
        if (explicit) {
            target = explicit.date;
            dateText = explicit.matched;
            result.matched.push('explicit-date');
        }
    }
    const time = parsePisiTime(dateText ? expression.replace(dateText, ' ') : expression);

    const weekdayName = Object.keys(PISI_TURKISH_WEEKDAYS).find((name) => {
        return new RegExp(`\\b${name}\\b`).test(expression);
    });
    if (weekdayName && !target) {
        target = getPisiNextWeekday(now, PISI_TURKISH_WEEKDAYS[weekdayName], /\bgelecek\b/.test(expression));
        result.matched.push('weekday');
    }

    if (target) {
        if (time) target.setHours(time.hour, time.minute, 0, 0);
        const serialized = pisiLocalIsoDateTime(target, Boolean(time));
        if (/\bkadar\b|\bson tarih\b|\bdeadline\b/.test(expression)) {
            result.deadline = serialized;
        } else {
            result.scheduledAt = serialized;
        }
    }

    const everyWeekday = Object.keys(PISI_TURKISH_WEEKDAYS).find((name) => new RegExp(`\\bher\\s+${name}\\b`).test(expression));
    if (/\b(?:her\s+)?hafta\s*ici\b/.test(expression)) {
        result.repeat = 'weekdays';
        result.matched.push('weekdays');
    } else if (everyWeekday) {
        result.repeat = 'weekly';
        if (!result.scheduledAt) {
            const day = getPisiNextWeekday(now, PISI_TURKISH_WEEKDAYS[everyWeekday]);
            if (time) day.setHours(time.hour, time.minute, 0, 0);
            result.scheduledAt = pisiLocalIsoDateTime(day, Boolean(time));
        }
        result.matched.push('weekly');
    } else if (/\bher\s+hafta\b/.test(expression)) {
        result.repeat = 'weekly';
        result.matched.push('weekly');
    } else if (/\bher\s+ay\b/.test(expression)) {
        result.repeat = 'monthly';
        result.matched.push('monthly');
    } else if (/\biki haftada bir\b/.test(expression)) {
        result.repeat = 'biweekly';
        if (!result.scheduledAt) {
            const date = makePisiLocalDate(now);
            date.setDate(date.getDate() + 14);
            result.scheduledAt = pisiLocalIsoDate(date);
        }
        result.matched.push('biweekly');
    } else if (/\bher gun\b/.test(expression)) {
        result.repeat = 'daily';
        result.matched.push('daily');
    }

    const completion = expression.match(/\bgorev tamamlandiktan\s+([a-z0-9]+)\s+gun sonra\b/);
    if (completion) {
        result.completionOffsetDays = parsePisiTurkishNumber(completion[1]) || 1;
        result.repeat = 'after-completion';
        result.matched.push('after-completion');
    }

    if (/\bhatirlat\b/.test(expression) && target) {
        result.reminderAt = pisiLocalIsoDateTime(target, true);
        result.matched.push('reminder');
    }

    result.confidence = Math.min(1, result.matched.length / 2);
    return result;
}

export {
    PISI_TURKISH_MONTHS,
    PISI_TURKISH_WEEKDAYS,
    getPisiPostponePreset,
    normalizePisiTurkishExpression,
    parsePisiTurkishDateExpression,
    parsePisiTurkishNumber,
    pisiLocalIsoDate
};
