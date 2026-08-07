export const FORMULA_CATALOG = Object.freeze({
  logical: ['IF', 'AND', 'OR', 'NOT', 'XOR', 'IFERROR'],
  text: ['CONCAT', 'LEN', 'LEFT', 'RIGHT', 'MID', 'UPPER', 'LOWER', 'TRIM', 'SUBSTITUTE', 'TEXTJOIN', 'FIND', 'SEARCH', 'REPLACE', 'EXACT', 'VALUE'],
  math: ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'PRODUCT', 'MEDIAN', 'SUMSQ', 'ABS', 'SIGN', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'FLOOR', 'CEILING', 'MOD', 'POWER', 'SQRT', 'FACT', 'GCD', 'LCM'],
  scientific: ['SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN', 'ATAN2', 'SINH', 'COSH', 'TANH', 'LOG', 'LOG10', 'LOG2', 'LN', 'EXP', 'PI', 'E', 'DEGREES', 'RADIANS']
});

class FormulaError extends Error {}
const RANGE = Symbol('pisi-range');

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
  for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
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

function fail(message) {
  throw new FormulaError(message);
}

function tokenize(source) {
  const input = String(source || '');
  const tokens = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) { index += 1; continue; }
    const number = input.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    if (char === '"') {
      let value = '';
      let closed = false;
      index += 1;
      while (index < input.length) {
        if (input[index] !== '"') { value += input[index]; index += 1; continue; }
        if (input[index + 1] === '"') { value += '"'; index += 2; continue; }
        index += 1;
        closed = true;
        break;
      }
      if (!closed) fail('Kapanmamış metin');
      tokens.push({ type: 'string', value });
      continue;
    }
    const identifier = input.slice(index).match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0].toUpperCase() });
      index += identifier[0].length;
      continue;
    }
    const pair = input.slice(index, index + 2);
    if (['<=', '>=', '<>', '!='].includes(pair)) {
      tokens.push({ type: 'operator', value: pair });
      index += 2;
      continue;
    }
    if ('+-*/^%&=<>(),;:'.includes(char)) {
      tokens.push({ type: 'operator', value: char });
      index += 1;
      continue;
    }
    fail(`Geçersiz karakter: ${char}`);
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

function parse(source) {
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const match = (value) => peek().type === 'operator' && peek().value === value ? Boolean(++position) : false;
  const expect = (value) => { if (!match(value)) fail(`${value} bekleniyordu`); };

  function primary() {
    const token = take();
    if (token.type === 'number' || token.type === 'string') return { type: token.type, value: token.value };
    if (token.value === '(') {
      const result = comparison();
      expect(')');
      return result;
    }
    if (token.type !== 'identifier') fail('Değer bekleniyordu');
    if (match('(')) {
      const args = [];
      if (!match(')')) {
        do { args.push(comparison()); } while (match(',') || match(';'));
        expect(')');
      }
      return { type: 'call', name: token.value, args };
    }
    if (/^[A-Z]+\d+$/.test(token.value)) {
      if (match(':')) {
        const end = take();
        if (end.type !== 'identifier' || !/^[A-Z]+\d+$/.test(end.value)) fail('Geçersiz hücre aralığı');
        return { type: 'range', start: token.value, end: end.value };
      }
      return { type: 'cell', ref: token.value };
    }
    if (['TRUE', 'FALSE', 'PI', 'E'].includes(token.value)) return { type: 'constant', name: token.value };
    fail(`Bilinmeyen ad: ${token.value}`);
  }

  function postfix() {
    let value = primary();
    while (match('%')) value = { type: 'percent', value };
    return value;
  }
  function power() {
    const left = postfix();
    return match('^') ? { type: 'binary', operator: '^', left, right: unary() } : left;
  }
  function unary() {
    if (match('+')) return { type: 'unary', operator: '+', value: unary() };
    if (match('-')) return { type: 'unary', operator: '-', value: unary() };
    return power();
  }
  function product() {
    let value = unary();
    while (['*', '/'].includes(peek().value)) {
      const operator = take().value;
      value = { type: 'binary', operator, left: value, right: unary() };
    }
    return value;
  }
  function sum() {
    let value = product();
    while (['+', '-'].includes(peek().value)) {
      const operator = take().value;
      value = { type: 'binary', operator, left: value, right: product() };
    }
    return value;
  }
  function concatenation() {
    let value = sum();
    while (match('&')) value = { type: 'binary', operator: '&', left: value, right: sum() };
    return value;
  }
  function comparison() {
    let value = concatenation();
    while (['=', '<>', '!=', '<', '<=', '>', '>='].includes(peek().value)) {
      const operator = take().value;
      value = { type: 'binary', operator, left: value, right: concatenation() };
    }
    return value;
  }
  const tree = comparison();
  if (peek().type !== 'eof') fail('Formül sonunda beklenmeyen ifade');
  return tree;
}

