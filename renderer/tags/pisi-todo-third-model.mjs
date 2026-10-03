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

export {
    PISI_TODO_THIRD_VIEWS,
    PISI_TODO_REMINDER_OPTIONS,
    pisiTodoThirdReleaseState,
    pisiTodoThirdTranslate,
    getPisiTodoThirdStorageKey,
    loadPisiTodoThirdPreferences,
    savePisiTodoThirdPreference,
    parsePisiMissionDependenciesThirdRelease,
    parsePisiMissionReminderThirdRelease,
    setPisiMissionDependenciesThirdRelease,
    setPisiMissionReminderThirdRelease
};
