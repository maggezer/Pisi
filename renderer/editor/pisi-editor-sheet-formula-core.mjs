export const PISI_FORMULA_CATALOG = Object.freeze({
    logical: Object.freeze([
        { label: 'IF', formula: '=IF(A1>0,"Positive","Zero or negative")' },
        { label: 'AND', formula: '=AND(A1>0,B1>0)' },
        { label: 'OR', formula: '=OR(A1>0,B1>0)' },
        { label: 'NOT', formula: '=NOT(A1>0)' },
        { label: 'XOR', formula: '=XOR(A1>0,B1>0)' },
        { label: 'IFERROR', formula: '=IFERROR(A1/B1,0)' }
    ]),
    text: Object.freeze([
        { label: 'CONCAT', formula: '=CONCAT(A1," ",B1)' },
        { label: 'LEN', formula: '=LEN(A1)' },
        { label: 'LEFT', formula: '=LEFT(A1,3)' },
        { label: 'RIGHT', formula: '=RIGHT(A1,3)' },
        { label: 'MID', formula: '=MID(A1,2,4)' },
        { label: 'UPPER', formula: '=UPPER(A1)' },
        { label: 'LOWER', formula: '=LOWER(A1)' },
        { label: 'TRIM', formula: '=TRIM(A1)' },
        { label: 'SUBSTITUTE', formula: '=SUBSTITUTE(A1,"old","new")' },
        { label: 'TEXTJOIN', formula: '=TEXTJOIN(", ",TRUE,A1:A5)' },
        { label: 'FIND', formula: '=FIND("text",A1)' },
        { label: 'REPLACE', formula: '=REPLACE(A1,1,3,"New")' }
    ]),
    math: Object.freeze([
        { label: 'SUM', formula: '=SUM(A1:A5)' },
        { label: 'AVG', formula: '=AVG(A1:A5)' },
        { label: 'MIN', formula: '=MIN(A1:A5)' },
        { label: 'MAX', formula: '=MAX(A1:A5)' },
        { label: 'COUNT', formula: '=COUNT(A1:A5)' },
        { label: 'PRODUCT', formula: '=PRODUCT(A1:A5)' },
        { label: 'MEDIAN', formula: '=MEDIAN(A1:A5)' },
        { label: 'ABS', formula: '=ABS(A1)' },
        { label: 'ROUND', formula: '=ROUND(A1,2)' },
        { label: 'MOD', formula: '=MOD(A1,B1)' },
        { label: 'POWER', formula: '=POWER(A1,2)' },
        { label: 'SQRT', formula: '=SQRT(A1)' },
        { label: 'FACT', formula: '=FACT(A1)' },
        { label: 'SIN', formula: '=SIN(RADIANS(A1))' },
        { label: 'COS', formula: '=COS(RADIANS(A1))' },
        { label: 'TAN', formula: '=TAN(RADIANS(A1))' },
        { label: 'ASIN', formula: '=DEGREES(ASIN(A1))' },
        { label: 'ACOS', formula: '=DEGREES(ACOS(A1))' },
        { label: 'ATAN', formula: '=DEGREES(ATAN(A1))' },
        { label: 'LOG', formula: '=LOG(A1,10)' },
        { label: 'LN', formula: '=LN(A1)' },
        { label: 'EXP', formula: '=EXP(A1)' },
        { label: 'PI', formula: '=PI()' },
        { label: 'DEGREES', formula: '=DEGREES(A1)' },
        { label: 'RADIANS', formula: '=RADIANS(A1)' }
    ])
});

class PisiFormulaError extends Error {}

const PISI_RANGE_VALUE = Symbol('pisiFormulaRange');
const PISI_CELL_REFERENCE = /^\$?[A-Z]+\$?\d+$/;

function formulaError(message = 'Invalid formula') {
    throw new PisiFormulaError(message);
}

function tokenizePisiFormula(source) {
    const input = String(source || '');
    const tokens = [];
    let index = 0;

    while (index < input.length) {
        const char = input[index];

        if (/\s/.test(char)) {
            index += 1;
            continue;
        }

        const number = input.slice(index).match(
            /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
        );
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
                if (input[index] !== '"') {
                    value += input[index];
                    index += 1;
                    continue;
                }

                if (input[index + 1] === '"') {
                    value += '"';
                    index += 2;
                    continue;
                }

                index += 1;
                closed = true;
                break;
            }

            if (!closed) formulaError('Unclosed string');
            tokens.push({ type: 'string', value });
            continue;
        }

        const identifier = input.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_.$]*/);
        if (identifier) {
            tokens.push({
                type: 'identifier',
                value: identifier[0].toUpperCase()
            });
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

        formulaError(`Unexpected character: ${char}`);
    }

    tokens.push({ type: 'eof', value: '' });
    return tokens;
}

function parsePisiFormula(source) {
    const tokens = tokenizePisiFormula(source);
    let index = 0;
    const peek = () => tokens[index];
    const take = () => tokens[index++];
    const match = (value) => {
        if (peek().value !== value) return false;
        index += 1;
        return true;
    };
    const expect = (value) => {
        if (!match(value)) formulaError(`Expected ${value}`);
    };

    function parsePrimary() {
        const token = take();

        if (token.type === 'number' || token.type === 'string') {
            return { type: token.type, value: token.value };
        }

        if (token.value === '(') {
            const expression = parseComparison();
            expect(')');
            return expression;
        }

        if (token.type !== 'identifier') {
            formulaError('Expected a value');
        }

        if (match('(')) {
            const args = [];
            if (!match(')')) {
                do {
                    args.push(parseComparison());
                } while (match(',') || match(';'));
                expect(')');
            }
            return { type: 'call', name: token.value, args };
        }

        if (PISI_CELL_REFERENCE.test(String(token.value))) {
            const normalizeReference = (value) => {
                return String(value).replaceAll('$', '');
            };

            if (match(':')) {
                const end = take();
                if (
                    end.type !== 'identifier' ||
                    !PISI_CELL_REFERENCE.test(String(end.value))
                ) {
                    formulaError('Invalid cell range');
                }
                return {
                    type: 'range',
                    start: normalizeReference(token.value),
                    end: normalizeReference(end.value)
                };
            }

            return {
                type: 'cell',
                ref: normalizeReference(token.value)
            };
        }

        if (['TRUE', 'FALSE', 'PI', 'E'].includes(String(token.value))) {
            return { type: 'constant', name: token.value };
        }

        formulaError(`Unknown name: ${token.value}`);
    }

    function parsePostfix() {
        let value = parsePrimary();
        while (match('%')) value = { type: 'percent', value };
        return value;
    }

    function parsePower() {
        const left = parsePostfix();
        if (!match('^')) return left;
        return {
            type: 'binary',
            operator: '^',
            left,
            right: parseUnary()
        };
    }

    function parseUnary() {
        if (match('+')) {
            return { type: 'unary', operator: '+', value: parseUnary() };
        }
        if (match('-')) {
            return { type: 'unary', operator: '-', value: parseUnary() };
        }
        return parsePower();
    }

    function parseProduct() {
        let value = parseUnary();
        while (['*', '/'].includes(String(peek().value))) {
            const operator = take().value;
            value = {
                type: 'binary',
                operator,
                left: value,
                right: parseUnary()
            };
        }
        return value;
    }

    function parseSum() {
        let value = parseProduct();
        while (['+', '-'].includes(String(peek().value))) {
            const operator = take().value;
            value = {
                type: 'binary',
                operator,
                left: value,
                right: parseProduct()
            };
        }
        return value;
    }

    function parseConcatenation() {
        let value = parseSum();
        while (match('&')) {
            value = {
                type: 'binary',
                operator: '&',
                left: value,
                right: parseSum()
            };
        }
        return value;
    }

    function parseComparison() {
        let value = parseConcatenation();
        while (['=', '<>', '!=', '<', '<=', '>', '>='].includes(String(peek().value))) {
            const operator = take().value;
            value = {
                type: 'binary',
                operator,
                left: value,
                right: parseConcatenation()
            };
        }
        return value;
    }

    const tree = parseComparison();
    if (peek().type !== 'eof') formulaError('Unexpected trailing input');
    return tree;
}

function isPisiRange(value) {
    return Boolean(value?.[PISI_RANGE_VALUE]);
}

function flattenPisiFormulaValues(values) {
    return values.flatMap((value) => {
        return isPisiRange(value)
            ? flattenPisiFormulaValues(value.values)
            : [value];
    });
}

function tryPisiFormulaNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value)
            ? { ok: true, value }
            : { ok: false, value: NaN };
    }
    if (typeof value === 'boolean') {
        return { ok: true, value: value ? 1 : 0 };
    }
    if (value === null || value === undefined || value === '') {
        return { ok: true, value: 0 };
    }
    if (typeof value === 'string') {
        const clean = value.trim();
        if (!clean) return { ok: true, value: 0 };
        const normalized = /^[-+]?\d+,\d+(?:[eE][-+]?\d+)?$/.test(clean)
            ? clean.replace(',', '.')
            : clean;
        const number = Number(normalized);
        if (Number.isFinite(number)) return { ok: true, value: number };
    }
    return { ok: false, value: NaN };
}

function toPisiFormulaNumber(value) {
    if (isPisiRange(value)) formulaError('Range cannot be used as a scalar');
    const result = tryPisiFormulaNumber(value);
    if (!result.ok) formulaError('Expected a number');
    return result.value;
}

function toPisiFormulaBoolean(value) {
    if (isPisiRange(value)) formulaError('Range cannot be used as a scalar');
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const clean = String(value ?? '').trim().toUpperCase();
    if (!clean || clean === 'FALSE' || clean === '0') return false;
    return true;
}

function toPisiFormulaText(value) {
    if (isPisiRange(value)) formulaError('Range cannot be used as a scalar');
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return String(value);
}

function getPisiFormulaNumbers(values, ignoreText = true) {
    const numbers = [];
    for (const value of flattenPisiFormulaValues(values)) {
        if (
            ignoreText &&
            (value === '' || value === null || value === undefined)
        ) {
            continue;
        }
        const result = tryPisiFormulaNumber(value);
        if (result.ok) {
            numbers.push(result.value);
        } else if (!ignoreText) {
            formulaError('Expected a number');
        }
    }
    return numbers;
}

