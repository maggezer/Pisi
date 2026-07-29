'use strict';

const calWidget = document.getElementById('calendar-widget');
const calNavData = window.kedi.calendar.initialState();
let isDocked = false;

function saveCalendarState() {
    if (!calWidget) return;
    localStorage.setItem('kedi_cal_state', JSON.stringify({
        isOpen: calWidget.style.display === 'flex',
        left: calWidget.style.left,
        top: calWidget.style.top,
        docked: isDocked
    }));
}

function applyDockState(dockStatus) {
    if (!calWidget) return;
    isDocked = Boolean(dockStatus);
    const rightSidebar = document.getElementById('right-sidebar');
    const rightPlaceholder = document.getElementById('right-placeholder');
    const dockButton = document.getElementById('cal-dock');

    if (isDocked && rightSidebar) {
        calWidget.classList.add('docked');
        rightSidebar.appendChild(calWidget);
        if (rightPlaceholder) rightPlaceholder.style.display = 'none';
        if (dockButton) {
            dockButton.textContent = '📍';
            dockButton.title = 'Serbest Bırak';
        }
        calWidget.style.display = 'flex';
    } else {
        calWidget.classList.remove('docked');
        document.body.appendChild(calWidget);
        if (rightPlaceholder) rightPlaceholder.style.display = 'block';
        if (dockButton) {
            dockButton.textContent = '📌';
            dockButton.title = 'Sağ Panele Sabitle';
        }
    }
}

function restoreCalendarState() {
    if (!calWidget) return;
    try {
        const state = JSON.parse(localStorage.getItem('kedi_cal_state') || 'null');
        if (!state || typeof state !== 'object') return;
        if (/^-?\d+(?:\.\d+)?px$/.test(state.left || '') && /^-?\d+(?:\.\d+)?px$/.test(state.top || '')) {
            calWidget.style.left = state.left;
            calWidget.style.top = state.top;
            calWidget.style.right = 'auto';
        }
        if (state.docked) applyDockState(true);
        else calWidget.style.display = state.isOpen ? 'flex' : 'none';
        if (state.isOpen || state.docked) renderCalendar();
    } catch (error) {
        console.error('Takvim durumu yüklenemedi:', error);
        localStorage.removeItem('kedi_cal_state');
    }
}

function renderCalendar() {
    const calDays = document.getElementById('cal-days');
    if (!calDays) return;
    calDays.replaceChildren();
    if (!window.currentHivePath) return;

    const type = window.currentCalendarType;
    const state = calNavData[type];
    const monthData = window.kedi.calendar.monthData(type, state);
    const journalFolder = window.kedi.path.join(window.currentHivePath, 'Journals');
    const title = document.getElementById('cal-title');
    if (title) title.textContent = monthData.title;

    for (let index = 0; index < monthData.firstDay; index += 1) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'cal-day empty';
        calDays.appendChild(emptyDay);
    }

    for (let day = 1; day <= monthData.daysInMonth; day += 1) {
        const dayElement = document.createElement('div');
        dayElement.className = 'cal-day';
        dayElement.textContent = String(day);
        if (day === monthData.todayDay) dayElement.classList.add('today');

        const fileName = `${monthData.year}-${monthData.fileMonth}-${String(day).padStart(2, '0')}_${monthData.filePrefix}.md`;
        const filePath = window.kedi.path.join(journalFolder, fileName);
        if (window.kedi.fs.exists(filePath)) dayElement.classList.add('has-note');

        dayElement.addEventListener('click', () => {
            try {
                if (!window.kedi.fs.exists(journalFolder)) window.kedi.fs.mkdir(journalFolder);
                if (!window.kedi.fs.exists(filePath)) {
                    const safeTitle = window.sanitizeRichHtml(
                        `<h1>${day} ${monthData.title} Günlüğü</h1><br>`
                    );
                    window.kedi.fs.writeText(filePath, safeTitle);
                }
                window.refreshFileList?.();
                window.loadFileToEditor?.(filePath, fileName);
                renderCalendar();
            } catch (error) {
                window.alert(`Günlük açılamadı: ${error.message}`);
            }
        });
        calDays.appendChild(dayElement);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    restoreCalendarState();

    document.getElementById('cal-dock')?.addEventListener('click', (event) => {
        event.stopPropagation();
        applyDockState(!isDocked);
        saveCalendarState();
    });

    document.getElementById('toggleCalendarBtn')?.addEventListener('click', (event) => {
        event.stopPropagation();
        if (isDocked || !calWidget) return;
        const opening = calWidget.style.display !== 'flex';
        calWidget.style.display = opening ? 'flex' : 'none';
        if (opening) renderCalendar();
        saveCalendarState();
    });

    document.getElementById('cal-close')?.addEventListener('click', () => {
        if (!calWidget) return;
        if (isDocked) applyDockState(false);
        calWidget.style.display = 'none';
        saveCalendarState();
    });

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    const header = document.getElementById('cal-header');
    header?.addEventListener('pointerdown', (event) => {
        if (isDocked || event.target.closest('button')) return;
        dragging = true;
        const rect = calWidget.getBoundingClientRect();
        offsetX = event.clientX - rect.left;
        offsetY = event.clientY - rect.top;
        calWidget.style.right = 'auto';
        header.setPointerCapture(event.pointerId);
    });
    header?.addEventListener('pointermove', (event) => {
        if (!dragging || !calWidget) return;
        calWidget.style.left = `${event.clientX - offsetX}px`;
        calWidget.style.top = `${event.clientY - offsetY}px`;
    });
    header?.addEventListener('pointerup', (event) => {
        if (!dragging) return;
        dragging = false;
        if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
        saveCalendarState();
    });

    document.getElementById('cal-prev')?.addEventListener('click', () => {
        const type = window.currentCalendarType;
        calNavData[type] = window.kedi.calendar.shiftMonth(type, calNavData[type], -1);
        renderCalendar();
    });
    document.getElementById('cal-next')?.addEventListener('click', () => {
        const type = window.currentCalendarType;
        calNavData[type] = window.kedi.calendar.shiftMonth(type, calNavData[type], 1);
        renderCalendar();
    });
});

window.renderCalendar = renderCalendar;
window.restoreCalendarState = restoreCalendarState;
