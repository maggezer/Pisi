const PISI_PROJECTION_INDEX_CONTRACT_VERSION = 1;

const PISI_PROJECTION_INDEX_STATES = Object.freeze({
    EMPTY: 'empty',
    STALE: 'stale',
    BUILDING: 'building',
    READY: 'ready',
    FAILED: 'failed'
});

function normalizeProjectionIndexToken(value = '') {
    return String(value ?? '')
        .trim()
        .slice(0, 500);
}

function hashProjectionIndexText(value = '') {
    let hash = 2166136261;
    const text = String(value ?? '');
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function makePisiProjectionSourceFingerprint(parts = []) {
    const normalized = (Array.isArray(parts) ? parts : [parts])
        .map((part) => normalizeProjectionIndexToken(part))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'en'));
    return `fp1:${normalized.length}:${hashProjectionIndexText(normalized.join('\u001f'))}`;
}

function assertPisiProjectionIndexDriver(driver) {
    for (const method of ['replaceAll', 'applyDelta', 'snapshot', 'clear']) {
        if (typeof driver?.[method] !== 'function') {
            throw new TypeError(`Projection index driver metodu eksik: ${method}`);
        }
    }
    return driver;
}

function normalizeProjectionDelta(delta = {}) {
    const upsert = Array.isArray(delta.upsert) ? delta.upsert.filter((record) => record && typeof record === 'object' && record.id) : [];
    const remove = Array.from(new Set((Array.isArray(delta.remove) ? delta.remove : []).map((id) => String(id || '').trim()).filter(Boolean)));
    return { upsert, remove };
}

function createPisiRebuildableProjectionIndex(options = {}) {
    const name = normalizeProjectionIndexToken(options.name || 'projection');
    const schemaVersion = Math.max(1, Number(options.schemaVersion) || 1);
    const driver = assertPisiProjectionIndexDriver(options.driver);
    let generation = 0;
    /** @type {{
     * contractVersion: number,
     * schemaVersion: number,
     * name: string,
     * driver: string,
     * state: string,
     * generation: number,
     * sourceFingerprint: string,
     * builtAt: number | null,
     * recordCount: number,
     * staleReason: string | null,
     * error: string | null
     * }} */
    let manifest = {
        contractVersion: PISI_PROJECTION_INDEX_CONTRACT_VERSION,
        schemaVersion,
        name,
        driver: normalizeProjectionIndexToken(driver.id || 'unknown'),
        state: PISI_PROJECTION_INDEX_STATES.EMPTY,
        generation,
        sourceFingerprint: '',
        builtAt: null,
        recordCount: 0,
        staleReason: null,
        error: null
    };

    const publish = (patch = {}) => {
        manifest = Object.freeze({ ...manifest, ...patch });
        return manifest;
    };

    function invalidate(reason = 'source-changed') {
        generation += 1;
        publish({
            state: PISI_PROJECTION_INDEX_STATES.STALE,
            generation,
            staleReason: normalizeProjectionIndexToken(reason) || 'source-changed',
            error: null
        });
        return manifest;
    }

    function beginBuild(sourceFingerprint = '') {
        generation += 1;
        publish({
            state: PISI_PROJECTION_INDEX_STATES.BUILDING,
            generation,
            sourceFingerprint: normalizeProjectionIndexToken(sourceFingerprint),
            staleReason: null,
            error: null
        });
        return generation;
    }

    function replaceAll(records = [], metadata = {}) {
        const buildGeneration = beginBuild(metadata.sourceFingerprint || '');
        try {
            driver.replaceAll(Array.isArray(records) ? records : [], metadata);
            const snapshot = driver.snapshot();
            publish({
                state: PISI_PROJECTION_INDEX_STATES.READY,
                generation: buildGeneration,
                sourceFingerprint: normalizeProjectionIndexToken(metadata.sourceFingerprint || ''),
                builtAt: Number(metadata.builtAt) || Date.now(),
                recordCount: Array.isArray(snapshot?.records) ? snapshot.records.length : 0,
                staleReason: null,
                error: null
            });
            return { ...snapshot, projection: manifest };
        } catch (error) {
            publish({
                state: PISI_PROJECTION_INDEX_STATES.FAILED,
                generation: buildGeneration,
                error: error?.message || String(error),
                staleReason: 'build-failed'
            });
            throw error;
        }
    }

    function applyDelta(delta = {}, metadata = {}) {
        const normalized = normalizeProjectionDelta(delta);
        if (manifest.state !== PISI_PROJECTION_INDEX_STATES.READY) {
            return { ok: false, requiresRebuild: true, projection: manifest };
        }
        generation += 1;
        try {
            driver.applyDelta(normalized, metadata);
            const snapshot = driver.snapshot();
            publish({
                state: PISI_PROJECTION_INDEX_STATES.READY,
                generation,
                sourceFingerprint: normalizeProjectionIndexToken(metadata.sourceFingerprint || manifest.sourceFingerprint),
                builtAt: Number(metadata.builtAt) || Date.now(),
                recordCount: Array.isArray(snapshot?.records) ? snapshot.records.length : 0,
                staleReason: null,
                error: null
            });
            return { ok: true, ...snapshot, projection: manifest };
        } catch (error) {
            publish({
                state: PISI_PROJECTION_INDEX_STATES.FAILED,
                generation,
                error: error?.message || String(error),
                staleReason: 'delta-failed'
            });
            return { ok: false, requiresRebuild: true, error: manifest.error, projection: manifest };
        }
    }

    function clear(reason = 'cleared') {
        driver.clear();
        generation += 1;
        publish({
            state: PISI_PROJECTION_INDEX_STATES.EMPTY,
            generation,
            sourceFingerprint: '',
            builtAt: null,
            recordCount: 0,
            staleReason: normalizeProjectionIndexToken(reason),
            error: null
        });
        return manifest;
    }

    function snapshot() {
        return { ...driver.snapshot(), projection: manifest };
    }

    function isCompatible(candidate = {}) {
        return candidate?.contractVersion === PISI_PROJECTION_INDEX_CONTRACT_VERSION && candidate?.schemaVersion === schemaVersion && candidate?.name === name;
    }

    return Object.freeze({
        contractVersion: PISI_PROJECTION_INDEX_CONTRACT_VERSION,
        schemaVersion,
        name,
        invalidate,
        replaceAll,
        applyDelta,
        clear,
        snapshot,
        isCompatible,
        getManifest: () => manifest
    });
}

export {
    PISI_PROJECTION_INDEX_CONTRACT_VERSION,
    PISI_PROJECTION_INDEX_STATES,
    createPisiRebuildableProjectionIndex,
    makePisiProjectionSourceFingerprint,
    normalizeProjectionDelta
};
