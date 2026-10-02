import * as crypto from 'node:crypto';

const PISI_PROPERTY_SCHEMA_VERSION = 1;
const PISI_PROPERTY_SCHEMA_RELATIVE_PATH = '.pisi/properties.json';
const PISI_EDITABLE_PROPERTY_TYPES = Object.freeze(['text', 'number', 'multiselect', 'relation']);
const PISI_INTERNAL_PROPERTY_TYPES = Object.freeze([...PISI_EDITABLE_PROPERTY_TYPES, 'rollup']);
const PISI_PROPERTY_TYPE_SET = new Set(PISI_INTERNAL_PROPERTY_TYPES);
const PISI_ROLLUP_AGGREGATES = new Set(['count', 'sum', 'average', 'min', 'max', 'unique', 'join']);

function normalizePropertyName(value = '') {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function normalizePropertyNameKey(value = '') {
    return normalizePropertyName(value)
        .toLocaleLowerCase('tr-TR')
        .replace(/[ıİ]/g, 'i')
        .replace(/[şŞ]/g, 's')
        .replace(/[ğĞ]/g, 'g')
        .replace(/[üÜ]/g, 'u')
        .replace(/[öÖ]/g, 'o')
        .replace(/[çÇ]/g, 'c')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');
}

function normalizePropertyType(value = 'text') {
    return String(value || 'text')
        .trim()
        .toLowerCase();
}

function isSupportedPropertyType(value) {
    return PISI_PROPERTY_TYPE_SET.has(normalizePropertyType(value));
}

function isEditablePropertyType(value) {
    return PISI_EDITABLE_PROPERTY_TYPES.includes(normalizePropertyType(value));
}

function normalizeStablePropertyId(value = '') {
    const source = String(value || '').trim();
    if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(source)) return source;
    return '';
}

function makeDeterministicPropertyId(name, type = 'text', salt = '') {
    const key = `${normalizePropertyNameKey(name)}\u0000${normalizePropertyType(type)}\u0000${String(salt || '')}`;
    const digest = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
    return `prop_${digest}`;
}

function makeNewPropertyId(name, type = 'text', occupiedIds = new Set()) {
    let salt = '';
    let id = makeDeterministicPropertyId(name, type, salt);
    let index = 1;
    while (occupiedIds.has(id)) {
        salt = String(index++);
        id = makeDeterministicPropertyId(name, type, salt);
    }
    return id;
}

