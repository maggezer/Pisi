import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};

const registry = await import('../renderer/core/module-registry.mjs?ownership-regression=1');

test('renderer module ownership rejects duplicate bindings', () => {
    registry.registerModule('test.alpha', {
        alphaBinding: () => 'alpha'
    });

    assert.throws(
        () =>
            registry.registerModule('test.beta', {
                alphaBinding: () => 'beta'
            }),
        /Renderer binding collision: alphaBinding/
    );
});

test('renderer boot ownership can only be claimed once', () => {
    assert.equal(registry.claimRendererBoot('test.runtime', 'tests/first'), true);

    assert.throws(() => registry.claimRendererBoot('test.runtime', 'tests/second'), /Renderer boot collision: test\.runtime/);
});

test('renderer namespace replacement is rejected', () => {
    const originalRoot = globalThis.window.Pisi;
    globalThis.window.Pisi = {};

    assert.throws(
        () =>
            registry.registerModule('test.namespace', {
                namespaceBinding: true
            }),
        /Pisi namespace was replaced/
    );

    globalThis.window.Pisi = originalRoot;
});

test('renderer registry seal blocks late registrations', () => {
    const snapshot = registry.sealRendererModuleRegistry();

    assert.equal(snapshot.sealed, true);
    assert.ok(snapshot.modules.includes('test.alpha'));
    assert.equal(snapshot.bindings.alphaBinding, 'test.alpha');
    assert.equal(snapshot.boots['test.runtime'], 'tests/first');
    assert.equal(Object.isFrozen(globalThis.window.Pisi.modules), true);

    assert.throws(
        () =>
            registry.registerModule('test.late', {
                lateBinding: true
            }),
        /registry is sealed/
    );

    assert.throws(() => registry.sealRendererModuleRegistry(), /sealed twice/);
});
