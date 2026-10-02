'use strict';

const fs = require('fs');
const path = require('path');
const { registerMainModule, modules } = require('../module-registry');

const schemaStore = modules['main.propertySchemaStore'];
const contract = schemaStore.propertySchemaContract;

function cloneSchema(schema) {
    return JSON.parse(JSON.stringify(schema || {}));
}

function getDefinitionIndexes(schema) {
    const byId = new Map();
    const byName = new Map();
    const occupied = new Set();
    const normalizedDefinitions = [];
    for (const raw of Array.isArray(schema?.definitions) ? schema.definitions : []) {
        const definition = contract.normalizePropertyDefinition(raw);
        if (!definition) continue;
        normalizedDefinitions.push(definition);
        byId.set(definition.id, definition);
        const nameKey = contract.normalizePropertyNameKey(definition.name);
        if (!byName.has(nameKey)) byName.set(nameKey, definition);
        occupied.add(definition.id);
    }
    schema.definitions = normalizedDefinitions;
    return { byId, byName, occupied };
}

function getEntries(properties = {}) {
    if (!properties || typeof properties !== 'object') return [];
    return Array.isArray(properties) ? properties.map((item, index) => [item?.id || item?.name || String(index), item]) : Object.entries(properties);
}

function writeSchema(projectFolder, schema) {
    const schemaPath = schemaStore.getPisiPropertySchemaPath(projectFolder);
    fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
    const payload = {
        version: schemaStore.PISI_PROPERTY_SCHEMA_VERSION,
        definitions: (schema.definitions || []).map((item) => contract.normalizePropertyDefinition(item)).filter(Boolean),
        conflicts: Array.isArray(schema.conflicts) ? schema.conflicts : [],
        updatedAt: new Date().toISOString()
    };
    writeFileAtomic(schemaPath, JSON.stringify(payload, null, 2), { backup: true });
    return payload;
}

function resolveSubmittedDefinition(schema, indexes, rawKey, raw = {}) {
    const name = contract.normalizePropertyName(raw.name || rawKey);
    const type = contract.normalizePropertyType(raw.type || 'text');
    if (!name) return { ok: false, code: 'PROPERTY_NAME_REQUIRED', error: 'Property adı gerekli.' };
    if (!contract.isSupportedPropertyType(type)) {
        return {
            ok: false,
            code: 'PROPERTY_TYPE_INVALID',
            error: `Desteklenmeyen property türü: ${String(raw.type || '')}`
        };
    }
    const rawId = contract.normalizeStablePropertyId(raw.id || rawKey);
    let definition = rawId ? indexes.byId.get(rawId) : null;
    if (!definition) {
        definition = indexes.byName.get(contract.normalizePropertyNameKey(name));
    }
    if (!definition) {
        const id = rawId && !indexes.occupied.has(rawId) ? rawId : contract.makeNewPropertyId(name, type, indexes.occupied);
        definition = { id, name, type };
        schema.definitions.push(definition);
        indexes.byId.set(id, definition);
        indexes.byName.set(contract.normalizePropertyNameKey(name), definition);
        indexes.occupied.add(id);
        return {
            ok: true,
            definition,
            created: true,
            previousName: name,
            previousType: type
        };
    }

    const previousName = definition.name;
    const previousType = definition.type;
    const desiredNameKey = contract.normalizePropertyNameKey(name);
    const competing = indexes.byName.get(desiredNameKey);
    if (competing && competing.id !== definition.id) {
        return {
            ok: false,
            code: 'PROPERTY_NAME_CONFLICT',
            error: `“${name}” adı başka bir property kimliği tarafından kullanılıyor.`,
            conflictId: competing.id
        };
    }
    if (previousType !== type && (previousType === 'rollup' || type === 'rollup')) {
        return {
            ok: false,
            code: 'PROPERTY_TYPE_CHANGE_FORBIDDEN',
            error: 'Rollup property türü property menüsünden dönüştürülemez.'
        };
    }

    if (previousName !== name) {
        indexes.byName.delete(contract.normalizePropertyNameKey(previousName));
        definition.name = name;
        indexes.byName.set(desiredNameKey, definition);
    }
    if (previousType !== type) definition.type = type;
    return { ok: true, definition, previousName, previousType };
}

