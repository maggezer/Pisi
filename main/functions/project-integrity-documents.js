import * as fs from 'node:fs';
import * as path from 'node:path';
import { modules } from '../module-registry.js';
import * as shared from './project-integrity-shared.js';
import { collectPisiEditorAssetReferences } from './editor-asset-store.js';

const mapSemanticCore = modules['main.mapSemanticCore'];
const mapOperationalStore = modules['main.mapOperationalStore'];

const PROPERTY_TYPES = new Set(['text', 'number', 'multiselect', 'relation', 'rollup', 'date', 'select', 'node', 'checkbox']);

function collectDocumentInventory(projectFolder, context) {
    const files = shared.walkProjectDocuments(projectFolder);
    const docs = [];
    const nodeById = new Map();
    const mapById = new Map();
    const sidecarOwnerByDirectory = new Map();

    for (const filePath of files) {
        const storedPath = shared.relativePath(projectFolder, filePath);
        const type = path.extname(filePath).toLowerCase() === '.node' ? 'node' : 'map';
        const read = shared.readJson(filePath);
        if (!read.ok || !read.data || typeof read.data !== 'object' || Array.isArray(read.data)) {
            shared.issue(
                context,
                {
                    severity: 'critical',
                    code: 'document-invalid-json',
                    domain: 'documents',
                    path: storedPath,
                    message: `Pisi belgesi okunamıyor: ${read.error || 'Geçersiz JSON.'}`
                },
                {
                    safety: 'manual',
                    action: 'restore-document',
                    description: 'Belgeyi Version History, atomik yedek veya Trash üzerinden kurtarın.'
                }
            );
            continue;
        }

        const data = read.data;
        const metadata = data.pisi;
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            shared.issue(
                context,
                {
                    severity: 'error',
                    code: 'document-metadata-missing',
                    domain: 'documents',
                    path: storedPath,
                    message: 'Pisi metadata alanı eksik.'
                },
                {
                    safety: 'manual',
                    action: 'recover-document-metadata',
                    description: 'Yeni kimlik üretmeden önce eski kimlik ve referansları inceleyin.'
                }
            );
            docs.push({ filePath, storedPath, type, data, metadata: null, sidecarPath: null });
            continue;
        }

        const id = String(metadata.id || '');
        const idValid = shared.integrityCore.validPisiIntegrityId(type, id);
        if (!idValid) {
            shared.issue(
                context,
                {
                    severity: 'error',
                    code: 'document-id-invalid',
                    domain: 'documents',
                    path: storedPath,
                    entityId: id,
                    message: `${type} kimliği eksik veya geçersiz.`
                },
                {
                    safety: 'manual',
                    action: 'recover-document-id',
                    description: 'Yeni kimlik üretmek referansları koparabileceği için kimliği manuel kurtarın.'
                }
            );
        } else {
            const index = type === 'node' ? nodeById : mapById;
            if (index.has(id)) {
                shared.issue(
                    context,
                    {
                        severity: 'critical',
                        code: `${type}-duplicate-id`,
                        domain: 'documents',
                        path: storedPath,
                        entityId: id,
                        message: `Aynı ${type} kimliği başka belgede de kullanılıyor: ${index.get(id).storedPath}`
                    },
                    {
                        safety: 'manual',
                        action: 'resolve-duplicate-id',
                        description: 'Gerçek kimlik sahibini belirleyip tüm referansları birlikte güncelleyin.'
                    }
                );
            } else {
                index.set(id, { filePath, storedPath, type, data, metadata });
            }
        }

        if (metadata.type !== type) {
            shared.issue(
                context,
                {
                    severity: 'warning',
                    code: 'document-type-mismatch',
                    domain: 'documents',
                    path: storedPath,
                    entityId: id,
                    message: `Dosya uzantısı ${type}, metadata türü ${String(metadata.type || 'boş')}.`
                },
                idValid
                    ? {
                          safety: 'safe',
                          action: 'normalize-document-metadata',
                          description: 'Dosya uzantısını authority kabul ederek metadata türünü ve türetilmiş alanları normalize et.',
                          payload: { path: storedPath }
                      }
                    : null
            );
        }

        const sidecarName = String(metadata.sidecar || '');
        const sidecarPath = sidecarName ? path.join(path.dirname(filePath), sidecarName) : null;
        const sidecarExists = sidecarPath && fs.existsSync(sidecarPath) && fs.statSync(sidecarPath).isDirectory();
        if (sidecarExists) {
            sidecarOwnerByDirectory.set(shared.integrityCore.normalizePisiIntegrityComparePath(sidecarPath), { type, id, filePath, storedPath });
        } else if (idValid) {
            shared.issue(
                context,
                {
                    severity: 'warning',
                    code: 'document-sidecar-missing',
                    domain: 'documents',
                    path: storedPath,
                    entityId: id,
                    message: 'Belgenin yönetilen yan klasörü bulunamadı.'
                },
                {
                    safety: 'safe',
                    action: 'ensure-document-sidecar',
                    description: 'Mevcut kimliği koruyarak eksik yönetilen yan klasörü yeniden oluştur.',
                    payload: { path: storedPath }
                }
            );
        }

        if (type === 'map' && (!data.map || typeof data.map !== 'object' || Array.isArray(data.map))) {
            shared.issue(
                context,
                {
                    severity: 'error',
                    code: 'map-state-malformed',
                    domain: 'maps',
                    path: storedPath,
                    entityId: id,
                    message: 'Map state nesnesi eksik veya bozuk.'
                },
                {
                    safety: 'review',
                    action: 'rebuild-map-state',
                    description: 'Map state’i yeniden oluşturmadan önce mevcut payload ve referansları inceleyin.'
                }
            );
        }
        docs.push({ filePath, storedPath, type, data, metadata, sidecarPath: sidecarExists ? sidecarPath : null });
    }
    return { files, docs, nodeById, mapById, sidecarOwnerByDirectory };
}

