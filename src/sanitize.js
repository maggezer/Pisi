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
    'script, style, iframe, object, embed, link, meta, form, input, button'
  );
  blocked.forEach((node) => node.remove());

  template.content.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const val = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') node.removeAttribute(attribute.name);
      if ((name === 'href' || name === 'src') && val.startsWith('javascript:')) {
        node.removeAttribute(attribute.name);
      }
    });
  });

  return template.innerHTML;
}

