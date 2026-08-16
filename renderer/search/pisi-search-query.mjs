import {
    getPisiSearchCandidates,
    normalizePisiSearchText
} from './pisi-search-core.mjs';

const PISI_SEARCH_QUERY_KIND_ALIASES = Object.freeze({
    node: 'node', nodes: 'node', not: 'node',
    map: 'map', maps: 'map', harita: 'map',
    task: 'task', tasks: 'task', gorev: 'task', görev: 'task',
    tag: 'tag', tags: 'tag', etiket: 'tag',
    content: 'content', text: 'content', icerik: 'content', içerik: 'content',
    table: 'table', tables: 'table', tablo: 'table'
});

const PISI_SEARCH_QUERY_FIELD_WEIGHTS = Object.freeze({
    title: 145,
    task: 125,
    tag: 105,
    property: 92,
    table: 82,
    content: 68,
    map: 66,
    path: 48,
    status: 35,
    priority: 28
});

const PISI_SEARCH_FUZZY_FIELDS = new Set([
    'title', 'task', 'tag', 'property', 'map', 'path'
]);

const PISI_SEARCH_FILTER_KEYS = new Set([
    'type', 'kind', 'map', 'path', 'tag', 'status', 'priority'
]);

function cleanPisiSearchQueryValue(value = '') {
    return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function normalizePisiSearchKind(value = '') {
    return PISI_SEARCH_QUERY_KIND_ALIASES[
        normalizePisiSearchText(value).replace(/\s+/g, '')
    ] || '';
}

function tokenizeQuotedPisiSearchQuery(query = '') {
    const tokens = [];
    const regexp = /"([^"]+)"|'([^']+)'|(\S+)/g;
    let match = null;
    while ((match = regexp.exec(String(query || '')))) {
        const raw = match[1] ?? match[2] ?? match[3] ?? '';
        const quoted = match[1] !== undefined || match[2] !== undefined;
        if (raw) tokens.push({ raw, quoted });
    }
    return tokens;
}

function parsePisiSearchQuery(query = '') {
    const filters = {
        kinds: new Set(),
        maps: [],
        paths: [],
        tags: [],
        statuses: [],
        priorities: []
    };
    const terms = [];
    const phrases = [];

    for (const token of tokenizeQuotedPisiSearchQuery(query)) {
        const hashTag = !token.quoted && token.raw.startsWith('#')
            ? cleanPisiSearchQueryValue(token.raw.slice(1))
            : '';
        if (hashTag) {
            filters.tags.push(normalizePisiSearchText(hashTag));
            continue;
        }

        const separator = token.raw.indexOf(':');
        if (!token.quoted && separator > 0) {
            const key = normalizePisiSearchText(token.raw.slice(0, separator));
            const value = cleanPisiSearchQueryValue(token.raw.slice(separator + 1));
            if (PISI_SEARCH_FILTER_KEYS.has(key) && value) {
                if (key === 'type' || key === 'kind') {
                    for (const item of value.split(',')) {
                        const kind = normalizePisiSearchKind(item);
                        if (kind) filters.kinds.add(kind);
                    }
                } else if (key === 'map') {
                    filters.maps.push(normalizePisiSearchText(value));
                } else if (key === 'path') {
                    filters.paths.push(normalizePisiSearchText(value));
                } else if (key === 'tag') {
                    filters.tags.push(normalizePisiSearchText(value));
                } else if (key === 'status') {
                    filters.statuses.push(normalizePisiSearchText(value));
                } else if (key === 'priority') {
                    for (const item of value.split(',')) {
                        const priority = Number(item);
                        if (Number.isInteger(priority) && priority >= 1 && priority <= 5) {
                            filters.priorities.push(priority);
                        }
                    }
                }
                continue;
            }
        }

        const normalized = normalizePisiSearchText(token.raw);
        if (!normalized) continue;
        if (token.quoted) phrases.push(normalized);
        else terms.push(...normalized.split(' ').filter(Boolean));
    }

    return {
        raw: String(query || ''),
        terms,
        phrases,
        filters,
        textQuery: [...phrases, ...terms].join(' ').trim(),
        hasText: Boolean(terms.length || phrases.length),
        hasFilters: Boolean(
            filters.kinds.size || filters.maps.length || filters.paths.length ||
            filters.tags.length || filters.statuses.length || filters.priorities.length
        )
    };
}

function getPisiAdvancedSearchFields(record = {}) {
    const fields = Array.isArray(record.searchFields)
        ? record.searchFields
        : [];
    return fields.map((field) => ({
        kind: field?.kind || 'content',
        value: String(field?.value || ''),
        normalized: normalizePisiSearchText(field?.value || ''),
        weight: Number(field?.weight) ||
            PISI_SEARCH_QUERY_FIELD_WEIGHTS[field?.kind] ||
            PISI_SEARCH_QUERY_FIELD_WEIGHTS.content
    })).filter((field) => field.normalized);
}

