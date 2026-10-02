import { registerModule } from '../core/module-registry.mjs';
import { PISI_TODO_STATUS_OPTIONS, getPisiTodayIsoDate, matchesPisiTodoFilter } from './pisi-todo-utils.mjs';

const PISI_TODO_THIRD_VIEWS = Object.freeze([
    Object.freeze({ value: 'list', label: 'Liste' }),
    Object.freeze({ value: 'kanban', label: 'Kanban' }),
    Object.freeze({ value: 'calendar', label: 'Takvim' }),
    Object.freeze({ value: 'timeline', label: 'Zaman çizelgesi' }),
    Object.freeze({ value: 'stats', label: 'İlerleme' })
]);

const PISI_TODO_REMINDER_OPTIONS = Object.freeze([
    Object.freeze({ value: 'none', label: 'Hatırlatma yok' }),
    Object.freeze({ value: 'due-morning', label: 'Bitiş günü 09:00' }),
    Object.freeze({ value: 'day-before', label: '1 gün önce 09:00' }),
    Object.freeze({ value: 'three-days-before', label: '3 gün önce 09:00' })
]);

const pisiTodoThirdReleaseState = {
    observer: null,
    panel: null,
    applying: false,
    queued: false,
    view: 'list',
    calendarCursor: null,
    reminderTimer: null
};

function pisiTodoThirdTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function normalizePisiThirdPath(value) {
    if (typeof window.normalizeClientPathForTags === 'function') {
        return window.normalizeClientPathForTags(value);
    }
    return String(value || '').replace(/[\\/]+/g, '/');
}

function getPisiTodoThirdProjectKey() {
    return normalizePisiThirdPath(window.currentProjectFolder || 'no-project');
}

function getPisiTodoThirdStorageKey(suffix) {
    return `pisiTodoThird:${encodeURIComponent(getPisiTodoThirdProjectKey())}:${suffix}`;
}

function loadPisiTodoThirdPreferences() {
    try {
        const savedView = localStorage.getItem(getPisiTodoThirdStorageKey('view'));
        if (PISI_TODO_THIRD_VIEWS.some((item) => item.value === savedView)) {
            pisiTodoThirdReleaseState.view = savedView;
        }
        const savedCursor = localStorage.getItem(getPisiTodoThirdStorageKey('calendar'));
        if (/^\d{4}-\d{2}$/.test(savedCursor || '')) {
            pisiTodoThirdReleaseState.calendarCursor = savedCursor;
        }
    } catch {
        // Tercihler okunamasa da varsayılan görünüm çalışır.
    }
}

function savePisiTodoThirdPreference(suffix, value) {
    try {
        localStorage.setItem(getPisiTodoThirdStorageKey(suffix), String(value));
    } catch {
        // Tercih kalıcılığı zorunlu değildir.
    }
}

