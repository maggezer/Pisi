import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PISI_TURKISH_MONTHS,
    PISI_TURKISH_WEEKDAYS,
    getPisiPostponePreset,
    normalizePisiTurkishExpression,
    parsePisiTurkishDateExpression,
    parsePisiTurkishNumber,
    pisiLocalIsoDate
} from '../shared/date-parser.mjs';

const NOW = new Date(2026, 7, 6, 10, 30, 0, 0);

test('Türkçe göreli gün ve saat ifadelerini ayrı plan alanına ayrıştırır', () => {
    const tomorrow = parsePisiTurkishDateExpression('yarın 14:00', NOW);
    assert.equal(tomorrow.scheduledAt, '2026-08-07T14:00');
    assert.equal(tomorrow.deadline, null);

    const friday = parsePisiTurkishDateExpression('cuma saat 3', NOW);
    assert.equal(friday.scheduledAt, '2026-08-07T03:00');
});

test('Türkçe tekrar ifadelerini tanır', () => {
    const weekly = parsePisiTurkishDateExpression('her pazartesi saat 9', NOW);
    assert.equal(weekly.repeat, 'weekly');
    assert.equal(weekly.scheduledAt, '2026-08-10T09:00');

    const biweekly = parsePisiTurkishDateExpression('iki haftada bir', NOW);
    assert.equal(biweekly.repeat, 'biweekly');
    assert.equal(biweekly.scheduledAt, '2026-08-20');

    const afterCompletion = parsePisiTurkishDateExpression('görev tamamlandıktan üç gün sonra', NOW);
    assert.equal(afterCompletion.repeat, 'after-completion');
    assert.equal(afterCompletion.completionOffsetDays, 3);
});

test('deadline ve son iş günü planını tek tarih alanına sıkıştırmaz', () => {
    const deadline = parsePisiTurkishDateExpression('15 Ağustos’a kadar', NOW);
    assert.equal(deadline.deadline, '2026-08-15');
    assert.equal(deadline.scheduledAt, null);

    const businessDay = parsePisiTurkishDateExpression('ayın son iş günü', NOW);
    assert.equal(businessDay.scheduledAt, '2026-08-31');
});

test('hızlı erteleme ön ayarlarını yerel ISO değere dönüştürür', () => {
    assert.equal(getPisiPostponePreset('tomorrow', NOW), '2026-08-07');
    assert.equal(getPisiPostponePreset('tonight', NOW), '2026-08-06T19:00');
    assert.equal(getPisiPostponePreset('weekend', NOW), '2026-08-08');
    assert.equal(getPisiPostponePreset('next-monday', NOW), '2026-08-10');
    assert.equal(getPisiPostponePreset('next-week', NOW), '2026-08-13');
    assert.equal(getPisiPostponePreset('remove', NOW), null);
});

test('ifade normalizasyonu Türkçe harfleri, kesme işaretini ve boşlukları sadeleştirir', () => {
    assert.equal(normalizePisiTurkishExpression('  ÇARŞAMBA   Öğleden  SONRA’ya '), 'carsamba ogleden sonraya');
    assert.equal(normalizePisiTurkishExpression("Ali'nin IŞIĞI"), 'alinin isigi');
    assert.equal(normalizePisiTurkishExpression(null), '');
});

test('sayılar rakamla ya da yazıyla okunur', () => {
    assert.equal(parsePisiTurkishNumber('üç'), 3);
    assert.equal(parsePisiTurkishNumber('on beş'), 15);
    assert.equal(parsePisiTurkishNumber('OTUZ'), 30);
    assert.equal(parsePisiTurkishNumber('12'), 12);
    assert.equal(parsePisiTurkishNumber('kırk'), null);
});

test('açık tarihler: yıl verilmezse geçmiş gün gelecek yıla kayar, olmayan gün reddedilir', () => {
    assert.equal(parsePisiTurkishDateExpression('12 kasım', NOW).scheduledAt, '2026-11-12');
    assert.equal(parsePisiTurkishDateExpression('3 ocak', NOW).scheduledAt, '2027-01-03');
    assert.equal(parsePisiTurkishDateExpression('5/9/27', NOW).scheduledAt, '2027-09-05');
    assert.equal(parsePisiTurkishDateExpression('20 Ekim 2027 son tarih', NOW).deadline, '2027-10-20');

    const invalid = parsePisiTurkishDateExpression('31/02', NOW);
    assert.equal(invalid.scheduledAt, null);
    assert.deepEqual(invalid.matched, []);
});

test('gün adı bir sonraki o günü verir; bugünün adı bir hafta sonrasıdır', () => {
    // NOW is a Thursday.
    assert.equal(parsePisiTurkishDateExpression('cumartesi', NOW).scheduledAt, '2026-08-08');
    assert.equal(parsePisiTurkishDateExpression('perşembe', NOW).scheduledAt, '2026-08-13');
    assert.equal(parsePisiTurkishDateExpression('gelecek hafta', NOW).scheduledAt, '2026-08-10');
});

test('hatırlatma, günlük tekrar ve tarih içermeyen metin', () => {
    const reminder = parsePisiTurkishDateExpression('yarın 9:00 hatırlat', NOW);
    assert.equal(reminder.scheduledAt, '2026-08-07T09:00');
    assert.equal(reminder.reminderAt, '2026-08-07T09:00');
    assert.equal(reminder.confidence, 1);

    const daily = parsePisiTurkishDateExpression('her gün', NOW);
    assert.equal(daily.repeat, 'daily');
    assert.equal(daily.scheduledAt, null);

    const plain = parsePisiTurkishDateExpression('toplantı notu', NOW);
    assert.deepEqual([plain.scheduledAt, plain.deadline, plain.repeat, plain.confidence], [null, null, 'none', 0]);
    assert.equal(parsePisiTurkishDateExpression('', NOW).confidence, 1);
});

test('yerel ISO tarih ve sabit tablolar', () => {
    assert.equal(pisiLocalIsoDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(Object.keys(PISI_TURKISH_MONTHS).length, 12);
    assert.equal(PISI_TURKISH_MONTHS.kasim, 10);
    assert.deepEqual(PISI_TURKISH_WEEKDAYS, { pazar: 0, pazartesi: 1, sali: 2, carsamba: 3, persembe: 4, cuma: 5, cumartesi: 6 });
    assert.equal(Object.isFrozen(PISI_TURKISH_MONTHS), true);
});
