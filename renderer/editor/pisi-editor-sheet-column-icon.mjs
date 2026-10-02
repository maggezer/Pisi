const PISI_SHEET_FIELD_TYPE_ICONS = Object.freeze({
    text: 'Aa',
    number: '123',
    date: '◫',
    select: '▾',
    mSelect: '≡',
    checkbox: '☑',
    formula: 'fx'
});

function getPisiSheetFieldTypeIcon(type) {
    return PISI_SHEET_FIELD_TYPE_ICONS[type] || 'Aa';
}

function configurePisiSheetColumnIconControl(input, preview, field, typeSelect, onChange, translate) {
    input.type = 'text';
    input.className = 'pisi-sheet-column-icon-input';
    input.maxLength = 12;
    input.value = field.icon || '';
    input.setAttribute('aria-label', translate('İkon'));

    const sync = (type = typeSelect.value) => {
        const fallback = getPisiSheetFieldTypeIcon(type);
        input.placeholder = fallback;
        preview.textContent = input.value.trim() || fallback;
    };

    input.addEventListener('input', () => {
        sync();
    });

    input.addEventListener('change', () => {
        onChange(input.value);
    });

    sync(field.type);
    return sync;
}

export { configurePisiSheetColumnIconControl, getPisiSheetFieldTypeIcon };