const isRange = (value) => Boolean(value?.[RANGE]);
const flatten = (values) => values.flatMap((value) => isRange(value) ? flatten(value.values) : [value]);
function numberResult(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value };
  if (typeof value === 'boolean') return { ok: true, value: value ? 1 : 0 };
  if (value === '' || value === null || value === undefined) return { ok: true, value: 0 };
  const normalized = String(value).trim().replace(/^([-+]?\d+),(\d+)$/, '$1.$2');
  const number = Number(normalized);
  return Number.isFinite(number) ? { ok: true, value: number } : { ok: false, value: NaN };
}
function toNumber(value) {
  if (isRange(value)) fail('Aralık tek değer olarak kullanılamaz');
  const result = numberResult(value);
  if (!result.ok) fail('Sayı bekleniyordu');
  return result.value;
}
function toBoolean(value) {
  if (isRange(value)) fail('Aralık tek değer olarak kullanılamaz');
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return !['', 'FALSE', '0'].includes(String(value ?? '').trim().toUpperCase());
}
function toText(value) {
  if (isRange(value)) fail('Aralık tek değer olarak kullanılamaz');
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}
function numbers(values, strict = false) {
  const result = [];
  flatten(values).forEach((value) => {
    if (!strict && (value === '' || value === null || value === undefined)) return;
    const parsed = numberResult(value);
    if (parsed.ok) result.push(parsed.value);
    else if (strict) fail('Sayı bekleniyordu');
  });
  return result;
}
function arity(args, min, max = min) {
  if (args.length < min || args.length > max) fail('Geçersiz argüman sayısı');
}
function gcd(left, right) {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b) [a, b] = [b, a % b];
  return a;
}
function round(value, digits, mode = 'nearest') {
  const safeDigits = Math.max(-15, Math.min(15, Math.trunc(digits)));
  const factor = 10 ** Math.abs(safeDigits);
  const scaled = safeDigits >= 0 ? value * factor : value / factor;
  const rounded = mode === 'up'
    ? Math.sign(scaled) * Math.ceil(Math.abs(scaled))
    : mode === 'down'
      ? Math.sign(scaled) * Math.floor(Math.abs(scaled))
      : Math.round(scaled + Number.EPSILON * Math.max(1, Math.abs(scaled)));
  return safeDigits >= 0 ? rounded / factor : rounded * factor;
}

