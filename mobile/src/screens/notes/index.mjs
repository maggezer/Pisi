// Placeholder for the notes tab; the real screen arrives in a later phase (docs/mobile-plan.md §4).

import { renderPlaceholder } from '../../ui/placeholder.mjs';

export function renderNotesScreen({ t }) {
    return renderPlaceholder({ screen: 'notes', title: t('tab.notes'), note: t('placeholder.note') });
}
