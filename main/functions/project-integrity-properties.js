import * as fs from 'node:fs';
import * as path from 'node:path';
import * as schemaStore from './property-schema-store.js';
import * as shared from './project-integrity-shared.js';

const contract = schemaStore.propertySchemaContract;

function getPropertyEntries(properties = {}) {
    if (!properties || typeof properties !== 'object') return [];
    return Array.isArray(properties) ? properties.map((item, index) => [item?.id || item?.name || String(index), item]) : Object.entries(properties);
}

function issueProperty(context, record, repair = null) {
    shared.issue(context, { domain: 'properties', ...record }, repair);
}

function auditPropertyDefinitionSet(context, schema) {
    const byId = new Map();
    const byName = new Map();
    const definitions = Array.isArray(schema?.definitions) ? schema.definitions : [];
    for (const raw of definitions) {
        const definition = contract.normalizePropertyDefinition(raw);
        if (!definition) {
            issueProperty(
                context,
                {
                    severity: 'error',
                    code: 'property-schema-definition-invalid',
                    entityId: raw?.id,
                    message: 'Project property schema içinde geçersiz definition var.'
                },
                {
                    safety: 'review',
                    action: 'repair-property-schema-definition',
                    description: 'Geçersiz definition kimliğini, adını ve türünü kullanıcı verisini kaybetmeden inceleyin.'
                }
            );
            continue;
        }
        if (byId.has(definition.id)) {
            issueProperty(
                context,
                {
                    severity: 'critical',
                    code: 'property-schema-duplicate-id',
                    entityId: definition.id,
                    message: `Aynı property ID birden fazla definition tarafından kullanılıyor: ${definition.id}`
                },
                {
                    safety: 'manual',
                    action: 'resolve-property-schema-duplicate-id',
                    description: 'Property değerlerini hangi definitionın sahip olduğunu belirlemeden ID değiştirmeyin.'
                }
            );
        } else {
            byId.set(definition.id, definition);
        }
        const nameKey = contract.normalizePropertyNameKey(definition.name);
        if (byName.has(nameKey) && byName.get(nameKey).id !== definition.id) {
            issueProperty(
                context,
                {
                    severity: 'error',
                    code: 'property-schema-duplicate-name',
                    entityId: definition.id,
                    message: `Aynı property adı farklı ID'lerle kullanılıyor: ${definition.name}`
                },
                {
                    safety: 'review',
                    action: 'merge-property-schema-names',
                    description: 'Tür ve değer uyumluluğu doğrulanırsa definitionları tek stable ID altında birleştirin.'
                }
            );
        } else {
            byName.set(nameKey, definition);
        }
    }
    for (const conflict of Array.isArray(schema?.conflicts) ? schema.conflicts : []) {
        issueProperty(
            context,
            {
                severity: 'error',
                code: `property-schema-migration-${String(conflict?.code || 'conflict')}`,
                path: conflict?.path,
                entityId: conflict?.propertyId || conflict?.ownerId,
                message: `Property schema migration çakışması çözülmemiş: ${String(conflict?.code || 'conflict')}`
            },
            {
                safety: 'review',
                action: 'resolve-property-schema-migration',
                description: 'Çakışan property kimliği/türü/değerini inceleyip explicit migration kararı verin.'
            }
        );
    }
    return { byId, byName, definitions };
}

function auditNodePropertyAgainstSchema(context, doc, indexes) {
    if (doc.type !== 'node' || doc.data?.properties == null) return;
    const properties = doc.data.properties;
    if (!properties || typeof properties !== 'object') return;
    const seen = new Set();
    for (const [rawKey, property] of getPropertyEntries(properties)) {
        if (!property || typeof property !== 'object') continue;
        const rawType = String(property.type || '').toLowerCase();
        const type = contract.normalizePropertyType(rawType);
        const id = contract.normalizeStablePropertyId(property.id || rawKey);
        if (!id) {
            issueProperty(
                context,
                {
                    severity: 'error',
                    code: 'node-property-id-invalid',
                    path: doc.storedPath,
                    entityId: doc.metadata?.id,
                    message: `Node property stable ID taşımıyor: ${String(property.name || rawKey)}`
                },
                {
                    safety: 'review',
                    action: 'migrate-node-property-id',
                    description: 'Project schema eşleşmesine göre stable ID ata; ad benzerliği tek başına yeterli değil.'
                }
            );
            continue;
        }
        if (seen.has(id)) {
            issueProperty(
                context,
                {
                    severity: 'error',
                    code: 'node-property-duplicate-id',
                    path: doc.storedPath,
                    entityId: id,
                    message: `Aynı property ID node içinde birden fazla kez kullanılıyor: ${id}`
                },
                {
                    safety: 'review',
                    action: 'dedupe-node-property',
                    description: 'Değerlerden hangisinin korunacağını incelemeden duplicate property silmeyin.'
                }
            );
        }
        seen.add(id);

        const definition = indexes.byId.get(id);
        if (!definition) {
            issueProperty(
                context,
                {
                    severity: 'error',
                    code: 'node-property-schema-orphan',
                    path: doc.storedPath,
                    entityId: id,
                    message: `Node property ID project schema içinde tanımlı değil: ${id}`
                },
                {
                    safety: 'review',
                    action: 'register-or-remap-property-definition',
                    description: 'Propertyyi yeni definition olarak kaydetmeden önce aynı anlamdaki mevcut IDleri kontrol edin.'
                }
            );
        } else {
            if (contract.normalizePropertyName(property.name) !== definition.name) {
                issueProperty(
                    context,
                    {
                        severity: 'warning',
                        code: 'node-property-name-drift',
                        path: doc.storedPath,
                        entityId: id,
                        message: `Node property adı canonical schema ile uyuşmuyor: ${String(property.name || '')} → ${definition.name}`
                    },
                    {
                        safety: 'review',
                        action: 'sync-property-definition-copy',
                        description: 'Stable ID değişmeden node üzerindeki redundant ad kopyasını project schema ile eşitle.'
                    }
                );
            }
            if (type !== definition.type) {
                issueProperty(
                    context,
                    {
                        severity: 'error',
                        code: 'node-property-type-drift',
                        path: doc.storedPath,
                        entityId: id,
                        message: `Node property türü canonical schema ile uyuşmuyor: ${rawType || '?'} → ${definition.type}`
                    },
                    {
                        safety: 'review',
                        action: 'migrate-property-type',
                        description: 'Tüm project kullanımlarında lossless conversion doğrulanmadan property türünü değiştirmeyin.'
                    }
                );
            }
        }

        if (!contract.isSupportedPropertyType(type)) {
            issueProperty(
                context,
                {
                    severity: 'error',
                    code: 'node-property-type-invalid',
                    path: doc.storedPath,
                    entityId: id,
                    message: `Desteklenmeyen property türü: ${rawType || '?'}`
                },
                {
                    safety: 'manual',
                    action: 'resolve-invalid-property-type',
                    description: 'Bilinmeyen type sessizce text türüne dönüştürülmez; explicit migration gerekir.'
                }
            );
        }

        const validation = contract.validatePropertyValue(type, property.value);
        if (!validation.ok) {
            issueProperty(
                context,
                {
                    severity: 'error',
                    code: 'node-property-value-invalid',
                    path: doc.storedPath,
                    entityId: id,
                    message: `Property değeri ${type} türüyle uyumlu değil: ${String(property.name || id)}`
                },
                {
                    safety: 'review',
                    action: 'repair-property-value',
                    description: 'Değeri değiştirmeden önce kullanıcı niyetini ve hedef property türünü doğrulayın.'
                }
            );
        }
    }
}

