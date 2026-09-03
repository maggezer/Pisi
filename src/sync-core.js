export const PISI_SYNC_PROTOCOL = 'pisi-sync';
export const PISI_SYNC_VERSION = 1;
export const PISI_SYNC_DEVICE_SNAPSHOT = 'pisi-sync-device-snapshot';

function assertSafeToken(value, label) {
  const token = String(value || '').trim();
  if (!/^[A-Za-z0-9._:-]{3,180}$/.test(token)) {
    throw new TypeError(String(label || 'Kimlik') + ' geçersiz.');
  }
  return token;
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((item) => stableStringify(item)).join(',') + ']';
  }
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return '{' + keys.map((key) => (
    JSON.stringify(key) + ':' + stableStringify(value[key])
  )).join(',') + '}';
}

export function hashString(value) {
  const text = String(value ?? '');
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hash ^= BigInt(code & 0xff);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    hash ^= BigInt((code >>> 8) & 0xff);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function hashValue(value) {
  return hashString(stableStringify(value));
}

export function makeEntityKey(kind, id) {
  return assertSafeToken(kind, 'Varlık türü') + ':' +
    assertSafeToken(id, 'Varlık kimliği');
}

export function normalizeVersion(version = {}) {
  return {
    counter: Math.max(0, Math.floor(Number(version.counter) || 0)),
    deviceId: assertSafeToken(
      version.deviceId || 'device-unknown',
      'Cihaz kimliği'
    )
  };
}

export function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.deviceId.localeCompare(b.deviceId);
}

export function normalizeEntity(entity = {}) {
  const kind = assertSafeToken(entity.kind, 'Varlık türü');
  const id = assertSafeToken(entity.id, 'Varlık kimliği');
  if (
    !entity.payload ||
    typeof entity.payload !== 'object' ||
    Array.isArray(entity.payload)
  ) {
    throw new TypeError('Senkronizasyon varlığı nesne payload taşımalı.');
  }
  return {
    key: makeEntityKey(kind, id),
    kind,
    id,
    payload: structuredClone(entity.payload)
  };
}

export function normalizeRecord(record = {}) {
  const kind = assertSafeToken(record.kind, 'Kayıt türü');
  const id = assertSafeToken(record.id, 'Kayıt kimliği');
  const deleted = record.deleted === true;
  const payload = deleted ? null : record.payload;
  if (
    !deleted &&
    (!payload || typeof payload !== 'object' || Array.isArray(payload))
  ) {
    throw new TypeError('Canlı senkronizasyon kaydı payload taşımalı.');
  }
  return {
    key: makeEntityKey(kind, id),
    kind,
    id,
    deleted,
    hash: deleted ? 'deleted' : String(record.hash || hashValue(payload)),
    version: normalizeVersion(record.version),
    ancestors: Array.from(new Set((Array.isArray(record.ancestors) ? record.ancestors : [])
      .map((value) => String(value || '').slice(0, 300))
      .filter(Boolean))).slice(0, 32),
    updatedAt: String(record.updatedAt || new Date(0).toISOString()),
    payload: deleted ? null : structuredClone(payload)
  };
}

export function recordsToMap(records = []) {
  const map = new Map();
  const source = records instanceof Map
    ? Array.from(records.values())
    : Array.isArray(records) ? records : Object.values(records || {});
  source.forEach((record) => {
    const normalized = normalizeRecord(record);
    map.set(normalized.key, normalized);
  });
  return map;
}

function sameRecordContent(left, right) {
  return Boolean(
    left && right &&
    left.deleted === right.deleted &&
    left.hash === right.hash
  );
}

function recordSignature(record) {
  if (!record) return '';
  const version = normalizeVersion(record.version);
  return [
    version.counter,
    version.deviceId,
    record.deleted === true ? '1' : '0',
    String(record.hash || '')
  ].join('|');
}

function recordDescendsFrom(record, ancestor) {
  if (!record || !ancestor) return false;
  if (sameRecordContent(record, ancestor)) return true;
  return (record.ancestors || []).includes(recordSignature(ancestor));
}

function nextAncestors(previous) {
  if (!previous) return [];
  return Array.from(new Set([
    recordSignature(previous), ...(previous.ancestors || [])
  ])).slice(0, 32);
}

function changedSince(record, previous) {
  if (!record) return false;
  if (!previous) return true;
  return compareVersions(record.version, previous.version) >= 0 &&
    !sameRecordContent(record, previous);
}

function nextVersion(clock, deviceId) {
  clock.value += 1;
  return { counter: clock.value, deviceId };
}

export function prepareDeviceRecords({
  entities = [],
  baseRecords = [],
  deviceId,
  clock = 0,
  now = new Date().toISOString()
} = {}) {
  const safeDeviceId = assertSafeToken(deviceId, 'Cihaz kimliği');
  const base = recordsToMap(baseRecords);
  const local = new Map();
  for (const raw of entities) {
    const entity = normalizeEntity(raw);
    if (local.has(entity.key)) {
      throw new Error('Tekrarlanan yerel varlık: ' + entity.key);
    }
    local.set(entity.key, entity);
  }

  const counter = {
    value: Math.max(
      Math.floor(Number(clock) || 0),
      ...Array.from(base.values(), (record) => record.version.counter)
    )
  };
  const records = [];

  for (const [key, entity] of local) {
    const hash = hashValue(entity.payload);
    const previous = base.get(key);
    if (previous && !previous.deleted && previous.hash === hash) {
      records.push({
        ...previous,
        payload: structuredClone(entity.payload)
      });
      continue;
    }
    records.push({
      ...entity,
      deleted: false,
      hash,
      version: nextVersion(counter, safeDeviceId),
      ancestors: nextAncestors(previous),
      updatedAt: now
    });
  }

  for (const [key, previous] of base) {
    if (local.has(key)) continue;
    if (previous.deleted) {
      records.push(previous);
      continue;
    }
    records.push({
      key,
      kind: previous.kind,
      id: previous.id,
      deleted: true,
      hash: 'deleted',
      version: nextVersion(counter, safeDeviceId),
      ancestors: nextAncestors(previous),
      updatedAt: now,
      payload: null
    });
  }

  records.sort((a, b) => a.key.localeCompare(b.key));
  return { records, clock: counter.value };
}

