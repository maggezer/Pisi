'use strict';

const { net } = require('electron');
const path = require('path');
const fs = require('fs');
const { registerMainModule } = require('../module-registry');

function normalizePisiResearchUrl(value = '') {
    try {
        const url = new globalThis.URL(String(value || '').trim());
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        url.username = '';
        url.password = '';
        return url.toString();
    } catch {
        return null;
    }
}

function extractPisiWebMeta(html = '', url = '') {
    const source = String(html || '');
    const getMeta = (names) => {
        for (const name of names) {
            const expressions = [
                new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'),
                new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["']`, 'i')
            ];
            for (const expression of expressions) {
                const match = source.match(expression);
                if (match?.[1]) return decodePisiHtmlEntities(match[1]).trim();
            }
        }
        return '';
    };
    const titleMatch = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const text = pisiHtmlToPlainText(source).slice(0, 4000);
    const doiMatch = source.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
    return {
        title: getMeta(['og:title', 'twitter:title', 'citation_title']) ||
            decodePisiHtmlEntities(titleMatch?.[1] || '').trim() || url,
        description: getMeta(['description', 'og:description', 'twitter:description']),
        author: getMeta(['author', 'citation_author', 'article:author']),
        publicationDate: getMeta([
            'article:published_time', 'citation_publication_date',
            'citation_date', 'date'
        ]),
        doi: getMeta(['citation_doi', 'dc.identifier']) || doiMatch?.[0] || '',
        text
    };
}

async function fetchPisiWebCapture(url) {
    const response = await net.fetch(url, {
        redirect: 'follow',
        signal: globalThis.AbortSignal?.timeout?.(15000)
    });
    if (!response.ok) throw new Error(`Web sayfası alınamadı (${response.status}).`);
    const contentLength = Number(response.headers.get('content-length')) || 0;
    if (contentLength > 3 * 1024 * 1024) throw new Error('Web sayfası yakalama sınırını aşıyor.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 3 * 1024 * 1024) throw new Error('Web sayfası yakalama sınırını aşıyor.');
    return buffer.toString('utf8');
}

function makePisiCitationKey(author, date, title) {
    const surname = String(author || 'source').trim().split(/\s+/).pop();
    const year = String(date || '').match(/\d{4}/)?.[0] || new Date().getFullYear();
    const word = String(title || '').replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/)[0] || 'web';
    return `${surname}${year}${word}`
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9_-]/g, '')
        .slice(0, 80);
}

function makePisiBibliography(meta, url, accessedAt) {
    const parts = [];
    if (meta.author) parts.push(meta.author);
    if (meta.publicationDate) parts.push(`(${meta.publicationDate})`);
    if (meta.title) parts.push(meta.title);
    parts.push(url);
    parts.push(`Erişim: ${accessedAt}`);
    if (meta.doi) parts.push(`DOI: ${meta.doi}`);
    return parts.join('. ').replace(/\.\s*\./g, '.');
}

function makePisiSourceProperties(meta, url, accessedAt, payload = {}) {
    const properties = [
        ['systemType', 'Kaynak türü', 'select', 'source', true],
        ['url', 'URL', 'text', url],
        ['accessedAt', 'Erişim tarihi', 'date', accessedAt],
        ['author', 'Yazar', 'text', payload.author || meta.author],
        ['publicationDate', 'Yayın tarihi', 'date', payload.publicationDate || meta.publicationDate],
        ['doi', 'DOI', 'text', payload.doi || meta.doi],
        ['citationKey', 'Atıf anahtarı', 'text', payload.citationKey || makePisiCitationKey(
            payload.author || meta.author,
            payload.publicationDate || meta.publicationDate,
            payload.title || meta.title
        )],
        ['bibliography', 'Bibliyografya', 'text', payload.bibliography || makePisiBibliography(
            { ...meta, ...payload },
            url,
            accessedAt
        )]
    ];
    return normalizePisiProperties(Object.fromEntries(properties.map((entry) => [entry[0], {
        id: entry[0],
        name: entry[1],
        type: entry[2],
        value: entry[3] || '',
        system: entry[4] === true
    }])));
}

