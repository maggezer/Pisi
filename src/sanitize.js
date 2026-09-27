export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function htmlToText(value = '') {
  const element = document.createElement('div');
  element.innerHTML = sanitizeRichHtml(value);
  return element.textContent?.replace(/\s+/g, ' ').trim() || '';
}

export function sanitizeRichHtml(value = '') {
  const template = document.createElement('template');
  template.innerHTML = String(value);

  const blocked = template.content.querySelectorAll(
    'script, style, iframe, object, embed, link, meta, form, input, textarea, select, option'
  );
  blocked.forEach((node) => node.remove());

  template.content.querySelectorAll('button').forEach((node) => {
    if (!node.classList.contains('pisi-task-checkbox')) node.remove();
    else {
      node.type = 'button';
      node.setAttribute('contenteditable', 'false');
      node.textContent = node.dataset.done === 'true' ? '✓' : '';
    }
  });

  template.content.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const val = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
        node.removeAttribute(attribute.name);
      }
      if ((name === 'href' || name === 'src') && val.startsWith('javascript:')) {
        node.removeAttribute(attribute.name);
      }
      if (name === 'style') {
        const allowedStyleProperties = new Set([
          'background-color',
          'color',
          'font-family',
          'font-size',
          'font-style',
          'font-weight',
          'text-align',
          'text-decoration'
        ]);
        const safe = attribute.value
          .split(';')
          .map((rule) => rule.trim())
          .filter(Boolean)
          .map((rule) => {
            const separatorIndex = rule.indexOf(':');
            if (separatorIndex < 1) return '';
            const property = rule.slice(0, separatorIndex).trim().toLowerCase();
            const propertyValue = rule.slice(separatorIndex + 1).trim();
            if (
              !allowedStyleProperties.has(property)
              || /url\s*\(|expression\s*\(|@import/i.test(propertyValue)
            ) return '';
            return `${property}: ${propertyValue}`;
          })
          .filter(Boolean)
          .join('; ');
        if (safe) node.setAttribute('style', safe);
        else node.removeAttribute('style');
      }
    });
  });

  return template.innerHTML;
}

