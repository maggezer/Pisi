import { createDocument } from './db.js';
import { escapeHtml } from './sanitize.js';

function safeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export async function captureWebSource(input = {}) {
  const url = safeUrl(input.url);
  if (!url) throw new Error('Geçerli bir http/https adresi girin.');
  let title = String(input.title || '').trim();
  let excerpt = String(input.excerpt || '').trim();
  let author = String(input.author || '').trim();
  if (!title || !excerpt) {
    try {
      const response = await fetch(url, { headers: { Accept: 'text/html' } });
      if (response.ok) {
        const html = await response.text();
        const page = new DOMParser().parseFromString(html, 'text/html');
        title ||= page.querySelector('meta[property="og:title"]')?.content || page.title;
        excerpt ||= page.querySelector('meta[name="description"]')?.content
          || page.querySelector('meta[property="og:description"]')?.content || '';
        author ||= page.querySelector('meta[name="author"]')?.content || '';
      }
    } catch {
      // CORS veya çevrimdışı durumda kullanıcının girdiği metadata ile devam edilir.
    }
  }
  const capturedAt = new Date().toISOString();
  return createDocument('source', {
    title: title || new URL(url).hostname,
    content: `<h1>${escapeHtml(title || url)}</h1><p>${escapeHtml(excerpt)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
    sources: [{ id: crypto.randomUUID?.() || String(Date.now()), type: 'web', url, title, author, capturedAt }],
    properties: { url, author, capturedAt, sourceType: 'web' },
    tags: ['kaynak']
  });
}

export async function lookupDoi(doiValue) {
  const doi = String(doiValue || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  if (!/^10\.\d{4,9}\/.+/.test(doi)) throw new Error('Geçerli bir DOI girin.');
  try {
    const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('DOI bulunamadı.');
    const item = (await response.json()).message;
    return {
      doi,
      title: item.title?.[0] || doi,
      authors: (item.author || []).map((author) => [author.given, author.family].filter(Boolean).join(' ')),
      year: item.published?.['date-parts']?.[0]?.[0] || null,
      publisher: item.publisher || '',
      containerTitle: item['container-title']?.[0] || '',
      url: item.URL || `https://doi.org/${doi}`
    };
  } catch (error) {
    if (error?.message === 'DOI bulunamadı.') throw error;
    return { doi, title: doi, authors: [], year: null, publisher: '', containerTitle: '', url: `https://doi.org/${doi}` };
  }
}

export function createDoiSource(metadata) {
  const author = (metadata.authors || []).join(', ');
  return createDocument('source', {
    title: metadata.title || metadata.doi,
    content: `<h1>${escapeHtml(metadata.title || metadata.doi)}</h1><p>${escapeHtml(author)}</p><p><a href="${escapeHtml(metadata.url)}">doi:${escapeHtml(metadata.doi)}</a></p>`,
    sources: [{ id: crypto.randomUUID?.() || String(Date.now()), type: 'doi', ...metadata }],
    properties: { doi: metadata.doi, author, year: metadata.year, publisher: metadata.publisher, url: metadata.url },
    tags: ['kaynak', 'doi']
  });
}

export function formatCitation(source, style = 'apa') {
  const item = source?.sources?.[0] || source || {};
  const authors = Array.isArray(item.authors) ? item.authors.join(', ') : item.author || 'Anonim';
  const year = item.year || new Date(item.capturedAt || Date.now()).getFullYear();
  const title = item.title || source?.title || 'Başlıksız';
  if (style === 'mla') return `${authors}. “${title}.” ${item.containerTitle || item.publisher || ''}, ${year}. ${item.url || ''}`.trim();
  if (style === 'chicago') return `${authors}. “${title}.” ${item.publisher || item.containerTitle || ''}, ${year}. ${item.url || ''}`.trim();
  return `${authors} (${year}). ${title}. ${item.publisher || item.containerTitle || ''}. ${item.url || ''}`.trim();
}

export function makeQuoteBlock(text, source, page = '') {
  const sourceId = source?.id || '';
  const citation = formatCitation(source);
  return `<blockquote class="pisi-source-quote" data-source-id="${escapeHtml(sourceId)}"><p>${escapeHtml(text)}</p><cite>${escapeHtml(citation)}${page ? `, s. ${escapeHtml(page)}` : ''}</cite></blockquote>`;
}
