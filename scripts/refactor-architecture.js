'use strict';

const fs = require('fs');
const path = require('path');
const espree = require('espree');

const root = path.resolve(__dirname, '..');

function absolute(relativePath) {
    return path.join(root, relativePath);
}

function read(relativePath) {
    return fs.readFileSync(absolute(relativePath), 'utf8');
}

function write(relativePath, content) {
    const filePath = absolute(relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content.replace(/\r\n/g, '\n').replace(/\s+$/g, '') + '\n', 'utf8');
}

function remove(relativePath) {
    fs.rmSync(absolute(relativePath), { recursive: true, force: true });
}

function parse(source, sourceType = 'script') {
    return espree.parse(source, {
        ecmaVersion: 'latest',
        sourceType,
        range: true,
        loc: true,
        comment: true
    });
}

function collectPatternNames(pattern, target = []) {
    if (!pattern) return target;
    if (pattern.type === 'Identifier') {
        target.push(pattern.name);
        return target;
    }
    if (pattern.type === 'RestElement') {
        return collectPatternNames(pattern.argument, target);
    }
    if (pattern.type === 'AssignmentPattern') {
        return collectPatternNames(pattern.left, target);
    }
    if (pattern.type === 'ArrayPattern') {
        pattern.elements.forEach((element) => collectPatternNames(element, target));
        return target;
    }
    if (pattern.type === 'ObjectPattern') {
        pattern.properties.forEach((property) => {
            collectPatternNames(property.value || property.argument, target);
        });
    }
    return target;
}

function declarationBindings(node) {
    if (node.type === 'FunctionDeclaration' && node.id) {
        return [{ name: node.id.name, mutable: false, kind: 'function' }];
    }
    if (node.type !== 'VariableDeclaration') return [];
    return node.declarations.flatMap((declaration) => {
        return collectPatternNames(declaration.id).map((name) => ({
            name,
            mutable: node.kind !== 'const',
            kind: node.kind
        }));
    });
}

function uniqueBindings(bindings) {
    const result = [];
    const seen = new Set();
    for (const binding of bindings) {
        if (seen.has(binding.name)) continue;
        seen.add(binding.name);
        result.push(binding);
    }
    return result;
}

function buildApiCode(moduleName, bindings, registerName) {
    const unique = uniqueBindings(bindings);
    if (!unique.length) return '';
    const descriptors = unique.map((binding) => {
        const setter = binding.mutable
            ? `,\n        set(value) { ${binding.name} = value; }`
            : '';
        return `    ${JSON.stringify(binding.name)}: {\n        enumerable: true,\n        get() { return ${binding.name}; }${setter}\n    }`;
    }).join(',\n');
    return `\nconst moduleApi = {};\nObject.defineProperties(moduleApi, {\n${descriptors}\n});\n${registerName}(${JSON.stringify(moduleName)}, moduleApi);\n`;
}

function sourceForNodes(source, nodes) {
    return nodes
        .sort((a, b) => a.range[0] - b.range[0])
        .map((node) => source.slice(node.range[0], node.range[1]).trim())
        .filter(Boolean)
        .join('\n\n');
}

function createRendererRegistry() {
    write('renderer/core/module-registry.mjs', `const bindingOwners = new Map();

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
        throw new Error(`[PISI] Renderer module already registered: ${moduleName}`);
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
                `[PISI] Renderer binding collision: ${key} (${previousOwner} / ${moduleName})`
            );
        }
        bindingOwners.set(key, moduleName);

        if (Object.prototype.hasOwnProperty.call(window, key)) {
            throw new Error(`[PISI] Renderer global already exists: ${key}`);
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
                    throw new TypeError(`[PISI] Read-only renderer binding: ${key}`);
                }
                api[key] = value;
            }
        });
    }

    pisi.moduleOwners = Object.fromEntries(bindingOwners);
    return api;
}
`);
}

