// Pure reference transformation keeps structural edits testable without a DOM.
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
    const match = String(reference || '')
        .toUpperCase()
        .match(/^(\$?)([A-Z]+)(\$?)(\d+)$/);

    if (!match) return null;

    const col = match[2].split('').reduce((sum, character) => {
        return sum * 26 + character.charCodeAt(0) - 64;
    }, 0) - 1;

    return {
        col,
        row: Number(match[4]) - 1,
        absoluteCol: match[1] === '$',
        absoluteRow: match[3] === '$'
    };
}

function formatPisiSheetReference(reference) {
    if (!reference || reference.row < 0 || reference.col < 0) {
        return '#REF!';
    }

    return [
        reference.absoluteCol ? '$' : '',
        pisiSheetColumnName(reference.col),
        reference.absoluteRow ? '$' : '',
        reference.row + 1
    ].join('');
}

function transformPisiSheetAxisValue(value, change) {
    const index = Math.max(0, Number(change.index) || 0);
    const count = Math.max(1, Number(change.count) || 1);

    if (change.mode === 'insert') {
        return value >= index ? value + count : value;
    }

    if (change.mode === 'delete') {
        const deleteEnd = index + count - 1;
        if (value >= index && value <= deleteEnd) return null;
        return value > deleteEnd ? value - count : value;
    }

    return value;
}

function transformPisiSheetAxisRange(start, end, change) {
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    const ascending = start <= end;
    const index = Math.max(0, Number(change.index) || 0);
    const count = Math.max(1, Number(change.count) || 1);

    if (change.mode === 'insert') {
        const nextStart = transformPisiSheetAxisValue(start, change);
        const nextEnd = transformPisiSheetAxisValue(end, change);
        return [nextStart, nextEnd];
    }

    if (change.mode !== 'delete') return [start, end];

    const deleteEnd = index + count - 1;

    if (deleteEnd < low) {
        return [start - count, end - count];
    }

    if (index > high) {
        return [start, end];
    }

    if (index <= low && deleteEnd >= high) {
        return null;
    }

    const firstSurvivor = low < index
        ? low
        : Math.max(low, deleteEnd + 1);
    const lastSurvivor = high > deleteEnd
        ? high
        : Math.min(high, index - 1);

    if (firstSurvivor > lastSurvivor) return null;

    const mapSurvivor = (value) => (
        value > deleteEnd ? value - count : value
    );
    const mappedLow = mapSurvivor(firstSurvivor);
    const mappedHigh = mapSurvivor(lastSurvivor);

    return ascending
        ? [mappedLow, mappedHigh]
        : [mappedHigh, mappedLow];
}

function getPisiSheetReorderedColumnIndex(col, change) {
    const indexMap = Array.isArray(change?.indexMap)
        ? change.indexMap
        : [];

    const mapped = Number(indexMap[col]);

    return Number.isInteger(mapped) && mapped >= 0
        ? mapped
        : col;
}

function transformPisiSheetReorderedReference(reference, change) {
    const parsed = parsePisiSheetReference(reference);
    if (!parsed) return reference;

    return formatPisiSheetReference({
        ...parsed,
        col: getPisiSheetReorderedColumnIndex(
            parsed.col,
            change
        )
    });
}

function transformPisiSheetReorderedRange(
    startRef,
    endRef,
    change
) {
    const start = parsePisiSheetReference(startRef);
    const end = parsePisiSheetReference(endRef);

    if (!start || !end) {
        return String(startRef) + ':' + String(endRef);
    }

    const colStart = Math.min(start.col, end.col);
    const colEnd = Math.max(start.col, end.col);
    const mappedCols = [];

    for (
        let col = colStart;
        col <= colEnd;
        col += 1
    ) {
        mappedCols.push(
            getPisiSheetReorderedColumnIndex(
                col,
                change
            )
        );
    }

    mappedCols.sort((a, b) => a - b);

    const groups = [];

    for (const col of mappedCols) {
        const current = groups.at(-1);

        if (
            current &&
            col === current.end + 1
        ) {
            current.end = col;
        } else {
            groups.push({
                start: col,
                end: col
            });
        }
    }

    return groups.map((group) => {
        const nextStart = {
            ...start,
            col: group.start
        };
        const nextEnd = {
            ...end,
            col: group.end
        };

        return [
            formatPisiSheetReference(nextStart),
            formatPisiSheetReference(nextEnd)
        ].join(':');
    }).join(',');
}

function getPisiSheetAxisChange(change) {
    if (!change) return null;

    if (change.type === 'insert-row') {
        return { axis: 'row', mode: 'insert', ...change };
    }
    if (change.type === 'delete-row') {
        return { axis: 'row', mode: 'delete', ...change };
    }
    if (change.type === 'insert-col') {
        return { axis: 'col', mode: 'insert', ...change };
    }
    if (change.type === 'delete-col') {
        return { axis: 'col', mode: 'delete', ...change };
    }

    return null;
}

function transformPisiSheetReference(reference, change) {
    if (change?.type === 'reorder-col') {
        return transformPisiSheetReorderedReference(
            reference,
            change
        );
    }

    const parsed = parsePisiSheetReference(reference);
    const axisChange = getPisiSheetAxisChange(change);

    if (!parsed || !axisChange) return reference;

    const next = { ...parsed };
    const value = next[axisChange.axis];
    const transformed = transformPisiSheetAxisValue(
        value,
        axisChange
    );

    if (transformed === null) return '#REF!';

    next[axisChange.axis] = transformed;
    return formatPisiSheetReference(next);
}

function transformPisiSheetRangeReference(startRef, endRef, change) {
    if (change?.type === 'reorder-col') {
        return transformPisiSheetReorderedRange(
            startRef,
            endRef,
            change
        );
    }

    const start = parsePisiSheetReference(startRef);
    const end = parsePisiSheetReference(endRef);
    const axisChange = getPisiSheetAxisChange(change);

    if (!start || !end || !axisChange) {
        return `${startRef}:${endRef}`;
    }

    const transformedRange = transformPisiSheetAxisRange(
        start[axisChange.axis],
        end[axisChange.axis],
        axisChange
    );

    if (!transformedRange) return '#REF!';

    const nextStart = { ...start };
    const nextEnd = { ...end };
    nextStart[axisChange.axis] = transformedRange[0];
    nextEnd[axisChange.axis] = transformedRange[1];

    return [
        formatPisiSheetReference(nextStart),
        formatPisiSheetReference(nextEnd)
    ].join(':');
}

export function transformPisiSheetFormulaReferences(formula, change) {
    const source = String(formula || '');

    return source.replace(
        /"(?:[^"]|"")*"|(?<![A-Z0-9_.$])\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?(?![A-Z0-9_.$]|\s*\()/gi,
        (token) => {
            if (token.startsWith('"')) return token;

            const parts = token.split(':');
            if (parts.length === 2) {
                return transformPisiSheetRangeReference(
                    parts[0].toUpperCase(),
                    parts[1].toUpperCase(),
                    change
                );
            }

            return transformPisiSheetReference(
                token.toUpperCase(),
                change
            );
        }
    );
}
