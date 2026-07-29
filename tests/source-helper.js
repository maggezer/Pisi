'use strict';

function extractFunction(source, functionName) {
    const marker = `function ${functionName}(`;
    const start = source.indexOf(marker);

    if (start < 0) {
        throw new Error(`Fonksiyon bulunamadı: ${functionName}`);
    }

    const signatureEnd = source.indexOf(') {', start);
    const bodyStart = signatureEnd >= 0
        ? signatureEnd + 2
        : source.indexOf('{', start);
    if (bodyStart < 0) {
        throw new Error(`Fonksiyon gövdesi bulunamadı: ${functionName}`);
    }

    let depth = 0;
    let quote = null;
    let escaped = false;
    let regex = false;
    let regexCharacterClass = false;
    let lineComment = false;
    let blockComment = false;
    let previousSignificant = '';

    for (let index = bodyStart; index < source.length; index += 1) {
        const character = source[index];
        const nextCharacter = source[index + 1] || '';

        if (lineComment) {
            if (character === '\n') {
                lineComment = false;
            }
            continue;
        }

        if (blockComment) {
            if (character === '*' && nextCharacter === '/') {
                blockComment = false;
                index += 1;
            }
            continue;
        }

        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === quote) {
                quote = null;
            }
            continue;
        }

        if (regex) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '[') {
                regexCharacterClass = true;
            } else if (character === ']') {
                regexCharacterClass = false;
            } else if (
                character === '/' &&
                !regexCharacterClass
            ) {
                regex = false;
                previousSignificant = '/';
            }
            continue;
        }

        if (character === '"' || character === "'" || character === '`') {
            quote = character;
            continue;
        }

        if (character === '/' && nextCharacter === '/') {
            lineComment = true;
            index += 1;
            continue;
        }

        if (character === '/' && nextCharacter === '*') {
            blockComment = true;
            index += 1;
            continue;
        }

        if (
            character === '/' &&
            (!previousSignificant ||
                '([{:;,=!?&|'.includes(previousSignificant))
        ) {
            regex = true;
            regexCharacterClass = false;
            escaped = false;
            continue;
        }

        if (character === '{') depth += 1;
        if (character === '}') depth -= 1;

        if (depth === 0) {
            return source.slice(start, index + 1);
        }

        if (!/\s/.test(character)) {
            previousSignificant = character;
        }
    }

    throw new Error(`Fonksiyon sonu bulunamadı: ${functionName}`);
}

module.exports = {
    extractFunction
};
