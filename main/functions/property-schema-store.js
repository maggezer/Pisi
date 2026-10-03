import * as path from 'node:path';
import * as storageLayer from './storage.js';
import { registerMainModule } from '../module-registry.js';
import * as contract from './property-schema-core.js';

const PISI_PROPERTY_SCHEMA_DIR = '.pisi';
const PISI_PROPERTY_TEMPLATE_FILE = '.pisi-templates.json';
const PISI_PROPERTY_MAX_DEFINITIONS = 500;
const PISI_PROPERTY_SCHEMA_KEY = contract.PISI_PROPERTY_SCHEMA_RELATIVE_PATH;

function getPisiPropertyStorage(projectFolder) {
    return storageLayer.getPisiProjectStorage(projectFolder);
}

function getPisiPropertySchemaPath(projectFolder) {
    return path.join(projectFolder, ...contract.PISI_PROPERTY_SCHEMA_RELATIVE_PATH.split('/'));
}

function readJsonWithoutMutation(projectFolder, filePath) {
    try {
        const storage = getPisiPropertyStorage(projectFolder);
        return storage.readJson(storage.keyForPath(filePath));
    } catch (error) {
        return { ok: false, error: error.message, data: null };
    }
}

function walkPisiPropertyNodePaths(projectFolder) {
    const storage = getPisiPropertyStorage(projectFolder);
    const result = storage.walk('.', {
        ignore: ['.git', '.pisi', 'node_modules'],
        extensions: ['.node'],
        maxFiles: 100000
    });
    if (!result.ok) {
        throw new Error(result.error || 'Property node taraması başarısız.');
    }
    return result.entries.map((entry) => entry.path).sort((a, b) => a.localeCompare(b, 'en'));
}

function readPisiPropertySchema(projectFolder) {
    const storage = getPisiPropertyStorage(projectFolder);
    const filePath = storage.resolvePath(PISI_PROPERTY_SCHEMA_KEY);
    const read = storage.readJson(PISI_PROPERTY_SCHEMA_KEY, {
        allowMissing: true
    });
    if (read.missing) {
        return {
            ok: true,
            exists: false,
            filePath,
            schema: contract.makePropertySchema([], { updatedAt: null })
        };
    }
    if (!read.ok || !read.data || typeof read.data !== 'object' || Array.isArray(read.data)) {
        return {
            ok: false,
            exists: true,
            filePath,
            code: 'PROPERTY_SCHEMA_INVALID_JSON',
            error: `Property schema okunamadı: ${read.error || 'Geçersiz JSON.'}`
        };
    }
    if (Number(read.data.version) !== contract.PISI_PROPERTY_SCHEMA_VERSION) {
        return {
            ok: false,
            exists: true,
            filePath,
            code: 'PROPERTY_SCHEMA_VERSION_UNSUPPORTED',
            error: `Desteklenmeyen property schema sürümü: ${String(read.data.version || '?')}`,
            schema: read.data
        };
    }
    return {
        ok: true,
        exists: true,
        filePath,
        schema: {
            version: contract.PISI_PROPERTY_SCHEMA_VERSION,
            definitions: Array.isArray(read.data.definitions) ? read.data.definitions : [],
            conflicts: Array.isArray(read.data.conflicts) ? read.data.conflicts : [],
            updatedAt: read.data.updatedAt || null
        }
    };
}

function writePisiPropertySchema(projectFolder, schema) {
    const storage = getPisiPropertyStorage(projectFolder);
    const ensured = storage.ensureDirectory(PISI_PROPERTY_SCHEMA_DIR, { hidden: true });
    if (!ensured.ok) {
        throw new Error(ensured.error || 'Property schema klasörü oluşturulamadı.');
    }
    const clean = {
        version: contract.PISI_PROPERTY_SCHEMA_VERSION,
        definitions: (Array.isArray(schema.definitions) ? schema.definitions : [])
            .map((item) => contract.normalizePropertyDefinition(item))
            .filter(Boolean)
            .slice(0, PISI_PROPERTY_MAX_DEFINITIONS),
        conflicts: Array.isArray(schema.conflicts) ? schema.conflicts.slice(0, 500) : [],
        updatedAt: new Date().toISOString()
    };
    const written = storage.writeJson(PISI_PROPERTY_SCHEMA_KEY, clean, {
        backup: true,
        newline: false,
        hiddenParent: true
    });
    if (!written.ok) {
        throw new Error(written.error || 'Property schema yazılamadı.');
    }
    return clean;
}

function getRawPropertyEntries(properties) {
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
        return [];
    }
    return Object.entries(properties);
}

