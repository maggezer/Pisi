const PISI_NODE_PROPERTY_TYPES = Object.freeze([
    Object.freeze({ value: 'text', label: 'Metin' }),
    Object.freeze({ value: 'number', label: 'Sayı' }),
    Object.freeze({ value: 'multiselect', label: 'Tags' }),
    Object.freeze({ value: 'relation', label: 'Relation' })
]);

const PISI_ROLLUP_AGGREGATES = Object.freeze([
    Object.freeze({ value: 'count', label: 'Kayıt sayısı' }),
    Object.freeze({ value: 'sum', label: 'Toplam' }),
    Object.freeze({ value: 'average', label: 'Ortalama' }),
    Object.freeze({ value: 'min', label: 'En küçük' }),
    Object.freeze({ value: 'max', label: 'En büyük' }),
    Object.freeze({ value: 'unique', label: 'Benzersiz değerler' }),
    Object.freeze({ value: 'join', label: 'Birleştir' })
]);

function normalizePisiNodePropertyType(type = 'text') {
    return String(type || 'text')
        .trim()
        .toLowerCase();
}

/** @param {any} [value] */
function normalizePisiPropertySearch(value = '') {
    return String(value ?? '')
        .toLocaleLowerCase('tr-TR')
        .replace(/[ıİ]/g, 'i')
        .replace(/[şŞ]/g, 's')
        .replace(/[ğĞ]/g, 'g')
        .replace(/[üÜ]/g, 'u')
        .replace(/[öÖ]/g, 'o')
        .replace(/[çÇ]/g, 'c')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizePisiPropertyCollection(properties = {}) {
    const entries = Array.isArray(properties) ? properties.map((item) => [item?.id || item?.name, item]) : Object.entries(properties || {});
    return entries
        .map(([id, property]) => ({
            id: String(property?.id || id || ''),
            name: String(property?.name || id || ''),
            type: normalizePisiNodePropertyType(property?.type),
            value: property?.value,
            system: property?.system === true
        }))
        .filter((property) => property.id && property.name);
}

function pisiPropertyPathKey(value = '') {
    return String(value || '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '')
        .toLocaleLowerCase('en-US');
}

function resolvePisiRelationDocuments(property, documents = []) {
    if (property?.type !== 'relation') return [];
    const values = Array.isArray(property.value) ? property.value : String(property.value || '').split(',');
    const records = Array.from(documents || []);
    const resolved = [];
    const seen = new Set();
    for (const rawValue of values) {
        const value = String(rawValue || '').trim();
        if (!value) continue;
        const pathKey = pisiPropertyPathKey(value);
        const textKey = normalizePisiPropertySearch(value.replace(/\.node$/i, ''));
        const match = records.find((documentRecord) => {
            return (
                [documentRecord.path, documentRecord.relativePath, documentRecord.fileName, documentRecord.metadata?.id].some(
                    (candidate) => pisiPropertyPathKey(candidate) === pathKey
                ) || normalizePisiPropertySearch(documentRecord.title) === textKey
            );
        });
        if (match && !seen.has(pisiPropertyPathKey(match.path))) {
            seen.add(pisiPropertyPathKey(match.path));
            resolved.push(match);
        }
    }
    return resolved;
}

function getPisiRollupTargetValues(relatedDocuments, targetProperty) {
    const target = normalizePisiPropertySearch(targetProperty);
    const values = [];
    for (const documentRecord of relatedDocuments) {
        const property = normalizePisiPropertyCollection(documentRecord.properties).find((item) => {
            return normalizePisiPropertySearch(item.id) === target || normalizePisiPropertySearch(item.name) === target;
        });
        if (!property) continue;
        if (Array.isArray(property.value)) values.push(...property.value);
        else values.push(property.value);
    }
    return values.filter((value) => value !== null && value !== undefined && value !== '');
}

function aggregatePisiRollupValues(values = [], aggregate = 'count', separator = ', ') {
    if (aggregate === 'count') return values.length;
    if (aggregate === 'checked-percent') {
        if (!values.length) return 0;
        return Math.round((values.filter((value) => value === true || value === 'true').length / values.length) * 100);
    }
    if (aggregate === 'unique') {
        return Array.from(new Set(values.map((value) => String(value))));
    }
    if (aggregate === 'join') return values.map(String).join(separator || ', ');
    const numbers = values.map(Number).filter(Number.isFinite);
    if (!numbers.length) return null;
    if (aggregate === 'sum') return numbers.reduce((sum, value) => sum + value, 0);
    if (aggregate === 'average') {
        return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    }
    if (aggregate === 'min') return Math.min(...numbers);
    if (aggregate === 'max') return Math.max(...numbers);
    return values.length;
}

function computePisiRollupValue(documentRecord, property, documents = []) {
    if (property?.type !== 'rollup') return property?.value;
    const config = property.value && typeof property.value === 'object' ? property.value : {};
    const relationId = normalizePisiPropertySearch(config.relationProperty || '');
    const relation = normalizePisiPropertyCollection(documentRecord?.properties).find((item) => {
        return item.type === 'relation' && (normalizePisiPropertySearch(item.id) === relationId || normalizePisiPropertySearch(item.name) === relationId);
    });
    if (!relation) return null;
    const related = resolvePisiRelationDocuments(relation, documents);
    if (config.aggregate === 'count' && !config.targetProperty) return related.length;
    const values = getPisiRollupTargetValues(related, config.targetProperty || '');
    return aggregatePisiRollupValues(values, config.aggregate || 'count', config.separator || ', ');
}

function materializePisiDatabaseDocuments(documents = []) {
    const records = Array.from(documents || []);
    return records.map((documentRecord) => {
        const properties = Object.fromEntries(
            normalizePisiPropertyCollection(documentRecord.properties).map((property) => {
                if (property.type !== 'rollup') return [property.id, property];
                return [
                    property.id,
                    {
                        ...property,
                        rollup: property.value,
                        value: computePisiRollupValue(documentRecord, property, records),
                        derived: true
                    }
                ];
            })
        );
        return { ...documentRecord, properties };
    });
}

function parsePisiPropertyQuery(query = '') {
    const clauses = [];
    const expression = /(?:^|\s)([^\s:!<>=~]+)\s*(>=|<=|!=|=|:|>|<|~)\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
    let match;
    while ((match = expression.exec(String(query || ''))) !== null) {
        let operator = match[2];
        let value = match[3] ?? match[4] ?? match[5] ?? '';
        const prefixedOperator = operator === ':' ? String(value).match(/^(>=|<=|!=|>|<|=)(.*)$/) : null;
        if (prefixedOperator) {
            operator = prefixedOperator[1];
            value = prefixedOperator[2];
        }
        clauses.push({
            field: match[1],
            operator,
            value
        });
    }
    return clauses;
}

function getPisiDocumentPropertyValue(documentRecord, field) {
    const normalized = normalizePisiPropertySearch(field);
    if (['baslik', 'title'].includes(normalized)) return documentRecord?.title || '';
    if (['yol', 'path'].includes(normalized)) {
        return documentRecord?.relativePath || documentRecord?.path || '';
    }
    if (['etiket', 'tag'].includes(normalized)) {
        return (documentRecord?.tags || []).map((item) => item.value || item);
    }
    if (['map', 'harita'].includes(normalized)) {
        return (documentRecord?.memberships || []).map((item) => item.mapTitle || '');
    }
    const property = normalizePisiPropertyCollection(documentRecord?.properties).find((item) => {
        return normalizePisiPropertySearch(item.id) === normalized || normalizePisiPropertySearch(item.name) === normalized;
    });
    return property?.value;
}

function pisiComparablePropertyValue(value) {
    if (Array.isArray(value)) return value.map(normalizePisiPropertySearch);
    if (typeof value === 'boolean' || typeof value === 'number') return value;
    const normalized = normalizePisiPropertySearch(value);
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    if (/^-?\d+(?:[.,]\d+)?$/.test(normalized)) {
        return Number(normalized.replace(',', '.'));
    }
    return normalized;
}

function matchesPisiPropertyClause(documentRecord, clause) {
    const actual = pisiComparablePropertyValue(getPisiDocumentPropertyValue(documentRecord, clause.field));
    const expected = pisiComparablePropertyValue(clause.value);
    const values = Array.isArray(actual) ? actual : [actual];
    if (clause.operator === '!=') {
        return values.every((value) => value !== expected);
    }
    if (clause.operator === ':' || clause.operator === '~') {
        return values.some((value) => {
            return normalizePisiPropertySearch(value).includes(normalizePisiPropertySearch(expected));
        });
    }
    if (clause.operator === '=') return values.some((value) => value === expected);
    return values.some((value) => {
        if (clause.operator === '>') return value > expected;
        if (clause.operator === '<') return value < expected;
        if (clause.operator === '>=') return value >= expected;
        if (clause.operator === '<=') return value <= expected;
        return false;
    });
}

function matchesPisiPropertyQuery(documentRecord, query = '') {
    const clauses = parsePisiPropertyQuery(query);
    if (!clauses.length) {
        const needle = normalizePisiPropertySearch(query);
        if (!needle) return true;
        const haystack = [
            documentRecord?.title,
            documentRecord?.relativePath,
            ...normalizePisiPropertyCollection(documentRecord?.properties).flatMap((property) => [property.name, property.value])
        ]
            .flat()
            .join(' ');
        return normalizePisiPropertySearch(haystack).includes(needle);
    }
    return clauses.every((clause) => matchesPisiPropertyClause(documentRecord, clause));
}

function filterPisiPropertyDocuments(documents = [], query = '') {
    return Array.from(documents || [])
        .filter((documentRecord) => matchesPisiPropertyQuery(documentRecord, query))
        .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'tr'));
}

function collectPisiPropertyColumns(documents = []) {
    const columns = new Map();
    for (const documentRecord of documents) {
        for (const property of normalizePisiPropertyCollection(documentRecord?.properties)) {
            if (!columns.has(property.id)) columns.set(property.id, property);
        }
    }
    return Array.from(columns.values()).slice(0, 30);
}

export {
    PISI_NODE_PROPERTY_TYPES,
    PISI_ROLLUP_AGGREGATES,
    aggregatePisiRollupValues,
    collectPisiPropertyColumns,
    computePisiRollupValue,
    filterPisiPropertyDocuments,
    getPisiDocumentPropertyValue,
    matchesPisiPropertyClause,
    matchesPisiPropertyQuery,
    materializePisiDatabaseDocuments,
    normalizePisiPropertyCollection,
    normalizePisiPropertySearch,
    parsePisiPropertyQuery,
    resolvePisiRelationDocuments
};
