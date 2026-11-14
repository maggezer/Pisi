// JSON skeleton of a new .node or .map document (pisi-definition.md). Desktop
// and mobile create documents through this one function so new files have the
// same fields in the same order.

import { getPisiSidecarName, getPisiTypeFromExt } from './document-naming.mjs';

/**
 * `now` is the ISO timestamp written to createdAt and updatedAt; the caller
 * reads the clock.
 */
function makePisiDocumentData({ ext, title, id, parentMap = 'none', now }) {
    const type = getPisiTypeFromExt(ext);
    const sidecar = getPisiSidecarName(title, ext, id);

    const base = {
        pisi: {
            version: 1,
            type,
            id,
            title,
            sidecar,
            createdAt: now,
            updatedAt: now
        }
    };

    if (ext === '.node') {
        base.pisi.parentMap = parentMap || 'none';

        return {
            ...base,
            content: ''
        };
    }

    if (ext === '.map') {
        return {
            ...base,
            map: {
                nodes: [],
                relationshipViews: [],
                relationshipViewVersion: 1,
                collapsedHubs: [],
                camera: { x: 0, y: 0, zoom: 1 }
            }
        };
    }

    return base;
}

export { makePisiDocumentData };
