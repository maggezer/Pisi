// From app.js:143
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[PISI] Temiz arayüz yüklendi.');

    setupWindowControls();
    setupCenterFileTabs();
    bindRightPanelTabs();
    setupPisiCustomizations();
    setupPisiRichToolbars();
    
    bindPisiTagControls();
    bindPisiBlockIndexControls();

    await setupProjectStartup();

    if (typeof refreshPisiCalendarDates === 'function') {
        await refreshPisiCalendarDates();
    }
});

// From app.js:1426
setupWindowControls.closeUnsubscribe = null;

// From renderer/pisi-tree.js:1429
document.addEventListener('keydown', (event) => {
    if (event.key === 'F2') {
        event.preventDefault();
        startRenameSelectedTreeFile();
    }
});

// From renderer/pisi-calendar.js:1
(function initPisiCalendarModule() {
    const MONTH_NAMES = [
        'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
        'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
    ];

    const WEEKDAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

    let calendarDragState = null;
    let calendarStateProjectKey = null;
    const lastDiarySyncSignatureByProject = new Map();
    let diarySyncInProgress = false;
    let pendingDiarySyncRequest = null;
    let diaryDatesRefreshRequestId = 0;

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
        const projectKey = calendarStateProjectKey || 'no-project';
        return `pisiCalendarState:${encodeURIComponent(projectKey)}`;
    }

    function activateCalendarProjectState(folderPath = window.currentProjectFolder) {
        const nextProjectKey = normalizeCalendarProjectKey(folderPath);

        if (calendarStateProjectKey === nextProjectKey) {
            return;
        }

        calendarStateProjectKey = nextProjectKey;
        diaryDatesRefreshRequestId += 1;
        pendingDiarySyncRequest = null;

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
                selectedDate: saved?.selectedDate || toIsoDate(today),
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
            return JSON.parse(
                localStorage.getItem(getCalendarStorageKey()) || 'null'
            );
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
                    year: state.year,
                    selectedDate: state.selectedDate
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

    function clampFloatingCalendarPosition(
        calendar = ensureCalendarDom(),
        state = getCalendarState()
    ) {
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

        calendarDragState = {
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
            if (!calendarDragState) return;

            const state = getCalendarState();
            const calendar = ensureCalendarDom();
            const nextX = calendarDragState.startX + event.clientX - calendarDragState.startClientX;
            const nextY = calendarDragState.startY + event.clientY - calendarDragState.startClientY;
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
            if (!calendarDragState) return;

            const calendar = ensureCalendarDom();
            const dockTarget = getCalendarDockTargetFromPoint(event.clientX, event.clientY);

            calendar.classList.remove('dragging');
            document.body.classList.remove('pisi-calendar-is-dragging');
            calendarDragState = null;

            if (dockTarget) {
                getCalendarState().dock = dockTarget;
                applyCalendarDock();
            }

            clearCalendarDockZoneState();
            const currentDock = getCalendarState().dock;
            const currentZone = currentDock === 'left' || currentDock === 'right'
                ? getCalendarDockZone(currentDock)
                : null;

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
            zone.classList.toggle(
                'active-drop-target',
                Boolean(target) && zone.dataset.calendarDockZone === target
            );
        });
    }

    function getCalendarDockTargetFromPoint(x, y) {
        const zones = [
            getCalendarDockZone('left'),
            getCalendarDockZone('right')
        ].filter(Boolean);

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

    function renderCalendar() {
        const calendar = ensureCalendarDom();
        const state = getCalendarState();
        const monthLabel = calendar.querySelector('.pisi-calendar-month-label');
        const weekdaysEl = calendar.querySelector('.pisi-calendar-weekdays');
        const daysEl = calendar.querySelector('.pisi-calendar-days');
        const diaryDates = new Set(Array.isArray(state.diaryDates) ? state.diaryDates : []);


        if (monthLabel) {
            monthLabel.textContent = `${MONTH_NAMES[state.month]} ${state.year}`;
        }

        if (weekdaysEl && weekdaysEl.dataset.rendered !== '1') {
            weekdaysEl.innerHTML = WEEKDAY_NAMES
                .map((name) => `<div class="pisi-calendar-weekday">${name}</div>`)
                .join('');
            weekdaysEl.dataset.rendered = '1';
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
            button.title = diaryDates.has(isoDate)
                ? `${isoDate} · diary node var`
                : isoDate;
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

            if (diaryDates.has(isoDate)) {
                button.classList.add('has-diary-node');
            }

            button.addEventListener('click', async () => {
                await openDiaryNodeForDate(isoDate);
            });

            daysEl.appendChild(button);
        }

        applyCalendarDock();
    }

    async function refreshPisiCalendarDates() {
        const projectFolder = window.currentProjectFolder;
        const projectKey = getCurrentCalendarProjectKey();
        const requestId = ++diaryDatesRefreshRequestId;
        const state = getCalendarState();

        if (!projectFolder || !window.pisiProject?.listDiaryDates) {
            state.diaryDates = [];
            renderCalendar();
            return null;
        }

        try {
            const result = await window.pisiProject.listDiaryDates(projectFolder);
            const requestIsCurrent =
                requestId === diaryDatesRefreshRequestId &&
                projectKey === getCurrentCalendarProjectKey();

            if (requestIsCurrent && result?.ok) {
                state.diaryDates = Array.isArray(result.dates) ? result.dates : [];
                renderCalendar();
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
        renderCalendar();

        const result = await window.pisiProject?.getOrCreateDiaryNode?.(
            window.currentProjectFolder,
            isoDate
        );

        if (!result?.ok) {
            alert(result?.error || 'Diary node oluşturulamadı.');
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

        if (typeof openPisiFileTab === 'function') {
            await openPisiFileTab(nodeItem);
        } else if (typeof openCenterNodeEditor === 'function') {
            await openCenterNodeEditor(nodeItem);
        }
    }

    function formatMissionDateForDiary(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
        return toIsoDate(date);
    }

    async function runPisiDiarySync(request) {
        if (!request || diarySyncInProgress) {
            return null;
        }

        diarySyncInProgress = true;

        try {
            const result = await window.pisiProject.syncDiaryMissions(
                request.projectFolder,
                {
                    entries: request.entries,
                    complete: true
                }
            );

            if (result?.ok) {
                lastDiarySyncSignatureByProject.set(
                    request.projectKey,
                    request.signature
                );

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
            diarySyncInProgress = false;

            const nextRequest = pendingDiarySyncRequest;
            pendingDiarySyncRequest = null;

            if (
                nextRequest &&
                nextRequest.signature !==
                    lastDiarySyncSignatureByProject.get(nextRequest.projectKey)
            ) {
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

        const sourceIndex = Array.isArray(index)
            ? index
            : (Array.isArray(pisiTagsPanelState?.missionIndex) ? pisiTagsPanelState.missionIndex : []);

        const entries = [];

        for (const block of sourceIndex) {
            const tags = Array.isArray(block.tags) ? block.tags : [];
            const doneFor = new Set(
                Array.isArray(block.doneFor)
                    ? block.doneFor.map(normalizePisiUserTag)
                    : []
            );
            const hasLegacyDone = block.legacyDone === true;

            for (const tag of tags) {
                if (typeof parsePisiTodoTag !== 'function') continue;

                const todo = parsePisiTodoTag(tag);

                if (!todo) continue;
                if (hasLegacyDone || doneFor.has(todo.tag)) continue;

                const date = formatMissionDateForDiary(todo.finishDate);

                if (!date) continue;

                entries.push({
                    date,
                    tag: todo.tag,
                    priority: todo.priority,
                    nodePath: block.nodePath,
                    nodeTitle: block.nodeTitle,
                    blockId: block.blockId,
                    text: block.text,
                    html: block.html
                });
            }
        }

        const signature = JSON.stringify(entries.map((entry) => ({
            date: entry.date,
            tag: entry.tag,
            nodePath: entry.nodePath,
            blockId: entry.blockId,
            text: entry.text
        })));

        if (
            signature === lastDiarySyncSignatureByProject.get(projectKey)
        ) {
            return null;
        }

        const request = {
            projectFolder,
            projectKey,
            entries,
            signature
        };

        if (diarySyncInProgress) {
            pendingDiarySyncRequest = request;
            return {
                ok: true,
                queued: true
            };
        }

        return runPisiDiarySync(request);
    }

    function resetPisiCalendarForProject(folderPath) {
        calendarStateProjectKey = null;
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
})();

// From renderer/pisi-node-modal.js:365
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        bindNodeModalControls();
        setupPisiNodePreviews();
    });
} else {
    bindNodeModalControls();
    setupPisiNodePreviews();
}

// From renderer/pisi-map-connections.js:873
window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    let cancelled = false;

    if (pisiKeyboardConnectionSource) {
        pisiKeyboardConnectionSource.portEl?.classList.remove(
            'connecting-source'
        );
        pisiKeyboardConnectionSource.portEl?.setAttribute(
            'aria-label',
            `${pisiKeyboardConnectionSource.sourcePort} bağlantı portu`
        );
        pisiKeyboardConnectionSource = null;
        cancelled = true;
    }

    if (currentConnectionDrag) {
        const sourcePortEl = currentConnectionDrag.sourceBox?.querySelector(
            `.map-port.${currentConnectionDrag.sourcePort}`
        );
        sourcePortEl?.classList.remove('connecting-source');
        currentConnectionDrag = null;
        clearTempEdgePath();
        cancelled = true;
    }

    if (cancelled) {
        event.preventDefault();
        event.stopPropagation();
    }
});

// From renderer/pisi-map-connections.js:906
window.addEventListener('mousemove', (event) => {
    if (!currentConnectionDrag) return;

    const mouse = getMousePointInCanvas(event);
    const temp = ensureTempEdgePath();

    if (temp) {
    temp.setAttribute(
        'd',
        makeTempConnectionPath(
            currentConnectionDrag.sourceBox,
            currentConnectionDrag.sourcePort,
            mouse
        )
    );
    }
});

// From renderer/pisi-map-connections.js:924
window.addEventListener('mouseup', async (event) => {
    if (!currentConnectionDrag) return;

    const targetPortEl = event.target.closest?.('.map-port');
    const sourcePortEl = currentConnectionDrag.sourceBox.querySelector(
        `.map-port.${currentConnectionDrag.sourcePort}`
    );

    sourcePortEl?.classList.remove('connecting-source');

    const clickDistance = Math.abs(event.clientX - (currentConnectionDrag.startClientX || event.clientX)) +
        Math.abs(event.clientY - (currentConnectionDrag.startClientY || event.clientY));

    if (targetPortEl === sourcePortEl && clickDistance <= 4 && currentConnectionDrag.type === 'down-hub') {
        toggleHubConnectionsFromPort(
            currentConnectionDrag.sourceId,
            currentConnectionDrag.sourcePort
        );

        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

    if (!targetPortEl) {
        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

    const targetBox = targetPortEl.closest('.map-node-box');

    if (!targetBox) {
        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

    const targetId = targetBox.dataset.nodeId;
    const targetPort = targetPortEl.dataset.port;

    if (targetId === currentConnectionDrag.sourceId) {
        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

let edgePayload = {
    sourceId: currentConnectionDrag.sourceId,
    targetId,
    sourcePort: currentConnectionDrag.sourcePort,
    targetPort,

    type: currentConnectionDrag.type,
    sourceRole: currentConnectionDrag.sourceRole,
    targetRole: currentConnectionDrag.targetRole
};

    const result = await persistPisiMapConnection(edgePayload);

    if (!result || !result.ok) {
        if (!result?.cancelled) {
            alert(result?.error || 'Bağlantı kaydedilemedi.');
        }
        currentConnectionDrag = null;
        clearTempEdgePath();
        return;
    }

    currentConnectionDrag = null;
    clearTempEdgePath();

});

export {};
