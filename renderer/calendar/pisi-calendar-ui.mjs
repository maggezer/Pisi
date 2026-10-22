import {
    MONTH_NAMES,
    WEEKDAY_NAMES,
    getCalendarState,
    parseIsoDate,
    pisiCalendarRuntimeState,
    sameDate,
    saveCalendarStateToStorage,
    toIsoDate,
    translatePisiCalendarText
} from './pisi-calendar-state.mjs';

let pisiCalendarDateOpenHandler = null;

function setPisiCalendarDateOpenHandler(handler) {
    pisiCalendarDateOpenHandler = typeof handler === 'function' ? handler : null;
}

function ensureCalendarDom() {
    let calendar = document.getElementById('pisi-calendar');

    if (calendar) return calendar;

    calendar = document.createElement('div');
    calendar.id = 'pisi-calendar';
    calendar.className = 'pisi-calendar';
    calendar.innerHTML = `

        <div class="pisi-calendar-body">
            <div class="pisi-calendar-month-row">
                <button class="pisi-calendar-icon-btn" data-calendar-action="prev" title="Önceki ay">‹</button>
                <div class="pisi-calendar-month-label"></div>
                <button class="pisi-calendar-icon-btn" data-calendar-action="next" title="Sonraki ay">›</button>
            </div>

            <div class="pisi-calendar-grid pisi-calendar-weekdays"></div>
            <div class="pisi-calendar-grid pisi-calendar-days"></div>

            <div class="pisi-calendar-footer">
                <button class="pisi-calendar-today-btn" data-calendar-action="today">Bugün</button>
            </div>
        </div>
    `;

    document.body.appendChild(calendar);
    bindCalendarEvents(calendar);

    return calendar;
}

function ensureCalendarDockZones() {
    ensureSingleCalendarDockZone('left');
    ensureSingleCalendarDockZone('right');
}

function ensureSingleCalendarDockZone(side) {
    const panel = document.getElementById(side === 'left' ? 'left-panel' : 'right-panel');

    if (!panel) return null;

    let zone = panel.querySelector(`.pisi-calendar-dock-zone[data-calendar-dock-zone="${side}"]`);

    if (zone) return zone;

    zone = document.createElement('div');
    zone.className = 'pisi-calendar-dock-zone';
    zone.dataset.calendarDockZone = side;
    zone.innerHTML = '<div class="pisi-calendar-dock-zone-label">Calendar dock</div>';

    panel.appendChild(zone);
    return zone;
}

function getCalendarDockZone(side) {
    ensureCalendarDockZones();
    return document.querySelector(`.pisi-calendar-dock-zone[data-calendar-dock-zone="${side}"]`);
}

function clearCalendarDockZoneState() {
    document.querySelectorAll('.pisi-calendar-dock-zone').forEach((zone) => {
        zone.classList.remove('active-drop-target', 'has-calendar');
    });
}

function bindCalendarEvents(calendar) {
    const header = calendar.querySelector('.pisi-calendar-month-label');

    header?.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        startCalendarDrag(event, calendar);
    });

    calendar.querySelector('[data-calendar-action="prev"]')?.addEventListener('click', () => {
        changeCalendarMonth(-1);
    });

    calendar.querySelector('[data-calendar-action="next"]')?.addEventListener('click', () => {
        changeCalendarMonth(1);
    });

    calendar.querySelector('[data-calendar-action="today"]')?.addEventListener('click', () => {
        const today = new Date();
        const state = getCalendarState();

        state.year = today.getFullYear();
        state.month = today.getMonth();
        state.selectedDate = toIsoDate(today);

        saveCalendarStateToStorage();
        renderCalendar();
    });
}

function setCalendarDock(dock) {
    const state = getCalendarState();
    const calendar = ensureCalendarDom();

    if (dock === 'float') {
        const rect = calendar.getBoundingClientRect();
        state.x = rect.left;
        state.y = rect.top;
        state.dock = 'float';
    } else if (dock === 'left' || dock === 'right') {
        state.dock = dock;
    }

    saveCalendarStateToStorage();
    applyCalendarDock();
}

