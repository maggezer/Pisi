import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { auditSharedModule } = require('../scripts/shared-purity.js');
const root = path.resolve(import.meta.dirname, '..');

const audit = (source, options) => auditSharedModule(source, 'shared/sample.mjs', options);
const rejected = (source, pattern, options) => {
    const errors = audit(source, options);
    assert.ok(
        errors.some((error) => pattern.test(error)),
        `expected an error matching ${pattern} for:\n${source}\ngot: ${JSON.stringify(errors)}`
    );
};

test('saf bir modül kabul edilir: sabitler, fonksiyonlar, shared içi importlar', () => {
    const source = `
import { helper } from './other.mjs';
export { helper as renamed } from './other.mjs';

const LIMIT = 12;
const PATTERN = /^node_[a-z]+$/;
const VALUES = new Set(['a', 'b']);
export const OPTIONS = Object.freeze([Object.freeze({ value: 'a', label: \`A \${LIMIT}\` }), ...[]]);
const later = () => Date.now() + Math.random();

export function pick(documents, now = new Date()) {
    // A parameter may share its name with a host global.
    return (documents || []).filter((document) => VALUES.has(document.id) && PATTERN.test(helper(document.id))).length + later() + now.getTime();
}

export class Counter {
    count(value) {
        return String(value).length;
    }
}
`;
    assert.deepEqual(audit(source, { exists: (name) => name === 'other.mjs' }), []);
});

test('depodaki bütün shared modülleri kuraldan geçer', () => {
    const files = fs.readdirSync(path.join(root, 'shared'));
    assert.ok(files.length >= 8);
    for (const name of files) {
        assert.match(name, /\.mjs$/, `shared/ yalnız .mjs modülü tutar: ${name}`);
        const errors = auditSharedModule(fs.readFileSync(path.join(root, 'shared', name), 'utf8'), `shared/${name}`, {
            exists: (sibling) => files.includes(sibling)
        });
        assert.deepEqual(errors, [], name);
    }
});

test('shared dışına ya da pakete giden import reddedilir', () => {
    const importError = /import only other shared modules/;
    rejected(`import fs from 'node:fs';\nexport const a = fs;`, importError);
    rejected(`import { app } from 'electron';\nexport const a = app;`, importError);
    rejected(`import { Filesystem } from '@capacitor/filesystem';\nexport const a = Filesystem;`, importError);
    rejected(`import { x } from '../main/functions/task-store.js';\nexport const a = x;`, importError);
    rejected(`import { x } from './nested/x.mjs';\nexport const a = x;`, importError);
    rejected(`import { x } from './x.js';\nexport const a = x;`, importError);
    rejected(`export * from '../renderer/core/module-registry.mjs';`, importError);
    rejected(`export { x } from 'lodash';`, importError);
    rejected(`import { x } from './missing.mjs';\nexport const a = x;`, /does not exist/, { exists: () => false });
    rejected(`export async function load() {\n    return import('./other.mjs');\n}`, /dynamic import/);
    rejected(`export const here = () => import.meta.url;`, /import\.meta/);
});

test('DOM, Node, zamanlayıcı ve registry adları reddedilir', () => {
    for (const name of [
        'window',
        'document',
        'navigator',
        'localStorage',
        'process',
        'console',
        'crypto',
        'setTimeout',
        'fetch',
        'structuredClone',
        'require',
        'Buffer'
    ]) {
        rejected(`export function f() {\n    return ${name};\n}`, new RegExp(`'${name}' is not defined`));
    }
    rejected(`export function f() {\n    return globalThis.window;\n}`, /globalThis/);
    rejected(`export function f(code) {\n    return eval(code);\n}`, /eval/);
    rejected(`export function f(code) {\n    return new Function(code);\n}`, /Function/);
    // Registry bindings are globals of the desktop worlds; shared code cannot see them.
    rejected(`export function f() {\n    return modules['main.taskStore'];\n}`, /'modules' is not defined/);
    rejected(`export function f() {\n    return registerModule('x', {});\n}`, /'registerModule' is not defined/);
});

test('import anında çalışan kod ve değişebilir modül durumu reddedilir', () => {
    const importTime = /runs (code )?at import time/;
    rejected(`registerMainModule('shared.x', {});`, importTime);
    rejected(`const started = Date.now();\nexport const a = started;`, importTime);
    rejected(`const id = Math.random().toString(16);\nexport const a = id;`, importTime);
    rejected(`export const cache = new WeakMap();`, importTime);
    rejected(`export const copy = [1, 2].map((value) => value * 2);`, importTime);
    rejected(`if (true) {\n    Object.freeze({});\n}`, importTime);
    rejected(`for (const value of []) Object.freeze(value);`, importTime);
    rejected(`export default Object.keys({});`, importTime);
    rejected(`let counter = 0;\nexport function next() {\n    counter += 1;\n    return counter;\n}`, /no mutable module state/);
    rejected(`export class A {\n    static count = 0;\n}`, /static state/);
    rejected(`export class A {\n    static {\n        A.ready = true;\n    }\n}`, /static blocks/);
});

test('sözdizimi hatası bildirilir', () => {
    const errors = audit('export const = ;');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^shared\/sample\.mjs:1:/);
});
