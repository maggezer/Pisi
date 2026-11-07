import { modules, registerMainModule } from '../module-registry.js';
import {
    applyPisiWikiRename,
    applyPisiWikiRepair,
    getPisiWikiRenameImpact,
    getPisiWikiRenameImpactAsync,
    previewPisiWikiRepair,
    readPisiWikiNode
} from './wiki-link-store.js';

const domain = modules['main.domainCommandQuery'];
const electronIpc = modules['main.electronIpc'];
const filesystemCore = modules['main.filesystemCore'];

function getPisiWikiActiveProject(projectFolder) {
    const safeProjectFolder = electronIpc.assertProjectPath(projectFolder || globalThis.activeProjectFolder, { type: 'directory' });
    if (electronIpc.normalizePathForCompare(safeProjectFolder) !== electronIpc.normalizePathForCompare(globalThis.activeProjectFolder)) {
        throw new Error('Bağlantı işlemi yalnız aktif projede çalışabilir.');
    }
    return safeProjectFolder;
}

function writePisiWikiDocument(filePath, data) {
    filesystemCore.writePisiDocument(filePath, data);
}

/** Every note's title and the notes that may link to `nodeId`, read by the project read worker. */
function scanPisiWikiRenameCandidates(projectFolder, nodeId) {
    return modules['main.projectRead'].runPisiProjectRead('wikiRenameCandidates', { root: projectFolder, options: { nodeId } });
}

async function readPisiWikiCandidatesAsync(paths) {
    const read = await modules['main.projectRead'].readPisiJsonFilesBatched([...new Set(paths)].sort());
    return [...read.values()]
        .filter((result) => result.ok && result.data && typeof result.data === 'object' && typeof result.data.content === 'string')
        .map((result) => ({ filePath: result.path, data: result.data, id: result.data.pisi?.id || null, title: String(result.data.pisi?.title || '') }));
}

function getPisiWikiRenameImpactForPayload(payload = {}) {
    const safeNodePath = electronIpc.assertProjectPath(payload.nodePath, { type: 'file', extensions: ['.node'] });
    const projectFolder = getPisiWikiActiveProject();
    if (!modules['main.projectRead']) return getPisiWikiRenameImpact(projectFolder, safeNodePath, String(payload.newTitle || ''));
    return getPisiWikiRenameImpactAsync(projectFolder, safeNodePath, String(payload.newTitle || ''), {
        scan: (nodeId) => scanPisiWikiRenameCandidates(projectFolder, nodeId),
        readCandidates: readPisiWikiCandidatesAsync
    });
}

// Before the rename's atomic mutation: find, asynchronously, which notes can
// hold a link to the note (its id or legacy [[…]] text) and every note's
// title. Inside the mutation only those notes are read again and rewritten.
// A note that gains a link between this scan and the mutation is not updated
// by this rename (docs/storage-abstraction.md).
async function preparePisiRenameWikiLinks(payload = {}) {
    if (!modules['main.projectRead']) return null;
    const safeOldPath = electronIpc.assertProjectPath(payload.oldPath, { type: 'file', extensions: ['.map', '.node'] });
    if (!safeOldPath.toLowerCase().endsWith('.node')) return null;
    const before = readPisiWikiNode(safeOldPath);
    if (!before?.id) return null;
    const scan = await scanPisiWikiRenameCandidates(getPisiWikiActiveProject(), before.id);
    return { nodeId: before.id, titles: scan.titles, candidates: scan.candidates };
}

// project.item.rename.v1 already runs inside the project atomic mutation. The
// link rewrite joins the same transaction: a failure returns ok:false, which
// rolls back the file move, the sidecar and every note written so far.
function wrapPisiRenameWithWikiLinks(renameHandler) {
    return (payload = {}) => {
        const safeOldPath = electronIpc.assertProjectPath(payload.oldPath, { type: 'file', extensions: ['.map', '.node'] });
        const before = safeOldPath.toLowerCase().endsWith('.node') ? readPisiWikiNode(safeOldPath) : null;
        const result = renameHandler(payload);
        const newTitle = String(result?.metadata?.title || '');
        if (!result?.ok || !before?.id || !newTitle || newTitle === before.title) return result;
        try {
            const scanned = domain.getPisiDomainCommandPrepared?.(payload);
            // The renamed note itself has a new path now; it is read again too.
            const prepared = scanned?.nodeId === before.id ? { ...scanned, candidates: [...scanned.candidates, result.fullPath].filter(Boolean) } : null;
            const wikiLinks = applyPisiWikiRename(
                getPisiWikiActiveProject(),
                { nodeId: before.id, oldTitle: before.title, newTitle },
                { writeDocument: writePisiWikiDocument, prepared }
            );
            return { ...result, wikiLinks: { ...wikiLinks, nodeId: before.id, oldTitle: before.title, newTitle } };
        } catch (error) {
            return { ...result, ok: false, code: 'WIKI_LINK_REWRITE_FAILED', error: `Not bağlantıları güncellenemedi: ${error.message}` };
        }
    };
}

// Registered as an atomic domain command: all repaired notes commit together.
function repairPisiWikiLinksForPayload(payload = {}) {
    return applyPisiWikiRepair(getPisiWikiActiveProject(payload.projectFolder), { writeDocument: writePisiWikiDocument });
}

function installPisiWikiLinkDomainContracts() {
    domain.registerPisiDomainQuery('links.rename-impact.v1', getPisiWikiRenameImpactForPayload);
    domain.registerPisiDomainQuery('links.repair-preview.v1', (payload = {}) => previewPisiWikiRepair(getPisiWikiActiveProject(payload.projectFolder)));
    domain.registerPisiDomainCommand('links.repair.v1', repairPisiWikiLinksForPayload);
    domain.PISI_ATOMIC_DOMAIN_COMMANDS.add('links.repair.v1');
    const renameHandler = domain.pisiDomainCommands.get('project.item.rename.v1');
    if (typeof renameHandler !== 'function') throw new Error('project.item.rename.v1 bulunamadı.');
    domain.pisiDomainCommands.set('project.item.rename.v1', wrapPisiRenameWithWikiLinks(renameHandler));
    domain.registerPisiDomainCommandPreparer?.('project.item.rename.v1', preparePisiRenameWikiLinks);
}

const moduleApi = {
    getPisiWikiRenameImpactForPayload,
    wrapPisiRenameWithWikiLinks,
    repairPisiWikiLinksForPayload,
    installPisiWikiLinkDomainContracts
};

registerMainModule('main.wikiLinkDomain', moduleApi);
installPisiWikiLinkDomainContracts();
