import { registerModule } from "../core/module-registry.mjs";
import { registerPisiCommandCenterPage, openPisiCommandCenter } from "../shell/pisi-command-center.mjs";
import { ensurePisiSearchIndex, invalidatePisiSearchIndex } from "../search/pisi-search-index.mjs";
import {
    formatPisiTodoTag,
    getPisiTodoDateBucket,
    parsePisiTodoTagValue
} from "../tags/pisi-todo-utils.mjs";
import {
    getPisiPostponePreset,
    parsePisiTurkishDateExpression
} from "./pisi-date-parser.mjs";

const PISI_TASK_HUB_FILTERS = Object.freeze([
    Object.freeze({ value: 'inbox', label: 'Inbox' }),
    Object.freeze({ value: 'today', label: 'Bugün' }),
    Object.freeze({ value: 'upcoming', label: 'Yaklaşan' }),
    Object.freeze({ value: 'overdue', label: 'Geciken' }),
    Object.freeze({ value: 'undated', label: 'Tarihsiz' }),
    Object.freeze({ value: 'blocked', label: 'Engellenen' }),
    Object.freeze({ value: 'all', label: 'Tüm projeler' })
]);

const PISI_POSTPONE_PRESETS = Object.freeze([
    Object.freeze({ value: 'tomorrow', label: 'Yarın' }),
    Object.freeze({ value: 'tonight', label: 'Bu akşam' }),
    Object.freeze({ value: 'weekend', label: 'Hafta sonu' }),
    Object.freeze({ value: 'next-monday', label: 'Gelecek pazartesi' }),
    Object.freeze({ value: 'next-week', label: 'Bir hafta ertele' }),
    Object.freeze({ value: 'remove', label: 'Tarihi kaldır' })
]);

const pisiQuickCaptureState = {
    filter: 'inbox',
    observer: null,
    applyingEnhancements: false
};

function pisiQuickTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function getPisiTaskPropertyValue(documentRecord, id) {
    const property = Object.values(documentRecord?.properties || {})
        .find((item) => item?.id === id || item?.name === id);
    return property?.value;
}

function parsePisiTaskElement(documentRecord, tagElement, index) {
    const todoTag = String(tagElement.dataset.pisiTag || tagElement.textContent || '')
        .replace(/^(?:\.\.|#|\/)/, '')
        .toLowerCase();
    const todo = parsePisiTodoTagValue(todoTag);
    if (!todo) return null;
    const block = tagElement.closest(
        '.pisi-editor-block, p, div, li, h1, h2, h3, h4, h5, h6'
    );
    const blockId = block?.dataset.pisiBlockId || `task-${index}`;
    const source = Array.from(block?.querySelectorAll?.(
        '.pisi-todo-source[data-pisi-todo-for]'
    ) || []).find((element) => {
        return String(element.dataset.pisiTodoFor || '').toLowerCase() === todoTag;
    });
    const doneTags = Array.from(block?.querySelectorAll?.(
        '.pisi-user-tag[data-pisi-tag]'
    ) || []).filter((element) => {
        return String(element.dataset.pisiTag || '').toLowerCase() === 'done';
    });
    const completed = doneTags.some((element) => {
        const doneFor = String(element.dataset.pisiDoneFor || '').toLowerCase();
        return !doneFor || doneFor === todoTag;
    });
    const scheduledAt = String(tagElement.dataset.pisiTodoScheduledAt || '');
    const deadline = String(tagElement.dataset.pisiTodoDeadline || '');
    const durationMinutes = Math.max(0, Number(
        tagElement.dataset.pisiTodoDurationMinutes
    ) || 0);
    const actualMinutes = Math.max(0, Number(
        tagElement.dataset.pisiTodoActualMinutes
    ) || 0);
    return {
        missionId: [documentRecord.path, blockId, todoTag].map(encodeURIComponent).join('::'),
        nodePath: documentRecord.path,
        nodeTitle: documentRecord.title,
        relativePath: documentRecord.relativePath,
        blockId,
        todoTag,
        priority: todo.priority,
        finishDate: todo.finishDate,
        dateBucket: getPisiTodoDateBucket(todo.finishDate),
        sourceText: String(source?.textContent || block?.textContent || todoTag)
            .replace(/\s+/g, ' ').trim(),
        status: String(tagElement.dataset.pisiTodoStatus || 'todo'),
        repeat: String(tagElement.dataset.pisiTodoRepeat || 'none'),
        scheduledAt,
        deadline,
        reminderAt: String(tagElement.dataset.pisiTodoReminderAt || ''),
        durationMinutes,
        actualMinutes,
        completed,
        inbox: documentRecord.metadata?.systemRole === 'inbox' ||
            getPisiTaskPropertyValue(documentRecord, 'systemRole') === 'inbox',
        html: block?.outerHTML || ''
    };
}

function collectPisiGlobalTasks(index) {
    const tasks = [];
    for (const documentRecord of index?.documents?.values?.() || []) {
        const template = document.createElement('template');
        template.innerHTML = String(documentRecord.html || '');
        template.content.querySelectorAll(
            '.pisi-user-tag[data-pisi-tag]'
        ).forEach((tagElement, taskIndex) => {
            const task = parsePisiTaskElement(documentRecord, tagElement, taskIndex);
            if (task) tasks.push(task);
        });
    }
    return tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        const aDate = a.finishDate?.getTime?.() ?? Number.POSITIVE_INFINITY;
        const bDate = b.finishDate?.getTime?.() ?? Number.POSITIVE_INFINITY;
        return aDate - bDate || b.priority - a.priority;
    });
}

