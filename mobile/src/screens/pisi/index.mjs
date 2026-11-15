// The Pisi tab, the start screen: the selected day's diary and tasks, the
// date wheel in the corner and the menu button (docs/mobile-plan.md M5).
//
// Unlike the other screens it is built once and then updated in place: the
// diary is typed into directly and the wheel is scrolled, and neither would
// survive being drawn again from scratch. Tasks come from the shared task
// controller, which reads `.pisi/tasks.json` directly, and the diary from the
// day's own file, so the screen fills before the project index has been built.

import { PisiReadOnlyError } from '../../data/json-file.mjs';
import { renderButton } from '../../ui/button.mjs';
import { renderDatePicker } from '../../ui/date-picker.mjs';
import { formatDayTitle, formatShortDay, shiftIsoDate, shiftMonth } from '../../ui/dates.mjs';
import { h } from '../../ui/dom.mjs';
import { icon } from '../../ui/icons.mjs';
import { createDateWheel } from './date-wheel.mjs';
import { getDayMarks, groupDayTasks, parseTaskDraft } from './day-model.mjs';
import { createDiaryAutosave } from './diary-autosave.mjs';
import { createDiarySection } from './diary-section.mjs';
import { createTaskAddRow } from '../../ui/task-add.mjs';
import { renderMenuSheet } from './sheets.mjs';
import { renderTaskGroups } from './task-section.mjs';

export const PISI_OVERLAY_DATE = 'pisi-date';
export const PISI_OVERLAY_MENU = 'pisi-menu';
// A sideways swipe on the content changes the day when it is long and clearly horizontal.
const SWIPE_MIN_PX = 72;
const SWIPE_RATIO = 2.5;

/**
 * `project` is the data layer (null in a bare shell); `tasks` the task
 * controller shared with the Tasks tab; `snackbar` the app's snackbar
 * controller. The app owns navigation: the screen asks for a day
 * (`onSelectDate`), a sheet (`onOpenOverlay` / `onCloseOverlay`), a task's
 * detail (`onOpenTask`), another screen (`onMenu`) or a redraw of the open
 * sheet (`onChange`).
 */
