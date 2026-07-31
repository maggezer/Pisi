function pisiSheetColumnName(index) {
    let name = '';
    let value = Number(index) + 1;

    while (value > 0) {
        const remainder = (value - 1) % 26;
        name = String.fromCharCode(65 + remainder) + name;
        value = Math.floor((value - 1) / 26);
    }

    return name;
}

function parsePisiSheetReference(reference) {
    const match = String(reference || '').toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;

    const col = match[1].split('').reduce((sum, character) => {
        return sum * 26 + character.charCodeAt(0) - 64;
    }, 0) - 1;

    return {
        col,
        row: Number(match[2]) - 1
    };
}

function transformPisiSheetReference(reference, change) {
    const parsed = parsePisiSheetReference(reference);
    if (!parsed || !change) return reference;

    let { row, col } = parsed;
    const index = Math.max(0, Number(change.index) || 0);
    const count = Math.max(1, Number(change.count) || 1);

    if (change.type === 'insert-row' && row >= index) row += count;
    if (change.type === 'insert-col' && col >= index) col += count;

    if (change.type === 'delete-row') {
        if (row >= index && row < index + count) return '#REF!';
        if (row >= index + count) row -= count;
    }

    if (change.type === 'delete-col') {
        if (col >= index && col < index + count) return '#REF!';
        if (col >= index + count) col -= count;
    }

    return `${pisiSheetColumnName(col)}${row + 1}`;
}

export function transformPisiSheetFormulaReferences(formula, change) {
    return String(formula || '').replace(/\b([A-Z]+\d+)\b/gi, (reference) => {
        return transformPisiSheetReference(reference.toUpperCase(), change);
    });
}
