// Placeholder for the tasks tab; the real screen arrives in a later phase (docs/mobile-plan.md §4).

import { renderPlaceholder } from '../placeholder.mjs';

export function renderTasksScreen({ t }) {
    return renderPlaceholder({ screen: 'tasks', icon: 'tasks', title: t('tab.tasks'), note: t('placeholder.note') });
}