function ensurePisiFormulaArity(args, minimum, maximum = minimum) {
    if (args.length < minimum || args.length > maximum) {
        formulaError('Wrong number of arguments');
    }
}

function roundPisiFormulaNumber(number, digits, mode = 'nearest') {
    const safeDigits = Math.max(-15, Math.min(15, Math.trunc(digits)));
    const factor = 10 ** Math.abs(safeDigits);
    const scaled = safeDigits >= 0 ? number * factor : number / factor;
    let rounded;

    if (mode === 'up') {
        rounded = Math.sign(scaled) * Math.ceil(Math.abs(scaled));
    } else if (mode === 'down') {
        rounded = Math.sign(scaled) * Math.floor(Math.abs(scaled));
    } else {
        const correction = Number.EPSILON * Math.max(1, Math.abs(scaled));
        rounded = Math.round(scaled + correction);
    }

    return safeDigits >= 0 ? rounded / factor : rounded * factor;
}

function gcdPisiFormula(left, right) {
    let a = Math.abs(Math.trunc(left));
    let b = Math.abs(Math.trunc(right));
    while (b) [a, b] = [b, a % b];
    return a;
}

function resolvePisiFormulaCell(context, ref) {
    if (typeof context.resolveCell !== 'function') {
        formulaError('Cell references are unavailable');
    }
    const result = context.resolveCell(ref);
    if (result?.ok === false) formulaError(result.error);
    return result && Object.hasOwn(result, 'value')
        ? result.value
        : result;
}

function resolvePisiFormulaRange(context, start, end) {
    if (typeof context.resolveRange !== 'function') {
        formulaError('Cell ranges are unavailable');
    }
    const result = context.resolveRange(start, end);
    if (result?.ok === false) formulaError(result.error);
    const values = result && Object.hasOwn(result, 'values')
        ? result.values
        : result;
    if (!Array.isArray(values)) formulaError('Invalid cell range');
    return { [PISI_RANGE_VALUE]: true, values };
}

function comparePisiFormulaValues(left, right, operator) {
    const leftNumber = tryPisiFormulaNumber(left);
    const rightNumber = tryPisiFormulaNumber(right);
    const numeric = leftNumber.ok && rightNumber.ok;
    const a = numeric ? leftNumber.value : toPisiFormulaText(left);
    const b = numeric ? rightNumber.value : toPisiFormulaText(right);

    if (operator === '=') return a === b;
    if (operator === '<>' || operator === '!=') return a !== b;
    if (operator === '<') return a < b;
    if (operator === '<=') return a <= b;
    if (operator === '>') return a > b;
    if (operator === '>=') return a >= b;
    formulaError('Unknown comparison');
}

function evaluatePisiFormulaCall(node, context) {
    const { name, args } = node;

    if (name === 'IF') {
        ensurePisiFormulaArity(args, 2, 3);
        return toPisiFormulaBoolean(evaluatePisiFormulaNode(args[0], context))
            ? evaluatePisiFormulaNode(args[1], context)
            : (args[2] ? evaluatePisiFormulaNode(args[2], context) : false);
    }

    if (name === 'IFERROR') {
        ensurePisiFormulaArity(args, 2);
        try {
            return evaluatePisiFormulaNode(args[0], context);
        } catch (error) {
            if (!(error instanceof PisiFormulaError)) throw error;
            return evaluatePisiFormulaNode(args[1], context);
        }
    }

    if (['AND', 'OR', 'XOR'].includes(name)) {
        if (!args.length) formulaError('Logical function requires arguments');
        let truthyCount = 0;
        for (const arg of args) {
            const values = flattenPisiFormulaValues([
                evaluatePisiFormulaNode(arg, context)
            ]);
            for (const value of values) {
                const truthy = toPisiFormulaBoolean(value);
                if (name === 'AND' && !truthy) return false;
                if (name === 'OR' && truthy) return true;
                if (truthy) truthyCount += 1;
            }
        }
        if (name === 'AND') return true;
        if (name === 'OR') return false;
        return truthyCount % 2 === 1;
    }

    if (name === 'NOT') {
        ensurePisiFormulaArity(args, 1);
        return !toPisiFormulaBoolean(evaluatePisiFormulaNode(args[0], context));
    }

    if (name === 'TRUE' || name === 'FALSE') {
        ensurePisiFormulaArity(args, 0);
        return name === 'TRUE';
    }

    const values = args.map((arg) => evaluatePisiFormulaNode(arg, context));
    const scalar = (position) => {
        if (position >= values.length) formulaError('Missing argument');
        return values[position];
    };
    const number = (position) => toPisiFormulaNumber(scalar(position));
    const text = (position) => toPisiFormulaText(scalar(position));

    if (['SUM', 'AVG', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'PRODUCT', 'MEDIAN', 'SUMSQ'].includes(name)) {
        const numbers = getPisiFormulaNumbers(values);
        if (name === 'SUM') return numbers.reduce((sum, item) => sum + item, 0);
        if (name === 'COUNT') return numbers.length;
        if (name === 'PRODUCT') {
            return numbers.length
                ? numbers.reduce((product, item) => product * item, 1)
                : 0;
        }
        if (name === 'SUMSQ') {
            return numbers.reduce((sum, item) => sum + item ** 2, 0);
        }
        if (!numbers.length) formulaError('No numeric values');
        if (name === 'AVG' || name === 'AVERAGE') {
            return numbers.reduce((sum, item) => sum + item, 0) / numbers.length;
        }
        if (name === 'MIN') return Math.min(...numbers);
        if (name === 'MAX') return Math.max(...numbers);
        const sorted = [...numbers].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2
            ? sorted[middle]
            : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    if (name === 'ABS' || name === 'SIGN' || name === 'SQRT') {
        ensurePisiFormulaArity(values, 1);
        const value = number(0);
        if (name === 'ABS') return Math.abs(value);
        if (name === 'SIGN') return Math.sign(value);
        if (value < 0) formulaError('Square root domain error');
        return Math.sqrt(value);
    }

    if (['ROUND', 'ROUNDUP', 'ROUNDDOWN'].includes(name)) {
        ensurePisiFormulaArity(values, 1, 2);
        const digits = values.length > 1 ? number(1) : 0;
        const mode = name === 'ROUNDUP'
            ? 'up'
            : (name === 'ROUNDDOWN' ? 'down' : 'nearest');
        return roundPisiFormulaNumber(number(0), digits, mode);
    }

    if (name === 'FLOOR' || name === 'CEILING' || name === 'CEIL') {
        ensurePisiFormulaArity(values, 1, 2);
        const value = number(0);
        const significance = values.length > 1 ? Math.abs(number(1)) : 1;
        if (!significance) formulaError('Zero significance');
        return (name === 'FLOOR' ? Math.floor : Math.ceil)(value / significance) * significance;
    }

    if (['MOD', 'POWER', 'POW', 'ATAN2'].includes(name)) {
        ensurePisiFormulaArity(values, 2);
        const left = number(0);
        const right = number(1);
        if (name === 'MOD') {
            if (!right) formulaError('Division by zero');
            return ((left % right) + right) % right;
        }
        if (name === 'ATAN2') return Math.atan2(right, left);
        return left ** right;
    }

    if (name === 'FACT') {
        ensurePisiFormulaArity(values, 1);
        const value = number(0);
        if (!Number.isInteger(value) || value < 0 || value > 170) {
            formulaError('Factorial domain error');
        }
        let result = 1;
        for (let item = 2; item <= value; item += 1) result *= item;
        return result;
    }

    if (name === 'GCD' || name === 'LCM') {
        if (!values.length) formulaError('Missing argument');
        const numbers = getPisiFormulaNumbers(values, false);
        if (name === 'GCD') return numbers.reduce(gcdPisiFormula);
        return numbers.reduce((left, right) => {
            if (!left || !right) return 0;
            return Math.abs(left * right) / gcdPisiFormula(left, right);
        });
    }

    const unaryMath = {
        SIN: Math.sin,
        COS: Math.cos,
        TAN: Math.tan,
        ASIN: Math.asin,
        ACOS: Math.acos,
        ATAN: Math.atan,
        SINH: Math.sinh,
        COSH: Math.cosh,
        TANH: Math.tanh,
        EXP: Math.exp,
        LN: Math.log,
        LOG10: Math.log10,
        LOG2: Math.log2,
        DEGREES: (value) => value * 180 / Math.PI,
        RADIANS: (value) => value * Math.PI / 180
    };
    if (unaryMath[name]) {
        ensurePisiFormulaArity(values, 1);
        return unaryMath[name](number(0));
    }

    if (name === 'LOG') {
        ensurePisiFormulaArity(values, 1, 2);
        const value = number(0);
        const base = values.length > 1 ? number(1) : 10;
        if (value <= 0 || base <= 0 || base === 1) formulaError('Logarithm domain error');
        return Math.log(value) / Math.log(base);
    }

    if (name === 'PI' || name === 'E') {
        ensurePisiFormulaArity(values, 0);
        return name === 'PI' ? Math.PI : Math.E;
    }

    if (name === 'CONCAT' || name === 'CONCATENATE') {
        return flattenPisiFormulaValues(values).map(toPisiFormulaText).join('');
    }

    if (name === 'LEN') {
        ensurePisiFormulaArity(values, 1);
        return Array.from(text(0)).length;
    }

    if (name === 'LEFT' || name === 'RIGHT') {
        ensurePisiFormulaArity(values, 1, 2);
        const characters = Array.from(text(0));
        const count = values.length > 1 ? Math.trunc(number(1)) : 1;
        if (count < 0) formulaError('Negative character count');
        return name === 'LEFT'
            ? characters.slice(0, count).join('')
            : characters.slice(Math.max(0, characters.length - count)).join('');
    }

    if (name === 'MID') {
        ensurePisiFormulaArity(values, 3);
        const start = Math.trunc(number(1));
        const count = Math.trunc(number(2));
        if (start < 1 || count < 0) formulaError('Invalid text range');
        return Array.from(text(0)).slice(start - 1, start - 1 + count).join('');
    }

    if (name === 'UPPER' || name === 'LOWER') {
        ensurePisiFormulaArity(values, 1);
        const locale = context.locale || undefined;
        return name === 'UPPER'
            ? text(0).toLocaleUpperCase(locale)
            : text(0).toLocaleLowerCase(locale);
    }

    if (name === 'TRIM') {
        ensurePisiFormulaArity(values, 1);
        return text(0).trim().replace(/\s+/g, ' ');
    }

    if (name === 'REPLACE') {
        ensurePisiFormulaArity(values, 4);
        const characters = Array.from(text(0));
        const start = Math.trunc(number(1));
        const count = Math.trunc(number(2));
        if (start < 1 || count < 0) formulaError('Invalid text range');
        characters.splice(start - 1, count, ...Array.from(text(3)));
        return characters.join('');
    }

    if (name === 'SUBSTITUTE') {
        ensurePisiFormulaArity(values, 3, 4);
        const source = text(0);
        const search = text(1);
        const replacement = text(2);
        if (!search) return source;
        if (values.length === 3) return source.split(search).join(replacement);
        const instance = Math.trunc(number(3));
        if (instance < 1) formulaError('Invalid occurrence');
        let count = 0;
        return source.replaceAll(search, (match) => {
            count += 1;
            return count === instance ? replacement : match;
        });
    }

    if (name === 'TEXTJOIN') {
        ensurePisiFormulaArity(values, 3, Number.MAX_SAFE_INTEGER);
        const delimiter = text(0);
        const ignoreEmpty = toPisiFormulaBoolean(values[1]);
        return flattenPisiFormulaValues(values.slice(2))
            .map(toPisiFormulaText)
            .filter((value) => !ignoreEmpty || value !== '')
            .join(delimiter);
    }

    if (name === 'FIND' || name === 'SEARCH') {
        ensurePisiFormulaArity(values, 2, 3);
        const needle = name === 'SEARCH' ? text(0).toLocaleLowerCase() : text(0);
        const haystack = name === 'SEARCH' ? text(1).toLocaleLowerCase() : text(1);
        const start = values.length > 2 ? Math.trunc(number(2)) : 1;
        if (start < 1) formulaError('Invalid search position');
        const found = haystack.indexOf(needle, start - 1);
        if (found < 0) formulaError('Text not found');
        return found + 1;
    }

    if (name === 'EXACT') {
        ensurePisiFormulaArity(values, 2);
        return text(0) === text(1);
    }

    if (name === 'VALUE') {
        ensurePisiFormulaArity(values, 1);
        return number(0);
    }

    formulaError(`Unsupported function: ${name}`);
}

function evaluatePisiFormulaNode(node, context) {
    if (node.type === 'number' || node.type === 'string') return node.value;
    if (node.type === 'cell') return resolvePisiFormulaCell(context, node.ref);
    if (node.type === 'range') {
        return resolvePisiFormulaRange(context, node.start, node.end);
    }
    if (node.type === 'constant') {
        if (node.name === 'TRUE') return true;
        if (node.name === 'FALSE') return false;
        return node.name === 'PI' ? Math.PI : Math.E;
    }
    if (node.type === 'call') return evaluatePisiFormulaCall(node, context);
    if (node.type === 'percent') {
        return toPisiFormulaNumber(evaluatePisiFormulaNode(node.value, context)) / 100;
    }
    if (node.type === 'unary') {
        const value = toPisiFormulaNumber(evaluatePisiFormulaNode(node.value, context));
        return node.operator === '-' ? -value : value;
    }
    if (node.type === 'binary') {
        const left = evaluatePisiFormulaNode(node.left, context);
        const right = evaluatePisiFormulaNode(node.right, context);

        if (['=', '<>', '!=', '<', '<=', '>', '>='].includes(node.operator)) {
            return comparePisiFormulaValues(left, right, node.operator);
        }
        if (node.operator === '&') {
            return toPisiFormulaText(left) + toPisiFormulaText(right);
        }

        const a = toPisiFormulaNumber(left);
        const b = toPisiFormulaNumber(right);
        if (node.operator === '+') return a + b;
        if (node.operator === '-') return a - b;
        if (node.operator === '*') return a * b;
        if (node.operator === '/') {
            if (!b) formulaError('Division by zero');
            return a / b;
        }
        if (node.operator === '^') return a ** b;
    }
    formulaError('Invalid expression');
}

export function evaluatePisiFormulaExpression(formula, context = {}) {
    try {
        let expression = String(formula || '').trim();
        if (expression.startsWith('=')) expression = expression.slice(1);
        if (!expression.trim()) formulaError('Empty formula');
        const value = evaluatePisiFormulaNode(parsePisiFormula(expression), context);
        if (isPisiRange(value)) formulaError('Formula cannot return a range');
        if (typeof value === 'number' && !Number.isFinite(value)) {
            formulaError('Non-finite result');
        }
        return { ok: true, value };
    } catch (error) {
        if (!(error instanceof PisiFormulaError)) throw error;
        return { ok: false, value: null, error: '#ERR' };
    }
}
, ''),
                    end: String(end.value).replaceAll('
        }

        if (['TRUE', 'FALSE', 'PI', 'E'].includes(String(token.value))) {
            return { type: 'constant', name: token.value };
        }

        formulaError(`Unknown name: ${token.value}`);
    }

    function parsePostfix() {
        let value = parsePrimary();
        while (match('%')) value = { type: 'percent', value };
        return value;
    }

    function parsePower() {
        const left = parsePostfix();
        if (!match('^')) return left;
        return {
            type: 'binary',
            operator: '^',
            left,
            right: parseUnary()
        };
    }

    function parseUnary() {
        if (match('+')) {
            return { type: 'unary', operator: '+', value: parseUnary() };
        }
        if (match('-')) {
            return { type: 'unary', operator: '-', value: parseUnary() };
        }
        return parsePower();
    }

    function parseProduct() {
        let value = parseUnary();
        while (['*', '/'].includes(String(peek().value))) {
            const operator = take().value;
            value = {
                type: 'binary',
                operator,
                left: value,
                right: parseUnary()
            };
        }
        return value;
    }

    function parseSum() {
        let value = parseProduct();
        while (['+', '-'].includes(String(peek().value))) {
            const operator = take().value;
            value = {
                type: 'binary',
                operator,
                left: value,
                right: parseProduct()
            };
        }
        return value;
    }

    function parseConcatenation() {
        let value = parseSum();
        while (match('&')) {
            value = {
                type: 'binary',
                operator: '&',
                left: value,
                right: parseSum()
            };
        }
        return value;
    }

    function parseComparison() {
        let value = parseConcatenation();
        while (['=', '<>', '!=', '<', '<=', '>', '>='].includes(String(peek().value))) {
            const operator = take().value;
            value = {
                type: 'binary',
                operator,
                left: value,
                right: parseConcatenation()
            };
        }
        return value;
    }

    const tree = parseComparison();
    if (peek().type !== 'eof') formulaError('Unexpected trailing input');
    return tree;
}