function boundedPisiEditDistance(a = '', b = '', maxDistance = 2) {
    const left = String(a || '');
    const right = String(b || '');
    if (left === right) return 0;
    if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;
    if (!left.length) return Math.min(right.length, maxDistance + 1);
    if (!right.length) return Math.min(left.length, maxDistance + 1);

    let previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
        const current = [i];
        let rowMin = current[0];
        for (let j = 1; j <= right.length; j += 1) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            const value = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + cost
            );
            current[j] = value;
            rowMin = Math.min(rowMin, value);
        }
        if (rowMin > maxDistance) return maxDistance + 1;
        previous = current;
    }
    return previous[right.length];
}

function getPisiFuzzyTokenScore(field, token) {
    if (!PISI_SEARCH_FUZZY_FIELDS.has(field.kind)) return 0;
    if (token.length < 4) return 0;
    const maxDistance = token.length >= 8 ? 2 : 1;
    let best = 0;
    for (const word of field.normalized.split(' ')) {
        if (!word || Math.abs(word.length - token.length) > maxDistance) continue;
        const distance = boundedPisiEditDistance(word, token, maxDistance);
        if (distance > maxDistance) continue;
        const penalty = distance * 24;
        best = Math.max(best, Math.max(8, field.weight - penalty));
    }
    return best;
}

function getPisiTokenFieldScore(field, token, allowFuzzy) {
    const index = field.normalized.indexOf(token);
    if (index >= 0) {
        let score = field.weight;
        if (index === 0) score += 34;
        if (field.normalized === token) score += 56;
        if (field.normalized.split(' ').includes(token)) score += 18;
        return score;
    }
    return allowFuzzy ? getPisiFuzzyTokenScore(field, token) : 0;
}

function getPisiRecordMapText(record = {}) {
    const memberships = Array.isArray(record.memberships) ? record.memberships : [];
    return normalizePisiSearchText([
        record.mapTitle || '',
        ...memberships.map((membership) => membership?.mapTitle || '')
    ].join(' '));
}

function recordPassesPisiSearchFilters(record, filters) {
    if (filters.kinds.size && !filters.kinds.has(record?.kind)) return false;
    if (filters.maps.length) {
        const mapText = getPisiRecordMapText(record);
        if (!filters.maps.every((needle) => mapText.includes(needle))) return false;
    }
    if (filters.paths.length) {
        const pathText = normalizePisiSearchText(record?.relativePath || record?.nodePath || record?.mapPath || '');
        if (!filters.paths.every((needle) => pathText.includes(needle))) return false;
    }
    if (filters.tags.length) {
        const tagText = normalizePisiSearchText([
            record?.tag || '',
            record?.todoTag || '',
            ...(Array.isArray(record?.tags) ? record.tags : [])
        ].join(' '));
        if (!filters.tags.every((needle) => tagText.includes(needle))) return false;
    }
    if (filters.statuses.length) {
        const status = normalizePisiSearchText(record?.status || '');
        if (!filters.statuses.includes(status)) return false;
    }
    if (filters.priorities.length && !filters.priorities.includes(Number(record?.priority))) {
        return false;
    }
    return true;
}

