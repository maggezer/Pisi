'use strict';

const fs = require('fs');
const path = require('path');
const { modules, registerMainModule } = require('../module-registry');
const integrityCore = require('./project-integrity-core');
const atomicCore = require('./atomic-mutation-core');

const filesystemCore = modules['main.filesystemCore'];
const documentStore = modules['main.documentStore'];
const taskStore = modules['main.taskStore'];
const relationshipStore = modules['main.relationshipStore'];
const mapSemanticCore = modules['main.mapSemanticCore'];
const mapOperationalStore = modules['main.mapOperationalStore'];
const structuredNodes = modules['main.structuredNodes'];
const atomicMutation = modules['main.atomicMutation'];
const trashStore = modules['main.trashStore'];

const PISI_PROPERTY_TYPES = new Set([
    'text', 'number', 'multiselect', 'relation', 'rollup',
    'date', 'select', 'node', 'checkbox'
]);
const PISI_TASK_STATUSES = new Set(['todo', 'doing', 'waiting', 'blocked', 'done']);
const PISI_MAP_SKIP_DIRS = new Set([
    '.git', 'node_modules', '.pisi', '.pisi-history'
]);
const PISI_LOCAL_ATTACHMENT_EXT = /\.(?:png|jpe?g|gif|webp|svg|pdf|docx?|xlsx?|csv|txt|zip|json)$/i;

function relativeIntegrityPath(projectFolder, targetPath) {
    return integrityCore.normalizePisiIntegrityPath(
        path.relative(path.resolve(projectFolder), path.resolve(targetPath))
    );
}

function getIntegrityAbsolutePath(projectFolder, storedPath) {
    const target = path.resolve(
        projectFolder,
        ...integrityCore.normalizePisiIntegrityPath(storedPath).split('/').filter(Boolean)
    );
    if (!integrityCore.isPisiIntegrityPathInsideProject(projectFolder, target)) {
        throw new Error('Integrity repair yolu proje dışına çıkamaz.');
    }
    return target;
}

function readIntegrityJson(filePath) {
    if (!fs.existsSync(filePath)) {
        return { ok: false, missing: true, error: 'Dosya bulunamadı.' };
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return { ok: true, raw, data: JSON.parse(raw) };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function walkIntegrityProjectDocuments(projectFolder) {
    const files = [];
    const queue = [path.resolve(projectFolder)];
    while (queue.length) {
        const current = queue.shift();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink?.()) continue;
            if (entry.isDirectory() && PISI_MAP_SKIP_DIRS.has(entry.name)) continue;
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }
            if (entry.isFile() && /\.(?:node|map)$/i.test(entry.name)) {
                files.push(fullPath);
                if (files.length >= 50000) return files;
            }
        }
    }
    return files;
}

function makeRepair(issue, safety, action, description, payload = {}) {
    issue.repair = {
        id: integrityCore.makePisiIntegrityIssueId([
            'repair', issue.code, issue.path, issue.entityId || '', action
        ]),
        safety,
        action,
        description,
        payload
    };
    return issue;
}

function pushIssue(context, raw) {
    const issue = integrityCore.makePisiIntegrityIssue(raw);
    context.issues.push(issue);
    return issue;
}

function collectPisiDocumentInventory(projectFolder, context) {
    const files = walkIntegrityProjectDocuments(projectFolder);
    const docs = [];
    const nodeById = new Map();
    const mapById = new Map();
    const sidecarOwnerByDirectory = new Map();

    for (const filePath of files) {
        const storedPath = relativeIntegrityPath(projectFolder, filePath);
        const ext = path.extname(filePath).toLowerCase();
        const type = ext === '.node' ? 'node' : 'map';
        const raw = readIntegrityJson(filePath);
        if (!raw.ok || !raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) {
            pushIssue(context, {
                severity: 'critical',
                code: 'document-invalid-json',
                domain: 'documents',
                path: storedPath,
                message: `Pisi belgesi okunamıyor: ${raw.error || 'Geçersiz JSON.'}`,
                repair: {
                    safety: 'manual',
                    action: 'restore-document',
                    description: 'Belgeyi Version History, atomik yedek veya Trash üzerinden kurtarın.'
                }
            });
            continue;
        }

        const data = raw.data;
        const metadata = data.pisi;
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            pushIssue(context, {
                severity: 'error',
                code: 'document-metadata-missing',
                domain: 'documents',
                path: storedPath,
                message: 'Pisi metadata alanı eksik.',
                repair: {
                    safety: 'manual',
                    action: 'recover-document-metadata',
                    description: 'Kimlik üretmeden önce belgenin eski kimlik ve referanslarını inceleyin.'
                }
            });
            docs.push({ filePath, storedPath, type, data, metadata: null });
            continue;
        }

        const id = String(metadata.id || '');
        if (!integrityCore.validPisiIntegrityId(type, id)) {
            pushIssue(context, {
                severity: 'error',
                code: 'document-id-invalid',
                domain: 'documents',
                path: storedPath,
                entityId: id,
                message: `${type} kimliği eksik veya geçersiz.`,
                repair: {
                    safety: 'manual',
                    action: 'recover-document-id',
                    description: 'Yeni kimlik üretmek referansları koparabileceği için kimliği manuel olarak kurtarın.'
                }
            });
        } else {
            const index = type === 'node' ? nodeById : mapById;
            if (index.has(id)) {
                pushIssue(context, {
                    severity: 'critical',
                    code: `${type}-duplicate-id`,
                    domain: 'documents',
                    path: storedPath,
                    entityId: id,
                    message: `Aynı ${type} kimliği başka bir belgede de kullanılıyor: ${index.get(id).storedPath}`,
                    repair: {
                        safety: 'manual',
                        action: 'resolve-duplicate-id',
                        description: 'Hangi belgenin gerçek kimlik sahibi olduğunu belirleyip tüm referansları birlikte güncelleyin.'
                    }
                });
            } else {
                index.set(id, { filePath, storedPath, data, metadata, type });
            }
        }

        if (metadata.type !== type) {
            const issue = pushIssue(context, {
                severity: 'warning',
                code: 'document-type-mismatch',
                domain: 'documents',
                path: storedPath,
                entityId: id,
                message: `Dosya uzantısı ${type}, metadata türü ${String(metadata.type || 'boş')}.`
            });
            if (integrityCore.validPisiIntegrityId(type, id)) {
                makeRepair(
                    issue,
                    'safe',
                    'normalize-document-metadata',
                    'Dosya uzantısını authority kabul ederek metadata türünü ve türetilmiş alanları normalize et.',
                    { path: storedPath }
                );
            }
        }

        if (Object.prototype.hasOwnProperty.call(data, 'kedi') || !metadata.version) {
            const issue = pushIssue(context, {
                severity: 'warning',
                code: 'document-migration-incomplete',
                domain: 'migration',
                path: storedPath,
                entityId: id,
                message: 'Belgede tamamlanmamış legacy metadata/migration alanları var.'
            });
            if (integrityCore.validPisiIntegrityId(type, id)) {
                makeRepair(
                    issue,
                    'safe',
                    'normalize-document-metadata',
                    'Mevcut kimliği koruyarak legacy metadata alanlarını güncel Pisi şemasına taşı.',
                    { path: storedPath }
                );
            }
        }

        const sidecarName = String(metadata.sidecar || '');
        const sidecarPath = sidecarName ? path.join(path.dirname(filePath), sidecarName) : null;
        if (sidecarPath && fs.existsSync(sidecarPath) && fs.statSync(sidecarPath).isDirectory()) {
            sidecarOwnerByDirectory.set(
                integrityCore.normalizePisiIntegrityComparePath(sidecarPath),
                { type, id, filePath, storedPath }
            );
        } else if (integrityCore.validPisiIntegrityId(type, id)) {
            const issue = pushIssue(context, {
                severity: 'warning',
                code: 'document-sidecar-missing',
                domain: 'documents',
                path: storedPath,
                entityId: id,
                message: 'Belgenin yönetilen yan klasörü bulunamadı.'
            });
            makeRepair(
                issue,
                'safe',
                'ensure-document-sidecar',
                'Mevcut kimliği koruyarak eksik yönetilen yan klasörü yeniden oluştur.',
                { path: storedPath }
            );
        }

        if (type === 'map' && (!data.map || typeof data.map !== 'object' || Array.isArray(data.map))) {
            pushIssue(context, {
                severity: 'error',
                code: 'map-state-malformed',
                domain: 'maps',
                path: storedPath,
                entityId: id,
                message: 'Map state nesnesi eksik veya bozuk.',
                repair: {
                    safety: 'review',
                    action: 'rebuild-map-state',
                    description: 'Map state’i yeniden oluşturmadan önce mevcut payload ve referansları inceleyin.'
                }
            });
        }

        docs.push({ filePath, storedPath, type, data, metadata, sidecarPath });
    }

    return { files, docs, nodeById, mapById, sidecarOwnerByDirectory };
}

