// The formatting bar of the note editor (docs/mobile-plan.md M7, G10): bold,
// italic, heading, bulleted list, numbered list. It sits at the bottom of the
// note screen, which is right above the keyboard while one is open. The
// buttons are SVG icons with a 48 dp touch area; pressing one does not take
// the focus (and with it the keyboard and the selection) away from the text.

import { h } from '../../ui/dom.mjs';
import { icon } from '../../ui/icons.mjs';

const BUTTONS = Object.freeze([
    { id: 'bold', icon: 'bold' },
    { id: 'italic', icon: 'italic' },
    { id: 'heading', icon: 'heading' },
    { id: 'bullet', icon: 'list-bullet' },
    { id: 'number', icon: 'list-number' }
]);

/** `onCommand(id)` runs a button; `update(state)` takes the editor's `getState()`. */
export function createNoteToolbar({ t, onCommand }) {
    const buttons = Object.fromEntries(
        BUTTONS.map((button) => {
            const element = h(
                'button',
                { type: 'button', class: 'pisi-note-tool', 'aria-label': t(`note.tool.${button.id}`), 'aria-pressed': 'false', dataset: { tool: button.id } },
                icon(button.icon),
                button.id === 'heading' ? h('span', { class: 'pisi-note-tool-level', 'aria-hidden': 'true' }) : null
            );
            // The press must not move the focus out of the block being edited.
            element.addEventListener('pointerdown', (event) => event.preventDefault());
            element.addEventListener('mousedown', (event) => event.preventDefault());
            element.addEventListener('click', () => onCommand(button.id));
            return [button.id, element];
        })
    );
    const element = h('div', { class: 'pisi-note-toolbar', role: 'toolbar', 'aria-label': t('note.toolbar'), hidden: true }, Object.values(buttons));

    return {
        element,
        update(state) {
            element.hidden = !state;
            if (!state) return;
            const level = /^heading([1-3])$/.exec(state.type)?.[1] ?? '';
            const pressed = {
                bold: state.bold,
                italic: state.italic,
                heading: Boolean(level),
                bullet: state.type === 'bullet',
                number: state.type === 'number'
            };
            for (const [id, button] of Object.entries(buttons)) button.setAttribute('aria-pressed', pressed[id] ? 'true' : 'false');
            buttons.bold.disabled = !state.canBold;
            buttons.heading.querySelector('.pisi-note-tool-level').textContent = level;
            buttons.heading.setAttribute('aria-label', level ? t('note.tool.headingLevel', { level }) : t('note.tool.heading'));
        }
    };
}
