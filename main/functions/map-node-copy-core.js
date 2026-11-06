// Pure rules for copying a note into a map (main/functions/map-node-copy.js).

export const PISI_MAP_COPY_SUFFIX = ' (kopya)';

/** Task markup keeps its text and status but loses its canonical task id. */
export function stripPisiCopiedTaskIdentity(content = '') {
    return String(content || '').replace(/\sdata-pisi-task-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

export function makePisiCopyTitle(title) {
    const base = String(title || 'Node').trim() || 'Node';
    return base.endsWith(PISI_MAP_COPY_SUFFIX) ? base : `${base}${PISI_MAP_COPY_SUFFIX}`;
}
