const PISI_SHEET_FIELD_TYPES = Object.freeze([
    Object.freeze({ value: 'text', label: 'Metin' }),
    Object.freeze({ value: 'number', label: 'Sayı' }),
    Object.freeze({ value: 'date', label: 'Tarih' }),
    Object.freeze({ value: 'select', label: 'Tek seçim' }),
    Object.freeze({ value: 'mSelect', label: 'Çoklu seçim' }),
    Object.freeze({ value: 'checkbox', label: 'Checkbox' }),
    Object.freeze({ value: 'formula', label: 'Formül' })
]);

const PISI_SHEET_SELECT_COLORS = Object.freeze([
    '#e57373',
    '#ffb74d',
    '#ffd54f',
    '#81c784',
    '#4dd0e1',
    '#64b5f6',
    '#9575cd',
    '#ba68c8',
    '#90a4ae'
]);

const PISI_SHEET_NUMBER_FORMATS = Object.freeze([
    Object.freeze({ value: 'plain', label: '1234' }),
    Object.freeze({ value: 'thousand', label: '1,234' }),
    Object.freeze({ value: 'currency-TRY', label: '₺1,234' }),
    Object.freeze({ value: 'percent', label: '34 %' })
]);

function normalizePisiSheetFieldType(type = 'text') {
    const value = String(type || 'text');
    return PISI_SHEET_FIELD_TYPES.some(
        (item) => item.value === value
    )
        ? value
        : 'text';
}

function createPisiSheetOptionId(label = '') {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return 'opt-' + uuid;

    const slug = String(label || 'option')
        .trim()
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24) || 'option';

    return (
        'opt-' +
        slug + '-' +
        Date.now().toString(36) + '-' +
        Math.random().toString(36).slice(2, 7)
    );
}

function normalizePisiSheetOption(option, index = 0) {
    if (!option || typeof option !== 'object') return null;

    const label = String(option.label || '').trim().slice(0, 80);
    if (!label) return null;

    const color = /^#[0-9a-f]{6}$/i.test(
        String(option.color || '')
    )
        ? String(option.color).toLowerCase()
        : PISI_SHEET_SELECT_COLORS[
            index % PISI_SHEET_SELECT_COLORS.length
        ];

    return {
        id: String(
            option.id ||
            createPisiSheetOptionId(label)
        ).slice(0, 96),
        label,
        color
    };
}

function normalizePisiSheetFieldOptions(options = []) {
    const result = [];
    const seenIds = new Set();

    for (const [index, raw] of Array.from(
        Array.isArray(options) ? options : []
    ).entries()) {
        const option = normalizePisiSheetOption(
            raw,
            index
        );
        if (!option || seenIds.has(option.id)) continue;

        seenIds.add(option.id);
        result.push(option);

        if (result.length >= 100) break;
    }

    return result;
}

function normalizePisiSheetNumberFormat(format = {}) {
    const raw =
        typeof format === 'string'
            ? { style: format }
            : (
                format &&
                typeof format === 'object'
                    ? format
                    : {}
            );

    const style = PISI_SHEET_NUMBER_FORMATS.some(
        (item) => item.value === raw.style
    )
        ? raw.style
        : 'plain';

    const decimals = Math.max(
        0,
        Math.min(
            8,
            Number.isInteger(Number(raw.decimals))
                ? Number(raw.decimals)
                : 2
        )
    );

    return {
        style,
        decimals
    };
}

function isPisiSheetEmptyStoredValue(value) {
    return (
        value === '' ||
        value === null ||
        value === undefined ||
        (
            Array.isArray(value) &&
            value.length === 0
        )
    );
}

function normalizePisiSheetStoredValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return '';
    }

    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 100);
    }

    return String(value);
}

function normalizePisiSheetDateValue(value) {
    const source = String(value ?? '').trim();
    if (!source) return '';

    const dateOnly = source.match(
        /^(\d{4})-(\d{2})-(\d{2})$/
    );
    if (dateOnly) {
        const date = new Date(
            source + 'T00:00:00Z'
        );

        return Number.isNaN(date.getTime())
            ? ''
            : source;
    }

    const date = new Date(source);
    if (Number.isNaN(date.getTime())) return '';

    return date.toISOString().slice(0, 10);
}

function normalizePisiSheetNumberValue(value) {
    if (
        value === null ||
        value === undefined ||
        String(value).trim() === ''
    ) {
        return '';
    }

    if (
        typeof value === 'number' &&
        Number.isFinite(value)
    ) {
        return value;
    }

    const source = String(value)
        .trim()
        .replace(/\s/g, '');

    const normalized =
        /^[-+]?\d+,\d+$/.test(source)
            ? source.replace(',', '.')
            : source.replace(/,/g, '');

    const numeric = Number(normalized);
    return Number.isFinite(numeric)
        ? numeric
        : '';
}

