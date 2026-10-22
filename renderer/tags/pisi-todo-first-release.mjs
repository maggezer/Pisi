import { registerModule } from '../core/module-registry.mjs';
import {
    PISI_TODO_FILTER_OPTIONS,
    PISI_TODO_STATUS_OPTIONS,
    getPisiTodoStatusOption,
    matchesPisiTodoFilter,
    parsePisiTodoTagValue
} from './pisi-todo-utils.mjs';

function pisiTodoTranslateFirstRelease(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function formatPisiMissionDateFirstRelease(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return pisiTodoTranslateFirstRelease('Tarihsiz');
    }
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}-${month}-${date.getFullYear()}`;
}

function getPisiMissionsFromIndexFirstRelease(options = {}) {
    const missions = [];
    const includeCompleted = options.includeCompleted === true;
    const sourceIndex = Array.isArray(pisiTagsPanelState.missionIndex) ? pisiTagsPanelState.missionIndex : [];

    for (const block of sourceIndex) {
        const doneFor = new Set((Array.isArray(block.doneFor) ? block.doneFor : []).map(normalizePisiUserTag));
        const todoStates = block.todoStates || {};
        const todoSources = block.todoSources || {};

        for (const tag of Array.isArray(block.tags) ? block.tags : []) {
            const todo = parsePisiTodoTagValue(normalizePisiUserTag(tag));
            if (!todo) continue;
            const completed = doneFor.has(todo.tag);
            if (completed && !includeCompleted) continue;
            const status = getPisiTodoStatusOption(todoStates[todo.tag]);
            const mission = {
                ...block,
                todoTag: todo.tag,
                priority: todo.priority,
                priorityLabel: todo.priorityLabel,
                rawPriority: todo.rawPriority,
                finishDate: todo.finishDate,
                daysLeft: todo.daysLeft,
                dateBucket: todo.dateBucket,
                workorder: todo.workorder,
                status: status.value,
                statusLabel: status.label,
                sourceText: String(todoSources[todo.tag] || '').trim(),

                completed
            };
            missions.push(typeof window.enhancePisiMissionSecondRelease === 'function' ? window.enhancePisiMissionSecondRelease(mission, block) : mission);
        }
    }

    missions.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        const aFinite = Number.isFinite(a.workorder);
        const bFinite = Number.isFinite(b.workorder);
        if (aFinite !== bFinite) return aFinite ? -1 : 1;
        if (aFinite && a.workorder !== b.workorder) return a.workorder - b.workorder;
        const aDate = a.finishDate?.getTime?.() ?? Number.POSITIVE_INFINITY;
        const bDate = b.finishDate?.getTime?.() ?? Number.POSITIVE_INFINITY;
        return aDate !== bDate ? aDate - bDate : b.priority - a.priority;
    });
    return typeof window.sortPisiMissionsSecondRelease === 'function' ? window.sortPisiMissionsSecondRelease(missions) : missions;
}

function escapePisiTodoRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPisiMissionDisplayTextFirstRelease(mission) {
    if (String(mission?.sourceText || '').trim()) {
        return String(mission.sourceText).replace(/\s+/g, ' ').trim();
    }
    let text = String(mission?.text || '')
        .replace(/^[☐☑]\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (mission?.todoTag) {
        text = text.replace(new RegExp(`(^|\\s)(?:#|\\.\\.)?${escapePisiTodoRegExp(mission.todoTag)}(?=\\s|$)`, 'gi'), ' ');
    }
    return text
        .replace(/(^|\s)(?:#|\.\.)?todo\.[1-9]\.(?:\d{2}-\d{2}-(?:\d{2}|\d{4})|none)(?=\s|$)/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getPisiMissionFilterCountsFirstRelease(missions) {
    const counts = new Map(PISI_TODO_FILTER_OPTIONS.map((item) => [item.value, 0]));
    counts.set('all', missions.length);
    for (const mission of missions) {
        if (counts.has(mission.dateBucket)) {
            counts.set(mission.dateBucket, (counts.get(mission.dateBucket) || 0) + 1);
        }
    }
    return counts;
}

function removePisiMissionBadgesFirstRelease() {
    document.querySelectorAll('.pisi-mission-node-badge, .pisi-mission-tree-badge-host').forEach((element) => element.remove());
}

function syncPisiMissionBadgesFirstRelease(missions = []) {
    removePisiMissionBadgesFirstRelease();
    const counts = new Map();
    for (const mission of missions) {
        if (mission.completed || !mission.nodePath) continue;
        const key = normalizeClientPathForTags(mission.nodePath);
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    const makeBadge = (count) => {
        const badge = document.createElement('span');
        badge.className = 'pisi-mission-node-badge';
        badge.textContent = String(count);
        badge.title = pisiTodoTranslateFirstRelease(`Açık görev: ${count}`);
        return badge;
    };

    document.querySelectorAll('.map-node-box[data-node-path]').forEach((box) => {
        const count = counts.get(normalizeClientPathForTags(box.dataset.nodePath));
        if (count) box.appendChild(makeBadge(count));
    });

    document.querySelectorAll('.tree-node[data-path]').forEach((treeNode) => {
        const count = counts.get(normalizeClientPathForTags(treeNode.dataset.path));
        if (!count) return;
        const row = Array.from(treeNode.children).find((child) => {
            return child.classList?.contains('tree-row');
        });
        if (!row) return;
        const host = document.createElement('span');
        host.className = 'pisi-mission-tree-badge-host';
        host.appendChild(makeBadge(count));
        const actions = row.querySelector('.tree-row-actions');
        if (actions) row.insertBefore(host, actions);
        else row.appendChild(host);
    });
}

function closePisiMissionFilterMenuFirstRelease() {
    pisiTagsPanelState.missionFilterOpen = false;

    const trigger = document.querySelector('.pisi-missions-filter-trigger');
    const popover = document.querySelector('.pisi-missions-filter-popover');

    trigger?.setAttribute('aria-expanded', 'false');
    if (popover) popover.hidden = true;
}

function bindPisiMissionFilterOutsideCloseFirstRelease() {
    if (window.__pisiMissionFilterOutsideBound === true) return;
    window.__pisiMissionFilterOutsideBound = true;

    document.addEventListener('mousedown', (event) => {
        if (!pisiTagsPanelState?.missionFilterOpen) return;
        if (event.target.closest('.pisi-missions-filter-menu')) return;
        closePisiMissionFilterMenuFirstRelease();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!pisiTagsPanelState?.missionFilterOpen) return;
        closePisiMissionFilterMenuFirstRelease();
    });
}

function refreshPisiMissionsFirstRelease(reason = 'manual') {
    if (typeof window.refreshPisiMissionIndex === 'function') {
        return window.refreshPisiMissionIndex({ force: true, reason });
    }
    window.refreshPisiTagsPanelSoon?.();
    return Promise.resolve(null);
}

function renderPisiMissionsPanelFirstRelease() {
    const panel = document.getElementById('pisi-missions-panel');
    const list = document.getElementById('pisi-missions-list');
    if (!panel || !list) return;
    let toolbar = panel.querySelector('.pisi-missions-toolbar');
    if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.className = 'pisi-missions-toolbar';
        panel.insertBefore(toolbar, list);
    }

    if (!window.currentProjectFolder) {
        toolbar.innerHTML = '';
        pisiTagsPanelState.missionFilterOpen = false;
        list.innerHTML = '<div class="right-panel-empty">Missions için önce bir proje klasörü seç.</div>';
        removePisiMissionBadgesFirstRelease();
        return;
    }

    const allMissions = getPisiMissionsFromIndexFirstRelease({ includeCompleted: true });
    const completedCount = allMissions.filter((mission) => mission.completed).length;
    const showCompleted = pisiTagsPanelState.showCompletedMissions === true;
    const filter = PISI_TODO_FILTER_OPTIONS.some((item) => {
        return item.value === pisiTagsPanelState.missionFilter;
    })
        ? pisiTagsPanelState.missionFilter
        : 'all';
    pisiTagsPanelState.missionFilter = filter;
    const completionFiltered = showCompleted ? allMissions : allMissions.filter((mission) => !mission.completed);
    const counts = getPisiMissionFilterCountsFirstRelease(completionFiltered);
    const missions = completionFiltered.filter((mission) => {
        return (
            matchesPisiTodoFilter(mission, filter) &&
            (typeof window.matchesPisiMissionStatusFilterSecondRelease !== 'function' || window.matchesPisiMissionStatusFilterSecondRelease(mission))
        );
    });

    toolbar.innerHTML = '';
    bindPisiMissionFilterOutsideCloseFirstRelease();

    const toolbarRow = document.createElement('div');
    toolbarRow.className = 'pisi-missions-toolbar-row';

    const activeFilterOption =
        PISI_TODO_FILTER_OPTIONS.find((option) => {
            return option.value === filter;
        }) || PISI_TODO_FILTER_OPTIONS[0];
    const filterMenu = document.createElement('div');
    filterMenu.className = 'pisi-missions-filter-menu';

    const filterTrigger = document.createElement('button');
    filterTrigger.type = 'button';
    filterTrigger.className = 'pisi-missions-filter-trigger';
    filterTrigger.setAttribute('aria-haspopup', 'menu');
    filterTrigger.setAttribute('aria-expanded', pisiTagsPanelState.missionFilterOpen === true ? 'true' : 'false');
    filterTrigger.innerHTML =
        `<span>${pisiTodoTranslateFirstRelease(activeFilterOption.label)}</span>` +
        `<span class="pisi-missions-filter-trigger-count">${counts.get(filter) || 0}</span>`;

    const filterPopover = document.createElement('div');
    filterPopover.className = 'pisi-missions-filter-popover';
    filterPopover.setAttribute('role', 'menu');
    filterPopover.hidden = pisiTagsPanelState.missionFilterOpen !== true;

    for (const option of PISI_TODO_FILTER_OPTIONS) {
        const optionButton = document.createElement('button');
        const isActive = option.value === filter;
        optionButton.type = 'button';
        optionButton.className = 'pisi-missions-filter-option';
        optionButton.classList.toggle('active', isActive);
        optionButton.setAttribute('role', 'menuitemradio');
        optionButton.setAttribute('aria-checked', isActive ? 'true' : 'false');
        optionButton.innerHTML =
            `<span class="pisi-missions-filter-check">${isActive ? '✓' : ''}</span>` +
            `<span class="pisi-missions-filter-label">${pisiTodoTranslateFirstRelease(option.label)}</span>` +
            `<span class="pisi-missions-filter-count">${counts.get(option.value) || 0}</span>`;
        optionButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            pisiTagsPanelState.missionFilter = option.value;
            pisiTagsPanelState.missionFilterOpen = false;
            renderPisiMissionsPanelFirstRelease();
        });
        filterPopover.appendChild(optionButton);
    }

    filterTrigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const open = pisiTagsPanelState.missionFilterOpen !== true;
        pisiTagsPanelState.missionFilterOpen = open;
        filterTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        filterPopover.hidden = !open;
    });

    filterMenu.append(filterTrigger, filterPopover);
    toolbarRow.appendChild(filterMenu);
    if (typeof window.appendPisiMissionSecondReleaseToolbar === 'function') {
        window.appendPisiMissionSecondReleaseToolbar({
            toolbarRow,
            allMissions: completionFiltered,
            render: renderPisiMissionsPanelFirstRelease
        });
    }

    const completedToggle = document.createElement('button');
    completedToggle.type = 'button';
    completedToggle.className = 'pisi-missions-completed-toggle';
    completedToggle.setAttribute('aria-pressed', showCompleted ? 'true' : 'false');
    completedToggle.textContent = pisiTodoTranslateFirstRelease(
        showCompleted ? `Tamamlananları gizle (${completedCount})` : `Tamamlananları göster (${completedCount})`
    );
    completedToggle.disabled = completedCount === 0;
    completedToggle.addEventListener('click', () => {
        pisiTagsPanelState.showCompletedMissions = !showCompleted;
        pisiTagsPanelState.missionFilterOpen = false;
        renderPisiMissionsPanelFirstRelease();
    });
    toolbarRow.appendChild(completedToggle);
    toolbar.appendChild(toolbarRow);
    syncPisiMissionBadgesFirstRelease(allMissions);

    if (!missions.length) {
        const message = filter === 'all' ? (showCompleted ? 'Bu projede görev yok.' : 'Bu projede açık görev yok.') : 'Bu filtrede görev yok.';
        list.innerHTML = `<div class="right-panel-empty">${pisiTodoTranslateFirstRelease(message)}</div>`;
        return;
    }

    list.innerHTML = '';
    for (const mission of missions) {
        const card = document.createElement('div');
        card.className = 'pisi-mission-card';
        card.dataset.status = mission.status;
        card.dataset.dateBucket = mission.dateBucket;
        card.dataset.missionId = mission.missionId || '';
        card.dataset.parentId = mission.parentId || '';
        card.classList.toggle('completed', mission.completed === true);
        const workorder = Number.isFinite(mission.workorder) ? mission.workorder.toFixed(2) : '—';
        const location = mission.mapTitle ? `${mission.mapTitle} › ${mission.nodeTitle}` : mission.nodeTitle;
        const statusOptions = PISI_TODO_STATUS_OPTIONS.map((option) => {
            const selected = option.value === mission.status ? ' selected' : '';
            return `<option value="${option.value}"${selected}>${pisiTodoTranslateFirstRelease(option.label)}</option>`;
        }).join('');

        card.innerHTML = `
            <label class="pisi-mission-check-wrap" title="Tamamlandı olarak işaretle">
                <input class="pisi-mission-check" type="checkbox">
            </label>
            <div class="pisi-mission-content">
                <div class="pisi-mission-top">
                    <select class="pisi-mission-status" aria-label="Görev durumu">${statusOptions}</select>
                </div>
                <button class="pisi-mission-main" type="button">
                    <div class="pisi-mission-text">${escapeHtml(getPisiMissionDisplayTextFirstRelease(mission) || '(boş blok)')}</div>
                    <div class="pisi-mission-meta">
                        <span class="${mission.dateBucket === 'overdue' ? 'late' : ''}">${formatPisiMissionDateFirstRelease(mission.finishDate)}</span>
                        <span class="pisi-mission-priority" data-priority="${mission.priority}">${pisiTodoTranslateFirstRelease(`Öncelik: ${mission.priority}`)} · ${pisiTodoTranslateFirstRelease(mission.priorityLabel)}</span>
                        <span>${pisiTodoTranslateFirstRelease(`Sıra: ${workorder}`)}</span>
                    </div>
                    <div class="pisi-mission-node" title="${escapeHtml(location)}">${escapeHtml(location)}</div>
                </button>
            </div>`;

        if (typeof window.enhancePisiMissionCardSecondRelease === 'function') {
            window.enhancePisiMissionCardSecondRelease({
                card,
                mission,
                missions,
                list,
                render: renderPisiMissionsPanelFirstRelease
            });
        }

        const checkbox = card.querySelector('.pisi-mission-check');
        const mainButton = card.querySelector('.pisi-mission-main');
        const statusSelect = card.querySelector('.pisi-mission-status');
        checkbox.checked = mission.completed === true;
        checkbox.title = mission.completed ? 'Görevi yeniden aç' : 'Tamamlandı olarak işaretle';
        statusSelect.disabled = mission.completed === true;

        checkbox.addEventListener('click', async (event) => {
            event.stopPropagation();
            checkbox.disabled = true;
            const result =
                typeof window.togglePisiMissionCompletionSecondRelease === 'function'
                    ? await window.togglePisiMissionCompletionSecondRelease(mission, checkbox.checked)
                    : checkbox.checked
                      ? await markPisiMissionDone(mission)
                      : await reopenPisiMission(mission);
            if (!result?.ok) {
                checkbox.checked = mission.completed === true;
                checkbox.disabled = false;
                alert(result?.error || (mission.completed ? 'Görev yeniden açılamadı.' : 'Görev tamamlandı olarak işaretlenemedi.'));
                return;
            }
            await refreshPisiMissionsFirstRelease('completion-change');
        });

        statusSelect.addEventListener('click', (event) => event.stopPropagation());
        statusSelect.addEventListener('change', async (event) => {
            event.stopPropagation();
            const previous = mission.status;
            statusSelect.disabled = true;
            const result = await setPisiMissionStatusFirstRelease(mission, statusSelect.value);
            if (!result?.ok) {
                statusSelect.value = previous;
                statusSelect.disabled = false;
                alert(result?.error || 'Görev durumu değiştirilemedi.');
                return;
            }
            await refreshPisiMissionsFirstRelease('status-change');
        });
        mainButton.addEventListener('click', () => openPisiTagBlockResult(mission));
        list.appendChild(card);
    }
}

