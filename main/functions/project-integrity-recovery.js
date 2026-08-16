'use strict';

const fs = require('fs');
const path = require('path');
const { modules } = require('../module-registry');
const shared = require('./project-integrity-shared');
const atomicCore = require('./atomic-mutation-core');

const trashStore = modules['main.trashStore'];

function auditTrash(projectFolder, context) {
    const itemsRoot = trashStore.getPisiTrashItemsRoot(projectFolder);
    if (!fs.existsSync(itemsRoot)) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(itemsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        count += 1;
        const itemPath = path.join(itemsRoot, entry.name);
        const result = trashStore.readPisiTrashManifest(projectFolder, entry.name);
        if (!result.ok) {
            shared.issue(context, {
                severity: 'error', code: 'trash-manifest-invalid', domain: 'trash',
                path: shared.relativePath(projectFolder, itemPath), entityId: entry.name,
                message: `Trash manifest okunamıyor: ${result.error}`
            }, {
                safety: 'manual', action: 'inspect-trash-item',
                description: 'Payloadı silmeden önce manifest ve payloadı manuel inceleyin; invalid Trash item otomatik temizlenmez.'
            });
            continue;
        }

        const manifest = result.manifest;
        const seenDestinations = new Set();
        for (const item of manifest.entries || []) {
            const originalPath = shared.integrityCore.normalizePisiIntegrityPath(item.originalPath || '');
            const compare = shared.integrityCore.normalizePisiIntegrityComparePath(originalPath);
            if (!originalPath || seenDestinations.has(compare)) {
                shared.issue(context, {
                    severity: 'error', code: 'trash-duplicate-restore-destination', domain: 'trash',
                    path: shared.relativePath(projectFolder, itemPath), entityId: manifest.id,
                    message: `Trash restore destination duplicate/geçersiz: ${originalPath || '?'}`
                }, {
                    safety: 'manual', action: 'repair-trash-manifest',
                    description: 'Duplicate destination kayıtlarını payload ile eşleştirerek manuel düzeltin.'
                });
            }
            seenDestinations.add(compare);

            const payloadPath = shared.integrityCore.normalizePisiIntegrityPath(item.payloadPath || '');
            const payload = path.resolve(itemPath, ...payloadPath.split('/'));
            const payloadValid = payloadPath.startsWith('payload/')
                && shared.integrityCore.isPisiIntegrityPathInsideProject(itemPath, payload)
                && fs.existsSync(payload);
            if (!payloadValid) {
                shared.issue(context, {
                    severity: 'critical', code: 'trash-payload-missing', domain: 'trash',
                    path: shared.relativePath(projectFolder, itemPath), entityId: manifest.id,
                    message: `Trash payload bulunamadı veya item dışına çıkıyor: ${payloadPath || '?'}`
                }, {
                    safety: 'manual', action: 'recover-trash-payload',
                    description: 'Trash item’i silmeden önce kayıp payloadı yedeklerden kurtarın.'
                });
            }
        }

        for (const [kind, values] of [['node', manifest.nodeIds], ['map', manifest.mapIds]]) {
            const seen = new Set();
            for (const id of Array.isArray(values) ? values : []) {
                if (!shared.integrityCore.validPisiIntegrityId(kind, id) || seen.has(id)) {
                    shared.issue(context, {
                        severity: 'error', code: 'trash-identity-invalid', domain: 'trash',
                        path: shared.relativePath(projectFolder, itemPath), entityId: manifest.id,
                        message: `Trash manifest ${kind} identity listesi geçersiz/duplicate: ${String(id)}`
                    }, {
                        safety: 'manual', action: 'repair-trash-identities',
                        description: 'Manifest identity listesini payload içindeki gerçek Pisi metadata ile doğrulayın.'
                    });
                }
                seen.add(id);
            }
        }
    }
    return count;
}

function auditAtomic(projectFolder, context) {
    const mutationRoot = atomicCore.getAtomicMutationRoot(projectFolder);
    if (!fs.existsSync(mutationRoot)) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(mutationRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('mut_')) continue;
        count += 1;
        const directoryPath = path.join(mutationRoot, entry.name);
        let manifest = null;
        try {
            manifest = atomicCore.readAtomicManifest(directoryPath);
        } catch (error) {
            shared.issue(context, {
                severity: 'critical', code: 'atomic-manifest-invalid', domain: 'recovery',
                path: shared.relativePath(projectFolder, directoryPath), entityId: entry.name,
                message: `Atomic mutation journal okunamıyor: ${error.message}`
            }, {
                safety: 'manual', action: 'inspect-atomic-journal',
                description: 'Journal/snapshot verisini silmeden önce manuel inceleyin; recovery güvenli karar veremiyor.'
            });
            continue;
        }

        if (manifest.phase === 'committed') {
            shared.issue(context, {
                severity: 'warning', code: 'atomic-committed-cleanup-pending', domain: 'recovery',
                path: shared.relativePath(projectFolder, directoryPath), entityId: manifest.id,
                message: 'Committed atomic journal cleanup bekliyor.'
            }, {
                safety: 'review', action: 'retry-atomic-recovery',
                description: 'Project Integrity bulk repairinin dışında, recovery gate üzerinden committed cleanup’ı yeniden deneyin.'
            });
        } else if (manifest.phase === 'rollback-failed') {
            shared.issue(context, {
                severity: 'critical', code: 'atomic-rollback-failed', domain: 'recovery',
                path: shared.relativePath(projectFolder, directoryPath), entityId: manifest.id,
                message: `Atomic rollback başarısız kalmış: ${(manifest.rollbackErrors || []).join(' | ') || 'detay yok'}`
            }, {
                safety: 'manual', action: 'inspect-atomic-journal',
                description: 'Snapshotları doğrulayıp recovery işlemini journal bütünlüğü incelendikten sonra tekrar çalıştırın.'
            });
        } else {
            shared.issue(context, {
                severity: 'error', code: 'atomic-recovery-pending', domain: 'recovery',
                path: shared.relativePath(projectFolder, directoryPath), entityId: manifest.id,
                message: `Tamamlanmamış atomic mutation bulundu: ${String(manifest.phase || '?')}`
            }, {
                safety: 'review', action: 'retry-atomic-recovery',
                description: 'Project Integrity transaction’ı içine nested recovery sokmadan startup/domain recovery gate’ini yeniden çalıştırın.'
            });
        }
    }
    return count;
}

module.exports = {
    auditTrash,
    auditAtomic
};