function normalizePisiThirdTag(value) {
    return String(value || '')
        .trim()
        .replace(/^(?:\.\.|\/|#)/, '')
        .toLowerCase();
}

function getPisiMissionTagFromHtmlThirdRelease(mission) {
    const template = document.createElement('template');
    template.innerHTML = String(mission?.html || '');
    const target = normalizePisiThirdTag(mission?.todoTag);
    return (
        Array.from(template.content.querySelectorAll('.pisi-user-tag[data-pisi-tag]')).find((element) => {
            return normalizePisiThirdTag(element.dataset.pisiTag || element.textContent || '') === target;
        }) || null
    );
}

function parsePisiMissionDependenciesThirdRelease(mission) {
    const tag = getPisiMissionTagFromHtmlThirdRelease(mission);
    const raw = String(tag?.dataset?.pisiTodoParent || '');
    if (!raw.startsWith('dep:')) return [];

    return Array.from(
        new Set(
            raw
                .slice(4)
                .split('|')
                .map((value) => {
                    try {
                        return decodeURIComponent(value);
                    } catch {
                        return '';
                    }
                })
                .filter(Boolean)
        )
    );
}

function parsePisiMissionReminderThirdRelease(mission) {
    const tag = getPisiMissionTagFromHtmlThirdRelease(mission);
    const reminderClass = Array.from(tag?.classList || []).find((className) => {
        return className.startsWith('pisi-todo-reminder-');
    });
    const value = String(reminderClass || '').replace('pisi-todo-reminder-', '');
    return PISI_TODO_REMINDER_OPTIONS.some((option) => option.value === value) ? value : 'none';
}

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

async function mutatePisiMissionTagThirdRelease(mission, mutate) {
    if (typeof window.savePisiMissionMutationFirstRelease !== 'function') {
        return { ok: false, error: pisiTodoThirdTranslate('Görev kaydetme sistemi bulunamadı.') };
    }

    return window.savePisiMissionMutationFirstRelease(mission, (block) => {
        const tag = window.findPisiMissionTodoTagElementFirstRelease?.(block, mission);
        if (!tag) {
            return { changed: false, missing: true, previousHtml: block?.innerHTML || '' };
        }
        const previousHtml = block.innerHTML;
        const changed = mutate(tag) !== false;
        return { changed, previousHtml };
    });
}

async function setPisiMissionDependenciesThirdRelease(mission, dependencyIds = []) {
    const normalized = Array.from(new Set(dependencyIds.map(String).filter((id) => id && id !== mission?.missionId)));
    const value = normalized.length ? `dep:${normalized.map(encodeURIComponent).join('|')}` : '';

    const result = await mutatePisiMissionTagThirdRelease(mission, (tag) => {
        if (String(tag.dataset.pisiTodoParent || '') === value) return false;
        if (value) tag.dataset.pisiTodoParent = value;
        else delete tag.dataset.pisiTodoParent;
        return true;
    });

    if (result?.ok) window.refreshPisiTagsPanelSoon?.();
    return result;
}

async function setPisiMissionReminderThirdRelease(mission, reminderValue) {
    const reminder = PISI_TODO_REMINDER_OPTIONS.some((option) => {
        return option.value === reminderValue;
    })
        ? reminderValue
        : 'none';

    const result = await mutatePisiMissionTagThirdRelease(mission, (tag) => {
        Array.from(tag.classList).forEach((className) => {
            if (className.startsWith('pisi-todo-reminder-')) {
                tag.classList.remove(className);
            }
        });
        if (reminder !== 'none') {
            tag.classList.add(`pisi-todo-reminder-${reminder}`);
        }
        return true;
    });

    if (result?.ok) {
        if (reminder !== 'none' && 'Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
        window.refreshPisiTagsPanelSoon?.();
    }
    return result;
}

function makePisiThirdButton(label, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = pisiTodoThirdTranslate(label);
    return button;
}

function appendPisiTodoThirdViewSwitcher(toolbar) {
    if (!toolbar || toolbar.querySelector('.pisi-third-view-switcher')) return;

    const switcher = document.createElement('div');
    switcher.className = 'pisi-third-view-switcher';
    switcher.setAttribute('aria-label', pisiTodoThirdTranslate('Görev görünümü'));

    for (const view of PISI_TODO_THIRD_VIEWS) {
        const button = makePisiThirdButton(view.label, 'pisi-third-view-button');
        button.dataset.view = view.value;
        button.classList.toggle('active', pisiTodoThirdReleaseState.view === view.value);
        button.setAttribute('aria-pressed', pisiTodoThirdReleaseState.view === view.value ? 'true' : 'false');
        button.addEventListener('click', () => {
            pisiTodoThirdReleaseState.view = view.value;
            savePisiTodoThirdPreference('view', view.value);
            window.renderPisiMissionsPanelFirstRelease?.();
            schedulePisiTodoThirdReleaseApply();
        });
        switcher.appendChild(button);
    }

    toolbar.appendChild(switcher);
}

function makePisiThirdMissionButton(mission, className) {
    const button = makePisiThirdButton('', className);
    button.textContent = getPisiMissionTitleThirdRelease(mission);
    button.title = `${mission.nodeTitle || 'Node'} · ${getPisiMissionDateKeyThirdRelease(mission) || pisiTodoThirdTranslate('Tarihsiz')}`;
    button.addEventListener('click', () => window.openPisiTagBlockResult?.(mission));
    return button;
}

function appendPisiDependencyChipThirdRelease(container, mission, dependency, allMissions) {
    const chip = document.createElement('span');
    chip.className = 'pisi-third-dependency-chip';
    chip.classList.toggle('completed', dependency?.completed === true);

    const label = document.createElement('span');
    label.textContent = dependency
        ? `${dependency.completed ? '✓ ' : ''}${getPisiMissionTitleThirdRelease(dependency)}`
        : pisiTodoThirdTranslate('Silinmiş görev');
    chip.appendChild(label);

    const remove = makePisiThirdButton('×', 'pisi-third-chip-remove');
    remove.title = pisiTodoThirdTranslate('Bağımlılığı kaldır');
    remove.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const dependencyId = dependency?.missionId || chip.dataset.dependencyId;
        const result = await setPisiMissionDependenciesThirdRelease(
            mission,
            mission.dependencies.filter((id) => id !== dependencyId)
        );
        if (!result?.ok) alert(result?.error || 'Bağımlılık kaldırılamadı.');
    });
    chip.dataset.dependencyId = dependency?.missionId || '';
    chip.appendChild(remove);
    container.appendChild(chip);
}

function appendPisiMissionPlanningControlsThirdRelease(card, mission, allMissions) {
    if (card.querySelector('.pisi-third-planning')) return;
    const content = card.querySelector('.pisi-mission-content');
    if (!content) return;

    const details = document.createElement('details');
    details.className = 'pisi-third-planning';
    const summary = document.createElement('summary');
    const count = mission.dependencies.length;
    summary.textContent = count ? `${pisiTodoThirdTranslate('Planlama')} · ${count}` : pisiTodoThirdTranslate('Planlama');
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'pisi-third-planning-body';

    const dependencyRow = document.createElement('div');
    dependencyRow.className = 'pisi-third-control-row';
    const dependencyLabel = document.createElement('span');
    dependencyLabel.className = 'pisi-third-control-label';
    dependencyLabel.textContent = pisiTodoThirdTranslate('Görev bağımlılıkları');
    dependencyRow.appendChild(dependencyLabel);

    const chips = document.createElement('div');
    chips.className = 'pisi-third-dependency-chips';
    const byId = getPisiThirdMissionMap(allMissions);
    for (const id of mission.dependencies) {
        const dependency = byId.get(id);
        appendPisiDependencyChipThirdRelease(chips, mission, dependency, allMissions);
        if (!dependency) chips.lastElementChild.dataset.dependencyId = id;
    }
    dependencyRow.appendChild(chips);

    const addDependency = document.createElement('select');
    addDependency.className = 'pisi-third-dependency-select';
    addDependency.setAttribute('aria-label', pisiTodoThirdTranslate('Bağımlılık ekle'));
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = pisiTodoThirdTranslate('Bağımlılık ekle…');
    addDependency.appendChild(emptyOption);

    allMissions
        .filter((candidate) => {
            return candidate.missionId !== mission.missionId && !mission.dependencies.includes(candidate.missionId);
        })
        .forEach((candidate) => {
            const option = document.createElement('option');
            option.value = candidate.missionId;
            option.textContent = `${candidate.completed ? '✓ ' : ''}${getPisiMissionTitleThirdRelease(candidate)}`;
            addDependency.appendChild(option);
        });

    addDependency.addEventListener('change', async () => {
        const dependencyId = addDependency.value;
        if (!dependencyId) return;
        if (wouldCreatePisiDependencyCycleThirdRelease(mission.missionId, dependencyId, allMissions)) {
            addDependency.value = '';
            alert(pisiTodoThirdTranslate('Bu bağımlılık döngü oluşturur.'));
            return;
        }
        addDependency.disabled = true;
        const result = await setPisiMissionDependenciesThirdRelease(mission, [...mission.dependencies, dependencyId]);
        if (!result?.ok) {
            addDependency.disabled = false;
            alert(result?.error || 'Bağımlılık kaydedilemedi.');
        }
    });
    dependencyRow.appendChild(addDependency);

    const reminderRow = document.createElement('div');
    reminderRow.className = 'pisi-third-control-row';
    const reminderLabel = document.createElement('span');
    reminderLabel.className = 'pisi-third-control-label';
    reminderLabel.textContent = pisiTodoThirdTranslate('Hatırlatma');
    const reminderSelect = document.createElement('select');
    reminderSelect.className = 'pisi-third-reminder-select';
    reminderSelect.disabled = !mission.finishDate || mission.completed;
    for (const option of PISI_TODO_REMINDER_OPTIONS) {
        const element = document.createElement('option');
        element.value = option.value;
        element.textContent = pisiTodoThirdTranslate(option.label);
        element.selected = option.value === mission.reminder;
        reminderSelect.appendChild(element);
    }
    reminderSelect.addEventListener('change', async () => {
        reminderSelect.disabled = true;
        const result = await setPisiMissionReminderThirdRelease(mission, reminderSelect.value);
        if (!result?.ok) {
            reminderSelect.value = mission.reminder;
            reminderSelect.disabled = false;
            alert(result?.error || 'Hatırlatma kaydedilemedi.');
        }
    });
    reminderRow.append(reminderLabel, reminderSelect);

    body.append(dependencyRow, reminderRow);
    details.appendChild(body);
    content.appendChild(details);
}

function enhancePisiTodoThirdListCards(list, missions) {
    const byId = getPisiThirdMissionMap(missions);
    list.querySelectorAll('.pisi-mission-card[data-mission-id]').forEach((card) => {
        const mission = byId.get(card.dataset.missionId);
        if (!mission || card.dataset.pisiThirdEnhanced === 'true') return;
        card.dataset.pisiThirdEnhanced = 'true';

        const checkbox = card.querySelector('.pisi-mission-check');
        if (checkbox && mission.dependencyBlocked && !mission.completed) {
            checkbox.disabled = true;
            checkbox.title = pisiTodoThirdTranslate('Önce bağımlı görevleri tamamlayın.');
        }

        if (mission.dependencyBlocked || mission.missingDependencies.length) {
            const meta = card.querySelector('.pisi-mission-meta');
            if (meta) {
                const badge = document.createElement('span');
                badge.className = 'pisi-third-dependency-badge';
                badge.classList.toggle('missing', mission.missingDependencies.length > 0);
                badge.textContent = mission.dependencyBlocked
                    ? `${pisiTodoThirdTranslate('Bağımlı')} · ${mission.incompleteDependencies.length}`
                    : pisiTodoThirdTranslate('Eksik bağımlılık');
                meta.appendChild(badge);
            }
        }

        appendPisiMissionPlanningControlsThirdRelease(card, mission, missions);
    });
}

function renderPisiTodoThirdKanban(list, missions) {
    const board = document.createElement('div');
    board.className = 'pisi-third-kanban';

    for (const status of PISI_TODO_STATUS_OPTIONS) {
        const column = document.createElement('section');
        column.className = 'pisi-third-kanban-column';
        column.dataset.status = status.value;
        const columnMissions = missions.filter((mission) => {
            return mission.effectiveStatus === status.value;
        });

        const header = document.createElement('header');
        header.innerHTML = `<span>${pisiTodoThirdTranslate(status.label)}</span><b>${columnMissions.length}</b>`;
        column.appendChild(header);

        const cards = document.createElement('div');
        cards.className = 'pisi-third-kanban-cards';
        for (const mission of columnMissions) {
            const card = makePisiThirdMissionButton(mission, 'pisi-third-kanban-card');
            card.dataset.missionId = mission.missionId;
            card.draggable = !mission.completed;
            if (mission.dependencyBlocked) card.classList.add('dependency-blocked');
            const meta = document.createElement('small');
            meta.textContent = getPisiMissionDateKeyThirdRelease(mission) || pisiTodoThirdTranslate('Tarihsiz');
            card.appendChild(meta);
            card.addEventListener('dragstart', (event) => {
                event.dataTransfer.setData('text/plain', mission.missionId);
                event.dataTransfer.effectAllowed = 'move';
            });
            cards.appendChild(card);
        }
        column.appendChild(cards);

        column.addEventListener('dragover', (event) => {
            event.preventDefault();
            column.classList.add('drag-over');
        });
        column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
        column.addEventListener('drop', async (event) => {
            event.preventDefault();
            column.classList.remove('drag-over');
            const missionId = event.dataTransfer.getData('text/plain');
            const mission = missions.find((item) => item.missionId === missionId);
            if (!mission || mission.status === status.value) return;
            const result = await window.setPisiMissionStatusFirstRelease?.(mission, status.value);
            if (!result?.ok) alert(result?.error || 'Görev durumu değiştirilemedi.');
            window.refreshPisiTagsPanelSoon?.();
        });

        board.appendChild(column);
    }

    list.replaceChildren(board);
}

function getPisiCalendarCursorDateThirdRelease() {
    const saved = pisiTodoThirdReleaseState.calendarCursor;
    if (/^\d{4}-\d{2}$/.test(saved || '')) {
        const [year, month] = saved.split('-').map(Number);
        return new Date(year, month - 1, 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
}

function setPisiCalendarCursorThirdRelease(date) {
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    pisiTodoThirdReleaseState.calendarCursor = value;
    savePisiTodoThirdPreference('calendar', value);
}

function renderPisiTodoThirdCalendar(list, missions) {
    const root = document.createElement('div');
    root.className = 'pisi-third-calendar';
    const cursor = getPisiCalendarCursorDateThirdRelease();

    const nav = document.createElement('div');
    nav.className = 'pisi-third-calendar-nav';
    const previous = makePisiThirdButton('‹', 'pisi-third-calendar-nav-button');
    const today = makePisiThirdButton('Bugün', 'pisi-third-calendar-today');
    const next = makePisiThirdButton('›', 'pisi-third-calendar-nav-button');
    const title = document.createElement('strong');
    title.textContent = cursor.toLocaleDateString('tr-TR', {
        month: 'long',
        year: 'numeric'
    });
    previous.addEventListener('click', () => {
        setPisiCalendarCursorThirdRelease(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
        schedulePisiTodoThirdReleaseApply(true);
    });
    today.addEventListener('click', () => {
        const now = new Date();
        setPisiCalendarCursorThirdRelease(new Date(now.getFullYear(), now.getMonth(), 1));
        schedulePisiTodoThirdReleaseApply(true);
    });
    next.addEventListener('click', () => {
        setPisiCalendarCursorThirdRelease(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
        schedulePisiTodoThirdReleaseApply(true);
    });
    nav.append(previous, today, title, next);
    root.appendChild(nav);

    const grid = document.createElement('div');
    grid.className = 'pisi-third-calendar-grid';
    for (const label of ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']) {
        const weekday = document.createElement('div');
        weekday.className = 'pisi-third-calendar-weekday';
        weekday.textContent = pisiTodoThirdTranslate(label);
        grid.appendChild(weekday);
    }

    const firstWeekday = (cursor.getDay() + 6) % 7;
    const firstCell = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - firstWeekday);
    const missionGroups = new Map();
    for (const mission of missions) {
        const key = getPisiMissionDateKeyThirdRelease(mission);
        if (!key) continue;
        if (!missionGroups.has(key)) missionGroups.set(key, []);
        missionGroups.get(key).push(mission);
    }

    for (let index = 0; index < 42; index += 1) {
        const date = new Date(firstCell);
        date.setDate(firstCell.getDate() + index);
        const key = getPisiTodayIsoDate(date);
        const day = document.createElement('div');
        day.className = 'pisi-third-calendar-day';
        day.classList.toggle('outside', date.getMonth() !== cursor.getMonth());
        day.classList.toggle('today', key === getPisiTodayIsoDate(new Date()));
        const number = document.createElement('span');
        number.className = 'pisi-third-calendar-day-number';
        number.textContent = String(date.getDate());
        day.appendChild(number);

        for (const mission of missionGroups.get(key) || []) {
            const item = makePisiThirdMissionButton(mission, 'pisi-third-calendar-task');
            item.dataset.status = mission.effectiveStatus;
            day.appendChild(item);
        }
        grid.appendChild(day);
    }

    root.appendChild(grid);
    const undated = missions.filter((mission) => !mission.finishDate);
    if (undated.length) {
        const tray = document.createElement('div');
        tray.className = 'pisi-third-undated-tray';
        const label = document.createElement('strong');
        label.textContent = `${pisiTodoThirdTranslate('Tarihsiz')} (${undated.length})`;
        tray.appendChild(label);
        undated.forEach((mission) => {
            tray.appendChild(makePisiThirdMissionButton(mission, 'pisi-third-undated-task'));
        });
        root.appendChild(tray);
    }

    list.replaceChildren(root);
}

function renderPisiTodoThirdTimeline(list, missions) {
    const root = document.createElement('div');
    root.className = 'pisi-third-timeline';
    const heading = document.createElement('header');
    heading.innerHTML = `<strong>${pisiTodoThirdTranslate('Önümüzdeki 30 gün')}</strong><span>${getPisiTodayIsoDate(new Date())}</span>`;
    root.appendChild(heading);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dated = missions.filter((mission) => mission.finishDate).sort((a, b) => String(a.finishDate).localeCompare(String(b.finishDate)));

    for (const mission of dated) {
        const due = new Date(mission.finishDate);
        due.setHours(0, 0, 0, 0);
        const dayOffset = Math.round((due.getTime() - today.getTime()) / 86400000);
        const position = (Math.max(0, Math.min(30, dayOffset)) / 30) * 100;
        const row = document.createElement('div');
        row.className = 'pisi-third-timeline-row';
        row.classList.toggle('overdue', dayOffset < 0);
        row.classList.toggle('dependency-blocked', mission.dependencyBlocked);

        const label = makePisiThirdMissionButton(mission, 'pisi-third-timeline-label');
        const track = document.createElement('div');
        track.className = 'pisi-third-timeline-track';
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'pisi-third-timeline-marker';
        marker.style.left = `${position}%`;
        marker.title = getPisiMissionDateKeyThirdRelease(mission);
        marker.addEventListener('click', () => window.openPisiTagBlockResult?.(mission));
        track.appendChild(marker);

        const date = document.createElement('time');
        date.textContent = getPisiMissionDateKeyThirdRelease(mission);
        row.append(label, track, date);
        root.appendChild(row);
    }

    const undated = missions.filter((mission) => !mission.finishDate);
    if (undated.length) {
        const tray = document.createElement('div');
        tray.className = 'pisi-third-undated-tray';
        const label = document.createElement('strong');
        label.textContent = `${pisiTodoThirdTranslate('Tarihsiz')} (${undated.length})`;
        tray.appendChild(label);
        undated.forEach((mission) => {
            tray.appendChild(makePisiThirdMissionButton(mission, 'pisi-third-undated-task'));
        });
        root.appendChild(tray);
    }

    list.replaceChildren(root);
}

function makePisiThirdStatCard(label, value, detail = '') {
    const card = document.createElement('div');
    card.className = 'pisi-third-stat-card';
    const number = document.createElement('strong');
    number.textContent = String(value);
    const title = document.createElement('span');
    title.textContent = pisiTodoThirdTranslate(label);
    card.append(number, title);
    if (detail) {
        const small = document.createElement('small');
        small.textContent = detail;
        card.appendChild(small);
    }
    return card;
}

function appendPisiThirdProgressRow(container, label, value, total) {
    const row = document.createElement('div');
    row.className = 'pisi-third-progress-row';
    const header = document.createElement('div');
    header.innerHTML = `<span>${pisiTodoThirdTranslate(label)}</span><b>${value}</b>`;
    const track = document.createElement('div');
    track.className = 'pisi-third-progress-track';
    const bar = document.createElement('span');
    bar.style.width = `${total ? Math.round((value / total) * 100) : 0}%`;
    track.appendChild(bar);
    row.append(header, track);
    container.appendChild(row);
}

function renderPisiTodoThirdStats(list, missions) {
    const root = document.createElement('div');
    root.className = 'pisi-third-stats';
    const total = missions.length;
    const completed = missions.filter((mission) => mission.completed).length;
    const open = total - completed;
    const blocked = missions.filter((mission) => {
        return !mission.completed && mission.dependencyBlocked;
    }).length;
    const overdue = missions.filter((mission) => {
        return !mission.completed && mission.dateBucket === 'overdue';
    }).length;
    const rate = total ? Math.round((completed / total) * 100) : 0;

    const cards = document.createElement('div');
    cards.className = 'pisi-third-stat-cards';
    cards.append(
        makePisiThirdStatCard('Toplam görev', total),
        makePisiThirdStatCard('Açık görev', open),
        makePisiThirdStatCard('Tamamlanan', completed, `%${rate}`),
        makePisiThirdStatCard('Bağımlılıktan bekleyen', blocked),
        makePisiThirdStatCard('Geciken', overdue)
    );
    root.appendChild(cards);

    const completion = document.createElement('section');
    completion.className = 'pisi-third-completion';
    completion.innerHTML = `<header><strong>${pisiTodoThirdTranslate('Genel ilerleme')}</strong><b>%${rate}</b></header>`;
    const track = document.createElement('div');
    track.className = 'pisi-third-completion-track';
    const bar = document.createElement('span');
    bar.style.width = `${rate}%`;
    track.appendChild(bar);
    completion.appendChild(track);
    root.appendChild(completion);

    const distributions = document.createElement('div');
    distributions.className = 'pisi-third-stat-distributions';
    const statuses = document.createElement('section');
    const statusTitle = document.createElement('strong');
    statusTitle.textContent = pisiTodoThirdTranslate('Durum dağılımı');
    statuses.appendChild(statusTitle);
    for (const status of PISI_TODO_STATUS_OPTIONS) {
        appendPisiThirdProgressRow(
            statuses,
            status.label,
            missions.filter((mission) => !mission.completed && mission.effectiveStatus === status.value).length,
            Math.max(1, open)
        );
    }

    const priorities = document.createElement('section');
    const priorityTitle = document.createElement('strong');
    priorityTitle.textContent = pisiTodoThirdTranslate('Öncelik dağılımı');
    priorities.appendChild(priorityTitle);
    for (let priority = 5; priority >= 1; priority -= 1) {
        appendPisiThirdProgressRow(
            priorities,
            `Öncelik ${priority}`,
            missions.filter((mission) => !mission.completed && mission.priority === priority).length,
            Math.max(1, open)
        );
    }
    distributions.append(statuses, priorities);
    root.appendChild(distributions);
    list.replaceChildren(root);
}

function renderPisiTodoThirdAlternativeView(list, visibleMissions, allMissions) {
    const view = pisiTodoThirdReleaseState.view;
    if (view === 'list') return false;
    list.dataset.pisiThirdView = view;

    if (!visibleMissions.length) {
        const empty = document.createElement('div');
        empty.className = 'right-panel-empty';
        empty.textContent = pisiTodoThirdTranslate('Bu görünümde görev yok.');
        list.replaceChildren(empty);
        return true;
    }

    if (view === 'kanban') renderPisiTodoThirdKanban(list, visibleMissions);
    if (view === 'calendar') renderPisiTodoThirdCalendar(list, visibleMissions);
    if (view === 'timeline') renderPisiTodoThirdTimeline(list, visibleMissions);
    if (view === 'stats') renderPisiTodoThirdStats(list, allMissions);
    return true;
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

function showPisiReminderBannerThirdRelease(mission) {
    const panel = document.getElementById('pisi-missions-panel');
    if (!panel) return;
    const existing = panel.querySelector(`.pisi-third-reminder-banner[data-mission-id="${CSS.escape(mission.missionId)}"]`);
    if (existing) return;

    const banner = document.createElement('div');
    banner.className = 'pisi-third-reminder-banner';
    banner.dataset.missionId = mission.missionId;
    const text = document.createElement('button');
    text.type = 'button';
    text.textContent = `${pisiTodoThirdTranslate('Hatırlatma')}: ${getPisiMissionTitleThirdRelease(mission)}`;
    text.addEventListener('click', () => window.openPisiTagBlockResult?.(mission));
    const close = makePisiThirdButton('×', 'pisi-third-reminder-close');
    close.addEventListener('click', () => banner.remove());
    banner.append(text, close);
    panel.prepend(banner);
}

function notifyPisiMissionThirdRelease(mission) {
    const title = pisiTodoThirdTranslate('Pisi görev hatırlatması');
    const body = `${getPisiMissionTitleThirdRelease(mission)} · ${getPisiMissionDateKeyThirdRelease(mission)}`;

    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(title, { body });
        notification.addEventListener('click', () => {
            window.focus();
            window.openPisiTagBlockResult?.(mission);
            notification.close();
        });
    } else {
        showPisiReminderBannerThirdRelease(mission);
    }
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
        appendPisiTodoThirdViewSwitcher(toolbar);
        const allMissions = getPisiThirdAllMissions();
        const visibleMissions = getPisiThirdVisibleMissions(allMissions);
        if (!renderPisiTodoThirdAlternativeView(list, visibleMissions, allMissions)) {
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
