import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFolderChildren } from '../renderer/tree/pisi-tree-loading.mjs';

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

function setup(t) {
    const requests = [];
    const previous = new Map(
        ['window', 'document', 'createTreeNode'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
    );
    t.after(() => {
        for (const [name, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    });
    globalThis.window = {
        currentProjectFolder: '/project',
        pisiProject: {
            listFolder() {
                const request = deferred();
                requests.push(request);
                return request.promise;
            }
        }
    };
    globalThis.document = {
        createDocumentFragment: () => ({
            children: [],
            appendChild(child) {
                this.children.push(child);
            }
        }),
        createElement: () => ({ style: {}, textContent: '' })
    };
    globalThis.createTreeNode = async (item) => ({ textContent: item.name });
    const container = () => ({
        children: [],
        replaceChildren(fragment) {
            this.children = fragment.children;
        }
    });
    const result = (name) => ({ ok: true, items: [{ name, fullPath: '/project/' + name }] });
    return { requests, container, result };
}

for (const stale of ['success', 'error-result', 'rejection']) {
    test('late folder ' + stale + ' cannot replace a newer load', async (t) => {
        const f = setup(t);
        const container = f.container();
        const oldLoad = loadFolderChildren('/project/folder', container, 1);
        const newLoad = loadFolderChildren('/project/folder', container, 1);
        f.requests[1].resolve(f.result('new'));
        assert.equal(await newLoad, true);
        if (stale === 'rejection') f.requests[0].reject(new Error('obsolete error'));
        else f.requests[0].resolve(stale === 'success' ? f.result('old') : { ok: false, error: 'obsolete error' });
        if (stale === 'rejection') await assert.rejects(oldLoad, /obsolete error/);
        else assert.equal(await oldLoad, false);
        assert.deepEqual(container.children.map((node) => node.textContent), ['new']);
    });
}

test('folder load checks freshness after asynchronous child creation', async (t) => {
    const f = setup(t);
    const container = f.container();
    const oldChild = deferred();
    const started = deferred();
    globalThis.createTreeNode = (item) => {
        if (item.name === 'old') {
            started.resolve();
            return oldChild.promise;
        }
        return Promise.resolve({ textContent: item.name });
    };
    const oldLoad = loadFolderChildren('/project/folder', container, 1);
    f.requests[0].resolve(f.result('old'));
    await started.promise;
    const newLoad = loadFolderChildren('/project/folder', container, 1);
    f.requests[1].resolve(f.result('new'));
    assert.equal(await newLoad, true);
    oldChild.resolve({ textContent: 'old' });
    assert.equal(await oldLoad, false);
    assert.deepEqual(container.children.map((node) => node.textContent), ['new']);
});

test('independent folder containers can load concurrently', async (t) => {
    const f = setup(t);
    const firstContainer = f.container();
    const secondContainer = f.container();
    const first = loadFolderChildren('/project/a', firstContainer, 1);
    const second = loadFolderChildren('/project/b', secondContainer, 1);
    f.requests[1].resolve(f.result('b'));
    assert.equal(await second, true);
    f.requests[0].resolve(f.result('a'));
    assert.equal(await first, true);
    assert.equal(firstContainer.children[0].textContent, 'a');
    assert.equal(secondContainer.children[0].textContent, 'b');
});

test('folder responses from a previous project are discarded', async (t) => {
    const f = setup(t);
    const container = f.container();
    const loading = loadFolderChildren('/project/folder', container, 1);
    window.currentProjectFolder = '/other-project';
    f.requests[0].resolve(f.result('old'));
    assert.equal(await loading, false);
    assert.deepEqual(container.children, []);
});

test('internal history directory stays filtered', async (t) => {
    const f = setup(t);
    const container = f.container();
    const loading = loadFolderChildren('/project', container, 0);
    f.requests[0].resolve({ ok: true, items: [{ name: '.pisi-history' }, { name: 'visible' }] });
    assert.equal(await loading, true);
    assert.deepEqual(container.children.map((node) => node.textContent), ['visible']);
});