function prepareDefinitionRewrite(projectFolder, change) {
    const { definition, previousName, previousType } = change;
    const carrierChanges = [];
    for (const carrier of schemaStore.collectPisiPropertyCarriers(projectFolder)) {
        let changed = false;
        const next = { ...carrier.properties };
        for (const [rawKey, property] of getEntries(carrier.properties)) {
            if (!property || typeof property !== 'object') continue;
            const id = contract.normalizeStablePropertyId(property.id || rawKey);
            if (id !== definition.id) continue;
            if (previousType !== definition.type && !contract.canLosslesslyChangePropertyType(property.type || previousType, definition.type, property.value)) {
                return {
                    ok: false,
                    code: 'PROPERTY_TYPE_CHANGE_CONFLICT',
                    error: `“${definition.name}” property türü veri kaybetmeden değiştirilemiyor.`,
                    conflict: {
                        carrier: carrier.kind,
                        ownerId: carrier.ownerId,
                        path: carrier.filePath,
                        propertyId: definition.id,
                        fromType: previousType,
                        toType: definition.type
                    }
                };
            }
            const validation = contract.validatePropertyValue(definition.type, property.value);
            if (!validation.ok && !contract.isEmptyPropertyValue(property.value)) {
                return {
                    ok: false,
                    code: validation.code,
                    error: `“${definition.name}” için mevcut değer yeni şemayla uyumlu değil.`,
                    conflict: {
                        carrier: carrier.kind,
                        ownerId: carrier.ownerId,
                        path: carrier.filePath,
                        propertyId: definition.id
                    }
                };
            }
            delete next[rawKey];
            next[definition.id] = {
                ...property,
                id: definition.id,
                name: definition.name,
                type: definition.type,
                value: validation.ok ? validation.normalized : contract.normalizePropertyValue(definition.type, property.value)
            };
            changed =
                changed ||
                rawKey !== definition.id ||
                property.name !== definition.name ||
                property.type !== definition.type ||
                previousName !== definition.name ||
                previousType !== definition.type;
        }
        if (changed) carrierChanges.push({ carrier, properties: next });
    }
    return { ok: true, carrierChanges };
}

function savePisiNodePropertiesBySchema(projectFolder, nodePath, properties = {}) {
    return runPisiAtomicMutation(projectFolder, 'property.node.save.v1', () => {
        const ensured = schemaStore.ensurePisiPropertySchema(projectFolder);
        if (ensured?.then) {
            throw new Error('Property schema nested migration senkron tamamlanamadı.');
        }
        if (!ensured?.ok) return ensured;
        const schema = cloneSchema(ensured.schema);
        const indexes = getDefinitionIndexes(schema);
        const normalized = {};
        const rewrites = new Map();

        for (const [rawKey, raw] of getEntries(properties).slice(0, 250)) {
            if (!raw || typeof raw !== 'object') continue;
            const resolved = resolveSubmittedDefinition(schema, indexes, rawKey, raw);
            if (!resolved.ok) return resolved;
            const { definition } = resolved;
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
            if (resolved.previousName !== definition.name || resolved.previousType !== definition.type) {
                rewrites.set(definition.id, resolved);
            }
        }

        const preparedRewrites = [];
        for (const change of rewrites.values()) {
            const prepared = prepareDefinitionRewrite(projectFolder, change);
            if (!prepared.ok) return prepared;
            preparedRewrites.push(...prepared.carrierChanges);
        }

        for (const rewrite of preparedRewrites) {
            if (rewrite.carrier.kind === 'node' && path.resolve(rewrite.carrier.filePath) === path.resolve(nodePath)) {
                continue;
            }
            rewrite.carrier.write(rewrite.properties, 'property-schema-change');
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
        const written = writeSchema(projectFolder, schema);
        return {
            ok: true,
            fullPath: nodePath,
            metadata: nodeInfo.data.pisi,
            properties: normalized,
            propertyDefinitions: written.definitions,
            schemaVersion: written.version
        };
    });
}

const moduleApi = {
    savePisiNodePropertiesBySchema,
    preparePisiPropertyDefinitionRewrite: prepareDefinitionRewrite,
    resolveSubmittedPisiPropertyDefinition: resolveSubmittedDefinition
};
registerMainModule('main.propertySchemaMutations', moduleApi);

module.exports = moduleApi;