function applyCalendarDock() {
    const calendar = ensureCalendarDom();
    const state = getCalendarState();

    ensureCalendarDockZones();
    clearCalendarDockZoneState();

    calendar.classList.remove('docked', 'floating', 'dock-left', 'dock-right');
    calendar.style.left = '';
    calendar.style.top = '';

    if (state.dock === 'left') {
        const zone = getCalendarDockZone('left');

        if (zone) {
            zone.appendChild(calendar);
            zone.classList.add('has-calendar');
            calendar.classList.add('docked', 'dock-left');
            return;
        }
    }

    if (state.dock === 'right') {
        const zone = getCalendarDockZone('right');

        if (zone) {
            zone.appendChild(calendar);
            zone.classList.add('has-calendar');
            calendar.classList.add('docked', 'dock-right');
            return;
        }
    }

    document.body.appendChild(calendar);
    calendar.classList.add('floating');
    clampFloatingCalendarPosition(calendar, state);
    calendar.style.left = `${state.x}px`;
    calendar.style.top = `${state.y}px`;
}

function clampFloatingCalendarPosition(calendar = ensureCalendarDom(), state = getCalendarState()) {
    if (!calendar || state.dock !== 'float') return;

    const rect = calendar.getBoundingClientRect();
    const width = Math.max(1, rect.width || calendar.offsetWidth || 222);
    const height = Math.max(1, rect.height || calendar.offsetHeight || 300);
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(40, window.innerHeight - height - 8);

    state.x = Math.max(8, Math.min(maxX, Number(state.x || 360)));
    state.y = Math.max(40, Math.min(maxY, Number(state.y || 140)));
}

function startCalendarDrag(event, calendar) {
    const state = getCalendarState();
    const rect = calendar.getBoundingClientRect();

    if (state.dock !== 'float') {
        state.dock = 'float';
        state.x = rect.left;
        state.y = rect.top;
        applyCalendarDock();
    }

    pisiCalendarRuntimeState.calendarDragState = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: state.x,
        startY: state.y
    };

    calendar.classList.add('dragging');
    document.body.classList.add('pisi-calendar-is-dragging');
    event.preventDefault();
}

function bindGlobalCalendarDragEvents() {
    if (window.__pisiCalendarDragEventsBound === true) return;
    window.__pisiCalendarDragEventsBound = true;

    window.addEventListener('mousemove', (event) => {
        if (!pisiCalendarRuntimeState.calendarDragState) return;

        const state = getCalendarState();
        const calendar = ensureCalendarDom();
        const nextX = pisiCalendarRuntimeState.calendarDragState.startX + event.clientX - pisiCalendarRuntimeState.calendarDragState.startClientX;
        const nextY = pisiCalendarRuntimeState.calendarDragState.startY + event.clientY - pisiCalendarRuntimeState.calendarDragState.startClientY;
        const rect = calendar.getBoundingClientRect();
        const maxX = Math.max(8, window.innerWidth - rect.width - 8);
        const maxY = Math.max(40, window.innerHeight - rect.height - 8);

        state.x = Math.max(8, Math.min(maxX, nextX));
        state.y = Math.max(40, Math.min(maxY, nextY));

        calendar.style.left = `${state.x}px`;
        calendar.style.top = `${state.y}px`;

        markCalendarDockTarget(event.clientX, event.clientY);
    });

    window.addEventListener('mouseup', (event) => {
        if (!pisiCalendarRuntimeState.calendarDragState) return;

        const calendar = ensureCalendarDom();
        const dockTarget = getCalendarDockTargetFromPoint(event.clientX, event.clientY);

        calendar.classList.remove('dragging');
        document.body.classList.remove('pisi-calendar-is-dragging');
        pisiCalendarRuntimeState.calendarDragState = null;

        if (dockTarget) {
            getCalendarState().dock = dockTarget;
            applyCalendarDock();
        }

        clearCalendarDockZoneState();
        const currentDock = getCalendarState().dock;
        const currentZone = currentDock === 'left' || currentDock === 'right' ? getCalendarDockZone(currentDock) : null;

        currentZone?.classList.add('has-calendar');
        saveCalendarStateToStorage();
    });

    window.addEventListener('resize', () => {
        const state = getCalendarState();
        if (state.dock !== 'float') return;

        const calendar = ensureCalendarDom();
        clampFloatingCalendarPosition(calendar, state);
        calendar.style.left = `${state.x}px`;
        calendar.style.top = `${state.y}px`;
        saveCalendarStateToStorage();
    });
}

