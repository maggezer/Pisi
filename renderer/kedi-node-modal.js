function bindNodeModalControls() {
    const closeModalBtn = document.getElementById('node-modal-close');
    const overlay = document.getElementById('node-modal-overlay');

    if (closeModalBtn && closeModalBtn.dataset.bound !== '1') {
        closeModalBtn.dataset.bound = '1';

        closeModalBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            await closeNodeModalAndSave();
        });
    }

    if (overlay && overlay.dataset.bound !== '1') {
        overlay.dataset.bound = '1';

        overlay.addEventListener('mousedown', async (event) => {
            if (event.target === overlay) {
                await closeNodeModalAndSave();
            }
        });
    }

    if (document.body.dataset.nodeModalEscBound !== '1') {
        document.body.dataset.nodeModalEscBound = '1';

        document.addEventListener('keydown', async (event) => {
            const modalOverlay = document.getElementById('node-modal-overlay');

            if (!modalOverlay?.classList.contains('visible')) {
                return;
            }

            if (event.key === 'Tab') {
                const focusable = Array.from(
                    modalOverlay.querySelectorAll(
                        'button:not([disabled]), input:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
                    )
                ).filter((element) => !element.hidden);

                if (focusable.length) {
                    const currentIndex = focusable.indexOf(document.activeElement);
                    const nextIndex = event.shiftKey
                        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
                        : (currentIndex + 1) % focusable.length;

                    event.preventDefault();
                    focusable[nextIndex].focus();
                }
                return;
            }

            if (event.key !== 'Escape') return;

            // Eğer tag menüsü açıksa ESC önce tag menüsünü kapatsın,
            // modalı kapatmasın.
            const tagMenu = document.getElementById('kedi-tag-menu');

            if (tagMenu && !tagMenu.hidden) {
                closeKediTagMenu();
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            await closeNodeModalAndSave();
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindNodeModalControls);
    } else {
    bindNodeModalControls();
}

