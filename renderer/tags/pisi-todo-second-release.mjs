import { registerModule } from '../core/module-registry.mjs';
import {
    PISI_TODO_REPEAT_OPTIONS,
    PISI_TODO_SORT_OPTIONS,
    PISI_TODO_STATUS_FILTER_OPTIONS,
    formatPisiTodoTag,
    getNextPisiTodoDate,
    getPisiTodayIsoDate,
    getPisiTodoRepeatOption,
    getPisiTodoSortOption,
    getPisiTodoStatusFilterOption,
    parsePisiTodoTagValue
} from './pisi-todo-utils.mjs';

const pisiTodoSecondReleaseState = {
    projectKey: null,
    currentMissions: [],
    draggedMissionId: null
};

function pisiTodoSecondTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function normalizePisiSecondPath(value) {
    if (typeof window.normalizeClientPathForTags === 'function') {
        return window.normalizeClientPathForTags(value);
    }
    return String(value || '').replace(/[\\/]+/g, '/');
}

function makePisiMissionIdSecondRelease(mission = {}) {
    return [normalizePisiSecondPath(mission.nodePath), String(mission.blockId || ''), String(mission.todoTag || '')].map(encodeURIComponent).join('::');
}

// Public binding kept inert for module-manifest compatibility.
function getPisiSubtaskParentIdSecondRelease() {
    return '';
}

function getPisiTodoSecondProjectKey() {
    return normalizePisiSecondPath(window.currentProjectFolder || 'no-project');
}

function getPisiTodoSecondStorageKey() {
    return `pisiTodoSecondRelease:${encodeURIComponent(getPisiTodoSecondProjectKey())}`;
}

function ensurePisiTodoSecondPreferences() {
    const projectKey = getPisiTodoSecondProjectKey();
    const state = window.pisiTagsPanelState || {};

    if (pisiTodoSecondReleaseState.projectKey !== projectKey) {
        pisiTodoSecondReleaseState.projectKey = projectKey;
        try {
            const saved = JSON.parse(localStorage.getItem(getPisiTodoSecondStorageKey()) || 'null');
            state.missionSort = getPisiTodoSortOption(saved?.sort).value;
            state.missionStatusFilter = getPisiTodoStatusFilterOption(saved?.status).value;
        } catch {
            state.missionSort = getPisiTodoSortOption(state.missionSort).value;
            state.missionStatusFilter = getPisiTodoStatusFilterOption(state.missionStatusFilter).value;
        }
    }

    state.missionSort = getPisiTodoSortOption(state.missionSort).value;
    state.missionStatusFilter = getPisiTodoStatusFilterOption(state.missionStatusFilter).value;
    window.pisiTagsPanelState = state;
    return state;
}

function savePisiTodoSecondPreferences() {
    const state = ensurePisiTodoSecondPreferences();
    try {
        localStorage.setItem(
            getPisiTodoSecondStorageKey(),
            JSON.stringify({
                sort: state.missionSort,
                status: state.missionStatusFilter
            })
        );
    } catch {
        // Tercihler kaydedilemese de görev paneli çalışmaya devam eder.
    }
}

function enhancePisiMissionSecondRelease(mission, block = {}) {
    const rawOrder = Number(block.todoOrders?.[mission.todoTag]);
    const enhanced = {
        ...mission,
        repeat: getPisiTodoRepeatOption(block.todoRepeats?.[mission.todoTag]).value,
        completionOffsetDays: Number(block.todoCompletionOffsets?.[mission.todoTag]) || null,
        manualOrder: Number.isFinite(rawOrder) ? rawOrder : Number.POSITIVE_INFINITY
    };
    enhanced.missionId = makePisiMissionIdSecondRelease(enhanced);
    return enhanced;
}

