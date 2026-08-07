import { makeId } from './db.js';
import { escapeHtml, htmlToText } from './sanitize.js';
import { parseTurkishDate } from './date-parser.js';

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'LI', 'BLOCKQUOTE', 'PRE']);
const TODO_PATTERN = /(?:\.\.todo|\/todo)(?:\.([xX!]{1,3}|low|normal|high|urgent))?(?:\.(\d{2}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}))?/i;
const DONE_PATTERN = /(?:\.\.done|\/done)\b/i;

function importanceFromToken(token = '') {
  const normalized = token.toLocaleLowerCase('en-US');
  if (['urgent', 'xxx', '!!!'].includes(normalized)) return 'urgent';
  if (['high', 'xx', '!!'].includes(normalized)) return 'high';
  if (['low', 'x', '!'].includes(normalized)) return normalized === 'x' || normalized === '!' ? 'high' : 'low';
  return 'normal';
}

function dateFromToken(token) {
  if (!token) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const [day, month, year] = token.split('-').map(Number);
  if (!day || !month || !year) return null;
  return `${year < 100 ? 2000 + year : year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseTodoSyntax(value = '') {
  const text = String(value || '');
  const todo = text.match(TODO_PATTERN);
  const done = DONE_PATTERN.test(text);
  if (!todo && !done) return null;
  const cleaned = text.replace(TODO_PATTERN, '').replace(DONE_PATTERN, '').replace(/\s+/g, ' ').trim();
  const natural = parseTurkishDate(cleaned);
  return {
    text: cleaned,
    done,
    importance: importanceFromToken(todo?.[1]),
    scheduledAt: dateFromToken(todo?.[2]) || natural.scheduledAt,
    deadline: natural.deadline,
    reminderAt: natural.reminderAt,
    durationMinutes: natural.durationMinutes,
    repeat: natural.repeat
  };
}

function taskCheckbox(block, done = false) {
  let checkbox = block.querySelector(':scope > .pisi-task-checkbox');
  if (!checkbox) {
    checkbox = document.createElement('button');
    checkbox.type = 'button';
    checkbox.contentEditable = 'false';
    checkbox.className = 'pisi-task-checkbox';
    checkbox.setAttribute('aria-label', 'Görevi tamamla');
    block.prepend(checkbox);
  }
  checkbox.dataset.done = String(done);
  checkbox.setAttribute('aria-checked', String(done));
  checkbox.textContent = done ? '✓' : '';
  block.classList.toggle('pisi-task-done', done);
  block.dataset.blockType = 'todo';
  block.dataset.taskDone = String(done);
  return checkbox;
}

function directBlocks(editor) {
  return Array.from(editor.querySelectorAll(':scope > p, :scope > div, :scope > h1, :scope > h2, :scope > h3, :scope > blockquote, :scope > pre, :scope > ul > li, :scope > ol > li'));
}

export function ensureBlockStructure(editor) {
  if (!editor) return [];
  Array.from(editor.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      const paragraph = document.createElement('p');
      paragraph.textContent = node.textContent;
      node.replaceWith(paragraph);
    }
  });
  if (!editor.children.length) editor.innerHTML = '<p><br></p>';
  directBlocks(editor).forEach((block) => {
    block.dataset.blockId ||= makeId('block');
    block.dataset.blockType ||= block.tagName.toLocaleLowerCase('en-US');
    const parsed = parseTodoSyntax(block.textContent);
    if (parsed) convertBlockToTodo(block, parsed);
  });
  return directBlocks(editor);
}

export function convertBlockToTodo(block, task = {}) {
  if (!block) return null;
  block.dataset.blockId ||= makeId('block');
  const parsed = typeof task === 'string' ? parseTodoSyntax(task) : task;
  const done = Boolean(parsed?.done);
  const checkbox = taskCheckbox(block, done);
  const currentText = parsed?.text ?? block.textContent.replace(/^✓/, '').trim();
  Array.from(block.childNodes).forEach((node) => { if (node !== checkbox) node.remove(); });
  block.append(document.createTextNode(currentText || 'Yeni görev'));
  block.dataset.importance = parsed?.importance || 'normal';
  block.dataset.scheduledAt = parsed?.scheduledAt || '';
  block.dataset.deadline = parsed?.deadline || '';
  block.dataset.durationMinutes = String(parsed?.durationMinutes || 0);
  block.dataset.repeat = parsed?.repeat || 'none';
  return block;
}

export function serializeBlocks(editor) {
  return ensureBlockStructure(editor).map((block, index) => ({
    id: block.dataset.blockId || makeId('block'),
    type: block.dataset.blockType || block.tagName.toLocaleLowerCase('en-US'),
    index,
    text: block.textContent.replace(/^✓/, '').trim(),
    html: block.innerHTML,
    done: block.dataset.taskDone === 'true',
    importance: block.dataset.importance || 'normal',
    scheduledAt: block.dataset.scheduledAt || null,
    deadline: block.dataset.deadline || null,
    durationMinutes: Number(block.dataset.durationMinutes) || 0,
    repeat: block.dataset.repeat || 'none',
    references: Array.from(block.textContent.matchAll(/\(\(([A-Za-z0-9_-]+)\)\)/g), (match) => match[1])
  }));
}

function currentBlock(editor) {
  const selection = getSelection();
  const node = selection?.anchorNode;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const block = element?.closest?.('[data-block-id], p, div, h1, h2, h3, li, blockquote, pre');
  return block && editor.contains(block) ? block : null;
}

function placeCaretAtEnd(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

export function insertTodoAtSelection(editor, options = {}) {
  editor?.focus();
  let block = currentBlock(editor);
  if (!block) {
    block = document.createElement('p');
    block.textContent = options.text || 'Yeni görev';
    editor.append(block);
  }
  if (options.text && !block.textContent.trim()) block.textContent = options.text;
  convertBlockToTodo(block, { ...options, text: options.text ?? block.textContent.trim() });
  placeCaretAtEnd(block);
  return block;
}

function applyMarkdownShortcut(block) {
  const text = block.textContent || '';
  const shortcuts = [
    ['###', 'h3'], ['##', 'h2'], ['#', 'h1'], ['>', 'blockquote'], ['```', 'pre']
  ];
  const shortcut = shortcuts.find(([prefix]) => text === prefix);
  if (!shortcut) return false;
  const replacement = document.createElement(shortcut[1]);
  replacement.dataset.blockId = block.dataset.blockId || makeId('block');
  replacement.dataset.blockType = shortcut[1];
  replacement.innerHTML = '<br>';
  block.replaceWith(replacement);
  placeCaretAtEnd(replacement);
  return true;
}

