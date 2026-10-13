// Transform model formats without creating a DOM element for each selected cell.
export function formatPisiSheetSelection(formats, action, value = null) {
    if (!formats.length) return null;
    const cells = formats.map((format) => ({ style: { textDecorationLine: '', ...format } }));
    if (action === 'toggleBold') {
        const enable = !cells.every((cell) => {
            return cell.style.fontWeight === '700';
        });

        cells.forEach((cell) => {
            cell.style.fontWeight = enable ? '700' : '';
        });
    } else if (action === 'toggleItalic') {
        const enable = !cells.every((cell) => {
            return cell.style.fontStyle === 'italic';
        });

        cells.forEach((cell) => {
            cell.style.fontStyle = enable ? 'italic' : '';
        });
    } else if (action === 'toggleUnderline') {
        const enable = !cells.every((cell) => {
            return cell.style.textDecorationLine.split(/\s+/).includes('underline');
        });
        cells.forEach((cell) => {
            const values = new Set(cell.style.textDecorationLine.split(/\s+/).filter(Boolean));
            if (enable) values.add('underline');
            else values.delete('underline');
            cell.style.textDecorationLine = [...values].join(' ');
        });
    } else if (action === 'toggleStrikeThrough') {
        const enable = !cells.every((cell) => {
            return cell.style.textDecorationLine.split(/\s+/).includes('line-through');
        });
        cells.forEach((cell) => {
            const values = new Set(cell.style.textDecorationLine.split(/\s+/).filter(Boolean));
            if (enable) values.add('line-through');
            else values.delete('line-through');
            cell.style.textDecorationLine = [...values].join(' ');
        });
    } else if (action === 'fontFamily' && value) {
        cells.forEach((cell) => {
            cell.style.fontFamily = value;
        });
    } else if (action === 'fontSize' && value) {
        const sizes = {
            1: '8px',
            2: '10px',
            3: '12px',
            4: '14px',
            5: '18px',
            6: '24px',
            7: '32px'
        };
        const size = sizes[String(value)] || String(value);
        cells.forEach((cell) => {
            cell.style.fontSize = size;
        });
    } else if (action === 'alignLeft') {
        cells.forEach((cell) => {
            cell.style.textAlign = 'left';
        });
    } else if (action === 'alignCenter') {
        cells.forEach((cell) => {
            cell.style.textAlign = 'center';
        });
    } else if (action === 'alignRight') {
        cells.forEach((cell) => {
            cell.style.textAlign = 'right';
        });
    } else if (action === 'alignJustify') {
        cells.forEach((cell) => {
            cell.style.textAlign = 'justify';
        });
    } else if (action === 'verticalTop') {
        cells.forEach((cell) => {
            cell.style.verticalAlign = 'top';
        });
    } else if (action === 'verticalMiddle') {
        cells.forEach((cell) => {
            cell.style.verticalAlign = 'middle';
        });
    } else if (action === 'verticalBottom') {
        cells.forEach((cell) => {
            cell.style.verticalAlign = 'bottom';
        });
    } else if (action === 'toggleWrap') {
        const enable = !cells.every((cell) => {
            return cell.style.whiteSpace === 'normal';
        });

        cells.forEach((cell) => {
            cell.style.whiteSpace = enable ? 'normal' : 'nowrap';
            cell.style.overflowWrap = enable ? 'anywhere' : '';
        });
    } else if (action === 'borderAll') {
        cells.forEach((cell) => {
            cell.style.border = '1px solid rgba(127, 127, 127, 0.7)';
        });
    } else if (action === 'borderNone') {
        cells.forEach((cell) => {
            cell.style.border = '';
        });
    } else if (action === 'textColor' && value) {
        cells.forEach((cell) => {
            cell.style.color = value;
        });
    } else if (action === 'fillColor' && value) {
        cells.forEach((cell) => {
            cell.style.backgroundColor = value;
        });
    } else if (action === 'clearFormat') {
        cells.forEach((cell) => {
            cell.style.fontWeight = '';
            cell.style.fontStyle = '';
            cell.style.textDecorationLine = '';
            cell.style.fontFamily = '';
            cell.style.fontSize = '';
            cell.style.textAlign = '';
            cell.style.verticalAlign = '';
            cell.style.whiteSpace = '';
            cell.style.overflowWrap = '';
            cell.style.border = '';
            cell.style.color = '';
            cell.style.backgroundColor = '';
        });
    } else {
        return null;
    }

    return cells.map(({ style }) => Object.fromEntries(Object.entries(style).filter(([, value]) => typeof value === 'string' && value)));
}
