import { registerModule } from '../core/module-registry.mjs';
import { createPisiNotifyQueue, getPisiNotifyAria } from './pisi-notify-core.mjs';

// In-app notifications: theme-aware strips in the bottom-right corner that
// replace the browser alert(). Info and success close after 4 s, warnings after
// 6 s, errors stay until closed and offer "show / copy details". A repeated
// message merges into the open strip (×2, ×3 …). Every strip is announced:
// errors and warnings with role="alert", the rest with role="status".

const pisiNotifyQueue = createPisiNotifyQueue();
const pisiNotifyTimers = new Map();
const pisiNotifyElements = new Map();
const pisiNotificationState = { region: null, items: pisiNotifyQueue.items };

function pisiNotifyTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function ensurePisiNotifyRegion() {
    if (pisiNotificationState.region?.isConnected) return pisiNotificationState.region;
    if (!document.querySelector('link[data-pisi-notifications-style]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'renderer/shell/pisi-notifications.css';
        link.dataset.pisiNotificationsStyle = '1';
        document.head.appendChild(link);
    }
    const region = document.createElement('section');
    region.className = 'pisi-notifications';
    region.setAttribute('aria-label', pisiNotifyTranslate('Bildirimler'));
    document.body.appendChild(region);
    pisiNotificationState.region = region;
    return region;
}

function clearPisiNotifyTimer(id) {
    clearTimeout(pisiNotifyTimers.get(id));
    pisiNotifyTimers.delete(id);
}

function schedulePisiNotifyClose(item) {
    clearPisiNotifyTimer(item.id);
    if (item.duration > 0)
        pisiNotifyTimers.set(
            item.id,
            setTimeout(() => dismissPisiNotification(item.id), item.duration)
        );
}

function makePisiNotifyButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = pisiNotifyTranslate(label);
    button.addEventListener('click', onClick);
    return button;
}

function renderPisiNotification(item) {
    const strip = document.createElement('div');
    const aria = getPisiNotifyAria(item.type);
    strip.className = `pisi-notification pisi-notification-${item.type}`;
    strip.dataset.pisiNotification = item.type;
    strip.dataset.pisiNotificationId = String(item.id);
    strip.setAttribute('role', aria.role);
    strip.setAttribute('aria-live', aria.live);
    strip.setAttribute('aria-atomic', 'true');
    strip.tabIndex = -1;

    const body = document.createElement('div');
    body.className = 'pisi-notification-body';
    const message = document.createElement('span');
    message.className = 'pisi-notification-message';
    message.textContent = item.message;
    const count = document.createElement('span');
    count.className = 'pisi-notification-count';
    count.dataset.pisiNotificationCount = '';
    count.hidden = item.count < 2;
    count.textContent = `×${item.count}`;
    body.append(message, count);

    const actions = document.createElement('div');
    actions.className = 'pisi-notification-actions';
    const detail = document.createElement('pre');
    detail.className = 'pisi-notification-detail';
    detail.hidden = true;
    detail.textContent = item.detail;
    if (item.action) {
        actions.append(
            makePisiNotifyButton(item.action.label, 'pisi-notification-action', () => {
                void item.action.run();
                dismissPisiNotification(item.id);
            })
        );
    }
    if (item.type === 'error') {
        const toggle = makePisiNotifyButton('Ayrıntıyı göster', 'pisi-notification-detail-toggle', () => {
            detail.hidden = !detail.hidden;
            toggle.textContent = pisiNotifyTranslate(detail.hidden ? 'Ayrıntıyı göster' : 'Ayrıntıyı gizle');
            toggle.setAttribute('aria-expanded', String(!detail.hidden));
        });
        toggle.setAttribute('aria-expanded', 'false');
        if (!item.detail) detail.textContent = item.message;
        const copy = makePisiNotifyButton('Kopyala', 'pisi-notification-copy', async () => {
            const text = [item.message, item.detail].filter(Boolean).join('\n\n');
            try {
                await navigator.clipboard.writeText(text);
                copy.textContent = pisiNotifyTranslate('Kopyalandı');
            } catch {
                copy.textContent = pisiNotifyTranslate('Kopyalanamadı');
            }
        });
        actions.append(toggle, copy);
    }
    const close = makePisiNotifyButton('×', 'pisi-notification-close', () => dismissPisiNotification(item.id));
    close.setAttribute('aria-label', pisiNotifyTranslate('Bildirimi kapat'));
    close.title = pisiNotifyTranslate('Bildirimi kapat');

    strip.append(body, close, actions, detail);
    strip.addEventListener('mouseenter', () => clearPisiNotifyTimer(item.id));
    strip.addEventListener('mouseleave', () => schedulePisiNotifyClose(item));
    strip.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        dismissPisiNotification(item.id);
    });
    return strip;
}

