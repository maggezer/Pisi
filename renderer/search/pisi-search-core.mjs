const PISI_SEARCH_FIELD_WEIGHTS = Object.freeze({
    title: 120,
    task: 105,
    tag: 95,
    table: 80,
    content: 65,
    map: 55,
    path: 38
});

const pisiPreparedSearchFields = new WeakMap();

function replaceTurkishSearchCharacters(value) {
    return value.replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g').replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c');
}

export function normalizePisiSearchText(value = '') {
    return replaceTurkishSearchCharacters(String(value || ''))
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('tr-TR')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function tokenizePisiSearchQuery(query = '') {
    return normalizePisiSearchText(query).split(' ').filter(Boolean);
}

function getRecordFields(record) {
    if (record && typeof record === 'object' && pisiPreparedSearchFields.has(record)) {
        return pisiPreparedSearchFields.get(record);
    }
    let fields;
    if (Array.isArray(record?.searchFields)) {
        fields = record.searchFields
            .map((field) => ({
                kind: field?.kind || 'content',
                value: String(field?.value || ''),
                normalized: normalizePisiSearchText(field?.value || ''),
                weight: Number(field?.weight) || PISI_SEARCH_FIELD_WEIGHTS[field?.kind] || PISI_SEARCH_FIELD_WEIGHTS.content
            }))
            .filter((field) => field.normalized);
    } else {
        fields = [
            { kind: 'title', value: record?.title || '' },
            { kind: 'content', value: record?.text || '' },
            { kind: 'map', value: record?.mapTitle || '' },
            { kind: 'path', value: record?.relativePath || record?.path || '' }
        ]
            .map((field) => ({
                ...field,
                normalized: normalizePisiSearchText(field.value),
                weight: PISI_SEARCH_FIELD_WEIGHTS[field.kind]
            }))
            .filter((field) => field.normalized);
    }
    if (record && typeof record === 'object') pisiPreparedSearchFields.set(record, fields);
    return fields;
}

function makePisiSearchTrigrams(value = '') {
    const normalized = normalizePisiSearchText(value).replace(/\s+/g, ' ');
    if (normalized.length < 3) return [];
    const grams = new Set();
    for (let index = 0; index <= normalized.length - 3; index += 1) {
        grams.add(normalized.slice(index, index + 3));
    }
    return Array.from(grams);
}

function buildPisiSearchAccelerator(records = []) {
    const preparedRecords = Array.isArray(records) ? records : [];
    const postings = new Map();
    preparedRecords.forEach((record, index) => {
        const fields = getRecordFields(record);
        const grams = new Set();
        for (const field of fields) {
            for (const gram of makePisiSearchTrigrams(field.normalized.slice(0, 6000))) {
                grams.add(gram);
            }
        }
        for (const gram of grams) {
            if (!postings.has(gram)) postings.set(gram, []);
            postings.get(gram).push(index);
        }
    });
    return {
        version: 1,
        records: preparedRecords,
        postings,
        recordCount: preparedRecords.length,
        gramCount: postings.size
    };
}

function intersectPisiPostingLists(lists) {
    if (!lists.length) return null;
    const ordered = lists.slice().sort((a, b) => a.length - b.length);
    let result = ordered[0].slice();
    for (const list of ordered.slice(1)) {
        const next = [];
        let left = 0;
        let right = 0;
        while (left < result.length && right < list.length) {
            if (result[left] === list[right]) {
                next.push(result[left]);
                left += 1;
                right += 1;
            } else if (result[left] < list[right]) {
                left += 1;
            } else {
                right += 1;
            }
        }
        result = next;
        if (!result.length) break;
    }
    return result;
}

function getPisiSearchCandidates(accelerator, query = '') {
    if (!accelerator?.postings || !Array.isArray(accelerator.records)) return null;
    const grams = tokenizePisiSearchQuery(query)
        .filter((token) => token.length >= 3)
        .flatMap(makePisiSearchTrigrams);
    if (!grams.length) return null;
    const lists = [];
    for (const gram of new Set(grams)) {
        const posting = accelerator.postings.get(gram);
        if (!posting) return [];
        lists.push(posting);
    }
    const indexes = intersectPisiPostingLists(lists) || [];
    return indexes.map((index) => accelerator.records[index]).filter(Boolean);
}

export function scorePisiSearchRecord(record, query = '') {
    const normalizedQuery = normalizePisiSearchText(query);
    const tokens = tokenizePisiSearchQuery(query);
    const fields = getRecordFields(record);

    if (!tokens.length) {
        return {
            score: record?.kind === 'map' ? 2 : 1,
            matchedField: 'title'
        };
    }

    let score = 0;
    let matchedField = null;
    let strongestFieldScore = 0;

    for (const token of tokens) {
        let tokenScore = 0;
        let tokenField = null;

        for (const field of fields) {
            const index = field.normalized.indexOf(token);
            if (index < 0) continue;

            let candidate = field.weight;
            if (index === 0) candidate += 24;
            if (field.normalized === token) candidate += 32;
            if (field.normalized.split(' ').includes(token)) candidate += 12;

            if (candidate > tokenScore) {
                tokenScore = candidate;
                tokenField = field.kind;
            }
        }

        if (!tokenScore) return { score: 0, matchedField: null };
        score += tokenScore;
        if (tokenScore > strongestFieldScore) {
            strongestFieldScore = tokenScore;
            matchedField = tokenField;
        }
    }

    if (normalizedQuery) {
        for (const field of fields) {
            const phraseIndex = field.normalized.indexOf(normalizedQuery);
            if (phraseIndex < 0) continue;
            score += field.weight + (phraseIndex === 0 ? 45 : 20);
            matchedField = field.kind;
            break;
        }
    }

    return { score, matchedField };
}

export function searchPisiRecords(records = [], query = '', options = {}) {
    const limit = Math.max(1, Number(options.limit) || 80);
    const normalizedQuery = normalizePisiSearchText(query);

    return (Array.isArray(records) ? records : [])
        .filter((record) => normalizedQuery || ['node', 'map'].includes(record?.kind))
        .map((record, originalIndex) => ({
            record,
            originalIndex,
            ...scorePisiSearchRecord(record, query)
        }))
        .filter((result) => result.score > 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const titleOrder = String(a.record?.title || '').localeCompare(String(b.record?.title || ''), 'tr');
            return titleOrder || a.originalIndex - b.originalIndex;
        })
        .slice(0, limit)
        .map(({ record, score, matchedField }) => ({
            ...record,
            score,
            matchedField
        }));
}

