import {
  getSetting, listDocuments, listTasks, replaceSyncedWorkspace
} from './db.js';
import { hashString, hashValue } from './sync-core.js';
import {
  mapEdgeToRelationship,
  mapEdgeToRelationshipView,
  normalizeMapEdgeProjections,
  projectRelationshipsToMapEdges
} from './map-connections.js';

const CONFIG_KEYS = ['propertySchema', 'savedViews', 'templates'];

function canonicalConfigValue(id, value) {
  const rows = Array.isArray(value) ? value : [];
  if (id === 'savedViews') return rows.map((view) => ({
    ...structuredClone(view),
    type: view.type || view.layout || 'table',
    layout: view.layout || view.type || 'table'
  }));
  if (id === 'templates') return rows.map((template) => ({
    ...structuredClone(template),
    kind: template.kind || template.nodeType || 'note',
    nodeType: template.nodeType || template.kind || 'note'
  }));
  if (id !== 'propertySchema') return structuredClone(rows);
  const aliases = {
    date: 'text', checkbox: 'multiselect', select: 'multiselect',
    'multi-select': 'multiselect', url: 'text', doi: 'text'
  };
  return (Array.isArray(value) ? value : []).map((property) => ({
    ...structuredClone(property),
    type: aliases[property?.type] || property?.type || 'text'
  }));
}

