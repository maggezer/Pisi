import { getPisiTodayIsoDate, matchesPisiTodoFilter } from './pisi-todo-utils.mjs';
import {
    getPisiTodoThirdStorageKey,
    parsePisiMissionDependenciesThirdRelease,
    parsePisiMissionReminderThirdRelease
} from './pisi-todo-third-model.mjs';

function getPisiMissionTitleThirdRelease(mission) {
    const text = window.getPisiMissionDisplayTextFirstRelease?.(mission);
    return String(text || mission?.sourceText || mission?.text || '(boş görev)')
        .replace(/\s+/g, ' ')
        .trim();
}

function getPisiMissionDateKeyThirdRelease(mission) {
    return mission?.finishDate instanceof Date && !Number.isNaN(mission.finishDate.getTime()) ? getPisiTodayIsoDate(mission.finishDate) : '';
}

function enhancePisiMissionsThirdRelease(missions = []) {
    const enhanced = missions.map((mission) => ({
        ...mission,
        dependencies: parsePisiMissionDependenciesThirdRelease(mission),
        reminder: parsePisiMissionReminderThirdRelease(mission)
    }));
    const byId = new Map(enhanced.map((mission) => [mission.missionId, mission]));

    for (const mission of enhanced) {
        mission.dependencyMissions = mission.dependencies.map((id) => byId.get(id)).filter(Boolean);
        mission.missingDependencies = mission.dependencies.filter((id) => !byId.has(id));
        mission.incompleteDependencies = mission.dependencyMissions.filter((dependency) => !dependency.completed);
        mission.dependencyBlocked = mission.incompleteDependencies.length > 0;
        mission.effectiveStatus = mission.dependencyBlocked ? 'blocked' : mission.status;
    }

    return enhanced;
}

function getPisiThirdAllMissions() {
    if (typeof window.getPisiMissionsFromIndexFirstRelease !== 'function') return [];
    return enhancePisiMissionsThirdRelease(window.getPisiMissionsFromIndexFirstRelease({ includeCompleted: true }));
}

function getPisiThirdVisibleMissions(allMissions) {
    const state = window.pisiTagsPanelState || {};
    const showCompleted = state.showCompletedMissions === true;
    const dateFilter = String(state.missionFilter || 'all');
    const statusFilter = String(state.missionStatusFilter || 'all');

    return allMissions.filter((mission) => {
        if (!showCompleted && mission.completed) return false;
        if (!matchesPisiTodoFilter(mission, dateFilter)) return false;
        if (statusFilter !== 'all' && mission.status !== statusFilter) return false;
        return true;
    });
}

function getPisiThirdMissionMap(missions) {
    return new Map(missions.map((mission) => [mission.missionId, mission]));
}

function wouldCreatePisiDependencyCycleThirdRelease(missionId, dependencyId, missions) {
    if (!missionId || !dependencyId || missionId === dependencyId) return true;
    const byId = getPisiThirdMissionMap(missions);
    const visited = new Set();

    const reachesMission = (currentId) => {
        if (currentId === missionId) return true;
        if (visited.has(currentId)) return false;
        visited.add(currentId);
        const current = byId.get(currentId);
        return Boolean(current?.dependencies?.some(reachesMission));
    };

    return reachesMission(dependencyId);
}

function getPisiReminderTimestampThirdRelease(mission) {
    if (!mission?.finishDate || mission.reminder === 'none') return null;
    const date = new Date(mission.finishDate);
    date.setHours(9, 0, 0, 0);
    if (mission.reminder === 'day-before') date.setDate(date.getDate() - 1);
    if (mission.reminder === 'three-days-before') date.setDate(date.getDate() - 3);
    return date.getTime();
}

function getPisiReminderSeenKeyThirdRelease(mission) {
    return getPisiTodoThirdStorageKey(`reminded:${encodeURIComponent(mission.missionId)}:${mission.reminder}:${getPisiMissionDateKeyThirdRelease(mission)}`);
}

function sortPisiThirdMissionsByFinishDate(missions = []) {
    return [...missions].sort((a, b) => String(a.finishDate).localeCompare(String(b.finishDate)));
}

export {
    getPisiMissionTitleThirdRelease,
    getPisiMissionDateKeyThirdRelease,
    enhancePisiMissionsThirdRelease,
    getPisiThirdAllMissions,
    getPisiThirdVisibleMissions,
    getPisiThirdMissionMap,
    wouldCreatePisiDependencyCycleThirdRelease,
    sortPisiThirdMissionsByFinishDate,
    getPisiReminderTimestampThirdRelease,
    getPisiReminderSeenKeyThirdRelease
};
