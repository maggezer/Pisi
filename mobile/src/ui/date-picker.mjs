// Date picker: a bottom sheet with one month, Monday first. Like the other
// overlays it only renders; the owner keeps the month that is shown and
// closes the sheet. Days with a task or a diary entry carry a dot.

import { renderButton, renderIconButton } from './button.mjs';
import { formatDayTitle, formatMonthTitle, getMonthWeeks, getWeekdayNames } from './dates.mjs';
import { h } from './dom.mjs';
import { renderSheet } from './overlay.mjs';

/** The two dots under a day number: tasks first, then the diary. */
export function renderDayDots(isoDate, marks) {
    const hasTasks = marks?.tasks?.has(isoDate);
    const hasDiary = marks?.diary?.has(isoDate);
    return h(
        'span',
        { class: 'pisi-day-dots', 'aria-hidden': 'true' },
        hasTasks ? h('span', { class: 'pisi-day-dot pisi-day-dot-tasks' }) : null,
        hasDiary ? h('span', { class: 'pisi-day-dot pisi-day-dot-diary' }) : null
    );
}

/** Accessible name of a day: the date, then what marks it. `labels` has `today`, `hasTasks` and `hasDiary`. */
export function describeDay(isoDate, { locale, today, marks, labels }) {
    return [
        formatDayTitle(isoDate, locale, today),
        isoDate === today ? labels.today : null,
        marks?.tasks?.has(isoDate) ? labels.hasTasks : null,
        marks?.diary?.has(isoDate) ? labels.hasDiary : null
    ]
        .filter(Boolean)
        .join(', ');
}

/**
 * `month` is `YYYY-MM`. `labels`: `close`, `previousMonth`, `nextMonth`,
 * `today`, `goToday`, `hasTasks`, `hasDiary`, `legendTasks`, `legendDiary`.
 */
export function renderDatePicker({ id, title, month, selected, today, locale, marks = null, labels, onSelect, onMonth, onClose }) {
    const weekdays = getWeekdayNames(locale);
    const grid = h(
        'div',
        { class: 'pisi-date-grid', role: 'group', 'aria-label': formatMonthTitle(month, locale) },
        weekdays.map((name) => h('span', { class: 'pisi-date-weekday', 'aria-hidden': 'true' }, name)),
        getMonthWeeks(month)
            .flat()
            .map((day) =>
                day
                    ? h(
                          'button',
                          {
                              type: 'button',
                              class: 'pisi-date-cell',
                              'aria-label': describeDay(day, { locale, today, marks, labels }),
                              'aria-pressed': day === selected ? 'true' : 'false',
                              'aria-current': day === today ? 'date' : null,
                              'data-autofocus': day === selected ? '' : null,
                              dataset: { date: day },
                              onClick: () => onSelect(day)
                          },
                          h('span', { class: 'pisi-date-number' }, Number(day.slice(8, 10))),
                          renderDayDots(day, marks)
                      )
                    : h('span', { class: 'pisi-date-cell pisi-date-cell-empty', 'aria-hidden': 'true' })
            )
    );
    const legend = marks
        ? h(
              'p',
              { class: 'pisi-date-legend' },
              h('span', { class: 'pisi-date-legend-item' }, h('span', { class: 'pisi-day-dot pisi-day-dot-tasks', 'aria-hidden': 'true' }), labels.legendTasks),
              h('span', { class: 'pisi-date-legend-item' }, h('span', { class: 'pisi-day-dot pisi-day-dot-diary', 'aria-hidden': 'true' }), labels.legendDiary)
          )
        : null;
    return renderSheet({
        id,
        title,
        closeLabel: labels.close,
        onClose,
        children: [
            h(
                'div',
                { class: 'pisi-date-month' },
                renderIconButton({ icon: 'chevron-left', label: labels.previousMonth, dataset: { action: 'previous-month' }, onClick: () => onMonth(-1) }),
                h('p', { class: 'pisi-date-month-title', 'aria-live': 'polite' }, formatMonthTitle(month, locale)),
                renderIconButton({ icon: 'chevron-right', label: labels.nextMonth, dataset: { action: 'next-month' }, onClick: () => onMonth(1) })
            ),
            grid,
            legend,
            h(
                'div',
                { class: 'pisi-date-actions' },
                renderButton({ label: labels.goToday, variant: 'text', icon: 'calendar', dataset: { action: 'pick-today' }, onClick: () => onSelect(today) })
            )
        ]
    });
}
