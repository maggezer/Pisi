// The date wheel: the diagonal strip of days in the bottom right corner, the
// mark of the Pisi tab. It is a horizontal scroller turned 60 degrees. A day
// is picked by tapping it or by scrolling: the day that comes to rest in the
// middle becomes the selected day.

import { renderDayDots, describeDay } from '../../ui/date-picker.mjs';
import { diffIsoDays, formatMonthShort } from '../../ui/dates.mjs';
import { h } from '../../ui/dom.mjs';
import { PISI_WHEEL_RADIUS, getWheelDays } from './day-model.mjs';

const SETTLE_MS = 90;
// The strip is rebuilt around the selected day before the user can reach its end.
const REANCHOR_AT = PISI_WHEEL_RADIUS - 15;
// For a mouse the strip is dragged by hand; cos and sin of its 60 degree angle map the pointer onto it.
const AXIS_X = 0.5;
const AXIS_Y = 0.8660254;

export function createDateWheel({ label, onSelect, onTick = () => {}, setTimer, clearTimer }) {
    const track = h('div', { class: 'pisi-wheel-track', dataset: { wheel: 'track' } });
    const month = h('span', { class: 'pisi-wheel-month', 'aria-hidden': 'true' });
    const element = h('aside', { class: 'pisi-wheel', 'aria-label': label }, h('span', { class: 'pisi-wheel-corner', 'aria-hidden': 'true' }), track, month);
    let shown = null;
    let anchor = null;
    let centred = null;
    let settleTimer = null;
    let drag = null;

    const itemOf = (isoDate) => track.querySelector(`[data-date="${isoDate}"]`);

    function centre(isoDate) {
        const item = itemOf(isoDate);
        if (!item) return;
        track.scrollLeft = Math.max(0, item.offsetLeft - (track.clientWidth - item.offsetWidth) / 2);
        centred = isoDate;
    }

    function nearestToCentre() {
        const middle = track.scrollLeft + track.clientWidth / 2;
        let nearest = null;
        let distance = Infinity;
        for (const item of track.children) {
            const delta = Math.abs(item.offsetLeft + item.offsetWidth / 2 - middle);
            if (delta < distance) {
                nearest = item;
                distance = delta;
            }
        }
        return nearest?.dataset.date ?? null;
    }

    function markCentred(isoDate) {
        if (!isoDate || isoDate === centred) return;
        track.querySelector('.pisi-wheel-day-centred')?.classList.remove('pisi-wheel-day-centred');
        itemOf(isoDate)?.classList.add('pisi-wheel-day-centred');
        centred = isoDate;
        if (shown) month.textContent = formatMonthShort(isoDate, shown.locale);
        onTick();
    }

    track.addEventListener(
        'scroll',
        () => {
            markCentred(nearestToCentre());
            if (settleTimer !== null) clearTimer(settleTimer);
            settleTimer = setTimer(() => {
                settleTimer = null;
                if (centred && centred !== shown?.selected) onSelect(centred);
            }, SETTLE_MS);
        },
        { passive: true }
    );

    track.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'mouse') return;
        drag = { x: event.clientX, y: event.clientY, scroll: track.scrollLeft, moved: false };
    });
    track.addEventListener('pointermove', (event) => {
        if (!drag) return;
        const along = (event.clientX - drag.x) * AXIS_X - (event.clientY - drag.y) * AXIS_Y;
        if (Math.abs(along) > 4) drag.moved = true;
        if (drag.moved) track.scrollLeft = drag.scroll - along;
    });
    const endDrag = () => (drag = null);
    track.addEventListener('pointerup', () => setTimer(endDrag, 0));
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('pointerleave', endDrag);

    function renderDays(state) {
        const { selected, today, locale, marks, labels } = state;
        track.replaceChildren(
            ...getWheelDays(anchor).map((day) =>
                h(
                    'button',
                    {
                        type: 'button',
                        class: `pisi-wheel-day${day === selected ? ' pisi-wheel-day-centred' : ''}`,
                        'aria-label': describeDay(day, { locale, today, marks, labels }),
                        'aria-pressed': day === selected ? 'true' : 'false',
                        'aria-current': day === today ? 'date' : null,
                        dataset: { date: day },
                        // A drag with the mouse ends in a click on the day under the pointer; that click is not a pick.
                        onClick: () => !drag?.moved && onSelect(day)
                    },
                    h('span', { class: 'pisi-wheel-face' }, h('span', { class: 'pisi-wheel-number' }, Number(day.slice(8, 10))), renderDayDots(day, marks))
                )
            )
        );
    }

    return {
        element,
        /** Draws the wheel for `selected`. Nothing is rebuilt when nothing it shows has changed. */
        show({ selected, today, locale, marks, labels }) {
            const key = JSON.stringify([selected, today, locale, [...marks.tasks].sort(), [...marks.diary].sort(), labels]);
            if (shown?.key === key) return;
            const hadFocus = track.contains(track.ownerDocument.activeElement);
            if (!anchor || Math.abs(diffIsoDays(anchor, selected)) > REANCHOR_AT) anchor = selected;
            shown = { key, selected, locale };
            renderDays({ selected, today, locale, marks, labels });
            month.textContent = formatMonthShort(selected, locale);
            centre(selected);
            if (hadFocus) itemOf(selected)?.focus();
        },
        /** Puts the selected day back in the middle, e.g. after the screen is attached again. */
        recentre() {
            if (shown) centre(shown.selected);
        },
        destroy() {
            if (settleTimer !== null) clearTimer(settleTimer);
        }
    };
}
