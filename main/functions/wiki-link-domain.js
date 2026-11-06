import { modules, registerMainModule } from '../module-registry.js';
import { applyPisiWikiRename, applyPisiWikiRepair, getPisiWikiRenameImpact, previewPisiWikiRepair, readPisiWikiNode } from './wiki-link-store.js';

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

function getPisiWikiRenameImpactForPayload(payload = {}) {
    const safeNodePath = electronIpc.assertProjectPath(payload.nodePath, { type: 'file', extensions: ['.node'] });
    return getPisiWikiRenameImpact(getPisiWikiActiveProject(), safeNodePath, String(payload.newTitle || ''));
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
            const wikiLinks = applyPisiWikiRename(
                getPisiWikiActiveProject(),
                { nodeId: before.id, oldTitle: before.title, newTitle },
                { writeDocument: writePisiWikiDocument }
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
}

const moduleApi = {
    getPisiWikiRenameImpactForPayload,
    wrapPisiRenameWithWikiLinks,
    repairPisiWikiLinksForPayload,
    installPisiWikiLinkDomainContracts
};

registerMainModule('main.wikiLinkDomain', moduleApi);
installPisiWikiLinkDomainContracts();