function rendererGroupFor(filePath, line) {
    if (filePath === 'app.js') {
        if (line <= 782) return ['renderer/editor/pisi-editor-paint.mjs', 'editor.paint'];
        if (line <= 1356) return ['renderer/editor/pisi-editor-sheet.mjs', 'editor.sheet'];
        if (line <= 1518) return ['renderer/shell/pisi-window.mjs', 'shell.window'];
        if (line <= 2407) return ['renderer/shell/pisi-tabs.mjs', 'shell.tabs'];
        if (line <= 2575) return ['renderer/shell/pisi-startup.mjs', 'shell.startup'];
        if (line <= 2706) return ['renderer/shell/pisi-dialogs.mjs', 'shell.dialogs'];
        return ['renderer/shell/pisi-customizations.mjs', 'shell.customizations'];
    }
    if (filePath === 'renderer/pisi-tree.js') {
        if (line <= 219) return ['renderer/tree/pisi-project.mjs', 'tree.project'];
        if (line <= 850) return ['renderer/tree/pisi-tree-dnd.mjs', 'tree.dragDrop'];
        return ['renderer/tree/pisi-tree-view.mjs', 'tree.view'];
    }
    if (filePath === 'renderer/pisi-map-workspace.js') {
        if (line <= 800) return ['renderer/map/pisi-map-workspace.mjs', 'map.workspace'];
        return ['renderer/editor/pisi-node-editor.mjs', 'editor.node'];
    }
    if (filePath === 'renderer/pisi-tags.js') {
        if (line <= 741) return ['renderer/tags/pisi-tag-index.mjs', 'tags.index'];
        if (line <= 1400) return ['renderer/tags/pisi-tag-panels.mjs', 'tags.panels'];
        return ['renderer/tags/pisi-tag-editor.mjs', 'tags.editor'];
    }
    if (filePath === 'renderer/pisi-calendar.js') {
        return ['renderer/calendar/pisi-calendar.mjs', 'calendar'];
    }
    if (filePath === 'renderer/pisi-node-modal.js') {
        return ['renderer/editor/pisi-node-preview.mjs', 'editor.preview'];
    }
    if (filePath === 'renderer/pisi-map-connections.js') {
        if (line <= 717) return ['renderer/map/pisi-map-interactions.mjs', 'map.interactions'];
        return ['renderer/map/pisi-map-edges.mjs', 'map.edges'];
    }
    throw new Error(`No renderer group for ${filePath}:${line}`);
}