function auditTemplateProperties(projectFolder, context, indexes) {
    const templatePath = path.join(projectFolder, '.pisi-templates.json');
    if (!fs.existsSync(templatePath)) return;
    let data;
    try {
        data = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    } catch {
        return;
    }
    for (const template of Array.isArray(data?.templates) ? data.templates : []) {
        for (const [rawKey, property] of getPropertyEntries(template?.properties)) {
            if (!property || typeof property !== 'object') continue;
            const id = contract.normalizeStablePropertyId(property.id || rawKey);
            const definition = id ? indexes.byId.get(id) : null;
            if (!definition) {
                issueProperty(
                    context,
                    {
                        severity: 'warning',
                        code: 'template-property-schema-orphan',
                        path: '.pisi-templates.json',
                        entityId: id || template.id,
                        message: `Template property project schema içinde tanımlı değil: ${String(property.name || rawKey)}`
                    },
                    {
                        safety: 'review',
                        action: 'migrate-template-property-schema',
                        description: 'Template property kimliğini project schema ile eşleştir.'
                    }
                );
                continue;
            }
            if (contract.normalizePropertyName(property.name) !== definition.name || contract.normalizePropertyType(property.type) !== definition.type) {
                issueProperty(
                    context,
                    {
                        severity: 'warning',
                        code: 'template-property-schema-drift',
                        path: '.pisi-templates.json',
                        entityId: id,
                        message: `Template property canonical definition ile uyuşmuyor: ${definition.name}`
                    },
                    {
                        safety: 'review',
                        action: 'sync-template-property-schema',
                        description: 'Stable ID korunarak template üzerindeki ad/type kopyasını canonical schema ile eşitle.'
                    }
                );
            }
        }
    }
}

function auditPisiPropertySchema(projectFolder, context, inventory) {
    const read = schemaStore.readPisiPropertySchema(projectFolder);
    const nodesWithProperties = inventory.docs.filter(
        (doc) => doc.type === 'node' && doc.data?.properties && getPropertyEntries(doc.data.properties).length > 0
    );
    if (!read.ok) {
        issueProperty(
            context,
            {
                severity: 'critical',
                code: read.code || 'property-schema-unreadable',
                path: schemaStore.PISI_PROPERTY_SCHEMA_RELATIVE_PATH,
                message: read.error || 'Project property schema okunamıyor.'
            },
            {
                safety: 'manual',
                action: 'recover-property-schema',
                description: 'Schema authority dosyasını yedek/Version History üzerinden kurtarın; node değerlerinden körlemesine overwrite etmeyin.'
            }
        );
        return { definitions: [], exists: read.exists, valid: false };
    }
    if (!read.exists) {
        if (nodesWithProperties.length) {
            issueProperty(
                context,
                {
                    severity: 'warning',
                    code: 'property-schema-missing',
                    path: schemaStore.PISI_PROPERTY_SCHEMA_RELATIVE_PATH,
                    message: 'Node property verisi var ancak project-level property schema henüz oluşturulmamış.'
                },
                {
                    safety: 'review',
                    action: 'migrate-property-schema',
                    description: 'Mevcut stable ID/ad/type verisini tarayıp project-level schema v1 migrationı çalıştır.'
                }
            );
        }
        return { definitions: [], exists: false, valid: true };
    }

    const indexes = auditPropertyDefinitionSet(context, read.schema);
    for (const doc of inventory.docs) {
        auditNodePropertyAgainstSchema(context, doc, indexes);
    }
    auditTemplateProperties(projectFolder, context, indexes);
    return {
        definitions: indexes.definitions,
        exists: true,
        valid: true,
        conflicts: Array.isArray(read.schema.conflicts) ? read.schema.conflicts.length : 0
    };
}

export { auditPisiPropertySchema, auditPropertyDefinitionSet, auditNodePropertyAgainstSchema, auditTemplateProperties };
