'use strict';

function updateToolbarLabPreviewWidth() {
    const selected = document.querySelector(
        'input[name="lab-width"]:checked'
    );

    document.body.dataset.previewWidth = selected?.value || 'wide';
}

document.querySelectorAll('input[name="lab-width"]').forEach((input) => {
    input.addEventListener('change', updateToolbarLabPreviewWidth);
});

updateToolbarLabPreviewWidth();
