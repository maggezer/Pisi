import { registerModule } from '../core/module-registry.mjs';
import { encodePisiSyncQr, getPisiSyncQrPath } from './pisi-sync-qr.mjs';

// Pairing window of Pisi Sync (docs/sync-plan.md S3 step 4, docs/sync-protocol.md §6.6):
// the QR, the short code and the time left. When a device claims the pairing its
// name appears; on the code path both screens show the six-digit verification
// number and the user answers "Aynı" or "Farklı". Nothing is granted without the
// user's answer, and closing the window cancels the pairing.

const PISI_SYNC_PAIRING_POLL_MS = 2000;
const pisiSyncPairingState = { dialog: null, pairingId: null, pollTimer: null, clockTimer: null, expiresAt: 0, finished: false };

function pisiSyncPairingTranslate(value) {
    return window.pisiT?.(value) ?? String(value ?? '');
}

function ensurePisiSyncStyles() {
    if (document.querySelector('link[data-pisi-sync-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'renderer/sync/pisi-sync.css';
    link.dataset.pisiSyncStyle = '1';
    document.head.appendChild(link);
}

function makePisiSyncElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = pisiSyncPairingTranslate(text);
    return element;
}

function renderPisiSyncQr(container, uri) {
    const qr = encodePisiSyncQr(uri);
    const size = qr.size + 8;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', pisiSyncPairingTranslate('Eşleştirme QR kodu'));
    svg.setAttribute('shape-rendering', 'crispEdges');
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('width', String(size));
    background.setAttribute('height', String(size));
    background.setAttribute('fill', '#ffffff');
    const modules = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    modules.setAttribute('d', getPisiSyncQrPath(qr));
    modules.setAttribute('fill', '#000000');
    svg.append(background, modules);
    container.replaceChildren(svg);
}

function formatPisiSyncRemaining(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function stopPisiSyncPairingTimers() {
    clearTimeout(pisiSyncPairingState.pollTimer);
    clearInterval(pisiSyncPairingState.clockTimer);
    pisiSyncPairingState.pollTimer = null;
    pisiSyncPairingState.clockTimer = null;
}

function setPisiSyncPairingStage(stage, text = '') {
    const dialog = pisiSyncPairingState.dialog;
    if (!dialog) return;
    dialog.querySelector('.pisi-sync-pairing').dataset.stage = stage;
    const message = dialog.querySelector('[data-pisi-sync-pairing-message]');
    if (message) message.textContent = pisiSyncPairingTranslate(text);
}

function showPisiSyncClaim(view) {
    const dialog = pisiSyncPairingState.dialog;
    if (!dialog) return;
    const claim = dialog.querySelector('[data-pisi-sync-pairing-claim]');
    claim.hidden = false;
    dialog.querySelector('[data-pisi-sync-pairing-device]').textContent =
        `${view.name || pisiSyncPairingTranslate('Adsız cihaz')} ${pisiSyncPairingTranslate('bağlanmak istiyor')}`;
    const role = view.role === 'admin' ? 'Masaüstü (tam yetki: silme ve eşleştirme)' : 'Telefon (silme yapamaz)';
    dialog.querySelector('[data-pisi-sync-pairing-role]').textContent = `${pisiSyncPairingTranslate('Rol')}: ${pisiSyncPairingTranslate(role)}`;
    const sas = dialog.querySelector('[data-pisi-sync-pairing-sas]');
    sas.hidden = !view.sas;
    sas.querySelector('strong').textContent = view.sas || '';
    dialog.querySelector('[data-pisi-sync-pairing-accept]').textContent = pisiSyncPairingTranslate(view.sas ? 'Aynı' : 'Onayla');
    dialog.querySelector('[data-pisi-sync-pairing-reject]').textContent = pisiSyncPairingTranslate(view.sas ? 'Farklı' : 'Reddet');
    setPisiSyncPairingStage('claimed', view.sas ? 'Bu sayı öbür cihazda da görünüyor mu?' : 'Bu cihazı tanıyorsanız onaylayın.');
}

async function pollPisiSyncPairingOnce() {
    const pairingId = pisiSyncPairingState.pairingId;
    if (!pairingId || pisiSyncPairingState.finished) return;
    const view = await window.pisiSyncClient?.pairingStatus?.(pairingId);
    if (pisiSyncPairingState.pairingId !== pairingId || pisiSyncPairingState.finished) return;
    if (!view?.ok) {
        setPisiSyncPairingStage('error', window.describePisiSyncCode?.(view?.code) || 'Eşleştirme durumu alınamadı.');
    } else if (view.state === 'claimed') {
        showPisiSyncClaim(view);
        return;
    } else if (view.state === 'rejected' && view.invalid) {
        finishPisiSyncPairing('error', 'QR doğrulaması tutmadı; istek reddedildi.');
        return;
    } else if (view.state === 'expired') {
        finishPisiSyncPairing('expired', 'Eşleştirmenin süresi doldu.');
        return;
    } else if (!['open'].includes(view.state)) {
        finishPisiSyncPairing('done', 'Eşleştirme kapandı.');
        return;
    }
    pisiSyncPairingState.pollTimer = setTimeout(() => void pollPisiSyncPairingOnce(), PISI_SYNC_PAIRING_POLL_MS);
}

function finishPisiSyncPairing(stage, text) {
    pisiSyncPairingState.finished = true;
    stopPisiSyncPairingTimers();
    setPisiSyncPairingStage(stage, text);
    const claim = pisiSyncPairingState.dialog?.querySelector('[data-pisi-sync-pairing-claim]');
    if (claim) claim.hidden = true;
}

async function answerPisiSyncPairing(accept) {
    const pairingId = pisiSyncPairingState.pairingId;
    if (!pairingId) return;
    stopPisiSyncPairingTimers();
    const result = await window.pisiSyncClient?.confirmPairing?.(pairingId, accept);
    if (!result?.ok) {
        finishPisiSyncPairing('error', window.describePisiSyncCode?.(result?.code) || 'Eşleştirme tamamlanamadı.');
        return;
    }
    finishPisiSyncPairing(accept ? 'granted' : 'rejected', accept ? 'Cihaz eşleştirildi.' : 'İstek reddedildi.');
    document.dispatchEvent(new CustomEvent('pisi:sync-devices-changed'));
}

function closePisiSyncPairingDialog() {
    const { dialog, pairingId, finished } = pisiSyncPairingState;
    stopPisiSyncPairingTimers();
    pisiSyncPairingState.dialog = null;
    pisiSyncPairingState.pairingId = null;
    if (pairingId && !finished) void window.pisiSyncClient?.cancelPairing?.(pairingId);
    dialog?.remove();
}

function buildPisiSyncPairingDialog() {
    const overlay = makePisiSyncElement('div', 'pisi-sync-dialog-overlay');
    const dialog = makePisiSyncElement('section', 'pisi-sync-dialog pisi-sync-pairing');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = makePisiSyncElement('h2', '', 'Cihaz eşleştir');
    title.id = 'pisi-sync-pairing-title';
    dialog.setAttribute('aria-labelledby', title.id);
    const close = makePisiSyncElement('button', 'pisi-sync-dialog-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', pisiSyncPairingTranslate('Kapat'));
    const hint = makePisiSyncElement('p', 'pisi-sync-muted', 'Telefonda Ayarlar → Senkron → "Masaüstüyle eşleştir" ile QR kodu okutun ya da kodu girin.');
    const qr = makePisiSyncElement('div', 'pisi-sync-qr');
    qr.dataset.pisiSyncPairingQr = '';
    const code = makePisiSyncElement('p', 'pisi-sync-code');
    code.dataset.pisiSyncPairingCode = '';
    const clock = makePisiSyncElement('p', 'pisi-sync-muted');
    clock.dataset.pisiSyncPairingClock = '';
    const message = makePisiSyncElement('p', 'pisi-sync-message');
    message.dataset.pisiSyncPairingMessage = '';
    message.setAttribute('role', 'status');
    const claim = makePisiSyncElement('div', 'pisi-sync-claim');
    claim.dataset.pisiSyncPairingClaim = '';
    claim.hidden = true;
    const device = makePisiSyncElement('p', 'pisi-sync-claim-device');
    device.dataset.pisiSyncPairingDevice = '';
    const role = makePisiSyncElement('p', 'pisi-sync-muted');
    role.dataset.pisiSyncPairingRole = '';
    const sas = makePisiSyncElement('p', 'pisi-sync-sas', 'Doğrulama numarası');
    sas.dataset.pisiSyncPairingSas = '';
    sas.hidden = true;
    sas.append(' ', document.createElement('strong'));
    const actions = makePisiSyncElement('div', 'pisi-portable-actions');
    const accept = makePisiSyncElement('button', 'pisi-secondary-button', 'Onayla');
    accept.type = 'button';
    accept.dataset.pisiSyncPairingAccept = '';
    const reject = makePisiSyncElement('button', 'pisi-secondary-button', 'Reddet');
    reject.type = 'button';
    reject.dataset.pisiSyncPairingReject = '';
    actions.append(accept, reject);
    claim.append(device, role, sas, actions);
    dialog.append(close, title, hint, qr, code, clock, claim, message);
    overlay.append(dialog);
    close.addEventListener('click', closePisiSyncPairingDialog);
    overlay.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closePisiSyncPairingDialog();
    });
    accept.addEventListener('click', () => void answerPisiSyncPairing(true));
    reject.addEventListener('click', () => void answerPisiSyncPairing(false));
    return overlay;
}

