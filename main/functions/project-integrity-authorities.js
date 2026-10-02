'use strict';

const fs = require('fs');
const path = require('path');
const { modules } = require('../module-registry');
const shared = require('./project-integrity-shared');

const taskStore = modules['main.taskStore'];
const relationshipStore = modules['main.relationshipStore'];
const filesystemCore = modules['main.filesystemCore'];

const TASK_STATUSES = new Set(['todo', 'doing', 'waiting', 'blocked', 'done']);

function auditTasks(projectFolder, context) {
    const storePath = taskStore.getPisiTaskStorePath(projectFolder);
    if (!fs.existsSync(storePath)) return { tasks: [], byId: new Map() };
    const read = shared.readJson(storePath);
    if (!read.ok || !read.data || !Array.isArray(read.data.tasks)) {
        shared.issue(
            context,
            {
                severity: 'critical',
                code: 'task-store-invalid',
                domain: 'tasks',
                path: shared.relativePath(projectFolder, storePath),
                message: `Canonical task store okunamıyor: ${read.error || 'tasks dizisi yok.'}`
            },
            {
                safety: 'manual',
                action: 'recover-task-store',
                description: 'tasks.json authority dosyasını yedek/recovery kaynaklarından kurtarın; projection taramasını authority üzerine yazmayın.'
            }
        );
        return { tasks: [], byId: new Map() };
    }

    const tasks = read.data.tasks.filter((task) => task && typeof task === 'object');
    const byId = new Map();
    for (const task of tasks) {
        const taskId = String(task.id || '');
        if (!shared.integrityCore.validPisiIntegrityId('task', taskId)) {
            shared.issue(
                context,
                {
                    severity: 'error',
                    code: 'task-id-invalid',
                    domain: 'tasks',
                    path: '.pisi/tasks.json',
                    entityId: taskId,
                    message: `Canonical görev kimliği geçersiz: ${taskId || '?'}`
                },
                {
                    safety: 'manual',
                    action: 'recover-task-id',
                    description: 'Task ID first-class identity olduğu için yeni kimlik üretmeden önce source/block referanslarını inceleyin.'
                }
            );
        } else if (byId.has(taskId)) {
            shared.issue(
                context,
                {
                    severity: 'critical',
                    code: 'task-duplicate-id',
                    domain: 'tasks',
                    path: '.pisi/tasks.json',
                    entityId: taskId,
                    message: `Canonical task store içinde duplicate task ID: ${taskId}`
                },
                {
                    safety: 'manual',
                    action: 'resolve-duplicate-task-id',
                    description: 'Duplicate görevlerin gerçek kimliğini belirleyip bağımlılık ve block referanslarını birlikte düzeltin.'
                }
            );
        } else {
            byId.set(taskId, task);
        }

        if (!TASK_STATUSES.has(String(task.status || ''))) {
            shared.issue(
                context,
                {
                    severity: 'warning',
                    code: 'task-status-invalid',
                    domain: 'tasks',
                    path: '.pisi/tasks.json',
                    entityId: taskId,
                    message: `Görev durumu desteklenmiyor: ${String(task.status || '?')}`
                },
                {
                    safety: 'review',
                    action: 'normalize-task',
                    description: 'Görevi güncel canonical task şemasından geçirerek status ve bounded alanları normalize et.'
                }
            );
        }
        const priority = Number(task.priority);
        if (!Number.isFinite(priority) || priority < 1 || priority > 5) {
            shared.issue(
                context,
                {
                    severity: 'warning',
                    code: 'task-priority-invalid',
                    domain: 'tasks',
                    path: '.pisi/tasks.json',
                    entityId: taskId,
                    message: `Görev önceliği 1–5 aralığında değil: ${String(task.priority)}`
                },
                {
                    safety: 'review',
                    action: 'normalize-task',
                    description: 'Görevi canonical normalizer üzerinden geçirerek öncelik ve bounded alanları düzelt.'
                }
            );
        }

        const source = task.source && typeof task.source === 'object' ? task.source : {};
        for (const [key, ext, code] of [
            ['nodePath', '.node', 'task-source-node-missing'],
            ['mapPath', '.map', 'task-source-map-missing']
        ]) {
            if (!source[key]) continue;
            const stored = shared.integrityCore.normalizePisiIntegrityPath(source[key]);
            const target = path.resolve(projectFolder, ...stored.split('/'));
            const valid =
                shared.integrityCore.isPisiIntegrityPathInsideProject(projectFolder, target) &&
                fs.existsSync(target) &&
                path.extname(target).toLowerCase() === ext;
            if (!valid) {
                shared.issue(
                    context,
                    {
                        severity: 'error',
                        code,
                        domain: 'tasks',
                        path: '.pisi/tasks.json',
                        entityId: taskId,
                        message: `Görev source.${key} hedefi bulunamadı: ${stored}`
                    },
                    {
                        safety: 'manual',
                        action: 'repair-task-source',
                        description: 'Görevi silmeden önce doğru source node/map yolunu taskId/blockId üzerinden yeniden bağlayın.'
                    }
                );
            }
        }
    }

    for (const task of tasks) {
        const taskId = String(task.id || '');
        const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
        const seen = new Set();
        for (const rawDependency of dependencies) {
            const dependencyId = String(rawDependency || '');
            let finding = null;
            if (dependencyId === taskId) {
                finding = ['task-self-dependency', 'Görev kendisine bağımlı.'];
            } else if (!byId.has(dependencyId)) {
                finding = ['task-dependency-missing', `Görev bağımlılığı canonical store içinde yok: ${dependencyId}`];
            } else if (seen.has(dependencyId)) {
                finding = ['task-dependency-duplicate', `Aynı dependency birden fazla kez kayıtlı: ${dependencyId}`];
            }
            if (finding) {
                shared.issue(
                    context,
                    {
                        severity: finding[0] === 'task-dependency-duplicate' ? 'warning' : 'error',
                        code: finding[0],
                        domain: 'tasks',
                        path: '.pisi/tasks.json',
                        entityId: taskId,
                        message: finding[1]
                    },
                    {
                        safety: 'review',
                        action: finding[0] === 'task-dependency-duplicate' ? 'dedupe-task-dependencies' : 'remove-task-dependency',
                        description:
                            finding[0] === 'task-dependency-missing'
                                ? 'Hedef gerçekten silindiyse dangling dependency ID’sini kaldır; restore edilecekse önce görevi kurtar.'
                                : 'Task dependency listesini canonical stable-ID seti olarak düzelt.'
                    }
                );
            }
            if (dependencyId) seen.add(dependencyId);
        }
    }
    return { tasks, byId };
}

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

module.exports = {
    auditTasks,
    auditRelationships
};
