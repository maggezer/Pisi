// The in-memory sync server of the unit tests (tests/helpers/fake-sync-server.mjs)
// reached from the page: requests to https://sync.test go to it through a
// Playwright route. `hold(request)` may delay a request until a test lets it go;
// `server.offline = true` makes every request fail like a dead network.

import { Buffer } from 'node:buffer';

export const SERVER = 'https://sync.test';
const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, pisi-sync-protocol, pisi-part-sha256, range, x-pisi-token',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-expose-headers': 'content-range, retry-after, pisi-blob-sha256'
};

/** Sends the page's requests to `https://sync.test` to the in-memory server. */
export async function routeServer(page, server, { hold = null } = {}) {
    await page.route(`${SERVER}/**`, async (route) => {
        const request = route.request();
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        if (hold) await hold(request);
        // `server.offline` stands for a phone without a connection.
        if (server.offline) return route.abort('internetdisconnected');
        const headers = request.headers();
        const raw = request.postDataBuffer();
        const body = raw ? ((headers['content-type'] || '').includes('json') ? raw.toString('utf8') : new Uint8Array(raw)) : null;
        const response = await server.handle({ method: request.method(), url: request.url(), headers, body });
        const out = new Uint8Array(await response.arrayBuffer());
        const extra = {};
        for (const name of ['content-type', 'content-range', 'pisi-blob-sha256', 'retry-after']) {
            const value = response.headers.get(name);
            if (value) extra[name] = value;
        }
        await route.fulfill({ status: response.status, headers: { ...CORS, ...extra }, body: Buffer.from(out) });
    });
}
