// Settings → Sync → "Pair with desktop" (docs/sync-plan.md S5 step 3). The
// screen is built once and updated in place, so the fields keep their focus
// and text while the pairing moves on. Steps:
//   choose    scan the QR (only in the app) or pair with the code
//   code      server address, short code and this device's name
//   claiming  the claim is on its way
//   confirm   code path: the verification number both screens show, waiting for the desktop
//   waiting   QR path: waiting for the desktop's confirmation
//   done      bound; the first sync has started
//   failed    what went wrong, and "Try again"
// Leaving the screen (back button) gives the pairing up on this phone.

import { renderButton } from '../../ui/button.mjs';
import { h } from '../../ui/dom.mjs';
import { renderTextField } from '../../ui/field.mjs';

const KNOWN_ERRORS = new Set([
    'PAIRING_NOT_FOUND',
    'PAIRING_CODE_INVALID',
    'PAIRING_EXPIRED',
    'PAIRING_REJECTED',
    'PAIRING_STATE',
    'PAIRING_QR_INVALID',
    'PAIRING_KEY_MISMATCH',
    'BAD_SERVER_URL',
    'OFFLINE',
    'RATE_LIMITED'
]);

/** The message for a pairing error code. */
export function describePairingError(t, code) {
    return KNOWN_ERRORS.has(code) ? t(`pair.error.${code}`) : t('pair.error.generic', { code: code || '—' });
}

/**
 * `service` is the sync service, `scanner` the QR scanner (null in a browser),
 * `onDone()` goes back to Settings.
 */
