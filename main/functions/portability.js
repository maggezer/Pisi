'use strict';

const { BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { registerMainModule } = require('../module-registry');
const editorAssets = require('./editor-asset-store');

function pisiSafeTimestamp(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapePisiPortableHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function stripPisiUnsafeExportHtml(value = '') {
    return String(value || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
        .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function decodePisiHtmlEntities(value = '') {
    return String(value || '')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&amp;/gi, '&');
}

function stripPisiTaskMetadataHtml(value = '') {
    return String(value || '').replace(
        /<span\b(?=[^>]*(?:class=["'][^"']*pisi-task-metadata[^"']*["']|data-pisi-tag=["'](?:todo\.[^"']+|done)["']))[^>]*>[\s\S]*?<\/span>/gi,
        ''
    );
}

function pisiHtmlToPlainText(html = '') {
    return decodePisiHtmlEntities(stripPisiTaskMetadataHtml(stripPisiUnsafeExportHtml(html))
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|h[1-6]|li|blockquote|tr|table)>/gi, '\n')
        .replace(/<[^>]+>/g, ' '))
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function pisiHtmlToMarkdown(html = '') {
    let value = stripPisiTaskMetadataHtml(stripPisiUnsafeExportHtml(html));
    value = value.replace(
        /<(div|p|blockquote|pre)\b[^>]*data-pisi-block-type=["'](bullet|number|task|quote|code)["'][^>]*>([\s\S]*?)<\/\1>/gi,
        (_all, _tag, type, body) => {
            const cleanBody = String(body || '').replace(
                /<span\b[^>]*class=["'][^"']*pisi-block-task-marker[^"']*["'][^>]*>[\s\S]*?<\/span>/gi,
                ''
            ).trim();
            if (type === 'bullet') return `\n- ${cleanBody}\n`;
            if (type === 'number') return `\n1. ${cleanBody}\n`;
            if (type === 'task') {
                const checked = /[☑✓]/.test(body);
                return `\n- [${checked ? 'x' : ' '}] ${cleanBody}\n`;
            }
            if (type === 'quote') return `\n> ${pisiHtmlToPlainText(cleanBody)}\n`;
            if (type === 'code') return `\n\`\`\`\n${pisiHtmlToPlainText(cleanBody)}\n\`\`\`\n`;
            return cleanBody;
        }
    );
    value = value.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_all, level, text) => {
        return `\n${'#'.repeat(Number(level))} ${pisiHtmlToPlainText(text)}\n`;
    });
    value = value.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_all, text) => {
        return `\n> ${pisiHtmlToPlainText(text).replace(/\n/g, '\n> ')}\n`;
    });
    value = value.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_all, text) => {
        return `\n- ${pisiHtmlToPlainText(text)}`;
    });
    value = value.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
    value = value.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
    value = value.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
    value = value.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_all, href, text) => {
        return `[${pisiHtmlToPlainText(text)}](${href})`;
    });
    value = value.replace(/<img\b[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi, '![$2]($1)');
    value = value.replace(/<br\s*\/?>/gi, '\n');
    value = value.replace(/<\/(?:p|div|table|tr)>/gi, '\n\n');
    value = value.replace(/<\/[^>]+>/g, '').replace(/<[^>]+>/g, '');
    return decodePisiHtmlEntities(value)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function pisiMarkdownToHtml(markdown = '') {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let listOpen = false;
    const inline = (value) => escapePisiPortableHtml(value)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        const list = line.match(/^[-*+]\s+(.+)$/);
        if (!list && listOpen) {
            output.push('</ul>');
            listOpen = false;
        }
        if (heading) {
            const level = heading[1].length;
            output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        } else if (list) {
            if (!listOpen) {
                output.push('<ul>');
                listOpen = true;
            }
            output.push(`<li>${inline(list[1])}</li>`);
        } else if (/^>\s?/.test(line)) {
            output.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
        } else if (line.trim()) {
            output.push(`<p>${inline(line)}</p>`);
        }
    }
    if (listOpen) output.push('</ul>');
    return output.join('\n');
}