function scorePisiAdvancedSearchRecord(record, parsed, options = {}) {
    if (!recordPassesPisiSearchFilters(record, parsed.filters)) {
        return { score: 0, matchedField: null, fuzzy: false };
    }

    const fields = getPisiAdvancedSearchFields(record);
    let score = 0;
    let matchedField = null;
    let strongest = 0;
    let usedFuzzy = false;

    for (const phrase of parsed.phrases) {
        let phraseScore = 0;
        let phraseField = null;
        for (const field of fields) {
            const index = field.normalized.indexOf(phrase);
            if (index < 0) continue;
            const candidate = field.weight + 75 + (index === 0 ? 48 : 18);
            if (candidate > phraseScore) {
                phraseScore = candidate;
                phraseField = field.kind;
            }
        }
        if (!phraseScore) return { score: 0, matchedField: null, fuzzy: false };
        score += phraseScore;
        if (phraseScore > strongest) {
            strongest = phraseScore;
            matchedField = phraseField;
        }
    }

    for (const token of parsed.terms) {
        let tokenScore = 0;
        let tokenField = null;
        let tokenFuzzy = false;
        for (const field of fields) {
            const strict = getPisiTokenFieldScore(field, token, false);
            const candidate = strict || getPisiTokenFieldScore(field, token, options.allowFuzzy !== false);
            if (candidate > tokenScore) {
                tokenScore = candidate;
                tokenField = field.kind;
                tokenFuzzy = !strict && Boolean(candidate);
            }
        }
        if (!tokenScore) return { score: 0, matchedField: null, fuzzy: false };
        score += tokenScore;
        usedFuzzy = usedFuzzy || tokenFuzzy;
        if (tokenScore > strongest) {
            strongest = tokenScore;
            matchedField = tokenField;
        }
    }

    if (!parsed.hasText) {
        score += ['node', 'map', 'task'].includes(record?.kind) ? 18 : 4;
    }

    const normalizedTitle = normalizePisiSearchText(record?.title || record?.nodeTitle || '');
    const normalizedText = parsed.textQuery;
    if (normalizedText && normalizedTitle) {
        if (normalizedTitle === normalizedText) score += 240;
        else if (normalizedTitle.startsWith(normalizedText)) score += 130;
    }

    const currentNodeKey = String(options.currentNodePathKey || '');
    const currentMapKey = String(options.currentMapPathKey || '');
    if (currentNodeKey && String(record?.nodePathKey || '') === currentNodeKey) score += 38;
    if (currentMapKey) {
        const mapKeys = new Set([
            record?.mapPathKey,
            ...(Array.isArray(record?.memberships)
                ? record.memberships.map((item) => item?.mapPathKey)
                : [])
        ].filter(Boolean));
        if (mapKeys.has(currentMapKey)) score += 28;
    }

    const recent = options.recentById instanceof Map
        ? options.recentById.get(String(record?.id || ''))
        : null;
    if (recent) {
        const ageHours = Math.max(0, (Number(options.now) || Date.now()) - Number(recent.lastOpened || 0)) / 3600000;
        score += Math.max(0, 125 - Math.min(100, ageHours * 2));
        score += Math.min(45, Number(recent.openCount || 1) * 5);
    }

    return { score, matchedField, fuzzy: usedFuzzy };
}

function getPisiAdvancedCandidates(index, parsed) {
    const records = Array.isArray(index?.records) ? index.records : [];
    if (!parsed.hasText || !index?.accelerator) return records;
    const exact = getPisiSearchCandidates(index.accelerator, parsed.textQuery);
    if (Array.isArray(exact) && exact.length) return exact;
    // Exact trigram intersection returning no candidates is the expected typo path.
    // Limit fuzzy fallback to navigation-oriented records plus bounded content records.
    const navigation = records.filter((record) => [
        'node', 'map', 'task', 'tag'
    ].includes(record?.kind));
    const content = records.filter((record) => [
        'content', 'table'
    ].includes(record?.kind)).slice(0, 2500);
    return [...navigation, ...content];
}

function searchPisiAdvancedIndex(index, query = '', options = {}) {
    const parsed = parsePisiSearchQuery(query);
    const limit = Math.max(1, Math.min(250, Number(options.limit) || 80));
    const candidates = getPisiAdvancedCandidates(index, parsed);
    const kindFilter = options.kinds instanceof Set
        ? options.kinds
        : new Set(Array.isArray(options.kinds) ? options.kinds : []);
    const filters = kindFilter.size
        ? { ...parsed.filters, kinds: new Set([
            ...parsed.filters.kinds.size ? parsed.filters.kinds : kindFilter
        ]) }
        : parsed.filters;
    const effectiveParsed = filters === parsed.filters ? parsed : { ...parsed, filters };

    return candidates
        .filter((record) => {
            if (kindFilter.size && parsed.filters.kinds.size) {
                return kindFilter.has(record?.kind) && parsed.filters.kinds.has(record?.kind);
            }
            if (kindFilter.size) return kindFilter.has(record?.kind);
            return true;
        })
        .map((record, originalIndex) => ({
            record,
            originalIndex,
            ...scorePisiAdvancedSearchRecord(record, effectiveParsed, options)
        }))
        .filter((result) => result.score > 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const aRecent = options.recentById?.get?.(String(a.record?.id || ''))?.lastOpened || 0;
            const bRecent = options.recentById?.get?.(String(b.record?.id || ''))?.lastOpened || 0;
            if (bRecent !== aRecent) return bRecent - aRecent;
            const titleOrder = String(a.record?.title || '').localeCompare(
                String(b.record?.title || ''), 'tr'
            );
            return titleOrder || a.originalIndex - b.originalIndex;
        })
        .slice(0, limit)
        .map(({ record, score, matchedField, fuzzy }) => ({
            ...record,
            score,
            matchedField,
            fuzzyMatch: fuzzy
        }));
}

export {
    PISI_SEARCH_QUERY_FIELD_WEIGHTS,
    boundedPisiEditDistance,
    normalizePisiSearchKind,
    parsePisiSearchQuery,
    recordPassesPisiSearchFilters,
    scorePisiAdvancedSearchRecord,
    searchPisiAdvancedIndex,
    tokenizeQuotedPisiSearchQuery
};