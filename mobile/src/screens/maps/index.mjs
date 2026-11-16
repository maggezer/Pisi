// The Maps tab (docs/mobile-plan.md M9): the project's maps by title, each
// with the number of notes on it as the desktop counts them. A tap opens the
// map viewer. Mobile only views maps; it never changes one.
//
// Built once and updated in place; the list is read again whenever the
// project index changes (the sample project, a note written elsewhere).

import { h } from '../../ui/dom.mjs';
import { icon } from '../../ui/icons.mjs';
import { renderEmptyState, renderList, renderListRow } from '../../ui/list.mjs';

/** `onOpenMap({ key, title })` asks the app to open the viewer for that map. */
export function createMapsScreen({ project = null, onOpenMap, onError = () => {} }) {
    const element = h('section', { class: 'pisi-screen pisi-maps', dataset: { screen: 'maps' } });
    const body = h('div', { class: 'pisi-maps-body', dataset: { maps: 'list' } });
    const state = { maps: null };
    let context = null;
    let drawn = null;
    let token = 0;
    let destroyed = false;
    element.append(body);

    function draw() {
        if (!context || (drawn && drawn.maps === state.maps && drawn.t === context.t)) return;
        drawn = { maps: state.maps, t: context.t };
        const { t } = context;
        body.setAttribute('aria-busy', state.maps ? 'false' : 'true');
        if (!state.maps) return void body.replaceChildren(renderEmptyState({ icon: 'maps', title: t('maps.listLoading') }));
        if (!state.maps.length) return void body.replaceChildren(renderEmptyState({ icon: 'maps', title: t('maps.empty'), note: t('maps.emptyNote') }));
        body.replaceChildren(
            renderList({
                label: t('tab.maps'),
                rows: state.maps.map((map) =>
                    renderListRow({
                        title: map.title || t('maps.untitled'),
                        meta: map.nodeCount === 1 ? t('maps.noteCountOne') : t('maps.noteCount', { count: map.nodeCount }),
                        leading: icon('maps'),
                        chevron: true,
                        dataset: { map: map.key },
                        onClick: () => onOpenMap({ key: map.key, title: map.title })
                    })
                )
            })
        );
    }

    async function reload() {
        if (!project) {
            state.maps = [];
            return draw();
        }
        const current = (token += 1);
        try {
            await project.index.build();
            const maps = await project.maps.list();
            if (destroyed || current !== token) return;
            state.maps = maps;
        } catch (error) {
            onError(error);
            if (destroyed || current !== token) return;
            state.maps = [];
        }
        draw();
    }

    const stop = project?.index.subscribe(() => void reload());

    return {
        element,

        update(next) {
            context = next;
            draw();
        },

        /** On screen again: the list is read again. */
        attach: () => void reload(),
        reload,

        destroy() {
            destroyed = true;
            stop?.();
        }
    };
}