function auditPisiNodeProperties(projectFolder, context, doc) {
    if (doc.type !== 'node' || !doc.data) return;
    const properties = doc.data.properties;
    if (properties === undefined || properties === null) return;
    if (typeof properties !== 'object') {
        const issue = pushIssue(context, {
            severity: 'warning',
            code: 'node-properties-malformed',
            domain: 'properties',
            path: doc.storedPath,
            entityId: doc.metadata?.id,
            message: 'Node properties nesnesi geçersiz.'
        });
        makeRepair(
            issue,
            'review',
            'normalize-node-properties',
            'Geçersiz property payloadını desteklenen property şemasına normalize et.',
            { path: doc.storedPath }
        );
        return;
    }

    const entries = Array.isArray(properties)
        ? properties
        : Object.values(properties);
    let invalid = false;
    for (const property of entries.slice(0, 500)) {
        if (!property || typeof property !== 'object') {
            invalid = true;
            continue;
        }
        if (!PISI_PROPERTY_TYPES.has(String(property.type || '').toLowerCase())) {
            invalid = true;
        }
        if (
            String(property.type || '').toLowerCase() === 'number' &&
            property.value !== null &&
            property.value !== '' &&
            !Number.isFinite(Number(property.value))
        ) {
            invalid = true;
        }
    }
    if (entries.length > 250) invalid = true;
    if (!invalid) return;

    const issue = pushIssue(context, {
        severity: 'warning',
        code: 'node-properties-invalid',
        domain: 'properties',
        path: doc.storedPath,
        entityId: doc.metadata?.id,
        message: 'Node içinde geçersiz veya eski property tipleri/değerleri bulundu.'
    });
    makeRepair(
        issue,
        'review',
        'normalize-node-properties',
        'Property verisini güncel text/number/tags/relation/rollup şemasına normalize et; kullanıcı değerleri değişebileceği için önce incele.',
        { path: doc.storedPath }
    );
}

