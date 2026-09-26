import {
  mapEdgeToRelationship,
  mapEdgeToRelationshipView,
  normalizeMapEdges,
  projectRelationshipsToMapEdges
} from './map-connections.js';

const WORKSPACE_INDEX_FORMAT = 'pisi-workspace-file-index';
const WORKSPACE_INDEX_VERSION = 1;

const DEFAULT_CONNECTION_TYPES = Object.freeze({
  'up-hub': [],
  'down-hub': [],
  'co-level': [],
  upstream: [],
  downstream: []
});

const CONFIG_PATHS = Object.freeze({
  propertySchema: '.pisi/properties.json',
  savedViews: '.pisi-views.json',
  templates: '.pisi-templates.json'
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function normalizePath(value = '') {
  return String(value).normalize('NFC').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function pathKey(value = '') {
  return normalizePath(value).toLocaleLowerCase('en-US');
}

function windowsSafeSegment(segment = '') {
  if (!segment || /[<>:"|?*\u0000-\u001f]/.test(segment) || /[. ]$/.test(segment)) return false;
  const stem = segment.split('.')[0].toUpperCase();
  return !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);
}

function safeSegments(value = '') {
  const path = normalizePath(value);
  if (!path) return null;
  const segments = path.split('/');
  if (
    segments.length > 24 ||
    segments.some((segment) => (
      !segment || segment === '.' || segment === '..' || segment.length > 180 ||
      /[\u0000-\u001f]/.test(segment)
    ))
  ) return null;
  return segments;
}

export function sanitizePisiFileTitle(value, fallback = 'Yeni Dosya') {
  let cleaned = String(value || fallback)
    .normalize('NFC')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
  const windowsStem = cleaned.split('.')[0].toUpperCase();
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(windowsStem)) {
    cleaned = `_${cleaned}`;
  }
  return cleaned || fallback;
}

function sidecarName(title, kind, id, nativeSidecar = '') {
  const prefix = kind === 'map' ? 'nd_' : 'inv_';
  const stored = String(nativeSidecar || '').normalize('NFC');
  if (
    stored.startsWith(prefix) && stored.length <= 180 &&
    !stored.includes('/') && !stored.includes('\\') && windowsSafeSegment(stored)
  ) return stored;
  const titleLimit = Math.max(8, 180 - prefix.length - 2 - String(id).length);
  return `${prefix}${sanitizePisiFileTitle(title).slice(0, titleLimit)}__${id}`;
}

function safeDocumentPath(value, extension) {
  const segments = safeSegments(value);
  if (!segments || !segments.every(windowsSafeSegment)) return null;
  const first = segments[0].toLocaleLowerCase('en-US');
  if (['.pisi', '.pisi-sync', '.git', 'node_modules'].includes(first)) return null;
  const path = segments.join('/');
  return path.toLocaleLowerCase('en-US').endsWith(extension) ? path : null;
}

function stableGeneratedPath(record, extension, directory = '') {
  const titleLimit = Math.max(8, 180 - 2 - String(record.id).length - extension.length);
  const title = sanitizePisiFileTitle(
    record.payload?.title,
    extension === '.map' ? 'Yeni Harita' : 'Yeni Not'
  ).slice(0, titleLimit);
  const name = `${title}__${record.id}${extension}`;
  return directory ? `${directory}/${name}` : name;
}

function newestTimestamp(records = []) {
  return records.map((record) => record.updatedAt || record.payload?.updatedAt || null)
    .filter(Boolean).sort().at(-1) || null;
}

function makeNodeData(record, parentMap, sidecar) {
  const payload = record.payload || {};
  const native = payload.native && typeof payload.native === 'object'
    ? clone(payload.native) : {};
  const now = payload.updatedAt || record.updatedAt || new Date().toISOString();
  const data = {
    ...native,
    pisi: {
      ...(native.pisi || {}),
      version: 1,
      type: 'node',
      id: record.id,
      title: String(payload.title || native.pisi?.title || 'Başlıksız'),
      sidecar,
      parentMap: parentMap || payload.parentMap || 'none',
      connectionTypes: clone(native.pisi?.connectionTypes || DEFAULT_CONNECTION_TYPES),
      createdAt: payload.createdAt || native.pisi?.createdAt || now,
      updatedAt: now
    },
    content: String(payload.content || ''),
    blocks: clone(payload.blocks || []),
    tags: clone(payload.tags || []),
    properties: clone(payload.properties || {}),
    sources: clone(payload.sources || []),
    documentKind: payload.documentKind || 'note',
    dateKey: payload.dateKey || null,
    pinned: Boolean(payload.pinned)
  };
  if (payload.drawing != null) data.drawing = clone(payload.drawing);
  if (payload.sheet != null) data.sheet = clone(payload.sheet);
  if (payload.view != null) data.view = clone(payload.view);
  return data;
}

function makeMapData(record, sidecar) {
  const payload = record.payload || {};
  const native = payload.native && typeof payload.native === 'object'
    ? clone(payload.native) : {};
  const now = payload.updatedAt || record.updatedAt || new Date().toISOString();
  const rawMap = clone(payload.map || {
    nodes: [], edges: [], camera: { x: 0, y: 0, zoom: 1 }, collapsedAnchors: []
  });
  const validNodeIds = new Set((rawMap.nodes || []).map(({ id }) => id).filter(Boolean));
  const edges = normalizeMapEdges(rawMap.edges || [], validNodeIds).edges;
  const map = {
    ...(native.map && typeof native.map === 'object' ? clone(native.map) : {}),
    ...rawMap,
    relationshipViews: edges.map(mapEdgeToRelationshipView).filter(Boolean),
    relationshipViewVersion: 1
  };
  delete map.edges;
  return {
    ...native,
    pisi: {
      ...(native.pisi || {}),
      version: 1,
      type: 'map',
      id: record.id,
      title: String(payload.title || native.pisi?.title || 'Başlıksız harita'),
      sidecar,
      createdAt: payload.createdAt || native.pisi?.createdAt || now,
      updatedAt: now
    },
    map,
    tags: clone(payload.tags || []),
    properties: clone(payload.properties || {})
  };
}

function jsonFile(path, value, { visible = false, recordKey = null } = {}) {
  return {
    path,
    content: `${JSON.stringify(value, null, 2)}\n`,
    visible,
    recordKey
  };
}

export function buildWorkspaceProjection(records = []) {
  const live = (records || []).filter((record) => !record.deleted);
  const maps = live.filter(({ kind }) => kind === 'map');
  const nodes = live.filter(({ kind }) => kind === 'node');
  const occupied = new Set();
  const recordPaths = {};
  const recordSidecars = {};
  const mapInfo = new Map();
  const files = [];

  for (const record of maps) {
    const requestedPath = normalizePath(record.payload?.relativePath);
    const existingPath = safeDocumentPath(requestedPath, '.map');
    if (requestedPath && !existingPath && record.payload?.native) {
      throw new Error(`Windows ile uyumsuz mevcut harita yolu otomatik taşınmadı: ${requestedPath}`);
    }
    let path = existingPath
      || stableGeneratedPath(record, '.map');
    if (occupied.has(pathKey(path))) {
      if (existingPath && record.payload?.native) {
        throw new Error(`Büyük/küçük harf çakışan harita yolu otomatik taşınmadı: ${existingPath}`);
      }
      path = stableGeneratedPath(record, '.map');
    }
    occupied.add(pathKey(path));
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const sidecar = sidecarName(
      record.payload?.title, 'map', record.id, record.payload?.native?.pisi?.sidecar
    );
    recordPaths[`map:${record.id}`] = path;
    recordSidecars[`map:${record.id}`] = sidecar;
    mapInfo.set(record.id, { path, directory, sidecar });
    files.push(jsonFile(path, makeMapData(record, sidecar), {
      visible: true,
      recordKey: `map:${record.id}`
    }));
  }

  for (const record of nodes) {
    const parentMap = record.payload?.parentMap || 'none';
    const parent = mapInfo.get(parentMap);
    const expectedDirectory = parent
      ? (parent.directory ? `${parent.directory}/${parent.sidecar}` : parent.sidecar)
      : '';
    const existing = safeDocumentPath(record.payload?.relativePath, '.node');
    const existingDirectory = existing?.includes('/')
      ? existing.slice(0, existing.lastIndexOf('/')) : '';
    const requestedPath = normalizePath(record.payload?.relativePath);
    if (requestedPath && !existing && record.payload?.native) {
      throw new Error(`Windows ile uyumsuz mevcut node yolu otomatik taşınmadı: ${requestedPath}`);
    }
    let path = existing && (!parent || existingDirectory === expectedDirectory)
      ? existing
      : stableGeneratedPath(record, '.node', expectedDirectory);
    if (occupied.has(pathKey(path))) {
      if (existing && record.payload?.native) {
        throw new Error(`Büyük/küçük harf çakışan node yolu otomatik taşınmadı: ${existing}`);
      }
      path = stableGeneratedPath(record, '.node', expectedDirectory);
    }
    occupied.add(pathKey(path));
    const sidecar = sidecarName(
      record.payload?.title, 'node', record.id, record.payload?.native?.pisi?.sidecar
    );
    recordPaths[`node:${record.id}`] = path;
    recordSidecars[`node:${record.id}`] = sidecar;
    files.push(jsonFile(path, makeNodeData(record, parentMap, sidecar), {
      visible: true,
      recordKey: `node:${record.id}`
    }));
  }

  const relationshipsById = new Map();
  const addRelationship = (relationship) => {
    if (!relationship?.id) return;
    relationshipsById.set(String(relationship.id), clone(relationship));
  };
  for (const record of nodes) {
    for (const relation of record.payload?.relations || []) {
      addRelationship({ ...clone(relation), sourceId: record.id });
    }
  }
  for (const record of maps) {
    const rawMap = record.payload?.map || {};
    const validNodeIds = new Set((rawMap.nodes || []).map(({ id }) => id).filter(Boolean));
    for (const edge of normalizeMapEdges(rawMap.edges || [], validNodeIds).edges) {
      addRelationship(mapEdgeToRelationship(edge));
    }
  }
  const relationships = Array.from(relationshipsById.values());
  files.push(jsonFile('.pisi/relationships.json', {
    version: 1,
    updatedAt: newestTimestamp([...nodes, ...maps]),
    relationships
  }));

  const tasks = live.filter(({ kind }) => kind === 'task').map((record) => {
    const payload = clone(record.payload || {});
    const source = payload.source || {};
    return {
      ...payload,
      id: record.id,
      source: {
        nodePath: source.documentId ? recordPaths[`node:${source.documentId}`] || null : null,
        blockId: source.blockId || null,
        mapPath: source.mapId ? recordPaths[`map:${source.mapId}`] || null : null,
        nodeTitle: source.nodeTitle || '',
        mapTitle: source.mapTitle || ''
      }
    };
  });
  files.push(jsonFile('.pisi/tasks.json', {
    version: 1,
    updatedAt: newestTimestamp(live.filter(({ kind }) => kind === 'task')),
    tasks
  }));

  const configs = new Map(live.filter(({ kind }) => kind === 'config')
    .map((record) => [record.id, clone(record.payload?.value || [])]));
  files.push(
    jsonFile(CONFIG_PATHS.propertySchema, {
      version: 1, definitions: configs.get('propertySchema') || []
    }),
    jsonFile(CONFIG_PATHS.savedViews, {
      version: 1, views: configs.get('savedViews') || []
    }),
    jsonFile(CONFIG_PATHS.templates, {
      version: 1, templates: configs.get('templates') || []
    })
  );

  return {
    files,
    visibleFiles: files.filter(({ visible }) => visible).map(({ path }) => path),
    index: {
      format: WORKSPACE_INDEX_FORMAT,
      version: WORKSPACE_INDEX_VERSION,
      updatedAt: newestTimestamp(live),
      records: recordPaths,
      sidecars: recordSidecars
    }
  };
}

function parseJson(row, warnings) {
  try { return JSON.parse(row.content); } catch {
    warnings.push(`Proje dosyası bozuk ve atlandı: ${row.path}`);
    return null;
  }
}

function canonicalNodeEntity(path, data, relationships, relationshipSourceId = data.pisi.id) {
  const id = String(data.pisi.id);
  return {
    kind: 'node',
    id,
    payload: {
      schema: 'pisi.node.v1',
      title: String(data.pisi.title || 'Başlıksız'),
      content: String(data.content || ''),
      blocks: clone(data.blocks || []),
      tags: clone(data.tags || []),
      properties: clone(data.properties || {}),
      relations: clone(relationships.filter(({ sourceId }) => sourceId === relationshipSourceId)
        .map(({ sourceId: _sourceId, ...relation }) => relation)),
      sources: clone(data.sources || []),
      parentMap: data.pisi.parentMap || 'none',
      documentKind: data.documentKind || (data.dateKey ? 'journal' : 'note'),
      dateKey: data.dateKey || null,
      pinned: Boolean(data.pinned),
      drawing: data.drawing || null,
      sheet: data.sheet || null,
      view: data.view || null,
      createdAt: data.pisi.createdAt || null,
      updatedAt: data.pisi.updatedAt || null,
      relativePath: path,
      native: clone(data)
    }
  };
}

function driveSyncConflict(path) {
  const match = normalizePath(path).match(
    / \(conflict (\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\)(?: \(\d+\))?(?=\.(?:node|map)$)/i
  );
  return match ? { stamp: match[1] } : null;
}

function stablePathToken(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function canonicalMapEntity(path, data, relationships = []) {
  const map = data.map || {};
  const nodes = clone(map.nodes || []);
  const validNodeIds = new Set(nodes.map(({ id }) => id).filter(Boolean));
  const projected = projectRelationshipsToMapEdges(
    relationships,
    map.relationshipViews || [],
    validNodeIds
  );
  const legacy = normalizeMapEdges(map.edges || [], validNodeIds).edges;
  const edges = normalizeMapEdges([...projected, ...legacy], validNodeIds).edges;
  return {
    kind: 'map',
    id: String(data.pisi.id),
    payload: {
      schema: 'pisi.map.v1',
      title: String(data.pisi.title || 'Başlıksız harita'),
      map: {
        nodes,
        edges,
        camera: clone(map.camera || { x: 0, y: 0, zoom: 1 }),
        collapsedAnchors: clone(map.collapsedAnchors || [])
      },
      tags: clone(data.tags || []),
      properties: clone(data.properties || {}),
      createdAt: data.pisi.createdAt || null,
      updatedAt: data.pisi.updatedAt || null,
      relativePath: path,
      native: clone(data)
    }
  };
}

export function parseWorkspaceFiles(rows = []) {
  const warnings = [];
  const notices = [];
  const fileConflicts = [];
  const parsed = new Map();
  for (const row of rows) {
    const path = normalizePath(row.path);
    const lower = pathKey(path);
    if (
      !path || lower.startsWith('.pisi-sync/') ||
      lower === '.pisi/sync-trash' || lower.startsWith('.pisi/sync-trash/') ||
      lower === '.pisi/recovery' || lower.startsWith('.pisi/recovery/') ||
      lower === '.pisi-history' || lower.startsWith('.pisi-history/')
    ) continue;
    const data = parseJson({ ...row, path }, warnings);
    if (data) parsed.set(path, data);
  }

  const relationshipStore = parsed.get('.pisi/relationships.json');
  const relationships = Array.isArray(relationshipStore?.relationships)
    ? relationshipStore.relationships : [];
  const mapRelationshipIds = new Set();
  for (const [path, data] of parsed.entries()) {
    if (!pathKey(path).endsWith('.map')) continue;
    for (const view of Array.isArray(data?.map?.relationshipViews)
      ? data.map.relationshipViews : []) {
      const id = String(view?.relationshipId || view?.id || '');
      if (id) mapRelationshipIds.add(id);
    }
  }
  const nonMapRelationships = relationships.filter(
    (relationship) => !mapRelationshipIds.has(String(relationship?.id || ''))
  );
  const entities = [];
  const idByPath = new Map();
  const firstPathByEntity = new Map();

  const documents = Array.from(parsed.entries())
    .filter(([path]) => /\.(?:node|map)$/i.test(path))
    .sort(([left], [right]) => (
      Number(Boolean(driveSyncConflict(left))) - Number(Boolean(driveSyncConflict(right))) ||
      pathKey(left).localeCompare(pathKey(right))
    ));
  for (const [path, originalData] of documents) {
    const lower = pathKey(path);
    if (!lower.endsWith('.node') && !lower.endsWith('.map')) continue;
    const expectedKind = lower.endsWith('.map') ? 'map' : 'node';
    const originalId = String(originalData?.pisi?.id || '');
    const validId = expectedKind === 'map'
      ? /^map_[A-Za-z0-9_-]{1,96}$/.test(originalId)
      : /^node_[A-Za-z0-9_-]{1,96}$/.test(originalId);
    if (!validId || originalData?.pisi?.type !== expectedKind) {
      warnings.push(`Geçersiz Pisi ${expectedKind} dosyası atlandı: ${path}`);
      continue;
    }
    const originalKey = `${expectedKind}:${originalId}`;
    const namedConflict = driveSyncConflict(path);
    const duplicatePath = firstPathByEntity.get(originalKey);
    const alreadyIsolated = Boolean(
      namedConflict && originalData?.pisi?.conflictOf &&
      new RegExp(`^${expectedKind}_conflict_[A-Za-z0-9_-]+$`).test(originalId)
    );
    let data = originalData;
    let id = originalId;
    if ((namedConflict && !alreadyIsolated) || duplicatePath) {
      const token = stablePathToken(`${path}\n${JSON.stringify(originalData)}`);
      id = `${expectedKind}_conflict_${token}`;
      data = clone(originalData);
      data.pisi = {
        ...data.pisi,
        id,
        title: `${data.pisi.title || 'Başlıksız'} (DriveSync çakışma kopyası)`,
        conflictOf: originalId,
        conflictSourcePath: path,
        ...(namedConflict ? { conflictStamp: namedConflict.stamp } : {})
      };
      fileConflicts.push({
        kind: expectedKind,
        originalId,
        conflictId: id,
        originalPath: duplicatePath || null,
        conflictPath: path,
        source: namedConflict ? 'drivesync-filename' : 'duplicate-pisi-id'
      });
      notices.push(
        `Çakışma dosyası ayrı kopya olarak korundu: ${path}`
      );
    } else {
      firstPathByEntity.set(originalKey, path);
      if (alreadyIsolated) {
        fileConflicts.push({
          kind: expectedKind,
          originalId: String(originalData.pisi.conflictOf),
          conflictId: originalId,
          originalPath: null,
          conflictPath: path,
          source: 'drivesync-filename'
        });
      }
    }
    idByPath.set(pathKey(path), { id, kind: expectedKind });
    entities.push(expectedKind === 'map'
      ? canonicalMapEntity(path, data, relationships)
      : canonicalNodeEntity(path, data, nonMapRelationships, originalId));
  }

  const taskStore = parsed.get('.pisi/tasks.json');
  for (const task of Array.isArray(taskStore?.tasks) ? taskStore.tasks : []) {
    const id = String(task?.id || '');
    if (!/^task_[A-Za-z0-9._:-]{4,180}$/.test(id)) continue;
    const source = task.source || {};
    const node = source.nodePath
      ? idByPath.get(pathKey(source.nodePath)) : null;
    const map = source.mapPath
      ? idByPath.get(pathKey(source.mapPath)) : null;
    entities.push({
      kind: 'task',
      id,
      payload: {
        ...clone(task),
        source: {
          documentId: node?.kind === 'node' ? node.id : null,
          blockId: source.blockId || null,
          mapId: map?.kind === 'map' ? map.id : null,
          nodeTitle: source.nodeTitle || '',
          mapTitle: source.mapTitle || ''
        }
      }
    });
  }

  const propertySchema = parsed.get(CONFIG_PATHS.propertySchema);
  const savedViews = parsed.get(CONFIG_PATHS.savedViews);
  const templates = parsed.get(CONFIG_PATHS.templates);
  if (propertySchema) entities.push({
    kind: 'config', id: 'propertySchema', payload: { value: clone(propertySchema.definitions || []) }
  });
  if (savedViews) entities.push({
    kind: 'config', id: 'savedViews', payload: { value: clone(savedViews.views || []) }
  });
  if (templates) entities.push({
    kind: 'config', id: 'templates', payload: { value: clone(templates.templates || []) }
  });

  return {
    entities,
    warnings,
    notices,
    fileConflicts,
    documentPaths: Array.from(idByPath.keys()),
    authorityPaths: Array.from(parsed.keys()).filter((path) => (
      path === '.pisi/tasks.json' || path === '.pisi/relationships.json' ||
      Object.values(CONFIG_PATHS).includes(path)
    ))
  };
}

export { CONFIG_PATHS, WORKSPACE_INDEX_FORMAT, WORKSPACE_INDEX_VERSION };
