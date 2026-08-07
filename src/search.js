import { htmlToText } from './sanitize.js';

const FIELD_WEIGHTS = Object.freeze({ title: 120, task: 105, tag: 95, property: 85, block: 75, content: 65, map: 55 });

export function normalizeSearchText(value = '') {
  return String(value || '').replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('tr-TR')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function fieldsForDocument(document) {
  return [
    { kind: 'title', value: document.title },
    { kind: 'content', value: htmlToText(document.content) },
    { kind: 'tag', value: (document.tags || []).join(' ') },
    { kind: 'property', value: Object.entries(document.properties || {}).flat().join(' ') },
    { kind: 'task', value: (document.blocks || []).filter(({ type }) => type === 'todo').map(({ text }) => text).join(' ') }
  ];
}

function prepareRecord(record) {
  return {
    ...record,
    searchFields: (record.searchFields || []).map((field) => ({
      ...field,
      normalized: normalizeSearchText(field.value),
      weight: FIELD_WEIGHTS[field.kind] || FIELD_WEIGHTS.content
    })).filter(({ normalized }) => normalized)
  };
}

export function buildSearchIndex(documents = [], tasks = []) {
  const records = [];
  documents.forEach((document) => {
    records.push(prepareRecord({
      id: `document:${document.id}`,
      kind: document.kind === 'canvas' ? 'map' : 'document',
      documentId: document.id,
      title: document.title,
      subtitle: document.kind,
      searchFields: fieldsForDocument(document)
    }));
    (document.blocks || []).forEach((block, index) => records.push(prepareRecord({
      id: `block:${document.id}:${block.id || index}`,
      kind: 'block', documentId: document.id, blockId: block.id,
      title: block.text || `Blok ${index + 1}`, subtitle: document.title,
      searchFields: [{ kind: 'block', value: block.text }, { kind: 'title', value: document.title }]
    })));
    if (document.kind === 'canvas') {
      (document.canvas?.nodes || []).forEach((node) => records.push(prepareRecord({
        id: `map-node:${document.id}:${node.id}`,
        kind: 'map-node', documentId: document.id, mapNodeId: node.id,
        title: node.title || 'Başlıksız düğüm', subtitle: document.title,
        searchFields: [
          { kind: 'title', value: node.title }, { kind: 'map', value: document.title },
          { kind: 'content', value: htmlToText(node.content) }
        ]
      })));
    }
  });
  tasks.forEach((task) => records.push(prepareRecord({
    id: `task:${task.id}`, kind: 'task', taskId: task.id, documentId: task.documentId,
    title: task.text, subtitle: task.done ? 'Tamamlandı' : 'Görev',
    searchFields: [{ kind: 'task', value: task.text }]
  })));

  const postings = new Map();
  records.forEach((record, index) => {
    const tokens = new Set(record.searchFields.flatMap(({ normalized }) => normalized.split(' ')));
    tokens.forEach((token) => {
      if (!postings.has(token)) postings.set(token, []);
      postings.get(token).push(index);
    });
  });
  return { version: 1, records, postings, builtAt: new Date().toISOString() };
}

function scoreRecord(record, query) {
  const normalized = normalizeSearchText(query);
  const tokens = normalized.split(' ').filter(Boolean);
  if (!tokens.length) return 1;
  let score = 0;
  for (const token of tokens) {
    let best = 0;
    record.searchFields.forEach((field) => {
      const index = field.normalized.indexOf(token);
      if (index < 0) return;
      let candidate = field.weight + (index === 0 ? 24 : 0);
      if (field.normalized === token) candidate += 32;
      best = Math.max(best, candidate);
    });
    if (!best) return 0;
    score += best;
  }
  if (record.searchFields.some(({ normalized: field }) => field.includes(normalized))) score += 70;
  return score;
}

export function searchIndex(index, query, limit = 80) {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  let candidates = index?.records || [];
  if (tokens.length && index?.postings) {
    const lists = tokens.map((token) => index.postings.get(token)).filter(Boolean);
    if (lists.length === tokens.length) {
      const intersection = lists.sort((a, b) => a.length - b.length).reduce((current, list) => {
        const accepted = new Set(list);
        return current.filter((value) => accepted.has(value));
      });
      candidates = intersection.map((position) => index.records[position]);
    }
  }
  return candidates.map((record) => ({ ...record, score: scoreRecord(record, query) }))
    .filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'tr'))
    .slice(0, Math.max(1, limit));
}

function linkedTitles(document) {
  const content = String(document.content || '');
  return Array.from(content.matchAll(/\[\[([^\]]+)\]\]/g), (match) => normalizeSearchText(match[1]));
}

function blockReferences(document) {
  return Array.from(String(document.content || '').matchAll(/\(\(([A-Za-z0-9_-]+)\)\)/g), (match) => match[1]);
}

export function buildRelationshipModel(documents = [], targetId) {
  const target = documents.find(({ id }) => id === targetId);
  if (!target) return { target: null, inbound: [], outbound: [], unlinked: [], blockInbound: [], sameMaps: [] };
  const byTitle = new Map(documents.map((document) => [normalizeSearchText(document.title), document]));
  const inbound = [];
  const outbound = [];
  const unlinked = [];
  const blockInbound = [];
  const targetTitle = normalizeSearchText(target.title);
  const targetBlockIds = new Set((target.blocks || []).map(({ id }) => id).filter(Boolean));
  documents.forEach((document) => {
    const links = linkedTitles(document);
    if (document.id === targetId) {
      links.forEach((title) => {
        const linked = byTitle.get(title);
        if (linked && linked.id !== targetId) outbound.push(linked);
      });
      return;
    }
    if (links.includes(targetTitle)) inbound.push(document);
    else if (normalizeSearchText(htmlToText(document.content)).includes(targetTitle)) unlinked.push(document);
    if (blockReferences(document).some((id) => targetBlockIds.has(id))) blockInbound.push(document);
  });
  const targetMaps = new Set((target.relations || []).filter(({ type }) => type === 'map').map(({ targetId: id }) => id));
  const sameMaps = documents.filter((document) => document.id !== targetId
    && (document.relations || []).some(({ targetId: id, type }) => type === 'map' && targetMaps.has(id)));
  const unique = (rows) => Array.from(new Map(rows.map((row) => [row.id, row])).values());
  return { target, inbound: unique(inbound), outbound: unique(outbound), unlinked: unique(unlinked), blockInbound: unique(blockInbound), sameMaps: unique(sameMaps) };
}

export function findDocumentMentions(documents, title) {
  const normalized = normalizeSearchText(title);
  return documents.filter((document) => normalizeSearchText(htmlToText(document.content)).includes(normalized));
}