function walkPisiFiles(root, predicate, options = {}) {
    const files = [];
    const skip = new Set(['.pisi-history', '.git', 'node_modules']);
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink?.()) continue;
            if (entry.isDirectory() && skip.has(entry.name)) continue;
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (options.maxFiles && files.length >= options.maxFiles) return;
                visit(fullPath);
            } else if (predicate(fullPath, entry.name)) {
                files.push(fullPath);
                if (options.maxFiles && files.length >= options.maxFiles) return;
            }
        }
    };
    visit(root);
    return files;
}

function getPisiHistoryDirectory(nodePath) {
    const info = ensurePisiFileMetadata(nodePath, { ensureSidecar: false });
    if (!info.ok || info.metadata.type !== 'node') return null;
    const projectFolder = globalThis.activeProjectFolder || path.dirname(nodePath);
    return path.join(projectFolder, '.pisi-history', info.metadata.id);
}

function snapshotPisiNodeVersion(nodePath, reason = 'save') {
    try {
        if (!fs.existsSync(nodePath)) return { ok: true, skipped: true };
        const info = ensurePisiFileMetadata(nodePath, { ensureSidecar: false });
        if (!info.ok || info.metadata.type !== 'node') return info;
        const historyDirectory = getPisiHistoryDirectory(nodePath);
        fs.mkdirSync(historyDirectory, { recursive: true });
        const raw = fs.readFileSync(nodePath, 'utf-8');
        const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
        const existing = fs.readdirSync(historyDirectory)
            .filter((name) => name.endsWith(`-${hash}.json`));
        if (existing.length) return { ok: true, skipped: true, duplicate: true };
        const fileName = `${Date.now()}-${pisiSafeTimestamp()}-${hash}.json`;
        const snapshot = {
            version: 1,
            reason: String(reason || 'save').slice(0, 80),
            capturedAt: new Date().toISOString(),
            nodePath: path.relative(globalThis.activeProjectFolder, nodePath),
            hash,
            data: info.data
        };
        const snapshotPath = path.join(historyDirectory, fileName);
        writeFileAtomic(snapshotPath, JSON.stringify(snapshot, null, 2), { backup: false });
        const versions = fs.readdirSync(historyDirectory)
            .filter((name) => name.endsWith('.json'))
            .sort()
            .reverse();
        for (const stale of versions.slice(50)) {
            fs.unlinkSync(path.join(historyDirectory, stale));
        }
        return { ok: true, historyId: fileName, snapshotPath };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function saveNodeContentWithHistory(nodePath, content = '', options = {}) {
    try {
        const current = getPisiDocument(nodePath);
        if (!current.ok) return current;

        const normalizedIncoming = editorAssets.normalizePisiEditorAssets(
            String(content || ''),
            { writeAssets: false }
        ).content;

        if (
            String(current.data?.content || '') ===
            String(normalizedIncoming || '')
        ) {
            return {
                ok: true,
                unchanged: true,
                fullPath: nodePath,
                metadata: current.metadata,
                content: current.data.content || '',
                preview: stripPreviewText(current.data.content || '')
            };
        }
        const snapshot = snapshotPisiNodeVersion(nodePath, options.reason || 'save');
        if (!snapshot.ok) return snapshot;
        return saveNodeContent(nodePath, content);
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function listPisiNodeHistory(nodePath) {
    try {
        const directory = getPisiHistoryDirectory(nodePath);
        if (!directory || !fs.existsSync(directory)) return { ok: true, versions: [] };
        const versions = fs.readdirSync(directory)
            .filter((name) => /^\d+-.+\.json$/.test(name))
            .sort()
            .reverse()
            .slice(0, 50)
            .map((historyId) => {
                const result = readJsonFileResult(path.join(directory, historyId));
                if (!result.ok || !result.data?.data?.pisi) return null;
                return {
                    historyId,
                    capturedAt: result.data.capturedAt,
                    reason: result.data.reason || 'save',
                    hash: result.data.hash || '',
                    preview: stripPreviewText(result.data.data.content || '')
                };
            }).filter(Boolean);
        return { ok: true, versions };
    } catch (error) {
        return { ok: false, error: error.message, versions: [] };
    }
}

function getPisiNodeHistoryVersion(nodePath, historyId) {
    try {
        if (!/^\d+-.+\.json$/.test(String(historyId || ''))) {
            return { ok: false, error: 'Geçersiz sürüm kimliği.' };
        }
        const directory = getPisiHistoryDirectory(nodePath);
        const result = readJsonFileResult(path.join(directory, historyId));
        if (!result.ok || !result.data?.data) return { ok: false, error: result.error || 'Sürüm bulunamadı.' };
        return {
            ok: true,
            historyId,
            capturedAt: result.data.capturedAt,
            reason: result.data.reason,
            data: result.data.data,
            text: pisiHtmlToPlainText(result.data.data.content || '')
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function restorePisiNodeHistoryVersion(nodePath, historyId) {
    try {
        const version = getPisiNodeHistoryVersion(nodePath, historyId);
        if (!version.ok) return version;
        const current = ensurePisiFileMetadata(nodePath, { ensureSidecar: false });
        if (!current.ok) return current;
        if (version.data?.pisi?.id !== current.metadata.id) {
            return { ok: false, error: 'Sürüm başka bir node kimliğine ait.' };
        }
        const snapshot = snapshotPisiNodeVersion(nodePath, 'before-restore');
        if (!snapshot.ok) return snapshot;
        version.data.pisi.updatedAt = new Date().toISOString();
        writePisiDocument(nodePath, version.data);
        return { ok: true, fullPath: nodePath, restoredHistoryId: historyId };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

function pisiPropertiesFrontmatter(properties = {}) {
    const entries = Object.values(properties || {});
    if (!entries.length) return '';
    const lines = ['---'];
    for (const property of entries) {
        const value = Array.isArray(property.value)
            ? property.value.join(', ')
            : String(property.value ?? '');
        lines.push(`${property.name}: ${JSON.stringify(value)}`);
    }
    lines.push('---', '');
    return lines.join('\n');
}

function pisiExportHtmlDocument(info) {
    const title = escapePisiPortableHtml(info.metadata.title || 'Pisi');
    const content = stripPisiTaskMetadataHtml(
        stripPisiUnsafeExportHtml(info.data.content || '')
    );
    return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${title}</title><style>body{font:16px/1.6 system-ui;max-width:900px;margin:40px auto;padding:0 24px;color:#202124}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px}img,canvas{max-width:100%}blockquote{border-left:3px solid #888;padding-left:16px;color:#555}</style></head><body><h1>${title}</h1>${content}</body></html>`;
}

let pisiCrcTable = null;
function pisiCrc32(buffer) {
    if (!pisiCrcTable) {
        pisiCrcTable = Array.from({ length: 256 }, (_unused, index) => {
            let value = index;
            for (let bit = 0; bit < 8; bit += 1) {
                value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
            }
            return value >>> 0;
        });
    }
    let crc = 0xffffffff;
    for (const byte of buffer) crc = pisiCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function makePisiStoredZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8');
        const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
        const crc = pisiCrc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        localParts.push(local, name, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, name);
        offset += local.length + name.length + data.length;
    }
    const centralData = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralData.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...localParts, centralData, end]);
}

function makePisiDocxBuffer(info) {
    const text = pisiHtmlToPlainText(info.data.content || '');
    const paragraphs = [info.metadata.title || 'Pisi', ...text.split('\n')]
        .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapePisiPortableHtml(line)}</w:t></w:r></w:p>`)
        .join('');
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
    return makePisiStoredZip([
        { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
        { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
        { name: 'word/document.xml', data: documentXml }
    ]);
}

async function exportPisiNodeDocument(nodePath, format) {
    const info = getPisiDocument(nodePath);
    if (!info.ok) return info;
    const normalized = String(format || '').toLowerCase();
    const extension = { markdown: 'md', md: 'md', html: 'html', pdf: 'pdf', docx: 'docx' }[normalized];
    if (!extension) return { ok: false, error: 'Desteklenmeyen dışa aktarma biçimi.' };
    const result = await dialog.showSaveDialog(globalThis.mainWindow, {
        title: 'Pisi dışa aktar',
        defaultPath: `${info.metadata.title}.${extension}`,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    if (extension === 'md') {
        fs.writeFileSync(result.filePath, pisiPropertiesFrontmatter(info.data.properties) + pisiHtmlToMarkdown(info.data.content), 'utf8');
    } else if (extension === 'html') {
        fs.writeFileSync(result.filePath, pisiExportHtmlDocument(info), 'utf8');
    } else if (extension === 'docx') {
        fs.writeFileSync(result.filePath, makePisiDocxBuffer(info));
    } else {
        const printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
        try {
            await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pisiExportHtmlDocument(info))}`);
            const buffer = await printWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
            fs.writeFileSync(result.filePath, buffer);
        } finally {
            if (!printWindow.isDestroyed()) printWindow.destroy();
        }
    }
    return { ok: true, filePath: result.filePath, format: extension };
}

const PISI_MAP_EXPORT_MAX_SVG_BYTES = 12 * 1024 * 1024;
const PISI_MAP_EXPORT_MAX_PNG_BYTES = 40 * 1024 * 1024;

function validatePisiMapExportSvg(value) {
    const svg = String(value || '').trim();
    if (!svg || Buffer.byteLength(svg, 'utf8') > PISI_MAP_EXPORT_MAX_SVG_BYTES) {
        return { ok: false, error: 'Harita SVG verisi geçersiz veya çok büyük.' };
    }
    if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg)) {
        return { ok: false, error: 'Harita SVG verisi geçersiz.' };
    }
    const hasUnsafeElement = /<(?:script|foreignObject|iframe|object|embed)\b/i
        .test(svg);
    const hasUnsafeAttribute = (svg.match(/<[^>]+>/g) || []).some((tag) => (
        /\son[a-z]+\s*=/i.test(tag) ||
        /\s(?:(?:xlink:)?href|src)\s*=\s*["'](?:https?:|file:|javascript:)/i
            .test(tag)
    ));
    if (hasUnsafeElement || hasUnsafeAttribute) {
        return { ok: false, error: 'Harita SVG verisi güvenli değil.' };
    }
    return { ok: true, svg };
}

function decodePisiMapExportPng(value) {
    const match = String(value || '').match(
        /^data:image\/png;base64,([a-z0-9+/=\r\n]+)$/i
    );
    if (!match) return { ok: false, error: 'PNG verisi geçersiz.' };
    const buffer = Buffer.from(match[1], 'base64');
    if (!buffer.length || buffer.length > PISI_MAP_EXPORT_MAX_PNG_BYTES) {
        return { ok: false, error: 'PNG verisi geçersiz veya çok büyük.' };
    }
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!signature.every((byte, index) => buffer[index] === byte)) {
        return { ok: false, error: 'PNG dosya imzası geçersiz.' };
    }
    return { ok: true, buffer };
}

function getPisiMapExportPageSize(width, height) {
    const safeWidth = Math.max(1, Math.min(200000, Number(width) || 1));
    const safeHeight = Math.max(1, Math.min(200000, Number(height) || 1));
    const scale = Math.min(1, 1440 / Math.max(safeWidth, safeHeight));
    return {
        width: Math.max(1, Math.round(safeWidth * scale)),
        height: Math.max(1, Math.round(safeHeight * scale))
    };
}

async function exportPisiMapGraphic(mapPath, payload = {}) {
    const format = String(payload.format || '').toLowerCase();
    if (!['png', 'pdf'].includes(format)) {
        return { ok: false, error: 'Desteklenmeyen harita dışa aktarma biçimi.' };
    }
    const svgResult = validatePisiMapExportSvg(payload.svg);
    if (!svgResult.ok) return svgResult;

    const defaultName = path.basename(mapPath, path.extname(mapPath)) || 'Pisi-Map';
    const result = await dialog.showSaveDialog(globalThis.mainWindow, {
        title: 'Haritayı dışa aktar',
        defaultPath: `${defaultName}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }]
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };

    if (format === 'png') {
        const pngResult = decodePisiMapExportPng(payload.pngDataUrl);
        if (!pngResult.ok) return pngResult;
        fs.writeFileSync(result.filePath, pngResult.buffer);
        return { ok: true, filePath: result.filePath, format };
    }

    const page = getPisiMapExportPageSize(payload.width, payload.height);
    const html = '<!doctype html><html><head><meta charset="utf-8">' +
        `<style>@page{size:${page.width}px ${page.height}px;margin:0}` +
        `html,body{margin:0;width:${page.width}px;height:${page.height}px;` +
        'overflow:hidden;background:transparent}' +
        'svg{display:block;width:100%;height:100%}</style></head><body>' +
        `${svgResult.svg}</body></html>`;
    const printWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            sandbox: true,
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    try {
        const dataUrl = `data:text/html;charset=utf-8;base64,${
            Buffer.from(html, 'utf8').toString('base64')
        }`;
        await printWindow.loadURL(dataUrl);
        const buffer = await printWindow.webContents.printToPDF({
            printBackground: true,
            preferCSSPageSize: true
        });
        fs.writeFileSync(result.filePath, buffer);
    } finally {
        if (!printWindow.isDestroyed()) printWindow.destroy();
    }
    return { ok: true, filePath: result.filePath, format };
}

function getPisiPortableRelativePath(projectFolder, filePath, extension) {
    const relative = path.relative(projectFolder, filePath);
    const withoutExtension = relative.replace(/\.(?:node|map)$/i, '');
    return `${withoutExtension}.${extension}`;
}

async function exportPisiProjectMarkdown(projectFolder) {
    const result = await dialog.showOpenDialog(globalThis.mainWindow, {
        title: 'Markdown dışa aktarma klasörü',
        properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths?.[0]) return { ok: true, canceled: true };
    const destination = path.join(result.filePaths[0], `Pisi-Export-${pisiSafeTimestamp()}`);
    fs.mkdirSync(destination, { recursive: true });
    const files = walkPisiFiles(projectFolder, (_filePath, name) => /\.(?:node|map)$/i.test(name));
    let exported = 0;
    for (const filePath of files) {
        const info = getPisiDocument(filePath);
        if (!info.ok) continue;
        const isNode = info.metadata.type === 'node';
        const relative = getPisiPortableRelativePath(projectFolder, filePath, isNode ? 'md' : 'map.json');
        const target = path.join(destination, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (isNode) {
            fs.writeFileSync(target, pisiPropertiesFrontmatter(info.data.properties) + pisiHtmlToMarkdown(info.data.content), 'utf8');
        } else {
            fs.writeFileSync(target, JSON.stringify(info.data.map || {}, null, 2), 'utf8');
        }
        exported += 1;
    }
    return { ok: true, destination, exported };
}

function stripPisiMarkdownFrontmatter(markdown) {
    const match = String(markdown || '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (!match) return { body: String(markdown || ''), properties: {} };
    const properties = {};
    for (const line of match[1].split('\n')) {
        const separator = line.indexOf(':');
        if (separator < 1) continue;
        const name = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        try { value = JSON.parse(value); } catch {}
        const id = normalizePisiPropertyId(name);
        properties[id] = { id, name, type: 'text', value: String(value ?? '') };
    }
    return { body: String(markdown || '').slice(match[0].length), properties };
}

async function importPisiMarkdownFolder(projectFolder) {
    const result = await dialog.showOpenDialog(globalThis.mainWindow, {
        title: 'Markdown klasörü içe aktar',
        properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths?.[0]) return { ok: true, canceled: true };
    const source = result.filePaths[0];
    const destination = getUniqueDirectoryPath(projectFolder, `İçe Aktarılan ${path.basename(source)}`);
    fs.mkdirSync(destination, { recursive: true });
    const markdownFiles = walkPisiFiles(source, (_filePath, name) => /\.md$/i.test(name), { maxFiles: 10000 });
    const created = [];
    for (const markdownPath of markdownFiles) {
        const relativeDirectory = path.dirname(path.relative(source, markdownPath));
        const targetDirectory = path.join(destination, relativeDirectory === '.' ? '' : relativeDirectory);
        fs.mkdirSync(targetDirectory, { recursive: true });
        const title = sanitizePisiBaseName(path.basename(markdownPath, path.extname(markdownPath)));
        const id = generatePisiId('.node');
        const nodePath = getUniquePisiPhysicalPath(targetDirectory, title, '.node', id);
        const parsed = stripPisiMarkdownFrontmatter(fs.readFileSync(markdownPath, 'utf8'));
        const data = createPisiDocumentData({ ext: '.node', title, id });
        data.content = pisiMarkdownToHtml(parsed.body);
        data.properties = parsed.properties;
        data.pisi.importedFrom = path.relative(source, markdownPath).split(path.sep).join('/');
        writePisiDocument(nodePath, data);
        ensurePisiSidecar(nodePath, data.pisi);
        created.push(nodePath);
    }
    return { ok: true, destination, imported: created.length, created };
}

function listPisiAtomicBackups(projectFolder, filePath = null) {
    try {
        const candidates = filePath
            ? [`${filePath}.pisi-backup`]
            : walkPisiFiles(projectFolder, (_path, name) => name.endsWith('.pisi-backup'), { maxFiles: 5000 });
        const backups = candidates.filter((candidate) => fs.existsSync(candidate)).map((backupPath) => {
            const stat = fs.statSync(backupPath);
            return {
                backupId: path.relative(projectFolder, backupPath).split(path.sep).join('/'),
                targetPath: backupPath.slice(0, -'.pisi-backup'.length),
                updatedAt: stat.mtime.toISOString(),
                size: stat.size
            };
        }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return { ok: true, backups };
    } catch (error) {
        return { ok: false, error: error.message, backups: [] };
    }
}

function restorePisiAtomicBackup(projectFolder, backupId) {
    try {
        const backupPath = path.resolve(projectFolder, String(backupId || ''));
        const relative = path.relative(projectFolder, backupPath);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !backupPath.endsWith('.pisi-backup')) {
            return { ok: false, error: 'Geçersiz yedek yolu.' };
        }
        const targetPath = backupPath.slice(0, -'.pisi-backup'.length);
        const backup = readJsonFileResult(backupPath);
        if (!backup.ok || !backup.data?.pisi?.id) return { ok: false, error: 'Yedek geçerli bir Pisi belgesi değil.' };
        if (fs.existsSync(targetPath) && path.extname(targetPath).toLowerCase() === '.node') {
            const snapshot = snapshotPisiNodeVersion(targetPath, 'before-backup-restore');
            if (!snapshot.ok) return snapshot;
        }
        writeFileAtomic(targetPath, fs.readFileSync(backupPath, 'utf8'));
        return { ok: true, targetPath, backupId };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

const moduleApi = {
    decodePisiHtmlEntities,
    pisiHtmlToPlainText,
    pisiHtmlToMarkdown,
    pisiMarkdownToHtml,
    snapshotPisiNodeVersion,
    saveNodeContentWithHistory,
    listPisiNodeHistory,
    getPisiNodeHistoryVersion,
    restorePisiNodeHistoryVersion,
    makePisiDocxBuffer,
    exportPisiNodeDocument,
    exportPisiMapGraphic,
    exportPisiProjectMarkdown,
    importPisiMarkdownFolder,
    listPisiAtomicBackups,
    restorePisiAtomicBackup
};

registerMainModule('main.portability', moduleApi);
