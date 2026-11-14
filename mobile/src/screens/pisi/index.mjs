// Placeholder for the Pisi tab, the start screen: it shows the selected day,
// which is today on a cold start. Diary and tasks arrive in M5.

import { h } from '../../ui/dom.mjs';
import { renderPlaceholder } from '../../ui/placeholder.mjs';

function formatDay(isoDate, locale) {
    const [year, month, day] = isoDate.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(year, month - 1, day));
}

export function renderPisiScreen({ t, locale, selectedDate, today }) {
    const day = h(
        'p',
        { class: 'pisi-day' },
        h('time', { class: 'pisi-day-date', datetime: selectedDate }, formatDay(selectedDate, locale)),
        selectedDate === today ? h('span', { class: 'pisi-day-today' }, t('pisi.today')) : null
    );
    return renderPlaceholder({ screen: 'pisi', title: t('tab.pisi'), note: t('placeholder.note'), extra: day });
}