function validatePisiScreenshotData(value = '') {
    const raw = String(value || '');
    if (!raw) return '';
    if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(raw)) {
        throw new Error('Ekran görüntüsü biçimi desteklenmiyor.');
    }
    if (raw.length > 7 * 1024 * 1024) throw new Error('Ekran görüntüsü çok büyük.');
    return raw;
}

function buildPisiSourceNodeContent(meta, url, accessedAt, payload = {}) {
    const title = escapePisiTaskHtml(payload.title || meta.title || url);
    const selectedText = String(payload.selectedText || '').trim();
    const description = String(payload.description || meta.description || meta.text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 3000);
    const screenshot = validatePisiScreenshotData(payload.screenshotDataUrl);
    const blocks = [
        `<h1 class="pisi-editor-block" data-pisi-block-id="blk_source_title">${title}</h1>`,
        `<p class="pisi-editor-block" data-pisi-block-id="blk_source_url"><a href="${escapePisiTaskHtml(url)}">${escapePisiTaskHtml(url)}</a></p>`,
        `<p class="pisi-editor-block" data-pisi-block-id="blk_source_access">Erişim: ${escapePisiTaskHtml(accessedAt)}</p>`
    ];
    if (selectedText) {
        blocks.push(`<blockquote class="pisi-editor-block pisi-citation" data-pisi-block-id="blk_source_quote">${escapePisiTaskHtml(selectedText)}</blockquote>`);
    }
    if (description) {
        blocks.push(`<p class="pisi-editor-block" data-pisi-block-id="blk_source_summary">${escapePisiTaskHtml(description)}</p>`);
    }
    if (screenshot) {
        blocks.push(`<p class="pisi-editor-block" data-pisi-block-id="blk_source_screenshot"><img src="${screenshot}" alt="Web yakalama ekran görüntüsü"></p>`);
    }
    return blocks.join('\n');
}

async function capturePisiWebSource(projectFolder, payload = {}) {
    try {
        const url = normalizePisiResearchUrl(payload.url);
        if (!url) return { ok: false, error: 'Geçerli bir http veya https URL gerekli.' };
        let html = '';
        let fetchWarning = '';
        if (payload.fetchPage !== false) {
            try {
                html = await fetchPisiWebCapture(url);
            } catch (error) {
                fetchWarning = error.message;
            }
        }
        const meta = extractPisiWebMeta(html, url);
        const title = sanitizePisiBaseName(payload.title || meta.title || 'Web Kaynağı');
        const accessedAt = String(payload.accessedAt || new Date().toISOString().slice(0, 10));
        const created = createUniquePisiFile(projectFolder, '.node');
        if (!created.ok) return created;
        const renamed = renamePisiFile(created.fullPath, title);
        const nodePath = renamed.ok ? renamed.fullPath : created.fullPath;
        const info = ensurePisiFileMetadata(nodePath);
        if (!info.ok) return info;
        info.data.pisi.systemRole = 'source';
        info.data.properties = makePisiSourceProperties(meta, url, accessedAt, payload);
        info.data.content = buildPisiSourceNodeContent(meta, url, accessedAt, payload);
        info.data.pisi.updatedAt = new Date().toISOString();
        writePisiDocument(nodePath, info.data);
        return {
            ok: true,
            fullPath: nodePath,
            fileName: path.basename(nodePath),
            metadata: info.data.pisi,
            properties: info.data.properties,
            fetchWarning
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

const moduleApi = {
    normalizePisiResearchUrl,
    extractPisiWebMeta,
    makePisiCitationKey,
    makePisiBibliography,
    makePisiSourceProperties,
    buildPisiSourceNodeContent,
    capturePisiWebSource
};

registerMainModule('main.research', moduleApi);
