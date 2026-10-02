'use strict';

// Keeps module ownership, file-size limits and CSS cascade rules enforceable in CI.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function walk(directory, extension) {
    const result = [];
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
        const relative = path.posix.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...walk(relative, extension));
        else if (entry.name.endsWith(extension)) result.push(relative);
    }
    return result;
}

function scanRootSelectors(css) {
    const selectors = [];
    let cursor = 0;
    let index = 0;
    const skipString = (start, quote) => {
        let i = start + 1;
        while (i < css.length) {
            if (css[i] === '\\') {
                i += 2;
                continue;
            }
            if (css[i] === quote) return i + 1;
            i += 1;
        }
        return i;
    };
    const skipComment = (start) => {
        const end = css.indexOf('*/', start + 2);
        return end === -1 ? css.length : end + 2;
    };
    while (index < css.length) {
        if (css.startsWith('/*', index)) {
            index = skipComment(index);
            continue;
        }
        if (css[index] === '"' || css[index] === "'") {
            index = skipString(index, css[index]);
            continue;
        }
        if (css[index] !== '{') {
            index += 1;
            continue;
        }
        const open = index;
        let depth = 1;
        index += 1;
        while (index < css.length && depth > 0) {
            if (css.startsWith('/*', index)) {
                index = skipComment(index);
                continue;
            }
            if (css[index] === '"' || css[index] === "'") {
                index = skipString(index, css[index]);
                continue;
            }
            if (css[index] === '{') depth += 1;
            if (css[index] === '}') depth -= 1;
            index += 1;
        }
        const prelude = css
            .slice(cursor, open)
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .trim()
            .replace(/\s+/g, ' ');
        if (prelude && !prelude.startsWith('@')) selectors.push(prelude);
        cursor = index;
    }
    return selectors;
}

function readBalancedObject(source, start) {
    if (source[start] !== '{') throw new Error('Expected object literal.');
    let depth = 1;
    let index = start + 1;
    let quote = null;
    let escaped = false;

    while (index < source.length) {
        const char = source[index];

        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                quote = null;
            }
            index += 1;
            continue;
        }

        if (char === '"' || char === "'" || char === '`') {
            quote = char;
            index += 1;
            continue;
        }

        if (source.startsWith('//', index)) {
            const end = source.indexOf('\n', index + 2);
            index = end === -1 ? source.length : end + 1;
            continue;
        }

        if (source.startsWith('/*', index)) {
            const end = source.indexOf('*/', index + 2);
            index = end === -1 ? source.length : end + 2;
            continue;
        }

        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
        index += 1;
    }

    throw new Error('Unterminated module API object.');
}

function splitTopLevelObjectEntries(objectSource) {
    const body = objectSource.slice(1, -1);
    const entries = [];
    let start = 0;
    let brace = 0;
    let bracket = 0;
    let paren = 0;
    let quote = null;
    let escaped = false;

    for (let index = 0; index < body.length; index += 1) {
        const char = body[index];

        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = null;
            continue;
        }

        if (char === '"' || char === "'" || char === '`') {
            quote = char;
            continue;
        }

        if (char === '{') brace += 1;
        else if (char === '}') brace -= 1;
        else if (char === '[') bracket += 1;
        else if (char === ']') bracket -= 1;
        else if (char === '(') paren += 1;
        else if (char === ')') paren -= 1;
        else if (char === ',' && brace === 0 && bracket === 0 && paren === 0) {
            entries.push(body.slice(start, index));
            start = index + 1;
        }
    }

    entries.push(body.slice(start));
    return entries.map((entry) => entry.trim()).filter(Boolean);
}

