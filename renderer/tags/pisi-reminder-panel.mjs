import { registerModule } from '../core/module-registry.mjs';

// In-app side of the main-process reminder service. Main decides when a
// reminder is due and shows the native notification; this module shows the
// pending list (due and missed reminders) with Open, Snooze, Done and Dismiss,
// opens a task's note when a notification is clicked, completes tasks through
// the normal task path so the note markup follows, and renders the Reminders
// settings section. Nothing here schedules or stores reminders.

const pisiReminderState = {
    entries: [],
    panel: null,
    initialized: false,
    unsubscribe: null
};

function pisiReminderTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function pisiReminderCommand(name, payload = {}) {
    return window.pisiDomain?.command?.(name, payload);
}

function formatPisiReminderTime(time) {
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function makePisiReminderButton(label, action, className = 'pisi-reminder-button') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.pisiReminderAction = action;
    button.textContent = pisiReminderTranslate(label);
    return button;
}

function ensurePisiReminderPanel() {
    if (pisiReminderState.panel?.isConnected) return pisiReminderState.panel;
    const panel = document.createElement('section');
    panel.className = 'pisi-reminder-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-live', 'polite');
    panel.hidden = true;
    panel.addEventListener('click', (event) => {
        const button = event.target.closest('[data-pisi-reminder-action]');
        if (!button) return;
        const key = button.closest('[data-pisi-reminder-key]')?.dataset.pisiReminderKey || '';
        void handlePisiReminderAction(button.dataset.pisiReminderAction, key);
    });
    document.body.appendChild(panel);
    pisiReminderState.panel = panel;
    return panel;
}

function renderPisiReminderPanel(options = {}) {
    const panel = ensurePisiReminderPanel();
    const entries = pisiReminderState.entries;
    panel.replaceChildren();
    panel.hidden = !entries.length;
    if (!entries.length) return panel;

    const header = document.createElement('header');
    header.className = 'pisi-reminder-header';
    const title = document.createElement('strong');
    const missed = entries.filter((entry) => entry.missed).length;
    title.textContent = missed
        ? pisiReminderTranslate('{count} hatırlatma kaçırıldı').replace('{count}', String(missed))
        : pisiReminderTranslate('Hatırlatmalar');
    header.append(title, makePisiReminderButton('Tümünü kapat', 'dismiss-all', 'pisi-reminder-button pisi-reminder-dismiss-all'));

    const listElement = document.createElement('div');
    listElement.setAttribute('role', 'list');
    listElement.className = 'pisi-reminder-list';
    for (const entry of entries) {
        const row = document.createElement('div');
        row.setAttribute('role', 'listitem');
        row.className = 'pisi-reminder-item';
        row.dataset.pisiReminderKey = entry.key;
        row.dataset.pisiReminderTask = entry.taskId;
        if (entry.missed) row.dataset.pisiReminderMissed = '1';
        const text = document.createElement('div');
        text.className = 'pisi-reminder-text';
        const name = document.createElement('span');
        name.className = 'pisi-reminder-title';
        name.textContent = entry.title || pisiReminderTranslate('Adsız görev');
        const when = document.createElement('small');
        when.textContent = formatPisiReminderTime(entry.time);
        text.append(name, when);
        const actions = document.createElement('div');
        actions.className = 'pisi-reminder-actions';
        actions.append(
            makePisiReminderButton('Aç', 'open'),
            makePisiReminderButton('10 dk ertele', 'snooze'),
            makePisiReminderButton('Tamamlandı', 'complete'),
            makePisiReminderButton('×', 'dismiss', 'pisi-reminder-button pisi-reminder-dismiss')
        );
        actions.lastElementChild.setAttribute('aria-label', pisiReminderTranslate('Kapat'));
        row.append(text, actions);
        listElement.appendChild(row);
    }
    panel.append(header, listElement);
    if (options.focus) panel.querySelector('[data-pisi-reminder-action="open"]')?.focus({ preventScroll: true });
    return panel;
}

function setPisiReminderEntries(entries, options = {}) {
    pisiReminderState.entries = Array.isArray(entries) ? entries : [];
    renderPisiReminderPanel(options);
}

async function refreshPisiReminderEntries(options = {}) {
    const result = await window.pisiDomain?.query?.('reminder.pending.list.v1', {});
    if (result?.ok) setPisiReminderEntries(result.entries, options);
    return result;
}

/**
 * Opens the task's note at its block. A task captured moments ago may not be in
 * the renderer task cache yet, so the cache is refreshed first; if navigation
 * still fails the note itself is opened.
 */
async function openPisiReminderTask(target = {}) {
    if (!target.taskId && !target.nodePath) return null;
    const taskStore = window.Pisi?.modules?.['tags.taskStore'];
    if (target.taskId && !taskStore?.getPisiFirstClassTask?.(target.taskId)) {
        await window.refreshPisiMissionIndex?.({ force: true, reason: 'reminder' });
    }
    const result = await window.openPisiTagBlockResult?.({
        taskId: target.taskId,
        missionId: target.taskId,
        nodePath: target.nodePath,
        blockId: target.blockId
    });
    if (result?.ok === false && target.nodePath) {
        return window.openPisiFileTab?.({ fullPath: target.nodePath, name: target.nodePath.split(/[\\/]/).pop(), isDirectory: false });
    }
    return result;
}