function refactorRenderer() {
    const originalFiles = [
        'app.js',
        'renderer/pisi-tree.js',
        'renderer/pisi-map-workspace.js',
        'renderer/pisi-tags.js',
        'renderer/pisi-calendar.js',
        'renderer/pisi-node-modal.js',
        'renderer/pisi-map-connections.js'
    ];
    const modules = new Map();
    const runtimePieces = [];
    let stateSource = '';

    for (const filePath of originalFiles) {
        const source = read(filePath);
        const ast = parse(source, 'script');
        for (const node of ast.body) {
            const bindings = declarationBindings(node);
            if (bindings.length) {
                const [outputPath, moduleName] = rendererGroupFor(
                    filePath,
                    node.loc.start.line
                );
                if (!modules.has(outputPath)) {
                    modules.set(outputPath, { moduleName, nodes: [], bindings: [], source });
                }
                const entry = modules.get(outputPath);
                entry.nodes.push(node);
                entry.bindings.push(...bindings);
                continue;
            }

            const text = source.slice(node.range[0], node.range[1]).trim();
            if (
                filePath === 'app.js' &&
                node.type === 'ExpressionStatement' &&
                node.loc.start.line <= 2 &&
                node.loc.end.line <= 150
            ) {
                stateSource = text;
            } else if (text) {
                runtimePieces.push(`// From ${filePath}:${node.loc.start.line}\n${text}`);
            }
        }
    }

    if (!stateSource) {
        throw new Error('Renderer state initializer could not be isolated.');
    }

    createRendererRegistry();
    write('renderer/core/state.mjs', `${stateSource}\n\nexport {};`);

    const manifest = [];
    for (const [outputPath, entry] of modules) {
        const relativeRegistry = path.posix.relative(
            path.posix.dirname(outputPath),
            'renderer/core/module-registry.mjs'
        );
        const importPath = relativeRegistry.startsWith('.')
            ? relativeRegistry
            : `./${relativeRegistry}`;
        const code = sourceForNodes(entry.source, entry.nodes);
        const registration = buildApiCode(
            entry.moduleName,
            entry.bindings,
            'registerModule'
        );
        write(outputPath, `import { registerModule } from ${JSON.stringify(importPath)};\n\n${code}\n${registration}`);
        manifest.push({
            module: entry.moduleName,
            path: outputPath,
            bindings: uniqueBindings(entry.bindings).map((binding) => binding.name)
        });
    }

    write('renderer/runtime.mjs', `${runtimePieces.join('\n\n')}\n\nexport {};`);

    const importOrder = [
        './core/state.mjs',
        './editor/pisi-editor-paint.mjs',
        './editor/pisi-editor-sheet.mjs',
        './shell/pisi-window.mjs',
        './shell/pisi-tabs.mjs',
        './shell/pisi-startup.mjs',
        './shell/pisi-dialogs.mjs',
        './shell/pisi-customizations.mjs',
        './tree/pisi-project.mjs',
        './tree/pisi-tree-dnd.mjs',
        './tree/pisi-tree-view.mjs',
        './map/pisi-map-workspace.mjs',
        './editor/pisi-node-editor.mjs',
        './tags/pisi-tag-index.mjs',
        './tags/pisi-tag-panels.mjs',
        './tags/pisi-tag-editor.mjs',
        './calendar/pisi-calendar.mjs',
        './editor/pisi-node-preview.mjs',
        './map/pisi-map-interactions.mjs',
        './map/pisi-map-edges.mjs',
        './runtime.mjs'
    ];
    write(
        'renderer/bootstrap.mjs',
        `${importOrder.map((item) => `import ${JSON.stringify(item)};`).join('\n')}\n\nexport {};`
    );
    write('renderer/module-manifest.json', JSON.stringify(manifest, null, 2));

    for (const filePath of originalFiles) remove(filePath);
}

function createMainRegistry() {
    write('main/module-registry.js', `'use strict';

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
                `[PISI] Main binding collision: ${key} (${previousOwner} / ${moduleName})`
            );
        }
        if (Object.prototype.hasOwnProperty.call(moduleApi, key)) {
            throw new Error(`[PISI] Main binding registered twice: ${moduleName}.${key}`);
        }
        bindingOwners.set(key, moduleName);

        const descriptor = Object.getOwnPropertyDescriptor(api, key);
        Object.defineProperty(moduleApi, key, descriptor);

        if (Object.prototype.hasOwnProperty.call(globalThis, key)) {
            throw new Error(`[PISI] Main global already exists: ${key}`);
        }
        Object.defineProperty(globalThis, key, {
            configurable: false,
            enumerable: false,
            get() {
                return moduleApi[key];
            },
            set(value) {
                if (!descriptor?.set) {
                    throw new TypeError(`[PISI] Read-only main binding: ${key}`);
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
`);
}

function mainGroupFor(line) {
    if (line <= 900) return ['main/functions/filesystem-core.js', 'main.filesystemCore'];
    if (line <= 1800) return ['main/functions/document-store.js', 'main.documentStore'];
    if (line <= 2700) return ['main/functions/map-store.js', 'main.mapStore'];
    if (line <= 3600) return ['main/functions/project-operations.js', 'main.projectOperations'];
    return ['main/functions/electron-ipc.js', 'main.electronIpc'];
}

function mainImports() {
    return `const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell } = require('electron');\nconst path = require('path');\nconst fs = require('fs');\nconst crypto = require('crypto');`;
}

