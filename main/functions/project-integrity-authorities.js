import * as fs from 'node:fs';
import * as path from 'node:path';
import { modules } from '../module-registry.js';
import * as shared from './project-integrity-shared.js';

const relationshipStore = modules['main.relationshipStore'];
const filesystemCore = modules['main.filesystemCore'];

function auditRelationships(projectFolder, context, inventory) {
    const storePath = relationshipStore.getPisiRelationshipStorePath(projectFolder);
    if (!fs.existsSync(storePath)) return { relationships: [], byId: new Map() };
    const read = shared.readJson(storePath);
    if (!read.ok || !read.data || !Array.isArray(read.data.relationships)) {
        shared.issue(
            context,
            {
                severity: 'critical',
                code: 'relationship-store-invalid',
                domain: 'relationships',
                path: shared.relativePath(projectFolder, storePath),
                message: `Canonical relationship store okunamıyor: ${read.error || 'relationships dizisi yok.'}`
            },
            {
                safety: 'manual',
                action: 'recover-relationship-store',
                description: 'relationships.json authority dosyasını yedek/recovery kaynaklarından kurtarın; map presentation verisini authority kabul etmeyin.'
            }
        );
        return { relationships: [], byId: new Map() };
    }

    const relationships = read.data.relationships.filter((item) => item && typeof item === 'object');
    const byId = new Map();
    const semanticKeys = new Map();
    const parentByChild = new Map();

    for (const relationship of relationships) {
        const relationshipId = String(relationship.id || '');
        if (!shared.integrityCore.validPisiIntegrityId('relationship', relationshipId)) {
            shared.issue(
                context,
                {
                    severity: 'error',
                    code: 'relationship-id-invalid',
                    domain: 'relationships',
                    path: '.pisi/relationships.json',
                    entityId: relationshipId,
                    message: `Semantic relationship ID geçersiz: ${relationshipId || '?'}`
                },
                {
                    safety: 'manual',
                    action: 'recover-relationship-id',
                    description: 'Relationship presentation view referanslarını bozmadan ID’yi manuel kurtarın.'
                }
            );
        } else if (byId.has(relationshipId)) {
            shared.issue(
                context,
                {
                    severity: 'critical',
                    code: 'relationship-duplicate-id',
                    domain: 'relationships',
                    path: '.pisi/relationships.json',
                    entityId: relationshipId,
                    message: `Canonical relationship store içinde duplicate ID: ${relationshipId}`
                },
                {
                    safety: 'manual',
                    action: 'resolve-duplicate-relationship-id',
                    description: 'Relationship ID ve map relationshipViews referanslarını birlikte düzeltin.'
                }
            );
        } else {
            byId.set(relationshipId, relationship);
        }

        for (const endpoint of ['sourceId', 'targetId']) {
            const nodeId = String(relationship[endpoint] || '');
            if (!inventory.nodeById.has(nodeId)) {
                shared.issue(
                    context,
                    {
                        severity: 'error',
                        code: 'relationship-endpoint-missing',
                        domain: 'relationships',
                        path: '.pisi/relationships.json',
                        entityId: relationshipId,
                        message: `Semantic ilişkinin ${endpoint} node'u bulunamadı: ${nodeId || '?'}`
                    },
                    {
                        safety: 'manual',
                        action: 'repair-relationship-endpoint',
                        description:
                            'Endpoint node’u Trash/yedekten kurtarın veya ilişkinin gerçekten orphan olduğuna karar verdikten sonra semantic store’dan kaldırın.'
                    }
                );
            }
        }

        const semanticKey = relationshipStore.getPisiRelationshipSemanticKey(relationship);
        if (semanticKey && semanticKeys.has(semanticKey) && semanticKeys.get(semanticKey) !== relationshipId) {
            shared.issue(
                context,
                {
                    severity: 'error',
                    code: 'relationship-semantic-duplicate',
                    domain: 'relationships',
                    path: '.pisi/relationships.json',
                    entityId: relationshipId,
                    message: `Aynı semantic ilişki farklı ID ile tekrar edilmiş: ${semanticKeys.get(semanticKey)}`
                },
                {
                    safety: 'manual',
                    action: 'merge-semantic-duplicates',
                    description: 'Canonical relationship kaydını seçip tüm map relationshipViews kimliklerini birlikte remap edin.'
                }
            );
        } else if (semanticKey) {
            semanticKeys.set(semanticKey, relationshipId);
        }

        if (!filesystemCore.isHierarchyEdge(relationship)) continue;
        const child = String(relationship.targetId || '');
        const parent = String(relationship.sourceId || '');
        if (parentByChild.has(child) && parentByChild.get(child) !== parent) {
            shared.issue(
                context,
                {
                    severity: 'error',
                    code: 'relationship-second-parent',
                    domain: 'relationships',
                    path: '.pisi/relationships.json',
                    entityId: relationshipId,
                    message: `Node birden fazla semantic parent'a sahip: ${child}`
                },
                {
                    safety: 'manual',
                    action: 'resolve-second-parent',
                    description: 'Hangi ilişkinin hierarchy, hangisinin stream olması gerektiğini kullanıcı niyetiyle belirleyin.'
                }
            );
            continue;
        }
        if (filesystemCore.wouldCreatePisiHierarchyCycle(parentByChild, parent, child)) {
            shared.issue(
                context,
                {
                    severity: 'critical',
                    code: 'relationship-hierarchy-cycle',
                    domain: 'relationships',
                    path: '.pisi/relationships.json',
                    entityId: relationshipId,
                    message: `Semantic hierarchy cycle tespit edildi: ${parent} → ${child}`
                },
                {
                    safety: 'manual',
                    action: 'resolve-hierarchy-cycle',
                    description: 'Döngüyü oluşturan ilişkinin hierarchy/stream anlamını manuel olarak düzeltin.'
                }
            );
        }
        parentByChild.set(child, parent);
    }
    return { relationships, byId };
}

export { auditRelationships };
