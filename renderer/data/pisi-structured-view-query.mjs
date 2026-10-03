import { collectPisiPropertyColumns, filterPisiPropertyDocuments, materializePisiDatabaseDocuments } from './pisi-properties-core.mjs';
import { getPisiMapNodeLabel } from './pisi-structured-view-helpers.mjs';

function makePisiMapDatabaseDocuments(context) {
    return (context?.nodes || []).map((node) => ({
        ...node,
        path: node.fullPath,
        relativePath: node.fileName || node.fullPath,
        title: getPisiMapNodeLabel(node),
        nodeItem: {
            ...node,
            name: node.fileName,
            type: 'file',
            isFile: true,
            isDirectory: false,
            mapPath: context.mapPath
        },
        memberships: context.mapPath ? [{ mapPath: context.mapPath }] : []
    }));
}

function materializePisiStructuredDocuments(context) {
    return materializePisiDatabaseDocuments(makePisiMapDatabaseDocuments(context));
}

function filterAndSortPisiStructuredDocuments(documents, query = '') {
    return filterPisiPropertyDocuments(documents, query);
}

function collectPisiStructuredPropertyColumns(documents) {
    return collectPisiPropertyColumns(documents);
}

export { collectPisiStructuredPropertyColumns, filterAndSortPisiStructuredDocuments, makePisiMapDatabaseDocuments, materializePisiStructuredDocuments };