function getPisiMissionComparatorSecondRelease(sortMode) {
    const mode = getPisiTodoSortOption(sortMode).value;
    const statusWeight = {
        doing: 0,
        todo: 1,
        waiting: 2,
        blocked: 3
    };

    return (a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;

        if (mode === 'manual') {
            const aOrder = Number.isFinite(a.manualOrder) ? a.manualOrder : Number.POSITIVE_INFINITY;
            const bOrder = Number.isFinite(b.manualOrder) ? b.manualOrder : Number.POSITIVE_INFINITY;
            if (aOrder !== bOrder) return aOrder - bOrder;
        }

        if (mode === 'date') {
            const aDate = a.finishDate?.getTime?.() ?? Number.POSITIVE_INFINITY;
            const bDate = b.finishDate?.getTime?.() ?? Number.POSITIVE_INFINITY;
            if (aDate !== bDate) return aDate - bDate;
        }

        if (mode === 'priority' && a.priority !== b.priority) {
            return b.priority - a.priority;
        }

        if (mode === 'status') {
            const difference = (statusWeight[a.status] ?? 9) - (statusWeight[b.status] ?? 9);
            if (difference) return difference;
        }

        const aFinite = Number.isFinite(a.workorder);
        const bFinite = Number.isFinite(b.workorder);
        if (aFinite !== bFinite) return aFinite ? -1 : 1;
        if (aFinite && a.workorder !== b.workorder) {
            return a.workorder - b.workorder;
        }

        const aDate = a.finishDate?.getTime?.() ?? Number.POSITIVE_INFINITY;
        const bDate = b.finishDate?.getTime?.() ?? Number.POSITIVE_INFINITY;
        if (aDate !== bDate) return aDate - bDate;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return String(a.missionId).localeCompare(String(b.missionId));
    };
}

function sortPisiMissionsSecondRelease(missions = []) {
    const state = ensurePisiTodoSecondPreferences();
    const sorted = missions
        .map((mission) => ({
            ...mission,
            missionId: mission.missionId || makePisiMissionIdSecondRelease(mission)
        }))
        .sort(getPisiMissionComparatorSecondRelease(state.missionSort));

    pisiTodoSecondReleaseState.currentMissions = sorted;
    return sorted;
}

function matchesPisiMissionStatusFilterSecondRelease(mission) {
    const state = ensurePisiTodoSecondPreferences();
    const filter = getPisiTodoStatusFilterOption(state.missionStatusFilter).value;
    return filter === 'all' || mission?.status === filter;
}

function makePisiSecondSelect(className, label, options, value) {
    const select = document.createElement('select');
    select.className = className;
    select.setAttribute('aria-label', pisiTodoSecondTranslate(label));
    for (const option of options) {
        const element = document.createElement('option');
        element.value = option.value;
        element.textContent = pisiTodoSecondTranslate(option.label);
        element.selected = option.value === value;
        select.appendChild(element);
    }
    return select;
}

function appendPisiMissionSecondReleaseToolbar({ toolbarRow, render }) {
    if (!toolbarRow) return;
    const state = ensurePisiTodoSecondPreferences();
    const controls = document.createElement('div');
    controls.className = 'pisi-missions-second-controls';

    const statusSelect = makePisiSecondSelect('pisi-missions-status-filter', 'Durum filtresi', PISI_TODO_STATUS_FILTER_OPTIONS, state.missionStatusFilter);
    const sortSelect = makePisiSecondSelect('pisi-missions-sort', 'Görev sıralama', PISI_TODO_SORT_OPTIONS, state.missionSort);

    statusSelect.addEventListener('change', () => {
        state.missionStatusFilter = getPisiTodoStatusFilterOption(statusSelect.value).value;
        savePisiTodoSecondPreferences();
        render?.();
    });
    sortSelect.addEventListener('change', () => {
        state.missionSort = getPisiTodoSortOption(sortSelect.value).value;
        savePisiTodoSecondPreferences();
        render?.();
    });

    controls.append(statusSelect, sortSelect);
    toolbarRow.appendChild(controls);
}