function isPisiRange(value) {
    return Boolean(value?.[PISI_RANGE_VALUE]);
}

function flattenPisiFormulaValues(values) {
    return values.flatMap((value) => {
        return isPisiRange(value)
            ? flattenPisiFormulaValues(value.values)
            : [value];
    });
}

function tryPisiFormulaNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value)
            ? { ok: true, value }
            : { ok: false, value: NaN };
    }
    if (typeof value === 'boolean') {
        return { ok: true, value: value ? 1 : 0 };
    }
    if (value === null || value === undefined || value === '') {
        return { ok: true, value: 0 };
    }
    if (typeof value === 'string') {
        const clean = value.trim();
        if (!clean) return { ok: true, value: 0 };
        const normalized = /^[-+]?\d+,\d+(?:[eE][-+]?\d+)?$/.test(clean)
            ? clean.replace(',', '.')
            : clean;
        const number = Number(normalized);
        if (Number.isFinite(number)) return { ok: true, value: number };
    }
    return { ok: false, value: NaN };
}

function toPisiFormulaNumber(value) {
    if (isPisiRange(value)) formulaError('Range cannot be used as a scalar');
    const result = tryPisiFormulaNumber(value);
    if (!result.ok) formulaError('Expected a number');
    return result.value;
}

function toPisiFormulaBoolean(value) {
    if (isPisiRange(value)) formulaError('Range cannot be used as a scalar');
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const clean = String(value ?? '').trim().toUpperCase();
    if (!clean || clean === 'FALSE' || clean === '0') return false;
    return true;
}

function toPisiFormulaText(value) {
    if (isPisiRange(value)) formulaError('Range cannot be used as a scalar');
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return String(value);
}

function getPisiFormulaNumbers(values, ignoreText = true) {
    const numbers = [];
    for (const value of flattenPisiFormulaValues(values)) {
        if (
            ignoreText &&
            (value === '' || value === null || value === undefined)
        ) {
            continue;
        }
        const result = tryPisiFormulaNumber(value);
        if (result.ok) {
            numbers.push(result.value);
        } else if (!ignoreText) {
            formulaError('Expected a number');
        }
    }
    return numbers;
}

function ensurePisiFormulaArity(args, minimum, maximum = minimum) {
    if (args.length < minimum || args.length > maximum) {
        formulaError('Wrong number of arguments');
    }
}

function roundPisiFormulaNumber(number, digits, mode = 'nearest') {
    const safeDigits = Math.max(-15, Math.min(15, Math.trunc(digits)));
    const factor = 10 ** Math.abs(safeDigits);
    const scaled = safeDigits >= 0 ? number * factor : number / factor;
    let rounded;

    if (mode === 'up') {
        rounded = Math.sign(scaled) * Math.ceil(Math.abs(scaled));
    } else if (mode === 'down') {
        rounded = Math.sign(scaled) * Math.floor(Math.abs(scaled));
    } else {
        const correction = Number.EPSILON * Math.max(1, Math.abs(scaled));
        rounded = Math.round(scaled + correction);
    }

    return safeDigits >= 0 ? rounded / factor : rounded * factor;
}

function gcdPisiFormula(left, right) {
    let a = Math.abs(Math.trunc(left));
    let b = Math.abs(Math.trunc(right));
    while (b) [a, b] = [b, a % b];
    return a;
}

function resolvePisiFormulaCell(context, ref) {
    if (typeof context.resolveCell !== 'function') {
        formulaError('Cell references are unavailable');
    }
    const result = context.resolveCell(ref);
    if (result?.ok === false) formulaError(result.error);
    return result && Object.hasOwn(result, 'value')
        ? result.value
        : result;
}