function markCalendarDockTarget(x, y) {
    const target = getCalendarDockTargetFromPoint(x, y);

    document.querySelectorAll('.pisi-calendar-dock-zone').forEach((zone) => {
        zone.classList.toggle('active-drop-target', Boolean(target) && zone.dataset.calendarDockZone === target);
    });
}

function getCalendarDockTargetFromPoint(x, y) {
    const zones = [getCalendarDockZone('left'), getCalendarDockZone('right')].filter(Boolean);

    for (const zone of zones) {
        const rect = zone.getBoundingClientRect();
        const inZone = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

        if (inZone) {
            return zone.dataset.calendarDockZone;
        }
    }

    const candidates = [
        { panel: document.getElementById('left-panel'), dock: 'left' },
        { panel: document.getElementById('right-panel'), dock: 'right' }
    ];

    for (const item of candidates) {
        if (!item.panel) continue;

        const rect = item.panel.getBoundingClientRect();
        const inPanel = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        const inBottomZone = y >= rect.bottom - 86;

        if (inPanel && inBottomZone) {
            return item.dock;
        }
    }

    return null;
}

function changeCalendarMonth(delta) {
    const state = getCalendarState();
    const date = new Date(state.year, state.month + delta, 1);

    state.year = date.getFullYear();
    state.month = date.getMonth();

    saveCalendarStateToStorage();
    renderCalendar();
}

function getCalendarTaskSummaryByDate() {
    const tasksByDate = new Map();

    const recordTask = (isoDate, status) => {
        if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return;
        let entry = tasksByDate.get(isoDate);
        if (!entry) {
            entry = { total: 0, open: 0, completed: 0 };
            tasksByDate.set(isoDate, entry);
        }
        entry.total += 1;
        if (status === 'done') {
            entry.completed += 1;
        } else {
            entry.open += 1;
        }
    };

    const firstClassTasks = window.Pisi?.modules?.['tags.taskStore']?.pisiFirstClassTaskState?.tasks || window.pisiFirstClassTaskState?.tasks || [];

    if (Array.isArray(firstClassTasks) && firstClassTasks.length > 0) {
        for (const task of firstClassTasks) {
            const scheduled = String(task.scheduledAt || '').slice(0, 10);
            const due = String(task.dueDate || '').slice(0, 10);
            const deadline = String(task.deadline || '').slice(0, 10);
            const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(scheduled)
                ? scheduled
                : /^\d{4}-\d{2}-\d{2}$/.test(due)
                  ? due
                  : /^\d{4}-\d{2}-\d{2}$/.test(deadline)
                    ? deadline
                    : null;

            if (isoDate) {
                recordTask(isoDate, String(task.status || 'todo').toLowerCase());
            }
        }
    } else {
        const missionIndex = Array.isArray(window.pisiTagsPanelState?.missionIndex) ? window.pisiTagsPanelState.missionIndex : [];

        for (const block of missionIndex) {
            const tags = Array.isArray(block?.tags) ? block.tags : [];
            const doneFor = new Set(Array.isArray(block?.doneFor) ? block.doneFor.map((t) => String(t || '').toLowerCase()) : []);

            for (const tag of tags) {
                const normTag = String(tag || '').toLowerCase();
                let todo = null;
                if (typeof window.parsePisiTodoTag === 'function') {
                    todo = window.parsePisiTodoTag(tag);
                }
                const dateObj = todo?.finishDate;
                let isoDate = null;
                if (dateObj instanceof Date && !Number.isNaN(dateObj.getTime())) {
                    isoDate = toIsoDate(dateObj);
                } else if (todo?.finishDate && typeof todo.finishDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(todo.finishDate)) {
                    isoDate = todo.finishDate;
                }
                if (isoDate) {
                    const isCompleted = doneFor.has(normTag) || String(block?.todoStates?.[tag] || '').toLowerCase() === 'done';
                    recordTask(isoDate, isCompleted ? 'done' : 'todo');
                }
            }
        }
    }

    return tasksByDate;
}

