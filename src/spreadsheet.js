export function columnName(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export function parseCellKey(key) {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(String(key).trim());
  if (!match) return null;
  let column = 0;
  for (const char of match[1].toUpperCase()) {
    column = column * 26 + char.charCodeAt(0) - 64;
  }
  return { row: Number(match[2]) - 1, col: column - 1 };
}

export function rangeKeys(start, end) {
  const a = parseCellKey(start);
  const b = parseCellKey(end);
  if (!a || !b) return [];
  const keys = [];
  for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row += 1) {
    for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col += 1) {
      keys.push(`${columnName(col)}${row + 1}`);
    }
  }
  return keys;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '#HATA';
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(8)));
}

export function evaluateSheet(cells = {}) {
  const memo = new Map();

  const resolve = (key, stack = new Set()) => {
    const normalizedKey = String(key).toUpperCase();
    if (memo.has(normalizedKey)) return memo.get(normalizedKey);
    if (stack.has(normalizedKey)) return '#DÖNGÜ';

    const raw = String(cells[normalizedKey] ?? '').trim();
    if (!raw) return '';
    if (!raw.startsWith('=')) return raw;

    const nextStack = new Set(stack);
    nextStack.add(normalizedKey);
    let expression = raw.slice(1).toUpperCase().replaceAll(',', '.');

    expression = expression.replace(
      /\b(SUM|AVERAGE|MIN|MAX)\s*\(\s*([A-Z]+\d+)\s*:\s*([A-Z]+\d+)\s*\)/g,
      (_, functionName, start, end) => {
        const values = rangeKeys(start, end).map((cellKey) => {
          const result = resolve(cellKey, nextStack);
          if (String(result).startsWith('#')) return result;
          const number = Number(result);
          return Number.isFinite(number) ? number : 0;
        });
        const error = values.find((value) => String(value).startsWith('#'));
        if (error) return error;
        if (functionName === 'SUM') return String(values.reduce((sum, value) => sum + value, 0));
        if (functionName === 'AVERAGE') {
          return String(values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
        }
        if (functionName === 'MIN') return String(values.length ? Math.min(...values) : 0);
        return String(values.length ? Math.max(...values) : 0);
      }
    );

    expression = expression.replace(/\b([A-Z]+\d+)\b/g, (_, reference) => {
      const result = resolve(reference, nextStack);
      if (String(result).startsWith('#')) return result;
      const number = Number(result);
      return Number.isFinite(number) ? String(number) : '0';
    });

    if (expression.includes('#DÖNGÜ')) return '#DÖNGÜ';
    if (expression.includes('#HATA') || !/^[\d+\-*/().\s]+$/.test(expression)) return '#HATA';

    try {
      // Buraya yalnızca rakamlar ve aritmetik operatörler ulaşabilir.
      const value = Function(`"use strict"; return (${expression});`)();
      const result = formatNumber(Number(value));
      memo.set(normalizedKey, result);
      return result;
    } catch {
      return '#HATA';
    }
  };

  const output = {};
  Object.keys(cells).forEach((key) => {
    output[key.toUpperCase()] = resolve(key);
  });
  return output;
}

