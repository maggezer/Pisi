import { activateCalendarProjectState, pisiCalendarRuntimeState } from './pisi-calendar-state.mjs';
import { configurePisiCalendarDiary, openDiaryNodeForDate, refreshPisiCalendarDates, syncPisiDiaryFromMissionIndex } from './pisi-calendar-diary.mjs';
import {
    bindGlobalCalendarDragEvents,
    ensureCalendarDockZones,
    ensureCalendarDom,
    renderCalendar,
    setCalendarDock,
    setPisiCalendarDateOpenHandler
} from './pisi-calendar-ui.mjs';

configurePisiCalendarDiary({ renderCalendar });
setPisiCalendarDateOpenHandler(openDiaryNodeForDate);

    function resetPisiCalendarForProject(folderPath) {
        pisiCalendarRuntimeState.calendarStateProjectKey = null;
        activateCalendarProjectState(folderPath);

        const calendar = document.getElementById('pisi-calendar');
        if (calendar) {
            renderCalendar();
            refreshPisiCalendarDates();
        }
    }

    function setupPisiCalendar() {
        ensureCalendarDockZones();
        ensureCalendarDom();
        bindGlobalCalendarDragEvents();
        renderCalendar();
        refreshPisiCalendarDates();
    }

    function refreshPisiCalendar() {
        renderCalendar();
        refreshPisiCalendarDates();
    }

window.setupPisiCalendar = setupPisiCalendar;
window.refreshPisiCalendar = refreshPisiCalendar;
window.refreshPisiCalendarDates = refreshPisiCalendarDates;
window.syncPisiDiaryFromMissionIndex = syncPisiDiaryFromMissionIndex;
window.setPisiCalendarDock = setCalendarDock;
window.resetPisiCalendarForProject = resetPisiCalendarForProject;

if (!window.Pisi) {
    window.Pisi = { state: {}, calendar: {} };
}

window.Pisi.calendar = {
    setup: setupPisiCalendar,
    refresh: refreshPisiCalendar,
    refreshDates: refreshPisiCalendarDates,
    syncFromMissionIndex: syncPisiDiaryFromMissionIndex,
    setDock: setCalendarDock,
    resetForProject: resetPisiCalendarForProject
};

document.addEventListener('DOMContentLoaded', () => {
    setupPisiCalendar();
});

document.addEventListener('pisi:language-changed', () => {
    if (document.getElementById('pisi-calendar')) {
        renderCalendar();
    }
});
