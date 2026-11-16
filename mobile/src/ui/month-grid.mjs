// One month of days, Monday first, with the marks of each day: the grid of
// the date picker sheet and of the Calendar tab. A day with tasks gets a
// filled dot, a diary day a ring; a day whose tasks are all done (Calendar
// tab only) gets the task dot in the "done" tone. Names of days and months
// come from Intl in the app's language.

import { formatDayTitle, formatMonthTitle, getMonthWeeks, getWeekdayNames } from './dates.mjs';
import { h } from './dom.mjs';

/**
 * `marks` holds sets of ISO days: `tasks` (open tasks), `tasksDone` (tasks,
 * all of them done; optional) and `diary`.
 */
export function renderDayDots(isoDate, marks) {
    const hasOpen = marks?.tasks?.has(isoDate);
    const allDone = !hasOpen && marks?.tasksDone?.has(isoDate);
    const hasDiary = marks?.diary?.has(isoDate);
    return h(
        'span',
        { class: 'pisi-day-dots', 'aria-hidden': 'true' },
        hasOpen ? h('span', { class: 'pisi-day-dot pisi-day-dot-tasks' }) : null,
        allDone ? h('span', { class: 'pisi-day-dot pisi-day-dot-tasks pisi-day-dot-done' }) : null,
        hasDiary ? h('span', { class: 'pisi-day-dot pisi-day-dot-diary' }) : null
    );
}

/** Accessible name of a day: the date, then what marks it. `labels` has `today`, `hasTasks`, `hasDiary` and, with `tasksDone` marks, `allTasksDone`. */
export function describeDay(isoDate, { locale, today, marks, labels }) {
    const hasOpen = marks?.tasks?.has(isoDate);
    return [
        formatDayTitle(isoDate, locale, today),
        isoDate === today ? labels.today : null,
        hasOpen ? labels.hasTasks : null,
        !hasOpen && marks?.tasksDone?.has(isoDate) ? labels.allTasksDone : null,
        marks?.diary?.has(isoDate) ? labels.hasDiary : null
    ]
        .filter(Boolean)
        .join(', ');
}

/** The legend under a grid: `items` are `{ kind: 'tasks' | 'done' | 'diary', label }`. */
export function renderDayLegend(items) {
    const dotClass = { tasks: 'pisi-day-dot-tasks', done: 'pisi-day-dot-tasks pisi-day-dot-done', diary: 'pisi-day-dot-diary' };
    return h(
        'p',
        { class: 'pisi-date-legend' },
        items.map((item) =>
            h(
                'span',
                { class: 'pisi-date-legend-item', dataset: { legend: item.kind } },
                h('span', { class: `pisi-day-dot ${dotClass[item.kind]}`, 'aria-hidden': 'true' }),
                item.label
            )
        )
    );
}

/**
 * The grid of a `YYYY-MM` month: weekday names, then a button per day.
 * `selected` is marked pressed, `today` current; `autofocus` lets the open
 * sheet put the focus on the selected day.
 */
export function renderMonthGrid({ month, selected = null, today, locale, marks = null, labels, autofocus = false, onSelect }) {
    return h(
        'div',
        { class: 'pisi-date-grid', role: 'group', 'aria-label': formatMonthTitle(month, locale), dataset: { month } },
        getWeekdayNames(locale).map((name) => h('span', { class: 'pisi-date-weekday', 'aria-hidden': 'true' }, name)),
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
                              'data-autofocus': autofocus && day === selected ? '' : null,
                              dataset: { date: day },
                              onClick: () => onSelect(day)
                          },
                          h('span', { class: 'pisi-date-number' }, Number(day.slice(8, 10))),
                          renderDayDots(day, marks)
                      )
                    : h('span', { class: 'pisi-date-cell pisi-date-cell-empty', 'aria-hidden': 'true' })
            )
    );
}