function resolvePisiFormulaRange(context, start, end) {
    if (typeof context.resolveRange !== 'function') {
        formulaError('Cell ranges are unavailable');
    }
    const result = context.resolveRange(start, end);
    if (result?.ok === false) formulaError(result.error);
    const values = result && Object.hasOwn(result, 'values')
        ? result.values
        : result;
    if (!Array.isArray(values)) formulaError('Invalid cell range');
    return { [PISI_RANGE_VALUE]: true, values };
}

function comparePisiFormulaValues(left, right, operator) {
    const leftNumber = tryPisiFormulaNumber(left);
    const rightNumber = tryPisiFormulaNumber(right);
    const numeric = leftNumber.ok && rightNumber.ok;
    const a = numeric ? leftNumber.value : toPisiFormulaText(left);
    const b = numeric ? rightNumber.value : toPisiFormulaText(right);

    if (operator === '=') return a === b;
    if (operator === '<>' || operator === '!=') return a !== b;
    if (operator === '<') return a < b;
    if (operator === '<=') return a <= b;
    if (operator === '>') return a > b;
    if (operator === '>=') return a >= b;
    formulaError('Unknown comparison');
}

function evaluatePisiFormulaCall(node, context) {
    const { name, args } = node;

    if (name === 'IF') {
        ensurePisiFormulaArity(args, 2, 3);
        return toPisiFormulaBoolean(evaluatePisiFormulaNode(args[0], context))
            ? evaluatePisiFormulaNode(args[1], context)
            : (args[2] ? evaluatePisiFormulaNode(args[2], context) : false);
    }

    if (name === 'IFERROR') {
        ensurePisiFormulaArity(args, 2);
        try {
            return evaluatePisiFormulaNode(args[0], context);
        } catch (error) {
            if (!(error instanceof PisiFormulaError)) throw error;
            return evaluatePisiFormulaNode(args[1], context);
        }
    }

    if (['AND', 'OR', 'XOR'].includes(name)) {
        if (!args.length) formulaError('Logical function requires arguments');
        let truthyCount = 0;
        for (const arg of args) {
            const values = flattenPisiFormulaValues([
                evaluatePisiFormulaNode(arg, context)
            ]);
            for (const value of values) {
                const truthy = toPisiFormulaBoolean(value);
                if (name === 'AND' && !truthy) return false;
                if (name === 'OR' && truthy) return true;
                if (truthy) truthyCount += 1;
            }
        }
        if (name === 'AND') return true;
        if (name === 'OR') return false;
        return truthyCount % 2 === 1;
    }

    if (name === 'NOT') {
        ensurePisiFormulaArity(args, 1);
        return !toPisiFormulaBoolean(evaluatePisiFormulaNode(args[0], context));
    }

    if (name === 'TRUE' || name === 'FALSE') {
        ensurePisiFormulaArity(args, 0);
        return name === 'TRUE';
    }

    const values = args.map((arg) => evaluatePisiFormulaNode(arg, context));
    const scalar = (position) => {
        if (position >= values.length) formulaError('Missing argument');
        return values[position];
    };
    const number = (position) => toPisiFormulaNumber(scalar(position));
    const text = (position) => toPisiFormulaText(scalar(position));

    if (['SUM', 'AVG', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'PRODUCT', 'MEDIAN', 'SUMSQ'].includes(name)) {
        const numbers = getPisiFormulaNumbers(values);
        if (name === 'SUM') return numbers.reduce((sum, item) => sum + item, 0);
        if (name === 'COUNT') return numbers.length;
        if (name === 'PRODUCT') {
            return numbers.length
                ? numbers.reduce((product, item) => product * item, 1)
                : 0;
        }
        if (name === 'SUMSQ') {
            return numbers.reduce((sum, item) => sum + item ** 2, 0);
        }
        if (!numbers.length) formulaError('No numeric values');
        if (name === 'AVG' || name === 'AVERAGE') {
            return numbers.reduce((sum, item) => sum + item, 0) / numbers.length;
        }
        if (name === 'MIN') return Math.min(...numbers);
        if (name === 'MAX') return Math.max(...numbers);
        const sorted = [...numbers].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2
            ? sorted[middle]
            : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    if (name === 'ABS' || name === 'SIGN' || name === 'SQRT') {
        ensurePisiFormulaArity(values, 1);
        const value = number(0);
        if (name === 'ABS') return Math.abs(value);
        if (name === 'SIGN') return Math.sign(value);
        if (value < 0) formulaError('Square root domain error');
        return Math.sqrt(value);
    }

    if (['ROUND', 'ROUNDUP', 'ROUNDDOWN'].includes(name)) {
        ensurePisiFormulaArity(values, 1, 2);
        const digits = values.length > 1 ? number(1) : 0;
        const mode = name === 'ROUNDUP'
            ? 'up'
            : (name === 'ROUNDDOWN' ? 'down' : 'nearest');
        return roundPisiFormulaNumber(number(0), digits, mode);
    }

    if (name === 'FLOOR' || name === 'CEILING' || name === 'CEIL') {
        ensurePisiFormulaArity(values, 1, 2);
        const value = number(0);
        const significance = values.length > 1 ? Math.abs(number(1)) : 1;
        if (!significance) formulaError('Zero significance');
        return (name === 'FLOOR' ? Math.floor : Math.ceil)(value / significance) * significance;
    }

    if (['MOD', 'POWER', 'POW', 'ATAN2'].includes(name)) {
        ensurePisiFormulaArity(values, 2);
        const left = number(0);
        const right = number(1);
        if (name === 'MOD') {
            if (!right) formulaError('Division by zero');
            return ((left % right) + right) % right;
        }
        if (name === 'ATAN2') return Math.atan2(right, left);
        return left ** right;
    }

    if (name === 'FACT') {
        ensurePisiFormulaArity(values, 1);
        const value = number(0);
        if (!Number.isInteger(value) || value < 0 || value > 170) {
            formulaError('Factorial domain error');
        }
        let result = 1;
        for (let item = 2; item <= value; item += 1) result *= item;
        return result;
    }

    if (name === 'GCD' || name === 'LCM') {
        if (!values.length) formulaError('Missing argument');
        const numbers = getPisiFormulaNumbers(values, false);
        if (name === 'GCD') return numbers.reduce(gcdPisiFormula);
        return numbers.reduce((left, right) => {
            if (!left || !right) return 0;
            return Math.abs(left * right) / gcdPisiFormula(left, right);
        });
    }

    const unaryMath = {
        SIN: Math.sin,
        COS: Math.cos,
        TAN: Math.tan,
        ASIN: Math.asin,
        ACOS: Math.acos,
        ATAN: Math.atan,
        SINH: Math.sinh,
        COSH: Math.cosh,
        TANH: Math.tanh,
        EXP: Math.exp,
        LN: Math.log,
        LOG10: Math.log10,
        LOG2: Math.log2,
        DEGREES: (value) => value * 180 / Math.PI,
        RADIANS: (value) => value * Math.PI / 180
    };
    if (unaryMath[name]) {
        ensurePisiFormulaArity(values, 1);
        return unaryMath[name](number(0));
    }

    if (name === 'LOG') {
        ensurePisiFormulaArity(values, 1, 2);
        const value = number(0);
        const base = values.length > 1 ? number(1) : 10;
        if (value <= 0 || base <= 0 || base === 1) formulaError('Logarithm domain error');
        return Math.log(value) / Math.log(base);
    }

    if (name === 'PI' || name === 'E') {
        ensurePisiFormulaArity(values, 0);
        return name === 'PI' ? Math.PI : Math.E;
    }

    if (name === 'CONCAT' || name === 'CONCATENATE') {
        return flattenPisiFormulaValues(values).map(toPisiFormulaText).join('');
    }

    if (name === 'LEN') {
        ensurePisiFormulaArity(values, 1);
        return Array.from(text(0)).length;
    }

    if (name === 'LEFT' || name === 'RIGHT') {
        ensurePisiFormulaArity(values, 1, 2);
        const characters = Array.from(text(0));
        const count = values.length > 1 ? Math.trunc(number(1)) : 1;
        if (count < 0) formulaError('Negative character count');
        return name === 'LEFT'
            ? characters.slice(0, count).join('')
            : characters.slice(Math.max(0, characters.length - count)).join('');
    }

    if (name === 'MID') {
        ensurePisiFormulaArity(values, 3);
        const start = Math.trunc(number(1));
        const count = Math.trunc(number(2));
        if (start < 1 || count < 0) formulaError('Invalid text range');
        return Array.from(text(0)).slice(start - 1, start - 1 + count).join('');
    }

    if (name === 'UPPER' || name === 'LOWER') {
        ensurePisiFormulaArity(values, 1);
        const locale = context.locale || undefined;
        return name === 'UPPER'
            ? text(0).toLocaleUpperCase(locale)
            : text(0).toLocaleLowerCase(locale);
    }

    if (name === 'TRIM') {
        ensurePisiFormulaArity(values, 1);
        return text(0).trim().replace(/\s+/g, ' ');
    }

    if (name === 'REPLACE') {
        ensurePisiFormulaArity(values, 4);
        const characters = Array.from(text(0));
        const start = Math.trunc(number(1));
        const count = Math.trunc(number(2));
        if (start < 1 || count < 0) formulaError('Invalid text range');
        characters.splice(start - 1, count, ...Array.from(text(3)));
        return characters.join('');
    }

    if (name === 'SUBSTITUTE') {
        ensurePisiFormulaArity(values, 3, 4);
        const source = text(0);
        const search = text(1);
        const replacement = text(2);
        if (!search) return source;
        if (values.length === 3) return source.split(search).join(replacement);
        const instance = Math.trunc(number(3));
        if (instance < 1) formulaError('Invalid occurrence');
        let count = 0;
        return source.replaceAll(search, (match) => {
            count += 1;
            return count === instance ? replacement : match;
        });
    }

    if (name === 'TEXTJOIN') {
        ensurePisiFormulaArity(values, 3, Number.MAX_SAFE_INTEGER);
        const delimiter = text(0);
        const ignoreEmpty = toPisiFormulaBoolean(values[1]);
        return flattenPisiFormulaValues(values.slice(2))
            .map(toPisiFormulaText)
            .filter((value) => !ignoreEmpty || value !== '')
            .join(delimiter);
    }

    if (name === 'FIND' || name === 'SEARCH') {
        ensurePisiFormulaArity(values, 2, 3);
        const needle = name === 'SEARCH' ? text(0).toLocaleLowerCase() : text(0);
        const haystack = name === 'SEARCH' ? text(1).toLocaleLowerCase() : text(1);
        const start = values.length > 2 ? Math.trunc(number(2)) : 1;
        if (start < 1) formulaError('Invalid search position');
        const found = haystack.indexOf(needle, start - 1);
        if (found < 0) formulaError('Text not found');
        return found + 1;
    }

    if (name === 'EXACT') {
        ensurePisiFormulaArity(values, 2);
        return text(0) === text(1);
    }

    if (name === 'VALUE') {
        ensurePisiFormulaArity(values, 1);
        return number(0);
    }

    formulaError(`Unsupported function: ${name}`);
}

function evaluatePisiFormulaNode(node, context) {
    if (node.type === 'number' || node.type === 'string') return node.value;
    if (node.type === 'cell') return resolvePisiFormulaCell(context, node.ref);
    if (node.type === 'range') {
        return resolvePisiFormulaRange(context, node.start, node.end);
    }
    if (node.type === 'constant') {
        if (node.name === 'TRUE') return true;
        if (node.name === 'FALSE') return false;
        return node.name === 'PI' ? Math.PI : Math.E;
    }
    if (node.type === 'call') return evaluatePisiFormulaCall(node, context);
    if (node.type === 'percent') {
        return toPisiFormulaNumber(evaluatePisiFormulaNode(node.value, context)) / 100;
    }
    if (node.type === 'unary') {
        const value = toPisiFormulaNumber(evaluatePisiFormulaNode(node.value, context));
        return node.operator === '-' ? -value : value;
    }
    if (node.type === 'binary') {
        const left = evaluatePisiFormulaNode(node.left, context);
        const right = evaluatePisiFormulaNode(node.right, context);

        if (['=', '<>', '!=', '<', '<=', '>', '>='].includes(node.operator)) {
            return comparePisiFormulaValues(left, right, node.operator);
        }
        if (node.operator === '&') {
            return toPisiFormulaText(left) + toPisiFormulaText(right);
        }

        const a = toPisiFormulaNumber(left);
        const b = toPisiFormulaNumber(right);
        if (node.operator === '+') return a + b;
        if (node.operator === '-') return a - b;
        if (node.operator === '*') return a * b;
        if (node.operator === '/') {
            if (!b) formulaError('Division by zero');
            return a / b;
        }
        if (node.operator === '^') return a ** b;
    }
    formulaError('Invalid expression');
}

export function evaluatePisiFormulaExpression(formula, context = {}) {
    try {
        let expression = String(formula || '').trim();
        if (expression.startsWith('=')) expression = expression.slice(1);
        if (!expression.trim()) formulaError('Empty formula');
        const value = evaluatePisiFormulaNode(parsePisiFormula(expression), context);
        if (isPisiRange(value)) formulaError('Formula cannot return a range');
        if (typeof value === 'number' && !Number.isFinite(value)) {
            formulaError('Non-finite result');
        }
        return { ok: true, value };
    } catch (error) {
        if (!(error instanceof PisiFormulaError)) throw error;
        return { ok: false, value: null, error: '#ERR' };
    }
}
, '')
                };
            }
            return {
                type: 'cell',
                ref: String(token.value).replaceAll('
        }

        if (['TRUE', 'FALSE', 'PI', 'E'].includes(String(token.value))) {
            return { type: 'constant', name: token.value };
        }

        formulaError(`Unknown name: ${token.value}`);
    }

    function parsePostfix() {
        let value = parsePrimary();
        while (match('%')) value = { type: 'percent', value };
        return value;
    }

    function parsePower() {
        const left = parsePostfix();
        if (!match('^')) return left;
        return {
            type: 'binary',
            operator: '^',
            left,
            right: parseUnary()
        };
    }

    function parseUnary() {
        if (match('+')) {
            return { type: 'unary', operator: '+', value: parseUnary() };
        }
        if (match('-')) {
            return { type: 'unary', operator: '-', value: parseUnary() };
        }
        return parsePower();
    }

    function parseProduct() {
        let value = parseUnary();
        while (['*', '/'].includes(String(peek().value))) {
            const operator = take().value;
            value = {
                type: 'binary',
                operator,
                left: value,
                right: parseUnary()
            };
        }
        return value;
    }

    function parseSum() {
        let value = parseProduct();
        while (['+', '-'].includes(String(peek().value))) {
            const operator = take().value;
            value = {
                type: 'binary',
                operator,
                left: value,
                right: parseProduct()
            };
        }
        return value;
    }

    function parseConcatenation() {
        let value = parseSum();
        while (match('&')) {
            value = {
                type: 'binary',
                operator: '&',
                left: value,
                right: parseSum()
            };
        }
        return value;
    }

    function parseComparison() {
        let value = parseConcatenation();
        while (['=', '<>', '!=', '<', '<=', '>', '>='].includes(String(peek().value))) {
            const operator = take().value;
            value = {
                type: 'binary',
                operator,
                left: value,
                right: parseConcatenation()
            };
        }
        return value;
    }

    const tree = parseComparison();
    if (peek().type !== 'eof') formulaError('Unexpected trailing input');
    return tree;
}

