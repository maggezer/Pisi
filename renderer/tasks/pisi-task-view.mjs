import { PISI_TODO_PRIORITY_OPTIONS, PISI_TODO_REPEAT_OPTIONS } from '../../shared/task-model.mjs';
import { normalizePisiTaskTitleDraft } from './pisi-task-edit-core.mjs';

// The pieces a task is drawn with in a note (docs/task-plan.md §3.2.1) and in
// a diary's task section (§3.2.2): the checkbox, the title field and the
// chips. Everything here is drawing only (`data-pisi-task-view`): the saved
// note never contains it (GV2). The title field keeps what the user types as
// a draft until tasks.json has it, so a redraw never takes text away.

export const PISI_TASK_VIEW_ATTR = 'data-pisi-task-view';
export const PISI_TASK_TITLE_SELECTOR = '[data-pisi-task-title]';

/** Title text the user typed that tasks.json does not have yet, by task id. */
export const pisiTaskTitleDrafts = new Map();

export function pisiTaskViewTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

export function makePisiTaskView(tag, className, text = '') {
    const element = document.createElement(tag);
    element.className = className;
    element.setAttribute(PISI_TASK_VIEW_ATTR, '1');
    if (text) element.textContent = text;
    return element;
}

export function formatPisiTaskDay(day) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

