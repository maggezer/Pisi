import { registerMainModule } from '../module-registry.js';
import { createUniquePisiFile, ensurePisiSidecar } from './document-store-io.js';
import { ensurePisiFileMetadata, makePisiDiaryNodeTitle, normalizePisiDiaryIsoDate } from './document-store-metadata.js';
import {
    buildPisiDiaryManagedSection,
    ensurePisiDiaryFolder,
    escapeHtmlForPisiDiary,
    getOrCreateDiaryNode,
    getPisiDiaryNodePath,
    listPisiDiaryDates,
    listPisiDiaryNodePaths,
    normalizePisiDiarySyncEntry,
    sanitizePisiDiaryBlockHtml,
    stripPisiDiaryManagedSection,
    syncDiaryMissions,
    organizeDiaryManualTasks
} from './document-store-diary.js';
import { createNodeUnderMap, renamePisiFile } from './document-store-mutations.js';

const moduleApi = {};
Object.defineProperties(moduleApi, {
    ensurePisiSidecar: { enumerable: true, get: () => ensurePisiSidecar },
    ensurePisiFileMetadata: { enumerable: true, get: () => ensurePisiFileMetadata },
    createUniquePisiFile: { enumerable: true, get: () => createUniquePisiFile },
    normalizePisiDiaryIsoDate: { enumerable: true, get: () => normalizePisiDiaryIsoDate },
    ensurePisiDiaryFolder: { enumerable: true, get: () => ensurePisiDiaryFolder },
    makePisiDiaryNodeTitle: { enumerable: true, get: () => makePisiDiaryNodeTitle },
    getPisiDiaryNodePath: { enumerable: true, get: () => getPisiDiaryNodePath },
    getOrCreateDiaryNode: { enumerable: true, get: () => getOrCreateDiaryNode },
    stripPisiDiaryManagedSection: { enumerable: true, get: () => stripPisiDiaryManagedSection },
    escapeHtmlForPisiDiary: { enumerable: true, get: () => escapeHtmlForPisiDiary },
    sanitizePisiDiaryBlockHtml: { enumerable: true, get: () => sanitizePisiDiaryBlockHtml },
    normalizePisiDiarySyncEntry: { enumerable: true, get: () => normalizePisiDiarySyncEntry },
    buildPisiDiaryManagedSection: { enumerable: true, get: () => buildPisiDiaryManagedSection },
    listPisiDiaryNodePaths: { enumerable: true, get: () => listPisiDiaryNodePaths },
    listPisiDiaryDates: { enumerable: true, get: () => listPisiDiaryDates },
    syncDiaryMissions: { enumerable: true, get: () => syncDiaryMissions },
    organizeDiaryManualTasks: { enumerable: true, get: () => organizeDiaryManualTasks },
    createNodeUnderMap: { enumerable: true, get: () => createNodeUnderMap },
    renamePisiFile: { enumerable: true, get: () => renamePisiFile }
});
registerMainModule('main.documentStore', moduleApi);