function isPisiRange(value) {
    return Boolean(value?.[PISI_RANGE_VALUE]);
}

function flattenPisiFormulaValues(values) {
    return values.flatMap((value) => {
        return isPisiRange(value)
            ? flattenPisiFormulaValues(value.values)
            : [value];
    });
}

function tryPisiFormulaNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value)
            ? { ok: true, value }
            : { ok: false, value: NaN };
    }
    if (typeof value === 'boolean') {
        return { ok: true, value: value ? 1 : 0 };
    }
    if (value === null || value === undefined || value === '') {
        return { ok: true, value: 0 };
    }
    if (typeof value === 'string') {
        const clean = value.trim();
        if (!clean) return { ok: true, value: 0 };
        const normalized = /^[-+]?\d+,\d+(?:[eE][-+]?\d+)?$/.test(clean)
            ? clean.replace(',', '.')
            : clean;
        const number = Number(normalized);
        if (Number.isFinite(number)) return { ok: true, value: number };
    }
    return { ok: false, value: NaN };
}

function toPisiFormulaNumber(value) {
    if (isPisiRange(value)) formulaError('Range cannot be used as a scalar');
    const result = tryPisiFormulaNumber(value);
    if (!result.ok) formulaError('Expected a number');
    return result.value;
}

function toPisiFormulaBoolean(value) {
    if (isPisiRange(value)) formulaError('Range cannot be used as a scalar');
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const clean = String(value ?? '').trim().toUpperCase();
    if (!clean || clean === 'FALSE' || clean === '0') return false;
    return true;
}

function toPisiFormulaText(value) {
    if (isPisiRange(value)) formulaError('Range cannot be used as a scalar');
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return String(value);
}

function getPisiFormulaNumbers(values, ignoreText = true) {
    const numbers = [];
    for (const value of flattenPisiFormulaValues(values)) {
        if (
            ignoreText &&
            (value === '' || value === null || value === undefined)
        ) {
            continue;
        }
        const result = tryPisiFormulaNumber(value);
        if (result.ok) {
            numbers.push(result.value);
        } else if (!ignoreText) {
            formulaError('Expected a number');
        }
    }
    return numbers;
}

function ensurePisiFormulaArity(args, minimum, maximum = minimum) {
    if (args.length < minimum || args.length > maximum) {
        formulaError('Wrong number of arguments');
    }
}

function roundPisiFormulaNumber(number, digits, mode = 'nearest') {
    const safeDigits = Math.max(-15, Math.min(15, Math.trunc(digits)));
    const factor = 10 ** Math.abs(safeDigits);
    const scaled = safeDigits >= 0 ? number * factor : number / factor;
    let rounded;

    if (mode === 'up') {
        rounded = Math.sign(scaled) * Math.ceil(Math.abs(scaled));
    } else if (mode === 'down') {
        rounded = Math.sign(scaled) * Math.floor(Math.abs(scaled));
    } else {
        const correction = Number.EPSILON * Math.max(1, Math.abs(scaled));
        rounded = Math.round(scaled + correction);
    }

    return safeDigits >= 0 ? rounded / factor : rounded * factor;
}

function gcdPisiFormula(left, right) {
    let a = Math.abs(Math.trunc(left));
    let b = Math.abs(Math.trunc(right));
    while (b) [a, b] = [b, a % b];
    return a;
}

function resolvePisiFormulaCell(context, ref) {
    if (typeof context.resolveCell !== 'function') {
        formulaError('Cell references are unavailable');
    }
    const result = context.resolveCell(ref);
    if (result?.ok === false) formulaError(result.error);
    return result && Object.hasOwn(result, 'value')
        ? result.value
        : result;
}

function resolvePisiFormulaRange(context, start, end) {
    if (typeof context.resolveRange !== 'function') {
        formulaError('Cell ranges are unavailable');
    }
    const result = context.resolveRange(start, end);
    if (result?.ok === false) formulaError(result.error);
    const values = result && Object.hasOwn(result, 'values')
        ? result.values
        : result;
    if (!Array.isArray(values)) formulaError('Invalid cell range');
    return { [PISI_RANGE_VALUE]: true, values };
}

function comparePisiFormulaValues(left, right, operator) {
    const leftNumber = tryPisiFormulaNumber(left);
    const rightNumber = tryPisiFormulaNumber(right);
    const numeric = leftNumber.ok && rightNumber.ok;
    const a = numeric ? leftNumber.value : toPisiFormulaText(left);
    const b = numeric ? rightNumber.value : toPisiFormulaText(right);

    if (operator === '=') return a === b;
    if (operator === '<>' || operator === '!=') return a !== b;
    if (operator === '<') return a < b;
    if (operator === '<=') return a <= b;
    if (operator === '>') return a > b;
    if (operator === '>=') return a >= b;
    formulaError('Unknown comparison');
}