/** Completes through the mission path so the note's task markup follows tasks.json. */
async function completePisiReminderTask(taskId) {
    const missions = window.pisiTagsPanelState?.missionIndex || [];
    const mission = missions.find((item) => item?.taskId === taskId || item?.missionId === taskId);
    if (mission?.nodePath && typeof window.setPisiMissionStatusFirstRelease === 'function') {
        const result = await window.setPisiMissionStatusFirstRelease(mission, 'done');
        if (result?.ok) {
            window.refreshPisiTagsPanelSoon?.();
            return result;
        }
    }
    const result = await pisiReminderCommand('task.update.v1', { projectFolder: window.currentProjectFolder, taskId, patch: { status: 'done' } });
    window.refreshPisiTagsPanelSoon?.();
    return result;
}

async function handlePisiReminderAction(action, key) {
    const entry = pisiReminderState.entries.find((item) => item.key === key) || null;
    if (action === 'open' && entry) {
        await openPisiReminderTask(entry);
        return pisiReminderCommand('reminder.dismiss.v1', { keys: [key] });
    }
    if (action === 'snooze' && entry) return pisiReminderCommand('reminder.snooze.v1', { key });
    if (action === 'complete' && entry) {
        await completePisiReminderTask(entry.taskId);
        return pisiReminderCommand('reminder.dismiss.v1', { keys: [key] });
    }
    if (action === 'dismiss' && entry) return pisiReminderCommand('reminder.dismiss.v1', { keys: [key] });
    if (action === 'dismiss-all') return pisiReminderCommand('reminder.dismiss.v1', { keys: pisiReminderState.entries.map((item) => item.key) });
    return null;
}

function handlePisiReminderEvent(payload = {}) {
    if (payload.type === 'pending') setPisiReminderEntries(payload.entries);
    else if (payload.type === 'show-pending') void refreshPisiReminderEntries({ focus: true });
    else if (payload.type === 'open') void openPisiReminderTask(payload);
    else if (payload.type === 'complete') void completePisiReminderTask(payload.taskId);
}

function renderPisiReminderSettings(container) {
    if (!container || container.querySelector('.pisi-reminder-settings')) return;
    const section = document.createElement('section');
    section.className = 'pisi-portable-section pisi-reminder-settings';
    const heading = document.createElement('h2');
    heading.textContent = pisiReminderTranslate('Hatırlatmalar');
    const timeLabel = document.createElement('label');
    timeLabel.className = 'pisi-reminder-setting';
    const timeText = document.createElement('span');
    timeText.textContent = pisiReminderTranslate('"Gün önce" hatırlatmalarının saati');
    const time = document.createElement('input');
    time.type = 'time';
    time.dataset.pisiReminderSetting = 'defaultTime';
    timeLabel.append(timeText, time);
    const trayLabel = document.createElement('label');
    trayLabel.className = 'pisi-reminder-setting';
    const tray = document.createElement('input');
    tray.type = 'checkbox';
    tray.dataset.pisiReminderSetting = 'keepRunningInTray';
    const trayText = document.createElement('span');
    trayText.textContent = pisiReminderTranslate('Pencereyi kapatınca sistem tepsisinde çalışmaya devam et');
    trayLabel.append(tray, trayText);
    const note = document.createElement('small');
    note.className = 'pisi-reminder-setting-note';
    section.append(heading, timeLabel, trayLabel, note);
    container.append(section);

    const apply = (settings = {}) => {
        time.value = settings.defaultTime || '09:00';
        tray.checked = settings.keepRunningInTray === true;
        note.textContent =
            settings.keepRunningInTray && settings.trayAvailable === false ? pisiReminderTranslate('Bu sistemde tepsi simgesi oluşturulamadı.') : '';
    };
    void window.pisiDomain?.query?.('reminder.settings.get.v1', {}).then((result) => result?.ok && apply(result.settings));
    const save = async (patch) => {
        const result = await pisiReminderCommand('reminder.settings.update.v1', patch);
        if (result?.ok) apply(result.settings);
        else if (result?.error) window.alert(pisiReminderTranslate(result.error));
    };
    time.addEventListener('change', () => time.value && save({ defaultTime: time.value }));
    tray.addEventListener('change', () => save({ keepRunningInTray: tray.checked }));
}

function ensurePisiReminderStyle() {
    if (document.querySelector('link[data-pisi-reminder-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/tags/pisi-reminder-panel.css';
    link.dataset.pisiReminderStyle = '1';
    document.head.appendChild(link);
}

function initializePisiReminderPanel() {
    if (pisiReminderState.initialized) return false;
    pisiReminderState.initialized = true;
    ensurePisiReminderStyle();
    pisiReminderState.unsubscribe = window.pisiReminders?.onEvent?.(handlePisiReminderEvent) || null;
    document.addEventListener('pisi:render-settings-sections', (event) => renderPisiReminderSettings(event.detail?.container));
    window.addEventListener('focus', () => void refreshPisiReminderEntries());
    void refreshPisiReminderEntries();
    return true;
}

const moduleApi = {
    pisiReminderState,
    refreshPisiReminderEntries,
    renderPisiReminderPanel,
    completePisiReminderTask,
    renderPisiReminderSettings,
    initializePisiReminderPanel
};

registerModule('tags.reminders', moduleApi);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePisiReminderPanel, { once: true });
} else {
    initializePisiReminderPanel();
}

export {
    completePisiReminderTask,
    initializePisiReminderPanel,
    pisiReminderState,
    refreshPisiReminderEntries,
    renderPisiReminderPanel,
    renderPisiReminderSettings
};
