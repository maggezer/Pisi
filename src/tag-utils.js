export function normalizeTag(value) {
  return String(value || '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 32);
}

export function normalizeTags(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map(normalizeTag)
    .filter((tag) => {
      const key = tag.toLocaleLowerCase('tr-TR');
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 24);
}

export function collectTags(documents) {
  const counts = new Map();
  (Array.isArray(documents) ? documents : []).forEach((document) => {
    normalizeTags(document?.tags).forEach((tag) => {
      const key = tag.toLocaleLowerCase('tr-TR');
      const current = counts.get(key) || { tag, count: 0 };
      current.count += 1;
      counts.set(key, current);
    });
  });
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'tr-TR'));
}

export function documentMatchesTag(document, tag) {
  const wanted = normalizeTag(tag).toLocaleLowerCase('tr-TR');
  return !wanted || normalizeTags(document?.tags).some((item) => item.toLocaleLowerCase('tr-TR') === wanted);
}
