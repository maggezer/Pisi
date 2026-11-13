import test from 'node:test';
import assert from 'node:assert/strict';
import { getPisiPostponePreset, parsePisiTurkishDateExpression } from '../shared/date-parser.mjs';

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