function makePropertyCarrier(kind, filePath, ownerId, properties, write) {
    return { kind, filePath, ownerId, properties, write };
}

function collectPisiPropertyCarriers(projectFolder) {
    const carriers = [];
    const storage = getPisiPropertyStorage(projectFolder);
    for (const nodePath of walkPisiPropertyNodePaths(projectFolder)) {
        const read = readJsonWithoutMutation(projectFolder, nodePath);
        if (!read.ok || read.data?.pisi?.type !== 'node') continue;
        if (!read.data.properties || typeof read.data.properties !== 'object') continue;
        carriers.push(
            makePropertyCarrier('node', nodePath, read.data.pisi.id || nodePath, read.data.properties, (properties, reason = 'property-schema-change') => {
                const latest = readJsonWithoutMutation(projectFolder, nodePath);
                if (!latest.ok || latest.data?.pisi?.type !== 'node') {
                    throw new Error(`Property güncellemesi sırasında node okunamadı: ${nodePath}`);
                }
                if (typeof globalThis.snapshotPisiNodeVersion === 'function') {
                    const snapshot = globalThis.snapshotPisiNodeVersion(nodePath, reason);
                    if (!snapshot?.ok) throw new Error(snapshot?.error || 'Node history snapshot başarısız.');
                }
                latest.data.properties = properties;
                latest.data.pisi.updatedAt = new Date().toISOString();
                writePisiDocument(nodePath, latest.data);
            })
        );
    }

    const templatePath = storage.resolvePath(PISI_PROPERTY_TEMPLATE_FILE);
    if (storage.exists(PISI_PROPERTY_TEMPLATE_FILE)) {
        const read = readJsonWithoutMutation(projectFolder, templatePath);
        if (read.ok && Array.isArray(read.data?.templates)) {
            read.data.templates.forEach((template, index) => {
                if (!template?.properties || typeof template.properties !== 'object') return;
                carriers.push(
                    makePropertyCarrier('template', templatePath, template.id || `template-${index}`, template.properties, (properties) => {
                        const latest = readJsonWithoutMutation(projectFolder, templatePath);
                        if (!latest.ok || !Array.isArray(latest.data?.templates)) {
                            throw new Error('Property güncellemesi sırasında template store okunamadı.');
                        }
                        const target = latest.data.templates.find((item) => item?.id === template.id) || latest.data.templates[index];
                        if (!target) throw new Error('Property güncellemesi sırasında template bulunamadı.');
                        target.properties = properties;
                        target.updatedAt = new Date().toISOString();
                        const written = storage.writeJson(PISI_PROPERTY_TEMPLATE_FILE, latest.data, {
                            backup: true,
                            newline: false
                        });
                        if (!written.ok) {
                            throw new Error(written.error || 'Property template store yazılamadı.');
                        }
                    })
                );
            });
        }
    }
    return carriers;
}

function ensurePisiPropertySchema(projectFolder) {
    const current = readPisiPropertySchema(projectFolder);
    if (!current.ok) return current;
    if (current.exists) return current;

    return runPisiAtomicMutation(projectFolder, 'property.schema.create.v1', () => {
        const recheck = readPisiPropertySchema(projectFolder);
        if (!recheck.ok) return recheck;
        if (recheck.exists) return recheck;
        const schema = writePisiPropertySchema(projectFolder, {
            definitions: [],
            conflicts: []
        });
        return {
            ok: true,
            exists: true,
            created: true,
            filePath: getPisiPropertySchemaPath(projectFolder),
            schema,
            conflicts: []
        };
    });
}

function getPisiPropertyDefinitionIndexes(schema) {
    const byId = new Map();
    const byName = new Map();
    const occupied = new Set();
    for (const raw of Array.isArray(schema?.definitions) ? schema.definitions : []) {
        const definition = contract.normalizePropertyDefinition(raw);
        if (!definition) continue;
        byId.set(definition.id, definition);
        const key = contract.normalizePropertyNameKey(definition.name);
        if (!byName.has(key)) byName.set(key, definition);
        occupied.add(definition.id);
    }
    return { byId, byName, occupied };
}

function collectPropertyUses(projectFolder, propertyId) {
    const uses = [];
    for (const carrier of collectPisiPropertyCarriers(projectFolder)) {
        for (const [key, property] of getRawPropertyEntries(carrier.properties)) {
            const id = contract.normalizeStablePropertyId(property?.id || key);
            if (id !== propertyId) continue;
            uses.push({ carrier, key, property });
        }
    }
    return uses;
}