function moduleApiKeys(objectSource) {
    return splitTopLevelObjectEntries(objectSource).map((entry) => {
        if (entry.startsWith('...')) {
            throw new Error('Module API spread is not ownership-auditable.');
        }

        let match = entry.match(/^["']([^"']+)["']\s*:/);
        if (!match) match = entry.match(/^(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*:/);
        if (!match) match = entry.match(/^([A-Za-z_$][\w$]*)\s*\(/);
        if (!match) match = entry.match(/^([A-Za-z_$][\w$]*)\s*$/);

        if (!match) {
            throw new Error('Unsupported module API entry: ' + entry.slice(0, 100));
        }

        return match[1];
    });
}

function resolveModuleApiObject(source, identifier, beforeIndex) {
    const defineNeedle = 'Object.defineProperties(' + identifier + ',';
    const declarationNeedles = ['const ' + identifier + ' =', 'let ' + identifier + ' =', 'var ' + identifier + ' ='];

    let ownerIndex = source.lastIndexOf(defineNeedle, beforeIndex);
    for (const needle of declarationNeedles) {
        ownerIndex = Math.max(ownerIndex, source.lastIndexOf(needle, beforeIndex));
    }

    if (ownerIndex < 0) {
        throw new Error('Cannot resolve module API object: ' + identifier);
    }

    const objectStart = source.indexOf('{', ownerIndex);
    if (objectStart < 0 || objectStart >= beforeIndex) {
        throw new Error('Cannot locate module API object: ' + identifier);
    }

    return readBalancedObject(source, objectStart);
}

function scanModuleRegistrations(file, registerName) {
    const source = read(file);
    const pattern = new RegExp('\\b' + registerName + '\\s*\\(\\s*(["\\\'])([^"\\\']+)\\1\\s*,', 'g');
    const result = [];
    let match;

    while ((match = pattern.exec(source)) !== null) {
        let cursor = pattern.lastIndex;
        while (/\s/.test(source[cursor] || '')) cursor += 1;

        let apiSource;
        if (source[cursor] === '{') {
            apiSource = readBalancedObject(source, cursor);
        } else {
            const identifier = source.slice(cursor).match(/^([A-Za-z_$][\w$]*)/)?.[1];
            if (!identifier) {
                throw new Error(file + ': unsupported module API argument.');
            }
            apiSource = resolveModuleApiObject(source, identifier, match.index);
        }

        result.push({
            module: match[2],
            path: file,
            bindings: moduleApiKeys(apiSource)
        });
    }

    return result;
}

function auditSourceModuleOwnership(manifests) {
    const registrations = [];

    for (const file of walk('renderer', '.mjs')) {
        registrations.push(...scanModuleRegistrations(file, 'registerModule'));
    }
    for (const file of [...walk('main/functions', '.js'), 'main/runtime.js']) {
        registrations.push(...scanModuleRegistrations(file, 'registerMainModule'));
    }

    const moduleOwners = new Map();
    const bindingOwners = new Map();

    for (const registration of registrations) {
        const world = registration.path.startsWith('renderer/') ? 'renderer' : 'main';
        const moduleKey = world + '::' + registration.module;
        const previousModulePath = moduleOwners.get(moduleKey);

        if (previousModulePath && previousModulePath !== registration.path) {
            errors.push('Module owner collision [' + world + '] ' + registration.module + ': ' + previousModulePath + ' / ' + registration.path);
        } else if (!previousModulePath) {
            moduleOwners.set(moduleKey, registration.path);
        }

        for (const binding of registration.bindings) {
            const bindingKey = world + '::' + binding;
            const previous = bindingOwners.get(bindingKey);
            if (previous) {
                errors.push(
                    'Source binding collision [' +
                        world +
                        '] ' +
                        binding +
                        ': ' +
                        previous.module +
                        ' @ ' +
                        previous.path +
                        ' / ' +
                        registration.module +
                        ' @ ' +
                        registration.path
                );
            } else {
                bindingOwners.set(bindingKey, registration);
            }
        }
    }

    for (const manifest of manifests) {
        for (const entry of manifest) {
            const matches = registrations.filter((registration) => registration.module === entry.module && registration.path === entry.path);

            if (!matches.length) {
                errors.push('Manifest owner has no source registration: ' + entry.module + ' @ ' + entry.path);
                continue;
            }

            const actual = new Set(matches.flatMap((match) => match.bindings));
            const expected = new Set(entry.bindings);

            const missing = [...expected].filter((binding) => !actual.has(binding));
            const extra = [...actual].filter((binding) => !expected.has(binding));

            if (missing.length) {
                errors.push('Manifest binding missing in source ' + entry.module + ': ' + missing.join(', '));
            }

            if (extra.length) {
                errors.push('Unowned source binding ' + entry.module + ': ' + extra.join(', '));
            }
        }
    }

    return {
        modules: moduleOwners.size,
        bindings: bindingOwners.size
    };
}

const errors = [];
const html = read('index.html');
const moduleScripts = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((match) => match[1]);
if (moduleScripts.length !== 1 || moduleScripts[0] !== 'renderer/bootstrap.mjs') {
    errors.push('Expected one renderer module bootstrap, found: ' + moduleScripts.join(', '));
}
if (/<script[^>]+src="(?:app|renderer\/[^\"]+)\.js"/.test(html)) {
    errors.push('Classic renderer scripts remain in index.html.');
}

for (const oldFile of [
    'app.js',
    'renderer/pisi-tree.js',
    'renderer/pisi-map-workspace.js',
    'renderer/pisi-tags.js',
    'renderer/pisi-calendar.js',
    'renderer/pisi-node-modal.js',
    'renderer/pisi-map-connections.js'
]) {
    if (fs.existsSync(path.join(root, oldFile))) errors.push('Legacy renderer file remains: ' + oldFile);
}

const manifests = [JSON.parse(read('renderer/module-manifest.json')), JSON.parse(read('main/module-manifest.json'))];
for (const manifest of manifests) {
    const owners = new Map();
    for (const module of manifest) {
        for (const binding of module.bindings) {
            if (owners.has(binding)) {
                errors.push('Duplicate module binding ' + binding + ': ' + owners.get(binding) + ' / ' + module.module);
            }
            owners.set(binding, module.module);
        }
    }
}

let ownershipAudit = { modules: 0, bindings: 0 };
try {
    ownershipAudit = auditSourceModuleOwnership(manifests);
} catch (error) {
    errors.push('Module ownership audit failed: ' + error.message);
}

for (const file of walk('renderer', '.mjs')) {
    const lines = read(file).split(/\r?\n/).length;
    const limit = file === 'renderer/tags/pisi-todo-third-release.mjs' ? 1050 : 1000;
    if (file !== 'renderer/runtime.mjs' && lines > limit) {
        errors.push('Renderer module too large (' + lines + '): ' + file);
    }
}
for (const file of walk('main/functions', '.js')) {
    const lines = read(file).split(/\r?\n/).length;
    if (lines > 1100) errors.push('Main domain module too large (' + lines + '): ' + file);
}
if (read('main.mjs').split(/\r?\n/).length > 40) errors.push('main.mjs is not a thin bootstrap.');

const rootPackage = JSON.parse(read('package.json'));
const mainPackage = JSON.parse(read('main/package.json'));
if (rootPackage.main !== 'main.mjs') errors.push('package.json main entry must be main.mjs.');
if (mainPackage.type !== 'module') errors.push('main/package.json must declare type=module.');
const mainBootstrap = read('main.mjs');
if (/\brequire\s*\(|\bmodule\.exports\b/.test(mainBootstrap)) {
    errors.push('CommonJS syntax remains in main.mjs.');
}
for (const file of [...walk('main/functions', '.js'), 'main/runtime.js', 'main/module-registry.js']) {
    const source = read(file);
    if (/\brequire\s*\(|\bmodule\.exports\b/.test(source)) {
        errors.push('CommonJS syntax remains in ESM main module: ' + file);
    }
}

const expectedStyleBundles = [
    'styles/00-core.css',
    'styles/50-features.css',
    'styles/80-themes.css',
    'styles/90-overrides.css',
    'styles/100-late-features.css',
    'styles/110-runtime-modules.css'
];

const actualStyleBundles = walk('styles', '.css');
const missingStyleBundles = expectedStyleBundles.filter((file) => !actualStyleBundles.includes(file));
const unexpectedStyleBundles = actualStyleBundles.filter((file) => !expectedStyleBundles.includes(file));
if (missingStyleBundles.length) errors.push('Missing consolidated CSS bundle(s): ' + missingStyleBundles.join(', '));
if (unexpectedStyleBundles.length) errors.push('Unexpected legacy CSS file(s): ' + unexpectedStyleBundles.join(', '));

const rendererCssFiles = walk('renderer', '.css');
if (rendererCssFiles.length) {
    errors.push('Renderer-local CSS remains after consolidation: ' + rendererCssFiles.join(', '));
}

const styleIndex = read('style.css');
const styleImports = [...styleIndex.matchAll(/@import\s+url\(['"]([^'"]+)['"]\)(\s+layer\(pisi\))?\s*;/g)].map((match) => ({
    path: match[1],
    layered: Boolean(match[2])
}));
const expectedStyleImports = [
    { path: './styles/00-core.css', layered: true },
    { path: './styles/50-features.css', layered: true },
    { path: './styles/80-themes.css', layered: true },
    { path: './styles/90-overrides.css', layered: true },
    { path: './styles/100-late-features.css', layered: true },
    { path: './styles/110-runtime-modules.css', layered: false }
];
if (JSON.stringify(styleImports) !== JSON.stringify(expectedStyleImports)) {
    errors.push('style.css must load only the six consolidated bundles in canonical cascade order.');
}

for (const file of walk('renderer', '.mjs')) {
    const source = read(file);
    if (/['"`][^'"`]*\.css['"`]/.test(source)) {
        errors.push('Renderer module still references CSS directly: ' + file);
    }
}

const selectorOwners = new Map();
for (const file of walk('styles', '.css')) {
    const css = read(file);
    if (/!important\b/.test(css)) errors.push('!important remains in ' + file);
    for (const selector of scanRootSelectors(css)) {
        if (selectorOwners.has(selector)) {
            errors.push('Duplicate CSS selector ' + selector + ': ' + selectorOwners.get(selector) + ' / ' + file);
        }
        selectorOwners.set(selector, file);
    }
}

if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(
    'Architecture boundaries, source ownership (' +
        ownershipAudit.modules +
        ' modules / ' +
        ownershipAudit.bindings +
        ' bindings), CSS cascade and module sizes are valid.'
);