export function searchPisiIndex(index, query = '', options = {}) {
    const accelerator = index?.accelerator;
    const candidates = getPisiSearchCandidates(accelerator, query);
    const records = candidates === null ? accelerator?.records || index?.records || [] : candidates;
    return searchPisiRecords(records, query, options);
}

export function pisiSearchPathKey(value = '') {
    return String(value || '')
        .replace(/[\\/]+/g, '/')
        .replace(/\/+$/g, '')
        .toLocaleLowerCase('en-US');
}

export function containsPisiTitleMention(text, title) {
    const haystack = normalizePisiSearchText(text);
    const needle = normalizePisiSearchText(title);
    if (!haystack || !needle || needle.length < 2) return false;
    return (' ' + haystack + ' ').includes(' ' + needle + ' ');
}

function addRelationship(target, key, relationship) {
    if (!relationship?.path || !key) return;
    const existing = target.get(key);
    if (existing) {
        existing.types = Array.from(new Set([...(existing.types || []), ...(relationship.types || [])]));
        if (!existing.mapPath && relationship.mapPath) {
            existing.mapPath = relationship.mapPath;
            existing.mapTitle = relationship.mapTitle;
        }
        return;
    }
    target.set(key, {
        ...relationship,
        types: Array.from(new Set(relationship.types || []))
    });
}

function makeNodeRelationship(documentRecord, membership, types) {
    return {
        path: documentRecord.path,
        title: documentRecord.title,
        fileName: documentRecord.fileName,
        mapPath: membership?.mapPath || null,
        mapTitle: membership?.mapTitle || '',
        types
    };
}