function chooseWinningRecord(current, candidate) {
  if (!current) return candidate;
  if (!candidate) return current;
  const order = compareVersions(current.version, candidate.version);
  if (order < 0) return candidate;
  if (order > 0) return current;
  const currentTie = (current.deleted ? '1:' : '0:') + current.hash;
  const candidateTie = (candidate.deleted ? '1:' : '0:') + candidate.hash;
  return candidateTie.localeCompare(currentTie) > 0 ? candidate : current;
}

export function foldDeviceSnapshots(snapshots = [], projectId = null) {
  const winners = new Map();
  let clock = 0;
  for (const snapshot of snapshots) {
    if (
      !snapshot ||
      snapshot.format !== PISI_SYNC_DEVICE_SNAPSHOT ||
      snapshot.version !== PISI_SYNC_VERSION ||
      (projectId && snapshot.projectId !== projectId)
    ) {
      continue;
    }
    for (const raw of Array.isArray(snapshot.records) ? snapshot.records : []) {
      const record = normalizeRecord(raw);
      winners.set(
        record.key,
        chooseWinningRecord(winners.get(record.key), record)
      );
      clock = Math.max(clock, record.version.counter);
    }
  }
  return {
    records: Array.from(winners.values())
      .sort((a, b) => a.key.localeCompare(b.key)),
    clock
  };
}

export function planMergedRecords({
  baseRecords = [],
  localRecords = [],
  remoteRecords = []
} = {}) {
  const base = recordsToMap(baseRecords);
  const local = recordsToMap(localRecords);
  const remote = recordsToMap(remoteRecords);
  const keys = new Set([...local.keys(), ...remote.keys()]);
  const merged = [];
  const apply = [];
  const conflicts = [];

  for (const key of keys) {
    const localRecord = local.get(key);
    const remoteRecord = remote.get(key);
    const winner = chooseWinningRecord(localRecord, remoteRecord);
    if (!winner) continue;
    merged.push(winner);

    const previous = base.get(key);
    const localChanged = changedSince(localRecord, previous);
    const remoteChanged = changedSince(remoteRecord, previous);
    const hasLineage = Boolean(
      localRecord?.ancestors?.length || remoteRecord?.ancestors?.length
    );
    const concurrent = Boolean(
      localRecord && remoteRecord &&
      !recordDescendsFrom(localRecord, remoteRecord) &&
      !recordDescendsFrom(remoteRecord, localRecord)
    );
    if (
      localRecord &&
      remoteRecord &&
      (hasLineage ? concurrent : (localChanged && remoteChanged)) &&
      !sameRecordContent(localRecord, remoteRecord)
    ) {
      conflicts.push({
        key,
        base: previous || null,
        winner,
        loser: winner === localRecord ? remoteRecord : localRecord
      });
    }
    if (!sameRecordContent(localRecord, winner)) apply.push(winner);
  }

  return {
    records: merged.sort((a, b) => a.key.localeCompare(b.key)),
    apply: apply.sort((a, b) => a.key.localeCompare(b.key)),
    conflicts
  };
}

export function makeSyncManifest({
  projectId,
  createdBy,
  createdAt = new Date().toISOString()
} = {}) {
  return {
    format: PISI_SYNC_PROTOCOL,
    version: PISI_SYNC_VERSION,
    projectId: assertSafeToken(projectId, 'Proje kimliği'),
    createdBy: assertSafeToken(createdBy, 'Cihaz kimliği'),
    createdAt
  };
}

export function validateSyncManifest(manifest) {
  if (
    !manifest ||
    manifest.format !== PISI_SYNC_PROTOCOL ||
    manifest.version !== PISI_SYNC_VERSION
  ) {
    throw new Error(
      'Seçilen klasörde geçerli bir Pisi Sync manifesti yok.'
    );
  }
  return makeSyncManifest(manifest);
}

export function makeDeviceSnapshot({
  projectId,
  deviceId,
  deviceName,
  records,
  clock,
  createdAt = new Date().toISOString()
} = {}) {
  return {
    format: PISI_SYNC_DEVICE_SNAPSHOT,
    version: PISI_SYNC_VERSION,
    projectId: assertSafeToken(projectId, 'Proje kimliği'),
    deviceId: assertSafeToken(deviceId, 'Cihaz kimliği'),
    deviceName: String(deviceName || 'Pisi cihazı').slice(0, 120),
    clock: Math.max(0, Math.floor(Number(clock) || 0)),
    createdAt,
    records: Array.from(recordsToMap(records).values())
      .sort((a, b) => a.key.localeCompare(b.key))
  };
}

export function summarizeSyncPlan(plan = {}) {
  const applied = Array.isArray(plan.apply) ? plan.apply : [];
  return {
    changed: applied.length,
    createdOrUpdated: applied.filter((record) => !record.deleted).length,
    deleted: applied.filter((record) => record.deleted).length,
    conflicts: Array.isArray(plan.conflicts) ? plan.conflicts.length : 0
  };
}
