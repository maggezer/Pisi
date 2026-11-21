import { getCalendarState, getCurrentCalendarProjectKey, parseIsoDate, pisiCalendarRuntimeState, saveCalendarStateToStorage } from './pisi-calendar-state.mjs';

let renderPisiCalendarCallback = null;

function configurePisiCalendarDiary(options = {}) {
    renderPisiCalendarCallback = typeof options.renderCalendar === 'function' ? options.renderCalendar : null;
}

async function refreshPisiCalendarDates() {
    const projectFolder = window.currentProjectFolder;
    const projectKey = getCurrentCalendarProjectKey();
    const requestId = ++pisiCalendarRuntimeState.diaryDatesRefreshRequestId;
    const state = getCalendarState();

    if (!projectFolder || !window.pisiProject?.listDiaryDates) {
        state.diaryDates = [];
        renderPisiCalendarCallback?.();
        return null;
    }

    try {
        const result = await window.pisiProject.listDiaryDates(projectFolder);
        const requestIsCurrent = requestId === pisiCalendarRuntimeState.diaryDatesRefreshRequestId && projectKey === getCurrentCalendarProjectKey();

        if (requestIsCurrent && result?.ok) {
            state.diaryDates = Array.isArray(result.dates) ? result.dates : [];
            renderPisiCalendarCallback?.();
        }

        return requestIsCurrent
            ? result
            : {
                  ok: false,
                  stale: true,
                  error: 'Eski projeye ait takvim yanıtı yok sayıldı.'
              };
    } catch (error) {
        console.error('[PISI] Diary tarihleri okunamadı:', error);
        return {
            ok: false,
            error: error.message
        };
    }
}

async function openDiaryNodeForDate(isoDate) {
    if (!window.currentProjectFolder) {
        showProjectModal?.();
        return;
    }

    const state = getCalendarState();
    state.selectedDate = isoDate;

    const clickedDate = parseIsoDate(isoDate);
    if (clickedDate) {
        state.year = clickedDate.getFullYear();
        state.month = clickedDate.getMonth();
    }

    saveCalendarStateToStorage();
    renderPisiCalendarCallback?.();

    const result = await window.pisiProject?.getOrCreateDiaryNode?.(window.currentProjectFolder, isoDate);

    if (!result?.ok) {
        pisiNotifyError(result?.error || 'Günlük notu oluşturulamadı.');
        return;
    }

    await refreshPisiCalendarDates();

    const nodeItem = {
        name: result.fileName || result.name,
        fileName: result.fileName || result.name,
        fullPath: result.fullPath,
        type: 'file',
        isDirectory: false,
        isFile: true,
        displayName: result.displayName || result.metadata?.title || result.fileName,
        metadata: result.metadata || null,
        sidecarPath: result.sidecarPath || null
    };

    let opened = false;

    if (typeof openPisiFileTab === 'function') {
        await openPisiFileTab(nodeItem);
        opened = true;
    } else if (typeof openCenterNodeEditor === 'function') {
        await openCenterNodeEditor(nodeItem);
        opened = true;
    }

    if (opened && getCalendarState() === state && state.selectedDate === isoDate) {
        state.selectedDate = null;
        saveCalendarStateToStorage();
        renderPisiCalendarCallback?.();
    }
}

export { configurePisiCalendarDiary, openDiaryNodeForDate, refreshPisiCalendarDates };
