import { registerModule } from '../core/module-registry.mjs';
import {
    PISI_TODO_REMINDER_OPTIONS,
    PISI_TODO_THIRD_VIEWS,
    loadPisiTodoThirdPreferences,
    pisiTodoThirdReleaseState,
    parsePisiMissionDependenciesThirdRelease,
    parsePisiMissionReminderThirdRelease,
    setPisiMissionDependenciesThirdRelease,
    setPisiMissionReminderThirdRelease
} from './pisi-todo-third-model.mjs';
import {
    enhancePisiMissionsThirdRelease,
    getPisiReminderSeenKeyThirdRelease,
    getPisiReminderTimestampThirdRelease,
    getPisiThirdAllMissions,
    getPisiThirdVisibleMissions,
    wouldCreatePisiDependencyCycleThirdRelease
} from './pisi-todo-third-query.mjs';
import {
    appendPisiTodoThirdViewSwitcher,
    enhancePisiTodoThirdListCards,
    notifyPisiMissionThirdRelease,
    renderPisiTodoThirdAlternativeView,
    renderPisiTodoThirdCalendar as renderPisiTodoThirdCalendarView,
    renderPisiTodoThirdKanban as renderPisiTodoThirdKanbanView,
    renderPisiTodoThirdStats as renderPisiTodoThirdStatsView,
    renderPisiTodoThirdTimeline as renderPisiTodoThirdTimelineView
} from './pisi-todo-third-ui.mjs';

function renderPisiTodoThirdKanban(list, missions) {
    return renderPisiTodoThirdKanbanView(list, missions);
}

function renderPisiTodoThirdCalendar(list, missions) {
    return renderPisiTodoThirdCalendarView(list, missions, schedulePisiTodoThirdReleaseApply);
}

function renderPisiTodoThirdTimeline(list, missions) {
    return renderPisiTodoThirdTimelineView(list, missions);
}

function renderPisiTodoThirdStats(list, missions) {
    return renderPisiTodoThirdStatsView(list, missions);
}

function checkPisiTodoRemindersThirdRelease() {
    const now = Date.now();
    const oldest = now - 36 * 60 * 60 * 1000;
    for (const mission of getPisiThirdAllMissions()) {
        if (mission.completed) continue;
        const timestamp = getPisiReminderTimestampThirdRelease(mission);
        if (!timestamp || timestamp > now || timestamp < oldest) continue;
        const seenKey = getPisiReminderSeenKeyThirdRelease(mission);
        try {
            if (localStorage.getItem(seenKey) === '1') continue;
            localStorage.setItem(seenKey, '1');
        } catch {
            // Bildirim yine de gösterilebilir.
        }
        notifyPisiMissionThirdRelease(mission);
    }
}

function applyPisiTodoThirdRelease() {
    if (pisiTodoThirdReleaseState.applying) return;
    const panel = document.getElementById('pisi-missions-panel');
    const toolbar = panel?.querySelector('.pisi-missions-toolbar');
    const list = document.getElementById('pisi-missions-list');
    if (!panel || !toolbar || !list || !window.currentProjectFolder) return;

    pisiTodoThirdReleaseState.applying = true;
    try {
        appendPisiTodoThirdViewSwitcher(toolbar, schedulePisiTodoThirdReleaseApply);
        const allMissions = getPisiThirdAllMissions();
        const visibleMissions = getPisiThirdVisibleMissions(allMissions);
        if (!renderPisiTodoThirdAlternativeView(list, visibleMissions, allMissions, schedulePisiTodoThirdReleaseApply)) {
            delete list.dataset.pisiThirdView;
            enhancePisiTodoThirdListCards(list, allMissions);
        }
        checkPisiTodoRemindersThirdRelease();
    } finally {
        pisiTodoThirdReleaseState.applying = false;
    }
}

function schedulePisiTodoThirdReleaseApply(force = false) {
    if (pisiTodoThirdReleaseState.queued && !force) return;
    pisiTodoThirdReleaseState.queued = true;
    queueMicrotask(() => {
        pisiTodoThirdReleaseState.queued = false;
        applyPisiTodoThirdRelease();
    });
}

function bindPisiTodoThirdRelease() {
    const panel = document.getElementById('pisi-missions-panel');
    if (!panel) return false;
    if (pisiTodoThirdReleaseState.panel === panel && pisiTodoThirdReleaseState.observer) {
        schedulePisiTodoThirdReleaseApply();
        return true;
    }

    pisiTodoThirdReleaseState.observer?.disconnect();
    pisiTodoThirdReleaseState.panel = panel;
    pisiTodoThirdReleaseState.observer = new MutationObserver(() => {
        schedulePisiTodoThirdReleaseApply();
    });
    pisiTodoThirdReleaseState.observer.observe(panel, {
        childList: true,
        subtree: true
    });
    schedulePisiTodoThirdReleaseApply();
    return true;
}

function initializePisiTodoThirdRelease() {
    loadPisiTodoThirdPreferences();
    if (!bindPisiTodoThirdRelease()) {
        const timer = setInterval(() => {
            if (bindPisiTodoThirdRelease()) clearInterval(timer);
        }, 250);
    }
    if (!pisiTodoThirdReleaseState.reminderTimer) {
        pisiTodoThirdReleaseState.reminderTimer = setInterval(checkPisiTodoRemindersThirdRelease, 60000);
    }
}

const moduleApi = {
    PISI_TODO_THIRD_VIEWS,
    PISI_TODO_REMINDER_OPTIONS,
    pisiTodoThirdReleaseState,
    parsePisiMissionDependenciesThirdRelease,
    parsePisiMissionReminderThirdRelease,
    enhancePisiMissionsThirdRelease,
    wouldCreatePisiDependencyCycleThirdRelease,
    setPisiMissionDependenciesThirdRelease,
    setPisiMissionReminderThirdRelease,
    renderPisiTodoThirdKanban,
    renderPisiTodoThirdCalendar,
    renderPisiTodoThirdTimeline,
    renderPisiTodoThirdStats,
    checkPisiTodoRemindersThirdRelease,
    applyPisiTodoThirdRelease,
    initializePisiTodoThirdRelease
};

registerModule('tags.todoThirdRelease', moduleApi);
initializePisiTodoThirdRelease();

export {
    PISI_TODO_THIRD_VIEWS,
    PISI_TODO_REMINDER_OPTIONS,
    pisiTodoThirdReleaseState,
    parsePisiMissionDependenciesThirdRelease,
    parsePisiMissionReminderThirdRelease,
    enhancePisiMissionsThirdRelease,
    wouldCreatePisiDependencyCycleThirdRelease,
    setPisiMissionDependenciesThirdRelease,
    setPisiMissionReminderThirdRelease,
    renderPisiTodoThirdKanban,
    renderPisiTodoThirdCalendar,
    renderPisiTodoThirdTimeline,
    renderPisiTodoThirdStats,
    checkPisiTodoRemindersThirdRelease,
    applyPisiTodoThirdRelease,
    initializePisiTodoThirdRelease
};

