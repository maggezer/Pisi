import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePisiExternalUrl as validateInMain } from '../main/functions/external-url-policy.js';
import { normalizePisiLinkInput, preparePisiLinkUrl, validatePisiExternalUrl as validateInRenderer } from '../renderer/editor/pisi-external-url-policy.mjs';

const validators = [
    ['main', validateInMain],
    ['renderer', validateInRenderer]
];

const accepted = [
    ['https://example.com', 'https://example.com/'],
    ['http://example.com/a?b=1#c', 'http://example.com/a?b=1#c'],
    ['https://ÖRNEK.com.tr/yol', 'https://xn--rnek-4qa.com.tr/yol'],
    ['mailto:kisi@example.com', 'mailto:kisi@example.com'],
    ['https://example.com:8443/', 'https://example.com:8443/']
];

const rejected = [
    ['javascript:alert(1)', 'URL_PROTOCOL_BLOCKED'],
    ['JaVaScRiPt:alert(1)', 'URL_PROTOCOL_BLOCKED'],
    ['vbscript:msgbox(1)', 'URL_PROTOCOL_BLOCKED'],
    ['file:///etc/passwd', 'URL_PROTOCOL_BLOCKED'],
    ['data:text/html,<script>alert(1)</script>', 'URL_PROTOCOL_BLOCKED'],
    ['blob:https://example.com/123', 'URL_PROTOCOL_BLOCKED'],
    ['ftp://example.com', 'URL_PROTOCOL_BLOCKED'],
    ['http://user:pass@example.com', 'URL_CREDENTIALS'],
    ['https://user@example.com', 'URL_CREDENTIALS'],
    ['https://:secret@example.com', 'URL_CREDENTIALS'],
    ['https://exa mple.com', 'URL_FORBIDDEN_CHARACTERS'],
    [' https://example.com', 'URL_FORBIDDEN_CHARACTERS'],
    ['https://example.com/\u0000', 'URL_FORBIDDEN_CHARACTERS'],
    ['https://example.com/\u0085', 'URL_FORBIDDEN_CHARACTERS'],
    ['java\tscript:alert(1)', 'URL_FORBIDDEN_CHARACTERS'],
    ['https://example.com/\n', 'URL_FORBIDDEN_CHARACTERS'],
    ['example.com', 'URL_INVALID'],
    ['https://', 'URL_INVALID'],
    ['mailto:', 'URL_INVALID'],
    ['', 'URL_INVALID'],
    [`https://example.com/${'a'.repeat(8200)}`, 'URL_INVALID']
];

for (const [side, validate] of validators) {
    test(`${side}: only http, https and mailto URLs pass, normalized by the URL parser`, () => {
        for (const [input, href] of accepted) assert.deepEqual(validate(input), { ok: true, url: href }, input);
    });

    test(`${side}: dangerous schemes, credentials, control characters and malformed URLs are rejected`, () => {
        for (const [input, code] of rejected) {
            const result = validate(input);
            assert.equal(result.ok, false, input);
            assert.equal(result.code, code, input);
            assert.ok(result.error, input);
        }
        for (const value of [null, undefined, 42, {}, ['https://example.com']]) assert.equal(validate(value).ok, false);
    });
}

test('link editor input gets https:// or mailto: only when no scheme was typed', () => {
    assert.equal(normalizePisiLinkInput('  ornek.com/yol  '), 'https://ornek.com/yol');
    assert.equal(normalizePisiLinkInput('ornek.com:8080'), 'https://ornek.com:8080');
    assert.equal(normalizePisiLinkInput('//ornek.com'), 'https://ornek.com');
    assert.equal(normalizePisiLinkInput('kisi@ornek.com'), 'mailto:kisi@ornek.com');
    assert.equal(normalizePisiLinkInput('http://ornek.com'), 'http://ornek.com');
    assert.equal(normalizePisiLinkInput('javascript:alert(1)'), 'javascript:alert(1)');
    assert.equal(normalizePisiLinkInput('file:///etc/passwd'), 'file:///etc/passwd');
    assert.equal(normalizePisiLinkInput('   '), '');
});

test('prepared link URLs are validated after normalization', () => {
    assert.deepEqual(preparePisiLinkUrl('ornek.com'), { ok: true, url: 'https://ornek.com/' });
    assert.equal(preparePisiLinkUrl('javascript:alert(1)').code, 'URL_PROTOCOL_BLOCKED');
    assert.equal(preparePisiLinkUrl('data:text/html,x').code, 'URL_PROTOCOL_BLOCKED');
    assert.equal(preparePisiLinkUrl('user:pass@ornek.com').ok, true, 'a bare address with a colon is treated as a mail address, never as credentials');
    assert.equal(preparePisiLinkUrl('http://user:pass@ornek.com').code, 'URL_CREDENTIALS');
    assert.equal(preparePisiLinkUrl('').code, 'URL_INVALID');
});
