import { BrowserWindow, dialog } from '../electron-bridge.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { registerMainModule } from '../module-registry.js';
import * as editorAssets from './editor-asset-store.js';
import * as fileAssets from './editor-file-asset-store.js';
import {
    snapshotPisiNodeVersionBounded as snapshotPisiNodeVersion,
    saveNodeContentWithBoundedHistory as saveNodeContentWithHistory,
    listPisiNodeHistoryBounded as listPisiNodeHistory,
    getPisiNodeHistoryVersionBounded as getPisiNodeHistoryVersion,
    restorePisiNodeHistoryVersionBounded as restorePisiNodeHistoryVersion
} from './version-history-core.js';

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

function pisiGetExportSheetRows(tableHtml) {
    return Array.from(String(tableHtml || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), (rowMatch) =>
        Array.from(String(rowMatch[1] || '').matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi), (cellMatch) =>
            decodePisiHtmlEntities(
                String(cellMatch[1] || '')
                    .replace(/<br\s*\/?>/gi, ' ')
                    .replace(/<[^>]+>/g, '')
            ).trim()
        )
    );
}

function pisiExportSheetTableToPlainText(tableHtml) {
    return pisiGetExportSheetRows(tableHtml)
        .map((row) => row.join(' | '))
        .join('\n');
}

function pisiExportSheetTableToMarkdown(tableHtml) {
    const rows = pisiGetExportSheetRows(tableHtml);
    if (!rows.length) return '';
    const formatRow = (row) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')).join(' | ')} |`;
    const separator = `| ${rows[0].map(() => '---').join(' | ')} |`;
    return [formatRow(rows[0]), separator, ...rows.slice(1).map(formatRow)].join('\n');
}

function pisiTransformSheetTablesForExport(content = '') {
    return String(content || '')
        .replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi, (tableElement) => {
            const openingTag = tableElement.match(/^<table\b[^>]*>/i)?.[0] || '';
            if (!/\sdata-pisi-sheet(?:\s*=|\s|\/?>)/i.test(openingTag)) return tableElement;

            const modelAttribute = openingTag.match(/\sdata-pisi-sheet-model\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
            const serialized = modelAttribute?.[1] ?? modelAttribute?.[2] ?? modelAttribute?.[3] ?? '';
            let model;
            try {
                model = JSON.parse(decodePisiHtmlEntities(serialized));
            } catch {
                model = null;
            }
            if (!model || !Array.isArray(model.fields) || !Array.isArray(model.items)) {
                throw new Error('Sheet verisi dışa aktarılamadı; yan dosya eksik veya geçersiz.');
            }

            const fields = model.fields.filter((field) => field && typeof field.id === 'string');
            const optionsFor = (field) => (Array.isArray(field.options) ? field.options : []);
            const displayValue = (field, item) => {
                const record = item?.values?.[field.id];
                if (!record) return '';
                const value = record.value !== null && record.value !== undefined && record.value !== '' ? record.value : record.formula || '';
                if (field.type === 'select') {
                    const option = optionsFor(field).find((candidate) => candidate.id === value || candidate.label === value);
                    return option?.label ?? value;
                }
                if (field.type === 'mSelect') {
                    const values = Array.isArray(value) ? value : [];
                    return values
                        .map((itemValue) => optionsFor(field).find((option) => option.id === itemValue || option.label === itemValue)?.label ?? itemValue)
                        .join(', ');
                }
                if (field.type === 'checkbox') return value === true ? '☑' : value === false ? '☐' : String(value);
                return Array.isArray(value) ? value.join(', ') : String(value);
            };
            const cell = (tag, value) => `<${tag}>${escapePisiPortableHtml(String(value ?? ''))}</${tag}>`;
            const header = `<thead><tr>${fields.map((field) => cell('th', field.name || '')).join('')}</tr></thead>`;
            const rows = model.items.map((item) => `<tr>${fields.map((field) => cell('td', displayValue(field, item))).join('')}</tr>`).join('');
            return `<table data-pisi-sheet-export="1">${header}<tbody>${rows}</tbody></table>`;
        })
        .replace(/<table\b[^>]*\sdata-pisi-sheet(?:\s*=|\s|\/?>)[^>]*\/?>/gi, () => {
            throw new Error('Sheet verisi dışa aktarılamadı; yan dosya eksik veya geçersiz.');
        });
}