function rewritePropertyDefinitionUses(projectFolder, definition, previousType = definition.type) {
    const uses = collectPropertyUses(projectFolder, definition.id);
    const grouped = new Map();
    for (const use of uses) {
        const validation = contract.validatePropertyValue(definition.type, use.property.value);
        if (!validation.ok && !contract.isEmptyPropertyValue(use.property.value)) {
            return {
                ok: false,
                code: 'PROPERTY_TYPE_CHANGE_CONFLICT',
                error: `“${definition.name}” property türü veri kaybetmeden değiştirilemiyor.`,
                conflicts: uses
                    .filter((item) => !contract.canLosslesslyChangePropertyType(item.property.type || previousType, definition.type, item.property.value))
                    .map((item) => ({
                        carrier: item.carrier.kind,
                        ownerId: item.carrier.ownerId,
                        path: item.carrier.filePath
                    }))
            };
        }
        if (
            previousType !== definition.type &&
            !contract.canLosslesslyChangePropertyType(use.property.type || previousType, definition.type, use.property.value)
        ) {
            return {
                ok: false,
                code: 'PROPERTY_TYPE_CHANGE_CONFLICT',
                error: `“${definition.name}” property türü veri kaybetmeden değiştirilemiyor.`,
                conflicts: [
                    {
                        carrier: use.carrier.kind,
                        ownerId: use.carrier.ownerId,
                        path: use.carrier.filePath
                    }
                ]
            };
        }
        let record = grouped.get(use.carrier);
        if (!record) {
            record = { carrier: use.carrier, properties: { ...use.carrier.properties } };
            grouped.set(use.carrier, record);
        }
        delete record.properties[use.key];
        record.properties[definition.id] = {
            ...use.property,
            id: definition.id,
            name: definition.name,
            type: definition.type,
            value: contract.normalizePropertyValue(definition.type, use.property.value)
        };
    }
    for (const record of grouped.values()) {
        record.carrier.write(record.properties, 'property-schema-change');
    }
    return { ok: true, changedCarriers: grouped.size };
}

function resolveSubmittedProperty(schema, submitted, indexes) {
    const name = contract.normalizePropertyName(submitted?.name);
    const type = contract.normalizePropertyType(submitted?.type || 'text');
    if (!name) return { ok: false, code: 'PROPERTY_NAME_REQUIRED', error: 'Property adı gerekli.' };
    if (!contract.isSupportedPropertyType(type)) {
        return {
            ok: false,
            code: 'PROPERTY_TYPE_INVALID',
            error: `Desteklenmeyen property türü: ${String(submitted?.type || '')}`
        };
    }
    const rawId = contract.normalizeStablePropertyId(submitted?.id);
    let definition = rawId ? indexes.byId.get(rawId) : null;
    const byName = indexes.byName.get(contract.normalizePropertyNameKey(name));
    if (!definition && byName) definition = byName;
    if (!definition) {
        const id = rawId && !indexes.occupied.has(rawId) ? rawId : contract.makeNewPropertyId(name, type, indexes.occupied);
        definition = { id, name, type };
        schema.definitions.push(definition);
        indexes.byId.set(id, definition);
        indexes.byName.set(contract.normalizePropertyNameKey(name), definition);
        indexes.occupied.add(id);
        return { ok: true, definition, created: true, previousType: type };
    }
    const previousType = definition.type;
    const nameKey = contract.normalizePropertyNameKey(name);
    const competing = indexes.byName.get(nameKey);
    if (competing && competing.id !== definition.id) {
        return {
            ok: false,
            code: 'PROPERTY_NAME_CONFLICT',
            error: `“${name}” adı başka bir property kimliği tarafından kullanılıyor.`,
            conflictId: competing.id
        };
    }
    if (definition.name !== name) {
        indexes.byName.delete(contract.normalizePropertyNameKey(definition.name));
        definition.name = name;
        indexes.byName.set(nameKey, definition);
    }
    if (definition.type !== type) {
        if (definition.type === 'rollup' || type === 'rollup') {
            return {
                ok: false,
                code: 'PROPERTY_TYPE_CHANGE_FORBIDDEN',
                error: 'Rollup property türü property menüsünden dönüştürülemez.'
            };
        }
        definition.type = type;
    }
    return { ok: true, definition, previousType };
}