function cleanToken(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function canonicalSyncId(value, kind) {
  const prefix = kind === 'map' ? 'map' : kind === 'task' ? 'task' : kind === 'edge' ? 'edge' : 'node';
  const raw = String(value || '');
  const flexible = kind === 'task';
  const alphabet = flexible ? 'A-Za-z0-9._:-' : 'A-Za-z0-9_-';
  const maximum = kind === 'task' ? 180 : 101;
  const expression = new RegExp(`^${prefix}_[${alphabet}]+$`);
  if (expression.test(raw) && raw.length <= maximum) return raw;
  const cleaned = cleanToken(raw)
    .replace(flexible ? /[^A-Za-z0-9._:-]+/g : /[^A-Za-z0-9_-]+/g, '_')
    .slice(0, Math.max(8, maximum - prefix.length - 19));
  const suffix = hashString(raw || `${kind}:missing`);
  return `${prefix}_${cleaned || 'mobile'}_${suffix}`;
}

function remapId(id, kind, ids) {
  if (!id || id === 'none') return null;
  return ids.get(String(id)) || canonicalSyncId(id, kind);
}

function canonicalCollapsedHubs(canvas = {}, ids = new Map()) {
  return Array.from(new Set(
    (Array.isArray(canvas.collapsedHubs) ? canvas.collapsedHubs : [])
      .map((value) => {
        const match = String(value || '').match(
          /^(node_[A-Za-z0-9_-]+)::(top|right|bottom|left)$/
        );
        if (!match) return null;
        const nodeId = remapId(match[1], 'node', ids);
        return nodeId ? `${nodeId}::${match[2]}` : null;
      })
      .filter(Boolean)
  ));
}

function canonicalTask(task, ids, taskIds) {
  const priority = Math.max(1, Math.min(5, Number(task.priority) || ({
    low: 1, normal: 3, high: 4, urgent: 5
  })[task.importance] || 3));
  const status = ['todo', 'doing', 'waiting', 'blocked', 'done'].includes(task.status)
    ? task.status : task.done ? 'done' : 'todo';
  return {
    title: String(task.title ?? task.text ?? ''),
    status,
    priority,
    dueDate: task.dueDate || null,
    scheduledAt: task.scheduledAt || null,
    deadline: task.deadline || null,
    reminderAt: task.reminderAt || null,
    reminderMode: task.reminderMode || 'none',
    durationMinutes: Math.max(0, Number(task.durationMinutes) || 0),
    actualMinutes: Math.max(0, Number(task.actualMinutes) || 0),
    repeat: task.repeat || 'none',
    completionOffsetDays: task.completionOffsetDays ?? null,
    dependencies: Array.from(new Set([
      ...(task.dependencies || []),
      ...(task.parentId ? [task.parentId] : [])
    ])).map((id) => remapId(id, 'task', taskIds)),
    manualOrder: Number(task.manualOrder) || Date.now(),
    todoTag: task.todoTag || `todo.${priority}.none`,
    source: {
      documentId: remapId(task.source?.documentId || task.documentId, 'node', ids),
      blockId: task.source?.blockId || task.blockId || null,
      mapId: remapId(task.source?.mapId, 'map', ids),
      nodeTitle: String(task.source?.nodeTitle || ''),
      mapTitle: String(task.source?.mapTitle || '')
    },
    createdAt: task.createdAt || null,
    updatedAt: task.updatedAt || null,
    completedAt: status === 'done' ? (task.completedAt || task.updatedAt || null) : null
  };
}

function canonicalNodePayload(document, ids, extra = {}) {
  const sourceId = remapId(document.id || extra.nodeId, 'node', ids);
  return {
    schema: 'pisi.node.v1',
    title: String(document.title || 'Başlıksız'),
    content: String(document.content || ''),
    blocks: Array.isArray(document.blocks) ? structuredClone(document.blocks) : [],
    tags: Array.isArray(document.tags) ? structuredClone(document.tags) : [],
    properties: document.properties && typeof document.properties === 'object'
      ? structuredClone(document.properties) : {},
    relations: (Array.isArray(document.relations) ? document.relations : [])
      .map((relation) => {
        const targetId = remapId(relation.targetId, 'node', ids);
        const type = String(relation.type || '');
        if (
          !targetId ||
          !['down-hub', 'co-level', 'stream'].includes(type)
        ) return null;
        return {
          ...structuredClone(relation),
          id: canonicalSyncId(
            relation.id || `${sourceId}:${targetId}:${type}`,
            'edge'
          ),
          targetId,
          type,
          sourceRole: type === 'co-level'
            ? 'co-level'
            : type === 'stream' ? 'downstream' : 'down-hub',
          targetRole: type === 'co-level'
            ? 'co-level'
            : type === 'stream' ? 'upstream' : 'up-hub',
          direction: type === 'co-level' ? 'undirected' : 'directed'
        };
      })
      .filter(Boolean),
    sources: (Array.isArray(document.sources) ? document.sources : []).map((source) => ({
      ...structuredClone(source),
      documentId: remapId(source.documentId, 'node', ids)
    })),
    parentMap: remapId(extra.parentMap || document.parentMap, 'map', ids) || 'none',
    documentKind: document.kind || 'note',
    dateKey: document.dateKey || null,
    pinned: Boolean(document.pinned),
    drawing: document.drawing || null,
    sheet: document.sheet || null,
    view: document.view || null,
    createdAt: document.createdAt || null,
    updatedAt: document.updatedAt || null,
    relativePath: document.syncRelativePath || null,
    native: document.syncNative?.node || null
  };
}

function canonicalMapPayload(document, ids) {
  const canvas = document.canvas || {};
  const nodes = (canvas.nodes || []).map((node) => ({
    id: remapId(node.id, 'node', ids),
    x: Number(node.x) || 0,
    y: Number(node.y) || 0,
    width: Number(node.width) || 220,
    height: Number(node.height) || 92,
    ...(node.customization ? { customization: structuredClone(node.customization) } : {})
  }));
  const validNodeIds = new Set(nodes.map(({ id }) => id).filter(Boolean));
  const rawEdges = (canvas.edges || []).map((edge) => ({
    ...structuredClone(edge),
    id: canonicalSyncId(
      edge.id || `${edge.sourceId}:${edge.targetId}`,
      'edge'
    ),
    sourceId: remapId(edge.sourceId, 'node', ids),
    targetId: remapId(edge.targetId, 'node', ids),
    sourcePort: edge.sourcePort,
    targetPort: edge.targetPort
  }));
  const edges = normalizeMapEdgeProjections(rawEdges, validNodeIds);
  const relationshipViews = edges
    .map((edge) => mapEdgeToRelationshipView(edge))
    .filter(Boolean);

  return {
    schema: 'pisi.map.v1',
    title: String(document.title || 'Başlıksız harita'),
    map: {
      nodes,
      relationshipViews,
      relationshipViewVersion: 1,
      camera: structuredClone(canvas.camera || { x: 0, y: 0, zoom: 1 }),
      collapsedHubs: canonicalCollapsedHubs(canvas, ids)
    },
    tags: Array.isArray(document.tags) ? structuredClone(document.tags) : [],
    properties: document.properties && typeof document.properties === 'object'
      ? structuredClone(document.properties) : {},
    createdAt: document.createdAt || null,
    updatedAt: document.updatedAt || null,
    relativePath: document.syncRelativePath || null,
    native: document.syncNative?.map || null
  };
}

function canonicalMapNodeRelations(canvas, nodeId) {
  const direct = Array.isArray(
    canvas?.nodes?.find((node) => node.id === nodeId)?.relations
  )
    ? canvas.nodes.find((node) => node.id === nodeId).relations
    : [];
  const mapRelations = (canvas?.edges || [])
    .filter((edge) => edge.sourceId === nodeId)
    .map((edge) => mapEdgeToRelationship(edge))
    .filter(Boolean)
    .map(({ sourceId: _sourceId, ...relation }) => relation);
  const byId = new Map();
  for (const relation of [...direct, ...mapRelations]) {
    if (!relation?.id) continue;
    byId.set(relation.id, structuredClone(relation));
  }
  return [...byId.values()];
}

export async function exportMobileSyncEntities() {
  const [documents, tasks, configs] = await Promise.all([
    listDocuments(),
    listTasks(),
    Promise.all(CONFIG_KEYS.map(async (key) => [key, await getSetting(key, [])]))
  ]);
  const ids = new Map();
  const taskIds = new Map();

  for (const document of documents) {
    ids.set(document.id, canonicalSyncId(document.id, document.kind === 'canvas' ? 'map' : 'node'));
    if (document.kind === 'canvas') {
      for (const node of document.canvas?.nodes || []) {
        ids.set(node.id, canonicalSyncId(node.id, 'node'));
      }
    }
  }
  tasks.forEach((task) => taskIds.set(task.id, canonicalSyncId(task.id, 'task')));

  const entities = [];
  for (const document of documents) {
    if (document.kind === 'canvas') {
      const mapId = ids.get(document.id);
      entities.push({ kind: 'map', id: mapId, payload: canonicalMapPayload(document, ids) });
      for (const node of document.canvas?.nodes || []) {
        entities.push({
          kind: 'node',
          id: ids.get(node.id),
          payload: canonicalNodePayload({
            ...node,
            relations: canonicalMapNodeRelations(document.canvas, node.id),
            kind: node.kind || 'note',
            createdAt: node.createdAt || document.createdAt,
            updatedAt: node.updatedAt || document.updatedAt
          }, ids, { parentMap: mapId })
        });
      }
    } else {
      entities.push({
        kind: 'node',
        id: ids.get(document.id),
        payload: canonicalNodePayload(document, ids)
      });
    }
  }
  for (const task of tasks) {
    entities.push({
      kind: 'task', id: taskIds.get(task.id), payload: canonicalTask(task, ids, taskIds)
    });
  }
  for (const [id, value] of configs) {
    entities.push({ kind: 'config', id, payload: { value: canonicalConfigValue(id, value) } });
  }
  return entities;
}

function makeConflictId(record) {
  const stamp = `${record.kind}:${record.id}:${record.version?.deviceId}:${record.hash}`;
  const prefix = record.kind === 'map' ? 'map' : record.kind === 'task' ? 'task' : 'node';
  return `${prefix}_conflict_${hashString(stamp)}`;
}

export function preserveMobileSyncConflicts(records, conflicts) {
  const result = records.filter((record) => !record.deleted).map((record) => structuredClone(record));
  const seen = new Set(result.map(({ key }) => key));
  const log = [];
  for (const conflict of conflicts || []) {
    const loser = conflict?.loser;
    if (!loser || loser.deleted) continue;
    if (loser.kind === 'config' && Array.isArray(loser.payload?.value)) {
      const target = result.find((record) => record.kind === 'config' && record.id === loser.id);
      if (!target || !Array.isArray(target.payload?.value)) continue;
      const byId = new Map(target.payload.value.map((item) => [
        String(item?.id || hashValue(item)), item
      ]));
      for (const item of loser.payload.value) {
        const itemId = String(item?.id || hashValue(item));
        const current = byId.get(itemId);
        if (!current) {
          target.payload.value.push(structuredClone(item));
          byId.set(itemId, item);
        } else if (hashValue(current) !== hashValue(item)) {
          const copy = {
            ...structuredClone(item),
            id: `${itemId}_conflict_${hashValue(item)}`.slice(0, 80),
            name: `${item?.name || itemId} (Sync çakışması)`
          };
          if (!byId.has(copy.id)) {
            target.payload.value.push(copy);
            byId.set(copy.id, copy);
          }
        }
      }
      log.push({ originalKey: loser.key, conflictKey: loser.key, deviceId: loser.version?.deviceId });
      continue;
    }
    if (!['node', 'map', 'task'].includes(loser.kind)) continue;
    const id = makeConflictId(loser);
    const key = `${loser.kind}:${id}`;
    if (seen.has(key)) continue;
    const device = String(loser.version?.deviceId || 'cihaz').slice(0, 24);
    result.push({
      ...loser,
      key,
      id,
      payload: {
        ...structuredClone(loser.payload),
        title: `${loser.payload?.title || 'Başlıksız'} (Sync çakışması - ${device})`,
        parentMap: loser.kind === 'node' ? 'none' : loser.payload?.parentMap
      }
    });
    seen.add(key);
    log.push({ originalKey: loser.key, conflictKey: key, deviceId: device });
  }
  return { records: result, log };
}

function mobileTask(id, payload) {
  const status = payload.status || 'todo';
  const priority = Math.max(1, Math.min(5, Number(payload.priority) || 3));
  return {
    id,
    ...structuredClone(payload),
    text: String(payload.title || ''),
    done: status === 'done',
    importance: priority >= 5 ? 'urgent' : priority >= 4 ? 'high' : priority <= 1 ? 'low' : 'normal',
    documentId: payload.source?.documentId || null,
    blockId: payload.source?.blockId || null,
    parentId: null
  };
}

function mobileRelations(relations) {
  return (Array.isArray(relations) ? relations : [])
    .map((relation) => structuredClone(relation));
}

export async function applyMobileSyncRecords(records, conflicts = [], options = {}) {
  const preserved = options.recordsAlreadyPreserved
    ? {
        records: records.filter((record) => !record.deleted).map((record) => structuredClone(record)),
        log: Array.isArray(options.conflictLog) ? structuredClone(options.conflictLog) : []
      }
    : preserveMobileSyncConflicts(records, conflicts);
  const live = preserved.records;
  const nodeById = new Map(live.filter(({ kind }) => kind === 'node')
    .map((record) => [record.id, record.payload]));
  const semanticRelationships = live
    .filter(({ kind }) => kind === 'node')
    .flatMap((record) => mobileRelations(record.payload?.relations).map((relation) => ({
      ...relation,
      sourceId: record.id
    })));
  const liveMapIds = new Set(live.filter(({ kind }) => kind === 'map').map(({ id }) => id));
  const documents = [];
  const tasks = [];
  const settings = {};

  for (const record of live) {
    const payload = record.payload || {};
    if (
      record.kind === 'node' &&
      (!payload.parentMap || payload.parentMap === 'none' || !liveMapIds.has(payload.parentMap))
    ) {
      documents.push({
        id: record.id,
        kind: payload.documentKind || 'note',
        title: payload.title,
        content: payload.content || '',
        blocks: payload.blocks || [],
        tags: payload.tags || [],
        properties: payload.properties || {},
        relations: mobileRelations(payload.relations),
        sources: payload.sources || [],
        dateKey: payload.dateKey || null,
        pinned: Boolean(payload.pinned),
        drawing: payload.drawing || null,
        sheet: payload.sheet || undefined,
        view: payload.view || undefined,
        createdAt: payload.createdAt || undefined,
        updatedAt: payload.updatedAt || undefined,
        syncRelativePath: payload.relativePath || null,
        syncNative: { node: payload.native || null }
      });
    } else if (record.kind === 'map') {
      const map = payload.map || {};
      const layouts = (Array.isArray(map.nodes) ? structuredClone(map.nodes) : [])
        .filter((layout) => nodeById.get(layout.id)?.parentMap === record.id);
      const layoutIds = new Set(layouts.map(({ id }) => id));
      for (const [nodeId, node] of nodeById) {
        if (node.parentMap !== record.id || layoutIds.has(nodeId)) continue;
        const index = layouts.length;
        layouts.push({
          id: nodeId,
          x: 80 + (index % 4) * 260,
          y: 80 + Math.floor(index / 4) * 140,
          width: 220,
          height: 92
        });
        layoutIds.add(nodeId);
      }
      documents.push({
        id: record.id,
        kind: 'canvas',
        title: payload.title,
        tags: payload.tags || [],
        properties: payload.properties || {},
        canvas: {
          nodes: layouts.map((layout) => {
            const node = nodeById.get(layout.id) || {};
            return {
              ...structuredClone(layout),
              id: layout.id,
              title: node.title || 'Başlıksız',
              content: node.content || '',
              blocks: node.blocks || [],
              tags: node.tags || [],
              properties: node.properties || {},
              relations: mobileRelations(node.relations),
              sources: node.sources || [],
              createdAt: node.createdAt || payload.createdAt,
              updatedAt: node.updatedAt || payload.updatedAt,
              syncRelativePath: node.relativePath || null,
              syncNative: { node: node.native || null }
            };
          }),
          edges: projectRelationshipsToMapEdges(
            semanticRelationships,
            map.relationshipViews || [],
            layoutIds
          ),
          camera: map.camera || { x: 0, y: 0, zoom: 1 },
          collapsedHubs: canonicalCollapsedHubs(map)
        },
        createdAt: payload.createdAt || undefined,
        updatedAt: payload.updatedAt || undefined,
        syncRelativePath: payload.relativePath || null,
        syncNative: { map: payload.native || null }
      });
    } else if (record.kind === 'task') {
      tasks.push(mobileTask(record.id, payload));
    } else if (record.kind === 'config' && CONFIG_KEYS.includes(record.id)) {
      settings[record.id] = canonicalConfigValue(record.id, payload.value || []);
    }
  }
  if (preserved.log.length) {
    settings.pisiSyncConflicts = preserved.log;
  }
  await replaceSyncedWorkspace({ documents, tasks, settings });
  return { documents: documents.length, tasks: tasks.length, conflicts: preserved.log.length };
}