function auditNodeProperties(context, doc) {
    if (doc.type !== 'node' || doc.data?.properties == null) return;
    const properties = doc.data.properties;
    if (typeof properties !== 'object') {
        shared.issue(
            context,
            {
                severity: 'warning',
                code: 'node-properties-malformed',
                domain: 'properties',
                path: doc.storedPath,
                entityId: doc.metadata?.id,
                message: 'Node properties nesnesi geçersiz.'
            },
            {
                safety: 'review',
                action: 'normalize-node-properties',
                description: 'Geçersiz property payloadını desteklenen property şemasına normalize et.'
            }
        );
        return;
    }
    const entries = Array.isArray(properties) ? properties : Object.values(properties);
    const invalid =
        entries.length > 250 ||
        entries.some((property) => {
            if (!property || typeof property !== 'object') return true;
            const type = String(property.type || '').toLowerCase();
            if (!PROPERTY_TYPES.has(type)) return true;
            return type === 'number' && property.value != null && property.value !== '' && !Number.isFinite(Number(property.value));
        });
    if (invalid) {
        shared.issue(
            context,
            {
                severity: 'warning',
                code: 'node-properties-invalid',
                domain: 'properties',
                path: doc.storedPath,
                entityId: doc.metadata?.id,
                message: 'Node içinde geçersiz veya eski property tipleri/değerleri bulundu.'
            },
            {
                safety: 'review',
                action: 'normalize-node-properties',
                description:
                    'Property verisini güncel text/number/tags/relation/rollup şemasına normalize et; kullanıcı değerleri değişebileceği için önce incele.'
            }
        );
    }
}