function evaluatePisiFormulaCall(node, context) {
    const { name, args } = node;

    if (name === 'IF') {
        ensurePisiFormulaArity(args, 2, 3);
        return toPisiFormulaBoolean(evaluatePisiFormulaNode(args[0], context))
            ? evaluatePisiFormulaNode(args[1], context)
            : (args[2] ? evaluatePisiFormulaNode(args[2], context) : false);
    }

    if (name === 'IFERROR') {
        ensurePisiFormulaArity(args, 2);
        try {
            return evaluatePisiFormulaNode(args[0], context);
        } catch (error) {
            if (!(error instanceof PisiFormulaError)) throw error;
            return evaluatePisiFormulaNode(args[1], context);
        }
    }

    if (['AND', 'OR', 'XOR'].includes(name)) {
        if (!args.length) formulaError('Logical function requires arguments');
        let truthyCount = 0;
        for (const arg of args) {
            const values = flattenPisiFormulaValues([
                evaluatePisiFormulaNode(arg, context)
            ]);
            for (const value of values) {
                const truthy = toPisiFormulaBoolean(value);
                if (name === 'AND' && !truthy) return false;
                if (name === 'OR' && truthy) return true;
                if (truthy) truthyCount += 1;
            }
        }
        if (name === 'AND') return true;
        if (name === 'OR') return false;
        return truthyCount % 2 === 1;
    }

    if (name === 'NOT') {
        ensurePisiFormulaArity(args, 1);
        return !toPisiFormulaBoolean(evaluatePisiFormulaNode(args[0], context));
    }

    if (name === 'TRUE' || name === 'FALSE') {
        ensurePisiFormulaArity(args, 0);
        return name === 'TRUE';
    }

    const values = args.map((arg) => evaluatePisiFormulaNode(arg, context));
    const scalar = (position) => {
        if (position >= values.length) formulaError('Missing argument');
        return values[position];
    };
    const number = (position) => toPisiFormulaNumber(scalar(position));
    const text = (position) => toPisiFormulaText(scalar(position));

    if (['SUM', 'AVG', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'PRODUCT', 'MEDIAN', 'SUMSQ'].includes(name)) {
        const numbers = getPisiFormulaNumbers(values);
        if (name === 'SUM') return numbers.reduce((sum, item) => sum + item, 0);
        if (name === 'COUNT') return numbers.length;
        if (name === 'PRODUCT') {
            return numbers.length
                ? numbers.reduce((product, item) => product * item, 1)
                : 0;
        }
        if (name === 'SUMSQ') {
            return numbers.reduce((sum, item) => sum + item ** 2, 0);
        }
        if (!numbers.length) formulaError('No numeric values');
        if (name === 'AVG' || name === 'AVERAGE') {
            return numbers.reduce((sum, item) => sum + item, 0) / numbers.length;
        }
        if (name === 'MIN') return Math.min(...numbers);
        if (name === 'MAX') return Math.max(...numbers);
        const sorted = [...numbers].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2
            ? sorted[middle]
            : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    if (name === 'ABS' || name === 'SIGN' || name === 'SQRT') {
        ensurePisiFormulaArity(values, 1);
        const value = number(0);
        if (name === 'ABS') return Math.abs(value);
        if (name === 'SIGN') return Math.sign(value);
        if (value < 0) formulaError('Square root domain error');
        return Math.sqrt(value);
    }

    if (['ROUND', 'ROUNDUP', 'ROUNDDOWN'].includes(name)) {
        ensurePisiFormulaArity(values, 1, 2);
        const digits = values.length > 1 ? number(1) : 0;
        const mode = name === 'ROUNDUP'
            ? 'up'
            : (name === 'ROUNDDOWN' ? 'down' : 'nearest');
        return roundPisiFormulaNumber(number(0), digits, mode);
    }

    if (name === 'FLOOR' || name === 'CEILING' || name === 'CEIL') {
        ensurePisiFormulaArity(values, 1, 2);
        const value = number(0);
        const significance = values.length > 1 ? Math.abs(number(1)) : 1;
        if (!significance) formulaError('Zero significance');
        return (name === 'FLOOR' ? Math.floor : Math.ceil)(value / significance) * significance;
    }

    if (['MOD', 'POWER', 'POW', 'ATAN2'].includes(name)) {
        ensurePisiFormulaArity(values, 2);
        const left = number(0);
        const right = number(1);
        if (name === 'MOD') {
            if (!right) formulaError('Division by zero');
            return ((left % right) + right) % right;
        }
        if (name === 'ATAN2') return Math.atan2(right, left);
        return left ** right;
    }

    if (name === 'FACT') {
        ensurePisiFormulaArity(values, 1);
        const value = number(0);
        if (!Number.isInteger(value) || value < 0 || value > 170) {
            formulaError('Factorial domain error');
        }
        let result = 1;
        for (let item = 2; item <= value; item += 1) result *= item;
        return result;
    }

    if (name === 'GCD' || name === 'LCM') {
        if (!values.length) formulaError('Missing argument');
        const numbers = getPisiFormulaNumbers(values, false);
        if (name === 'GCD') return numbers.reduce(gcdPisiFormula);
        return numbers.reduce((left, right) => {
            if (!left || !right) return 0;
            return Math.abs(left * right) / gcdPisiFormula(left, right);
        });
    }

    const unaryMath = {
        SIN: Math.sin,
        COS: Math.cos,
        TAN: Math.tan,
        ASIN: Math.asin,
        ACOS: Math.acos,
        ATAN: Math.atan,
        SINH: Math.sinh,
        COSH: Math.cosh,
        TANH: Math.tanh,
        EXP: Math.exp,
        LN: Math.log,
        LOG10: Math.log10,
        LOG2: Math.log2,
        DEGREES: (value) => value * 180 / Math.PI,
        RADIANS: (value) => value * Math.PI / 180
    };
    if (unaryMath[name]) {
        ensurePisiFormulaArity(values, 1);
        return unaryMath[name](number(0));
    }

    if (name === 'LOG') {
        ensurePisiFormulaArity(values, 1, 2);
        const value = number(0);
        const base = values.length > 1 ? number(1) : 10;
        if (value <= 0 || base <= 0 || base === 1) formulaError('Logarithm domain error');
        return Math.log(value) / Math.log(base);
    }

    if (name === 'PI' || name === 'E') {
        ensurePisiFormulaArity(values, 0);
        return name === 'PI' ? Math.PI : Math.E;
    }

    if (name === 'CONCAT' || name === 'CONCATENATE') {
        return flattenPisiFormulaValues(values).map(toPisiFormulaText).join('');
    }

    if (name === 'LEN') {
        ensurePisiFormulaArity(values, 1);
        return Array.from(text(0)).length;
    }

    if (name === 'LEFT' || name === 'RIGHT') {
        ensurePisiFormulaArity(values, 1, 2);
        const characters = Array.from(text(0));
        const count = values.length > 1 ? Math.trunc(number(1)) : 1;
        if (count < 0) formulaError('Negative character count');
        return name === 'LEFT'
            ? characters.slice(0, count).join('')
            : characters.slice(Math.max(0, characters.length - count)).join('');
    }

    if (name === 'MID') {
        ensurePisiFormulaArity(values, 3);
        const start = Math.trunc(number(1));
        const count = Math.trunc(number(2));
        if (start < 1 || count < 0) formulaError('Invalid text range');
        return Array.from(text(0)).slice(start - 1, start - 1 + count).join('');
    }

    if (name === 'UPPER' || name === 'LOWER') {
        ensurePisiFormulaArity(values, 1);
        const locale = context.locale || undefined;
        return name === 'UPPER'
            ? text(0).toLocaleUpperCase(locale)
            : text(0).toLocaleLowerCase(locale);
    }

    if (name === 'TRIM') {
        ensurePisiFormulaArity(values, 1);
        return text(0).trim().replace(/\s+/g, ' ');
    }

    if (name === 'REPLACE') {
        ensurePisiFormulaArity(values, 4);
        const characters = Array.from(text(0));
        const start = Math.trunc(number(1));
        const count = Math.trunc(number(2));
        if (start < 1 || count < 0) formulaError('Invalid text range');
        characters.splice(start - 1, count, ...Array.from(text(3)));
        return characters.join('');
    }

    if (name === 'SUBSTITUTE') {
        ensurePisiFormulaArity(values, 3, 4);
        const source = text(0);
        const search = text(1);
        const replacement = text(2);
        if (!search) return source;
        if (values.length === 3) return source.split(search).join(replacement);
        const instance = Math.trunc(number(3));
        if (instance < 1) formulaError('Invalid occurrence');
        let count = 0;
        return source.replaceAll(search, (match) => {
            count += 1;
            return count === instance ? replacement : match;
        });
    }

    if (name === 'TEXTJOIN') {
        ensurePisiFormulaArity(values, 3, Number.MAX_SAFE_INTEGER);
        const delimiter = text(0);
        const ignoreEmpty = toPisiFormulaBoolean(values[1]);
        return flattenPisiFormulaValues(values.slice(2))
            .map(toPisiFormulaText)
            .filter((value) => !ignoreEmpty || value !== '')
            .join(delimiter);
    }

    if (name === 'FIND' || name === 'SEARCH') {
        ensurePisiFormulaArity(values, 2, 3);
        const needle = name === 'SEARCH' ? text(0).toLocaleLowerCase() : text(0);
        const haystack = name === 'SEARCH' ? text(1).toLocaleLowerCase() : text(1);
        const start = values.length > 2 ? Math.trunc(number(2)) : 1;
        if (start < 1) formulaError('Invalid search position');
        const found = haystack.indexOf(needle, start - 1);
        if (found < 0) formulaError('Text not found');
        return found + 1;
    }

    if (name === 'EXACT') {
        ensurePisiFormulaArity(values, 2);
        return text(0) === text(1);
    }

    if (name === 'VALUE') {
        ensurePisiFormulaArity(values, 1);
        return number(0);
    }

    formulaError(`Unsupported function: ${name}`);
}

function evaluatePisiFormulaNode(node, context) {
    if (node.type === 'number' || node.type === 'string') return node.value;
    if (node.type === 'cell') return resolvePisiFormulaCell(context, node.ref);
    if (node.type === 'range') {
        return resolvePisiFormulaRange(context, node.start, node.end);
    }
    if (node.type === 'constant') {
        if (node.name === 'TRUE') return true;
        if (node.name === 'FALSE') return false;
        return node.name === 'PI' ? Math.PI : Math.E;
    }
    if (node.type === 'call') return evaluatePisiFormulaCall(node, context);
    if (node.type === 'percent') {
        return toPisiFormulaNumber(evaluatePisiFormulaNode(node.value, context)) / 100;
    }
    if (node.type === 'unary') {
        const value = toPisiFormulaNumber(evaluatePisiFormulaNode(node.value, context));
        return node.operator === '-' ? -value : value;
    }
    if (node.type === 'binary') {
        const left = evaluatePisiFormulaNode(node.left, context);
        const right = evaluatePisiFormulaNode(node.right, context);

        if (['=', '<>', '!=', '<', '<=', '>', '>='].includes(node.operator)) {
            return comparePisiFormulaValues(left, right, node.operator);
        }
        if (node.operator === '&') {
            return toPisiFormulaText(left) + toPisiFormulaText(right);
        }

        const a = toPisiFormulaNumber(left);
        const b = toPisiFormulaNumber(right);
        if (node.operator === '+') return a + b;
        if (node.operator === '-') return a - b;
        if (node.operator === '*') return a * b;
        if (node.operator === '/') {
            if (!b) formulaError('Division by zero');
            return a / b;
        }
        if (node.operator === '^') return a ** b;
    }
    formulaError('Invalid expression');
}

export function evaluatePisiFormulaExpression(formula, context = {}) {
    try {
        let expression = String(formula || '').trim();
        if (expression.startsWith('=')) expression = expression.slice(1);
        if (!expression.trim()) formulaError('Empty formula');
        const value = evaluatePisiFormulaNode(parsePisiFormula(expression), context);
        if (isPisiRange(value)) formulaError('Formula cannot return a range');
        if (typeof value === 'number' && !Number.isFinite(value)) {
            formulaError('Non-finite result');
        }
        return { ok: true, value };
    } catch (error) {
        if (!(error instanceof PisiFormulaError)) throw error;
        return { ok: false, value: null, error: '#ERR' };
    }
}
, '')
            };
        }

        if (['TRUE', 'FALSE', 'PI', 'E'].includes(String(token.value))) {
            return { type: 'constant', name: token.value };
        }

        formulaError(`Unknown name: ${token.value}`);
    }

    function parsePostfix() {
        let value = parsePrimary();
        while (match('%')) value = { type: 'percent', value };
        return value;
    }

    function parsePower() {
        const left = parsePostfix();
        if (!match('^')) return left;
        return {
            type: 'binary',
            operator: '^',
            left,
            right: parseUnary()
        };
    }

    function parseUnary() {
        if (match('+')) {
            return { type: 'unary', operator: '+', value: parseUnary() };
        }
        if (match('-')) {
            return { type: 'unary', operator: '-', value: parseUnary() };
        }
        return parsePower();
    }

    function parseProduct() {
        let value = parseUnary();
        while (['*', '/'].includes(String(peek().value))) {
            const operator = take().value;
            value = {
                type: 'binary',
                operator,
                left: value,
                right: parseUnary()
            };
        }
        return value;
    }

    function parseSum() {
        let value = parseProduct();
        while (['+', '-'].includes(String(peek().value))) {
            const operator = take().value;
            value = {
                type: 'binary',
                operator,
                left: value,
                right: parseProduct()
            };
        }
        return value;
    }

    function parseConcatenation() {
        let value = parseSum();
        while (match('&')) {
            value = {
                type: 'binary',
                operator: '&',
                left: value,
                right: parseSum()
            };
        }
        return value;
    }

    function parseComparison() {
        let value = parseConcatenation();
        while (['=', '<>', '!=', '<', '<=', '>', '>='].includes(String(peek().value))) {
            const operator = take().value;
            value = {
                type: 'binary',
                operator,
                left: value,
                right: parseConcatenation()
            };
        }
        return value;
    }

    const tree = parseComparison();
    if (peek().type !== 'eof') formulaError('Unexpected trailing input');
    return tree;
}

