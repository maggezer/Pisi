import { normalizePisiTaskPanelPrefs } from './pisi-task-panel-core.mjs';

// Small pieces the task panel, the workspace views, the detail window and
// Quick Add draw with (docs/task-plan.md G4): translation, element helpers,
// the per-project view preferences (a convenience in localStorage, never task
// data) and the note titles a task's place is shown with. The titles come
// from the search index's documents (§3.5); the panel never reads a note.

const pisiTaskPanelDomState = { noteTitles: new Map(), notes: [], styleLoaded: false };

export function pisiTaskPanelText(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

/** An element with a class and, optionally, its text. */
export function makePisiTaskPanelElement(tag, className = '', text = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

/** A button; `label` (optional) is its accessible name when the text is a symbol. */
export function createPisiTaskPanelButton(className, text, { label = null, onClick = null } = {}) {
    const button = makePisiTaskPanelElement('button', className, text);
    button.type = 'button';
    if (label) {
        button.setAttribute('aria-label', label);
        button.title = label;
    }
    if (onClick) button.addEventListener('click', onClick);
    return button;
}

/** A select with `[{ value, label }]` options (labels are given translated). */
export function makePisiTaskPanelSelect(className, label, options, value) {
    const select = document.createElement('select');
    select.className = className;
    select.setAttribute('aria-label', label);
    for (const option of options) {
        const element = document.createElement('option');
        element.value = String(option.value);
        element.textContent = option.label;
        select.appendChild(element);
    }
    select.value = String(value);
    return select;
}

/** `DD.MM.YYYY` of a `YYYY-MM-DD` day. */
export function formatPisiTaskPanelDay(day) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

// ---- Preferences -------------------------------------------------------------------

function getPisiTaskPanelPrefsKey(surface) {
    return `pisi.tasks.panel.v2.${surface}.${String(window.currentProjectFolder || '')}`;
}

export function loadPisiTaskPanelPrefs(surface) {
    try {
        return normalizePisiTaskPanelPrefs(JSON.parse(localStorage.getItem(getPisiTaskPanelPrefsKey(surface)) || '{}'));
    } catch {
        return normalizePisiTaskPanelPrefs({});
    }
}

export function savePisiTaskPanelPrefs(surface, prefs) {
    try {
        localStorage.setItem(getPisiTaskPanelPrefsKey(surface), JSON.stringify(normalizePisiTaskPanelPrefs(prefs)));
    } catch {
        // A blocked storage only loses the convenience.
    }
}

// ---- Notes ---------------------------------------------------------------------------

function readPisiTaskNoteIndex(index) {
    const titles = new Map();
    const notes = [];
    for (const record of index?.documents?.values?.() || []) {
        const id = record?.metadata?.id;
        if (!id || !/\.node$/i.test(String(record.path || ''))) continue;
        const title = String(record.title || record.metadata?.title || '').trim() || String(record.path).split(/[\\/]/).pop();
        titles.set(id, title);
        if (!record.metadata?.diaryDate) notes.push({ id, title, path: record.path, relativePath: record.relativePath || '' });
    }
    notes.sort((a, b) => a.title.localeCompare(b.title, 'tr') || a.relativePath.localeCompare(b.relativePath));
    pisiTaskPanelDomState.noteTitles = titles;
    pisiTaskPanelDomState.notes = notes;
    document.dispatchEvent(new CustomEvent('pisi:task-note-titles-updated'));
}

/** Reads the note titles from the search index, building it when there is none (Quick Add, the detail window). */
export async function loadPisiTaskNoteTitles() {
    if (!window.currentProjectFolder) return;
    try {
        readPisiTaskNoteIndex(await window.ensurePisiSearchIndex?.());
    } catch {
        // Without the index a place is shown as "Not".
    }
}

/** The notes the Explorer tree has drawn: `{ id, title, path, relativePath, diary }`. */
function readPisiTaskTreeNotes() {
    const notes = [];
    const root = String(window.currentProjectFolder || '').replace(/[\\/]+$/, '');
    for (const node of document.querySelectorAll('.tree-node[data-pisi-id]')) {
        const item = node.__pisiItem;
        const filePath = String(item?.fullPath || node.dataset.path || '');
        if (!/\.node$/i.test(filePath)) continue;
        const relativePath = root && filePath.startsWith(root) ? filePath.slice(root.length + 1).replace(/\\/g, '/') : '';
        const title = String(
            item?.metadata?.title ||
                item?.displayName ||
                filePath
                    .split(/[\\/]/)
                    .pop()
                    .replace(/\.node$/i, '')
        );
        notes.push({
            id: node.dataset.pisiId,
            title,
            path: filePath,
            relativePath,
            diary: Boolean(item?.metadata?.diaryDate) || /^diary\//.test(relativePath)
        });
    }
    return notes;
}

export function getPisiTaskNoteTitle(noteId) {
    if (!noteId) return null;
    const indexed = pisiTaskPanelDomState.noteTitles.get(noteId);
    if (indexed) return indexed;
    const node = document.querySelector(`.tree-node[data-pisi-id="${CSS.escape(noteId)}"]`);
    return node?.__pisiItem?.metadata?.title || node?.__pisiItem?.displayName || null;
}

/** The project's notes (not diaries), by title: `[{ id, title, path, relativePath }]`; the search index and the Explorer tree. */
export function listPisiTaskNoteChoices() {
    const byId = new Map(pisiTaskPanelDomState.notes.map((note) => [note.id, note]));
    for (const note of readPisiTaskTreeNotes()) if (!note.diary && !byId.has(note.id)) byId.set(note.id, note);
    return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title, 'tr') || a.relativePath.localeCompare(b.relativePath));
}

