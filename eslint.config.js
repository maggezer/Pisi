'use strict';

const fs = require('fs');
const path = require('path');
const espree = require('espree');

const correctnessRules = {
    'no-constant-binary-expression': 'error',
    'no-dupe-keys': 'error',
    'no-redeclare': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error'
};

const unusedRules = {
    'no-unused-vars': [
        'error',
        {
            args: 'after-used',
            argsIgnorePattern: '^_',
            caughtErrors: 'none',
            ignoreRestSiblings: true
        }
    ]
};

function loadManifestGlobals(relativePath) {
    const filePath = path.join(__dirname, relativePath);
    if (!fs.existsSync(filePath)) return {};
    const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Object.fromEntries(manifest.flatMap((entry) => entry.bindings || []).map((name) => [name, 'writable']));
}

function collectPatternNames(pattern, names) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') {
        names.add(pattern.name);
        return;
    }
    if (pattern.type === 'RestElement') {
        collectPatternNames(pattern.argument, names);
        return;
    }
    if (pattern.type === 'AssignmentPattern') {
        collectPatternNames(pattern.left, names);
        return;
    }
    if (pattern.type === 'ArrayPattern') {
        pattern.elements.forEach((item) => collectPatternNames(item, names));
        return;
    }
    if (pattern.type === 'ObjectPattern') {
        pattern.properties.forEach((property) => {
            collectPatternNames(property.value || property.argument, names);
        });
    }
}

function loadRuntimeGlobals(relativePath) {
    const filePath = path.join(__dirname, relativePath);
    if (!fs.existsSync(filePath)) return {};
    const source = fs.readFileSync(filePath, 'utf8');
    const ast = espree.parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'module'
    });
    const names = new Set();
    for (const statement of ast.body) {
        if (statement.type !== 'VariableDeclaration') continue;
        for (const declaration of statement.declarations) {
            collectPatternNames(declaration.id, names);
        }
    }
    return Object.fromEntries([...names].map((name) => [name, 'writable']));
}

const nodeGlobals = {
    Buffer: 'readonly',
    __dirname: 'readonly',
    clearTimeout: 'readonly',
    console: 'readonly',
    exports: 'readonly',
    globalThis: 'readonly',
    module: 'readonly',
    process: 'readonly',
    require: 'readonly',
    setTimeout: 'readonly',
    structuredClone: 'readonly'
};

const preloadBrowserGlobals = {
    CustomEvent: 'readonly',
    document: 'readonly',
    fetch: 'readonly',
    localStorage: 'readonly',
    MutationObserver: 'readonly',
    Node: 'readonly',
    URL: 'readonly',
    window: 'readonly'
};

module.exports = [
    {
        ignores: ['dist/**', 'node_modules/**', 'android/**/build/**', 'android/.gradle/**', '.gradle/**']
    },
    {
        files: ['eslint.config.js', 'preload.js', 'scripts/**/*.js', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: { ...nodeGlobals, ...preloadBrowserGlobals }
        },
        rules: { ...correctnessRules, 'no-undef': 'error' }
    },
    {
        files: ['main.mjs', 'main/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...nodeGlobals,
                ...loadManifestGlobals('main/module-manifest.json'),
                ...loadRuntimeGlobals('main/runtime.js')
            }
        },
        rules: { ...correctnessRules, ...unusedRules, 'no-undef': 'error' }
    },
    {
        files: ['renderer/**/*.mjs'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        rules: { ...correctnessRules, ...unusedRules }
    }
];