function createPisiUserTagElement(rawTag, options = {}) {
    const tag = normalizePisiUserTag(rawTag);
    const element = document.createElement('span');
    element.className = 'pisi-user-tag';
    element.dataset.pisiTag = tag;
    element.contentEditable = 'false';
    element.textContent = tag;
    if (/^todo\./i.test(tag)) {
        element.classList.add('pisi-task-metadata');
        element.setAttribute('aria-hidden', 'true');
        element.dataset.pisiTodoStatus = String(options.status || 'todo').toLowerCase();
        element.dataset.pisiTodoRepeat = String(options.repeat || 'none').toLowerCase();
    }
    return element;
}

function getPisiSelectionTextOffset(block, container, offset) {
    const range = document.createRange();
    range.selectNodeContents(block);
    range.setEnd(container, offset);
    return range.toString().length;
}

function capturePisiTodoSelection(editor) {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
    const startBlock = getPisiCurrentEditorBlock(editor, range.startContainer);
    const endBlock = getPisiCurrentEditorBlock(editor, range.endContainer);
    if (!startBlock || startBlock !== endBlock || startBlock === editor) return null;
    const fragment = range.cloneContents();
    if (fragment.querySelector?.('.pisi-user-tag, .pisi-todo-source')) return null;
    const selectedText = range.toString().replace(/\s+/g, ' ').trim();
    if (!selectedText) return null;
    return {
        editor,
        block: startBlock,
        sourceSelection: true,
        selectedText,
        selectionStartInText: getPisiSelectionTextOffset(startBlock, range.startContainer, range.startOffset),
        selectionEndInText: getPisiSelectionTextOffset(startBlock, range.endContainer, range.endOffset)
    };
}

