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
    const previous = new Map(['window', 'document', 'createTreeNode'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    t.after(() => {
        for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
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
    const result = (name) => ({ ok: true, items: [{ name, fullPath: `/project/${name}` }] });
    return { requests, container, result };
}

for (const stale of ['success', 'error-result', 'rejection']) {
    test(`late folder ${stale} cannot replace a newer tree`, async (t) => {
        const f = setup(t),
            container = f.container();
        const oldLoad = loadFolderChildren('/project/map', container, 1);
        const newLoad = loadFolderChildren('/project/map', container, 1);
        f.requests[1].resolve(f.result('new'));
        await newLoad;
        if (stale === 'rejection') f.requests[0].reject(new Error('old error'));
        else f.requests[0].resolve(stale === 'success' ? f.result('old') : { ok: false, error: 'old error' });
        if (stale === 'rejection') await assert.rejects(oldLoad, /old error/);
        else await oldLoad;
        assert.deepEqual(
            container.children.map((node) => node.textContent),
            ['new']
        );
    });
}

test('folder load checks freshness after asynchronous child creation', async (t) => {
    const f = setup(t),
        container = f.container(),
        child = deferred(),
        started = deferred();
    globalThis.createTreeNode = (item) => {
        if (item.name === 'old') {
            started.resolve();
            return child.promise;
        }
        return Promise.resolve({ textContent: item.name });
    };
    const oldLoad = loadFolderChildren('/project/map', container, 1);
    f.requests[0].resolve(f.result('old'));
    await started.promise;
    const newLoad = loadFolderChildren('/project/map', container, 1);
    f.requests[1].resolve(f.result('new'));
    await newLoad;
    child.resolve({ textContent: 'old' });
    await oldLoad;
    assert.deepEqual(
        container.children.map((node) => node.textContent),
        ['new']
    );
});

test('different folder containers load independently, including detached construction', async (t) => {
    const f = setup(t),
        a = f.container(),
        b = f.container();
    const first = loadFolderChildren('/project/a', a, 1);
    const second = loadFolderChildren('/project/b', b, 1);
    f.requests[1].resolve(f.result('b'));
    await second;
    f.requests[0].resolve(f.result('a'));
    await first;
    assert.equal(a.children[0].textContent, 'a');
    assert.equal(b.children[0].textContent, 'b');
});

test('folder response from a previous project is discarded', async (t) => {
    const f = setup(t),
        container = f.container();
    const load = loadFolderChildren('/project/map', container, 1);
    window.currentProjectFolder = '/other-project';
    f.requests[0].resolve(f.result('old'));
    await load;
    assert.deepEqual(container.children, []);
});