/** Opens the pairing window and starts a pairing on the server. */
async function openPisiSyncPairingDialog() {
    if (pisiSyncPairingState.dialog) return false;
    ensurePisiSyncStyles();
    const overlay = buildPisiSyncPairingDialog();
    document.body.append(overlay);
    pisiSyncPairingState.dialog = overlay;
    pisiSyncPairingState.finished = false;
    setPisiSyncPairingStage('starting', 'Eşleştirme başlatılıyor…');
    overlay.querySelector('.pisi-sync-dialog-close')?.focus();
    const started = await window.pisiSyncClient?.startPairing?.();
    if (pisiSyncPairingState.dialog !== overlay) {
        if (started?.ok) void window.pisiSyncClient?.cancelPairing?.(started.pairingId);
        return false;
    }
    if (!started?.ok) {
        finishPisiSyncPairing('error', window.describePisiSyncCode?.(started?.code) || 'Eşleştirme başlatılamadı.');
        return false;
    }
    pisiSyncPairingState.pairingId = started.pairingId;
    pisiSyncPairingState.expiresAt = Date.parse(started.expiresAt) || Date.now() + 600000;
    renderPisiSyncQr(overlay.querySelector('[data-pisi-sync-pairing-qr]'), started.uri);
    overlay.querySelector('[data-pisi-sync-pairing-code]').textContent = started.code;
    const clock = overlay.querySelector('[data-pisi-sync-pairing-clock]');
    const tick = () => {
        const left = pisiSyncPairingState.expiresAt - Date.now();
        clock.textContent = `${pisiSyncPairingTranslate('Kalan süre')}: ${formatPisiSyncRemaining(left)}`;
        if (left <= 0 && overlay.querySelector('.pisi-sync-pairing').dataset.stage === 'open') finishPisiSyncPairing('expired', 'Eşleştirmenin süresi doldu.');
    };
    tick();
    pisiSyncPairingState.clockTimer = setInterval(tick, 1000);
    setPisiSyncPairingStage('open', 'Telefon bekleniyor…');
    void pollPisiSyncPairingOnce();
    return true;
}

const moduleApi = {
    pisiSyncPairingState,
    openPisiSyncPairingDialog,
    closePisiSyncPairingDialog,
    ensurePisiSyncStyles
};

registerModule('sync.pairing', moduleApi);