export function buildPisiRelationshipModel(index, targetPath) {
    const documents = index?.documents instanceof Map ? index.documents : new Map();
    const maps = Array.isArray(index?.maps) ? index.maps : [];
    const targetKey = pisiSearchPathKey(targetPath);
    const targetDocument = documents.get(targetKey) || null;

    const inbound = new Map();
    const outbound = new Map();
    const unlinked = new Map();

    if (!targetDocument) {
        return {
            target: null,
            inbound: [],
            outbound: [],
            unlinked: [],
            tasks: [],
            sameMaps: []
        };
    }

    const targetTitleKey = normalizePisiSearchText(targetDocument.title);
    const targetId = targetDocument.metadata?.id || null;

    for (const [documentKey, documentRecord] of documents) {
        if (documentKey === targetKey) continue;
        const directTitles = new Set((documentRecord.directTitles || []).map(normalizePisiSearchText));
        const directPaths = new Set((documentRecord.directPaths || []).map(pisiSearchPathKey));
        const linksById = Boolean(targetId) && (documentRecord.directIds || []).includes(targetId);
        const membership = documentRecord.memberships?.[0] || null;

        if (linksById || directTitles.has(targetTitleKey) || directPaths.has(targetKey)) {
            addRelationship(inbound, documentKey, makeNodeRelationship(documentRecord, membership, ['text']));
        } else if (containsPisiTitleMention(documentRecord.unlinkedText || documentRecord.plainText, targetDocument.title)) {
            addRelationship(unlinked, documentKey, makeNodeRelationship(documentRecord, membership, ['mention']));
        }
    }

    const documentByTitle = new Map();
    for (const documentRecord of documents.values()) {
        const titleKey = normalizePisiSearchText(documentRecord.title);
        if (titleKey && !documentByTitle.has(titleKey)) {
            documentByTitle.set(titleKey, documentRecord);
        }
    }

    for (const directTitle of targetDocument.directTitles || []) {
        const linkedDocument = documentByTitle.get(normalizePisiSearchText(directTitle));
        if (!linkedDocument || linkedDocument.path === targetDocument.path) continue;
        const linkedKey = pisiSearchPathKey(linkedDocument.path);
        addRelationship(outbound, linkedKey, makeNodeRelationship(linkedDocument, linkedDocument.memberships?.[0], ['text']));
    }

    const documentById = new Map();
    for (const documentRecord of documents.values()) {
        const id = documentRecord.metadata?.id;
        if (id && !documentById.has(id)) documentById.set(id, documentRecord);
    }
    for (const directId of targetDocument.directIds || []) {
        const linkedDocument = documentById.get(directId);
        if (!linkedDocument || linkedDocument.path === targetDocument.path) continue;
        addRelationship(
            outbound,
            pisiSearchPathKey(linkedDocument.path),
            makeNodeRelationship(linkedDocument, linkedDocument.memberships?.[0] || null, ['text'])
        );
    }

    for (const directPath of targetDocument.directPaths || []) {
        const linkedDocument = documents.get(pisiSearchPathKey(directPath));
        if (!linkedDocument || linkedDocument.path === targetDocument.path) continue;
        const linkedKey = pisiSearchPathKey(linkedDocument.path);
        addRelationship(outbound, linkedKey, makeNodeRelationship(linkedDocument, linkedDocument.memberships?.[0] || null, ['citation']));
    }

    for (const map of maps) {
        const targetMembership = map.nodes?.find((node) => {
            return pisiSearchPathKey(node.path) === targetKey;
        });
        if (!targetMembership) continue;

        const nodeById = new Map((map.nodes || []).map((node) => [String(node.id), node]));

        for (const edge of map.edges || []) {
            const sourceId = String(edge?.sourceId || '');
            const targetId = String(edge?.targetId || '');
            const currentId = String(targetMembership.id || '');
            const isSymmetric = ['co-level', 'colevel'].includes(edge?.type);

            if (sourceId === currentId || (isSymmetric && targetId === currentId)) {
                const otherId = sourceId === currentId ? targetId : sourceId;
                const otherNode = nodeById.get(otherId);
                const otherDocument = documents.get(pisiSearchPathKey(otherNode?.path));
                if (otherDocument) {
                    addRelationship(
                        outbound,
                        pisiSearchPathKey(otherDocument.path),
                        makeNodeRelationship(
                            otherDocument,
                            {
                                mapPath: map.path,
                                mapTitle: map.title
                            },
                            ['map']
                        )
                    );
                }
            }

            if (targetId === currentId || (isSymmetric && sourceId === currentId)) {
                const otherId = targetId === currentId ? sourceId : targetId;
                const otherNode = nodeById.get(otherId);
                const otherDocument = documents.get(pisiSearchPathKey(otherNode?.path));
                if (otherDocument) {
                    addRelationship(
                        inbound,
                        pisiSearchPathKey(otherDocument.path),
                        makeNodeRelationship(
                            otherDocument,
                            {
                                mapPath: map.path,
                                mapTitle: map.title
                            },
                            ['map']
                        )
                    );
                }
            }
        }
    }

    return {
        target: targetDocument,
        inbound: Array.from(inbound.values()),
        outbound: Array.from(outbound.values()),
        unlinked: Array.from(unlinked.values()),
        tasks: Array.isArray(targetDocument.tasks) ? targetDocument.tasks : [],
        sameMaps: Array.isArray(targetDocument.memberships) ? targetDocument.memberships : []
    };
}

export { PISI_SEARCH_FIELD_WEIGHTS, buildPisiSearchAccelerator, getPisiSearchCandidates, makePisiSearchTrigrams };
