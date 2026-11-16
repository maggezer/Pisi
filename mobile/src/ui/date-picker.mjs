// Date picker: a bottom sheet with one month, Monday first. Like the other
// overlays it only renders; the owner keeps the month that is shown and
// closes the sheet. Days with a task or a diary entry carry a dot; the grid
// itself is ui/month-grid.mjs, shared with the Calendar tab.

import { renderButton, renderIconButton } from './button.mjs';
import { formatMonthTitle } from './dates.mjs';
import { h } from './dom.mjs';
import { renderDayLegend, renderMonthGrid } from './month-grid.mjs';
import { renderSheet } from './overlay.mjs';

/**
 * `month` is `YYYY-MM`. `labels`: `close`, `previousMonth`, `nextMonth`,
 * `today`, `goToday`, `hasTasks`, `hasDiary`, `legendTasks`, `legendDiary`.
 * `actions` are extra buttons shown next to "go to today" (e.g. "remove the date").
 */
export function renderDatePicker({ id, title, month, selected, today, locale, marks = null, labels, actions = null, onSelect, onMonth, onClose }) {
    const grid = renderMonthGrid({ month, selected, today, locale, marks, labels, autofocus: true, onSelect });
    const legend = marks
        ? renderDayLegend([
              { kind: 'tasks', label: labels.legendTasks },
              { kind: 'diary', label: labels.legendDiary }
          ])
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
                renderButton({ label: labels.goToday, variant: 'text', icon: 'calendar', dataset: { action: 'pick-today' }, onClick: () => onSelect(today) }),
                actions
            )
        ]
    });
}
