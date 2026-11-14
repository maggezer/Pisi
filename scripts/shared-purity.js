'use strict';

// Purity rules for shared/: the code that the desktop (main and renderer) and
// the mobile app all import. A shared module may use only the language
// built-ins and other shared modules, and importing it must do nothing.
// scripts/check-architecture.js runs this audit; eslint.config.js reuses the
// lint rules so editors show the same errors.

const { Linter } = require('eslint');

// ECMAScript globals that open a door to the host, so no-undef does not catch them.
const SHARED_RESTRICTED_GLOBALS = [
    { name: 'globalThis', message: 'shared/ modules cannot reach host globals through globalThis.' },
    { name: 'eval', message: 'shared/ modules cannot use eval.' },
    { name: 'Function', message: 'shared/ modules cannot build code with Function.' }
];

// With no globals configured, no-undef leaves only the language built-ins:
// window, document, process, console, crypto, timers and registry bindings fail.
/** @type {import('eslint').Linter.RulesRecord} */
const SHARED_LINT_RULES = {
    'no-undef': 'error',
    'no-restricted-globals': ['error', ...SHARED_RESTRICTED_GLOBALS],
    'no-restricted-syntax': [
        'error',
        { selector: 'ImportExpression', message: 'shared/ modules cannot use dynamic import().' },
        { selector: 'MetaProperty[meta.name="import"]', message: 'shared/ modules cannot use import.meta.' },
        { selector: 'StaticBlock', message: 'shared/ classes cannot run static blocks at import time.' },
        { selector: 'PropertyDefinition[static=true]', message: 'shared/ classes cannot hold static state.' }
    ]
};

// Another module of the same folder: no packages, no node:*, no path out of shared/.
const SHARED_IMPORT_SOURCE = /^\.\/[A-Za-z0-9][A-Za-z0-9._-]*\.mjs$/;
// Calls that only build a value. Everything else at the top level counts as an import-time effect.
const PURE_CALLS = new Set(['Object.freeze']);
const PURE_CONSTRUCTORS = new Set(['Set', 'Map', 'RegExp']);

function calleeName(node) {
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier' && node.property.type === 'Identifier') {
        return `${node.object.name}.${node.property.name}`;
    }
    return '';
}

/** Returns the first node of a top-level initializer that could run code with an effect, or null. */
function findImpureNode(node) {
    if (!node) return null;
    const first = (nodes) => {
        for (const item of nodes) {
            const found = findImpureNode(item);
            if (found) return found;
        }
        return null;
    };

    switch (node.type) {
        case 'Literal':
        case 'Identifier':
        case 'TemplateElement':
        // A function body does not run when the module is imported.
        case 'ArrowFunctionExpression':
        case 'FunctionExpression':
            return null;
        case 'TemplateLiteral':
            return first(node.expressions);
        case 'ArrayExpression':
            return first(node.elements);
        case 'ObjectExpression':
            return first(node.properties);
        case 'Property':
            return first([node.computed ? node.key : null, node.value]);
        case 'SpreadElement':
            return findImpureNode(node.argument);
        case 'UnaryExpression':
            return node.operator === 'delete' ? node : findImpureNode(node.argument);
        case 'BinaryExpression':
        case 'LogicalExpression':
            return first([node.left, node.right]);
        case 'ConditionalExpression':
            return first([node.test, node.consequent, node.alternate]);
        case 'MemberExpression':
            return first([node.object, node.computed ? node.property : null]);
        case 'ChainExpression':
            return findImpureNode(node.expression);
        case 'NewExpression':
            return node.callee.type === 'Identifier' && PURE_CONSTRUCTORS.has(node.callee.name) ? first(node.arguments) : node;
        case 'CallExpression':
            return PURE_CALLS.has(calleeName(node.callee)) ? first(node.arguments) : node;
        default:
            return node;
    }
}

/**
 * Audits one shared module. `file` is its repo-relative path. `options.exists`
 * (optional) tells whether an imported sibling, given by file name, exists.
 * Returns a list of error messages; empty when the module is pure.
 */
function auditSharedModule(source, file, options = {}) {
    const errors = [];
    const at = (node) => `${file}:${node.loc.start.line}:${node.loc.start.column + 1}`;
    const linter = new Linter();
    const messages = linter.verify(source, [{ languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: {} }, rules: SHARED_LINT_RULES }], {
        filename: file
    });

    for (const message of messages) {
        errors.push(`${file}:${message.line}:${message.column} ${message.message}${message.ruleId ? ` (${message.ruleId})` : ''}`);
    }
    if (messages.some((message) => message.fatal)) return errors;

    const checkSource = (node) => {
        const value = String(node.source.value);
        if (!SHARED_IMPORT_SOURCE.test(value)) {
            errors.push(`${at(node)} shared/ modules import only other shared modules as './name.mjs', found '${value}'.`);
        } else if (typeof options.exists === 'function' && !options.exists(value.slice(2))) {
            errors.push(`${at(node)} imported shared module does not exist: '${value}'.`);
        }
    };
    const checkConst = (declaration) => {
        if (declaration.kind !== 'const') {
            errors.push(`${at(declaration)} shared/ modules keep no mutable module state: use const, not ${declaration.kind}.`);
        }
        for (const declarator of declaration.declarations) {
            const impure = findImpureNode(declarator.init);
            if (impure) errors.push(`${at(impure)} top-level initializer runs code at import time (${impure.type}).`);
        }
    };

    for (const statement of linter.getSourceCode().ast.body) {
        if (statement.type === 'ImportDeclaration' || statement.type === 'ExportAllDeclaration') {
            checkSource(statement);
            continue;
        }
        if (statement.type === 'ExportNamedDeclaration' && statement.source) checkSource(statement);

        const declaration = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration' ? statement.declaration : statement;
        if (!declaration || declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') continue;
        if (declaration.type === 'VariableDeclaration') {
            checkConst(declaration);
        } else if (statement.type === 'ExportDefaultDeclaration') {
            const impure = findImpureNode(declaration);
            if (impure) errors.push(`${at(impure)} default export runs code at import time (${impure.type}).`);
        } else {
            errors.push(`${at(statement)} top-level ${statement.type} runs at import time; shared/ modules only declare functions and constants.`);
        }
    }

    return errors;
}

module.exports = { SHARED_LINT_RULES, auditSharedModule };
