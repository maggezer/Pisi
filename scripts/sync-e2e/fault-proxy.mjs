// A forwarding proxy between the sync clients of scripts/sync-e2e-matrix.mjs and the
// PHP test server (docs/sync-plan.md S7). Every request is logged; a rule can drop a
// request before it reaches the server ("the connection broke while sending") or
// after the server has answered ("the answer was lost"), for one client or both.
// The phone's requests carry `x-pisi-e2e-client: phone` (added by its Playwright
// route); the header is removed before the request goes on to the server.

import http from 'node:http';

const HOP_BY_HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'x-pisi-e2e-client']);
const RESPONSE_SKIP = new Set(['connection', 'content-length', 'content-encoding', 'transfer-encoding', 'keep-alive']);

/**
 * @param {string} targetBaseUrl the test server, e.g. `http://127.0.0.1:1234`
 */
export async function startFaultProxy(targetBaseUrl) {
    /** @type {{ client?: string, method?: string, path: RegExp, when: 'before' | 'after', skip: number, times: number, hits: number }[]} */
    const rules = [];
    /** @type {{ client: string, method: string, path: string, status: number | null, fault: string | null, at: number }[]} */
    const log = [];

    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const client = req.headers['x-pisi-e2e-client'] === 'phone' ? 'phone' : 'desktop';
        const method = String(req.method || 'GET');
        const url = String(req.url || '/');
        const entry = { client, method, path: url, status: null, fault: null, at: Date.now() };
        log.push(entry);
        let rule = rules.find(
            (candidate) =>
                candidate.times > 0 &&
                (!candidate.client || candidate.client === client) &&
                (!candidate.method || candidate.method === method) &&
                candidate.path.test(url)
        );
        // `skip`: that many matching requests go through before the rule starts to fail them.
        if (rule && rule.skip > 0) {
            rule.skip -= 1;
            rule = undefined;
        }
        if (rule?.when === 'before') {
            rule.times -= 1;
            rule.hits += 1;
            entry.fault = 'before';
            req.socket.destroy();
            return;
        }
        /** @type {Record<string, string>} */
        const headers = {};
        for (const [name, value] of Object.entries(req.headers)) {
            if (!HOP_BY_HOP.has(name) && value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : value;
        }
        let response;
        try {
            response = await fetch(targetBaseUrl + url, {
                method,
                headers,
                body: method === 'GET' || method === 'HEAD' ? undefined : body,
                redirect: 'manual'
            });
        } catch {
            entry.fault = 'upstream';
            req.socket.destroy();
            return;
        }
        const out = Buffer.from(await response.arrayBuffer());
        entry.status = response.status;
        if (rule?.when === 'after') {
            rule.times -= 1;
            rule.hits += 1;
            entry.fault = 'after';
            req.socket.destroy();
            return;
        }
        /** @type {Record<string, string>} */
        const outHeaders = {};
        response.headers.forEach((value, name) => {
            if (!RESPONSE_SKIP.has(name)) outHeaders[name] = value;
        });
        outHeaders['content-length'] = String(out.length);
        res.writeHead(response.status, outHeaders);
        res.end(out);
    });
    server.keepAliveTimeout = 1000;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        log,
        /** Requests logged from index `mark` on, optionally for one client. */
        since(mark, client = null) {
            return log.slice(mark).filter((entry) => !client || entry.client === client);
        },
        /**
         * Drops matching requests `times` times. `when: 'before'` cuts the connection before the server
         * sees the request; `'after'` lets the server answer and loses the answer. The first `skip`
         * matching requests pass.
         * @param {{ client?: string, method?: string, path: RegExp, when?: 'before' | 'after', times?: number, skip?: number }} rule
         */
        fail({ client = undefined, method = undefined, path, when = 'before', times = 1, skip = 0 }) {
            const rule = { client, method, path, when, skip, times, hits: 0 };
            rules.push(rule);
            return rule;
        },
        clear() {
            rules.length = 0;
        },
        close() {
            server.closeAllConnections?.();
            return new Promise((resolve) => server.close(() => resolve(undefined)));
        }
    };
}