function refactorMain() {
    const source = read('main.js');
    const ast = parse(source, 'script');
    const functionModules = new Map();
    const runtimePieces = [];
    const standardNames = new Set([
        'app', 'BrowserWindow', 'Menu', 'ipcMain', 'dialog', 'screen', 'shell',
        'path', 'fs', 'crypto'
    ]);

    for (const node of ast.body) {
        if (node.type === 'FunctionDeclaration') {
            const [outputPath, moduleName] = mainGroupFor(node.loc.start.line);
            if (!functionModules.has(outputPath)) {
                functionModules.set(outputPath, { moduleName, nodes: [], bindings: [] });
            }
            const entry = functionModules.get(outputPath);
            entry.nodes.push(node);
            entry.bindings.push(...declarationBindings(node));
            continue;
        }

        const text = source.slice(node.range[0], node.range[1]).trim();
        if (!text) continue;
        runtimePieces.push(text);
        if (node.type === 'VariableDeclaration') {
            const bindings = declarationBindings(node).filter((binding) => {
                return !standardNames.has(binding.name);
            });
            if (bindings.length) {
                runtimePieces.push(buildApiCode('main.runtime', bindings, 'registerMainModule'));
            }
        }
    }

    createMainRegistry();
    const manifest = [];
    for (const [outputPath, entry] of functionModules) {
        const code = sourceForNodes(source, entry.nodes);
        const registration = buildApiCode(
            entry.moduleName,
            entry.bindings,
            'registerMainModule'
        );
        write(outputPath, `'use strict';\n\n${mainImports()}\nconst { registerMainModule } = require('../module-registry');\n\n${code}\n${registration}`);
        manifest.push({
            module: entry.moduleName,
            path: outputPath,
            bindings: uniqueBindings(entry.bindings).map((binding) => binding.name)
        });
    }

    write(
        'main/runtime.js',
        `'use strict';\n\nconst { registerMainModule } = require('./module-registry');\n\n${runtimePieces.join('\n\n')}`
    );
    write('main/module-manifest.json', JSON.stringify(manifest, null, 2));

    const requires = [
        './main/functions/filesystem-core',
        './main/functions/document-store',
        './main/functions/map-store',
        './main/functions/project-operations',
        './main/functions/electron-ipc',
        './main/runtime'
    ];
    write('main.js', `'use strict';\n\n${requires.map((item) => `require(${JSON.stringify(item)});`).join('\n')}`);
}

function scanRootBlocks(css) {
    const blocks = [];
    let cursor = 0;
    let index = 0;

    function skipString(start, quote) {
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
    }

    function skipComment(start) {
        const end = css.indexOf('*/', start + 2);
        return end === -1 ? css.length : end + 2;
    }

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
        const close = index;
        const rawPrelude = css.slice(cursor, open);
        const withoutComments = rawPrelude.replace(/\/\*[\s\S]*?\*\//g, '');
        const selector = withoutComments.trim().replace(/\s+/g, ' ');
        blocks.push({
            start: cursor,
            open,
            end: close,
            selector,
            rawPrelude,
            body: css.slice(open + 1, close - 1),
            text: css.slice(cursor, close)
        });
        cursor = close;
    }

    if (cursor < css.length) {
        blocks.push({
            start: cursor,
            open: -1,
            end: css.length,
            selector: '',
            rawPrelude: css.slice(cursor),
            body: '',
            text: css.slice(cursor)
        });
    }
    return blocks;
}

