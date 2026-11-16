import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { keepPagePromise } from '../scripts/e2e-cdp.mjs';

function createPage() {
    const context = vm.createContext({});
    return {
        context,
        run: (expression) => vm.runInContext(keepPagePromise(expression), context),
        pending: () => vm.runInContext('globalThis.__pisiE2EPendingPromises ? globalThis.__pisiE2EPendingPromises.size : 0', context)
    };
}

test('E2E: sayfadaki söz çözülene kadar sayfada tutulur, sonra bırakılır', async () => {
    const page = createPage();
    page.run('globalThis.finish = null');
    const value = page.run('new Promise((resolve) => { globalThis.finish = resolve; })');
    assert.equal(typeof value.then, 'function');
    assert.equal(page.pending(), 1, 'bekleyen söz güçlü referansla tutulmalı');
    vm.runInContext("globalThis.finish('tamam')", page.context);
    assert.equal(await value, 'tamam', 'CDP aynı sözün sonucunu almalı');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.pending(), 0, 'çözülen söz bırakılmalı');
});

test('E2E: reddedilen söz de bırakılır ve hata CDP’ye aynen ulaşır', async () => {
    const page = createPage();
    const value = page.run("Promise.reject(new Error('düştü'))");
    await assert.rejects(value, /düştü/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.pending(), 0);
});

test('E2E: söz olmayan değerler değişmeden döner ve hiçbir şey tutulmaz', () => {
    const page = createPage();
    assert.equal(page.run('1 + 2'), 3);
    assert.equal(page.run('null'), null);
    assert.equal(page.run("(globalThis.flag = 'x', globalThis.flag)"), 'x');
    assert.equal(page.pending(), 0);
});

test('E2E: sondaki satır yorumu sarmalayıcıyı bozmaz', () => {
    const page = createPage();
    assert.equal(page.run('40 + 2 // yorum'), 42);
});

test('E2E: deyim listesi sarmalanmadan olduğu gibi gönderilir', () => {
    const page = createPage();
    assert.equal(keepPagePromise('globalThis.closed = true; 7'), 'globalThis.closed = true; 7');
    assert.equal(page.run('globalThis.closed = true; 7'), 7);
});
