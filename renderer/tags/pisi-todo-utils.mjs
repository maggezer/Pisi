// Desktop entry for the todo rules. The tag grammar, option values, repeat
// dates and date buckets live in shared/task-model.mjs and
// shared/task-views.mjs, which the mobile app imports as well. This file keeps
// what only the desktop UI needs: the sort and status-filter option lists and
// reading todo metadata from an editor block (DOM).
import { PISI_TODO_STATUS_OPTIONS, getPisiTodoRepeatOption, normalizePisiTodoTagValue } from '../../shared/task-model.mjs';

export {
    PISI_TODO_PRIORITY_OPTIONS,
    PISI_TODO_REPEAT_OPTIONS,
    PISI_TODO_STATUS_OPTIONS,
    formatPisiTodoTag,
    getNextPisiTodoDate,
    getPisiTodayIsoDate,
    getPisiTodoPriorityOption,
    getPisiTodoRepeatOption,
    getPisiTodoStatusOption
} from '../../shared/task-model.mjs';
export {
    PISI_TODO_FILTER_OPTIONS,
    getPisiTodoDateBucket,
    getPisiTodoFilterOption,
    matchesPisiTodoFilter,
    parsePisiTodoTagValue
} from '../../shared/task-views.mjs';

export const PISI_TODO_SORT_OPTIONS = Object.freeze([
    Object.freeze({ value: 'smart', label: 'Akıllı sıra' }),
    Object.freeze({ value: 'date', label: 'Tarihe göre' }),
    Object.freeze({ value: 'priority', label: 'Önceliğe göre' }),
    Object.freeze({ value: 'status', label: 'Duruma göre' }),
    Object.freeze({ value: 'manual', label: 'Manuel sıra' })
]);

export const PISI_TODO_STATUS_FILTER_OPTIONS = Object.freeze([Object.freeze({ value: 'all', label: 'Tüm durumlar' }), ...PISI_TODO_STATUS_OPTIONS]);

export function getPisiTodoSortOption(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return PISI_TODO_SORT_OPTIONS.find((item) => item.value === normalized) || PISI_TODO_SORT_OPTIONS[0];
}

export function getPisiTodoStatusFilterOption(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return PISI_TODO_STATUS_FILTER_OPTIONS.find((item) => item.value === normalized) || PISI_TODO_STATUS_FILTER_OPTIONS[0];
}

export function extractPisiTodoMetadataFromBlock(block, normalizeTag = normalizePisiTodoTagValue) {
    const todoStates = {};
    const todoSources = {};
    const todoParents = {};
    const todoRepeats = {};
    const todoOrders = {};
    const todoCompletionOffsets = {};
    if (!block?.querySelectorAll) {
        return {
            todoStates,
            todoSources,
            todoParents,
            todoRepeats,
            todoOrders,
            todoCompletionOffsets
        };
    }

    const normalize = (value) => String(normalizeTag(value) || '').toLowerCase();
    const sourceElements = Array.from(block.querySelectorAll('.pisi-todo-source[data-pisi-todo-for]'));
    const todoTagElements = Array.from(block.querySelectorAll('.pisi-user-tag[data-pisi-tag]')).filter((tagEl) => {
        return /^todo\./i.test(normalize(tagEl.dataset.pisiTag || tagEl.textContent || ''));
    });

    for (const tagEl of todoTagElements) {
        const normalizedTag = normalize(tagEl.dataset.pisiTag || tagEl.textContent || '');
        if (!/^todo\./i.test(normalizedTag)) continue;

        todoStates[normalizedTag] = String(tagEl.dataset.pisiTodoStatus || 'todo').toLowerCase();
        todoParents[normalizedTag] = String(tagEl.dataset.pisiTodoParent || '');
        todoRepeats[normalizedTag] = getPisiTodoRepeatOption(tagEl.dataset.pisiTodoRepeat).value;

        const rawOrder = Number(tagEl.dataset.pisiTodoOrder);
        if (Number.isFinite(rawOrder)) {
            todoOrders[normalizedTag] = Math.max(0, Math.min(1000000, rawOrder));
        }
        const rawOffset = Number(tagEl.dataset.pisiTodoCompletionOffsetDays);
        if (Number.isFinite(rawOffset) && rawOffset > 0) {
            todoCompletionOffsets[normalizedTag] = Math.max(1, Math.min(3650, rawOffset));
        }

        const sourceEl = sourceElements.find((candidate) => {
            return normalize(candidate.dataset.pisiTodoFor || '') === normalizedTag;
        });
        if (sourceEl) {
            let sourceText = String(sourceEl.textContent || '')
                .replace(/\s+/g, ' ')
                .trim();
            if (todoTagElements.length === 1 && typeof block.cloneNode === 'function') {
                const clone = block.cloneNode(true);
                clone.querySelectorAll?.('.pisi-block-task-marker, .pisi-task-metadata, .pisi-user-tag[data-pisi-tag]').forEach((el) => el.remove());
                const fullText = String(clone.textContent || '')
                    .replace(/^[☐☑]\s*/, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                if (fullText && fullText.length > sourceText.length) {
                    sourceText = fullText;
                }
            }
            todoSources[normalizedTag] = sourceText;
        }
    }

    return {
        todoStates,
        todoSources,
        todoParents,
        todoRepeats,
        todoOrders,
        todoCompletionOffsets
    };
}
