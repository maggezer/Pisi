const PISI_NODE_PROPERTY_TYPES = Object.freeze([
    Object.freeze({ value: 'text', label: 'Metin' }),
    Object.freeze({ value: 'number', label: 'Sayı' }),
    Object.freeze({ value: 'date', label: 'Tarih' }),
    Object.freeze({ value: 'select', label: 'Seçim' }),
    Object.freeze({ value: 'multiselect', label: 'Çoklu seçim' }),
    Object.freeze({ value: 'node', label: 'Node bağlantısı' }),
    Object.freeze({ value: 'checkbox', label: 'Onay kutusu' })
]);

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
    const entries = Array.isArray(properties)
        ? properties.map((item) => [item?.id || item?.name, item])
        : Object.entries(properties || {});
    return entries.map(([id, property]) => ({
        id: String(property?.id || id || ''),
        name: String(property?.name || id || ''),
        type: String(property?.type || 'text'),
        value: property?.value,
        system: property?.system === true
    })).filter((property) => property.id && property.name);
}

function parsePisiPropertyQuery(query = '') {
    const clauses = [];
    const expression = /(?:^|\s)([^\s:!<>=~]+)\s*(>=|<=|!=|=|:|>|<|~)\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
    let match;
    while ((match = expression.exec(String(query || ''))) !== null) {
        let operator = match[2];
        let value = match[3] ?? match[4] ?? match[5] ?? '';
        const prefixedOperator = operator === ':'
            ? String(value).match(/^(>=|<=|!=|>|<|=)(.*)$/)
            : null;
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
    const property = normalizePisiPropertyCollection(documentRecord?.properties)
        .find((item) => {
            return normalizePisiPropertySearch(item.id) === normalized ||
                normalizePisiPropertySearch(item.name) === normalized;
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
    const actual = pisiComparablePropertyValue(
        getPisiDocumentPropertyValue(documentRecord, clause.field)
    );
    const expected = pisiComparablePropertyValue(clause.value);
    const values = Array.isArray(actual) ? actual : [actual];
    if (clause.operator === '!=') {
        return values.every((value) => value !== expected);
    }
    if (clause.operator === ':' || clause.operator === '~') {
        return values.some((value) => {
            return normalizePisiPropertySearch(value).includes(
                normalizePisiPropertySearch(expected)
            );
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
            ...normalizePisiPropertyCollection(documentRecord?.properties)
                .flatMap((property) => [property.name, property.value])
        ].flat().join(' ');
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
    collectPisiPropertyColumns,
    filterPisiPropertyDocuments,
    getPisiDocumentPropertyValue,
    matchesPisiPropertyClause,
    matchesPisiPropertyQuery,
    normalizePisiPropertyCollection,
    normalizePisiPropertySearch,
    parsePisiPropertyQuery
};
