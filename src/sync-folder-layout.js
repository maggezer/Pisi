export const SYNC_DIRECTORY_NAME = '.pisi-sync';
export const SYNC_LAYOUT_DIRECT = 'direct';
export const SYNC_LAYOUT_NESTED = 'nested';

const MANIFEST_STATES = new Set(['missing', 'valid', 'invalid']);

export function isSyncProtocolDirectory(folderName = '') {
  return String(folderName).trim().toLocaleLowerCase('en-US') === SYNC_DIRECTORY_NAME;
}

export function makeSyncPaths(mode = SYNC_LAYOUT_NESTED) {
  if (![SYNC_LAYOUT_DIRECT, SYNC_LAYOUT_NESTED].includes(mode)) {
    throw new TypeError(`Bilinmeyen Sync klasör düzeni: ${mode}`);
  }
  const prefix = mode === SYNC_LAYOUT_DIRECT ? '' : SYNC_DIRECTORY_NAME;
  const resolve = (relativePath = '') => {
    const relative = String(relativePath).replace(/^\/+|\/+$/g, '');
    if (!relative) return prefix;
    return prefix ? `${prefix}/${relative}` : relative;
  };
  return {
    mode,
    prefix,
    manifest: resolve('manifest.json'),
    devices: resolve('devices'),
    resolve
  };
}

export function chooseSyncLayout({
  folderName = '',
  direct = 'missing',
  nested = 'missing',
  previousMode = null
} = {}) {
  if (!MANIFEST_STATES.has(direct) || !MANIFEST_STATES.has(nested)) {
    throw new TypeError('Sync manifest durumu geçersiz.');
  }

  const namedProtocolDirectory = isSyncProtocolDirectory(folderName);
  const preferred = namedProtocolDirectory
    ? SYNC_LAYOUT_DIRECT
    : previousMode === SYNC_LAYOUT_DIRECT && !folderName
      ? SYNC_LAYOUT_DIRECT
      : SYNC_LAYOUT_NESTED;
  const alternate = preferred === SYNC_LAYOUT_DIRECT
    ? SYNC_LAYOUT_NESTED
    : SYNC_LAYOUT_DIRECT;
  const states = {
    [SYNC_LAYOUT_DIRECT]: direct,
    [SYNC_LAYOUT_NESTED]: nested
  };

  let mode = preferred;
  if (states[preferred] !== 'valid' && states[alternate] === 'valid') mode = alternate;

  return {
    mode,
    preferred,
    selectedState: states[mode],
    duplicateProjects: direct === 'valid' && nested === 'valid',
    recoveredAlternate: mode !== preferred,
    namedProtocolDirectory
  };
}

export function formatSyncStoragePath(folderName = '', mode = SYNC_LAYOUT_NESTED) {
  const name = String(folderName || 'Pisi Sync');
  return mode === SYNC_LAYOUT_DIRECT ? name : `${name}/${SYNC_DIRECTORY_NAME}`;
}