function findPisiMissionTagSecondRelease(block, mission) {
    const target = String(mission?.todoTag || '').toLowerCase();
    return (
        Array.from(block?.querySelectorAll?.('.pisi-user-tag[data-pisi-tag]') || []).find((element) => {
            return (
                String(element.dataset.pisiTag || element.textContent || '')
                    .trim()
                    .replace(/^(?:\.\.|\/|#)/, '')
                    .toLowerCase() === target
            );
        }) || null
    );
}

function findPisiMissionBlockSecondRelease(container, mission) {
    if (!container || !mission?.blockId) return null;
    return (
        Array.from(container.querySelectorAll?.('.pisi-editor-block[data-pisi-block-id]') || []).find((block) => {
            return block.dataset.pisiBlockId === mission.blockId && Boolean(findPisiMissionTagSecondRelease(block, mission));
        }) || null
    );
}

async function mutatePisiMissionDocumentSecondRelease(mission, mutate) {
    if (!mission?.nodePath) {
        return { ok: false, error: pisiTodoSecondTranslate('Görev node yolu bulunamadı.') };
    }

    const samePath = (path) => {
        return typeof window.samePisiPathForTags === 'function' ? window.samePisiPathForTags(path, mission.nodePath) : path === mission.nodePath;
    };

    const applyEditor = async (editor, save) => {
        if (!editor) {
            return { ok: false, error: pisiTodoSecondTranslate('Görev editörü bulunamadı.') };
        }
        const previousHtml = editor.innerHTML;
        const block = findPisiMissionBlockSecondRelease(editor, mission);
        if (!block) {
            return { ok: false, error: pisiTodoSecondTranslate('Görev bloğu bulunamadı.') };
        }
        const changed = mutate(block, editor) !== false;
        if (!changed) return { ok: true, unchanged: true };
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        const result = await save();
        if (!result?.ok) {
            editor.innerHTML = previousHtml;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            return {
                ok: false,
                error: result?.error || pisiTodoSecondTranslate('Node kaydedilemedi.')
            };
        }
        return { ok: true };
    };

    if (samePath(window.activeCenterNode?.path)) {
        const editor = document.getElementById('center-node-editor-content');
        return applyEditor(editor, async () => {
            if (typeof window.saveCurrentCenterNodeEditor === 'function') {
                const ok = await window.saveCurrentCenterNodeEditor();
                return {
                    ok,
                    error: ok ? '' : pisiTodoSecondTranslate('Node kaydedilemedi.')
                };
            }
            return window.pisiProject?.saveNodeContent?.(
                mission.nodePath,
                typeof window.getPisiEditorContent === 'function' ? window.getPisiEditorContent(editor) : editor.innerHTML
            );
        });
    }

    if (samePath(window.activeModalNode?.path)) {
        const editor = document.getElementById('node-modal-content');
        const result = await applyEditor(editor, () => {
            return window.pisiProject?.saveNodeContent?.(
                mission.nodePath,
                typeof window.getPisiEditorContent === 'function' ? window.getPisiEditorContent(editor) : editor.innerHTML
            );
        });
        if (result?.ok && window.activeModalNode) window.activeModalNode.dirty = false;
        return result;
    }

    const doc = await window.pisiProject?.getPisiDocument?.(mission.nodePath);
    if (!doc?.ok) {
        return {
            ok: false,
            error: doc?.error || pisiTodoSecondTranslate('Node okunamadı.')
        };
    }
    const template = document.createElement('template');
    template.innerHTML = String(doc.data?.content || '');
    const block = findPisiMissionBlockSecondRelease(template.content, mission);
    if (!block) {
        return { ok: false, error: pisiTodoSecondTranslate('Görev bloğu bulunamadı.') };
    }
    const changed = mutate(block, template.content) !== false;
    if (!changed) return { ok: true, unchanged: true };
    const result = await window.pisiProject?.saveNodeContent?.(mission.nodePath, template.innerHTML);
    return result?.ok
        ? { ok: true }
        : {
              ok: false,
              error: result?.error || pisiTodoSecondTranslate('Node kaydedilemedi.')
          };
}

async function setPisiMissionRepeatSecondRelease(mission, repeatValue) {
    const repeat = getPisiTodoRepeatOption(repeatValue).value;
    const result = await window.savePisiMissionMutationFirstRelease?.(mission, (block) => {
        const tag = findPisiMissionTagSecondRelease(block, mission);
        if (!tag) {
            return { changed: false, missing: true, previousHtml: block.innerHTML };
        }
        const previousHtml = block.innerHTML;
        if ((tag.dataset.pisiTodoRepeat || 'none') === repeat) {
            return { changed: false, unchanged: true, previousHtml };
        }
        tag.dataset.pisiTodoRepeat = repeat;
        return { changed: true, previousHtml };
    });
    return (
        result || {
            ok: false,
            error: pisiTodoSecondTranslate('Tekrar ayarı kaydedilemedi.')
        }
    );
}

async function setPisiMissionOrderSecondRelease(mission, order) {
    const normalizedOrder = Math.max(0, Math.min(1000000, Number(order) || 0));
    const result = await window.savePisiMissionMutationFirstRelease?.(mission, (block) => {
        const tag = findPisiMissionTagSecondRelease(block, mission);
        if (!tag) {
            return { changed: false, missing: true, previousHtml: block.innerHTML };
        }
        const previousHtml = block.innerHTML;
        tag.dataset.pisiTodoOrder = String(normalizedOrder);
        return { changed: true, previousHtml };
    });
    return (
        result || {
            ok: false,
            error: pisiTodoSecondTranslate('Görev sırası kaydedilemedi.')
        }
    );
}

// Public binding kept inert for module-manifest compatibility.
async function addPisiSubtaskSecondRelease() {
    return {
        ok: false,
        removed: true,
        error: pisiTodoSecondTranslate('Alt görev sistemi kaldırıldı; bunun yerine alt node içinde görev oluşturun.')
    };
}

async function createNextPisiRecurringMissionSecondRelease(mission) {
    const repeat = getPisiTodoRepeatOption(mission.repeat).value;
    if (repeat === 'none') return { ok: true, skipped: true };
    const todo = parsePisiTodoTagValue(mission.todoTag);
    const nextDate = getNextPisiTodoDate(todo?.finishDate, repeat, new Date(), mission.completionOffsetDays);
    if (!nextDate) {
        return {
            ok: false,
            error: pisiTodoSecondTranslate('Sonraki tekrar tarihi hesaplanamadı.')
        };
    }
    const nextTag = formatPisiTodoTag(mission.priority, getPisiTodayIsoDate(nextDate));
    if (!nextTag) {
        return {
            ok: false,
            error: pisiTodoSecondTranslate('Sonraki görev etiketi oluşturulamadı.')
        };
    }

    return mutatePisiMissionDocumentSecondRelease(mission, (block) => {
        const clone = block.cloneNode(true);
        clone.dataset.pisiBlockId =
            typeof window.makePisiBlockId === 'function' ? window.makePisiBlockId() : `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        clone.classList.remove('pisi-block-highlight');
        clone.querySelectorAll('.pisi-user-tag[data-pisi-tag]').forEach((tag) => {
            const value = String(tag.dataset.pisiTag || tag.textContent || '')
                .replace(/^(?:\.\.|\/|#)/, '')
                .toLowerCase();
            if (value === 'done') {
                tag.remove();
                return;
            }
            if (value === mission.todoTag) {
                tag.dataset.pisiTag = nextTag;
                tag.dataset.pisiTodoStatus = 'todo';
                tag.dataset.pisiTodoRepeat = repeat;
                tag.dataset.pisiTodoScheduledAt = getPisiTodayIsoDate(nextDate);
                tag.dataset.pisiTodoOrder = String(Number.isFinite(mission.manualOrder) ? mission.manualOrder + 1 : Date.now());
                delete tag.dataset.pisiTodoParent;
                tag.textContent = nextTag;
            }
        });
        clone.querySelectorAll('.pisi-todo-source[data-pisi-todo-for]').forEach((source) => {
            if (String(source.dataset.pisiTodoFor || '').toLowerCase() === mission.todoTag) {
                source.dataset.pisiTodoFor = nextTag;
            }
            source.classList.remove('pisi-todo-source-highlight');
        });
        block.after(clone);
        return true;
    });
}

async function togglePisiMissionCompletionSecondRelease(mission, completed) {
    if (!completed) {
        return (
            window.reopenPisiMission?.(mission) || {
                ok: false,
                error: pisiTodoSecondTranslate('Görev yeniden açılamadı.')
            }
        );
    }

    if (getPisiTodoRepeatOption(mission.repeat).value !== 'none') {
        const recurrence = await createNextPisiRecurringMissionSecondRelease(mission);
        if (!recurrence?.ok) return recurrence;
    }

    return (
        window.markPisiMissionDone?.(mission) || {
            ok: false,
            error: pisiTodoSecondTranslate('Görev tamamlanamadı.')
        }
    );
}

async function persistPisiMissionManualOrderSecondRelease(missions = []) {
    for (let index = 0; index < missions.length; index += 1) {
        const result = await setPisiMissionOrderSecondRelease(missions[index], (index + 1) * 100);
        if (!result?.ok) return result;
    }
    window.refreshPisiTagsPanelSoon?.();
    return { ok: true };
}

function bindPisiMissionDragSecondRelease({ card, mission, list }) {
    const state = ensurePisiTodoSecondPreferences();
    if (state.missionSort !== 'manual') return;

    const handle = card.querySelector('.pisi-mission-drag-handle');
    if (!handle) return;
    handle.draggable = true;

    handle.addEventListener('dragstart', (event) => {
        pisiTodoSecondReleaseState.draggedMissionId = mission.missionId;
        card.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', mission.missionId);
    });
    handle.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        pisiTodoSecondReleaseState.draggedMissionId = null;
        list.querySelectorAll('.pisi-mission-card').forEach((item) => {
            item.classList.remove('drag-over');
        });
    });

    card.addEventListener('dragover', (event) => {
        if (!pisiTodoSecondReleaseState.draggedMissionId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', async (event) => {
        event.preventDefault();
        card.classList.remove('drag-over');
        const draggedId = pisiTodoSecondReleaseState.draggedMissionId;
        const draggedCard = Array.from(list.querySelectorAll('.pisi-mission-card')).find((item) => item.dataset.missionId === draggedId);
        if (!draggedCard || draggedCard === card) return;

        const rect = card.getBoundingClientRect();
        const before = event.clientY < rect.top + rect.height / 2;
        list.insertBefore(draggedCard, before ? card : card.nextSibling);

        const ordered = Array.from(list.querySelectorAll('.pisi-mission-card'))
            .map((item) =>
                pisiTodoSecondReleaseState.currentMissions.find((candidate) => {
                    return candidate.missionId === item.dataset.missionId;
                })
            )
            .filter(Boolean);
        const result = await persistPisiMissionManualOrderSecondRelease(ordered);
        if (!result?.ok) {
            alert(result?.error || pisiTodoSecondTranslate('Görev sırası kaydedilemedi.'));
        }
    });
}

function enhancePisiMissionCardSecondRelease({ card, mission, list }) {
    if (!card || !mission) return;
    const state = ensurePisiTodoSecondPreferences();
    card.dataset.missionId = mission.missionId;

    const top = card.querySelector('.pisi-mission-top');
    if (!top) return;
    const actions = document.createElement('div');
    actions.className = 'pisi-mission-second-actions';

    const repeat = makePisiSecondSelect('pisi-mission-repeat', 'Tekrarlama', PISI_TODO_REPEAT_OPTIONS, mission.repeat);
    repeat.disabled = mission.completed === true;
    repeat.addEventListener('click', (event) => event.stopPropagation());
    repeat.addEventListener('change', async (event) => {
        event.stopPropagation();
        repeat.disabled = true;
        const result = await setPisiMissionRepeatSecondRelease(mission, repeat.value);
        if (!result?.ok) {
            repeat.value = mission.repeat;
            alert(result?.error || pisiTodoSecondTranslate('Tekrar ayarı kaydedilemedi.'));
        }
        window.refreshPisiTagsPanelSoon?.();
    });
    actions.appendChild(repeat);

    if (state.missionSort === 'manual') {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'pisi-mission-drag-handle';
        handle.title = pisiTodoSecondTranslate('Sürükleyerek sırala');
        handle.setAttribute('aria-label', handle.title);
        handle.textContent = '⋮⋮';
        handle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        actions.appendChild(handle);
    }

    top.appendChild(actions);
    bindPisiMissionDragSecondRelease({ card, mission, list });
}

const moduleApi = {
    pisiTodoSecondReleaseState,
    makePisiMissionIdSecondRelease,
    getPisiSubtaskParentIdSecondRelease,
    enhancePisiMissionSecondRelease,
    sortPisiMissionsSecondRelease,
    matchesPisiMissionStatusFilterSecondRelease,
    appendPisiMissionSecondReleaseToolbar,
    enhancePisiMissionCardSecondRelease,
    setPisiMissionRepeatSecondRelease,
    setPisiMissionOrderSecondRelease,
    addPisiSubtaskSecondRelease,
    createNextPisiRecurringMissionSecondRelease,
    togglePisiMissionCompletionSecondRelease,
    persistPisiMissionManualOrderSecondRelease
};

registerModule('tags.todoSecondRelease', moduleApi);

export {
    pisiTodoSecondReleaseState,
    makePisiMissionIdSecondRelease,
    getPisiSubtaskParentIdSecondRelease,
    enhancePisiMissionSecondRelease,
    sortPisiMissionsSecondRelease,
    matchesPisiMissionStatusFilterSecondRelease,
    appendPisiMissionSecondReleaseToolbar,
    enhancePisiMissionCardSecondRelease,
    setPisiMissionRepeatSecondRelease,
    setPisiMissionOrderSecondRelease,
    addPisiSubtaskSecondRelease,
    createNextPisiRecurringMissionSecondRelease,
    togglePisiMissionCompletionSecondRelease,
    persistPisiMissionManualOrderSecondRelease
};