export function bindPisiBlocks(editor, callbacks = {}) {
  ensureBlockStructure(editor);
  const normalize = () => {
    ensureBlockStructure(editor);
    callbacks.onChange?.(serializeBlocks(editor));
  };
  editor.addEventListener('input', (event) => {
    const block = currentBlock(editor);
    const raw = block?.textContent || '';
    const parsed = block && (/\s$/.test(raw) || event.inputType === 'insertFromPaste') ? parseTodoSyntax(raw) : null;
    if (parsed) {
      convertBlockToTodo(block, parsed);
      placeCaretAtEnd(block);
    }
    normalize();
  });
  editor.addEventListener('keydown', (event) => {
    const block = currentBlock(editor);
    if (event.key === ' ' && block && applyMarkdownShortcut(block)) {
      event.preventDefault();
      normalize();
      return;
    }
    if (event.key === 'Enter' && block) {
      const parsed = parseTodoSyntax(block.textContent);
      if (parsed) {
        event.preventDefault();
        convertBlockToTodo(block, parsed);
        const next = document.createElement('p');
        next.innerHTML = '<br>';
        block.after(next);
        ensureBlockStructure(editor);
        placeCaretAtEnd(next);
        normalize();
        return;
      }
    }
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      document.execCommand('insertLineBreak');
    }
  });
  editor.addEventListener('click', (event) => {
    const checkbox = event.target.closest('.pisi-task-checkbox');
    if (!checkbox || !editor.contains(checkbox)) return;
    event.preventDefault();
    const block = checkbox.closest('[data-block-id]');
    const done = block.dataset.taskDone !== 'true';
    taskCheckbox(block, done);
    callbacks.onTaskToggle?.(block.dataset.blockId, done);
    normalize();
  });
  return { normalize, insertTodo: (options) => insertTodoAtSelection(editor, options) };
}

export function blocksToMarkdown(blocks = []) {
  return blocks.map((block) => {
    const text = block.text || '';
    if (block.type === 'h1') return `# ${text}`;
    if (block.type === 'h2') return `## ${text}`;
    if (block.type === 'h3') return `### ${text}`;
    if (block.type === 'blockquote') return `> ${text}`;
    if (block.type === 'todo') return `- [${block.done ? 'x' : ' '}] ${text}`;
    if (block.type === 'li') return `- ${text}`;
    if (block.type === 'pre') return `\`\`\`\n${text}\n\`\`\``;
    return text;
  }).join('\n\n');
}

export function renderBlockReference(block, sourceTitle) {
  return `<blockquote class="pisi-block-reference" data-reference="${escapeHtml(block.id)}"><small>${escapeHtml(sourceTitle)}</small>${escapeHtml(block.text)}</blockquote>`;
}

export function blockRelationshipGraph(documents = [], targetBlockId) {
  const inbound = [];
  documents.forEach((document) => {
    (document.blocks || []).forEach((block) => {
      if ((block.references || []).includes(targetBlockId)) inbound.push({ document, block });
    });
  });
  return inbound;
}

export function documentBlocksFromHtml(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  ensureBlockStructure(host);
  return serializeBlocks(host);
}

export function plainBlockText(block) {
  return htmlToText(block?.html || block?.text || '');
}
