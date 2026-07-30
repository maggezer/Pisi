const bindingOwners = new Map();

function getPisiRoot() {
    if (!window.Pisi || typeof window.Pisi !== 'object') {
        window.Pisi = {};
    }
    if (!window.Pisi.modules || typeof window.Pisi.modules !== 'object') {
        window.Pisi.modules = Object.create(null);
    }
    return window.Pisi;
}

export function registerModule(moduleName, api) {
    const pisi = getPisiRoot();
    if (Object.prototype.hasOwnProperty.call(pisi.modules, moduleName)) {
        throw new Error('[PISI] Renderer module already registered: ' + moduleName);
    }

    Object.defineProperty(pisi.modules, moduleName, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: api
    });

    for (const key of Object.keys(api)) {
        const previousOwner = bindingOwners.get(key);
        if (previousOwner && previousOwner !== moduleName) {
            throw new Error(
                '[PISI] Renderer binding collision: ' + key + ' (' + previousOwner + ' / ' + moduleName + ')'
            );
        }
        bindingOwners.set(key, moduleName);

        if (Object.prototype.hasOwnProperty.call(window, key)) {
            throw new Error('[PISI] Renderer global already exists: ' + key);
        }

        const apiDescriptor = Object.getOwnPropertyDescriptor(api, key);
        Object.defineProperty(window, key, {
            configurable: false,
            enumerable: false,
            get() {
                return api[key];
            },
            set(value) {
                if (!apiDescriptor?.set) {
                    throw new TypeError('[PISI] Read-only renderer binding: ' + key);
                }
                api[key] = value;
            }
        });
    }

    pisi.moduleOwners = Object.fromEntries(bindingOwners);
    return api;
}
