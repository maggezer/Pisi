function normalizePisiWordFontFamily(value = '') {
    const first = String(value || '')
        .split(',')[0]
        .trim()
        .replace(/^['"]|['"]$/g, '');
    return first || 'Segoe UI';
}
function normalizePisiWordFontSize(value = '') {
    const parsed = Number.parseFloat(String(value || '').replace('px', ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
}
function ensurePisiWordSelectOption(select, value, label = value) {
    if (!select) return;
    const normalized = String(value);
    let option = Array.from(select.options).find((item) => item.value === normalized);
    select.querySelectorAll('option[data-pisi-word-dynamic="1"]').forEach((item) => {
        if (item.value !== normalized) item.remove();
    });
    if (!option) {
        option = document.createElement('option');
        option.value = normalized;
        option.textContent = String(label);
        option.dataset.pisiWordDynamic = '1';
        select.appendChild(option);
    }
    select.value = normalized;
}
export { normalizePisiWordFontFamily, normalizePisiWordFontSize, ensurePisiWordSelectOption };
