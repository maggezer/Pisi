import { describe, expect, it } from 'vitest';
import {
  createCalendarCursor,
  getCalendarMonth,
  shiftCalendarCursor,
  solarDateKey
} from './calendar-utils.js';

describe('calendar helpers', () => {
  it('renders a Gregorian month on a Monday-first grid', () => {
    const month = getCalendarMonth('gregorian', { year: 2026, month: 6 });
    expect(month.title).toBe('Temmuz 2026');
    expect(month.days).toHaveLength(31);
    expect(month.firstDay).toBe(2);
    expect(month.days[0].dateKey).toBe('2026-07-01');
  });

  it('moves across Gregorian year boundaries', () => {
    expect(shiftCalendarCursor('gregorian', { year: 2026, month: 11 }, 1))
      .toEqual({ year: 2027, month: 0 });
  });

  it('creates alternate calendar cursors and canonical solar keys', () => {
    const date = new Date(2026, 6, 28);
    expect(createCalendarCursor('hijri', date)).toHaveProperty('year');
    expect(createCalendarCursor('lunar', date)).toHaveProperty('month');
    expect(solarDateKey(2026, 7, 8)).toBe('2026-07-08');
  });
});

