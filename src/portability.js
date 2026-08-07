import { createDocument } from './db.js';
import { blocksToMarkdown, documentBlocksFromHtml } from './blocks.js';
import { escapeHtml, htmlToText, sanitizeRichHtml } from './sanitize.js';
import { saveAndShareFile } from './native.js';

function safeFileName(value, extension) {
  const base = String(value || 'Pisi-belgesi').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'Pisi-belgesi';
  return `${base}.${extension}`;
}

export function documentToMarkdown(document) {
  const blocks = document.blocks?.length ? document.blocks : documentBlocksFromHtml(document.content);
  const properties = Object.keys(document.properties || {}).length
    ? `---\n${Object.entries(document.properties).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n')}\ntags: ${(document.tags || []).join(', ')}\n---\n\n`
    : '';
  return `${properties}# ${document.title}\n\n${blocksToMarkdown(blocks)}\n`;
}

export function documentToHtml(document) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${escapeHtml(document.title)}</title><style>body{font:16px/1.65 system-ui;max-width:820px;margin:48px auto;padding:0 24px;color:#241d18}blockquote{border-left:4px solid #d9892b;padding-left:16px}img{max-width:100%}.pisi-task-checkbox{margin-right:8px}</style></head><body><h1>${escapeHtml(document.title)}</h1>${sanitizeRichHtml(document.content)}</body></html>`;
}

export async function markdownToDocument(markdown, title = 'İçe aktarılan not') {
  const { marked } = await import('marked');
  const source = String(markdown || '');
  const frontmatter = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const properties = {};
  let tags = [];
  if (frontmatter) {
    frontmatter[1].split('\n').forEach((line) => {
      const separator = line.indexOf(':');
      if (separator < 0) return;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (key === 'tags') tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
      else properties[key] = value;
    });
  }
  const body = frontmatter ? source.slice(frontmatter[0].length) : source;
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const content = sanitizeRichHtml(await marked.parse(body, { async: true, gfm: true }));
  const document = createDocument('note', { title: heading || title, content, properties, tags });
  document.blocks = documentBlocksFromHtml(content);
  return document;
}

export function htmlToDocument(html, title = 'İçe aktarılan not') {
  const page = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const documentTitle = page.querySelector('h1')?.textContent?.trim() || page.title || title;
  const content = sanitizeRichHtml(page.body?.innerHTML || html);
  const result = createDocument('note', { title: documentTitle, content });
  result.blocks = documentBlocksFromHtml(content);
  return result;
}

async function makePdf(document) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const margin = 52;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  let y = 58;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  const titleLines = pdf.splitTextToSize(document.title, width);
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 24 + 14;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  const lines = pdf.splitTextToSize(htmlToText(document.content), width);
  for (const line of lines) {
    if (y > pdf.internal.pageSize.getHeight() - 48) { pdf.addPage(); y = 54; }
    pdf.text(line, margin, y);
    y += 16;
  }
  return pdf.output('blob');
}

async function makeDocx(document) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx');
  const blocks = document.blocks?.length ? document.blocks : documentBlocksFromHtml(document.content);
  const children = [new Paragraph({ text: document.title, heading: HeadingLevel.TITLE })];
  blocks.forEach((block) => {
    const text = block.type === 'todo' ? `${block.done ? '☑' : '☐'} ${block.text}` : block.text;
    const heading = block.type === 'h1' ? HeadingLevel.HEADING_1
      : block.type === 'h2' ? HeadingLevel.HEADING_2
        : block.type === 'h3' ? HeadingLevel.HEADING_3 : undefined;
    children.push(new Paragraph({ heading, children: [new TextRun({ text, italics: block.type === 'blockquote' })] }));
  });
  return Packer.toBlob(new Document({ sections: [{ children }] }));
}

export async function exportDocument(document, format) {
  const normalized = String(format || 'md').toLocaleLowerCase('en-US');
  if (normalized === 'md' || normalized === 'markdown') {
    return saveAndShareFile(safeFileName(document.title, 'md'), documentToMarkdown(document), 'text/markdown;charset=utf-8');
  }
  if (normalized === 'html') {
    return saveAndShareFile(safeFileName(document.title, 'html'), documentToHtml(document), 'text/html;charset=utf-8');
  }
  if (normalized === 'pdf') {
    return saveAndShareFile(safeFileName(document.title, 'pdf'), await makePdf(document), 'application/pdf');
  }
  if (normalized === 'docx') {
    return saveAndShareFile(safeFileName(document.title, 'docx'), await makeDocx(document), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }
  throw new Error(`Desteklenmeyen dışa aktarma biçimi: ${format}`);
}

export async function importPortableFile(file) {
  const extension = String(file?.name || '').split('.').pop().toLocaleLowerCase('en-US');
  if (extension === 'md' || extension === 'markdown') return markdownToDocument(await file.text(), file.name.replace(/\.[^.]+$/, ''));
  if (extension === 'html' || extension === 'htm') return htmlToDocument(await file.text(), file.name.replace(/\.[^.]+$/, ''));
  throw new Error('Yalnızca Markdown ve HTML dosyaları içe aktarılabilir.');
}
