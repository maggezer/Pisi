// How text is folded before it is searched, on the desktop and on mobile:
// Turkish letters match their plain forms (İ↔i, I↔ı, ş↔s, …), accents are
// dropped, and everything that is not a letter or digit separates words.
// `I` is folded here, before lower-casing: in the Turkish locale it lower-cases
// to `ı`, which the last step would otherwise drop as a non-letter.

function replaceTurkishSearchCharacters(value) {
    return value.replace(/[ıİI]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g').replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c');
}

export function normalizePisiSearchText(value = '') {
    return replaceTurkishSearchCharacters(String(value || ''))
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLocaleLowerCase('tr-TR')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function tokenizePisiSearchQuery(query = '') {
    return normalizePisiSearchText(query).split(' ').filter(Boolean);
}
