(function initKediCalendarModule() {
    const MONTH_NAMES = [
        'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
        'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
    ];

    const WEEKDAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

    let calendarDragState = null;
    let lastDiarySyncSignature = '';
    let diarySyncInProgress = false;
    let diaryDatesRefreshInProgress = false;

    function getCalendarState() {
        if (!window.Kedi) {
            window.Kedi = { state: {}, calendar: {} };
        }

        if (!window.Kedi.state) {
            window.Kedi.state = {};
        }

        if (!window.Kedi.state.kediCalendarState) {
            const saved = readCalendarStateFromStorage();
            const today = new Date();

            window.Kedi.state.kediCalendarState = {
                dock: saved?.dock || 'right',
                x: Number(saved?.x ?? 360),
                y: Number(saved?.y ?? 140),
                month: Number(saved?.month ?? today.getMonth()),
                year: Number(saved?.year ?? today.getFullYear()),
                selectedDate: saved?.selectedDate || toIsoDate(today),
                diaryDates: []
            };
        }

        if (!Array.isArray(window.Kedi.state.kediCalendarState.diaryDates)) {
            window.Kedi.state.kediCalendarState.diaryDates = [];
        }

        return window.Kedi.state.kediCalendarState;
    }

    function readCalendarStateFromStorage() {
        try {
            return JSON.parse(localStorage.getItem('kediCalendarState') || 'null');
        } catch {
            return null;
        }
    }

    function saveCalendarStateToStorage() {
        try {
            const state = getCalendarState();

            localStorage.setItem(
                'kediCalendarState',
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
        let calendar = document.getElementById('kedi-calendar');

        if (calendar) return calendar;

        calendar = document.createElement('div');
        calendar.id = 'kedi-calendar';
        calendar.className = 'kedi-calendar';
        calendar.innerHTML = `

            <div class="kedi-calendar-body">
                <div class="kedi-calendar-month-row">
                    <button class="kedi-calendar-icon-btn" data-calendar-action="prev" title="Önceki ay">‹</button>
                    <div class="kedi-calendar-month-label"></div>
                    <button class="kedi-calendar-icon-btn" data-calendar-action="next" title="Sonraki ay">›</button>
                </div>

                <div class="kedi-calendar-grid kedi-calendar-weekdays"></div>
                <div class="kedi-calendar-grid kedi-calendar-days"></div>

                <div class="kedi-calendar-footer">
                    <button class="kedi-calendar-today-btn" data-calendar-action="today">Bugün</button>
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

        let zone = panel.querySelector(`.kedi-calendar-dock-zone[data-calendar-dock-zone="${side}"]`);

        if (zone) return zone;

        zone = document.createElement('div');
        zone.className = 'kedi-calendar-dock-zone';
        zone.dataset.calendarDockZone = side;
        zone.innerHTML = '<div class="kedi-calendar-dock-zone-label">Calendar dock</div>';

        panel.appendChild(zone);
        return zone;
    }

    function getCalendarDockZone(side) {
        ensureCalendarDockZones();
        return document.querySelector(`.kedi-calendar-dock-zone[data-calendar-dock-zone="${side}"]`);
    }

    function clearCalendarDockZoneState() {
        document.querySelectorAll('.kedi-calendar-dock-zone').forEach((zone) => {
            zone.classList.remove('active-drop-target', 'has-calendar');
        });
    }

    function bindCalendarEvents(calendar) {
        const header = calendar.querySelector('.kedi-calendar-month-label');

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
        calendar.style.left = `${Math.max(8, Number(state.x || 360))}px`;
        calendar.style.top = `${Math.max(40, Number(state.y || 140))}px`;
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
        document.body.classList.add('kedi-calendar-is-dragging');
        event.preventDefault();
    }

    function bindGlobalCalendarDragEvents() {
        if (window.__kediCalendarDragEventsBound === true) return;
        window.__kediCalendarDragEventsBound = true;

        window.addEventListener('mousemove', (event) => {
            if (!calendarDragState) return;

            const state = getCalendarState();
            const calendar = ensureCalendarDom();
            const nextX = calendarDragState.startX + event.clientX - calendarDragState.startClientX;
            const nextY = calendarDragState.startY + event.clientY - calendarDragState.startClientY;

            state.x = Math.max(8, Math.min(window.innerWidth - 80, nextX));
            state.y = Math.max(40, Math.min(window.innerHeight - 60, nextY));

            calendar.style.left = `${state.x}px`;
            calendar.style.top = `${state.y}px`;

            markCalendarDockTarget(event.clientX, event.clientY);
        });

        window.addEventListener('mouseup', (event) => {
            if (!calendarDragState) return;

            const calendar = ensureCalendarDom();
            const dockTarget = getCalendarDockTargetFromPoint(event.clientX, event.clientY);

            calendar.classList.remove('dragging');
            document.body.classList.remove('kedi-calendar-is-dragging');
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
    }

    function markCalendarDockTarget(x, y) {
        const target = getCalendarDockTargetFromPoint(x, y);

        document.querySelectorAll('.kedi-calendar-dock-zone').forEach((zone) => {
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
        const monthLabel = calendar.querySelector('.kedi-calendar-month-label');
        const weekdaysEl = calendar.querySelector('.kedi-calendar-weekdays');
        const daysEl = calendar.querySelector('.kedi-calendar-days');
        const diaryDates = new Set(Array.isArray(state.diaryDates) ? state.diaryDates : []);


        if (monthLabel) {
            monthLabel.textContent = `${MONTH_NAMES[state.month]} ${state.year}`;
        }

        if (weekdaysEl && weekdaysEl.dataset.rendered !== '1') {
            weekdaysEl.innerHTML = WEEKDAY_NAMES
                .map((name) => `<div class="kedi-calendar-weekday">${name}</div>`)
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
            button.className = 'kedi-calendar-day';
            button.title = diaryDates.has(isoDate)
                ? `${isoDate} · diary node var`
                : isoDate;
            button.dataset.date = isoDate;
            button.innerHTML = `<span class="kedi-calendar-day-number">${dayDate.getDate()}</span>`;

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

    async function refreshKediCalendarDates() {
        if (diaryDatesRefreshInProgress) return null;

        const state = getCalendarState();

        if (!window.currentProjectFolder || !window.kediProject?.listDiaryDates) {
            state.diaryDates = [];
            renderCalendar();
            return null;
        }

        diaryDatesRefreshInProgress = true;

        try {
            const result = await window.kediProject.listDiaryDates(window.currentProjectFolder);

            if (result?.ok) {
                state.diaryDates = Array.isArray(result.dates) ? result.dates : [];
                renderCalendar();
            }

            return result;
        } catch (error) {
            console.error('[KEDI] Diary tarihleri okunamadı:', error);
            return {
                ok: false,
                error: error.message
            };
        } finally {
            diaryDatesRefreshInProgress = false;
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

        const result = await window.kediProject?.getOrCreateDiaryNode?.(
            window.currentProjectFolder,
            isoDate
        );

        if (!result?.ok) {
            alert(result?.error || 'Diary node oluşturulamadı.');
            return;
        }

        await refreshKediCalendarDates();

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

        if (typeof openKediFileTab === 'function') {
            await openKediFileTab(nodeItem);
        } else if (typeof openCenterNodeEditor === 'function') {
            await openCenterNodeEditor(nodeItem);
        }
    }

    function formatMissionDateForDiary(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
        return toIsoDate(date);
    }

    async function syncKediDiaryFromMissionIndex(index) {
        if (!window.currentProjectFolder || !window.kediProject?.syncDiaryMissions) {
            return null;
        }

        const sourceIndex = Array.isArray(index)
            ? index
            : (Array.isArray(kediTagsPanelState?.missionIndex) ? kediTagsPanelState.missionIndex : []);

        const entries = [];

        for (const block of sourceIndex) {
            const tags = Array.isArray(block.tags) ? block.tags : [];
            const hasDone = tags.some((tag) => normalizeKediUserTag(tag) === 'done');

            if (hasDone) continue;

            for (const tag of tags) {
                if (typeof parseKediTodoTag !== 'function') continue;

                const todo = parseKediTodoTag(tag);

                if (!todo) continue;

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

        if (signature === lastDiarySyncSignature || diarySyncInProgress) {
            return null;
        }

        lastDiarySyncSignature = signature;
        diarySyncInProgress = true;

        try {
            const result = await window.kediProject.syncDiaryMissions(
                window.currentProjectFolder,
                entries
            );

            if (result?.ok) {
                await refreshKediCalendarDates();
            }

            return result;
        } catch (error) {
            console.error('[KEDI] Diary sync hatası:', error);
            return {
                ok: false,
                error: error.message
            };
        } finally {
            diarySyncInProgress = false;
        }
    }

    function setupKediCalendar() {
        ensureCalendarDockZones();
        ensureCalendarDom();
        bindGlobalCalendarDragEvents();
        renderCalendar();
        refreshKediCalendarDates();
    }

    function refreshKediCalendar() {
        renderCalendar();
        refreshKediCalendarDates();
    }

    window.setupKediCalendar = setupKediCalendar;
    window.refreshKediCalendar = refreshKediCalendar;
    window.refreshKediCalendarDates = refreshKediCalendarDates;
    window.syncKediDiaryFromMissionIndex = syncKediDiaryFromMissionIndex;
    window.setKediCalendarDock = setCalendarDock;

    if (!window.Kedi) {
        window.Kedi = { state: {}, calendar: {} };
    }

    window.Kedi.calendar = {
        setup: setupKediCalendar,
        refresh: refreshKediCalendar,
        refreshDates: refreshKediCalendarDates,
        syncFromMissionIndex: syncKediDiaryFromMissionIndex,
        setDock: setCalendarDock
    };

    document.addEventListener('DOMContentLoaded', () => {
        setupKediCalendar();
    });
})();
