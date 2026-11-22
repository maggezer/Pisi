// A task in a list (Pisi tab now, Tasks tab in M6): a checkbox, then the
// title on up to two lines with a meta line under it. The checkbox and the
// text are two buttons side by side: one completes the task, the other opens it.

import { h } from './dom.mjs';
import { renderCheckbox } from './field.mjs';
import { icon } from './icons.mjs';

/**
 * `meta` is a list of `{ kind, text, level? }`:
 * - `time`: the planned time of day;
 * - `date`: the task's day, shown for overdue tasks;
 * - `priority`: `level` 1–5 picks the colour of the mark, `text` names it;
 * - `repeat`: the task repeats;
 * - `source`: the note the task lives in.
 * `locked`: the checkbox cannot be changed (a past completion of a repeating
 * task, docs/task-plan.md §3.2.3); `checkLabel` then says why.
 */
export function renderTaskRow({ id, title, done = false, late = false, locked = false, meta = [], checkLabel, onToggle, onOpen }) {
    const metaLine = meta.length
        ? h(
              'span',
              { class: 'pisi-task-meta' },
              meta.map((item) =>
                  h(
                      'span',
                      { class: `pisi-task-meta-item pisi-task-meta-${item.kind}`, dataset: item.kind === 'priority' ? { priority: String(item.level) } : null },
                      item.kind === 'time' ? icon('clock') : null,
                      item.kind === 'repeat' ? icon('repeat') : null,
                      item.kind === 'priority' ? h('span', { class: 'pisi-task-priority-mark', 'aria-hidden': 'true' }) : null,
                      item.text
                  )
              )
          )
        : null;
    return h(
        'div',
        { class: `pisi-task${done ? ' pisi-task-done' : ''}${late ? ' pisi-task-late' : ''}${locked ? ' pisi-task-locked' : ''}`, dataset: { task: id } },
        renderCheckbox({ checked: done, label: checkLabel, disabled: locked, dataset: { taskToggle: id }, onChange: () => onToggle(id) }),
        h(
            'button',
            { type: 'button', class: 'pisi-task-body', dataset: { taskOpen: id }, onClick: () => onOpen(id) },
            h('span', { class: 'pisi-task-title' }, title),
            metaLine
        )
    );
}
