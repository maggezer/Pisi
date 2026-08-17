const PISI_INLINE_TEXT_COMMANDS = Object.freeze([
    'bold',
    'italic',
    'underline',
    'strikeThrough'
]);

function isPisiInlineTextCommand(command) {
    return PISI_INLINE_TEXT_COMMANDS.includes(String(command || ''));
}

function parsePisiFontWeight(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'bold' || normalized === 'bolder') return 700;
    if (normalized === 'normal' || normalized === 'lighter') return 400;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : 400;
}

function parsePisiTextDecorations(style = {}) {
    const raw = String(
        style.textDecorationLine ||
        style.textDecoration ||
        ''
    ).toLowerCase();
    const values = new Set();
    if (raw.includes('underline')) values.add('underline');
    if (raw.includes('line-through')) values.add('line-through');
    return values;
}

function resolvePisiInlineTextMutation(command, style = {}) {
    const normalized = String(command || '');

    if (normalized === 'bold') {
        return {
            property: 'fontWeight',
            value: parsePisiFontWeight(style.fontWeight) >= 600 ? '400' : '700'
        };
    }

    if (normalized === 'italic') {
        return {
            property: 'fontStyle',
            value: String(style.fontStyle || '').toLowerCase() === 'italic'
                ? 'normal'
                : 'italic'
        };
    }

    if (normalized === 'underline' || normalized === 'strikeThrough') {
        const decorations = parsePisiTextDecorations(style);
        const target = normalized === 'underline' ? 'underline' : 'line-through';
        if (decorations.has(target)) decorations.delete(target);
        else decorations.add(target);
        return {
            property: 'textDecoration',
            value: decorations.size ? Array.from(decorations).join(' ') : 'none'
        };
    }

    return null;
}

export {
    PISI_INLINE_TEXT_COMMANDS,
    isPisiInlineTextCommand,
    parsePisiFontWeight,
    parsePisiTextDecorations,
    resolvePisiInlineTextMutation
};
