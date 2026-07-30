'use strict';

const modules = Object.create(null);
const bindingOwners = new Map();

function registerMainModule(moduleName, api) {
    if (!modules[moduleName]) {
        modules[moduleName] = {};
    }
    const moduleApi = modules[moduleName];

    for (const key of Object.keys(api)) {
        const previousOwner = bindingOwners.get(key);
        if (previousOwner && previousOwner !== moduleName) {
            throw new Error(
                '[PISI] Main binding collision: ' + key + ' (' + previousOwner + ' / ' + moduleName + ')'
            );
        }
        if (Object.prototype.hasOwnProperty.call(moduleApi, key)) {
            throw new Error('[PISI] Main binding registered twice: ' + moduleName + '.' + key);
        }
        bindingOwners.set(key, moduleName);

        const descriptor = Object.getOwnPropertyDescriptor(api, key);
        Object.defineProperty(moduleApi, key, descriptor);

        if (Object.prototype.hasOwnProperty.call(globalThis, key)) {
            throw new Error('[PISI] Main global already exists: ' + key);
        }
        Object.defineProperty(globalThis, key, {
            configurable: false,
            enumerable: false,
            get() {
                return moduleApi[key];
            },
            set(value) {
                if (!descriptor?.set) {
                    throw new TypeError('[PISI] Read-only main binding: ' + key);
                }
                moduleApi[key] = value;
            }
        });
    }

    return moduleApi;
}

module.exports = {
    modules,
    registerMainModule
};
