function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineMarkdown(text) {
    return escapeHtml(text)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, '<a href="$2">$1</a>');
}

export function parsePisiPlainPaste(plain = '') {
    if (!plain) return [];
    const lines = String(plain).replace(/\r\n?/g, '\n').split('\n');
    const markdown = lines.some((line) => /^(?:#{1,5}\s|\s*[-*+]\s|\d+[.)]\s|>\s?|```)/.test(line));
    /** @type {Array<{tag: string, type: string, indent: number, text: string, html?: string, checked?: boolean}>} */
    const blocks = [];
    let code = null;
    for (const line of lines) {
        if (/^```/.test(line)) {
            if (code) {
                blocks.push({ tag: 'pre', type: 'code', indent: 0, text: code.join('\n') });
                code = null;
            } else code = [];
            continue;
        }
        if (code) {
            code.push(line);
            continue;
        }
        const heading = line.match(/^(#{1,5})\s+(.*)$/);
        const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s?(.*)$/);
        const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
        const number = line.match(/^\d+[.)]\s+(.*)$/);
        const quote = line.match(/^>\s?(.*)$/);
        /** @type {{tag: string, type: string, indent: number, text: string, html?: string, checked?: boolean}} */
        let item = { tag: 'div', type: 'paragraph', indent: 0, text: line };
        if (heading) item = { ...item, tag: 'h' + heading[1].length, type: 'heading' + heading[1].length, text: heading[2] };
        else if (task) item = { ...item, type: 'task', text: task[2], checked: task[1].toLowerCase() === 'x' };
        else if (bullet) item = { ...item, type: 'bullet', indent: Math.min(6, Math.floor(bullet[1].replace(/\t/g, '  ').length / 2)), text: bullet[2] };
        else if (number) item = { ...item, type: 'number', text: number[1] };
        else if (quote) item = { ...item, tag: 'blockquote', type: 'quote', text: quote[1] };
        if (markdown && item.text) item.html = inlineMarkdown(item.text);
        blocks.push(item);
    }
    if (code) blocks.push({ tag: 'pre', type: 'code', indent: 0, text: code.join('\n') });
    return blocks;
}
