// The Calendar tab (docs/mobile-plan.md M8): one month, Monday first, with a
// dot on the days that have tasks and a ring on the days that have a diary
// file; the legend under the grid says what they mean. A tap on a day opens
// the Pisi tab on that day: the day itself is shown in one place only.
//
// Like the other tabs it is built once and updated in place, so the month
// the user moved to is still there when they come back. Tasks come from the
// shared task controller; the diary days are listed again every time the tab
// comes on screen, since the Pisi tab may have written a new day meanwhile.
// There is no Gregorian/Hijri/Chinese switch any more (G12).

import { renderButton, renderIconButton } from '../../ui/button.mjs';
import { formatMonthTitle, shiftMonth } from '../../ui/dates.mjs';
import { h } from '../../ui/dom.mjs';
import { PISI_DIARY_FOLDER } from '../../../../shared/diary-rules.mjs';
import { parentKey } from '../../data/drivers/keys.mjs';
import { renderDayLegend, renderMonthGrid } from '../../ui/month-grid.mjs';
import { getCalendarMarks, monthOf } from './calendar-model.mjs';

// A sideways swipe on the month changes it when it is long and clearly horizontal (the same rule as the Pisi tab).
const SWIPE_MIN_PX = 72;
const SWIPE_RATIO = 2.5;

/**
 * `project` is the data layer (null in a bare shell); `tasks` the shared task
 * controller. `onOpenDay(isoDate)` asks the app to show that day on the Pisi tab.
 */
export function createCalendarScreen({ project = null, tasks, platform, onOpenDay, onError = () => {} }) {
    const element = h('section', { class: 'pisi-screen pisi-calendar', dataset: { screen: 'calendar' } });
    const state = { month: null, diaryDates: [], marks: null };
    let context = null;
    let parts = null;
    let drawn = null;
    let swipe = null;
    let listToken = 0;
    let destroyed = false;

    const marks = () => (state.marks ??= getCalendarMarks(tasks.getTasks(), state.diaryDates));
    const labels = () => ({
        today: context.t('pisi.today'),
        hasTasks: context.t('date.hasTasks'),
        allTasksDone: context.t('date.allTasksDone'),
        hasDiary: context.t('date.hasDiary')
    });

    function showMonth(month) {
        if (month === state.month) return;
        state.month = month;
        draw();
    }

    function build() {
        const { t } = context;
        const title = h('h2', { class: 'pisi-calendar-month-title', 'aria-live': 'polite' });
        const grid = h('div', { class: 'pisi-calendar-grid', dataset: { calendar: 'grid' } });
        const thisMonth = renderButton({
            label: t('calendar.thisMonth'),
            variant: 'text',
            icon: 'calendar',
            dataset: { action: 'this-month' },
            onClick: () => showMonth(monthOf(context.today))
        });
        grid.addEventListener('touchstart', onTouchStart, { passive: true });
        grid.addEventListener('touchend', onTouchEnd, { passive: true });
        grid.addEventListener('touchcancel', () => (swipe = null), { passive: true });
        parts = { title, grid, thisMonth };
        drawn = null;
        element.replaceChildren(
            h(
                'div',
                { class: 'pisi-calendar-month' },
                renderIconButton({
                    icon: 'chevron-left',
                    label: t('date.previousMonth'),
                    dataset: { action: 'previous-month' },
                    onClick: () => showMonth(shiftMonth(state.month, -1))
                }),
                title,
                renderIconButton({
                    icon: 'chevron-right',
                    label: t('date.nextMonth'),
                    dataset: { action: 'next-month' },
                    onClick: () => showMonth(shiftMonth(state.month, 1))
                })
            ),
            grid,
            h(
                'div',
                { class: 'pisi-calendar-legend', dataset: { calendar: 'legend' } },
                renderDayLegend([
                    { kind: 'tasks', label: t('calendar.legendOpen') },
                    { kind: 'done', label: t('calendar.legendDone') },
                    { kind: 'diary', label: t('date.legendDiary') }
                ])
            ),
            h('p', { class: 'pisi-calendar-hint' }, t('calendar.hint')),
            h('div', { class: 'pisi-calendar-actions' }, thisMonth)
        );
    }

    // The grid is drawn again only when something it shows has changed.
    function draw() {
        if (!parts) return;
        const { locale, today, selectedDate } = context;
        const current = marks();
        const key = [state.month, locale, today, selectedDate];
        if (drawn && drawn.marks === current && drawn.key.every((value, index) => value === key[index])) return;
        drawn = { key, marks: current };
        parts.title.textContent = formatMonthTitle(state.month, locale);
        parts.thisMonth.hidden = state.month === monthOf(today);
        parts.grid.setAttribute('aria-busy', tasks.isLoaded() ? 'false' : 'true');
        parts.grid.replaceChildren(
            renderMonthGrid({ month: state.month, selected: selectedDate, today, locale, marks: current, labels: labels(), onSelect: (day) => onOpenDay(day) })
        );
    }

    async function listDiaryDates() {
        if (!project) return;
        const token = (listToken += 1);
        try {
            const dates = await project.diary.listDates();
            if (destroyed || token !== listToken) return;
            if (dates.length === state.diaryDates.length && dates.every((day, index) => day === state.diaryDates[index])) return;
            state.diaryDates = dates;
            state.marks = null;
            if (context && element.isConnected) draw();
        } catch (error) {
            onError(error);
        }
    }

    // ----- swipe -----

    function onTouchStart(event) {
        const touch = event.touches.length === 1 ? event.touches[0] : null;
        swipe = touch ? { x: touch.clientX, y: touch.clientY } : null;
    }

    function onTouchEnd(event) {
        const touch = event.changedTouches[0];
        if (!swipe || !touch) return;
        const dx = touch.clientX - swipe.x;
        const dy = touch.clientY - swipe.y;
        swipe = null;
        if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
        platform.haptic();
        showMonth(shiftMonth(state.month, dx < 0 ? 1 : -1));
    }

    const stop = tasks.subscribe(() => {
        state.marks = null;
        // Off screen nothing is drawn; the grid is brought up to date when the tab is opened again.
        if (context && element.isConnected) draw();
    });

    return {
        element,

        /** Draws the screen for `{ t, locale, today, selectedDate }`. The first time it shows today's month. */
        update(next) {
            const rebuilt = !context || context.t !== next.t;
            context = next;
            state.month ??= monthOf(next.today);
            if (rebuilt) build();
            draw();
        },

        /** The screen has come on screen: the diary days are listed again. */
        attach() {
            void listDiaryDates();
        },

        /** Reads the diary days again (after the sample project has been loaded). */
        reload: () => listDiaryDates(),

        /** A file changed outside the app: a diary day added or removed moves the rings. Tasks come through the controller. */
        handleExternal: (key) => (parentKey(key) === PISI_DIARY_FOLDER ? listDiaryDates() : Promise.resolve()),

        /** The month on screen, `YYYY-MM`. */
        getMonth: () => state.month,

        destroy() {
            destroyed = true;
            stop();
        }
    };
}
