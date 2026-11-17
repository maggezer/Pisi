// Masaüstü senkron HTTP istemcisi (main/functions/sync-client-http.js, docs/sync-protocol.md §2, §9):
// yalnız HTTPS, protokol başlıkları, 5xx/429'da geri çekilerek yeniden deneme, Retry-After,
// ağ hatasında OFFLINE ve yalnız açıkça izin verilen test sunucusu için loopback HTTP.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PisiSyncHttpError,
    createPisiSyncHttp,
    getPisiSyncBackoffSeconds,
    parsePisiSyncRetryAfter,
    resolvePisiSyncTransportUrl
} from '../main/functions/sync-client-http.js';

function fakeFetch(responses) {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        const next = responses.shift();
        if (next instanceof Error) throw next;
        const { status = 200, body = {}, headers = {} } = next;
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    };
    return { calls, fetchImpl };
}

test('yalnız https adresi kabul edilir; loopback http yalnız izinle ve yalnız 127.0.0.1/localhost için', () => {
    assert.throws(
        () => resolvePisiSyncTransportUrl('http://ornek.com', '/v1/info'),
        (error) => error.code === 'BAD_SERVER_URL'
    );
    assert.equal(resolvePisiSyncTransportUrl('https://Ornek.com/pisi/', '/v1/info').url, 'https://ornek.com/pisi/v1/info');
    assert.equal(resolvePisiSyncTransportUrl('https://127.0.0.1:8080', '/v1/info').url, 'https://127.0.0.1:8080/v1/info');
    assert.deepEqual(resolvePisiSyncTransportUrl('https://127.0.0.1:8080', '/v1/info', { allowLoopbackHttp: true }), {
        url: 'http://127.0.0.1:8080/v1/info',
        loopback: true
    });
    assert.equal(resolvePisiSyncTransportUrl('https://ornek.com', '/v1/info', { allowLoopbackHttp: true }).url, 'https://ornek.com/v1/info');
});

test('başlıklar: protokol sürümü, token, sabit User-Agent; info isteğinde protokol başlığı yok', async () => {
    const { calls, fetchImpl } = fakeFetch([{ body: { service: 'pisi-sync' } }, { body: { head: 0 } }]);
    const http = createPisiSyncHttp({ baseUrl: 'https://ornek.com', token: 'pst_x', fetchImpl });
    await http.get('/v1/info', { auth: false });
    await http.get('/v1/spaces/sp/head');
    assert.equal(calls[0].options.headers['Pisi-Sync-Protocol'], undefined);
    assert.equal(calls[0].options.headers.Authorization, undefined);
    assert.equal(calls[1].options.headers['Pisi-Sync-Protocol'], '1');
    assert.equal(calls[1].options.headers.Authorization, 'Bearer pst_x');
    assert.equal(calls[1].options.headers['User-Agent'], 'Pisi-Sync/1');
    assert.equal(calls[1].options.redirect, 'error');
});

test('5xx geri çekilerek yeniden denenir; hata kodu sunucunun kodudur', async () => {
    const waits = [];
    const { calls, fetchImpl } = fakeFetch([
        { status: 503, body: { error: { code: 'MAINTENANCE', retryable: true } } },
        { status: 500, body: { error: { code: 'INTERNAL', retryable: true } } },
        { body: { head: 3 } }
    ]);
    const http = createPisiSyncHttp({ baseUrl: 'https://ornek.com', fetchImpl, sleep: async (ms) => waits.push(ms) });
    const response = await http.get('/v1/spaces/sp/head');
    assert.equal(response.data.head, 3);
    assert.equal(calls.length, 3);
    assert.deepEqual(waits, [1000, 2000]);
    assert.deepEqual([0, 1, 2, 8, 20].map(getPisiSyncBackoffSeconds), [1, 2, 4, 256, 300]);
});

test('429 Retry-After kısa ise beklenir, uzunsa RATE_LIMITED çağırana döner', async () => {
    const waits = [];
    let { fetchImpl } = fakeFetch([{ status: 429, body: { error: { code: 'RATE_LIMITED' } }, headers: { 'Retry-After': '3' } }, { body: { ok: 1 } }]);
    let http = createPisiSyncHttp({ baseUrl: 'https://ornek.com', fetchImpl, sleep: async (ms) => waits.push(ms) });
    await http.get('/v1/x');
    assert.deepEqual(waits, [3000]);
    ({ fetchImpl } = fakeFetch([{ status: 429, body: { error: { code: 'RATE_LIMITED' } }, headers: { 'Retry-After': '600' } }]));
    http = createPisiSyncHttp({ baseUrl: 'https://ornek.com', fetchImpl, sleep: async () => assert.fail('beklememeli') });
    await assert.rejects(http.get('/v1/x'), (error) => error instanceof PisiSyncHttpError && error.code === 'RATE_LIMITED' && error.retryAfter === 600);
    assert.equal(parsePisiSyncRetryAfter('Wed, 18 Nov 2026 10:00:10 GMT', Date.parse('2026-11-18T10:00:00Z')), 10);
});

test('ağ hatası OFFLINE olur; idempotent olmayan POST yeniden gönderilmez', async () => {
    const { calls, fetchImpl } = fakeFetch([new TypeError('fetch failed'), new TypeError('fetch failed')]);
    const http = createPisiSyncHttp({ baseUrl: 'https://ornek.com', fetchImpl, sleep: async () => {} });
    await assert.rejects(http.post('/v1/spaces', {}), (error) => error.code === 'OFFLINE');
    assert.equal(calls.length, 1);
    const retried = fakeFetch([new TypeError('fetch failed'), { body: { seqs: [1] } }]);
    const idempotent = createPisiSyncHttp({ baseUrl: 'https://ornek.com', fetchImpl: retried.fetchImpl, sleep: async () => {} });
    assert.deepEqual((await idempotent.post('/v1/spaces/sp/commit', {}, { idempotent: true })).data, { seqs: [1] });
});

test('4xx hata hemen döner; ayrıntılar korunur', async () => {
    const { calls, fetchImpl } = fakeFetch([{ status: 409, body: { error: { code: 'STALE_BASE', retryable: true, details: { head: 9 } } } }]);
    const http = createPisiSyncHttp({ baseUrl: 'https://ornek.com', fetchImpl });
    await assert.rejects(
        http.post('/v1/spaces/sp/commit', {}, { idempotent: true }),
        (error) => error.code === 'STALE_BASE' && error.details.head === 9 && error.status === 409
    );
    assert.equal(calls.length, 1);
});