function savePisiNodePropertiesStable(projectFolder, nodePath, properties = []) {
    return runPisiAtomicMutation(projectFolder, 'property.node.save.v1', () => {
        const ensured = ensurePisiPropertySchema(projectFolder);
        if (ensured?.then) throw new Error('Nested property schema ensure beklenmedik şekilde async döndü.');
        if (!ensured?.ok) return ensured;
        const schema = JSON.parse(JSON.stringify(ensured.schema));
        const indexes = getPisiPropertyDefinitionIndexes(schema);
        const submittedEntries = getRawPropertyEntries(properties).slice(0, 250);
        const normalized = {};
        const changedDefinitions = new Map();

        for (const [key, raw] of submittedEntries) {
            if (!raw || typeof raw !== 'object') continue;
            const resolved = resolveSubmittedProperty(schema, { ...raw, id: raw.id || key }, indexes);
            if (!resolved.ok) return resolved;
            const { definition, previousType } = resolved;
            if (normalized[definition.id]) {
                return {
                    ok: false,
                    code: 'PROPERTY_DUPLICATE_ID',
                    error: `Aynı property bir node içinde iki kez kullanılamaz: ${definition.name}`
                };
            }
            const validation = contract.validatePropertyValue(definition.type, raw.value);
            if (!validation.ok) {
                return {
                    ok: false,
                    code: validation.code,
                    error: `“${definition.name}” değeri ${definition.type} türüyle uyumlu değil.`
                };
            }
            normalized[definition.id] = {
                id: definition.id,
                name: definition.name,
                type: definition.type,
                value: validation.normalized,
                ...(raw.system === true ? { system: true } : {})
            };
            if (previousType !== definition.type || definition.name !== raw.name) {
                changedDefinitions.set(definition.id, { definition, previousType });
            }
        }

        for (const change of changedDefinitions.values()) {
            const rewrite = rewritePropertyDefinitionUses(projectFolder, change.definition, change.previousType);
            if (!rewrite.ok) return rewrite;
        }

        const nodeInfo = ensurePisiFileMetadata(nodePath);
        if (!nodeInfo.ok || nodeInfo.metadata.type !== 'node') {
            return { ok: false, error: 'Property yalnızca node dosyasına kaydedilebilir.' };
        }
        if (typeof globalThis.snapshotPisiNodeVersion === 'function') {
            const snapshot = globalThis.snapshotPisiNodeVersion(nodePath, 'properties-save');
            if (!snapshot?.ok) return snapshot;
        }
        nodeInfo.data.properties = normalized;
        nodeInfo.data.pisi.updatedAt = new Date().toISOString();
        writePisiDocument(nodePath, nodeInfo.data);
        schema.conflicts = [];
        const writtenSchema = writePisiPropertySchema(projectFolder, schema);
        return {
            ok: true,
            fullPath: nodePath,
            metadata: nodeInfo.data.pisi,
            properties: normalized,
            propertyDefinitions: writtenSchema.definitions,
            schemaVersion: writtenSchema.version
        };
    });
}

function stabilizeTemplateProperties(schema, properties) {
    const indexes = getPisiPropertyDefinitionIndexes(schema);
    const normalized = {};
    for (const [key, raw] of getRawPropertyEntries(properties).slice(0, 250)) {
        if (!raw || typeof raw !== 'object') continue;
        const name = contract.normalizePropertyName(raw.name || key);
        const type = contract.normalizePropertyType(raw.type || 'text');
        if (!name || !contract.isSupportedPropertyType(type)) {
            return { ok: false, code: 'PROPERTY_TEMPLATE_INVALID', error: 'Template içinde geçersiz property tanımı var.' };
        }
        const rawId = contract.normalizeStablePropertyId(raw.id || key);
        let definition = rawId ? indexes.byId.get(rawId) : null;
        if (!definition) definition = indexes.byName.get(contract.normalizePropertyNameKey(name));
        if (!definition) {
            const id = rawId && !indexes.occupied.has(rawId) ? rawId : contract.makeNewPropertyId(name, type, indexes.occupied);
            definition = { id, name, type };
            schema.definitions.push(definition);
            indexes.byId.set(id, definition);
            indexes.byName.set(contract.normalizePropertyNameKey(name), definition);
            indexes.occupied.add(id);
        }
        if (definition.type !== type) {
            return {
                ok: false,
                code: 'PROPERTY_TEMPLATE_TYPE_CONFLICT',
                error: `Template property türü proje şemasıyla uyuşmuyor: ${name}`
            };
        }
        const validation = contract.validatePropertyValue(type, raw.value);
        if (!validation.ok) return { ok: false, code: validation.code, error: `Template property değeri geçersiz: ${name}` };
        normalized[definition.id] = {
            id: definition.id,
            name: definition.name,
            type: definition.type,
            value: validation.normalized,
            ...(raw.system === true ? { system: true } : {})
        };
    }
    return { ok: true, properties: normalized };
}