function extractLocalAttachmentCandidates(content = '') {
    const result = [];
    const regexp = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    let match = null;
    while ((match = regexp.exec(String(content || '')))) {
        const value = String(match[1] || '').trim();
        if (!value || /^(?:https?:|data:|blob:|mailto:|#)/i.test(value)) continue;
        if (!PISI_LOCAL_ATTACHMENT_EXT.test(value)) continue;
        result.push(value.replace(/^file:\/\//i, ''));
    }
    return Array.from(new Set(result)).slice(0, 500);
}

function auditPisiAttachments(projectFolder, context, doc) {
    if (doc.type !== 'node' || typeof doc.data?.content !== 'string') return;
    for (const reference of extractLocalAttachmentCandidates(doc.data.content)) {
        const direct = path.resolve(path.dirname(doc.filePath), reference);
        const sidecar = doc.sidecarPath
            ? path.resolve(doc.sidecarPath, reference)
            : null;
        const exists = (
            integrityCore.isPisiIntegrityPathInsideProject(projectFolder, direct) &&
            fs.existsSync(direct)
        ) || (
            sidecar &&
            integrityCore.isPisiIntegrityPathInsideProject(projectFolder, sidecar) &&
            fs.existsSync(sidecar)
        );
        if (!exists) {
            pushIssue(context, {
                severity: 'warning',
                code: 'attachment-target-missing',
                domain: 'attachments',
                path: doc.storedPath,
                entityId: doc.metadata?.id,
                message: `Yerel ek hedefi bulunamadı: ${reference}`,
                repair: {
                    safety: 'manual',
                    action: 'recover-attachment',
                    description: 'Eksik eki yedek/Trash üzerinden kurtarın veya belge içindeki bağlantıyı bilinçli olarak kaldırın.'
                }
            });
        }
    }
}

function resolveMapReference(projectFolder, reference) {
    if (!reference || typeof reference !== 'object') return null;
    const stored = integrityCore.normalizePisiIntegrityPath(reference.path || '');
    if (!stored) return null;
    const target = path.resolve(projectFolder, ...stored.split('/'));
    if (!integrityCore.isPisiIntegrityPathInsideProject(projectFolder, target)) return null;
    if (!fs.existsSync(target) || path.extname(target).toLowerCase() !== '.node') return null;
    const raw = readIntegrityJson(target);
    if (!raw.ok || raw.data?.pisi?.type !== 'node') return null;
    if (reference.id && raw.data.pisi.id !== reference.id) return null;
    return { path: target, id: raw.data.pisi.id };
}

function auditPisiMaps(projectFolder, context, inventory, relationshipsById) {
    for (const doc of inventory.docs.filter((item) => item.type === 'map')) {
        const mapData = doc.data?.map;
        if (!mapData || typeof mapData !== 'object' || Array.isArray(mapData)) continue;
        const knownIds = new Set();
        if (doc.sidecarPath && fs.existsSync(doc.sidecarPath)) {
            for (const entry of fs.readdirSync(doc.sidecarPath, { withFileTypes: true })) {
                if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.node')) continue;
                const raw = readIntegrityJson(path.join(doc.sidecarPath, entry.name));
                if (raw.ok && raw.data?.pisi?.id) knownIds.add(raw.data.pisi.id);
            }
        }

        const references = Array.isArray(mapData.references) ? mapData.references : [];
        if (mapData.references !== undefined && !Array.isArray(mapData.references)) {
            pushIssue(context, {
                severity: 'error',
                code: 'map-references-malformed',
                domain: 'maps',
                path: doc.storedPath,
                entityId: doc.metadata?.id,
                message: 'Map references alanı dizi değil.',
                repair: {
                    safety: 'review',
                    action: 'repair-map-references',
                    description: 'Map üyelik referanslarını payload üzerinden inceleyip yeniden oluşturun.'
                }
            });
        }
        const seenReferenceIds = new Set();
        for (const reference of references) {
            const resolved = resolveMapReference(projectFolder, reference);
            if (!resolved) {
                pushIssue(context, {
                    severity: 'error',
                    code: 'map-reference-broken',
                    domain: 'maps',
                    path: doc.storedPath,
                    entityId: reference?.id,
                    message: `Map node referansı çözümlenemedi: ${String(reference?.path || '?')}`,
                    repair: {
                        safety: 'review',
                        action: 'detach-broken-map-reference',
                        description: 'Referans hedefi gerçekten kayıpsa map üyeliğinden ayır; restore ihtimali varsa önce hedefi kurtar.'
                    }
                });
                continue;
            }
            knownIds.add(resolved.id);
            if (seenReferenceIds.has(resolved.id)) {
                pushIssue(context, {
                    severity: 'warning',
                    code: 'map-reference-duplicate',
                    domain: 'maps',
                    path: doc.storedPath,
                    entityId: resolved.id,
                    message: `Aynı node map references içinde birden fazla kez geçiyor: ${resolved.id}`,
                    repair: {
                        safety: 'review',
                        action: 'dedupe-map-references',
                        description: 'Aynı node kimliğine ait yinelenen map üyelik referanslarını tekilleştir.'
                    }
                });
            }
            seenReferenceIds.add(resolved.id);
        }

        const layouts = Array.isArray(mapData.nodes) ? mapData.nodes : [];
        if (mapData.nodes !== undefined && !Array.isArray(mapData.nodes)) {
            pushIssue(context, {
                severity: 'error',
                code: 'map-layout-malformed',
                domain: 'maps',
                path: doc.storedPath,
                entityId: doc.metadata?.id,
                message: 'Map nodes/layout alanı dizi değil.',
                repair: {
                    safety: 'review',
                    action: 'rebuild-map-layout',
                    description: 'Map üyeliğinden yeni layout oluşturulmadan önce mevcut bozuk layout verisini inceleyin.'
                }
            });
        }
        const seenLayouts = new Set();
        for (const layout of layouts) {
            const nodeId = String(layout?.id || '');
            if (!knownIds.has(nodeId)) {
                pushIssue(context, {
                    severity: 'warning',
                    code: 'map-layout-orphan',
                    domain: 'maps',
                    path: doc.storedPath,
                    entityId: nodeId,
                    message: `Layout kaydı map üyeliğinde olmayan node'a ait: ${nodeId || '?'}`,
                    repair: {
                        safety: 'review',
                        action: 'remove-orphan-layout',
                        description: 'Node gerçekten kayıpsa orphan layout kaydını kaldır; restore edilecekse layoutu koru.'
                    }
                });
            }
            if (nodeId && seenLayouts.has(nodeId)) {
                pushIssue(context, {
                    severity: 'warning',
                    code: 'map-layout-duplicate',
                    domain: 'maps',
                    path: doc.storedPath,
                    entityId: nodeId,
                    message: `Aynı node için birden fazla layout kaydı var: ${nodeId}`,
                    repair: {
                        safety: 'review',
                        action: 'dedupe-map-layout',
                        description: 'Hangi yerleşimin korunacağını seçerek duplicate layout kayıtlarını tekilleştir.'
                    }
                });
            }
            if (nodeId) seenLayouts.add(nodeId);
        }

        const views = Array.isArray(mapData.relationshipViews)
            ? mapData.relationshipViews
            : [];
        const normalizedViews = mapSemanticCore.normalizePisiRelationshipViews(views);
        if (views.length !== normalizedViews.length) {
            pushIssue(context, {
                severity: 'warning',
                code: 'map-relationship-views-malformed',
                domain: 'maps',
                path: doc.storedPath,
                entityId: doc.metadata?.id,
                message: 'Relationship view kayıtlarında geçersiz veya duplicate presentation girdileri var.',
                repair: {
                    safety: 'review',
                    action: 'normalize-relationship-views',
                    description: 'Semantic authority değiştirmeden relationship view presentation kayıtlarını normalize et.'
                }
            });
        }
        for (const view of normalizedViews) {
            const relationship = relationshipsById.get(view.relationshipId);
            if (!relationship) {
                pushIssue(context, {
                    severity: 'warning',
                    code: 'map-relationship-view-orphan',
                    domain: 'maps',
                    path: doc.storedPath,
                    entityId: view.relationshipId,
                    message: `Presentation kaydının canonical semantic ilişkisi yok: ${view.relationshipId}`,
                    repair: {
                        safety: 'review',
                        action: 'remove-orphan-relationship-view',
                        description: 'İlişki gerçekten silindiyse yalnız presentation kaydını kaldır; relationship restore edilecekse görünümü koru.'
                    }
                });
                continue;
            }
            if (!knownIds.has(relationship.sourceId) || !knownIds.has(relationship.targetId)) {
                pushIssue(context, {
                    severity: 'warning',
                    code: 'map-relationship-view-endpoint-outside-membership',
                    domain: 'maps',
                    path: doc.storedPath,
                    entityId: view.relationshipId,
                    message: 'Relationship view map içinde gösteriliyor ancak semantic ilişkinin iki endpointi de map üyeliğinde değil.',
                    repair: {
                        safety: 'review',
                        action: 'review-relationship-view-membership',
                        description: 'Map üyeliğini veya presentation view kaydını kullanıcı niyetine göre düzelt.'
                    }
                });
            }
        }

        if (Object.prototype.hasOwnProperty.call(mapData, 'edges')) {
            pushIssue(context, {
                severity: Array.isArray(mapData.edges) && mapData.edges.length ? 'warning' : 'info',
                code: 'map-legacy-edges-present',
                domain: 'migration',
                path: doc.storedPath,
                entityId: doc.metadata?.id,
                message: 'Map içinde legacy semantic edges alanı hâlâ mevcut.',
                repair: {
                    safety: 'review',
                    action: 'migrate-legacy-map-edges',
                    description: 'Legacy edge kayıtlarını canonical relationship store + map relationshipViews modeline taşı.'
                }
            });
        }

        if (mapData.operational !== undefined) {
            const normalizedOperational = mapOperationalStore.normalizePisiOperationalMapState(
                mapData.operational
            );
            if (JSON.stringify(normalizedOperational) !== JSON.stringify(mapData.operational)) {
                const issue = pushIssue(context, {
                    severity: 'warning',
                    code: 'map-operational-state-stale',
                    domain: 'maps',
                    path: doc.storedPath,
                    entityId: doc.metadata?.id,
                    message: 'Map operational state güncel şemaya göre normalize değil.'
                });
                makeRepair(
                    issue,
                    'safe',
                    'normalize-map-operational-state',
                    'Yalnız map-local filtre/scope/layout projection state’ini güncel operational şemaya normalize et.',
                    { path: doc.storedPath }
                );
            }
        }
    }
}

function auditPisiTasks(projectFolder, context, inventory) {
    const storePath = taskStore.getPisiTaskStorePath(projectFolder);
    if (!fs.existsSync(storePath)) {
        return { tasks: [], byId: new Map() };
    }
    const raw = readIntegrityJson(storePath);
    if (!raw.ok || !raw.data || !Array.isArray(raw.data.tasks)) {
        pushIssue(context, {
            severity: 'critical',
            code: 'task-store-invalid',
            domain: 'tasks',
            path: relativeIntegrityPath(projectFolder, storePath),
            message: `Canonical task store okunamıyor: ${raw.error || 'tasks dizisi yok.'}`,
            repair: {
                safety: 'manual',
                action: 'recover-task-store',
                description: 'tasks.json authority dosyasını yedek/recovery kaynaklarından kurtarın; projection taramasını authority üzerine yazmayın.'
            }
        });
        return { tasks: [], byId: new Map() };
    }

    const tasks = raw.data.tasks.filter((task) => task && typeof task === 'object');
    const byId = new Map();
    for (const task of tasks) {
        const taskId = String(task.id || '');
        if (!integrityCore.validPisiIntegrityId('task', taskId)) {
            pushIssue(context, {
                severity: 'error',
                code: 'task-id-invalid',
                domain: 'tasks',
                path: '.pisi/tasks.json',
                entityId: taskId,
                message: `Canonical görev kimliği geçersiz: ${taskId || '?'}`,
                repair: {
                    safety: 'manual',
                    action: 'recover-task-id',
                    description: 'Task ID first-class identity olduğu için yeni kimlik üretmeden önce source/block referanslarını inceleyin.'
                }
            });
        } else if (byId.has(taskId)) {
            pushIssue(context, {
                severity: 'critical',
                code: 'task-duplicate-id',
                domain: 'tasks',
                path: '.pisi/tasks.json',
                entityId: taskId,
                message: `Canonical task store içinde duplicate task ID: ${taskId}`,
                repair: {
                    safety: 'manual',
                    action: 'resolve-duplicate-task-id',
                    description: 'Duplicate görevlerin gerçek kimliğini belirleyip bağımlılık ve block referanslarını birlikte düzeltin.'
                }
            });
        } else {
            byId.set(taskId, task);
        }

        if (!PISI_TASK_STATUSES.has(String(task.status || ''))) {
            pushIssue(context, {
                severity: 'warning',
                code: 'task-status-invalid',
                domain: 'tasks',
                path: '.pisi/tasks.json',
                entityId: taskId,
                message: `Görev durumu desteklenmiyor: ${String(task.status || '?')}`,
                repair: {
                    safety: 'review',
                    action: 'normalize-task',
                    description: 'Görevi güncel canonical task şemasından geçirerek status ve bounded alanları normalize et.'
                }
            });
        }
        const priority = Number(task.priority);
        if (!Number.isFinite(priority) || priority < 1 || priority > 5) {
            pushIssue(context, {
                severity: 'warning',
                code: 'task-priority-invalid',
                domain: 'tasks',
                path: '.pisi/tasks.json',
                entityId: taskId,
                message: `Görev önceliği 1–5 aralığında değil: ${String(task.priority)}`,
                repair: {
                    safety: 'review',
                    action: 'normalize-task',
                    description: 'Görevi canonical normalizer üzerinden geçirerek öncelik ve diğer bounded alanları düzelt.'
                }
            });
        }

        const source = task.source && typeof task.source === 'object' ? task.source : {};
        for (const [key, expectedExt] of [['nodePath', '.node'], ['mapPath', '.map']]) {
            if (!source[key]) continue;
            const storedPath = integrityCore.normalizePisiIntegrityPath(source[key]);
            const target = path.resolve(projectFolder, ...storedPath.split('/'));
            const validInside = integrityCore.isPisiIntegrityPathInsideProject(projectFolder, target);
            if (!validInside || !fs.existsSync(target) || path.extname(target).toLowerCase() !== expectedExt) {
                pushIssue(context, {
                    severity: 'error',
                    code: key === 'nodePath' ? 'task-source-node-missing' : 'task-source-map-missing',
                    domain: 'tasks',
                    path: '.pisi/tasks.json',
                    entityId: taskId,
                    message: `Görev source.${key} hedefi bulunamadı: ${storedPath}`,
                    repair: {
                        safety: 'manual',
                        action: 'repair-task-source',
                        description: 'Görevi silmeden önce doğru source node/map yolunu taskId/blockId üzerinden yeniden bağlayın.'
                    }
                });
            }
        }
    }

    for (const task of tasks) {
        const taskId = String(task.id || '');
        const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
        const seen = new Set();
        for (const dependencyId of dependencies) {
            const dep = String(dependencyId || '');
            if (dep === taskId) {
                pushIssue(context, {
                    severity: 'error',
                    code: 'task-self-dependency',
                    domain: 'tasks',
                    path: '.pisi/tasks.json',
                    entityId: taskId,
                    message: 'Görev kendisine bağımlı.',
                    repair: {
                        safety: 'review',
                        action: 'remove-task-dependency',
                        description: 'Self-dependency kaydını canonical task dependencies listesinden kaldır.'
                    }
                });
            } else if (!byId.has(dep)) {
                pushIssue(context, {
                    severity: 'error',
                    code: 'task-dependency-missing',
                    domain: 'tasks',
                    path: '.pisi/tasks.json',
                    entityId: taskId,
                    message: `Görev bağımlılığı canonical store içinde yok: ${dep}`,
                    repair: {
                        safety: 'review',
                        action: 'remove-task-dependency',
                        description: 'Dependency hedefi gerçekten silindiyse dangling dependency ID’sini kaldır; restore edilecekse önce hedef görevi kurtar.'
                    }
                });
            }
            if (dep && seen.has(dep)) {
                pushIssue(context, {
                    severity: 'warning',
                    code: 'task-dependency-duplicate',
                    domain: 'tasks',
                    path: '.pisi/tasks.json',
                    entityId: taskId,
                    message: `Aynı dependency birden fazla kez kayıtlı: ${dep}`,
                    repair: {
                        safety: 'review',
                        action: 'dedupe-task-dependencies',
                        description: 'Görev dependency listesini stable ID seti olarak tekilleştir.'
                    }
                });
            }
            seen.add(dep);
        }
    }

    return { tasks, byId };
}

function auditPisiRelationships(projectFolder, context, inventory) {
    const storePath = relationshipStore.getPisiRelationshipStorePath(projectFolder);
    if (!fs.existsSync(storePath)) {
        return { relationships: [], byId: new Map() };
    }
    const raw = readIntegrityJson(storePath);
    if (!raw.ok || !raw.data || !Array.isArray(raw.data.relationships)) {
        pushIssue(context, {
            severity: 'critical',
            code: 'relationship-store-invalid',
            domain: 'relationships',
            path: relativeIntegrityPath(projectFolder, storePath),
            message: `Canonical relationship store okunamıyor: ${raw.error || 'relationships dizisi yok.'}`,
            repair: {
                safety: 'manual',
                action: 'recover-relationship-store',
                description: 'relationships.json authority dosyasını yedek/recovery kaynaklarından kurtarın; map presentation verisini authority olarak kabul etmeyin.'
            }
        });
        return { relationships: [], byId: new Map() };
    }

    const relationships = raw.data.relationships.filter((item) => item && typeof item === 'object');
    const byId = new Map();
    const semanticKeys = new Map();
    const parentByChild = new Map();

    for (const relationship of relationships) {
        const relationshipId = String(relationship.id || '');
        if (!integrityCore.validPisiIntegrityId('relationship', relationshipId)) {
            pushIssue(context, {
                severity: 'error',
                code: 'relationship-id-invalid',
                domain: 'relationships',
                path: '.pisi/relationships.json',
                entityId: relationshipId,
                message: `Semantic relationship ID geçersiz: ${relationshipId || '?'}`,
                repair: {
                    safety: 'manual',
                    action: 'recover-relationship-id',
                    description: 'Relationship presentation view referanslarını bozmadan ID’yi manuel olarak kurtarın.'
                }
            });
        } else if (byId.has(relationshipId)) {
            pushIssue(context, {
                severity: 'critical',
                code: 'relationship-duplicate-id',
                domain: 'relationships',
                path: '.pisi/relationships.json',
                entityId: relationshipId,
                message: `Canonical relationship store içinde duplicate ID: ${relationshipId}`,
                repair: {
                    safety: 'manual',
                    action: 'resolve-duplicate-relationship-id',
                    description: 'Relationship ID ve map relationshipViews referanslarını birlikte düzeltin.'
                }
            });
        } else {
            byId.set(relationshipId, relationship);
        }

        for (const endpoint of ['sourceId', 'targetId']) {
            const nodeId = String(relationship[endpoint] || '');
            if (!inventory.nodeById.has(nodeId)) {
                pushIssue(context, {
                    severity: 'error',
                    code: 'relationship-endpoint-missing',
                    domain: 'relationships',
                    path: '.pisi/relationships.json',
                    entityId: relationshipId,
                    message: `Semantic ilişkinin ${endpoint} node'u bulunamadı: ${nodeId || '?'}`,
                    repair: {
                        safety: 'manual',
                        action: 'repair-relationship-endpoint',
                        description: 'Endpoint node’u Trash/yedekten kurtarın veya ilişkinin gerçekten orphan olduğuna karar verdikten sonra semantic store’dan kaldırın.'
                    }
                });
            }
        }

        const semanticKey = relationshipStore.getPisiRelationshipSemanticKey(relationship);
        if (semanticKey) {
            if (semanticKeys.has(semanticKey) && semanticKeys.get(semanticKey) !== relationshipId) {
                pushIssue(context, {
                    severity: 'error',
                    code: 'relationship-semantic-duplicate',
                    domain: 'relationships',
                    path: '.pisi/relationships.json',
                    entityId: relationshipId,
                    message: `Aynı semantic ilişki farklı ID ile tekrar edilmiş: ${semanticKeys.get(semanticKey)}`,
                    repair: {
                        safety: 'manual',
                        action: 'merge-semantic-duplicates',
                        description: 'Canonical relationship kaydını seçip tüm map relationshipViews kimliklerini birlikte remap edin.'
                    }
                });
            } else {
                semanticKeys.set(semanticKey, relationshipId);
            }
        }

        if (filesystemCore.isHierarchyEdge(relationship)) {
            const child = String(relationship.targetId || '');
            const parent = String(relationship.sourceId || '');
            if (parentByChild.has(child) && parentByChild.get(child) !== parent) {
                pushIssue(context, {
                    severity: 'error',
                    code: 'relationship-second-parent',
                    domain: 'relationships',
                    path: '.pisi/relationships.json',
                    entityId: relationshipId,
                    message: `Node birden fazla semantic parent'a sahip: ${child}`,
                    repair: {
                        safety: 'manual',
                        action: 'resolve-second-parent',
                        description: 'Hangi ilişkinin hierarchy, hangisinin stream olması gerektiğini kullanıcı niyetiyle belirleyin.'
                    }
                });
            } else {
                if (filesystemCore.wouldCreatePisiHierarchyCycle(parentByChild, parent, child)) {
                    pushIssue(context, {
                        severity: 'critical',
                        code: 'relationship-hierarchy-cycle',
                        domain: 'relationships',
                        path: '.pisi/relationships.json',
                        entityId: relationshipId,
                        message: `Semantic hierarchy cycle tespit edildi: ${parent} → ${child}`,
                        repair: {
                            safety: 'manual',
                            action: 'resolve-hierarchy-cycle',
                            description: 'Döngüyü oluşturan ilişkinin hierarchy/stream anlamını manuel olarak düzeltin.'
                        }
                    });
                }
                parentByChild.set(child, parent);
            }
        }
    }

    return { relationships, byId };
}

function auditDerivedConnectionMetadata(projectFolder, context, inventory, relationships) {
    const derived = mapSemanticCore.derivePisiConnectionTypesFromRelationships(
        Array.from(inventory.nodeById.keys()),
        relationships
    );
    for (const [nodeId, doc] of inventory.nodeById) {
        const expected = derived.get(nodeId);
        if (!expected) continue;
        const current = doc.metadata?.connectionTypes || {};
        if (JSON.stringify(current) === JSON.stringify(expected)) continue;
        const issue = pushIssue(context, {
            severity: 'warning',
            code: 'node-derived-connections-stale',
            domain: 'derived',
            path: doc.storedPath,
            entityId: nodeId,
            message: 'Node connectionTypes cache’i canonical relationship store ile uyuşmuyor.'
        });
        makeRepair(
            issue,
            'safe',
            'rebuild-node-derived-connections',
            'Canonical relationships üzerinden node connectionTypes türetilmiş cache’ini yeniden oluştur.',
            { path: doc.storedPath, nodeId }
        );
    }
}

function auditNodeParentMapConsistency(projectFolder, context, inventory) {
    for (const [nodeId, doc] of inventory.nodeById) {
        const parentMap = String(doc.metadata?.parentMap || 'none');
        if (parentMap !== 'none' && parentMap !== 'diary' && !inventory.mapById.has(parentMap)) {
            pushIssue(context, {
                severity: 'error',
                code: 'node-parent-map-missing',
                domain: 'documents',
                path: doc.storedPath,
                entityId: nodeId,
                message: `Node parentMap kimliği mevcut bir map'e ait değil: ${parentMap}`,
                repair: {
                    safety: 'manual',
                    action: 'repair-node-parent-map',
                    description: 'Node’un gerçek parent map’ini fiziksel sidecar/map üyeliği ve semantic yapı üzerinden belirleyin.'
                }
            });
        }

        const owner = inventory.sidecarOwnerByDirectory.get(
            integrityCore.normalizePisiIntegrityComparePath(path.dirname(doc.filePath))
        );
        if (owner?.type === 'map' && owner.id && parentMap !== owner.id) {
            pushIssue(context, {
                severity: 'warning',
                code: 'node-parent-map-mismatch',
                domain: 'documents',
                path: doc.storedPath,
                entityId: nodeId,
                message: `Node fiziksel olarak ${owner.id} sidecarında ancak parentMap=${parentMap}.`,
                repair: {
                    safety: 'review',
                    action: 'align-node-parent-map',
                    description: 'Fiziksel map sidecar sahipliği doğruysa node parentMap metadata’sını bu map kimliğiyle hizala.'
                }
            });
        }
    }
}

function auditTrashIntegrity(projectFolder, context) {
    const itemsRoot = trashStore.getPisiTrashItemsRoot(projectFolder);
    if (!fs.existsSync(itemsRoot)) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(itemsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        count += 1;
        const itemPath = path.join(itemsRoot, entry.name);
        const result = trashStore.readPisiTrashManifest(projectFolder, entry.name);
        if (!result.ok) {
            pushIssue(context, {
                severity: 'error',
                code: 'trash-manifest-invalid',
                domain: 'trash',
                path: relativeIntegrityPath(projectFolder, itemPath),
                entityId: entry.name,
                message: `Trash manifest okunamıyor: ${result.error}`,
                repair: {
                    safety: 'manual',
                    action: 'inspect-trash-item',
                    description: 'Payloadı silmeden önce manifest ve payloadı manuel inceleyin; invalid Trash item otomatik temizlenmez.'
                }
            });
            continue;
        }
        const manifest = result.manifest;
        const seenDestinations = new Set();
        for (const trashEntry of manifest.entries || []) {
            const originalPath = integrityCore.normalizePisiIntegrityPath(trashEntry.originalPath || '');
            const payloadPath = integrityCore.normalizePisiIntegrityPath(trashEntry.payloadPath || '');
            if (!originalPath || seenDestinations.has(integrityCore.normalizePisiIntegrityComparePath(originalPath))) {
                pushIssue(context, {
                    severity: 'error',
                    code: 'trash-duplicate-restore-destination',
                    domain: 'trash',
                    path: relativeIntegrityPath(projectFolder, itemPath),
                    entityId: manifest.id,
                    message: `Trash restore destination duplicate/geçersiz: ${originalPath || '?'}`,
                    repair: {
                        safety: 'manual',
                        action: 'repair-trash-manifest',
                        description: 'Restore başlamadan önce duplicate destination manifest kayıtlarını payload ile eşleştirerek düzeltin.'
                    }
                });
            }
            seenDestinations.add(integrityCore.normalizePisiIntegrityComparePath(originalPath));
            const payload = path.resolve(itemPath, ...payloadPath.split('/'));
            if (
                !payloadPath.startsWith('payload/') ||
                !integrityCore.isPisiIntegrityPathInsideProject(itemPath, payload) ||
                !fs.existsSync(payload)
            ) {
                pushIssue(context, {
                    severity: 'critical',
                    code: 'trash-payload-missing',
                    domain: 'trash',
                    path: relativeIntegrityPath(projectFolder, itemPath),
                    entityId: manifest.id,
                    message: `Trash payload bulunamadı veya item dışına çıkıyor: ${payloadPath || '?'}`,
                    repair: {
                        safety: 'manual',
                        action: 'recover-trash-payload',
                        description: 'Trash item’i silmeden önce kayıp payloadı yedeklerden kurtarın.'
                    }
                });
            }
        }
        for (const [kind, values] of [
            ['node', manifest.nodeIds],
            ['map', manifest.mapIds]
        ]) {
            const seen = new Set();
            for (const id of Array.isArray(values) ? values : []) {
                if (!integrityCore.validPisiIntegrityId(kind, id) || seen.has(id)) {
                    pushIssue(context, {
                        severity: 'error',
                        code: 'trash-identity-invalid',
                        domain: 'trash',
                        path: relativeIntegrityPath(projectFolder, itemPath),
                        entityId: manifest.id,
                        message: `Trash manifest ${kind} identity listesi geçersiz/duplicate: ${String(id)}`,
                        repair: {
                            safety: 'manual',
                            action: 'repair-trash-identities',
                            description: 'Manifest identity listesini payload içindeki gerçek Pisi metadata ile doğrulayarak düzeltin.'
                        }
                    });
                }
                seen.add(id);
            }
        }
    }
    return count;
}

function auditAtomicMutationIntegrity(projectFolder, context) {
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
            pushIssue(context, {
                severity: 'critical',
                code: 'atomic-manifest-invalid',
                domain: 'recovery',
                path: relativeIntegrityPath(projectFolder, directoryPath),
                entityId: entry.name,
                message: `Atomic mutation journal okunamıyor: ${error.message}`,
                repair: {
                    safety: 'manual',
                    action: 'inspect-atomic-journal',
                    description: 'Journal/snapshot verisini silmeden önce manuel inceleyin; otomatik recovery güvenli biçimde karar veremiyor.'
                }
            });
            continue;
        }
        if (manifest.phase === 'committed') {
            const issue = pushIssue(context, {
                severity: 'warning',
                code: 'atomic-committed-cleanup-pending',
                domain: 'recovery',
                path: relativeIntegrityPath(projectFolder, directoryPath),
                entityId: manifest.id,
                message: 'Committed atomic journal cleanup bekliyor.'
            });
            makeRepair(
                issue,
                'safe',
                'run-atomic-recovery',
                'Committed data korunarak yalnız journal cleanup/recovery akışını yeniden çalıştır.',
                {}
            );
        } else if (manifest.phase === 'rollback-failed') {
            pushIssue(context, {
                severity: 'critical',
                code: 'atomic-rollback-failed',
                domain: 'recovery',
                path: relativeIntegrityPath(projectFolder, directoryPath),
                entityId: manifest.id,
                message: `Atomic rollback başarısız kalmış: ${(manifest.rollbackErrors || []).join(' | ') || 'detay yok'}`,
                repair: {
                    safety: 'review',
                    action: 'run-atomic-recovery',
                    description: 'Snapshotların mevcut olduğunu doğruladıktan sonra atomic recovery’yi yeniden dene.'
                }
            });
        } else {
            const issue = pushIssue(context, {
                severity: 'error',
                code: 'atomic-recovery-pending',
                domain: 'recovery',
                path: relativeIntegrityPath(projectFolder, directoryPath),
                entityId: manifest.id,
                message: `Tamamlanmamış atomic mutation bulundu: ${String(manifest.phase || '?')}`
            });
            makeRepair(
                issue,
                'safe',
                'run-atomic-recovery',
                'Atomic journal snapshotlarından eski tutarlı state’e rollback/recovery uygula.',
                {}
            );
        }
    }
    return count;
}

function makeRepairPlan(issues) {
    const plan = { safe: [], review: [], manual: [] };
    for (const issue of issues) {
        if (!issue.repair) continue;
        plan[issue.repair.safety].push({
            issueId: issue.id,
            code: issue.code,
            path: issue.path,
            entityId: issue.entityId,
            ...issue.repair
        });
    }
    return plan;
}

function auditPisiProjectIntegrity(projectFolder) {
    const projectRoot = path.resolve(projectFolder);
    const context = { issues: [] };
    const inventory = collectPisiDocumentInventory(projectRoot, context);

    for (const doc of inventory.docs) {
        auditPisiNodeProperties(projectRoot, context, doc);
        auditPisiAttachments(projectRoot, context, doc);
    }

    const tasks = auditPisiTasks(projectRoot, context, inventory);
    const relationships = auditPisiRelationships(projectRoot, context, inventory);
    auditPisiMaps(projectRoot, context, inventory, relationships.byId);
    auditNodeParentMapConsistency(projectRoot, context, inventory);
    auditDerivedConnectionMetadata(
        projectRoot,
        context,
        inventory,
        relationships.relationships
    );
    const trashItems = auditTrashIntegrity(projectRoot, context);
    const mutationJournals = auditAtomicMutationIntegrity(projectRoot, context);

    const report = integrityCore.makePisiIntegrityReport(
        context.issues,
        {
            files: inventory.files.length,
            nodes: inventory.nodeById.size,
            maps: inventory.mapById.size,
            tasks: tasks.tasks.length,
            relationships: relationships.relationships.length,
            trashItems,
            mutationJournals
        }
    );
    report.repairPlan = makeRepairPlan(report.issues);
    report.authorities = {
        tasks: '.pisi/tasks.json',
        relationships: '.pisi/relationships.json',
        mapState: '*.map',
        trash: '.pisi/trash/items',
        mutations: '.pisi/mutations'
    };
    return report;
}

function applyNormalizeDocumentMetadata(projectFolder, payload) {
    const filePath = getIntegrityAbsolutePath(projectFolder, payload.path);
    const result = documentStore.ensurePisiFileMetadata(filePath, {
        persist: true,
        ensureSidecar: true
    });
    if (!result.ok) return result;
    return { ok: true, path: payload.path, changed: result.changed || false };
}

function applyEnsureDocumentSidecar(projectFolder, payload) {
    const filePath = getIntegrityAbsolutePath(projectFolder, payload.path);
    const result = documentStore.ensurePisiFileMetadata(filePath, {
        persist: true,
        ensureSidecar: true
    });
    return result.ok
        ? { ok: true, path: payload.path, sidecarPath: result.sidecarPath }
        : result;
}

function applyNormalizeMapOperationalState(projectFolder, payload) {
    const filePath = getIntegrityAbsolutePath(projectFolder, payload.path);
    const current = mapOperationalStore.readPisiOperationalMapState(filePath);
    if (!current.ok) return current;
    return mapOperationalStore.writePisiOperationalMapState(
        filePath,
        current.state,
        current.mapInfo
    );
}

function rebuildOneNodeDerivedConnections(projectFolder, payload) {
    const filePath = getIntegrityAbsolutePath(projectFolder, payload.path);
    const info = documentStore.ensurePisiFileMetadata(filePath, {
        persist: false,
        ensureSidecar: false
    });
    if (!info.ok) return info;
    const relationships = relationshipStore.readPisiRelationshipStore(projectFolder).relationships;
    const expected = mapSemanticCore.derivePisiConnectionTypesFromRelationships(
        [info.metadata.id],
        relationships
    ).get(info.metadata.id);
    if (!expected) return { ok: false, error: 'Node identity derived connection rebuild için bulunamadı.' };
    info.data.pisi.connectionTypes = expected;
    info.data.pisi.updatedAt = new Date().toISOString();
    filesystemCore.writePisiDocument(filePath, info.data);
    return { ok: true, path: payload.path, nodeId: info.metadata.id };
}

function applyIntegritySafeRepair(projectFolder, repair) {
    if (repair.action === 'normalize-document-metadata') {
        return applyNormalizeDocumentMetadata(projectFolder, repair.payload);
    }
    if (repair.action === 'ensure-document-sidecar') {
        return applyEnsureDocumentSidecar(projectFolder, repair.payload);
    }
    if (repair.action === 'normalize-map-operational-state') {
        return applyNormalizeMapOperationalState(projectFolder, repair.payload);
    }
    if (repair.action === 'rebuild-node-derived-connections') {
        return rebuildOneNodeDerivedConnections(projectFolder, repair.payload);
    }
    if (repair.action === 'run-atomic-recovery') {
        return atomicMutation.recoverPisiAtomicMutations(projectFolder, { force: true });
    }
    return { ok: false, code: 'INTEGRITY_REPAIR_NOT_SAFE', error: `Safe repair uygulanamıyor: ${repair.action}` };
}

function repairPisiProjectIntegrity(projectFolder, repairIds = []) {
    const before = auditPisiProjectIntegrity(projectFolder);
    const wanted = new Set((Array.isArray(repairIds) ? repairIds : []).map(String));
    const available = before.repairPlan.safe;
    const selected = wanted.size
        ? available.filter((repair) => wanted.has(repair.id))
        : available;
    if (!selected.length) {
        return {
            ok: true,
            applied: 0,
            before,
            after: before,
            results: []
        };
    }
    const results = [];
    for (const repair of selected) {
        const result = applyIntegritySafeRepair(projectFolder, repair);
        results.push({ repairId: repair.id, action: repair.action, result });
        if (!result?.ok) {
            return {
                ok: false,
                code: 'INTEGRITY_REPAIR_FAILED',
                error: result?.error || `Repair başarısız: ${repair.action}`,
                applied: results.filter((item) => item.result?.ok).length,
                results
            };
        }
    }
    const after = auditPisiProjectIntegrity(projectFolder);
    return {
        ok: true,
        applied: results.length,
        results,
        before,
        after
    };
}

function rebuildPisiDerivedIntegrityState(projectFolder) {
    const projectRoot = path.resolve(projectFolder);
    const context = { issues: [] };
    const inventory = collectPisiDocumentInventory(projectRoot, context);
    const relationshipState = relationshipStore.readPisiRelationshipStore(projectRoot);
    const relationships = Array.isArray(relationshipState.relationships)
        ? relationshipState.relationships
        : [];
    const derived = mapSemanticCore.derivePisiConnectionTypesFromRelationships(
        Array.from(inventory.nodeById.keys()),
        relationships
    );
    let nodesUpdated = 0;
    let mapsUpdated = 0;

    for (const [nodeId, doc] of inventory.nodeById) {
        const expected = derived.get(nodeId);
        if (!expected) continue;
        if (JSON.stringify(doc.metadata?.connectionTypes || {}) === JSON.stringify(expected)) continue;
        const info = documentStore.ensurePisiFileMetadata(doc.filePath, {
            persist: false,
            ensureSidecar: false
        });
        if (!info.ok) return info;
        info.data.pisi.connectionTypes = expected;
        info.data.pisi.updatedAt = new Date().toISOString();
        filesystemCore.writePisiDocument(doc.filePath, info.data);
        nodesUpdated += 1;
    }

    for (const doc of inventory.docs.filter((item) => item.type === 'map')) {
        const info = documentStore.ensurePisiFileMetadata(doc.filePath, {
            persist: false,
            ensureSidecar: false
        });
        if (!info.ok || !info.data.map) continue;
        let changed = false;
        const normalizedViews = mapSemanticCore.normalizePisiRelationshipViews(
            info.data.map.relationshipViews
        );
        if (JSON.stringify(normalizedViews) !== JSON.stringify(info.data.map.relationshipViews || [])) {
            info.data.map.relationshipViews = normalizedViews;
            info.data.map.relationshipViewVersion = mapSemanticCore.PISI_MAP_RELATIONSHIP_VIEW_VERSION;
            changed = true;
        }
        if (info.data.map.operational !== undefined) {
            const normalizedOperational = mapOperationalStore.normalizePisiOperationalMapState(
                info.data.map.operational
            );
            if (JSON.stringify(normalizedOperational) !== JSON.stringify(info.data.map.operational)) {
                info.data.map.operational = normalizedOperational;
                changed = true;
            }
        }
        if (changed) {
            info.data.pisi.updatedAt = new Date().toISOString();
            filesystemCore.writePisiDocument(doc.filePath, info.data);
            mapsUpdated += 1;
        }
    }

    return {
        ok: true,
        nodesUpdated,
        mapsUpdated,
        authorityChanged: false,
        preservedAuthorities: ['.pisi/tasks.json', '.pisi/relationships.json'],
        report: auditPisiProjectIntegrity(projectRoot)
    };
}

const moduleApi = {
    PISI_INTEGRITY_VERSION: integrityCore.PISI_INTEGRITY_VERSION,
    walkIntegrityProjectDocuments,
    extractLocalAttachmentCandidates,
    collectPisiDocumentInventory,
    auditPisiProjectIntegrity,
    repairPisiProjectIntegrity,
    rebuildPisiDerivedIntegrityState,
    makeRepairPlan
};

registerMainModule('main.projectIntegrity', moduleApi);