'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const dismissSource = fs.readFileSync(path.join(root, 'renderer/map/pisi-map-edge-selection-dismiss.mjs'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(root, 'renderer/bootstrap.mjs'), 'utf8');

function loadDismissHarness() {
    let mouseDownHandler = null;
    let capturePhase = null;
    let removedSelectedClasses = 0;
    let blurredEdgeFocus = 0;
    const dispatched = [];

    class TestCustomEvent {
        constructor(type) {
            this.type = type;
        }
    }

    const activeEdgeElement = {
        closest(selector) {
            assert.equal(selector, '.map-edge-group[data-edge-id]');
            return { dataset: { edgeId: 'edge_test' } };
        },
        blur() {
            blurredEdgeFocus += 1;
        }
    };

    const context = vm.createContext({
        window: {
            selectedMapEdgeId: 'edge_test'
        },
        CustomEvent: TestCustomEvent,
        document: {
            activeElement: activeEdgeElement,
            addEventListener(type, handler, capture) {
                if (type === 'mousedown') {
                    mouseDownHandler = handler;
                    capturePhase = capture;
                }
            },
            querySelectorAll(selector) {
                assert.equal(selector, '.map-edge-group.selected');
                return [
                    {
                        classList: {
                            remove(className) {
                                assert.equal(className, 'selected');
                                removedSelectedClasses += 1;
                            }
                        }
                    }
                ];
            },
            dispatchEvent(event) {
                dispatched.push(event.type);
                return true;
            }
        }
    });

    const executable = dismissSource.replace(/\nexport \{\};\s*$/u, '\n');
    vm.runInContext(executable, context, {
        filename: 'pisi-map-edge-selection-dismiss.mjs'
    });

    return {
        context,
        getHandler: () => mouseDownHandler,
        getCapturePhase: () => capturePhase,
        getRemovedCount: () => removedSelectedClasses,
        getBlurredFocusCount: () => blurredEdgeFocus,
        dispatched
    };
}

test('clicking canvas outside a selected map edge clears state, class and focus', () => {
    const harness = loadDismissHarness();
    const handler = harness.getHandler();

    assert.equal(typeof handler, 'function');
    assert.equal(harness.getCapturePhase(), true);

    handler({
        target: {
            closest() {
                return null;
            }
        }
    });

    assert.equal(harness.context.window.selectedMapEdgeId, null);
    assert.equal(harness.getRemovedCount(), 1);
    assert.equal(harness.getBlurredFocusCount(), 1);
    assert.deepEqual(harness.dispatched, ['pisi:map-customization-context-changed']);
});

test('clicking the edge itself keeps the current edge selection and focus', () => {
    const harness = loadDismissHarness();
    const handler = harness.getHandler();

    handler({
        target: {
            closest(selector) {
                assert.match(selector, /\.map-edge-group\[data-edge-id\]/);
                return { dataset: { edgeId: 'edge_test' } };
            }
        }
    });

    assert.equal(harness.context.window.selectedMapEdgeId, 'edge_test');
    assert.equal(harness.getRemovedCount(), 0);
    assert.equal(harness.getBlurredFocusCount(), 0);
    assert.deepEqual(harness.dispatched, []);
});

test('edge customize controls are explicit selection-preserving targets', () => {
    assert.match(dismissSource, /#right-tab-customize/);
    assert.match(dismissSource, /\[data-right-tab="customize"\]/);
});

test('outside-click dismissal loads immediately after map edge interactions', () => {
    const edgeIndex = bootstrapSource.search(/import\s+['"]\.\/map\/pisi-map-edges\.mjs['"];/);
    const dismissIndex = bootstrapSource.search(/import\s+['"]\.\/map\/pisi-map-edge-selection-dismiss\.mjs['"];/);

    assert.ok(edgeIndex >= 0);
    assert.ok(dismissIndex > edgeIndex);
});