function auditAttachments(projectFolder, context, doc) {
    if (doc.type !== 'node' || typeof doc.data?.content !== 'string') return;
    const editorReferences = new Set(collectPisiEditorAssetReferences(doc.data.content));
    const references = new Set([...shared.extractLocalAttachmentCandidates(doc.data.content), ...editorReferences]);
    for (const reference of references) {
        const direct = path.resolve(path.dirname(doc.filePath), reference);
        const sidecar = doc.sidecarPath ? path.resolve(doc.sidecarPath, reference) : null;
        // Canvas/Sheet references are relative only to the owning node sidecar.
        // A same-named file beside the node must not mask a missing editor asset.
        const directExists =
            !editorReferences.has(reference) && shared.integrityCore.isPisiIntegrityPathInsideProject(projectFolder, direct) && fs.existsSync(direct);
        const sidecarExists =
            sidecar && shared.integrityCore.isPisiIntegrityPathInsideProject(projectFolder, sidecar) && fs.existsSync(sidecar) && fs.statSync(sidecar).isFile();
        if (!directExists && !sidecarExists) {
            shared.issue(
                context,
                {
                    severity: 'warning',
                    code: 'attachment-target-missing',
                    domain: 'attachments',
                    path: doc.storedPath,
                    entityId: doc.metadata?.id,
                    message: `Yerel ek hedefi bulunamadı: ${reference}`
                },
                {
                    safety: 'manual',
                    action: 'recover-attachment',
                    description: 'Eksik eki yedek/Trash üzerinden kurtarın veya belge bağlantısını bilinçli kaldırın.'
                }
            );
        }
    }
}

function resolveMapReference(projectFolder, reference) {
    if (!reference || typeof reference !== 'object') return null;
    const stored = shared.integrityCore.normalizePisiIntegrityPath(reference.path || '');
    if (!stored) return null;
    const target = path.resolve(projectFolder, ...stored.split('/'));
    if (!shared.integrityCore.isPisiIntegrityPathInsideProject(projectFolder, target)) return null;
    if (!fs.existsSync(target) || path.extname(target).toLowerCase() !== '.node') return null;
    const read = shared.readJson(target);
    if (!read.ok || read.data?.pisi?.type !== 'node') return null;
    if (reference.id && read.data.pisi.id !== reference.id) return null;
    return { path: target, id: read.data.pisi.id };
}