export function formatPisiTaskTime(iso) {
    const date = new Date(String(iso || ''));
    return Number.isNaN(date.getTime()) ? '' : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** "Görevler okunamadı" when tasks.json cannot be read (GV11), else null. */
export function getPisiTaskStoreProblem() {
    return window.isPisiTaskStoreReadOnly?.() ? pisiTaskViewTranslate('Görevler okunamadı') : null;
}

/** The text a task's title field shows: the draft while there is one, else the stored title. */
export function getPisiTaskTitleText(task) {
    if (!task) return '';
    return pisiTaskTitleDrafts.has(task.id) ? pisiTaskTitleDrafts.get(task.id) : String(task.title || '');
}

export function makePisiTaskCheckbox() {
    const box = makePisiTaskView('span', 'pisi-task-check');
    box.setAttribute('role', 'checkbox');
    return box;
}

/** Brings a checkbox to the state of its task on a day (`day` null: the task's own status). */
export function updatePisiTaskCheckbox(box, taskId, checked, { day = null, locked = false, disabled = false } = {}) {
    box.dataset.pisiTaskCheck = taskId;
    if (day) box.dataset.pisiTaskDay = day;
    else delete box.dataset.pisiTaskDay;
    box.setAttribute('aria-checked', checked ? 'true' : 'false');
    box.setAttribute('tabindex', locked || disabled ? '-1' : '0');
    box.setAttribute('aria-label', pisiTaskViewTranslate(checked ? 'Görevi yeniden aç' : 'Görevi tamamla'));
    if (locked || disabled) box.setAttribute('aria-disabled', 'true');
    else box.removeAttribute('aria-disabled');
    if (locked) box.title = pisiTaskViewTranslate('Bu tamamlama kilitli: görev daha sonra yeniden tamamlandı.');
    else box.removeAttribute('title');
    box.dataset.pisiTaskLocked = locked ? 'true' : 'false';
    const mark = checked ? '☑' : '☐';
    if (box.textContent !== mark) box.textContent = mark;
}

/**
 * The title field of `container` for a task (or a pending one, `taskId`
 * null), reused when it is there so that the caret and the IME stay. Its text
 * is replaced only when the field is not being edited.
 */
export function ensurePisiTaskTitleField(container, taskId, { text = '', readOnly = false, placeholder = 'Görev', before = null } = {}) {
    let field = container.querySelector(`:scope > ${PISI_TASK_TITLE_SELECTOR}`);
    if (!field) {
        field = makePisiTaskView('span', 'pisi-task-title');
        field.setAttribute('spellcheck', 'true');
        field.setAttribute('role', 'textbox');
        field.setAttribute('aria-label', pisiTaskViewTranslate('Görev başlığı'));
        container.insertBefore(field, before && before.parentNode === container ? before : null);
    }
    field.dataset.pisiTaskTitle = taskId || '';
    field.dataset.placeholder = pisiTaskViewTranslate(placeholder);
    field.setAttribute('contenteditable', readOnly ? 'false' : 'plaintext-only');
    field.setAttribute('aria-readonly', readOnly ? 'true' : 'false');
    const editing = document.activeElement === field;
    const value = normalizePisiTaskTitleDraft(text);
    if (!editing && field.textContent !== value) field.textContent = value;
    return field;
}

const PISI_TASK_REMINDER_LABELS = Object.freeze({
    none: 'Hatırlatma yok',
    'due-morning': 'Bitiş günü sabahı',
    'day-before': 'Bir gün önce',
    'three-days-before': 'Üç gün önce'
});

export function getPisiTaskReminderLabel(mode) {
    return pisiTaskViewTranslate(PISI_TASK_REMINDER_LABELS[mode] || PISI_TASK_REMINDER_LABELS.none);
}

export const PISI_TASK_REMINDER_MODE_LABELS = PISI_TASK_REMINDER_LABELS;

function describePisiTaskChip(task, kind) {
    if (kind === 'date') {
        const text = [formatPisiTaskDay(task.dueDate), task.dueDate ? task.dueTime || '' : ''].filter(Boolean).join(' ');
        return { text: text || pisiTaskViewTranslate('Tarih'), empty: !text, label: pisiTaskViewTranslate('Tarih') };
    }
    if (kind === 'priority') {
        const option = PISI_TODO_PRIORITY_OPTIONS.find((item) => item.value === Number(task.priority)) || PISI_TODO_PRIORITY_OPTIONS[2];
        return { text: `!${option.value} ${pisiTaskViewTranslate(option.label)}`, empty: option.value === 3, label: pisiTaskViewTranslate('Öncelik') };
    }
    if (kind === 'repeat') {
        const option = PISI_TODO_REPEAT_OPTIONS.find((item) => item.value === task.repeat) || PISI_TODO_REPEAT_OPTIONS[0];
        const empty = option.value === 'none';
        return { text: empty ? pisiTaskViewTranslate('Tekrar') : `↻ ${pisiTaskViewTranslate(option.label)}`, empty, label: pisiTaskViewTranslate('Tekrar') };
    }
    const at = String(task.reminderAt || '');
    const empty = !at && (!task.reminderMode || task.reminderMode === 'none');
    const text = at ? `${formatPisiTaskDay(at.slice(0, 10))} ${at.slice(11, 16)}` : getPisiTaskReminderLabel(task.reminderMode);
    return { text: empty ? pisiTaskViewTranslate('Hatırlatma') : `⏰ ${text}`, empty, label: pisiTaskViewTranslate('Hatırlatma') };
}

/** The chips of a task (date, priority, repeat, reminder), updated in place; an empty chip shows only on hover or focus. */
export function ensurePisiTaskChips(container, task, { kinds = ['date', 'priority', 'repeat', 'reminder'], readOnly = false } = {}) {
    let chips = container.querySelector(':scope > .pisi-task-chips');
    if (!chips) {
        chips = makePisiTaskView('span', 'pisi-task-chips');
        container.appendChild(chips);
    }
    const wanted = new Set(kinds);
    for (const chip of Array.from(chips.children)) if (!wanted.has(chip.dataset.pisiTaskChip)) chip.remove();
    for (const kind of kinds) {
        let chip = chips.querySelector(`:scope > [data-pisi-task-chip="${kind}"]`);
        if (!chip) {
            chip = makePisiTaskView('button', 'pisi-task-chip');
            chip.type = 'button';
            chip.dataset.pisiTaskChip = kind;
            chip.setAttribute('tabindex', '-1');
            chips.appendChild(chip);
        }
        const described = describePisiTaskChip(task, kind);
        chip.dataset.pisiTaskChipFor = task.id;
        chip.classList.toggle('pisi-task-chip-empty', described.empty);
        chip.disabled = readOnly;
        if (chip.textContent !== described.text) chip.textContent = described.text;
        chip.setAttribute('aria-label', described.label);
    }
    container.appendChild(chips);
    return chips;
}

/** The editor (center or note window) an element is in, else null. */
export function getPisiEditorOfTaskElement(element) {
    return element?.closest?.('#center-node-editor-content, #node-modal-content') || null;
}

/** The open note of an editor: `{ path, noteId, diaryDate }`. */
export function getPisiNoteOfEditor(editor) {
    const node = editor?.id === 'node-modal-content' ? window.activeModalNode : editor?.id === 'center-node-editor-content' ? window.activeCenterNode : null;
    if (!node?.path) return null;
    const metadata = node.metadata || node.item?.metadata || {};
    const diaryDate = /^\d{4}-\d{2}-\d{2}$/.test(String(metadata.diaryDate || '')) ? metadata.diaryDate : null;
    return { path: node.path, noteId: metadata.id || null, diaryDate, node };
}

/** Puts the caret in a title field, at `offset` (default: the end). */
export function focusPisiTaskTitleField(field, offset = null) {
    if (!field?.isConnected) return false;
    field.focus({ preventScroll: true });
    const selection = window.getSelection?.();
    if (!selection) return true;
    const range = document.createRange();
    const text = field.firstChild?.nodeType === Node.TEXT_NODE ? field.firstChild : null;
    if (text) {
        const at = offset === null ? text.length : Math.max(0, Math.min(text.length, offset));
        range.setStart(text, at);
    } else range.setStart(field, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    field.scrollIntoView?.({ block: 'nearest' });
    return true;
}

/** The caret offset in a title field, or null when the selection is not in it or not collapsed. */
export function getPisiTaskTitleCaret(field) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount || !field) return null;
    const range = selection.getRangeAt(0);
    if (!field.contains(range.startContainer)) return null;
    const before = document.createRange();
    before.selectNodeContents(field);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    return { start, end: start + range.toString().length, collapsed: range.collapsed, length: field.textContent.length };
}
