// HTTP client of Pisi Sync (docs/sync-plan.md S3, docs/sync-protocol.md §2, §9).
// It speaks HTTPS only, adds the protocol headers, applies the timeouts and
// retries 5xx/429 with back-off (Retry-After is honoured). Errors come back as
// PisiSyncHttpError with the server's `code` (or OFFLINE for a network failure),
// so callers choose behaviour by code only. Nothing here logs a token, a key or
// a request body.
//
// Test servers (scripts/start-sync-test-server.mjs) speak plain HTTP on the
// loopback interface. Only when the caller passes `allowLoopbackHttp` (the
// desktop sets it from PISI_SYNC_ALLOW_LOOPBACK_HTTP=1 in an unpackaged app)
// does an `https://127.0.0.1:…` or `https://localhost:…` address travel as
// http with `X-Forwarded-Proto: https`. Every other address stays HTTPS.

import { normalizePisiSyncServerUrl } from '../../shared/sync-meta.mjs';

export const PISI_SYNC_JSON_TIMEOUT_MS = 20000;
export const PISI_SYNC_BLOB_TIMEOUT_MS = 120000;
const MAX_INLINE_RETRY_AFTER_SECONDS = 30;
const LOOPBACK_HOSTS = /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;

export class PisiSyncHttpError extends Error {
    constructor(code, { status = 0, retryable = false, details = null, retryAfter = null, message = '' } = {}) {
        super(message || code);
        this.name = 'PisiSyncHttpError';
        this.code = code;
        this.status = status;
        this.retryable = retryable;
        this.details = details;
        this.retryAfter = retryAfter;
    }
}

/** Retry-After in seconds (delta seconds or an HTTP date), or null. */
export function parsePisiSyncRetryAfter(value, now = Date.now()) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) return Number(text);
    const at = Date.parse(text);
    return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : null;
}

/** The back-off of the n-th retry (1, 2, 4 … at most 300 s, §9.2). */
export function getPisiSyncBackoffSeconds(attempt) {
    return Math.min(300, 2 ** Math.max(0, attempt));
}

/** The transport URL of a request: the https address, or http for an allowed loopback test server. */
export function resolvePisiSyncTransportUrl(baseUrl, path, { allowLoopbackHttp = false } = {}) {
    const base = normalizePisiSyncServerUrl(baseUrl);
    if (!base) throw new PisiSyncHttpError('BAD_SERVER_URL', { message: 'Sunucu adresi https:// ile başlamalı.' });
    const host = base.slice('https://'.length).split('/')[0];
    const loopback = allowLoopbackHttp && LOOPBACK_HOSTS.test(host);
    return { url: (loopback ? `http://${base.slice('https://'.length)}` : base) + path, loopback };
}

/**
 * Creates a client for one server. `fetchImpl` defaults to the global fetch,
 * `sleep(ms)` waits between retries, `onRequest({ method, path, body })` sees
 * every request as it is sent (tests scan bodies for plain data).
 */
export function createPisiSyncHttp({
    baseUrl,
    token = null,
    fetchImpl = globalThis.fetch,
    allowLoopbackHttp = false,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxAttempts = 3,
    onRequest = null
}) {
    let currentToken = token;

    async function attempt(method, path, options) {
        const { url, loopback } = resolvePisiSyncTransportUrl(baseUrl, path, { allowLoopbackHttp });
        const headers = { 'User-Agent': 'Pisi-Sync/1' };
        if (path !== '/v1/info') headers['Pisi-Sync-Protocol'] = '1';
        if (loopback) headers['X-Forwarded-Proto'] = 'https';
        const bearer = options.token === undefined ? currentToken : options.token;
        if (options.auth !== false && bearer) headers.Authorization = `Bearer ${bearer}`;
        Object.assign(headers, options.headers || {});
        let body;
        if (options.json !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(options.json);
        } else if (options.bytes !== undefined) {
            headers['Content-Type'] = 'application/octet-stream';
            body = options.bytes;
        }
        onRequest?.({ method, path, headers: { ...headers, Authorization: headers.Authorization ? 'Bearer …' : undefined }, body });
        const controller = new AbortController();
        const timer = setTimeout(
            () => controller.abort(),
            options.timeoutMs ?? (options.bytes !== undefined ? PISI_SYNC_BLOB_TIMEOUT_MS : PISI_SYNC_JSON_TIMEOUT_MS)
        );
        let response;
        try {
            response = await fetchImpl(url, { method, headers, body, signal: controller.signal, redirect: 'error' });
        } catch (error) {
            clearTimeout(timer);
            throw new PisiSyncHttpError('OFFLINE', { retryable: true, message: error?.name === 'AbortError' ? 'Zaman aşımı.' : 'Sunucuya ulaşılamadı.' });
        }
        try {
            const status = response.status;
            if (options.expect === 'bytes' && (status === 200 || status === 206)) {
                const bytes = new Uint8Array(await response.arrayBuffer());
                return { status, bytes, headers: response.headers };
            }
            const text = await response.text();
            let data = null;
            if (text) {
                try {
                    data = JSON.parse(text);
                } catch {
                    data = null;
                }
            }
            if (status >= 200 && status < 300) return { status, data, headers: response.headers };
            const error = data?.error || {};
            const code = typeof error.code === 'string' ? error.code : status >= 500 ? 'INTERNAL' : status === 429 ? 'RATE_LIMITED' : `HTTP_${status}`;
            throw new PisiSyncHttpError(code, {
                status,
                retryable: status >= 500 || status === 429 || error.retryable === true,
                details: error.details && typeof error.details === 'object' ? error.details : null,
                retryAfter: parsePisiSyncRetryAfter(response.headers.get('Retry-After'))
            });
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Sends a request. `options`: `json` (body), `bytes` (raw body), `headers`,
     * `auth` (false: no token), `token` (another bearer), `expect: 'bytes'`,
     * `timeoutMs`, `idempotent` (retry network failures; GETs always are).
     */
    async function request(method, path, options = {}) {
        const idempotent = options.idempotent ?? method === 'GET';
        let tries = 0;
        for (;;) {
            try {
                return await attempt(method, path, options);
            } catch (error) {
                tries += 1;
                if (!(error instanceof PisiSyncHttpError) || tries >= maxAttempts) throw error;
                const serverRetry = error.status >= 500 || error.status === 429;
                if (!(serverRetry || (error.code === 'OFFLINE' && idempotent))) throw error;
                const wait = error.retryAfter ?? getPisiSyncBackoffSeconds(tries - 1);
                if (wait > MAX_INLINE_RETRY_AFTER_SECONDS) throw error;
                await sleep(wait * 1000);
            }
        }
    }

    return {
        request,
        get: (path, options) => request('GET', path, options),
        post: (path, json, options = {}) => request('POST', path, { ...options, json }),
        setToken(value) {
            currentToken = value;
        }
    };
}
