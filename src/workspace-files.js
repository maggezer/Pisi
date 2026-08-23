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
  return String(value).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
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

function sidecarName(title, kind, id) {
  const prefix = kind === 'map' ? 'nd_' : 'inv_';
  return `${prefix}${sanitizePisiFileTitle(title).slice(0, 80)}__${id}`;
}

function safeDocumentPath(value, extension) {
  const segments = safeSegments(value);
  if (!segments) return null;
  const first = segments[0].toLocaleLowerCase('en-US');
  if (['.pisi', '.pisi-sync', '.git', 'node_modules'].includes(first)) return null;
  const path = segments.join('/');
  return path.toLocaleLowerCase('en-US').endsWith(extension) ? path : null;
}

function stableGeneratedPath(record, extension, directory = '') {
  const title = sanitizePisiFileTitle(
    record.payload?.title,
    extension === '.map' ? 'Yeni Harita' : 'Yeni Not'
  );
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
    map: clone(payload.map || {
      nodes: [], edges: [], camera: { x: 0, y: 0, zoom: 1 }, collapsedAnchors: []
    }),
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
  const mapInfo = new Map();
  const files = [];

  for (const record of maps) {
    let path = safeDocumentPath(record.payload?.relativePath, '.map')
      || stableGeneratedPath(record, '.map');
    if (occupied.has(path.toLocaleLowerCase('en-US'))) path = stableGeneratedPath(record, '.map');
    occupied.add(path.toLocaleLowerCase('en-US'));
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const sidecar = sidecarName(record.payload?.title, 'map', record.id);
    recordPaths[`map:${record.id}`] = path;
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
    let path = existing && (!parent || existingDirectory === expectedDirectory)
      ? existing
      : stableGeneratedPath(record, '.node', expectedDirectory);
    if (occupied.has(path.toLocaleLowerCase('en-US'))) {
      path = stableGeneratedPath(record, '.node', expectedDirectory);
    }
    occupied.add(path.toLocaleLowerCase('en-US'));
    const sidecar = sidecarName(record.payload?.title, 'node', record.id);
    recordPaths[`node:${record.id}`] = path;
    files.push(jsonFile(path, makeNodeData(record, parentMap, sidecar), {
      visible: true,
      recordKey: `node:${record.id}`
    }));
  }

  const relationships = [];
  for (const record of nodes) {
    for (const relation of record.payload?.relations || []) {
      relationships.push({ ...clone(relation), sourceId: record.id });
    }
  }
  files.push(jsonFile('.pisi/relationships.json', {
    version: 1,
    updatedAt: newestTimestamp(nodes),
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
      records: recordPaths
    }
  };
}

function parseJson(row, warnings) {
  try { return JSON.parse(row.content); } catch {
    warnings.push(`Proje dosyası bozuk ve atlandı: ${row.path}`);
    return null;
  }
}

function canonicalNodeEntity(path, data, relationships) {
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
      relations: clone(relationships.filter(({ sourceId }) => sourceId === id)
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

function canonicalMapEntity(path, data) {
  const map = data.map || {};
  return {
    kind: 'map',
    id: String(data.pisi.id),
    payload: {
      schema: 'pisi.map.v1',
      title: String(data.pisi.title || 'Başlıksız harita'),
      map: {
        nodes: clone(map.nodes || []),
        edges: clone(map.edges || []),
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
  const parsed = new Map();
  for (const row of rows) {
    const path = normalizePath(row.path);
    if (!path || path.startsWith('.pisi-sync/')) continue;
    const data = parseJson({ ...row, path }, warnings);
    if (data) parsed.set(path, data);
  }

  const relationshipStore = parsed.get('.pisi/relationships.json');
  const relationships = Array.isArray(relationshipStore?.relationships)
    ? relationshipStore.relationships : [];
  const entities = [];
  const idByPath = new Map();

  for (const [path, data] of parsed) {
    const lower = path.toLocaleLowerCase('en-US');
    if (!lower.endsWith('.node') && !lower.endsWith('.map')) continue;
    const expectedKind = lower.endsWith('.map') ? 'map' : 'node';
    const id = String(data?.pisi?.id || '');
    const validId = expectedKind === 'map'
      ? /^map_[A-Za-z0-9_-]{1,96}$/.test(id)
      : /^node_[A-Za-z0-9_-]{1,96}$/.test(id);
    if (!validId || data?.pisi?.type !== expectedKind) {
      warnings.push(`Geçersiz Pisi ${expectedKind} dosyası atlandı: ${path}`);
      continue;
    }
    idByPath.set(path.toLocaleLowerCase('en-US'), { id, kind: expectedKind });
    entities.push(expectedKind === 'map'
      ? canonicalMapEntity(path, data)
      : canonicalNodeEntity(path, data, relationships));
  }

  const taskStore = parsed.get('.pisi/tasks.json');
  for (const task of Array.isArray(taskStore?.tasks) ? taskStore.tasks : []) {
    const id = String(task?.id || '');
    if (!/^task_[A-Za-z0-9._:-]{4,180}$/.test(id)) continue;
    const source = task.source || {};
    const node = source.nodePath
      ? idByPath.get(normalizePath(source.nodePath).toLocaleLowerCase('en-US')) : null;
    const map = source.mapPath
      ? idByPath.get(normalizePath(source.mapPath).toLocaleLowerCase('en-US')) : null;
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
    documentPaths: Array.from(idByPath.keys()),
    authorityPaths: Array.from(parsed.keys()).filter((path) => (
      path === '.pisi/tasks.json' || path === '.pisi/relationships.json' ||
      Object.values(CONFIG_PATHS).includes(path)
    ))
  };
}

export { CONFIG_PATHS, WORKSPACE_INDEX_FORMAT, WORKSPACE_INDEX_VERSION };
