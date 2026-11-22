import { splitPisiWikiText } from '../../shared/wiki-link-core.mjs';
import { makePisiTaskView, pisiTaskViewTranslate } from './pisi-task-view.mjs';

// Note links in a task title outside the editor (docs/task-plan.md G6): the
// panel, the workspace and the links panel draw [[Başlık]] as the note's
// title and give each link its own button, so no link sits inside another
// control. In a note or diary the title field keeps the written text and the
// editor highlights it (renderer/editor/pisi-wiki-links.mjs).

/** The title as it reads: each [[Başlık#…]] shown as Başlık. */
export function getPisiTaskTitleReadingText(title) {
    return splitPisiWikiText(title)
        .map((part) => (part.kind === 'link' ? part.title : part.text))
        .join('');
}

/** Fills `element` with the title's text, each link as a `.pisi-task-title-link` span. */
export function appendPisiTaskTitleParts(element, title) {
    for (const part of splitPisiWikiText(title)) {
        if (part.kind === 'text') element.appendChild(document.createTextNode(part.text));
        else element.appendChild(makePisiTaskView('span', 'pisi-task-title-link', part.title));
    }
    return element;
}

/** One button per distinct linked note of a title; a click opens the note (a chooser when several notes carry the title). */
export function makePisiTaskTitleLinkButtons(title) {
    const seen = new Set();
    const buttons = [];
    for (const part of splitPisiWikiText(title)) {
        if (part.kind !== 'link') continue;
        const key = `${part.title.toLocaleLowerCase('tr-TR')}#${part.block}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const button = makePisiTaskView('button', 'pisi-task-card-link', `↗ ${part.title}`);
        button.type = 'button';
        button.dataset.pisiTaskLink = part.title;
        button.setAttribute('aria-label', `${pisiTaskViewTranslate('Bağlantılı notu aç')}: ${part.title}`);
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void window.openPisiWikiTitle?.(part.title, part.block, { x: event.clientX, y: event.clientY });
        });
        buttons.push(button);
    }
    return buttons;
}
