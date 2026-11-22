import { PISI_TASK_TAG_LIMIT, isSamePisiTaskTag, normalizePisiTaskTag, normalizePisiTaskTags } from '../../shared/task-model.mjs';
import { makePisiTaskView, pisiTaskViewTranslate } from './pisi-task-view.mjs';

// The tag editor of a task (docs/task-plan.md G6): the tags as removable
// chips and a field that adds one on Enter, with the project's tags as
// suggestions. The tag chip window and the detail window use it. It writes
// nothing itself: `onChange(tags)` gets the whole new list.

let pisiTaskTagListCount = 0;

/** Tags to suggest: those of every task (tasks.json) and those of notes the editor has seen, sorted. */
export function listPisiTaskTagSuggestions() {
    const tags = [];
    for (const task of window.getPisiTasks?.() || []) tags.push(...(Array.isArray(task.tags) ? task.tags : []));
    tags.push(...(window.collectPisiUserTagSuggestions?.() || []));
    return normalizePisiTaskTags(tags.slice(0, 2000)).sort((a, b) => a.localeCompare(b, 'tr'));
}

/**
 * @param {string[]} tags
 * @param {(tags: string[]) => void} onChange
 * @param {{ readOnly?: boolean, suggestions?: string[], label?: string }} [options]
 */
export function makePisiTaskTagEditor(tags, onChange, { readOnly = false, suggestions = listPisiTaskTagSuggestions(), label = 'Etiket ekle' } = {}) {
    let current = normalizePisiTaskTags(tags);
    const root = makePisiTaskView('div', 'pisi-task-tags-editor');
    const list = makePisiTaskView('div', 'pisi-task-tags-list');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', pisiTaskViewTranslate('Etiketler'));
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pisi-task-popover-input pisi-task-tags-input';
    input.setAttribute('aria-label', pisiTaskViewTranslate(label));
    input.placeholder = pisiTaskViewTranslate('#etiket');
    input.maxLength = 80;
    input.disabled = readOnly;
    const options = document.createElement('datalist');
    options.id = `pisi-task-tag-options-${++pisiTaskTagListCount}`;
    for (const tag of suggestions) {
        const option = document.createElement('option');
        option.value = tag;
        options.appendChild(option);
    }
    input.setAttribute('list', options.id);
    const message = makePisiTaskView('div', 'pisi-task-tags-message');
    message.setAttribute('role', 'status');

    const draw = () => {
        list.replaceChildren();
        for (const tag of current) {
            const item = makePisiTaskView('span', 'pisi-task-tag');
            item.setAttribute('role', 'listitem');
            item.appendChild(makePisiTaskView('span', 'pisi-task-tag-name', `#${tag}`));
            if (!readOnly) {
                const remove = makePisiTaskView('button', 'pisi-task-tag-remove', '×');
                remove.type = 'button';
                remove.setAttribute('aria-label', `${pisiTaskViewTranslate('Etiketi kaldır')}: #${tag}`);
                remove.addEventListener('click', () => {
                    current = current.filter((item) => item !== tag);
                    draw();
                    onChange(current);
                    input.focus({ preventScroll: true });
                });
                item.appendChild(remove);
            }
            list.appendChild(item);
        }
        list.hidden = !current.length;
    };

    const add = () => {
        const raw = input.value.trim();
        if (!raw) return false;
        const tag = normalizePisiTaskTag(raw);
        if (!tag) {
            message.textContent = pisiTaskViewTranslate('Etiket yalnız harf, rakam, - ve _ içerebilir.');
            input.setAttribute('aria-invalid', 'true');
            return true;
        }
        input.removeAttribute('aria-invalid');
        message.textContent = '';
        input.value = '';
        if (current.some((item) => isSamePisiTaskTag(item, tag))) return true;
        if (current.length >= PISI_TASK_TAG_LIMIT) {
            message.textContent = pisiTaskViewTranslate('Bir görevde en çok 20 etiket olabilir.');
            return true;
        }
        current = [...current, tag];
        draw();
        onChange(current);
        return true;
    };

    input.addEventListener('keydown', (event) => {
        if (event.isComposing) return;
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            event.stopPropagation();
            add();
        } else if (event.key === 'Backspace' && !input.value && current.length) {
            event.preventDefault();
            current = current.slice(0, -1);
            draw();
            onChange(current);
        }
    });
    input.addEventListener('change', () => {
        // A suggestion picked from the list arrives as a change.
        if (input.value.trim()) add();
    });

    draw();
    root.append(list, input, options, message);
    return { element: root, input, add, getTags: () => current.slice() };
}