function matchesPisiTaskHubFilter(task, filter) {
    if (filter === 'all') return true;
    if (filter === 'inbox') return task.inbox;
    if (filter === 'blocked') return task.status === 'blocked';
    return task.dateBucket === filter;
}

function formatPisiTaskMinutes(value) {
    const minutes = Number(value) || 0;
    if (!minutes) return '';
    if (minutes < 60) return `${minutes} dk`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} sa ${remainder} dk` : `${hours} sa`;
}

function makePisiQuickField(labelText, control) {
    const label = document.createElement('label');
    label.className = 'pisi-quick-field';
    const caption = document.createElement('span');
    caption.textContent = pisiQuickTranslate(labelText);
    label.append(caption, control);
    return label;
}

function makePisiQuickInput(type, name, placeholder = '') {
    const input = document.createElement('input');
    input.type = type;
    input.name = name;
    if (placeholder) input.placeholder = pisiQuickTranslate(placeholder);
    return input;
}

function renderPisiDateParsePreview(container, expression) {
    const parsed = parsePisiTurkishDateExpression(expression);
    const parts = [];
    if (parsed.scheduledAt) parts.push(`${pisiQuickTranslate('Plan')}: ${parsed.scheduledAt}`);
    if (parsed.deadline) parts.push(`${pisiQuickTranslate('Deadline')}: ${parsed.deadline}`);
    if (parsed.repeat !== 'none') parts.push(`${pisiQuickTranslate('Tekrar')}: ${parsed.repeat}`);
    if (parsed.reminderAt) parts.push(`${pisiQuickTranslate('Hatırlatma')}: ${parsed.reminderAt}`);
    container.textContent = parts.join(' · ') || pisiQuickTranslate('Tarih ifadesi algılanmadı.');
    container.classList.toggle('empty', !parts.length);
    return parsed;
}

async function submitPisiQuickAdd(form, parsePreview) {
    const data = new FormData(form);
    const parsed = renderPisiDateParsePreview(parsePreview, data.get('dateExpression'));
    const result = await window.pisiProject?.quickAddTask?.(
        window.currentProjectFolder,
        {
            text: data.get('text'),
            priority: Number(data.get('priority')),
            nodePath: data.get('nodePath') || null,
            scheduledAt: parsed.scheduledAt,
            deadline: parsed.deadline,
            reminderAt: parsed.reminderAt,
            repeat: parsed.repeat,
            completionOffsetDays: parsed.completionOffsetDays,
            durationMinutes: Number(data.get('durationMinutes')) || 0,
            actualMinutes: Number(data.get('actualMinutes')) || 0
        }
    );
    if (!result?.ok) throw new Error(result?.error || pisiQuickTranslate('Görev eklenemedi.'));
    invalidatePisiSearchIndex();
    await ensurePisiSearchIndex({ force: true });
    window.refreshPisiTagsPanelSoon?.();
    form.reset();
    pisiQuickCaptureState.filter = result.inbox ? 'inbox' : 'all';
    await window.renderPisiCommandCenterPage?.();
}

function buildPisiQuickAddForm(container, index) {
    const form = document.createElement('form');
    form.className = 'pisi-quick-add-form';
    const heading = document.createElement('h2');
    heading.textContent = pisiQuickTranslate('Global Quick Add');
    const text = makePisiQuickInput('text', 'text', 'Görev nedir?');
    text.required = true;
    const dateExpression = makePisiQuickInput(
        'text',
        'dateExpression',
        'yarın 14:00, her pazartesi…'
    );
    const parsePreview = document.createElement('div');
    parsePreview.className = 'pisi-date-parse-preview empty';
    renderPisiDateParsePreview(parsePreview, '');
    dateExpression.addEventListener('input', () => {
        renderPisiDateParsePreview(parsePreview, dateExpression.value);
    });

    const priority = document.createElement('select');
    priority.name = 'priority';
    for (let value = 5; value >= 1; value -= 1) {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = `${pisiQuickTranslate('Öncelik')} ${value}`;
        option.selected = value === 3;
        priority.appendChild(option);
    }
    const node = document.createElement('select');
    node.name = 'nodePath';
    const inbox = document.createElement('option');
    inbox.value = '';
    inbox.textContent = pisiQuickTranslate('Node seçilmezse Inbox');
    node.appendChild(inbox);
    for (const documentRecord of index?.documents?.values?.() || []) {
        const option = document.createElement('option');
        option.value = documentRecord.path;
        option.textContent = `${documentRecord.title} · ${documentRecord.relativePath}`;
        node.appendChild(option);
    }
    const duration = makePisiQuickInput('number', 'durationMinutes');
    duration.min = '0';
    duration.max = '1440';
    duration.step = '5';
    const actual = makePisiQuickInput('number', 'actualMinutes');
    actual.min = '0';
    actual.max = '100000';
    actual.step = '5';

    const grid = document.createElement('div');
    grid.className = 'pisi-quick-add-grid';
    grid.append(
        makePisiQuickField('Görev', text),
        makePisiQuickField('Türkçe tarih', dateExpression),
        makePisiQuickField('Öncelik', priority),
        makePisiQuickField('Node', node),
        makePisiQuickField('Tahmini süre (dk)', duration),
        makePisiQuickField('Gerçek süre (dk)', actual)
    );
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'pisi-primary-button';
    submit.textContent = pisiQuickTranslate('Görevi yakala');
    const status = document.createElement('div');
    status.className = 'pisi-command-inline-status';
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        status.textContent = pisiQuickTranslate('Kaydediliyor…');
        try {
            await submitPisiQuickAdd(form, parsePreview);
        } catch (error) {
            status.textContent = error.message;
            submit.disabled = false;
        }
    });
    form.append(heading, grid, parsePreview, submit, status);
    container.appendChild(form);
    queueMicrotask(() => text.focus());
}

function makePisiPostponeSelect(task) {
    const select = document.createElement('select');
    select.className = 'pisi-task-postpone-select';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = pisiQuickTranslate('Hızlı ertele…');
    select.appendChild(empty);
    for (const preset of PISI_POSTPONE_PRESETS) {
        const option = document.createElement('option');
        option.value = preset.value;
        option.textContent = pisiQuickTranslate(preset.label);
        select.appendChild(option);
    }
    select.addEventListener('change', async () => {
        const preset = select.value;
        if (!preset) return;
        select.disabled = true;
        const result = await postponePisiTask(task, preset);
        if (!result?.ok) {
            alert(result?.error || pisiQuickTranslate('Görev ertelenemedi.'));
            select.disabled = false;
            return;
        }
        invalidatePisiSearchIndex();
        await ensurePisiSearchIndex({ force: true });
        window.refreshPisiTagsPanelSoon?.();
        await window.renderPisiCommandCenterPage?.();
    });
    return select;
}

async function postponePisiTask(task, preset) {
    const dateValue = getPisiPostponePreset(preset);
    return window.savePisiMissionMutationFirstRelease?.(task, (block) => {
        const tag = window.findPisiMissionTodoTagElementFirstRelease?.(block, task);
        if (!tag) return { changed: false, missing: true, previousHtml: block.innerHTML };
        const previousHtml = block.innerHTML;
        const newTag = formatPisiTodoTag(task.priority, dateValue?.slice(0, 10) || 'none');
        block.querySelectorAll('.pisi-todo-source[data-pisi-todo-for]').forEach((source) => {
            if (String(source.dataset.pisiTodoFor || '').toLowerCase() === task.todoTag) {
                source.dataset.pisiTodoFor = newTag;
            }
        });
        tag.dataset.pisiTag = newTag;
        tag.textContent = newTag;
        if (dateValue) tag.dataset.pisiTodoScheduledAt = dateValue;
        else {
            delete tag.dataset.pisiTodoScheduledAt;
            delete tag.dataset.pisiTodoDeadline;
            delete tag.dataset.pisiTodoReminderAt;
        }
        return { changed: true, previousHtml };
    }) || { ok: false, error: pisiQuickTranslate('Görev kaydetme sistemi bulunamadı.') };
}

function renderPisiTaskCard(task, list) {
    const card = document.createElement('article');
    card.className = 'pisi-task-hub-card';
    card.classList.toggle('completed', task.completed);
    card.dataset.status = task.status;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'pisi-task-hub-open';
    const title = document.createElement('strong');
    title.textContent = task.sourceText;
    const node = document.createElement('span');
    node.textContent = `${task.nodeTitle} · ${task.relativePath}`;
    open.append(title, node);
    open.addEventListener('click', () => window.openPisiTagBlockResult?.(task));
    const meta = document.createElement('div');
    meta.className = 'pisi-task-hub-meta';
    const values = [
        task.finishDate ? task.finishDate.toLocaleDateString('tr-TR') : pisiQuickTranslate('Tarihsiz'),
        `${pisiQuickTranslate('Öncelik')} ${task.priority}`,
        task.scheduledAt?.includes('T') ? task.scheduledAt.slice(11) : '',
        formatPisiTaskMinutes(task.durationMinutes),
        task.actualMinutes ? `${pisiQuickTranslate('Gerçek')}: ${formatPisiTaskMinutes(task.actualMinutes)}` : ''
    ].filter(Boolean);
    meta.textContent = values.join(' · ');
    const controls = document.createElement('div');
    controls.className = 'pisi-task-hub-controls';
    controls.appendChild(makePisiPostponeSelect(task));
    card.append(open, meta, controls);
    list.appendChild(card);
}

function renderPisiTaskHub(container, tasks) {
    const section = document.createElement('section');
    section.className = 'pisi-task-hub';
    const heading = document.createElement('div');
    heading.className = 'pisi-command-section-heading';
    const title = document.createElement('h2');
    title.textContent = pisiQuickTranslate('Hazır görev görünümleri');
    heading.appendChild(title);
    const filters = document.createElement('div');
    filters.className = 'pisi-task-hub-filters';
    for (const filter of PISI_TASK_HUB_FILTERS) {
        const count = tasks.filter((task) => !task.completed && matchesPisiTaskHubFilter(task, filter.value)).length;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pisi-task-hub-filter';
        button.classList.toggle('active', filter.value === pisiQuickCaptureState.filter);
        button.textContent = `${pisiQuickTranslate(filter.label)} ${count}`;
        button.addEventListener('click', () => {
            pisiQuickCaptureState.filter = filter.value;
            window.renderPisiCommandCenterPage?.();
        });
        filters.appendChild(button);
    }
    const list = document.createElement('div');
    list.className = 'pisi-task-hub-list';
    const visible = tasks.filter((task) => {
        return !task.completed && matchesPisiTaskHubFilter(task, pisiQuickCaptureState.filter);
    });
    visible.forEach((task) => renderPisiTaskCard(task, list));
    if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'pisi-command-empty';
        empty.textContent = pisiQuickTranslate('Bu görünümde görev yok.');
        list.appendChild(empty);
    }
    section.append(heading, filters, list);
    container.appendChild(section);
}

async function renderPisiTasksPage(container) {
    const index = await ensurePisiSearchIndex();
    buildPisiQuickAddForm(container, index);
    renderPisiTaskHub(container, collectPisiGlobalTasks(index));
}

function enhancePisiExistingMissionCards() {
    if (pisiQuickCaptureState.applyingEnhancements) return;
    pisiQuickCaptureState.applyingEnhancements = true;
    try {
        const missions = window.getPisiMissionsFromIndexFirstRelease?.({ includeCompleted: true }) || [];
        const byId = new Map(missions.map((mission) => [mission.missionId, mission]));
        document.querySelectorAll('.pisi-mission-card[data-mission-id]').forEach((card) => {
            if (card.querySelector('.pisi-task-duration-badge')) return;
            const mission = byId.get(card.dataset.missionId);
            if (!mission?.html) return;
            const template = document.createElement('template');
            template.innerHTML = mission.html;
            const tag = template.content.querySelector(
                '.pisi-user-tag[data-pisi-todo-duration-minutes]'
            );
            const duration = Number(tag?.dataset.pisiTodoDurationMinutes) || 0;
            if (!duration) return;
            const badge = document.createElement('span');
            badge.className = 'pisi-task-duration-badge';
            badge.textContent = formatPisiTaskMinutes(duration);
            card.querySelector('.pisi-mission-meta')?.appendChild(badge);
        });
    } finally {
        pisiQuickCaptureState.applyingEnhancements = false;
    }
}

function installPisiQuickAddButton() {
    const actions = document.getElementById('project-actions');
    if (!actions || document.getElementById('pisi-quick-add-button')) return;
    const button = document.createElement('button');
    button.id = 'pisi-quick-add-button';
    button.type = 'button';
    button.className = 'project-action-btn';
    button.textContent = '＋';
    button.title = pisiQuickTranslate('Global Quick Add (Ctrl+Shift+A)');
    button.addEventListener('click', () => openPisiCommandCenter('tasks'));
    actions.prepend(button);
}

function initializePisiQuickCapture() {
    registerPisiCommandCenterPage({
        id: 'tasks',
        label: 'Görevler',
        order: 10,
        render: renderPisiTasksPage
    });
    installPisiQuickAddButton();
    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            openPisiCommandCenter('tasks');
        }
    });
    const panel = document.getElementById('pisi-missions-panel');
    if (panel) {
        pisiQuickCaptureState.observer = new MutationObserver(enhancePisiExistingMissionCards);
        pisiQuickCaptureState.observer.observe(panel, { childList: true, subtree: true });
        enhancePisiExistingMissionCards();
    }
}

const moduleApi = {
    PISI_TASK_HUB_FILTERS,
    PISI_POSTPONE_PRESETS,
    pisiQuickCaptureState,
    collectPisiGlobalTasks,
    matchesPisiTaskHubFilter,
    formatPisiTaskMinutes,
    renderPisiTasksPage,
    postponePisiTask,
    initializePisiQuickCapture
};

registerModule('productivity.quickCapture', moduleApi);
initializePisiQuickCapture();

export {
    PISI_POSTPONE_PRESETS,
    PISI_TASK_HUB_FILTERS,
    collectPisiGlobalTasks,
    formatPisiTaskMinutes,
    matchesPisiTaskHubFilter,
    postponePisiTask,
    renderPisiTasksPage
};