function renderCalendar() {
    const calendar = ensureCalendarDom();
    const state = getCalendarState();
    const monthLabel = calendar.querySelector('.pisi-calendar-month-label');
    const weekdaysEl = calendar.querySelector('.pisi-calendar-weekdays');
    const daysEl = calendar.querySelector('.pisi-calendar-days');
    const previousButton = calendar.querySelector('[data-calendar-action="prev"]');
    const nextButton = calendar.querySelector('[data-calendar-action="next"]');
    const todayButton = calendar.querySelector('[data-calendar-action="today"]');
    const diaryDates = new Set(Array.isArray(state.diaryDates) ? state.diaryDates : []);
    const taskSummaryByDate = getCalendarTaskSummaryByDate();

    if (previousButton) {
        previousButton.title = translatePisiCalendarText('Önceki ay');
    }

    if (nextButton) {
        nextButton.title = translatePisiCalendarText('Sonraki ay');
    }

    if (todayButton) {
        todayButton.textContent = translatePisiCalendarText('Bugün');
    }

    if (monthLabel) {
        const monthName = MONTH_NAMES[state.month] || '';
        monthLabel.textContent = `${translatePisiCalendarText(monthName)} ${state.year}`.trim();
    }

    if (weekdaysEl) {
        const weekdayElements = WEEKDAY_NAMES.map((name) => {
            const weekday = document.createElement('div');
            weekday.className = 'pisi-calendar-weekday';
            weekday.textContent = translatePisiCalendarText(name);
            return weekday;
        });

        weekdaysEl.replaceChildren(...weekdayElements);
    }

    if (!daysEl) return;

    const firstOfMonth = new Date(state.year, state.month, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const gridStart = new Date(state.year, state.month, 1 - startOffset);
    const today = new Date();
    const selectedDate = parseIsoDate(state.selectedDate);

    daysEl.innerHTML = '';

    for (let i = 0; i < 42; i++) {
        const dayDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
        const button = document.createElement('button');
        const isoDate = toIsoDate(dayDate);

        button.type = 'button';
        button.className = 'pisi-calendar-day';
        button.dataset.date = isoDate;
        button.innerHTML = `<span class="pisi-calendar-day-number">${dayDate.getDate()}</span>`;

        if (dayDate.getMonth() !== state.month) {
            button.classList.add('other-month');
        }

        if (sameDate(dayDate, today)) {
            button.classList.add('today');
        }

        if (selectedDate && sameDate(dayDate, selectedDate)) {
            button.classList.add('selected');
        }

        const taskSummary = taskSummaryByDate.get(isoDate);
        let dayTitle = isoDate;

        if (taskSummary && taskSummary.total > 0) {
            button.classList.add('has-diary-node');
            if (taskSummary.open > 0) {
                button.classList.add('has-uncompleted-tasks');
                dayTitle = `${isoDate} · ${translatePisiCalendarText('Tamamlanmamış görev var')}`;
            } else {
                button.classList.add('has-completed-tasks');
                dayTitle = `${isoDate} · ${translatePisiCalendarText('Tüm görevler tamamlandı')}`;
            }
        } else if (diaryDates.has(isoDate)) {
            button.classList.add('has-diary-node', 'has-diary-note-only');
            dayTitle = `${isoDate} · ${translatePisiCalendarText('Günlük not var')}`;
        }

        button.title = dayTitle;

        button.addEventListener('click', async () => {
            await pisiCalendarDateOpenHandler?.(isoDate);
        });

        daysEl.appendChild(button);
    }

    applyCalendarDock();
}

export {
    bindGlobalCalendarDragEvents,
    ensureCalendarDockZones,
    ensureCalendarDom,
    getCalendarTaskSummaryByDate,
    renderCalendar,
    setCalendarDock,
    setPisiCalendarDateOpenHandler
};
