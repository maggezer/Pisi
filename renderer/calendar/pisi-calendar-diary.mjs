import {
    getCalendarState,
    getCurrentCalendarProjectKey,
    parseIsoDate,
    pisiCalendarRuntimeState,
    saveCalendarStateToStorage,
    toIsoDate
} from './pisi-calendar-state.mjs';

let renderPisiCalendarCallback = null;

let pisiDiaryManagedClicksBound = false;

function bindPisiDiaryManagedBlockClicks() {
    if (typeof document === 'undefined' || pisiDiaryManagedClicksBound) {
        return;
    }
    pisiDiaryManagedClicksBound = true;

    document.addEventListener(
        'click',
        async (event) => {
            const block = event.target?.closest?.('.pisi-diary-managed-block');
            if (!block) return;

            const marker = event.target?.closest?.('.pisi-block-task-marker, [role="checkbox"]');
            if (marker) {
                event.preventDefault();
                event.stopPropagation();
                const taskId = marker.dataset.pisiTaskId || block.dataset.pisiTaskId || block.dataset.pisiDiaryBlockId;
                const nextCompleted = marker.getAttribute('aria-checked') !== 'true';
                const nextStatus = nextCompleted ? 'done' : 'todo';

                marker.setAttribute('aria-checked', String(nextCompleted));
                marker.textContent = nextCompleted ? '☑' : '☐';
                block.dataset.pisiDiaryStatus = nextStatus;

                if (taskId && window.currentProjectFolder && window.pisiProject?.quickAddTask) {
                    await window.pisiProject.quickAddTask(window.currentProjectFolder, {
                        op: 'update',
                        taskId,
                        patch: { status: nextStatus }
                    });
                    if (typeof window.refreshPisiFirstClassTaskStore === 'function') {
                        await window.refreshPisiFirstClassTaskStore();
                    }
                }
                return;
            }

            const nodePath = block.dataset.pisiDiaryNodePath;
            const blockId = block.dataset.pisiDiaryBlockId;
            const taskId = block.dataset.pisiTaskId;
            const nodeTitle = block.getAttribute('title')?.replace(/^Nota git:\s*/, '') || '';

            if (nodePath && typeof window.openPisiTagBlockResult === 'function') {
                event.preventDefault();
                event.stopPropagation();
                await window.openPisiTagBlockResult({
                    nodePath,
                    blockId,
                    taskId,
                    nodeTitle
                });
            }
        },
        true
    );

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const marker = event.target?.closest?.('.pisi-diary-managed-block .pisi-block-task-marker');
        if (marker && document.activeElement === marker) {
            event.preventDefault();
            marker.click();
        }
    });
}

bindPisiDiaryManagedBlockClicks();

function configurePisiCalendarDiary(options = {}) {
    renderPisiCalendarCallback = typeof options.renderCalendar === 'function' ? options.renderCalendar : null;
    bindPisiDiaryManagedBlockClicks();
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

function formatMissionDateForDiary(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return toIsoDate(date);
}

async function runPisiDiarySync(request) {
    if (!request || pisiCalendarRuntimeState.diarySyncInProgress) {
        return null;
    }

    pisiCalendarRuntimeState.diarySyncInProgress = true;

    try {
        const result = await window.pisiProject.syncDiaryMissions(request.projectFolder, {
            entries: request.entries,
            complete: true
        });

        if (result?.ok) {
            pisiCalendarRuntimeState.lastDiarySyncSignatureByProject.set(request.projectKey, request.signature);

            if (request.projectKey === getCurrentCalendarProjectKey()) {
                await refreshPisiCalendarDates();
            }
        }

        return result;
    } catch (error) {
        console.error('[PISI] Diary sync hatası:', error);
        return {
            ok: false,
            error: error.message
        };
    } finally {
        pisiCalendarRuntimeState.diarySyncInProgress = false;

        const nextRequest = pisiCalendarRuntimeState.pendingDiarySyncRequest;
        pisiCalendarRuntimeState.pendingDiarySyncRequest = null;

        if (nextRequest && nextRequest.signature !== pisiCalendarRuntimeState.lastDiarySyncSignatureByProject.get(nextRequest.projectKey)) {
            queueMicrotask(() => {
                runPisiDiarySync(nextRequest);
            });
        }
    }
}

async function syncPisiDiaryFromMissionIndex(index, options = {}) {
    const projectFolder = window.currentProjectFolder;
    const projectKey = getCurrentCalendarProjectKey();

    if (!projectFolder || !window.pisiProject?.syncDiaryMissions) {
        return null;
    }

    if (options.complete !== true) {
        return {
            ok: false,
            incomplete: true,
            error: 'Eksik görev indeksi diary ile eşitlenmedi.'
        };
    }

    const sourceIndex = Array.isArray(index) ? index : Array.isArray(pisiTagsPanelState?.missionIndex) ? pisiTagsPanelState.missionIndex : [];

    const entries = [];

    for (const block of sourceIndex) {
        const tags = Array.isArray(block.tags) ? block.tags : [];
        const doneFor = new Set(Array.isArray(block.doneFor) ? block.doneFor.map(normalizePisiUserTag) : []);

        for (const tag of tags) {
            if (typeof parsePisiTodoTag !== 'function') continue;

            const todo = parsePisiTodoTag(tag);

            if (!todo) continue;
            if (doneFor.has(todo.tag)) continue;

            const date = formatMissionDateForDiary(todo.finishDate);

            if (!date) continue;

            entries.push({
                date,
                tag: todo.tag,
                priority: todo.priority,
                status: String(block.todoStates?.[todo.tag] || 'todo'),
                repeat: String(block.todoRepeats?.[todo.tag] || 'none'),
                parentId: String(block.todoParents?.[todo.tag] || ''),
                manualOrder: Number(block.todoOrders?.[todo.tag]),
                nodePath: block.nodePath,
                nodeTitle: block.nodeTitle,
                blockId: block.blockId,
                text: block.text,
                html: block.html
            });
        }
    }

    const signature = JSON.stringify(
        entries.map((entry) => ({
            date: entry.date,
            tag: entry.tag,
            nodePath: entry.nodePath,
            blockId: entry.blockId,
            text: entry.text,
            status: entry.status,
            repeat: entry.repeat,
            parentId: entry.parentId,
            manualOrder: entry.manualOrder
        }))
    );

    if (signature === pisiCalendarRuntimeState.lastDiarySyncSignatureByProject.get(projectKey)) {
        return null;
    }

    const request = {
        projectFolder,
        projectKey,
        entries,
        signature
    };

    if (pisiCalendarRuntimeState.diarySyncInProgress) {
        pisiCalendarRuntimeState.pendingDiarySyncRequest = request;
        return {
            ok: true,
            queued: true
        };
    }

    return runPisiDiarySync(request);
}

export { bindPisiDiaryManagedBlockClicks, configurePisiCalendarDiary, openDiaryNodeForDate, refreshPisiCalendarDates, syncPisiDiaryFromMissionIndex };
