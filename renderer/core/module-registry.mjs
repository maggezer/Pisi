const bindingOwners = new Map();
const bootOwners = new Map();
const moduleNames = new Set();
let registryRoot = null;
let registrySealed = false;

function getPisiRoot() {
    if (!window.Pisi || typeof window.Pisi !== 'object') {
        window.Pisi = {};
    }

    if (registryRoot && window.Pisi !== registryRoot) {
        throw new Error(
            '[PISI] Renderer Pisi namespace was replaced after module registry initialization.'
        );
    }

    if (!registryRoot) {
        registryRoot = window.Pisi;
    }

    if (!window.Pisi.modules || typeof window.Pisi.modules !== 'object') {
        window.Pisi.modules = Object.create(null);
    }

    return window.Pisi;
}

export function claimRendererBoot(scope, owner) {
    const cleanScope = String(scope || '').trim();
    const cleanOwner = String(owner || '').trim();

    if (!cleanScope || !cleanOwner) {
        throw new Error('[PISI] Renderer boot ownership requires scope and owner.');
    }

    const previousOwner = bootOwners.get(cleanScope);
    if (previousOwner) {
        throw new Error(
            '[PISI] Renderer boot collision: ' +
            cleanScope + ' (' + previousOwner + ' / ' + cleanOwner + ')'
        );
    }

    bootOwners.set(cleanScope, cleanOwner);
    return true;
}

export function registerModule(moduleName, api) {
    if (registrySealed) {
        throw new Error(
            '[PISI] Renderer module registry is sealed; late registration rejected: ' +
            moduleName
        );
    }

    const cleanModuleName = String(moduleName || '').trim();
    if (!cleanModuleName) {
        throw new Error('[PISI] Renderer module name is required.');
    }

    if (!api || typeof api !== 'object') {
        throw new TypeError(
            '[PISI] Renderer module API must be an object: ' + cleanModuleName
        );
    }

    const pisi = getPisiRoot();

    if (moduleNames.has(cleanModuleName)) {
        throw new Error(
            '[PISI] Renderer module already registered: ' + cleanModuleName
        );
    }

    if (Object.prototype.hasOwnProperty.call(pisi.modules, cleanModuleName)) {
        throw new Error(
            '[PISI] Renderer module namespace already exists: ' + cleanModuleName
        );
    }

    const keys = Object.keys(api);
    const localKeys = new Set();

    for (const key of keys) {
        if (localKeys.has(key)) {
            throw new Error(
                '[PISI] Renderer binding registered twice in module: ' +
                cleanModuleName + '.' + key
            );
        }
        localKeys.add(key);

        const previousOwner = bindingOwners.get(key);
        if (previousOwner && previousOwner !== cleanModuleName) {
            throw new Error(
                '[PISI] Renderer binding collision: ' +
                key + ' (' + previousOwner + ' / ' + cleanModuleName + ')'
            );
        }

        if (Object.prototype.hasOwnProperty.call(window, key)) {
            throw new Error('[PISI] Renderer global already exists: ' + key);
        }
    }

    moduleNames.add(cleanModuleName);

    Object.defineProperty(pisi.modules, cleanModuleName, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: api
    });

    for (const key of keys) {
        bindingOwners.set(key, cleanModuleName);

        const apiDescriptor = Object.getOwnPropertyDescriptor(api, key);
        Object.defineProperty(window, key, {
            configurable: false,
            enumerable: false,
            get() {
                return api[key];
            },
            set(value) {
                if (!apiDescriptor?.set) {
                    throw new TypeError(
                        '[PISI] Read-only renderer binding: ' + key
                    );
                }
                api[key] = value;
            }
        });
    }

    return api;
}

export function getRendererOwnershipSnapshot() {
    return Object.freeze({
        sealed: registrySealed,
        modules: Object.freeze([...moduleNames].sort()),
        bindings: Object.freeze(
            Object.fromEntries(
                [...bindingOwners.entries()].sort(([left], [right]) => {
                    return left.localeCompare(right);
                })
            )
        ),
        boots: Object.freeze(
            Object.fromEntries(
                [...bootOwners.entries()].sort(([left], [right]) => {
                    return left.localeCompare(right);
                })
            )
        )
    });
}

export function sealRendererModuleRegistry() {
    if (registrySealed) {
        throw new Error('[PISI] Renderer module registry sealed twice.');
    }

    const pisi = getPisiRoot();
    registrySealed = true;

    Object.defineProperty(pisi, 'moduleOwnership', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: getRendererOwnershipSnapshot()
    });

    Object.freeze(pisi.modules);
    return pisi.moduleOwnership;
}