function evaluateCall(node, context) {
  const { name, args } = node;
  if (name === 'IF') {
    arity(args, 2, 3);
    return toBoolean(evaluateNode(args[0], context))
      ? evaluateNode(args[1], context)
      : args[2] ? evaluateNode(args[2], context) : false;
  }
  if (name === 'IFERROR') {
    arity(args, 2);
    try { return evaluateNode(args[0], context); } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      return evaluateNode(args[1], context);
    }
  }
  if (['AND', 'OR', 'XOR'].includes(name)) {
    if (!args.length) fail('Mantıksal işlev argüman ister');
    const values = flatten(args.map((arg) => evaluateNode(arg, context))).map(toBoolean);
    if (name === 'AND') return values.every(Boolean);
    if (name === 'OR') return values.some(Boolean);
    return values.filter(Boolean).length % 2 === 1;
  }
  if (name === 'NOT') { arity(args, 1); return !toBoolean(evaluateNode(args[0], context)); }
  const values = args.map((arg) => evaluateNode(arg, context));
  const n = (position) => toNumber(values[position]);
  const t = (position) => toText(values[position]);

  if (['SUM', 'AVG', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'PRODUCT', 'MEDIAN', 'SUMSQ'].includes(name)) {
    const list = numbers(values);
    if (name === 'SUM') return list.reduce((total, value) => total + value, 0);
    if (name === 'COUNT') return list.length;
    if (name === 'PRODUCT') return list.length ? list.reduce((total, value) => total * value, 1) : 0;
    if (name === 'SUMSQ') return list.reduce((total, value) => total + value ** 2, 0);
    if (!list.length) fail('Sayısal değer bulunamadı');
    if (name === 'AVG' || name === 'AVERAGE') return list.reduce((total, value) => total + value, 0) / list.length;
    if (name === 'MIN') return Math.min(...list);
    if (name === 'MAX') return Math.max(...list);
    const sorted = [...list].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  if (['ABS', 'SIGN', 'SQRT'].includes(name)) {
    arity(values, 1);
    if (name === 'ABS') return Math.abs(n(0));
    if (name === 'SIGN') return Math.sign(n(0));
    if (n(0) < 0) fail('Karekök tanım hatası');
    return Math.sqrt(n(0));
  }
  if (['ROUND', 'ROUNDUP', 'ROUNDDOWN'].includes(name)) {
    arity(values, 1, 2);
    return round(n(0), values.length > 1 ? n(1) : 0, name === 'ROUNDUP' ? 'up' : name === 'ROUNDDOWN' ? 'down' : 'nearest');
  }
  if (['FLOOR', 'CEILING', 'CEIL'].includes(name)) {
    arity(values, 1, 2);
    const significance = values.length > 1 ? Math.abs(n(1)) : 1;
    if (!significance) fail('Sıfır anlamlılık');
    return (name === 'FLOOR' ? Math.floor : Math.ceil)(n(0) / significance) * significance;
  }
  if (['MOD', 'POWER', 'POW', 'ATAN2'].includes(name)) {
    arity(values, 2);
    if (name === 'MOD') { if (!n(1)) fail('Sıfıra bölme'); return ((n(0) % n(1)) + n(1)) % n(1); }
    if (name === 'ATAN2') return Math.atan2(n(1), n(0));
    return n(0) ** n(1);
  }
  if (name === 'FACT') {
    arity(values, 1);
    const value = n(0);
    if (!Number.isInteger(value) || value < 0 || value > 170) fail('Faktöriyel tanım hatası');
    let result = 1;
    for (let item = 2; item <= value; item += 1) result *= item;
    return result;
  }
  if (['GCD', 'LCM'].includes(name)) {
    const list = numbers(values, true);
    if (!list.length) fail('Argüman eksik');
    return name === 'GCD' ? list.reduce(gcd) : list.reduce((a, b) => a && b ? Math.abs(a * b) / gcd(a, b) : 0);
  }
  const unaryMath = {
    SIN: Math.sin, COS: Math.cos, TAN: Math.tan, ASIN: Math.asin, ACOS: Math.acos, ATAN: Math.atan,
    SINH: Math.sinh, COSH: Math.cosh, TANH: Math.tanh, EXP: Math.exp, LN: Math.log,
    LOG10: Math.log10, LOG2: Math.log2, DEGREES: (value) => value * 180 / Math.PI,
    RADIANS: (value) => value * Math.PI / 180
  };
  if (unaryMath[name]) { arity(values, 1); return unaryMath[name](n(0)); }
  if (name === 'LOG') {
    arity(values, 1, 2);
    const value = n(0);
    const base = values.length > 1 ? n(1) : 10;
    if (value <= 0 || base <= 0 || base === 1) fail('Logaritma tanım hatası');
    return Math.log(value) / Math.log(base);
  }
  if (['PI', 'E'].includes(name)) { arity(values, 0); return name === 'PI' ? Math.PI : Math.E; }
  if (['CONCAT', 'CONCATENATE'].includes(name)) return flatten(values).map(toText).join('');
  if (name === 'LEN') { arity(values, 1); return Array.from(t(0)).length; }
  if (['LEFT', 'RIGHT'].includes(name)) {
    arity(values, 1, 2);
    const chars = Array.from(t(0));
    const count = values.length > 1 ? Math.trunc(n(1)) : 1;
    if (count < 0) fail('Negatif karakter sayısı');
    return name === 'LEFT' ? chars.slice(0, count).join('') : chars.slice(-count || chars.length).join('');
  }
  if (name === 'MID') {
    arity(values, 3);
    const start = Math.trunc(n(1));
    const count = Math.trunc(n(2));
    if (start < 1 || count < 0) fail('Geçersiz metin aralığı');
    return Array.from(t(0)).slice(start - 1, start - 1 + count).join('');
  }
  if (['UPPER', 'LOWER'].includes(name)) { arity(values, 1); return name === 'UPPER' ? t(0).toLocaleUpperCase(context.locale) : t(0).toLocaleLowerCase(context.locale); }
  if (name === 'TRIM') { arity(values, 1); return t(0).trim().replace(/\s+/g, ' '); }
  if (name === 'REPLACE') {
    arity(values, 4);
    const chars = Array.from(t(0));
    chars.splice(Math.trunc(n(1)) - 1, Math.trunc(n(2)), ...Array.from(t(3)));
    return chars.join('');
  }
  if (name === 'SUBSTITUTE') {
    arity(values, 3, 4);
    const [source, search, replacement] = [t(0), t(1), t(2)];
    if (values.length === 3) return source.split(search).join(replacement);
    let count = 0;
    return source.replaceAll(search, (match) => (++count === Math.trunc(n(3)) ? replacement : match));
  }
  if (name === 'TEXTJOIN') {
    arity(values, 3, Number.MAX_SAFE_INTEGER);
    return flatten(values.slice(2)).map(toText).filter((value) => !toBoolean(values[1]) || value !== '').join(t(0));
  }
  if (['FIND', 'SEARCH'].includes(name)) {
    arity(values, 2, 3);
    const needle = name === 'SEARCH' ? t(0).toLocaleLowerCase() : t(0);
    const haystack = name === 'SEARCH' ? t(1).toLocaleLowerCase() : t(1);
    const index = haystack.indexOf(needle, values.length > 2 ? Math.trunc(n(2)) - 1 : 0);
    if (index < 0) fail('Metin bulunamadı');
    return index + 1;
  }
  if (name === 'EXACT') { arity(values, 2); return t(0) === t(1); }
  if (name === 'VALUE') { arity(values, 1); return n(0); }
  fail(`Desteklenmeyen işlev: ${name}`);
}