/** The path of the note with this id from the Explorer tree or the search index, or null. */
export function findPisiTaskNotePath(noteId) {
    if (!noteId) return null;
    const node = document.querySelector(`.tree-node[data-pisi-id="${CSS.escape(noteId)}"]`);
    if (node?.dataset.path) return node.dataset.path;
    return pisiTaskPanelDomState.notes.find((note) => note.id === noteId)?.path || null;
}

/** Where a task lives, as the panel shows it. */
export function getPisiTaskPlaceLabel(task) {
    if (task?.noteId) return getPisiTaskNoteTitle(task.noteId) || pisiTaskPanelText('Not');
    if (task?.diaryDate) return `${pisiTaskPanelText('Günlük')} · ${formatPisiTaskPanelDay(task.diaryDate)}`;
    return pisiTaskPanelText('Yeri yok');
}

export function ensurePisiTaskPanelStyle() {
    if (pisiTaskPanelDomState.styleLoaded || document.querySelector('link[data-pisi-task-panel-style]')) return;
    pisiTaskPanelDomState.styleLoaded = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/tasks/pisi-task-panel.css';
    link.dataset.pisiTaskPanelStyle = '1';
    document.head.appendChild(link);
}

// The panel never builds the search index itself (it is built when search, Quick Add or the detail window needs it);
// it takes every index the search builds or updates. Until then the titles come from the Explorer tree.
document.addEventListener('pisi:search-index-ready', (event) => readPisiTaskNoteIndex(event.detail?.index));
document.addEventListener('pisi:project-loaded', () => {
    pisiTaskPanelDomState.noteTitles = new Map();
    pisiTaskPanelDomState.notes = [];
});

const PISI_TASK_STATUS_LABELS = Object.freeze({ todo: 'Yapılacak', doing: 'Devam ediyor', waiting: 'Beklemede', blocked: 'Engellendi', done: 'Tamamlandı' });

export function getPisiTaskStatusLabel(status) {
    return pisiTaskPanelText(PISI_TASK_STATUS_LABELS[status] || PISI_TASK_STATUS_LABELS.todo);
}