function parseDeclarations(body) {
    const declarations = [];
    let current = '';
    let quote = null;
    let depth = 0;
    for (let index = 0; index < body.length; index += 1) {
        const char = body[index];
        if (quote) {
            current += char;
            if (char === '\\') {
                current += body[index + 1] || '';
                index += 1;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            current += char;
            continue;
        }
        if (char === '(' || char === '[') depth += 1;
        if (char === ')' || char === ']') depth -= 1;
        if (char === ';' && depth === 0) {
            declarations.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    if (current.trim()) declarations.push(current);

    return declarations.map((item) => item.replace(/\/\*[\s\S]*?\*\//g, '').trim())
        .filter(Boolean)
        .map((item) => {
            const colon = item.indexOf(':');
            if (colon === -1) return null;
            return {
                property: item.slice(0, colon).trim(),
                value: item.slice(colon + 1).trim()
            };
        })
        .filter(Boolean);
}

function mergeCssSelectors(css, selectors) {
    const blocks = scanRootBlocks(css);
    const replacements = [];

    for (const selector of selectors) {
        const matches = blocks.filter((block) => block.selector === selector);
        if (matches.length < 2) continue;
        const order = [];
        const values = new Map();
        for (const block of matches) {
            for (const declaration of parseDeclarations(block.body)) {
                if (!values.has(declaration.property)) order.push(declaration.property);
                values.set(declaration.property, declaration.value);
            }
        }
        const first = matches[0];
        const rawTrimmed = first.rawPrelude.trimEnd();
        const cleanSelector = rawTrimmed.replace(/^(?:\s|\/\*[\s\S]*?\*\/)+/g, '').trim();
        const selectorIndex = rawTrimmed.lastIndexOf(cleanSelector);
        const leading = selectorIndex >= 0
            ? rawTrimmed.slice(0, selectorIndex)
            : '';
        const body = order.map((property) => {
            return `    ${property}: ${values.get(property)};`;
        }).join('\n');
        replacements.push({
            start: first.start,
            end: first.end,
            text: `${leading}${selector} {\n${body}\n}`
        });
        for (const duplicate of matches.slice(1)) {
            replacements.push({ start: duplicate.start, end: duplicate.end, text: '' });
        }
    }

    replacements.sort((a, b) => b.start - a.start);
    let output = css;
    for (const replacement of replacements) {
        output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
    }
    return output;
}

function refactorCss() {
    let css = read('style.css');
    css = mergeCssSelectors(css, [
        '.tree-name',
        '.map-node-box',
        '.map-node-title',
        '.map-port',
        '#map-board',
        '#map-connections',
        '.map-edge',
        '.map-temp-edge',
        '.map-edge.co-level',
        '.map-edge.stream',
        '.map-port.connecting-source',
        '#arrow-downhub path',
        '#arrow-stream path',
        '#left-panel',
        '#right-panel'
    ]);
    css = css.replace(/\s*!important\b/g, '');
    css = css.replace(
        /(^|\n)(\s*)\.map-port\.connecting-source\s*\{/,
        '$1$2.map-node-box .map-port.connecting-source {'
    );
    css = css.replace(/\n{4,}/g, '\n\n\n');

    const remainingDuplicates = new Map();
    for (const block of scanRootBlocks(css)) {
        if (!block.selector || block.selector.startsWith('@')) continue;
        if (!remainingDuplicates.has(block.selector)) remainingDuplicates.set(block.selector, 0);
        remainingDuplicates.set(block.selector, remainingDuplicates.get(block.selector) + 1);
    }
    const duplicates = [...remainingDuplicates.entries()].filter(([, count]) => count > 1);
    if (duplicates.length) {
        throw new Error(`CSS duplicate selectors remain: ${JSON.stringify(duplicates)}`);
    }
    if (/!important\b/.test(css)) {
        throw new Error('CSS !important declarations remain.');
    }

    remove('styles');
    const blocks = scanRootBlocks(css);
    const chunks = [];
    let chunk = '';
    let chunkLines = 0;
    for (const block of blocks) {
        const text = block.text;
        const lines = text.split(/\r?\n/).length;
        if (chunk && chunkLines + lines > 430) {
            chunks.push(chunk);
            chunk = '';
            chunkLines = 0;
        }
        chunk += text;
        chunkLines += lines;
    }
    if (chunk.trim()) chunks.push(chunk);

    const names = [
        '00-foundation.css',
        '10-tree-and-map.css',
        '20-map-interactions.css',
        '30-panels-and-tabs.css',
        '40-editor.css',
        '50-tags-and-missions.css',
        '60-customization.css',
        '70-components.css',
        '80-responsive.css'
    ];
    const imports = [];
    chunks.forEach((content, index) => {
        const fileName = names[index] || `${String(index * 10).padStart(2, '0')}-section.css`;
        write(`styles/${fileName}`, content);
        imports.push(`@import url("./styles/${fileName}") layer(pisi);`);
    });
    write('style.css', imports.join('\n'));
}

function updateIndex() {
    let html = read('index.html');
    html = html.replace(
        /\s*<script src="app\.js"><\/script>[\s\S]*?<script src="renderer\/pisi-map-connections\.js"><\/script>\s*/,
        '\n    <script type="module" src="renderer/bootstrap.mjs"></script>\n'
    );
    if (!html.includes('renderer/bootstrap.mjs')) {
        throw new Error('index.html module bootstrap replacement failed.');
    }
    write('index.html', html);
}

function rewritePackage() {
    const packageJson = JSON.parse(read('package.json'));
    packageJson.scripts['check:architecture'] = 'node scripts/check-architecture.js';
    packageJson.scripts.validate = 'npm run check:syntax && npm run check:architecture && npm run lint && npm test';
    packageJson.build.files = packageJson.build.files
        .filter((item) => item !== 'app.js')
        .filter((item) => item !== 'main.js');
    packageJson.build.files.unshift('main.js', 'main/**/*');
    if (!packageJson.build.files.includes('styles/**/*')) {
        packageJson.build.files.push('styles/**/*');
    }
    write('package.json', JSON.stringify(packageJson, null, 2));
}

function rewriteSyntaxCheck() {
    write('scripts/check-syntax.js', `'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const ignoredDirectories = new Set([
    '.git', 'coverage', 'dist', 'node_modules', 'out', 'release',
    'android', '.gradle', 'build'
]);

function collectJavaScriptFiles(directoryPath) {
    const files = [];
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) {
                files.push(...collectJavaScriptFiles(path.join(directoryPath, entry.name)));
            }
            continue;
        }
        if (entry.isFile() && /\\.(?:js|mjs)$/.test(entry.name)) {
            files.push(path.join(directoryPath, entry.name));
        }
    }
    return files;
}

const files = collectJavaScriptFiles(projectRoot).sort();
let failed = false;
for (const filePath of files) {
    const result = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' });
    if (result.status !== 0) {
        failed = true;
        process.stderr.write(result.stderr || result.stdout);
    }
}
if (failed) process.exitCode = 1;
else console.log(`${files.length} JavaScript/ES module dosyası sözdizimi kontrolünden geçti.`);
`);
}

function rewriteEslint() {
    write('eslint.config.js', `'use strict';

const correctnessRules = {
    'no-constant-binary-expression': 'error',
    'no-dupe-keys': 'error',
    'no-redeclare': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error'
};

const browserGlobals = {
    alert: 'readonly',
    cancelAnimationFrame: 'readonly',
    CSS: 'readonly',
    document: 'readonly',
    Element: 'readonly',
    fetch: 'readonly',
    InputEvent: 'readonly',
    localStorage: 'readonly',
    MutationObserver: 'readonly',
    Node: 'readonly',
    requestAnimationFrame: 'readonly',
    URL: 'readonly',
    window: 'readonly'
};

module.exports = [
    {
        ignores: [
            'dist/**', 'node_modules/**', 'android/**/build/**',
            'android/.gradle/**', '.gradle/**'
        ]
    },
    {
        files: [
            'eslint.config.js', 'main.js', 'main/**/*.js', 'preload.js',
            'scripts/**/*.js', 'tests/**/*.js'
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                Buffer: 'readonly', __dirname: 'readonly', clearTimeout: 'readonly',
                console: 'readonly', exports: 'readonly', globalThis: 'readonly',
                module: 'readonly', process: 'readonly', require: 'readonly',
                setTimeout: 'readonly', structuredClone: 'readonly',
                ...browserGlobals
            }
        },
        rules: { ...correctnessRules, 'no-undef': 'error' }
    },
    {
        files: ['renderer/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: browserGlobals
        },
        rules: correctnessRules
    }
];
`);
}

function createArchitectureCheck() {
    write('scripts/check-architecture.js', `'use strict';

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
            if (css[i] === '\\\\') { i += 2; continue; }
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
        if (css.startsWith('/*', index)) { index = skipComment(index); continue; }
        if (css[index] === '"' || css[index] === "'") { index = skipString(index, css[index]); continue; }
        if (css[index] !== '{') { index += 1; continue; }
        const open = index;
        let depth = 1;
        index += 1;
        while (index < css.length && depth > 0) {
            if (css.startsWith('/*', index)) { index = skipComment(index); continue; }
            if (css[index] === '"' || css[index] === "'") { index = skipString(index, css[index]); continue; }
            if (css[index] === '{') depth += 1;
            if (css[index] === '}') depth -= 1;
            index += 1;
        }
        const prelude = css.slice(cursor, open).replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').trim().replace(/\\s+/g, ' ');
        if (prelude && !prelude.startsWith('@')) selectors.push(prelude);
        cursor = index;
    }
    return selectors;
}

const errors = [];
const html = read('index.html');
const moduleScripts = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((match) => match[1]);
if (moduleScripts.length !== 1 || moduleScripts[0] !== 'renderer/bootstrap.mjs') {
    errors.push(`Expected one renderer module bootstrap, found: ${moduleScripts.join(', ')}`);
}
if (/<script[^>]+src="(?:app|renderer\\/[^\"]+)\\.js"/.test(html)) {
    errors.push('Classic renderer scripts remain in index.html.');
}

for (const oldFile of [
    'app.js', 'renderer/pisi-tree.js', 'renderer/pisi-map-workspace.js',
    'renderer/pisi-tags.js', 'renderer/pisi-calendar.js',
    'renderer/pisi-node-modal.js', 'renderer/pisi-map-connections.js'
]) {
    if (fs.existsSync(path.join(root, oldFile))) errors.push(`Legacy renderer file remains: ${oldFile}`);
}

const manifests = [
    JSON.parse(read('renderer/module-manifest.json')),
    JSON.parse(read('main/module-manifest.json'))
];
for (const manifest of manifests) {
    const owners = new Map();
    for (const module of manifest) {
        for (const binding of module.bindings) {
            if (owners.has(binding)) {
                errors.push(`Duplicate module binding ${binding}: ${owners.get(binding)} / ${module.module}`);
            }
            owners.set(binding, module.module);
        }
    }
}

for (const file of walk('renderer', '.mjs')) {
    const lines = read(file).split(/\\r?\\n/).length;
    if (file !== 'renderer/runtime.mjs' && lines > 1000) {
        errors.push(`Renderer module too large (${lines}): ${file}`);
    }
}
for (const file of walk('main/functions', '.js')) {
    const lines = read(file).split(/\\r?\\n/).length;
    if (lines > 1100) errors.push(`Main domain module too large (${lines}): ${file}`);
}
if (read('main.js').split(/\\r?\\n/).length > 40) errors.push('main.js is not a thin bootstrap.');

const selectorOwners = new Map();
for (const file of walk('styles', '.css')) {
    const css = read(file);
    if (/!important\\b/.test(css)) errors.push(`!important remains in ${file}`);
    for (const selector of scanRootSelectors(css)) {
        if (selectorOwners.has(selector)) {
            errors.push(`Duplicate CSS selector ${selector}: ${selectorOwners.get(selector)} / ${file}`);
        }
        selectorOwners.set(selector, file);
    }
}

if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('Architecture boundaries, CSS cascade and module sizes are valid.');
`);
}

function rewriteTests() {
    write('tests/source-bundle.js', `'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function collect(directory, extension) {
    const files = [];
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
        const relative = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...collect(relative, extension));
        else if (entry.name.endsWith(extension)) files.push(relative);
    }
    return files.sort();
}

function readMany(files) {
    return files.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n\n');
}

function readMainSource() {
    return readMany(collect('main/functions', '.js'));
}

function readRendererSource() {
    return readMany(collect('renderer', '.mjs'));
}

module.exports = { collect, readMainSource, readRendererSource, readMany };
`);

    let formula = read('tests/formula.test.js');
    formula = formula.replace(
        /const appSource = fs\.readFileSync\([\s\S]*?\);\nconst formulaFunctionNames/,
        `const appSource = fs.readFileSync(\n    path.resolve(__dirname, '..', 'renderer/editor/pisi-editor-sheet.mjs'),\n    'utf8'\n);\nconst formulaFunctionNames`
    );
    write('tests/formula.test.js', formula);

    for (const testFile of ['tests/security.test.js', 'tests/data-integrity.test.js']) {
        let source = read(testFile);
        source = source.replace(
            /const mainSource = fs\.readFileSync\([\s\S]*?\);/,
            `const { readMainSource } = require('./source-bundle');\nconst mainSource = readMainSource();`
        );
        write(testFile, source);
    }

    write('tests/source-invariants.test.js', `'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { collect, readMainSource, readRendererSource, readMany } = require('./source-bundle');

const root = path.resolve(__dirname, '..');
const read = (filePath) => fs.readFileSync(path.join(root, filePath), 'utf8');
const rendererSource = readRendererSource();
const mainSource = `${read('main.js')}\n${readMainSource()}\n${read('main/runtime.js')}`;
const treeSource = readMany(collect('renderer/tree', '.mjs'));
const mapSource = readMany(collect('renderer/map', '.mjs'));
const editorSource = readMany(collect('renderer/editor', '.mjs'));

test('renderer formülleri eval veya Function constructor kullanmaz', () => {
    assert.doesNotMatch(rendererSource, /\\beval\\s*\\(/);
    assert.doesNotMatch(rendererSource, /\\bFunction\\s*\\(/);
});

test('Electron güvenlik sınırları üretim ayarlarında korunur', () => {
    const html = read('index.html');
    assert.match(mainSource, /sandbox:\\s*true/);
    assert.match(mainSource, /nodeIntegration:\\s*false/);
    assert.match(mainSource, /contextIsolation:\\s*true/);
    assert.match(mainSource, /setWindowOpenHandler/);
    assert.match(mainSource, /will-navigate/);
    assert.match(mainSource, /setPermissionRequestHandler/);
    assert.match(html, /style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'/);
    assert.doesNotMatch(html, /script-src[^;]*(?:'unsafe-inline'|'unsafe-eval')/);
});

test('Paint geçici yükleme nitelikleri kalıcı HTML içine yazılmaz', () => {
    assert.match(editorSource, /removeAttribute\\('data-image-loaded'\\)/);
    assert.match(mapSource, /removeAttribute\\('data-image-loaded'\\)/);
    assert.doesNotMatch(mapSource, /globallyAllowedAttributes[\\s\\S]{0,500}data-image-loaded/);
});

test('Paint PNG zemini ve ağaç yenilemesi görünür regresyon üretmez', () => {
    assert.match(editorSource, /function resetPisiCanvasToWhite\\(/);
    assert.match(editorSource, /function ensurePisiCanvasWhiteBackground\\(/);
    assert.doesNotMatch(editorSource, /globalCompositeOperation\\s*=\\s*['"]destination-out['"]/);
    assert.match(treeSource, /document\\.createDocumentFragment\\(\\)/);
    assert.match(treeSource, /treeEl\\.replaceChildren\\(/);
});

test('renderer yalnızca tek ES module bootstrap üzerinden yüklenir', () => {
    const html = read('index.html');
    assert.match(html, /<script type="module" src="renderer\\/bootstrap\\.mjs"><\\/script>/);
    assert.doesNotMatch(html, /<script src="(?:app|renderer\\/[^\"]+)\\.js"><\\/script>/);
});

test('preload API anahtarları ve kritik DOM kontrolleri tekildir', () => {
    const preload = read('preload.js');
    const html = read('index.html');
    assert.equal((preload.match(/deleteNodeFromMap\\s*:/g) || []).length, 1);
    assert.match(html, /id="node-modal-close"/);
    assert.match(html, /id="node-modal-title"/);
    assert.match(html, /id="center-node-editor-title"/);
    assert.match(html, /id="center-node-editor-save"/);
});

test('kullanılmayan production paketleri geri eklenmez', () => {
    const packageJson = JSON.parse(read('package.json'));
    assert.deepEqual(packageJson.dependencies || {}, {});
    assert.equal(packageJson.devDependencies.electron, '^43.2.0');
    assert.equal(packageJson.devDependencies['electron-builder'], '^26.15.7');
});
`);
}

function main() {
    refactorRenderer();
    refactorMain();
    refactorCss();
    updateIndex();
    rewritePackage();
    rewriteSyntaxCheck();
    rewriteEslint();
    createArchitectureCheck();
    rewriteTests();
    remove('architecture-analysis.json');
    console.log('Architecture refactor applied.');
}

main();
