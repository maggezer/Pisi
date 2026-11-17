// The phone's secret store for Pisi Sync (docs/sync-plan.md S5 step 1): the
// repo's own Capacitor plugin (android/…/PisiSecretsPlugin.java) wraps each
// value with an Android Keystore key and keeps the wrapped file in
// Directory.Data/sync/secrets/. In a browser (vite dev, E2E) the values live
// in memory only, so a reload forgets the pairing.

import { Capacitor, registerPlugin } from '@capacitor/core';

const PisiSecrets = registerPlugin('PisiSecrets');

/** `{ get(name) → string | null, put(name, value), remove(name) }`. */
export function createSecrets({ native = Capacitor.isNativePlatform() } = {}) {
    if (native) {
        return {
            async get(name) {
                const { value } = await PisiSecrets.get({ name });
                return typeof value === 'string' ? value : null;
            },
            put: (name, value) => PisiSecrets.put({ name, value: String(value) }).then(() => {}),
            remove: (name) => PisiSecrets.remove({ name }).then(() => {})
        };
    }
    const values = new Map();
    return {
        get: async (name) => values.get(name) ?? null,
        put: async (name, value) => void values.set(name, String(value)),
        remove: async (name) => void values.delete(name)
    };
}