function collectMapMemberIds(projectFolder, doc, context) {
    const mapData = doc.data?.map || {};
    const known = new Set();
    if (doc.sidecarPath && fs.existsSync(doc.sidecarPath)) {
        for (const entry of fs.readdirSync(doc.sidecarPath, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.node')) continue;
            const read = shared.readJson(path.join(doc.sidecarPath, entry.name));
            if (read.ok && read.data?.pisi?.id) known.add(read.data.pisi.id);
        }
    }
    const refs = Array.isArray(mapData.references) ? mapData.references : [];
    if (mapData.references !== undefined && !Array.isArray(mapData.references)) {
        shared.issue(
            context,
            {
                severity: 'error',
                code: 'map-references-malformed',
                domain: 'maps',
                path: doc.storedPath,
                entityId: doc.metadata?.id,
                message: 'Map references alanı dizi değil.'
            },
            {
                safety: 'review',
                action: 'repair-map-references',
                description: 'Map üyelik referanslarını payload üzerinden inceleyip yeniden oluşturun.'
            }
        );
    }
    const seen = new Set();
    for (const ref of refs) {
        const resolved = resolveMapReference(projectFolder, ref);
        if (!resolved) {
            shared.issue(
                context,
                {
                    severity: 'error',
                    code: 'map-reference-broken',
                    domain: 'maps',
                    path: doc.storedPath,
                    entityId: ref?.id,
                    message: `Map node referansı çözümlenemedi: ${String(ref?.path || '?')}`
                },
                {
                    safety: 'review',
                    action: 'detach-broken-map-reference',
                    description: 'Hedef gerçekten kayıpsa map üyeliğinden ayır; restore ihtimali varsa önce hedefi kurtar.'
                }
            );
            continue;
        }
        known.add(resolved.id);
        if (seen.has(resolved.id)) {
            shared.issue(
                context,
                {
                    severity: 'warning',
                    code: 'map-reference-duplicate',
                    domain: 'maps',
                    path: doc.storedPath,
                    entityId: resolved.id,
                    message: `Aynı node map references içinde birden fazla kez geçiyor: ${resolved.id}`
                },
                {
                    safety: 'review',
                    action: 'dedupe-map-references',
                    description: 'Aynı node kimliğine ait yinelenen map üyelik referanslarını tekilleştir.'
                }
            );
        }
        seen.add(resolved.id);
    }
    return known;
}

function auditMapLayout(context, doc, known) {
    const mapData = doc.data.map;
    const layouts = Array.isArray(mapData.nodes) ? mapData.nodes : [];
    if (mapData.nodes !== undefined && !Array.isArray(mapData.nodes)) {
        shared.issue(
            context,
            {
                severity: 'error',
                code: 'map-layout-malformed',
                domain: 'maps',
                path: doc.storedPath,
                entityId: doc.metadata?.id,
                message: 'Map nodes/layout alanı dizi değil.'
            },
            {
                safety: 'review',
                action: 'rebuild-map-layout',
                description: 'Map üyeliğinden yeni layout oluşturmadan önce mevcut bozuk layout verisini inceleyin.'
            }
        );
    }
    const seen = new Set();
    for (const layout of layouts) {
        const nodeId = String(layout?.id || '');
        if (!known.has(nodeId)) {
            shared.issue(
                context,
                {
                    severity: 'warning',
                    code: 'map-layout-orphan',
                    domain: 'maps',
                    path: doc.storedPath,
                    entityId: nodeId,
                    message: `Layout kaydı map üyeliğinde olmayan node'a ait: ${nodeId || '?'}`
                },
                {
                    safety: 'review',
                    action: 'remove-orphan-layout',
                    description: 'Node gerçekten kayıpsa orphan layout kaydını kaldır; restore edilecekse layoutu koru.'
                }
            );
        }
        if (nodeId && seen.has(nodeId)) {
            shared.issue(
                context,
                {
                    severity: 'warning',
                    code: 'map-layout-duplicate',
                    domain: 'maps',
                    path: doc.storedPath,
                    entityId: nodeId,
                    message: `Aynı node için birden fazla layout kaydı var: ${nodeId}`
                },
                {
                    safety: 'review',
                    action: 'dedupe-map-layout',
                    description: 'Hangi yerleşimin korunacağını seçerek duplicate layout kayıtlarını tekilleştir.'
                }
            );
        }
        if (nodeId) seen.add(nodeId);
    }
}

function auditMapViews(context, doc, known, relationshipsById) {
    const mapData = doc.data.map;
    const views = Array.isArray(mapData.relationshipViews) ? mapData.relationshipViews : [];
    const normalized = mapSemanticCore.normalizePisiRelationshipViews(views);
    if (views.length !== normalized.length) {
        shared.issue(
            context,
            {
                severity: 'warning',
                code: 'map-relationship-views-malformed',
                domain: 'maps',
                path: doc.storedPath,
                entityId: doc.metadata?.id,
                message: 'Relationship view kayıtlarında geçersiz veya duplicate presentation girdileri var.'
            },
            {
                safety: 'review',
                action: 'normalize-relationship-views',
                description: 'Semantic authority değiştirmeden relationship view presentation kayıtlarını normalize et.'
            }
        );
    }
    for (const view of normalized) {
        const relationship = relationshipsById.get(view.relationshipId);
        if (!relationship) {
            shared.issue(
                context,
                {
                    severity: 'warning',
                    code: 'map-relationship-view-orphan',
                    domain: 'maps',
                    path: doc.storedPath,
                    entityId: view.relationshipId,
                    message: `Presentation kaydının canonical semantic ilişkisi yok: ${view.relationshipId}`
                },
                {
                    safety: 'review',
                    action: 'remove-orphan-relationship-view',
                    description: 'İlişki gerçekten silindiyse presentation kaydını kaldır; restore edilecekse görünümü koru.'
                }
            );
        } else if (!known.has(relationship.sourceId) || !known.has(relationship.targetId)) {
            shared.issue(
                context,
                {
                    severity: 'warning',
                    code: 'map-relationship-view-endpoint-outside-membership',
                    domain: 'maps',
                    path: doc.storedPath,
                    entityId: view.relationshipId,
                    message: 'Relationship view map içinde ancak semantic ilişkinin iki endpointi de map üyeliğinde değil.'
                },
                {
                    safety: 'review',
                    action: 'review-relationship-view-membership',
                    description: 'Map üyeliğini veya presentation view kaydını kullanıcı niyetine göre düzelt.'
                }
            );
        }
    }
}

function auditMaps(projectFolder, context, inventory, relationshipsById) {
    for (const doc of inventory.docs.filter((item) => item.type === 'map')) {
        if (!doc.data?.map || typeof doc.data.map !== 'object' || Array.isArray(doc.data.map)) continue;
        const known = collectMapMemberIds(projectFolder, doc, context);
        auditMapLayout(context, doc, known);
        auditMapViews(context, doc, known, relationshipsById);
        const mapData = doc.data.map;
        if (mapData.operational !== undefined) {
            const normalized = mapOperationalStore.normalizePisiOperationalMapState(mapData.operational);
            if (JSON.stringify(normalized) !== JSON.stringify(mapData.operational)) {
                shared.issue(
                    context,
                    {
                        severity: 'warning',
                        code: 'map-operational-state-stale',
                        domain: 'maps',
                        path: doc.storedPath,
                        entityId: doc.metadata?.id,
                        message: 'Map operational state güncel şemaya göre normalize değil.'
                    },
                    {
                        safety: 'safe',
                        action: 'normalize-map-operational-state',
                        description: 'Yalnız map-local filtre/scope/layout projection state’ini güncel operational şemaya normalize et.',
                        payload: { path: doc.storedPath }
                    }
                );
            }
        }
    }
}

function auditNodeParentMap(context, inventory) {
    for (const [nodeId, doc] of inventory.nodeById) {
        const parentMap = String(doc.metadata?.parentMap || 'none');
        if (parentMap !== 'none' && parentMap !== 'diary' && !inventory.mapById.has(parentMap)) {
            shared.issue(
                context,
                {
                    severity: 'error',
                    code: 'node-parent-map-missing',
                    domain: 'documents',
                    path: doc.storedPath,
                    entityId: nodeId,
                    message: `Node parentMap kimliği mevcut bir map'e ait değil: ${parentMap}`
                },
                {
                    safety: 'manual',
                    action: 'repair-node-parent-map',
                    description: 'Node’un gerçek parent map’ini fiziksel sidecar/map üyeliği ve semantic yapı üzerinden belirleyin.'
                }
            );
        }
        const owner = inventory.sidecarOwnerByDirectory.get(shared.integrityCore.normalizePisiIntegrityComparePath(path.dirname(doc.filePath)));
        if (owner?.type === 'map' && owner.id && parentMap !== owner.id) {
            shared.issue(
                context,
                {
                    severity: 'warning',
                    code: 'node-parent-map-mismatch',
                    domain: 'documents',
                    path: doc.storedPath,
                    entityId: nodeId,
                    message: `Node fiziksel olarak ${owner.id} sidecarında ancak parentMap=${parentMap}.`
                },
                {
                    safety: 'review',
                    action: 'align-node-parent-map',
                    description: 'Fiziksel map sidecar sahipliği doğruysa node parentMap metadata’sını map kimliğiyle hizala.'
                }
            );
        }
    }
}

function auditDocumentsAndMaps(projectFolder, context, relationships) {
    const inventory = collectDocumentInventory(projectFolder, context);
    for (const doc of inventory.docs) {
        auditNodeProperties(context, doc);
        auditAttachments(projectFolder, context, doc);
    }
    const relationshipsById = new Map((Array.isArray(relationships) ? relationships : []).filter((item) => item?.id).map((item) => [item.id, item]));
    auditMaps(projectFolder, context, inventory, relationshipsById);
    auditNodeParentMap(context, inventory);
    return inventory;
}

export { collectDocumentInventory, auditNodeProperties, auditAttachments, resolveMapReference, auditMaps, auditNodeParentMap, auditDocumentsAndMaps };