function findPisiSheetFieldOption(field, value) {
    const options = normalizePisiSheetFieldOptions(
        field?.options
    );
    const source = String(value ?? '').trim();

    return options.find(
        (option) => (
            option.id === source ||
            option.label === source
        )
    ) || null;
}

function normalizePisiSheetTypedValue(field, value) {
    const type = normalizePisiSheetFieldType(
        field?.type
    );

    if (type === 'number') {
        return normalizePisiSheetNumberValue(value);
    }

    if (type === 'date') {
        return normalizePisiSheetDateValue(value);
    }

    if (type === 'checkbox') {
        if (typeof value === 'boolean') return value;

        const source = String(value ?? '')
            .trim()
            .toLocaleLowerCase('en-US');

        return [
            'true',
            '1',
            'yes',
            'evet',
            'checked'
        ].includes(source);
    }

    if (type === 'select') {
        if (isPisiSheetEmptyStoredValue(value)) {
            return '';
        }

        return findPisiSheetFieldOption(
            field,
            value
        )?.id || '';
    }

    if (type === 'mSelect') {
        const source = Array.isArray(value)
            ? value
            : String(value ?? '').split(',');
        const result = [];
        const seen = new Set();

        for (const raw of source) {
            const option = findPisiSheetFieldOption(
                field,
                raw
            );
            if (!option || seen.has(option.id)) continue;

            seen.add(option.id);
            result.push(option.id);
        }

        return result;
    }

    return String(value ?? '');
}

function getPisiSheetTypedDisplayParts(
    field,
    value,
    locale = 'tr-TR'
) {
    const type = normalizePisiSheetFieldType(
        field?.type
    );

    if (type === 'checkbox') {
        return {
            kind: 'checkbox',
            checked: value === true
        };
    }

    if (type === 'select' || type === 'mSelect') {
        const ids = type === 'mSelect'
            ? (
                Array.isArray(value)
                    ? value
                    : []
            )
            : (
                value ? [String(value)] : []
            );
        const options = normalizePisiSheetFieldOptions(
            field?.options
        );

        return {
            kind: 'chips',
            chips: ids
                .map((id) => options.find(
                    (option) => option.id === id
                ))
                .filter(Boolean)
        };
    }

    if (type === 'date') {
        const canonical =
            normalizePisiSheetDateValue(value);

        if (!canonical) {
            return { kind: 'text', text: '' };
        }

        const date = new Date(
            canonical + 'T00:00:00Z'
        );

        return {
            kind: 'text',
            text: new Intl.DateTimeFormat(
                locale,
                {
                    year: 'numeric',
                    month: 'short',
                    day: '2-digit',
                    timeZone: 'UTC'
                }
            ).format(date)
        };
    }

    if (type === 'number') {
        const numeric =
            normalizePisiSheetNumberValue(value);

        if (numeric === '') {
            return { kind: 'text', text: '' };
        }

        const format = normalizePisiSheetNumberFormat(
            field?.numberFormat
        );

        if (format.style === 'plain') {
            return {
                kind: 'text',
                text: String(numeric)
            };
        }

        if (format.style === 'thousand') {
            return {
                kind: 'text',
                text: new Intl.NumberFormat(
                    locale,
                    {
                        minimumFractionDigits: 0,
                        maximumFractionDigits:
                            format.decimals
                    }
                ).format(numeric)
            };
        }

        if (format.style === 'currency-TRY') {
            return {
                kind: 'text',
                text: new Intl.NumberFormat(
                    locale,
                    {
                        style: 'currency',
                        currency: 'TRY',
                        minimumFractionDigits:
                            format.decimals,
                        maximumFractionDigits:
                            format.decimals
                    }
                ).format(numeric)
            };
        }

        if (format.style === 'percent') {
            return {
                kind: 'text',
                text: new Intl.NumberFormat(
                    locale,
                    {
                        style: 'percent',
                        minimumFractionDigits: 0,
                        maximumFractionDigits:
                            format.decimals
                    }
                ).format(numeric)
            };
        }
    }

    return {
        kind: 'text',
        text: String(value ?? '')
    };
}

export {
    PISI_SHEET_FIELD_TYPES,
    PISI_SHEET_SELECT_COLORS,
    PISI_SHEET_NUMBER_FORMATS,
    createPisiSheetOptionId,
    findPisiSheetFieldOption,
    getPisiSheetTypedDisplayParts,
    isPisiSheetEmptyStoredValue,
    normalizePisiSheetDateValue,
    normalizePisiSheetFieldOptions,
    normalizePisiSheetFieldType,
    normalizePisiSheetNumberFormat,
    normalizePisiSheetNumberValue,
    normalizePisiSheetStoredValue,
    normalizePisiSheetTypedValue
};