/**
 * Shows a notification strip.
 * @param {{ type?: 'info'|'success'|'warning'|'error', message: unknown, detail?: unknown, duration?: number,
 *   action?: { label: string, run: Function } } | string} input
 * @returns {number|null} the strip id
 */
function pisiNotify(input) {
    const options = typeof input === 'object' && input !== null && !(input instanceof Error) ? input : { message: input };
    const message = options.message instanceof Error ? options.message.message : options.message;
    const result = pisiNotifyQueue.push({
        ...options,
        message: pisiNotifyTranslate(message),
        action: options.action ? { ...options.action, label: pisiNotifyTranslate(options.action.label) } : null
    });
    if (!result.item) return null;
    const region = ensurePisiNotifyRegion();
    for (const removed of result.removed) {
        clearPisiNotifyTimer(removed.id);
        pisiNotifyElements.get(removed.id)?.remove();
        pisiNotifyElements.delete(removed.id);
    }
    if (result.merged) {
        const strip = pisiNotifyElements.get(result.item.id);
        const count = strip?.querySelector('[data-pisi-notification-count]');
        if (count) {
            count.hidden = false;
            count.textContent = `×${result.item.count}`;
        }
    } else {
        const strip = renderPisiNotification(result.item);
        pisiNotifyElements.set(result.item.id, strip);
        region.appendChild(strip);
    }
    schedulePisiNotifyClose(result.item);
    document.dispatchEvent(new CustomEvent('pisi:notification', { detail: { id: result.item.id, type: result.item.type, merged: result.merged } }));
    return result.item.id;
}

const withType =
    (type) =>
    (message, options = {}) =>
        pisiNotify({ ...options, type, message });
const pisiNotifyInfo = withType('info');
const pisiNotifySuccess = withType('success');
const pisiNotifyWarning = withType('warning');
const pisiNotifyError = withType('error');

function dismissPisiNotification(id) {
    clearPisiNotifyTimer(id);
    pisiNotifyQueue.remove(id);
    pisiNotifyElements.get(id)?.remove();
    pisiNotifyElements.delete(id);
}

function clearPisiNotifications() {
    for (const item of pisiNotifyQueue.clear()) dismissPisiNotification(item.id);
}

/** Error strip for a note that could not be saved, with a link to its version history and backups. */
function pisiNotifyNoteSaveError(message, nodePath, detail = '') {
    return pisiNotify({
        type: 'error',
        message,
        detail,
        action: nodePath ? { label: 'Sürüm geçmişini aç', run: () => openPisiHistoryDialog(null, nodePath) } : null
    });
}

const PISI_PROGRESS_LABELS = Object.freeze({ integrity: 'Bütünlük taraması', export: 'Markdown dışa aktarma' });
const pisiProgressStrips = new Map();

function formatPisiProgressNumber(value) {
    const locale = window.pisiI18n?.getLanguage?.() === 'eng' ? 'en-US' : 'tr-TR';
    return Number(value || 0).toLocaleString(locale);
}

/**
 * One info strip per long operation, updated in place ("Bütünlük taraması: 2.300 / 10.000").
 * It closes shortly after the last step.
 */
function pisiNotifyProgress(operation, done, total) {
    const label = pisiNotifyTranslate(PISI_PROGRESS_LABELS[operation] || operation);
    const text = `${label}: ${formatPisiProgressNumber(done)} / ${formatPisiProgressNumber(total)}`;
    let id = pisiProgressStrips.get(operation);
    if (id && !pisiNotifyElements.has(id)) id = null;
    if (!id) {
        id = pisiNotify({ type: 'info', message: text, duration: 10 * 60 * 1000 });
        if (!id) return null;
        pisiProgressStrips.set(operation, id);
        pisiNotifyElements.get(id)?.setAttribute('data-pisi-progress', operation);
    } else {
        const strip = pisiNotifyElements.get(id);
        const message = strip?.querySelector('.pisi-notification-message');
        if (message) message.textContent = text;
    }
    if (Number(done) >= Number(total)) {
        pisiProgressStrips.delete(operation);
        const finished = id;
        setTimeout(() => dismissPisiNotification(finished), 1500);
    }
    return id;
}

window.pisiProgress?.onProgress?.((payload = {}) => {
    if (typeof payload.operation !== 'string') return;
    pisiNotifyProgress(payload.operation, Number(payload.done) || 0, Number(payload.total) || 0);
});

const moduleApi = {
    pisiNotificationState,
    pisiNotifyProgress,
    pisiNotify,
    pisiNotifyInfo,
    pisiNotifySuccess,
    pisiNotifyWarning,
    pisiNotifyError,
    pisiNotifyNoteSaveError,
    dismissPisiNotification,
    clearPisiNotifications
};

registerModule('shell.notifications', moduleApi);

export { pisiNotify, pisiNotifyError, pisiNotifyInfo, pisiNotifyNoteSaveError, pisiNotifySuccess, pisiNotifyWarning };