function isPisiRange(value) {
    return Boolean(value?.[PISI_RANGE_VALUE]);
}

function flattenPisiFormulaValues(values) {
    return values.flatMap((value) => {
        return isPisiRange(value)
            ? flattenPisiFormulaValues(value.values)
            : [value];
    });
}

function tryPisiFormulaNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value)
            ? { ok: true, value }
            : { ok: false, value: NaN };
    }
    if (typeof value === 'boolean') {
        return { ok: true, value: value ? 1 : 0 };
    }
    if (value === null || value === undefined || value === '') {
        return { ok: true, value: 0 };
    }
    if (typeof value === 'string') {
        const clean = value.trim();
        if (!clean) return { ok: true, value: 0 };
        const normalized = /^[-+]?\d+,\d+(?:[eE][-+]?\d+)?$/.test(clean)
            ? clean.replace(',', '.')
            : clean;
        const number = Number(normalized);
        if (Number.isFinite(number)) return { ok: true, value: number };
    }
    return { ok: false, value: NaN };
}

function toPisiFormulaNumber(value) {
    if (isPisiRange(value)) formulaError('Range cannot be used as a scalar');
    const result = tryPisiFormulaNumber(value);
    if (!result.ok) formulaError('Expected a number');
    return result.value;
}

function toPisiFormulaBoolean(value) {
    if (isPisiRange(value)) formulaError('Range cannot be used as a scalar');
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const clean = String(value ?? '').trim().toUpperCase();
    if (!clean || clean === 'FALSE' || clean === '0') return false;
    return true;
}

function toPisiFormulaText(value) {
    if (isPisiRange(value)) formulaError('Range cannot be used as a scalar');
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return String(value);
}

function getPisiFormulaNumbers(values, ignoreText = true) {
    const numbers = [];
    for (const value of flattenPisiFormulaValues(values)) {
        if (
            ignoreText &&
            (value === '' || value === null || value === undefined)
        ) {
            continue;
        }
        const result = tryPisiFormulaNumber(value);
        if (result.ok) {
            numbers.push(result.value);
        } else if (!ignoreText) {
            formulaError('Expected a number');
        }
    }
    return numbers;
}

function ensurePisiFormulaArity(args, minimum, maximum = minimum) {
    if (args.length < minimum || args.length > maximum) {
        formulaError('Wrong number of arguments');
    }
}

function roundPisiFormulaNumber(number, digits, mode = 'nearest') {
    const safeDigits = Math.max(-15, Math.min(15, Math.trunc(digits)));
    const factor = 10 ** Math.abs(safeDigits);
    const scaled = safeDigits >= 0 ? number * factor : number / factor;
    let rounded;

    if (mode === 'up') {
        rounded = Math.sign(scaled) * Math.ceil(Math.abs(scaled));
    } else if (mode === 'down') {
        rounded = Math.sign(scaled) * Math.floor(Math.abs(scaled));
    } else {
        const correction = Number.EPSILON * Math.max(1, Math.abs(scaled));
        rounded = Math.round(scaled + correction);
    }

    return safeDigits >= 0 ? rounded / factor : rounded * factor;
}

function gcdPisiFormula(left, right) {
    let a = Math.abs(Math.trunc(left));
    let b = Math.abs(Math.trunc(right));
    while (b) [a, b] = [b, a % b];
    return a;
}

function resolvePisiFormulaCell(context, ref) {
    if (typeof context.resolveCell !== 'function') {
        formulaError('Cell references are unavailable');
    }
    const result = context.resolveCell(ref);
    if (result?.ok === false) formulaError(result.error);
    return result && Object.hasOwn(result, 'value')
        ? result.value
        : result;
}

function resolvePisiFormulaRange(context, start, end) {
    if (typeof context.resolveRange !== 'function') {
        formulaError('Cell ranges are unavailable');
    }
    const result = context.resolveRange(start, end);
    if (result?.ok === false) formulaError(result.error);
    const values = result && Object.hasOwn(result, 'values')
        ? result.values
        : result;
    if (!Array.isArray(values)) formulaError('Invalid cell range');
    return { [PISI_RANGE_VALUE]: true, values };
}

function comparePisiFormulaValues(left, right, operator) {
    const leftNumber = tryPisiFormulaNumber(left);
    const rightNumber = tryPisiFormulaNumber(right);
    const numeric = leftNumber.ok && rightNumber.ok;
    const a = numeric ? leftNumber.value : toPisiFormulaText(left);
    const b = numeric ? rightNumber.value : toPisiFormulaText(right);

    if (operator === '=') return a === b;
    if (operator === '<>' || operator === '!=') return a !== b;
    if (operator === '<') return a < b;
    if (operator === '<=') return a <= b;
    if (operator === '>') return a > b;
    if (operator === '>=') return a >= b;
    formulaError('Unknown comparison');
}