export function createPisiScreen({
    project = null,
    tasks,
    platform,
    snackbar,
    now,
    setTimer,
    clearTimer,
    onError = () => {},
    onSelectDate,
    onOpenOverlay,
    onCloseOverlay,
    onOpenTask,
    onMenu,
    onChange = () => {}
}) {
    const element = h('section', { class: 'pisi-home', dataset: { screen: 'pisi' } });
    const state = {
        opened: !project,
        diaryDates: [],
        completedOpen: false,
        pickerMonth: null,
        day: { date: null, text: '', loaded: false, readOnly: false, otherBlocks: 0 }
    };
    let context = null;
    let parts = null;
    let loadToken = 0;
    let destroyed = false;
    let swipe = null;
    // The tasks changed while the tab was off screen; they are drawn when it comes back.
    let tasksDirty = false;

    const autosave = createDiaryAutosave({
        save: (date, text) => (project ? project.diary.setText(date, text) : { ok: true, changed: false }),
        setTimer,
        clearTimer,
        onSaved(job, result) {
            if (result?.created && !state.diaryDates.includes(job.date)) {
                state.diaryDates = [...state.diaryDates, job.date];
                if (!destroyed) drawWheel();
            }
        },
        onError(error, job) {
            onError(error);
            if (destroyed) return;
            if (job.date === state.day.date && error instanceof PisiReadOnlyError) {
                state.day = { ...state.day, readOnly: true };
                parts.diary.show(state.day);
            }
            snackbar.show({ message: context.t('pisi.diarySaveFailed') });
        }
    });

    const marks = () => getDayMarks(tasks.getTasks(), state.diaryDates);
    const dayLabels = () => ({
        close: context.t('action.close'),
        previousMonth: context.t('date.previousMonth'),
        nextMonth: context.t('date.nextMonth'),
        today: context.t('pisi.today'),
        goToday: context.t('pisi.goToday'),
        hasTasks: context.t('date.hasTasks'),
        hasDiary: context.t('date.hasDiary'),
        legendTasks: context.t('date.legendTasks'),
        legendDiary: context.t('date.legendDiary')
    });

    function selectDate(isoDate, direction = null) {
        if (isoDate === context.selectedDate) return;
        parts.scroll.dataset.enter = direction ?? (isoDate > context.selectedDate ? 'next' : 'previous');
        onSelectDate(isoDate);
    }

    // ----- drawing -----

    function drawHeader() {
        const { t, locale, selectedDate, today } = context;
        const title = formatDayTitle(selectedDate, locale, today);
        parts.time.textContent = title;
        parts.time.setAttribute('datetime', selectedDate);
        parts.dateButton.setAttribute('aria-label', t('pisi.pickDateLabel', { date: title }));
        parts.todayBadge.hidden = selectedDate !== today;
        parts.goToday.hidden = selectedDate === today;
    }

    function drawTasks() {
        const { t, locale, selectedDate, today } = context;
        parts.groups.replaceChildren(
            renderTaskGroups({
                t,
                locale,
                groups: groupDayTasks(tasks.getTasks(), { selectedDate, today }),
                selectedDate,
                today,
                loaded: tasks.isLoaded(),
                readOnly: tasks.isReadOnly(),
                completedOpen: state.completedOpen,
                onToggle: (id) => void tasks.toggle(id),
                onOpen: onOpenTask,
                onToggleCompleted() {
                    state.completedOpen = !state.completedOpen;
                    drawTasks();
                    parts.groups.querySelector('[data-action="toggle-completed"]')?.focus();
                }
            })
        );
        parts.addRow.setReadOnly(tasks.isReadOnly() || !tasks.isLoaded());
    }

    function drawWheel() {
        const { locale, selectedDate, today } = context;
        parts.wheel.show({ selected: selectedDate, today, locale, marks: marks(), labels: dayLabels() });
    }

    function describeDraft(text) {
        const { t, locale, selectedDate, today } = context;
        const draft = parseTaskDraft(text, { selectedDate, now: now() });
        if (!draft) return [];
        const day = draft.day === today ? t('pisi.today') : formatShortDay(draft.day, locale, today);
        return [
            { kind: 'date', icon: 'calendar', text: draft.deadline ? t('pisi.chipDeadline', { date: day }) : day },
            draft.time ? { kind: 'time', icon: 'clock', text: draft.time } : null,
            draft.repeat !== 'none' ? { kind: 'repeat', icon: 'repeat', text: t(`repeat.${draft.repeat}`) } : null
        ].filter(Boolean);
    }

    function build() {
        const { t } = context;
        parts?.wheel.destroy();
        const time = h('time', { class: 'pisi-home-date-text' });
        const dateButton = h(
            'button',
            {
                type: 'button',
                class: 'pisi-home-date',
                'aria-haspopup': 'dialog',
                dataset: { action: 'pick-date' },
                onClick() {
                    state.pickerMonth = null;
                    onOpenOverlay(PISI_OVERLAY_DATE);
                }
            },
            time,
            icon('chevron-down')
        );
        const todayBadge = h('span', { class: 'pisi-day-today' }, t('pisi.today'));
        const goToday = renderButton({
            label: t('pisi.goToday'),
            variant: 'text',
            icon: 'undo',
            dataset: { action: 'go-today' },
            onClick: () => {
                selectDate(context.today);
                dateButton.focus();
            }
        });
        const diary = createDiarySection({
            t,
            onInput(text) {
                state.day = { ...state.day, text };
                autosave.edit(state.day.date, text);
            }
        });
        const addRow = createTaskAddRow({ t, describe: describeDraft, onSubmit: (text) => void addTask(text) });
        const groups = h('div', { class: 'pisi-home-groups' });
        const scroll = h(
            'div',
            { class: 'pisi-home-scroll', dataset: { home: 'scroll' } },
            diary.element,
            h('hr', { class: 'pisi-home-divider' }),
            h(
                'section',
                { class: 'pisi-home-section pisi-home-tasks', 'aria-labelledby': 'pisi-tasks-title' },
                h('h2', { class: 'pisi-home-heading', id: 'pisi-tasks-title' }, t('pisi.tasks')),
                groups,
                addRow.element
            )
        );
        scroll.addEventListener('animationend', () => delete scroll.dataset.enter);
        scroll.addEventListener('touchstart', onTouchStart, { passive: true });
        scroll.addEventListener('touchend', onTouchEnd, { passive: true });
        scroll.addEventListener('touchcancel', () => (swipe = null), { passive: true });

        const wheel = createDateWheel({
            label: t('pisi.wheel'),
            setTimer,
            clearTimer,
            onTick: () => platform.haptic(),
            onSelect: (day) => selectDate(day)
        });
        const launcher = h(
            'button',
            {
                type: 'button',
                class: 'pisi-launcher',
                'aria-label': t('pisi.openMenu'),
                'aria-haspopup': 'dialog',
                dataset: { action: 'launcher' },
                onClick: () => onOpenOverlay(PISI_OVERLAY_MENU)
            },
            icon('menu')
        );
        parts = { time, dateButton, todayBadge, goToday, diary, addRow, groups, scroll, wheel };
        element.replaceChildren(
            h('header', { class: 'pisi-home-header' }, h('h1', { class: 'pisi-home-title' }, dateButton), todayBadge, goToday),
            scroll,
            wheel.element,
            launcher
        );
    }

    // ----- swipe -----

    function onTouchStart(event) {
        const touch = event.touches.length === 1 ? event.touches[0] : null;
        // A finger in the field that is being typed in moves the caret or selects text; it never changes the day.
        const field = event.target.closest?.('textarea, input');
        swipe = touch && !(field && field === element.ownerDocument.activeElement) ? { x: touch.clientX, y: touch.clientY } : null;
    }

    function onTouchEnd(event) {
        const touch = event.changedTouches[0];
        if (!swipe || !touch) return;
        const dx = touch.clientX - swipe.x;
        const dy = touch.clientY - swipe.y;
        swipe = null;
        if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
        platform.haptic();
        selectDate(shiftIsoDate(context.selectedDate, dx < 0 ? 1 : -1));
    }

    // ----- data -----

    async function readDay(date) {
        const token = (loadToken += 1);
        try {
            // What was typed for a day is on disk before that day is read again.
            await autosave.flush();
            const result = project ? await project.diary.read(date) : { text: '', readOnly: false, otherBlocks: 0 };
            if (destroyed || token !== loadToken) return;
            state.day = { date, text: result.text, loaded: true, readOnly: Boolean(result.readOnly), otherBlocks: result.otherBlocks ?? 0 };
        } catch (error) {
            onError(error);
            if (destroyed || token !== loadToken) return;
            state.day = { date, text: '', loaded: true, readOnly: true, otherBlocks: 0 };
        }
        parts.diary.show(state.day);
    }

    function showDay() {
        state.day = { date: context.selectedDate, text: '', loaded: false, readOnly: false, otherBlocks: 0 };
        state.completedOpen = false;
        parts.diary.show(state.day);
        parts.scroll.scrollTop = 0;
        if (state.opened) void readDay(context.selectedDate);
    }

    async function reloadDiaryDates() {
        if (!project) return;
        try {
            state.diaryDates = await project.diary.listDates();
        } catch (error) {
            onError(error);
        }
        if (!destroyed) drawWheel();
    }

    async function addTask(text) {
        const draft = parseTaskDraft(text, { selectedDate: context.selectedDate, now: now() });
        if (!draft) return;
        const result = await tasks.add(draft.payload);
        if (destroyed || !result?.ok) return;
        if (draft.day !== context.selectedDate) {
            snackbar.show({ message: context.t('pisi.taskAddedOn', { date: formatShortDay(draft.day, context.locale, context.today) }) });
        }
    }

    const stopTasks = tasks.subscribe(() => {
        if (destroyed) return;
        if (!context || !element.isConnected) {
            tasksDirty = true;
            return;
        }
        drawTasks();
        drawWheel();
    });

    return {
        element,

        /** Draws the screen for `{ t, locale, selectedDate, today }`. Only what changed is touched. */
        update(next) {
            const rebuilt = !context || context.t !== next.t;
            const dayChanged = !context || context.selectedDate !== next.selectedDate;
            const todayChanged = !context || context.today !== next.today;
            context = next;
            if (rebuilt) build();
            if (dayChanged) showDay();
            else if (rebuilt) parts.diary.show({ ...state.day, text: autosave.getPending(state.day.date) ?? state.day.text });
            if (!rebuilt && !dayChanged && !todayChanged && !tasksDirty) return;
            tasksDirty = false;
            drawHeader();
            drawTasks();
            drawWheel();
        },

        /** After the project has been opened: reads the diary days and the selected day. The task controller reads the tasks. */
        async load() {
            state.opened = true;
            await Promise.all([reloadDiaryDates(), context ? readDay(context.selectedDate) : null]);
        },

        /** After files changed outside this screen (the sample project). Text being typed is kept. */
        async reload() {
            const typing = context && autosave.getPending(context.selectedDate) !== null;
            await Promise.all([reloadDiaryDates(), context && !typing ? readDay(context.selectedDate) : null]);
        },

        /** The screen is in the document again (the tab was opened): the wheel and the diary height need its layout. */
        attach() {
            parts?.wheel.recentre();
            parts?.diary.fit();
        },

        /** Writes diary text that is still waiting. */
        flush: () => autosave.flush(),

        /** The sheet for one of this screen's overlay ids, or null when the id is not ours. */
        renderOverlay(id) {
            if (!context) return null;
            const { t, locale, selectedDate, today } = context;
            if (id === PISI_OVERLAY_MENU) return renderMenuSheet({ t, onSelect: onMenu, onClose: onCloseOverlay });
            if (id === PISI_OVERLAY_DATE) {
                const month = state.pickerMonth ?? selectedDate.slice(0, 7);
                return renderDatePicker({
                    id: PISI_OVERLAY_DATE,
                    title: t('pisi.pickDate'),
                    month,
                    selected: selectedDate,
                    today,
                    locale,
                    marks: marks(),
                    labels: dayLabels(),
                    onClose: onCloseOverlay,
                    onMonth(delta) {
                        state.pickerMonth = shiftMonth(month, delta);
                        onChange();
                    },
                    onSelect(day) {
                        onCloseOverlay();
                        selectDate(day, 'jump');
                    }
                });
            }
            return null;
        },

        /** Selector of the control that opened an overlay of this screen; focus returns to it. */
        getOverlayOpener(id) {
            if (id === PISI_OVERLAY_MENU) return '[data-action="launcher"]';
            if (id === PISI_OVERLAY_DATE) return '[data-action="pick-date"]';
            return null;
        },

        destroy() {
            destroyed = true;
            stopTasks();
            autosave.cancel();
            parts?.wheel.destroy();
        }
    };
}