function applyPisiTodoSelectionToEditor(editor, todoTag, command) {
    if (!command?.block || !todoTag) return;
    const range = makeRangeInElementByTextOffsets(command.block, command.selectionStartInText, command.selectionEndInText);
    if (!range || range.collapsed) return;
    const source = document.createElement('span');
    source.className = 'pisi-todo-source';
    source.dataset.pisiTodoFor = todoTag;
    source.appendChild(range.extractContents());
    range.insertNode(source);
    command.block.appendChild(document.createTextNode(' '));
    command.block.appendChild(createPisiUserTagElement(todoTag, { status: 'todo' }));
    command.block.appendChild(document.createTextNode(' '));
    PISI_USER_TAG_CACHE.add(todoTag);
    closePisiTagMenu();
    editor.focus();
    placeCaretAtEnd(command.block);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function findPisiMissionTodoTagElementFirstRelease(block, mission) {
    const target = normalizePisiUserTag(mission?.todoTag).toLowerCase();
    return (
        Array.from(block?.querySelectorAll?.('.pisi-user-tag[data-pisi-tag]') || []).find(
            (element) => normalizePisiUserTag(element.dataset.pisiTag || element.textContent || '').toLowerCase() === target
        ) || null
    );
}

function setPisiMissionStatusInBlockFirstRelease(block, mission, status) {
    const tag = findPisiMissionTodoTagElementFirstRelease(block, mission);
    if (!tag) return { changed: false, previousHtml: block?.innerHTML || '', missing: true };
    const previousHtml = block.innerHTML;
    const normalized = getPisiTodoStatusOption(status).value;
    const current = getPisiTodoStatusOption(tag.dataset.pisiTodoStatus || 'todo').value;
    if (current === normalized && tag.dataset.pisiTodoStatus) {
        return { changed: false, previousHtml, unchanged: true };
    }
    tag.dataset.pisiTodoStatus = normalized;
    return { changed: true, previousHtml };
}

async function savePisiMissionMutationFirstRelease(mission, mutateBlock) {
    if (!mission?.nodePath) return { ok: false, error: 'Görev node yolu bulunamadı.' };

    const applyEditor = async (editor, save) => {
        const block = findPisiMissionBlockInContainer(editor, mission);
        if (!block) return { ok: false, error: 'Görev bloğu bulunamadı.' };
        const change = mutateBlock(block);
        if (change.missing) return { ok: false, error: 'Görev etiketi bulunamadı.' };
        if (!change.changed) return { ok: true, unchanged: true };
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        const result = await save();
        if (!result?.ok) {
            rollbackPisiMissionBlock(block, change.previousHtml);
            await refreshPisiMissionsFirstRelease('mutation-rollback');
            return { ok: false, error: result?.error || 'Node kaydedilemedi.' };
        }
        return { ok: true };
    };

    if (samePisiPathForTags(activeCenterNode?.path, mission.nodePath)) {
        const editor = document.getElementById('center-node-editor-content');
        return applyEditor(editor, async () => {
            if (typeof saveCurrentCenterNodeEditor === 'function') {
                const ok = await saveCurrentCenterNodeEditor();
                return { ok, error: ok ? '' : 'Node kaydedilemedi.' };
            }
            return window.pisiProject?.saveNodeContent?.(mission.nodePath, getPisiEditorContent(editor));
        });
    }

    if (samePisiPathForTags(activeModalNode?.path, mission.nodePath)) {
        const editor = document.getElementById('node-modal-content');
        const result = await applyEditor(editor, () => {
            return window.pisiProject?.saveNodeContent?.(mission.nodePath, getPisiEditorContent(editor));
        });
        if (result?.ok && activeModalNode) activeModalNode.dirty = false;
        return result;
    }

    const doc = await window.pisiProject?.getPisiDocument?.(mission.nodePath);
    if (!doc?.ok) return { ok: false, error: doc?.error || 'Node okunamadı.' };
    const template = createPisiInertHtmlTemplate(doc.data?.content || '');
    const block = findPisiMissionBlockInContainer(template.content, mission);
    if (!block) return { ok: false, error: 'Görev bloğu node HTML içinde bulunamadı.' };
    const change = mutateBlock(block);
    if (change.missing) return { ok: false, error: 'Görev etiketi bulunamadı.' };
    if (!change.changed) return { ok: true, unchanged: true };
    const result = await window.pisiProject?.saveNodeContent?.(mission.nodePath, template.innerHTML);
    return result?.ok ? { ok: true } : { ok: false, error: result?.error || 'Node kaydedilemedi.' };
}

async function setPisiMissionStatusFirstRelease(mission, status) {
    const normalized = String(status || '').toLowerCase();
    if (!PISI_TODO_STATUS_OPTIONS.some((item) => item.value === normalized)) {
        return { ok: false, error: 'Geçersiz görev durumu.' };
    }
    try {
        return await savePisiMissionMutationFirstRelease(mission, (block) => {
            return setPisiMissionStatusInBlockFirstRelease(block, mission, normalized);
        });
    } catch (error) {
        console.error('[PISI] Görev durumu değiştirilemedi:', error);
        return { ok: false, error: error.message || 'Görev durumu değiştirilemedi.' };
    }
}

const moduleApi = {
    pisiTodoTranslateFirstRelease,
    formatPisiMissionDateFirstRelease,
    getPisiMissionsFromIndexFirstRelease,
    getPisiMissionDisplayTextFirstRelease,
    getPisiMissionFilterCountsFirstRelease,
    removePisiMissionBadgesFirstRelease,
    syncPisiMissionBadgesFirstRelease,
    renderPisiMissionsPanelFirstRelease,
    createPisiUserTagElement,
    getPisiSelectionTextOffset,
    capturePisiTodoSelection,
    applyPisiTodoSelectionToEditor,
    findPisiMissionTodoTagElementFirstRelease,
    setPisiMissionStatusInBlockFirstRelease,
    savePisiMissionMutationFirstRelease,
    setPisiMissionStatusFirstRelease
};
registerModule('tags.todoFirstRelease', moduleApi);
