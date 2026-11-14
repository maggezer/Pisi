// Placeholder for the maps tab; the real screen arrives in a later phase (docs/mobile-plan.md §4).

import { renderPlaceholder } from '../../ui/placeholder.mjs';

export function renderMapsScreen({ t }) {
    return renderPlaceholder({ screen: 'maps', title: t('tab.maps'), note: t('placeholder.note') });
}
