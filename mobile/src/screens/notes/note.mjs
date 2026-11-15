// The note screen, opened from a task's source note. For now it only names
// the note; reading and editing arrive with the Notes phase (docs/mobile-plan.md M7).

import { renderPlaceholder } from '../placeholder.mjs';

export function renderNoteScreen({ t, note }) {
    return renderPlaceholder({ screen: 'note', icon: 'notes', title: note?.title || t('tab.notes'), note: t('note.placeholder') });
}
