// A file size for people: "840 B", "12 KB", "3,4 MB" in the app's language
// (1 KB = 1024 bytes, as the desktop's file blocks count them).

const UNITS = ['B', 'KB', 'MB', 'GB'];

export function formatByteSize(bytes, locale = 'tr-TR') {
    let value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return '—';
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const digits = unit === 0 || value >= 10 ? 0 : 1;
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value)} ${UNITS[unit]}`;
}
