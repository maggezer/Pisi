const MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const WEEKDAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

const pisiCalendarRuntimeState = {
    calendarDragState: null,
    calendarStateProjectKey: null,
    lastDiarySyncSignatureByProject: new Map(),
    diarySyncInProgress: false,
    pendingDiarySyncRequest: null,
    diaryDatesRefreshRequestId: 0
};

function translatePisiCalendarText(value) {
    return window.pisiI18n?.translate?.(value) ?? String(value ?? '');
}

function normalizeCalendarProjectKey(folderPath) {
    const normalized = String(folderPath || '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '');

    if (window.pisiEnvironment?.platform === 'win32') {
        return normalized.toLowerCase();
    }

    return normalized;
}

function getCurrentCalendarProjectKey() {
    return normalizeCalendarProjectKey(window.currentProjectFolder);
}

function getCalendarStorageKey() {
    const projectKey = pisiCalendarRuntimeState.calendarStateProjectKey || 'no-project';
    return `pisiCalendarState:${encodeURIComponent(projectKey)}`;
}

function activateCalendarProjectState(folderPath = window.currentProjectFolder) {
    const nextProjectKey = normalizeCalendarProjectKey(folderPath);

    if (pisiCalendarRuntimeState.calendarStateProjectKey === nextProjectKey) {
        return;
    }

    pisiCalendarRuntimeState.calendarStateProjectKey = nextProjectKey;
    pisiCalendarRuntimeState.diaryDatesRefreshRequestId += 1;
    pisiCalendarRuntimeState.pendingDiarySyncRequest = null;

    if (!window.Pisi) {
        window.Pisi = { state: {}, calendar: {} };
    }

    if (!window.Pisi.state) {
        window.Pisi.state = {};
    }

    window.Pisi.state.pisiCalendarState = null;
}

function getCalendarState() {
    activateCalendarProjectState();

    if (!window.Pisi) {
        window.Pisi = { state: {}, calendar: {} };
    }

    if (!window.Pisi.state) {
        window.Pisi.state = {};
    }

    if (!window.Pisi.state.pisiCalendarState) {
        const saved = readCalendarStateFromStorage();
        const today = new Date();

        window.Pisi.state.pisiCalendarState = {
            dock: saved?.dock || 'right',
            x: Number(saved?.x ?? 360),
            y: Number(saved?.y ?? 140),
            month: Number(saved?.month ?? today.getMonth()),
            year: Number(saved?.year ?? today.getFullYear()),
            selectedDate: null,
            diaryDates: []
        };
    }

    if (!Array.isArray(window.Pisi.state.pisiCalendarState.diaryDates)) {
        window.Pisi.state.pisiCalendarState.diaryDates = [];
    }

    return window.Pisi.state.pisiCalendarState;
}

function readCalendarStateFromStorage() {
    try {
        return JSON.parse(localStorage.getItem(getCalendarStorageKey()) || 'null');
    } catch {
        return null;
    }
}

function saveCalendarStateToStorage() {
    try {
        const state = getCalendarState();

        localStorage.setItem(
            getCalendarStorageKey(),
            JSON.stringify({
                dock: state.dock,
                x: state.x,
                y: state.y,
                month: state.month,
                year: state.year
            })
        );
    } catch {
        // localStorage yoksa takvim yine çalışır.
    }
}

function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function sameDate(a, b) {
    return toIsoDate(a) === toIsoDate(b);
}

function parseIsoDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

    if (toIsoDate(date) !== value) return null;
    return date;
}

export {
    MONTH_NAMES,
    WEEKDAY_NAMES,
    activateCalendarProjectState,
    getCalendarState,
    getCurrentCalendarProjectKey,
    parseIsoDate,
    pisiCalendarRuntimeState,
    sameDate,
    saveCalendarStateToStorage,
    toIsoDate,
    translatePisiCalendarText
};
