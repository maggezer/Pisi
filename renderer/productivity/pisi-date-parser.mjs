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

function getPisiNextWeekday(now, weekday, forceNextWeek = false) {
    const date = makePisiLocalDate(now);
    let offset = (weekday - date.getDay() + 7) % 7;
    if (offset === 0) offset += 7;
    if (forceNextWeek && offset < 1) offset += 7;
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

function parsePisiExplicitDate(expression, now) {
    const numeric = expression.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
    if (numeric) {
        let year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
        if (year < 100) year += 2000;
        const result = new Date(year, Number(numeric[2]) - 1, Number(numeric[1]));
        if (!numeric[3] && result < makePisiLocalDate(now)) result.setFullYear(year + 1);
        if (
            result.getDate() === Number(numeric[1]) &&
            result.getMonth() === Number(numeric[2]) - 1
        ) return result;
    }

    const names = Object.keys(PISI_TURKISH_MONTHS).join('|');
    const named = expression.match(new RegExp(`\\b(\\d{1,2})\\s+(${names})(?:a|e)?(?:\\s+(\\d{4}))?\\b`));
    if (!named) return null;
    const year = Number(named[3]) || now.getFullYear();
    const result = new Date(year, PISI_TURKISH_MONTHS[named[2]], Number(named[1]));
    if (!named[3] && result < makePisiLocalDate(now)) result.setFullYear(year + 1);
    return result;
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

    const time = parsePisiTime(expression);
    let target = null;

    if (/\bayin son is gunu\b/.test(expression)) {
        target = getPisiLastBusinessDay(now);
        result.matched.push('last-business-day');
    } else if (/\byarin\b/.test(expression)) {
        target = makePisiLocalDate(now);
        target.setDate(target.getDate() + 1);
        result.matched.push('tomorrow');
    } else if (/\bgelecek hafta\b/.test(expression)) {
        target = getPisiNextWeekday(now, 1, true);
        result.matched.push('next-week');
    } else {
        target = parsePisiExplicitDate(expression, now);
        if (target) result.matched.push('explicit-date');
    }

    const weekdayName = Object.keys(PISI_TURKISH_WEEKDAYS).find((name) => {
        return new RegExp(`\\b${name}\\b`).test(expression);
    });
    if (weekdayName && !target) {
        target = getPisiNextWeekday(
            now,
            PISI_TURKISH_WEEKDAYS[weekdayName],
            /\bgelecek\b/.test(expression)
        );
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

    if (/\bher\s+pazartesi\b/.test(expression)) {
        result.repeat = 'weekly';
        if (!result.scheduledAt) {
            const monday = getPisiNextWeekday(now, 1);
            if (time) monday.setHours(time.hour, time.minute, 0, 0);
            result.scheduledAt = pisiLocalIsoDateTime(monday, Boolean(time));
        }
        result.matched.push('weekly');
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

    const completion = expression.match(
        /\bgorev tamamlandiktan\s+([a-z0-9]+)\s+gun sonra\b/
    );
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
