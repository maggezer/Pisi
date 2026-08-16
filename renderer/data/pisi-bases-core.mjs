import {
    filterPisiPropertyDocuments,
    normalizePisiPropertyCollection,
    resolvePisiRelationDocuments
} from './pisi-properties-core.mjs';

const PISI_BASE_TABLE_COLUMN_LIMIT = 30;
const PISI_BASE_CARD_COLUMN_LIMIT = 8;
const PISI_BASE_LAYOUTS = Object.freeze(['table', 'cards']);

function normalizePisiBaseLayout(layout = 'table') {
    return PISI_BASE_LAYOUTS.includes(layout) ? layout : 'table';
}

function pisiBaseTextKey(value = '') {
    return String(value ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('tr-TR')
        .replace(/\s+/g, ' ')
        .trim();
}

function pisiBasePathKey(value = '') {
    return String(value || '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '')
        .toLocaleLowerCase('en-US');
}

function normalizePisiBaseDefinitions(definitions = []) {
    const result = [];
    const seen = new Set();
    for (const raw of Array.isArray(definitions) ? definitions : []) {
        const id = String(raw?.id || '').trim();
        const name = String(raw?.name || '').trim();
        const type = String(raw?.type || 'text').trim().toLowerCase();
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        result.push({
            id,
            name,
            type,
            system: raw?.system === true
        });
    }
    return result;
}

function canonicalizePisiBaseDocuments(documents = [], definitions = []) {
    const definitionById = new Map(
        normalizePisiBaseDefinitions(definitions)
            .map((definition) => [definition.id, definition])
    );
    return Array.from(documents || []).map((documentRecord) => {
        const normalizedProperties = normalizePisiPropertyCollection(
            documentRecord?.properties
        );
        const properties = Object.fromEntries(
            normalizedProperties.map((property) => {
                const definition = definitionById.get(property.id);
                if (!definition) return [property.id, property];
                return [property.id, {
                    ...property,
                    id: definition.id,
                    name: definition.name,
                    type: definition.type,
                    system: definition.system === true || property.system === true
                }];
            })
        );
        return {
            ...documentRecord,
            properties
        };
    });
}

function collectPisiBaseUsedDefinitions(documents = []) {
    const byId = new Map();
    for (const documentRecord of documents) {
        for (const property of normalizePisiPropertyCollection(documentRecord?.properties)) {
            if (!byId.has(property.id)) byId.set(property.id, property);
        }
    }
    return byId;
}

function collectPisiBaseColumns(documents = [], definitions = [], limit = PISI_BASE_TABLE_COLUMN_LIMIT) {
    const boundedLimit = Math.max(0, Math.min(PISI_BASE_TABLE_COLUMN_LIMIT, Number(limit) || 0));
    if (!boundedLimit) return [];
    const used = collectPisiBaseUsedDefinitions(documents);
    const canonical = normalizePisiBaseDefinitions(definitions);
    const result = [];
    const seen = new Set();

    for (const definition of canonical) {
        if (!used.has(definition.id) || seen.has(definition.id)) continue;
        result.push(definition);
        seen.add(definition.id);
        if (result.length >= boundedLimit) return result;
    }

    const orphanDefinitions = Array.from(used.values())
        .filter((property) => !seen.has(property.id))
        .sort((a, b) => {
            const byName = pisiBaseTextKey(a.name).localeCompare(pisiBaseTextKey(b.name), 'tr');
            if (byName) return byName;
            return String(a.id).localeCompare(String(b.id), 'en');
        });
    for (const property of orphanDefinitions) {
        result.push({
            id: property.id,
            name: property.name,
            type: property.type,
            system: property.system === true
        });
        if (result.length >= boundedLimit) break;
    }
    return result;
}

function comparePisiBaseDocuments(a, b) {
    const byTitle = String(a?.title || '').localeCompare(String(b?.title || ''), 'tr', {
        sensitivity: 'base',
        numeric: true
    });
    if (byTitle) return byTitle;
    const pathA = pisiBasePathKey(a?.relativePath || a?.path);
    const pathB = pisiBasePathKey(b?.relativePath || b?.path);
    const byPath = pathA.localeCompare(pathB, 'en', { numeric: true });
    if (byPath) return byPath;
    return String(a?.metadata?.id || a?.id || '')
        .localeCompare(String(b?.metadata?.id || b?.id || ''), 'en');
}

function sortPisiBaseDocuments(documents = []) {
    return Array.from(documents || []).sort(comparePisiBaseDocuments);
}

function makePisiBasePropertyLookup(documentRecord) {
    return new Map(
        normalizePisiPropertyCollection(documentRecord?.properties)
            .map((property) => [property.id, property])
    );
}

function formatPisiBaseScalar(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? '✓' : '—';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return '—';
        }
    }
    return String(value);
}

function formatPisiBasePropertyValue(property, documents = []) {
    if (!property) return '—';
    if (property.type === 'relation') {
        const rawValues = Array.isArray(property.value)
            ? property.value.map(String).filter(Boolean)
            : [];
        if (!rawValues.length) return '—';
        const resolved = resolvePisiRelationDocuments(property, documents);
        const labelByKey = new Map();
        for (const documentRecord of resolved) {
            const label = String(documentRecord.title || documentRecord.relativePath || documentRecord.path || '').trim();
            if (!label) continue;
            for (const candidate of [
                documentRecord.path,
                documentRecord.relativePath,
                documentRecord.fileName,
                documentRecord.metadata?.id
            ]) {
                const key = pisiBasePathKey(candidate);
                if (key) labelByKey.set(key, label);
            }
        }
        return rawValues.map((value) => labelByKey.get(pisiBasePathKey(value)) || value).join(', ');
    }
    if (Array.isArray(property.value)) {
        const values = property.value
            .map(formatPisiBaseScalar)
            .filter((value) => value !== '—');
        return values.length ? values.join(', ') : '—';
    }
    return formatPisiBaseScalar(property.value);
}

function buildPisiBaseProjection(documents = [], definitions = [], query = '') {
    const canonicalDocuments = canonicalizePisiBaseDocuments(documents, definitions);
    const sourceDocuments = sortPisiBaseDocuments(canonicalDocuments);
    const columns = collectPisiBaseColumns(sourceDocuments, definitions);
    const filteredDocuments = filterPisiPropertyDocuments(sourceDocuments, query);
    const sortedDocuments = sortPisiBaseDocuments(filteredDocuments);
    const rows = sortedDocuments.map((documentRecord) => ({
        document: documentRecord,
        properties: makePisiBasePropertyLookup(documentRecord)
    }));
    return {
        query: String(query || '').trim(),
        columns,
        cardColumns: columns.slice(0, PISI_BASE_CARD_COLUMN_LIMIT),
        documents: sortedDocuments,
        rows,
        count: sortedDocuments.length,
        sourceCount: sourceDocuments.length
    };
}

export {
    PISI_BASE_CARD_COLUMN_LIMIT,
    PISI_BASE_LAYOUTS,
    PISI_BASE_TABLE_COLUMN_LIMIT,
    buildPisiBaseProjection,
    canonicalizePisiBaseDocuments,
    collectPisiBaseColumns,
    comparePisiBaseDocuments,
    formatPisiBasePropertyValue,
    normalizePisiBaseDefinitions,
    normalizePisiBaseLayout,
    sortPisiBaseDocuments
};