function isEmptyPropertyValue(value) {
    if (value === null || value === undefined || value === '') return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

function normalizeStringArray(value, limit, itemLimit) {
    const source = Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : String(value).split(',');
    const result = [];
    const seen = new Set();
    for (const raw of source) {
        const item = String(raw ?? '')
            .trim()
            .slice(0, itemLimit);
        if (!item || seen.has(item)) continue;
        seen.add(item);
        result.push(item);
        if (result.length >= limit) break;
    }
    return result;
}

function normalizeRollupValue(value = {}) {
    /** @type {Record<string, any>} */
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const aggregate = String(source.aggregate || 'count');
    return {
        relationProperty: normalizeStablePropertyId(source.relationProperty || source.relationPropertyId) || '',
        targetProperty: normalizeStablePropertyId(source.targetProperty || source.targetPropertyId) || '',
        aggregate: PISI_ROLLUP_AGGREGATES.has(aggregate) ? aggregate : 'count',
        separator: String(source.separator || ', ').slice(0, 20)
    };
}

function normalizePropertyValue(type, value) {
    const resolvedType = normalizePropertyType(type);
    if (resolvedType === 'number') {
        if (value === null || value === undefined || String(value).trim() === '') return null;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }
    if (resolvedType === 'multiselect') {
        return normalizeStringArray(value, 100, 240);
    }
    if (resolvedType === 'relation') {
        return normalizeStringArray(value, 500, 2048);
    }
    if (resolvedType === 'rollup') return normalizeRollupValue(value);
    return String(value ?? '').slice(0, 10000);
}

function validatePropertyValue(type, value, options = {}) {
    const resolvedType = normalizePropertyType(type);
    if (!PISI_PROPERTY_TYPE_SET.has(resolvedType)) {
        return { ok: false, code: 'PROPERTY_TYPE_INVALID', normalized: value };
    }
    if (resolvedType === 'text') {
        if (value === null || value === undefined || typeof value === 'string') {
            return { ok: true, normalized: normalizePropertyValue(resolvedType, value) };
        }
        return { ok: false, code: 'PROPERTY_VALUE_INVALID', normalized: value };
    }
    if (resolvedType === 'number') {
        if (value === null || value === undefined || value === '') {
            return { ok: true, normalized: null };
        }
        const numeric = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(numeric) ? { ok: true, normalized: numeric } : { ok: false, code: 'PROPERTY_VALUE_INVALID', normalized: value };
    }
    if (resolvedType === 'multiselect' || resolvedType === 'relation') {
        if (!Array.isArray(value)) {
            return { ok: false, code: 'PROPERTY_VALUE_INVALID', normalized: value };
        }
        const stringsOnly = value.every((item) => typeof item === 'string');
        return stringsOnly
            ? { ok: true, normalized: normalizePropertyValue(resolvedType, value) }
            : { ok: false, code: 'PROPERTY_VALUE_INVALID', normalized: value };
    }
    if (resolvedType === 'rollup') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return { ok: false, code: 'PROPERTY_VALUE_INVALID', normalized: value };
        }
        const aggregate = String(value.aggregate || 'count');
        if (!PISI_ROLLUP_AGGREGATES.has(aggregate)) {
            return {
                ok: false,
                code: 'PROPERTY_VALUE_INVALID',
                normalized: normalizeRollupValue(value)
            };
        }
        return { ok: true, normalized: normalizeRollupValue(value) };
    }
    return { ok: false, code: 'PROPERTY_VALUE_INVALID', normalized: value };
}

function canLosslesslyChangePropertyType(fromType, toType, value) {
    const from = normalizePropertyType(fromType);
    const to = normalizePropertyType(toType);
    if (from === to || isEmptyPropertyValue(value)) return true;
    if (to === 'number') {
        return (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
    }
    if (to === 'text') return typeof value === 'string';
    if (to === 'multiselect' || to === 'relation') {
        return Array.isArray(value) && value.every((item) => typeof item === 'string');
    }
    if (to === 'rollup') return from === 'rollup' && validatePropertyValue('rollup', value).ok;
    return false;
}

function normalizePropertyDefinition(definition = {}, fallback = {}) {
    const name = normalizePropertyName(definition.name || fallback.name);
    const type = normalizePropertyType(definition.type || fallback.type || 'text');
    const id = normalizeStablePropertyId(definition.id || fallback.id);
    if (!id || !name || !PISI_PROPERTY_TYPE_SET.has(type)) return null;
    return {
        id,
        name,
        type,
        ...(definition.system === true ? { system: true } : {})
    };
}

function makePropertySchema(definitions = [], options = {}) {
    return {
        version: PISI_PROPERTY_SCHEMA_VERSION,
        definitions: definitions.map((item) => normalizePropertyDefinition(item)).filter(Boolean),
        conflicts: Array.isArray(options.conflicts) ? options.conflicts : [],
        updatedAt: options.updatedAt || new Date().toISOString()
    };
}

export {
    PISI_PROPERTY_SCHEMA_VERSION,
    PISI_PROPERTY_SCHEMA_RELATIVE_PATH,
    PISI_EDITABLE_PROPERTY_TYPES,
    PISI_INTERNAL_PROPERTY_TYPES,
    PISI_ROLLUP_AGGREGATES,
    normalizePropertyName,
    normalizePropertyNameKey,
    normalizePropertyType,
    isSupportedPropertyType,
    isEditablePropertyType,
    normalizeStablePropertyId,
    makeDeterministicPropertyId,
    makeNewPropertyId,
    isEmptyPropertyValue,
    normalizePropertyValue,
    normalizeRollupValue,
    validatePropertyValue,
    canLosslesslyChangePropertyType,
    normalizePropertyDefinition,
    makePropertySchema
};
