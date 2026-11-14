// Placeholder for the calendar tab; the real screen arrives in a later phase (docs/mobile-plan.md §4).

import { renderPlaceholder } from '../placeholder.mjs';

export function renderCalendarScreen({ t }) {
    return renderPlaceholder({ screen: 'calendar', icon: 'calendar', title: t('tab.calendar'), note: t('placeholder.note') });
}