function savePisiDatabaseTemplateStable(projectFolder, template = {}) {
    return runPisiAtomicMutation(projectFolder, 'property.template.save.v1', () => {
        const ensured = ensurePisiPropertySchema(projectFolder);
        if (!ensured?.ok) return ensured;
        const schema = JSON.parse(JSON.stringify(ensured.schema));
        const normalized = stabilizeTemplateProperties(schema, template.properties || {});
        if (!normalized.ok) return normalized;
        const result = savePisiDatabaseTemplate(projectFolder, {
            ...template,
            properties: normalized.properties
        });
        if (!result?.ok) return result;
        const writtenSchema = writePisiPropertySchema(projectFolder, schema);
        return { ...result, propertyDefinitions: writtenSchema.definitions };
    });
}

function applyPisiDatabaseTemplateStable(projectFolder, nodePath, templateId, options = {}) {
    return runPisiAtomicMutation(projectFolder, 'property.template.apply.v1', () => {
        const ensured = ensurePisiPropertySchema(projectFolder);
        if (!ensured?.ok) return ensured;
        const current = readPisiDatabaseTemplates(projectFolder);
        if (!current?.ok) return current;
        const template = current.templates.find((item) => item.id === String(templateId || ''));
        if (!template) return { ok: false, error: 'Şablon bulunamadı.' };
        const normalized = stabilizeTemplateProperties(JSON.parse(JSON.stringify(ensured.schema)), template.properties || {});
        if (!normalized.ok) return normalized;
        const indexes = getPisiPropertyDefinitionIndexes(ensured.schema);
        for (const property of Object.values(normalized.properties)) {
            const definition = indexes.byId.get(property.id);
            if (!definition || definition.name !== property.name || definition.type !== property.type) {
                return {
                    ok: false,
                    code: 'PROPERTY_TEMPLATE_SCHEMA_CONFLICT',
                    error: `Template proje property şemasıyla uyuşmuyor: ${property.name}`
                };
            }
        }
        return applyPisiDatabaseTemplate(nodePath, templateId, options);
    });
}

function getPisiPropertySchemaDefinitions(projectFolder) {
    const ensured = ensurePisiPropertySchema(projectFolder);
    if (ensured?.then) {
        return ensured.then((result) =>
            result?.ok ? { ok: true, version: result.schema.version, definitions: result.schema.definitions, conflicts: result.schema.conflicts || [] } : result
        );
    }
    return ensured?.ok
        ? { ok: true, version: ensured.schema.version, definitions: ensured.schema.definitions, conflicts: ensured.schema.conflicts || [] }
        : ensured;
}

const moduleApi = {
    PISI_PROPERTY_SCHEMA_VERSION: contract.PISI_PROPERTY_SCHEMA_VERSION,
    PISI_PROPERTY_SCHEMA_RELATIVE_PATH: contract.PISI_PROPERTY_SCHEMA_RELATIVE_PATH,
    PISI_EDITABLE_PROPERTY_TYPES: contract.PISI_EDITABLE_PROPERTY_TYPES,
    PISI_INTERNAL_PROPERTY_TYPES: contract.PISI_INTERNAL_PROPERTY_TYPES,
    getPisiPropertySchemaPath,
    readPisiPropertySchema,
    ensurePisiPropertySchema,
    getPisiPropertySchemaDefinitions,
    collectPisiPropertyCarriers,
    savePisiNodePropertiesStable,
    savePisiDatabaseTemplateStable,
    applyPisiDatabaseTemplateStable,
    stabilizeTemplateProperties,
    propertySchemaContract: contract
};

registerMainModule('main.propertySchemaStore', moduleApi);

export {
    getPisiPropertySchemaPath,
    readPisiPropertySchema,
    ensurePisiPropertySchema,
    getPisiPropertySchemaDefinitions,
    collectPisiPropertyCarriers,
    savePisiNodePropertiesStable,
    savePisiDatabaseTemplateStable,
    applyPisiDatabaseTemplateStable,
    stabilizeTemplateProperties,
    contract as propertySchemaContract
};
export const PISI_PROPERTY_SCHEMA_VERSION = contract.PISI_PROPERTY_SCHEMA_VERSION;
export const PISI_PROPERTY_SCHEMA_RELATIVE_PATH = contract.PISI_PROPERTY_SCHEMA_RELATIVE_PATH;
export const PISI_EDITABLE_PROPERTY_TYPES = contract.PISI_EDITABLE_PROPERTY_TYPES;
export const PISI_INTERNAL_PROPERTY_TYPES = contract.PISI_INTERNAL_PROPERTY_TYPES;
