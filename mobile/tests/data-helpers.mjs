// Helpers for the data layer tests: a project over the in-memory driver with a
// fixed clock and predictable ids, and a driver wrapper that records calls.

import { createMemoryDriver } from '../src/data/drivers/memory-driver.mjs';
import { createProject } from '../src/data/project-repo.mjs';

// Saturday 14 November 2026, 09:30 local time.
export const NOW = new Date(2026, 10, 14, 9, 30);
export const TODAY = '2026-11-14';

export function createIds() {
    let count = 0;
    return () => `00000000-0000-4000-8000-${String((count += 1)).padStart(12, '0')}`;
}

/** Wraps a driver so a test can count calls and make one of them fail. */
export function spyDriver(driver) {
    const calls = [];
    const failures = new Map();
    const wrapped = {};
    for (const name of ['readText', 'readBase64', 'writeText', 'rename', 'list', 'stat', 'mkdir', 'exists', 'remove', 'removeDirectory']) {
        wrapped[name] = async (...args) => {
            calls.push([name, ...args.slice(0, name === 'writeText' ? 1 : 2)]);
            if (failures.has(name)) throw failures.get(name);
            return driver[name](...args);
        };
    }
    return Object.assign(wrapped, {
        calls,
        count: (name) => calls.filter(([call]) => call === name).length,
        failOn: (name, error = new Error(`${name} failed`)) => failures.set(name, error),
        heal: () => failures.clear(),
        putBase64: (key, base64) => driver.putBase64(key, base64),
        snapshot: () => driver.snapshot()
    });
}

export function createMemoryProject(files = {}, { now = () => new Date(NOW) } = {}) {
    const driver = spyDriver(createMemoryDriver(files));
    const errors = [];
    const project = createProject({ driver, now, makeUuid: createIds(), onError: (error) => errors.push(error) });
    return { project, driver, errors };
}

export const json = (value) => JSON.stringify(value, null, 2);
export const storeJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function noteFile({ id = 'node_a', title = 'Not', content = '', extra = {}, pisi = {} }) {
    return json({
        pisi: {
            version: 1,
            type: 'node',
            id,
            title,
            sidecar: `inv_${title}__${id}`,
            createdAt: '2026-11-01T08:00:00.000Z',
            updatedAt: '2026-11-01T08:00:00.000Z',
            parentMap: 'none',
            ...pisi
        },
        ...extra,
        content
    });
}

export const paragraph = (id, html) =>
    `<div class="pisi-editor-block" data-pisi-block-id="${id}" data-pisi-block-type="paragraph" data-pisi-section-level="0">${html}</div>`;
