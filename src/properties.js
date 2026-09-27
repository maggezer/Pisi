import { makeId } from './db.js';

export const PROPERTY_TYPES = Object.freeze(['text', 'number', 'multiselect', 'relation', 'rollup']);

function preservePropertyType(value) {
  const type = String(value || 'text').trim().toLowerCase();
  return /^[a-z][a-z0-9-]{0,63}$/.test(type) ? type : 'text';
}

export function normalizePropertySchema(schema = []) {
  return (Array.isArray(schema) ? schema : []).map((property) => ({
    ...structuredClone(property),
    id: property.id || makeId('property'),
    name: String(property.name || 'Özellik').slice(0, 80),
    type: preservePropertyType(property.type),
    options: Array.isArray(property.options) ? property.options.map(String) : [],
    relationDocumentIds: Array.isArray(property.relationDocumentIds) ? property.relationDocumentIds : [],
    rollup: property.rollup && typeof property.rollup === 'object' ? property.rollup : null
  }));
}

export function propertyValue(document, property, documents = []) {
  const raw = document.properties?.[property.id] ?? document.properties?.[property.name];
  if (property.type !== 'rollup') return raw;
  const rollup = property.rollup || {};
  const relationIds = document.properties?.[rollup.relationProperty] || [];
  const related = documents.filter(({ id }) => relationIds.includes(id));
  const values = related.map((row) => row.properties?.[rollup.targetProperty]).filter((value) => value !== undefined && value !== null);
  if (rollup.operation === 'count') return values.length;
  const numbers = values.map(Number).filter(Number.isFinite);
  if (rollup.operation === 'sum') return numbers.reduce((sum, value) => sum + value, 0);
  if (rollup.operation === 'average') return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0;
  if (rollup.operation === 'min') return numbers.length ? Math.min(...numbers) : null;
  if (rollup.operation === 'max') return numbers.length ? Math.max(...numbers) : null;
  return values.join(', ');
}

function compare(value, operator, expected) {
  if (operator === 'is-empty') return value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);
  if (operator === 'is-not-empty') return !compare(value, 'is-empty');
  if (operator === 'equals') return String(value ?? '') === String(expected ?? '');
  if (operator === 'not-equals') return String(value ?? '') !== String(expected ?? '');
  if (operator === 'contains') return Array.isArray(value)
    ? value.map(String).includes(String(expected))
    : String(value ?? '').toLocaleLowerCase('tr-TR').includes(String(expected ?? '').toLocaleLowerCase('tr-TR'));
  const left = Number(value);
  const right = Number(expected);
  if (operator === 'greater') return Number.isFinite(left) && left > right;
  if (operator === 'less') return Number.isFinite(left) && left < right;
  if (operator === 'on-or-before') return String(value || '') <= String(expected || '');
  if (operator === 'on-or-after') return String(value || '') >= String(expected || '');
  return true;
}

export function applyStructuredView(documents = [], view = {}, schema = []) {
  const filters = Array.isArray(view.filters) ? view.filters : [];
  const sort = Array.isArray(view.sort) ? view.sort : [];
  const byId = new Map(schema.map((property) => [property.id, property]));
  const rows = documents.filter((document) => filters.every((filter) => {
    const property = byId.get(filter.propertyId) || { id: filter.propertyId, name: filter.propertyId, type: 'text' };
    return compare(propertyValue(document, property, documents), filter.operator, filter.value);
  }));
  rows.sort((left, right) => {
    for (const rule of sort) {
      const property = byId.get(rule.propertyId) || { id: rule.propertyId, name: rule.propertyId, type: 'text' };
      const a = propertyValue(left, property, documents);
      const b = propertyValue(right, property, documents);
      const order = String(a ?? '').localeCompare(String(b ?? ''), 'tr', { numeric: true });
      if (order) return rule.direction === 'desc' ? -order : order;
    }
    return String(right.updatedAt).localeCompare(String(left.updatedAt));
  });
  return rows;
}

export function createSavedView(name, options = {}) {
  return {
    id: makeId('view'),
    name: String(name || 'Yeni görünüm').slice(0, 100),
    type: ['table', 'cards'].includes(options.type) ? options.type : 'table',
    filters: Array.isArray(options.filters) ? options.filters : [],
    sort: Array.isArray(options.sort) ? options.sort : [],
    groupBy: options.groupBy || null,
    createdAt: new Date().toISOString()
  };
}

export function createTemplate(name, values = {}) {
  return {
    id: makeId('template'),
    name: String(name || 'Yeni şablon').slice(0, 100),
    kind: values.kind || 'note',
    content: values.content || '<p><br></p>',
    properties: values.properties && typeof values.properties === 'object' ? values.properties : {},
    tags: Array.isArray(values.tags) ? values.tags : [],
    createdAt: new Date().toISOString()
  };
}

export function applyTemplate(document, template) {
  return {
    ...document,
    content: template.content || document.content,
    tags: Array.from(new Set([...(document.tags || []), ...(template.tags || [])])),
    properties: { ...(template.properties || {}), ...(document.properties || {}) },
    templateId: template.id
  };
}

export function generatePropertyMap(documents = [], propertyName) {
  const groups = new Map();
  const seen = new Set();

  for (const document of documents) {
    if (!/^node_[A-Za-z0-9_-]+$/.test(String(document?.id || ''))) continue;
    const raw = document.properties?.[propertyName];
    const values = Array.isArray(raw) ? raw : [raw ?? 'Belirtilmemiş'];
    const group = String(values.find((value) => String(value ?? '').trim()) ?? 'Belirtilmemiş');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(document);
  }

  const nodes = [];
  const references = [];
  let column = 0;
  for (const [, rows] of groups) {
    let rowIndex = 0;
    for (const document of rows) {
      if (seen.has(document.id)) continue;
      seen.add(document.id);
      nodes.push({
        id: document.id,
        title: document.title || 'Başlıksız',
        content: document.content || '',
        x: 160 + column * 360,
        y: 180 + rowIndex * 150,
        width: 220,
        height: 92,
        isReference: true
      });
      references.push({ id: document.id });
      rowIndex += 1;
    }
    column += 1;
  }

  return {
    nodes,
    references,
    edges: [],
    collapsedHubs: [],
    generated: {
      kind: 'properties',
      property: String(propertyName || '').slice(0, 120),
      createdAt: new Date().toISOString()
    },
    camera: { x: 20, y: 20, zoom: 0.85 }
  };
}