function evaluatePisiFormulaCall(node, context) {
    const { name, args } = node;

    if (name === 'IF') {
        ensurePisiFormulaArity(args, 2, 3);
        return toPisiFormulaBoolean(evaluatePisiFormulaNode(args[0], context))
            ? evaluatePisiFormulaNode(args[1], context)
            : (args[2] ? evaluatePisiFormulaNode(args[2], context) : false);
    }

    if (name === 'IFERROR') {
        ensurePisiFormulaArity(args, 2);
        try {
            return evaluatePisiFormulaNode(args[0], context);
        } catch (error) {
            if (!(error instanceof PisiFormulaError)) throw error;
            return evaluatePisiFormulaNode(args[1], context);
        }
    }

    if (['AND', 'OR', 'XOR'].includes(name)) {
        if (!args.length) formulaError('Logical function requires arguments');
        let truthyCount = 0;
        for (const arg of args) {
            const values = flattenPisiFormulaValues([
                evaluatePisiFormulaNode(arg, context)
            ]);
            for (const value of values) {
                const truthy = toPisiFormulaBoolean(value);
                if (name === 'AND' && !truthy) return false;
                if (name === 'OR' && truthy) return true;
                if (truthy) truthyCount += 1;
            }
        }
        if (name === 'AND') return true;
        if (name === 'OR') return false;
        return truthyCount % 2 === 1;
    }

    if (name === 'NOT') {
        ensurePisiFormulaArity(args, 1);
        return !toPisiFormulaBoolean(evaluatePisiFormulaNode(args[0], context));
    }

    if (name === 'TRUE' || name === 'FALSE') {
        ensurePisiFormulaArity(args, 0);
        return name === 'TRUE';
    }

    const values = args.map((arg) => evaluatePisiFormulaNode(arg, context));
    const scalar = (position) => {
        if (position >= values.length) formulaError('Missing argument');
        return values[position];
    };
    const number = (position) => toPisiFormulaNumber(scalar(position));
    const text = (position) => toPisiFormulaText(scalar(position));

    if (['SUM', 'AVG', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'PRODUCT', 'MEDIAN', 'SUMSQ'].includes(name)) {
        const numbers = getPisiFormulaNumbers(values);
        if (name === 'SUM') return numbers.reduce((sum, item) => sum + item, 0);
        if (name === 'COUNT') return numbers.length;
        if (name === 'PRODUCT') {
            return numbers.length
                ? numbers.reduce((product, item) => product * item, 1)
                : 0;
        }
        if (name === 'SUMSQ') {
            return numbers.reduce((sum, item) => sum + item ** 2, 0);
        }
        if (!numbers.length) formulaError('No numeric values');
        if (name === 'AVG' || name === 'AVERAGE') {
            return numbers.reduce((sum, item) => sum + item, 0) / numbers.length;
        }
        if (name === 'MIN') return Math.min(...numbers);
        if (name === 'MAX') return Math.max(...numbers);
        const sorted = [...numbers].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2
            ? sorted[middle]
            : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    if (name === 'ABS' || name === 'SIGN' || name === 'SQRT') {
        ensurePisiFormulaArity(values, 1);
        const value = number(0);
        if (name === 'ABS') return Math.abs(value);
        if (name === 'SIGN') return Math.sign(value);
        if (value < 0) formulaError('Square root domain error');
        return Math.sqrt(value);
    }

    if (['ROUND', 'ROUNDUP', 'ROUNDDOWN'].includes(name)) {
        ensurePisiFormulaArity(values, 1, 2);
        const digits = values.length > 1 ? number(1) : 0;
        const mode = name === 'ROUNDUP'
            ? 'up'
            : (name === 'ROUNDDOWN' ? 'down' : 'nearest');
        return roundPisiFormulaNumber(number(0), digits, mode);
    }

    if (name === 'FLOOR' || name === 'CEILING' || name === 'CEIL') {
        ensurePisiFormulaArity(values, 1, 2);
        const value = number(0);
        const significance = values.length > 1 ? Math.abs(number(1)) : 1;
        if (!significance) formulaError('Zero significance');
        return (name === 'FLOOR' ? Math.floor : Math.ceil)(value / significance) * significance;
    }

    if (['MOD', 'POWER', 'POW', 'ATAN2'].includes(name)) {
        ensurePisiFormulaArity(values, 2);
        const left = number(0);
        const right = number(1);
        if (name === 'MOD') {
            if (!right) formulaError('Division by zero');
            return ((left % right) + right) % right;
        }
        if (name === 'ATAN2') return Math.atan2(right, left);
        return left ** right;
    }

    if (name === 'FACT') {
        ensurePisiFormulaArity(values, 1);
        const value = number(0);
        if (!Number.isInteger(value) || value < 0 || value > 170) {
            formulaError('Factorial domain error');
        }
        let result = 1;
        for (let item = 2; item <= value; item += 1) result *= item;
        return result;
    }

    if (name === 'GCD' || name === 'LCM') {
        if (!values.length) formulaError('Missing argument');
        const numbers = getPisiFormulaNumbers(values, false);
        if (name === 'GCD') return numbers.reduce(gcdPisiFormula);
        return numbers.reduce((left, right) => {
            if (!left || !right) return 0;
            return Math.abs(left * right) / gcdPisiFormula(left, right);
        });
    }

    const unaryMath = {
        SIN: Math.sin,
        COS: Math.cos,
        TAN: Math.tan,
        ASIN: Math.asin,
        ACOS: Math.acos,
        ATAN: Math.atan,
        SINH: Math.sinh,
        COSH: Math.cosh,
        TANH: Math.tanh,
        EXP: Math.exp,
        LN: Math.log,
        LOG10: Math.log10,
        LOG2: Math.log2,
        DEGREES: (value) => value * 180 / Math.PI,
        RADIANS: (value) => value * Math.PI / 180
    };
    if (unaryMath[name]) {
        ensurePisiFormulaArity(values, 1);
        return unaryMath[name](number(0));
    }

    if (name === 'LOG') {
        ensurePisiFormulaArity(values, 1, 2);
        const value = number(0);
        const base = values.length > 1 ? number(1) : 10;
        if (value <= 0 || base <= 0 || base === 1) formulaError('Logarithm domain error');
        return Math.log(value) / Math.log(base);
    }

    if (name === 'PI' || name === 'E') {
        ensurePisiFormulaArity(values, 0);
        return name === 'PI' ? Math.PI : Math.E;
    }

    if (name === 'CONCAT' || name === 'CONCATENATE') {
        return flattenPisiFormulaValues(values).map(toPisiFormulaText).join('');
    }

    if (name === 'LEN') {
        ensurePisiFormulaArity(values, 1);
        return Array.from(text(0)).length;
    }

    if (name === 'LEFT' || name === 'RIGHT') {
        ensurePisiFormulaArity(values, 1, 2);
        const characters = Array.from(text(0));
        const count = values.length > 1 ? Math.trunc(number(1)) : 1;
        if (count < 0) formulaError('Negative character count');
        return name === 'LEFT'
            ? characters.slice(0, count).join('')
            : characters.slice(Math.max(0, characters.length - count)).join('');
    }

    if (name === 'MID') {
        ensurePisiFormulaArity(values, 3);
        const start = Math.trunc(number(1));
        const count = Math.trunc(number(2));
        if (start < 1 || count < 0) formulaError('Invalid text range');
        return Array.from(text(0)).slice(start - 1, start - 1 + count).join('');
    }

    if (name === 'UPPER' || name === 'LOWER') {
        ensurePisiFormulaArity(values, 1);
        const locale = context.locale || undefined;
        return name === 'UPPER'
            ? text(0).toLocaleUpperCase(locale)
            : text(0).toLocaleLowerCase(locale);
    }

    if (name === 'TRIM') {
        ensurePisiFormulaArity(values, 1);
        return text(0).trim().replace(/\s+/g, ' ');
    }

    if (name === 'REPLACE') {
        ensurePisiFormulaArity(values, 4);
        const characters = Array.from(text(0));
        const start = Math.trunc(number(1));
        const count = Math.trunc(number(2));
        if (start < 1 || count < 0) formulaError('Invalid text range');
        characters.splice(start - 1, count, ...Array.from(text(3)));
        return characters.join('');
    }

    if (name === 'SUBSTITUTE') {
        ensurePisiFormulaArity(values, 3, 4);
        const source = text(0);
        const search = text(1);
        const replacement = text(2);
        if (!search) return source;
        if (values.length === 3) return source.split(search).join(replacement);
        const instance = Math.trunc(number(3));
        if (instance < 1) formulaError('Invalid occurrence');
        let count = 0;
        return source.replaceAll(search, (match) => {
            count += 1;
            return count === instance ? replacement : match;
        });
    }

    if (name === 'TEXTJOIN') {
        ensurePisiFormulaArity(values, 3, Number.MAX_SAFE_INTEGER);
        const delimiter = text(0);
        const ignoreEmpty = toPisiFormulaBoolean(values[1]);
        return flattenPisiFormulaValues(values.slice(2))
            .map(toPisiFormulaText)
            .filter((value) => !ignoreEmpty || value !== '')
            .join(delimiter);
    }

    if (name === 'FIND' || name === 'SEARCH') {
        ensurePisiFormulaArity(values, 2, 3);
        const needle = name === 'SEARCH' ? text(0).toLocaleLowerCase() : text(0);
        const haystack = name === 'SEARCH' ? text(1).toLocaleLowerCase() : text(1);
        const start = values.length > 2 ? Math.trunc(number(2)) : 1;
        if (start < 1) formulaError('Invalid search position');
        const found = haystack.indexOf(needle, start - 1);
        if (found < 0) formulaError('Text not found');
        return found + 1;
    }

    if (name === 'EXACT') {
        ensurePisiFormulaArity(values, 2);
        return text(0) === text(1);
    }

    if (name === 'VALUE') {
        ensurePisiFormulaArity(values, 1);
        return number(0);
    }

    formulaError(`Unsupported function: ${name}`);
}

function evaluatePisiFormulaNode(node, context) {
    if (node.type === 'number' || node.type === 'string') return node.value;
    if (node.type === 'cell') return resolvePisiFormulaCell(context, node.ref);
    if (node.type === 'range') {
        return resolvePisiFormulaRange(context, node.start, node.end);
    }
    if (node.type === 'constant') {
        if (node.name === 'TRUE') return true;
        if (node.name === 'FALSE') return false;
        return node.name === 'PI' ? Math.PI : Math.E;
    }
    if (node.type === 'call') return evaluatePisiFormulaCall(node, context);
    if (node.type === 'percent') {
        return toPisiFormulaNumber(evaluatePisiFormulaNode(node.value, context)) / 100;
    }
    if (node.type === 'unary') {
        const value = toPisiFormulaNumber(evaluatePisiFormulaNode(node.value, context));
        return node.operator === '-' ? -value : value;
    }
    if (node.type === 'binary') {
        const left = evaluatePisiFormulaNode(node.left, context);
        const right = evaluatePisiFormulaNode(node.right, context);

        if (['=', '<>', '!=', '<', '<=', '>', '>='].includes(node.operator)) {
            return comparePisiFormulaValues(left, right, node.operator);
        }
        if (node.operator === '&') {
            return toPisiFormulaText(left) + toPisiFormulaText(right);
        }

        const a = toPisiFormulaNumber(left);
        const b = toPisiFormulaNumber(right);
        if (node.operator === '+') return a + b;
        if (node.operator === '-') return a - b;
        if (node.operator === '*') return a * b;
        if (node.operator === '/') {
            if (!b) formulaError('Division by zero');
            return a / b;
        }
        if (node.operator === '^') return a ** b;
    }
    formulaError('Invalid expression');
}

export function evaluatePisiFormulaExpression(formula, context = {}) {
    try {
        let expression = String(formula || '').trim();
        if (expression.startsWith('=')) expression = expression.slice(1);
        if (!expression.trim()) formulaError('Empty formula');
        const value = evaluatePisiFormulaNode(parsePisiFormula(expression), context);
        if (isPisiRange(value)) formulaError('Formula cannot return a range');
        if (typeof value === 'number' && !Number.isFinite(value)) {
            formulaError('Non-finite result');
        }
        return { ok: true, value };
    } catch (error) {
        if (!(error instanceof PisiFormulaError)) throw error;
        return { ok: false, value: null, error: '#ERR' };
    }
}