function pisiHtmlToPlainText(html = '') {
    return decodePisiHtmlEntities(
        stripPisiTaskMetadataHtml(stripPisiUnsafeExportHtml(html))
            .replace(/<table\b[^>]*data-pisi-sheet-export=["']1["'][^>]*>[\s\S]*?<\/table>/gi, pisiExportSheetTableToPlainText)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(?:p|div|h[1-6]|li|blockquote|tr|table)>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
    )
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function pisiHtmlToMarkdown(html = '') {
    let value = stripPisiTaskMetadataHtml(stripPisiUnsafeExportHtml(pisiTransformSheetTablesForExport(html)));
    value = value.replace(/<table\b[^>]*data-pisi-sheet-export=["']1["'][^>]*>[\s\S]*?<\/table>/gi, pisiExportSheetTableToMarkdown);
    value = value.replace(
        /<(div|p|blockquote|pre)\b[^>]*data-pisi-block-type=["'](bullet|number|task|quote|code)["'][^>]*>([\s\S]*?)<\/\1>/gi,
        (_all, _tag, type, body) => {
            const cleanBody = String(body || '')
                .replace(/<span\b[^>]*class=["'][^"']*pisi-block-task-marker[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
                .trim();
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
    const lines = String(markdown || '')
        .replace(/\r\n?/g, '\n')
        .split('\n');
    const output = [];
    let listOpen = false;
    const inline = (value) =>
        escapePisiPortableHtml(value)
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
    const skip = new Set(['.pisi', '.pisi-history', '.git', 'node_modules']);
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink?.()) continue;
            // Recovery payloads are retained on disk but are not active project content.
            const name = entry.name.toLowerCase();
            if (entry.isDirectory() && (skip.has(name) || name.startsWith('.pisi-delete-') || name.startsWith('.pisi-transaction-'))) continue;
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

function pisiPropertiesFrontmatter(properties = {}) {
    const entries = Object.values(properties || {});
    if (!entries.length) return '';
    const lines = ['---'];
    for (const property of entries) {
        const value = Array.isArray(property.value) ? property.value.join(', ') : String(property.value ?? '');
        lines.push(`${property.name}: ${JSON.stringify(value)}`);
    }
    lines.push('---', '');
    return lines.join('\n');
}

function pisiTransformPaintCanvases(content = '', renderImage) {
    let exportError = null;
    const images = [];
    const exported = String(content || '').replace(/<canvas\b[^>]*>(?:[\s\S]*?<\/canvas\s*>)?/gi, (canvasElement) => {
        const openingTag = canvasElement.match(/^<canvas\b[^>]*>/i)?.[0];
        if (!openingTag || !/\sdata-pisi-canvas(?:\s*=|\s|\/?>)/i.test(openingTag)) {
            return canvasElement;
        }

        const imageAttribute = openingTag.match(/\sdata-image\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        const imageData = imageAttribute?.[1] ?? imageAttribute?.[2] ?? imageAttribute?.[3] ?? '';
        const decoded = editorAssets.decodePisiPaintPngDataUrl(imageData);
        if (!decoded.ok) {
            exportError = decoded.error || 'Paint canvas PNG verisi dışa aktarılamadı.';
            return '';
        }

        const attributes = openingTag
            .replace(/^<canvas\b/i, '')
            .replace(/\s(?:data-(?:pisi-canvas|pisi-asset|image)|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(/\s*\/?>$/, '');
        const defaultAlt = /\salt\s*=/i.test(attributes) ? '' : ' alt="Paint canvas"';
        const image = { buffer: decoded.buffer, attributes, defaultAlt };
        images.push(image);
        return renderImage(image);
    });

    if (exportError) {
        throw new Error(exportError);
    }
    return { content: exported, images };
}

function pisiEmbedPaintImagesForExport(content = '') {
    return pisiTransformPaintCanvases(content, ({ buffer, attributes, defaultAlt }) => {
        const embeddedImage = `data:image/png;base64,${buffer.toString('base64')}`;
        return `<img src="${embeddedImage}"${defaultAlt}${attributes}>`;
    }).content;
}

// Image blocks reference content-addressed files in the note sidecar. Exports
// resolve each reference here; a missing asset degrades to its alt text.
function pisiTransformImageBlocks(content = '', sidecarPath, renderImage) {
    const images = [];
    const exported = String(content || '').replace(/<img\b[^>]*>/gi, (imageTag) => {
        const reference = imageTag.match(/\sdata-pisi-image-asset\s*=\s*"([^"]*)"/i)?.[1];
        if (!reference) return imageTag;
        const alt = imageTag.match(/\salt\s*=\s*"([^"]*)"/i)?.[1] || '';
        const asset = editorAssets.readPisiImageAsset(sidecarPath, reference);
        if (!asset.ok) return alt ? `<span>${alt}</span>` : '';
        const displayWidth = imageTag.match(/\sdata-pisi-image-width\s*=\s*"(\d{1,4})"/i)?.[1] || '';
        const image = { buffer: asset.buffer, mime: asset.mime, ext: reference.split('.').pop(), width: asset.width, height: asset.height, alt, displayWidth };
        images.push(image);
        return renderImage(image);
    });
    return { content: exported, images };
}

function pisiEmbedImageBlocksForExport(content = '', sidecarPath) {
    return pisiTransformImageBlocks(content, sidecarPath, ({ buffer, mime, alt, displayWidth }) => {
        const width = displayWidth ? ` width="${displayWidth}"` : '';
        return `<img src="data:${mime};base64,${buffer.toString('base64')}" alt="${alt}"${width}>`;
    }).content;
}

function formatPisiPortableFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
}

// Attachment blocks become a paragraph. With a target folder the file is copied
// next to the export under its original name and linked; otherwise (PDF, DOCX)
// the paragraph names the file and its size.
function pisiTransformFileBlocks(content = '', sidecarPath = null, assetDirectory = null) {
    const usedNames = new Set();
    return String(content || '').replace(/<div\b[^>]*\sdata-pisi-file-asset\s*=\s*"([^"]*)"[^>]*>[\s\S]*?<\/div>/gi, (blockHtml, reference) => {
        const attribute = (name) => blockHtml.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] || '';
        const name = fileAssets.normalizePisiFileName(decodePisiHtmlEntities(attribute('data-pisi-file-name')));
        const label = `📎 ${escapePisiPortableHtml(name)} (${formatPisiPortableFileSize(attribute('data-pisi-file-size'))})`;
        const stat = sidecarPath ? fileAssets.statPisiFileAsset(sidecarPath, reference) : null;
        if (!assetDirectory || !stat?.ok) return `<p>${label}</p>`;
        const dot = name.lastIndexOf('.');
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        let fileName = name;
        for (let index = 2; usedNames.has(fileName.toLowerCase()); index += 1) fileName = `${stem}-${index}${ext}`;
        usedNames.add(fileName.toLowerCase());
        fs.mkdirSync(assetDirectory, { recursive: true });
        fs.copyFileSync(stat.assetPath, path.join(assetDirectory, fileName));
        return `<p><a href="${encodeURIComponent(path.basename(assetDirectory))}/${encodeURIComponent(fileName)}">${label}</a></p>`;
    });
}

function pisiLinkPaintImagesForMarkdown(content = '', markdownPath, sidecarPath = null) {
    const directoryName = `${path.basename(markdownPath, path.extname(markdownPath))}.assets`;
    const assetDirectory = path.join(path.dirname(markdownPath), directoryName);
    const imageContent = pisiTransformImageBlocks(pisiTransformFileBlocks(content, sidecarPath, assetDirectory), sidecarPath, ({ buffer, ext, alt }) => {
        const { hash } = editorAssets.getPisiImageAssetReference(buffer, ext);
        const assetName = `image-${hash}.${ext}`;
        fs.mkdirSync(assetDirectory, { recursive: true });
        fs.writeFileSync(path.join(assetDirectory, assetName), buffer);
        return `<img src="${encodeURIComponent(directoryName)}/${assetName}" alt="${alt}">`;
    }).content;
    const sheetContent = pisiTransformSheetTablesForExport(imageContent);
    const transformed = pisiTransformPaintCanvases(sheetContent, ({ buffer, attributes, defaultAlt }) => {
        const { hash } = editorAssets.getPisiPaintAssetReference(buffer);
        const assetName = `paint-${hash}.png`;
        fs.mkdirSync(assetDirectory, { recursive: true });
        fs.writeFileSync(path.join(assetDirectory, assetName), buffer);
        const imagePath = `${encodeURIComponent(directoryName)}/${assetName}`;
        return `<img src="${imagePath}"${defaultAlt}${attributes}>`;
    });
    return transformed.content;
}

function pisiDocxPaintImageParagraph(image, index) {
    const width = image.width || image.buffer.readUInt32BE(16);
    const height = image.height || image.buffer.readUInt32BE(20);
    if (!width || !height || width > 32768 || height > 32768) {
        throw new Error('Paint canvas PNG boyutları geçersiz.');
    }
    const maxWidthEmu = 5943600;
    const widthEmu = Math.min(maxWidthEmu, width * 9525);
    const heightEmu = Math.round((widthEmu * height) / width);
    const relationshipId = `rId${index + 1}`;
    const imageName = `${image.ext ? 'image' : 'paint'}-${index + 1}.${image.ext || 'png'}`;
    return {
        imageName,
        relationshipId,
        paragraph: `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${index + 1}" name="${image.ext ? 'Image' : 'Paint canvas'} ${index + 1}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${index + 1}" name="${imageName}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    };
}

function pisiExportHtmlDocument(info, attachmentDirectory = null) {
    const title = escapePisiPortableHtml(info.metadata.title || 'Pisi');
    const withFiles = pisiTransformFileBlocks(info.data.content || '', info.sidecarPath, attachmentDirectory);
    const content = pisiEmbedImageBlocksForExport(
        pisiEmbedPaintImagesForExport(stripPisiTaskMetadataHtml(stripPisiUnsafeExportHtml(pisiTransformSheetTablesForExport(withFiles)))),
        info.sidecarPath
    );
    return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${title}</title><style>body{font:16px/1.6 system-ui;max-width:900px;margin:40px auto;padding:0 24px;color:#202124}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px}img,canvas{max-width:100%}blockquote{border-left:3px solid #888;padding-left:16px;color:#555}</style></head><body><h1>${title}</h1>${content}</body></html>`;
}

let pisiCrcTable = null;
function pisiCrc32(buffer) {
    if (!pisiCrcTable) {
        pisiCrcTable = Array.from({ length: 256 }, (_unused, index) => {
            let value = index;
            for (let bit = 0; bit < 8; bit += 1) {
                value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
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
    const content = pisiTransformSheetTablesForExport(pisiTransformFileBlocks(info.data.content || '', info.sidecarPath));
    const paintImages = [...pisiTransformPaintCanvases(content, () => '').images, ...pisiTransformImageBlocks(content, info.sidecarPath, () => '').images];
    const text = pisiHtmlToPlainText(content);
    const paragraphs = [info.metadata.title || 'Pisi', ...text.split('\n')]
        .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapePisiPortableHtml(line)}</w:t></w:r></w:p>`)
        .join('');
    const docxImages = paintImages.map(pisiDocxPaintImageParagraph);
    const imageRelationships = docxImages
        .map(
            (image) =>
                `<Relationship Id="${image.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.imageName}"/>`
        )
        .join('');
    const imageContentType = Array.from(new Set(paintImages.map((image) => image.ext || 'png')))
        .map((ext) => `<Default Extension="${ext}" ContentType="${editorAssets.PISI_IMAGE_MIME_TYPES[ext] || 'image/png'}"/>`)
        .join('');
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${paragraphs}${docxImages.map((image) => image.paragraph).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
    return makePisiStoredZip([
        {
            name: '[Content_Types].xml',
            data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageContentType}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
        },
        {
            name: '_rels/.rels',
            data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
        },
        {
            name: 'word/_rels/document.xml.rels',
            data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${imageRelationships}</Relationships>`
        },
        { name: 'word/document.xml', data: documentXml },
        ...docxImages.map((image, index) => ({
            name: `word/media/${image.imageName}`,
            data: paintImages[index].buffer
        }))
    ]);
}

/** The print/PDF document of a note: the same HTML template as the PDF export. */
function buildPisiNodePrintHtml(nodePath) {
    const info = getPisiDocument(nodePath, { hydrateEditorAssets: true });
    if (!info.ok) return info;
    return { ok: true, title: info.metadata.title || 'Pisi', html: pisiExportHtmlDocument(info) };
}

async function exportPisiNodeDocument(nodePath, format) {
    const normalized = String(format || '').toLowerCase();
    const extension = { markdown: 'md', md: 'md', html: 'html', pdf: 'pdf', docx: 'docx' }[normalized];
    if (!extension) return { ok: false, error: 'Desteklenmeyen dışa aktarma biçimi.' };
    const info = getPisiDocument(nodePath, { hydrateEditorAssets: true });
    if (!info.ok) return info;
    const result = await dialog.showSaveDialog(globalThis.mainWindow, {
        title: 'Pisi dışa aktar',
        defaultPath: `${info.metadata.title}.${extension}`,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    if (extension === 'md') {
        const content = pisiLinkPaintImagesForMarkdown(info.data.content, result.filePath, info.sidecarPath);
        fs.writeFileSync(result.filePath, pisiPropertiesFrontmatter(info.data.properties) + pisiHtmlToMarkdown(content), 'utf8');
    } else if (extension === 'html') {
        const attachmentDirectory = path.join(path.dirname(result.filePath), `${path.basename(result.filePath, path.extname(result.filePath))}.assets`);
        fs.writeFileSync(result.filePath, pisiExportHtmlDocument(info, attachmentDirectory), 'utf8');
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
    const hasUnsafeElement = /<(?:script|foreignObject|iframe|object|embed)\b/i.test(svg);
    const hasUnsafeAttribute = (svg.match(/<[^>]+>/g) || []).some(
        (tag) => /\son[a-z]+\s*=/i.test(tag) || /\s(?:(?:xlink:)?href|src)\s*=\s*["'](?:https?:|file:|javascript:)/i.test(tag)
    );
    if (hasUnsafeElement || hasUnsafeAttribute) {
        return { ok: false, error: 'Harita SVG verisi güvenli değil.' };
    }
    return { ok: true, svg };
}

function decodePisiMapExportPng(value) {
    const match = String(value || '').match(/^data:image\/png;base64,([a-z0-9+/=\r\n]+)$/i);
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
    const html =
        '<!doctype html><html><head><meta charset="utf-8">' +
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
        const dataUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`;
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
        const info = getPisiDocument(filePath, { hydrateEditorAssets: true });
        if (!info.ok) continue;
        const isNode = info.metadata.type === 'node';
        const relative = getPisiPortableRelativePath(projectFolder, filePath, isNode ? 'md' : 'map.json');
        const target = path.join(destination, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (isNode) {
            const content = pisiLinkPaintImagesForMarkdown(info.data.content, target, info.sidecarPath);
            fs.writeFileSync(target, pisiPropertiesFrontmatter(info.data.properties) + pisiHtmlToMarkdown(content), 'utf8');
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
        try {
            value = JSON.parse(value);
        } catch {}
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
        const backups = candidates
            .filter((candidate) => fs.existsSync(candidate))
            .map((backupPath) => {
                const stat = fs.statSync(backupPath);
                return {
                    backupId: path.relative(projectFolder, backupPath).split(path.sep).join('/'),
                    targetPath: backupPath.slice(0, -'.pisi-backup'.length),
                    updatedAt: stat.mtime.toISOString(),
                    size: stat.size
                };
            })
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
            const snapshot = snapshotPisiNodeVersion(targetPath, 'before-backup-restore', {
                projectFolder,
                protectedEditorAssetReferences: editorAssets.collectPisiEditorAssetReferences(backup.data.content || '')
            });
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
    buildPisiNodePrintHtml,
    exportPisiMapGraphic,
    exportPisiProjectMarkdown,
    importPisiMarkdownFolder,
    listPisiAtomicBackups,
    restorePisiAtomicBackup
};

registerMainModule('main.portability', moduleApi);