function evaluateNode(node, context) {
  if (node.type === 'number' || node.type === 'string') return node.value;
  if (node.type === 'cell') return context.resolveCell(node.ref);
  if (node.type === 'range') return { [RANGE]: true, values: context.resolveRange(node.start, node.end) };
  if (node.type === 'constant') return node.name === 'TRUE' ? true : node.name === 'FALSE' ? false : node.name === 'PI' ? Math.PI : Math.E;
  if (node.type === 'call') return evaluateCall(node, context);
  if (node.type === 'percent') return toNumber(evaluateNode(node.value, context)) / 100;
  if (node.type === 'unary') return (node.operator === '-' ? -1 : 1) * toNumber(evaluateNode(node.value, context));
  if (node.type === 'binary') {
    const left = evaluateNode(node.left, context);
    const right = evaluateNode(node.right, context);
    if (['=', '<>', '!=', '<', '<=', '>', '>='].includes(node.operator)) {
      const aNumber = numberResult(left);
      const bNumber = numberResult(right);
      const [a, b] = aNumber.ok && bNumber.ok ? [aNumber.value, bNumber.value] : [toText(left), toText(right)];
      return node.operator === '=' ? a === b : ['<>', '!='].includes(node.operator) ? a !== b
        : node.operator === '<' ? a < b : node.operator === '<=' ? a <= b : node.operator === '>' ? a > b : a >= b;
    }
    if (node.operator === '&') return toText(left) + toText(right);
    const [a, b] = [toNumber(left), toNumber(right)];
    if (node.operator === '+') return a + b;
    if (node.operator === '-') return a - b;
    if (node.operator === '*') return a * b;
    if (node.operator === '/') { if (!b) fail('Sıfıra bölme'); return a / b; }
    if (node.operator === '^') return a ** b;
  }
  fail('Geçersiz formül');
}

function formatValue(value) {
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '#HATA';
    return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
  }
  return String(value ?? '');
}

export function evaluateFormula(source, context = {}) {
  try {
    return { ok: true, value: evaluateNode(parse(String(source).replace(/^=/, '')), context) };
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    return { ok: false, error: error.message, value: '#HATA' };
  }
}

export function evaluateSheet(cells = {}) {
  const memo = new Map();
  const resolve = (key, stack = new Set()) => {
    const normalized = String(key).toUpperCase();
    if (memo.has(normalized)) return memo.get(normalized);
    if (stack.has(normalized)) return '#DÖNGÜ';
    const raw = String(cells[normalized] ?? '').trim();
    if (!raw || !raw.startsWith('=')) return raw;
    const nextStack = new Set(stack).add(normalized);
    const result = evaluateFormula(raw, {
      locale: 'tr-TR',
      resolveCell(reference) {
        const value = resolve(reference, nextStack);
        if (String(value).startsWith('#')) fail(value);
        return value;
      },
      resolveRange(start, end) {
        return rangeKeys(start, end).map((reference) => {
          const value = resolve(reference, nextStack);
          if (String(value).startsWith('#')) fail(value);
          return value;
        });
      }
    });
    const value = result.ok ? formatValue(result.value) : (result.error === '#DÖNGÜ' ? '#DÖNGÜ' : '#HATA');
    memo.set(normalized, value);
    return value;
  };
  const output = {};
  Object.keys(cells).forEach((key) => { output[key.toUpperCase()] = resolve(key); });
  return output;
}