export function createSyncPairScreen({ service, scanner = null, onDone, onError = () => {} }) {
    const element = h('section', { class: 'pisi-screen pisi-pair', dataset: { screen: 'sync-pair' } });
    const live = h('div', { class: 'pisi-pair-body', 'aria-live': 'polite' });
    element.append(live);
    let t = (key) => key;
    let drawnWith = null;
    let step = 'choose';
    let sas = null;
    let errorCode = null;
    let spaceName = '';
    const form = { serverUrl: '', code: '', deviceName: '' };
    let generation = 0;

    function go(next) {
        step = next;
        draw();
    }

    async function start(method, uri = '') {
        const own = (generation += 1);
        errorCode = null;
        go('claiming');
        try {
            const deviceName = form.deviceName.trim() || t('pair.defaultDeviceName');
            const claimed = await service.startPairing({ method, uri, serverUrl: form.serverUrl, code: form.code, deviceName });
            if (own !== generation) return;
            sas = claimed.sas;
            go(method === 'qr' ? 'waiting' : 'confirm');
            const status = await claimed.wait();
            if (own !== generation) return;
            spaceName = status.spaceName || '';
            go('done');
        } catch (error) {
            if (own !== generation || error?.code === 'PAIRING_CANCELLED') return;
            if (!error?.code) onError(error);
            errorCode = error?.code || 'PAIRING_FAILED';
            go('failed');
        }
    }

    async function scan() {
        const text = await scanner.scan({ instructions: t('pair.scanInstructions') });
        if (text) await start('qr', text);
    }

    function stepContent() {
        const action = (label, variant, id, onClick) => renderButton({ label, variant, block: true, dataset: { action: id }, onClick });
        const cancel = () =>
            action(t('pair.cancel'), 'text', 'cancel-pairing', () => {
                generation += 1;
                service.cancelPairing();
                go('choose');
            });
        switch (step) {
            case 'choose':
                return [
                    h('p', { class: 'pisi-pair-text' }, t('pair.intro')),
                    scanner ? action(t('pair.scan'), 'primary', 'scan-qr', () => void scan()) : null,
                    action(t('pair.useCode'), scanner ? 'secondary' : 'primary', 'use-code', () => go('code'))
                ];
            case 'code': {
                const fields = h(
                    'form',
                    {
                        class: 'pisi-pair-form',
                        novalidate: true,
                        onSubmit: (event) => {
                            event.preventDefault();
                            void start('code');
                        }
                    },
                    renderTextField({
                        id: 'pair-server',
                        label: t('pair.server'),
                        value: form.serverUrl,
                        placeholder: 'sync.ornek.com',
                        hint: t('pair.serverHint'),
                        onInput: (value) => (form.serverUrl = value)
                    }),
                    renderTextField({
                        id: 'pair-code',
                        label: t('pair.code'),
                        value: form.code,
                        placeholder: 'XXXX-XXXX',
                        hint: t('pair.codeHint'),
                        onInput: (value) => (form.code = value)
                    }),
                    renderTextField({
                        id: 'pair-name',
                        label: t('pair.deviceName'),
                        value: form.deviceName || t('pair.defaultDeviceName'),
                        onInput: (value) => (form.deviceName = value)
                    }),
                    renderButton({
                        label: t('pair.connect'),
                        variant: 'primary',
                        block: true,
                        dataset: { action: 'connect' },
                        onClick: () => void start('code')
                    })
                );
                for (const [id, attributes] of [
                    ['pair-server', { inputmode: 'url', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' }],
                    ['pair-code', { autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'go' }]
                ]) {
                    const input = fields.querySelector(`#${id}`);
                    for (const [name, value] of Object.entries(attributes)) input.setAttribute(name, value);
                }
                return [fields];
            }
            case 'claiming':
                return [h('p', { class: 'pisi-pair-text', role: 'status', dataset: { pair: 'claiming' } }, t('pair.connecting'))];
            case 'confirm':
                return [
                    h('h2', { class: 'pisi-section-title' }, t('pair.sasTitle')),
                    h('p', { class: 'pisi-pair-sas', dataset: { pair: 'sas' } }, sas),
                    h('p', { class: 'pisi-pair-text' }, t('pair.sasQuestion')),
                    h('p', { class: 'pisi-pair-wait', role: 'status' }, t('pair.waiting')),
                    cancel()
                ];
            case 'waiting':
                return [
                    h('p', { class: 'pisi-pair-text', dataset: { pair: 'waiting' } }, t('pair.waitingQr')),
                    h('p', { class: 'pisi-pair-wait', role: 'status' }, t('pair.waiting')),
                    cancel()
                ];
            case 'done':
                return [
                    h('h2', { class: 'pisi-section-title', dataset: { pair: 'done' } }, t('pair.done')),
                    h('p', { class: 'pisi-pair-text' }, t('pair.doneNote', { name: spaceName || t('project.defaultName') })),
                    action(t('pair.back'), 'primary', 'pair-done', () => onDone())
                ];
            default:
                return [
                    h('p', { class: 'pisi-notice', role: 'alert', dataset: { pair: 'failed', code: errorCode || '' } }, describePairingError(t, errorCode)),
                    action(t('pair.retry'), 'primary', 'retry-pairing', () => go(errorCode === 'PAIRING_QR_INVALID' ? 'choose' : 'code')),
                    action(t('pair.cancel'), 'text', 'cancel-pairing', () => go('choose'))
                ];
        }
    }

    function draw() {
        drawnWith = { t, step };
        live.replaceChildren(...stepContent().filter(Boolean));
        live.dataset.step = step;
        const first = step === 'code' ? live.querySelector('#pair-server') : null;
        if (first && !form.serverUrl) first.focus();
    }

    return {
        element,
        getStep: () => step,
        update(context) {
            t = context.t;
            if (!form.serverUrl && context.serverUrl) form.serverUrl = context.serverUrl;
            if (drawnWith?.t !== t || drawnWith?.step !== step) draw();
        },
        /** The screen was left: the pairing is given up on this phone and the screen starts over next time. */
        leave() {
            if (step === 'choose' && !drawnWith) return;
            generation += 1;
            service.cancelPairing();
            step = 'choose';
            errorCode = null;
            sas = null;
            drawnWith = null;
        },
        destroy() {
            generation += 1;
            service.cancelPairing();
        }
    };
}
