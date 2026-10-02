import { registerModule } from '../core/module-registry.mjs';

function pisiConfirm(message, options = {}) {
    return new Promise((resolve) => {
        document.getElementById('pisi-confirm-overlay')?.remove();
        const previouslyFocused = document.activeElement;

        const overlay = document.createElement('div');
        overlay.id = 'pisi-confirm-overlay';

        const title = escapePisiConfirmText(options.title || 'Onay');
        const text = escapePisiConfirmText(message || '');
        const confirmText = escapePisiConfirmText(options.confirmText || 'Tamam');
        const cancelText = escapePisiConfirmText(options.cancelText || 'Vazgeç');

        overlay.innerHTML = `
            <div
                id="pisi-confirm-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="pisi-confirm-title"
                aria-describedby="pisi-confirm-message"
            >
                <div id="pisi-confirm-title">${title}</div>
                <div id="pisi-confirm-message">${text}</div>

                <div id="pisi-confirm-actions">
                    <button id="pisi-confirm-cancel" type="button">${cancelText}</button>
                    <button id="pisi-confirm-ok" type="button">${confirmText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const card = overlay.querySelector('#pisi-confirm-card');
        const cancelBtn = overlay.querySelector('#pisi-confirm-cancel');
        const okBtn = overlay.querySelector('#pisi-confirm-ok');

        if (options.danger) {
            okBtn?.classList.add('danger');
        }

        let closed = false;

        function close(value) {
            if (closed) return;
            closed = true;

            document.removeEventListener('keydown', onKeyDown, true);
            overlay.remove();

            resetPisiKeyboardAndPointerState();
            if (previouslyFocused && previouslyFocused.isConnected && typeof previouslyFocused.focus === 'function') {
                previouslyFocused.focus({ preventScroll: true });
            }

            resolve(value);
        }

        function onKeyDown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(false);
                return;
            }

            if (event.key === 'Enter' && event.target === okBtn) {
                event.preventDefault();
                event.stopPropagation();
                close(true);
                return;
            }

            if (event.key === 'Enter' && event.target === cancelBtn) {
                event.preventDefault();
                event.stopPropagation();
                close(false);
                return;
            }

            if (event.key === 'Tab') {
                const focusable = [cancelBtn, okBtn].filter(Boolean);
                if (!focusable.length) return;

                const currentIndex = focusable.indexOf(document.activeElement);
                const nextIndex = event.shiftKey ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1) : (currentIndex + 1) % focusable.length;

                event.preventDefault();
                focusable[nextIndex].focus();
            }
        }

        overlay.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (event.target === overlay) {
                close(false);
            }
        });

        card?.addEventListener('mousedown', (event) => {
            event.stopPropagation();
        });

        cancelBtn?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            close(false);
        });

        okBtn?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            close(true);
        });

        document.addEventListener('keydown', onKeyDown, true);

        setTimeout(() => {
            cancelBtn?.focus({ preventScroll: true });
        }, 0);
    });
}

const moduleApi = {};
Object.defineProperties(moduleApi, {
    pisiConfirm: {
        enumerable: true,
        get() {
            return pisiConfirm;
        }
    }
});
registerModule('shell.dialogs', moduleApi);
