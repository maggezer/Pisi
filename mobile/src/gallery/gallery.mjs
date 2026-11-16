// Component gallery, opened with `?gallery` in development builds only
// (see main.mjs; it is not part of the production bundle). It shows every
// token and component on one page so that they can be reviewed and
// photographed in both themes. The sample texts are developer-facing and
// therefore live here, not in the locale files.

import './gallery.css';
import { resolveTheme } from '../app/theme.mjs';
import { renderButton, renderFab, renderIconButton } from '../ui/button.mjs';
import { renderChip, renderChipRow, renderSegmented } from '../ui/chip.mjs';
import { contrastRatio } from '../ui/contrast.mjs';
import { renderDatePicker } from '../ui/date-picker.mjs';
import { shiftMonth } from '../ui/dates.mjs';
import { h } from '../ui/dom.mjs';
import { renderCheckbox, renderSearchField, renderTextField } from '../ui/field.mjs';
import { PISI_ICON_NAMES, icon } from '../ui/icons.mjs';
import { renderCard, renderEmptyState, renderList, renderListRow } from '../ui/list.mjs';
import { renderChoiceSheet, renderDialog, renderSheet } from '../ui/overlay.mjs';
import { renderBottomNav, renderHeader } from '../ui/shell.mjs';
import { createSnackbarController, renderSnackbar } from '../ui/snackbar.mjs';
import { createTaskAddRow } from '../ui/task-add.mjs';
import { renderTaskRow } from '../ui/task-row.mjs';
import { PISI_TOKEN_PAIRS } from '../ui/token-pairs.mjs';

// The add line with a line typed in: read-only chips and the priority chip, which is a button.
function taskAddSample() {
    const labels = { 'pisi.addTask': 'Görev ekle', 'pisi.addTaskSubmit': 'Görevi kaydet' };
    const row = createTaskAddRow({
        t: (key) => labels[key],
        id: 'gallery-task-add',
        describe: () => [
            { kind: 'date', icon: 'calendar', text: 'Yarın' },
            { kind: 'time', icon: 'clock', text: '14:00' },
            { kind: 'priority', text: 'Öncelik 4', label: 'Öncelik 4, Yüksek. Değiştir', onClick: () => {} },
            { kind: 'repeat', icon: 'repeat', text: 'Her hafta' }
        ],
        onSubmit: () => {}
    });
    row.input.value = 'yarın 14:00 haftalık rapor';
    row.refresh();
    return row.element;
}

const SURFACE_TOKENS = [
    '--pisi-bg',
    '--pisi-surface',
    '--pisi-surface-2',
    '--pisi-surface-3',
    '--pisi-accent-soft',
    '--pisi-accent',
    '--pisi-danger',
    '--pisi-inverse-surface'
];
const TYPE_SCALE = [
    ['2xl', '32'],
    ['xl', '24'],
    ['lg', '20'],
    ['md', '16'],
    ['sm', '14'],
    ['xs', '12']
];
const SPACES = [1, 2, 3, 4, 5, 6, 7];
const TABS = [
    { id: 'pisi', icon: 'pisi', label: 'Pisi' },
    { id: 'tasks', icon: 'tasks', label: 'Görevler' },
    { id: 'notes', icon: 'notes', label: 'Notlar' },
    { id: 'calendar', icon: 'calendar', label: 'Takvim' },
    { id: 'maps', icon: 'maps', label: 'Haritalar' }
];
const FILTERS = [
    ['today', 'Bugün', 3],
    ['upcoming', 'Yaklaşan', 12],
    ['overdue', 'Gecikmiş', 1],
    ['inbox', 'Gelen kutusu', 4],
    ['done', 'Tamamlanan', 27]
];
const DATE_LABELS = {
    close: 'Kapat',
    previousMonth: 'Önceki ay',
    nextMonth: 'Sonraki ay',
    today: 'Bugün',
    goToday: 'Bugüne dön',
    hasTasks: 'görev var',
    hasDiary: 'günlük var',
    legendTasks: 'Görev',
    legendDiary: 'Günlük'
};
const DATE_MARKS = { tasks: new Set(['2026-11-12', '2026-11-14', '2026-11-17']), diary: new Set(['2026-11-10', '2026-11-14']) };
const PRIORITIES = ['Çok düşük', 'Düşük', 'Orta', 'Yüksek', 'Çok yüksek'];
const THEMES = [
    { value: 'system', label: 'Sistem' },
    { value: 'light', label: 'Açık' },
    { value: 'dark', label: 'Koyu' }
];

const section = (id, title, ...children) =>
    h('section', { class: 'gallery-section', dataset: { gallery: id } }, h('h2', { class: 'gallery-heading' }, title), children);
const frame = (...children) => h('div', { class: 'gallery-frame' }, children);
const stack = (...children) => h('div', { class: 'gallery-stack' }, children);
const cluster = (...children) => h('div', { class: 'gallery-cluster' }, children);

export function mountGallery({ root, systemTheme }) {
    const view = root.ownerDocument.defaultView;
    const documentRoot = root.ownerDocument.documentElement;
    const state = {
        theme: 'system',
        tab: 'pisi',
        filter: 'today',
        done: new Set(['b', 'row-3']),
        agreed: true,
        overlay: null,
        sheetChoice: 'light',
        month: '2026-11',
        date: '2026-11-12'
    };
    const snackbar = createSnackbarController({
        onChange: () => render(),
        setTimer: (run, ms) => view.setTimeout(run, ms),
        clearTimer: (id) => view.clearTimeout(id)
    });

    const token = (name) => view.getComputedStyle(documentRoot).getPropertyValue(name).trim();
    const update = (patch) => {
        Object.assign(state, patch);
        render();
    };

    function colours() {
        return [
            h(
                'div',
                { class: 'gallery-swatches' },
                SURFACE_TOKENS.map((name) =>
                    h(
                        'div',
                        { class: 'gallery-swatch' },
                        h('span', { class: 'gallery-swatch-chip', style: `background: var(${name})` }),
                        h('code', {}, name.replace('--pisi-', '')),
                        h('span', {}, token(name))
                    )
                )
            ),
            h(
                'div',
                { class: 'gallery-pairs' },
                PISI_TOKEN_PAIRS.map(({ foreground, background, kind }) =>
                    h(
                        'div',
                        { class: 'gallery-pair', style: `background: var(${background}); color: var(${foreground})`, dataset: { kind } },
                        h('span', { class: 'gallery-pair-sample' }, kind === 'text' ? 'Ağ' : '■'),
                        h('span', { class: 'gallery-pair-name' }, `${foreground.replace('--pisi-', '')} / ${background.replace('--pisi-', '')}`),
                        h('span', { class: 'gallery-pair-ratio' }, `${contrastRatio(token(foreground), token(background)).toFixed(1)}:1`)
                    )
                )
            )
        ];
    }

    function setDone(id, done) {
        const next = new Set(state.done);
        if (done) next.add(id);
        else next.delete(id);
        update({ done: next });
    }

    function taskRow(id, title, meta) {
        const checked = state.done.has(id);
        const toggle = () => {
            setDone(id, !checked);
            snackbar.show({ message: checked ? 'Görev yeniden açıldı' : 'Görev tamamlandı', actionLabel: 'Geri al', onUndo: () => setDone(id, checked) });
        };
        return renderListRow({ title, meta, leading: renderCheckbox({ checked, label: `Tamamla: ${title}`, dataset: { task: id }, onChange: toggle }) });
    }

    function fullTaskRow(id, title, meta) {
        const done = state.done.has(id);
        return renderTaskRow({ id, title, done, meta, checkLabel: `Tamamla: ${title}`, onToggle: () => setDone(id, !done), onOpen: () => {} });
    }

    function overlay() {
        const close = () => update({ overlay: null });
        if (state.overlay === 'date') {
            return renderDatePicker({
                id: 'gallery-date',
                title: 'Tarih seç',
                month: state.month,
                selected: state.date,
                today: '2026-11-14',
                locale: 'tr-TR',
                marks: DATE_MARKS,
                labels: DATE_LABELS,
                onClose: close,
                onMonth: (delta) => update({ month: shiftMonth(state.month, delta) }),
                onSelect: (date) => update({ date, month: date.slice(0, 7), overlay: null })
            });
        }
        if (state.overlay === 'sheet') {
            return renderSheet({
                id: 'gallery-sheet',
                title: 'Hızlı ekle',
                closeLabel: 'Kapat',
                onClose: close,
                children: stack(
                    renderTextField({
                        id: 'gallery-quick',
                        label: 'Görev',
                        placeholder: 'ör. rapor yarın 14:00',
                        hint: 'Türkçe tarih ve saat ifadelerini anlar.'
                    }),
                    renderButton({ label: 'Ekle', variant: 'primary', block: true, onClick: close })
                )
            });
        }
        if (state.overlay === 'choice') {
            return renderChoiceSheet({
                id: 'gallery-choice',
                title: 'Tema',
                options: THEMES,
                selected: state.sheetChoice,
                closeLabel: 'Kapat',
                onClose: close,
                onSelect: (value) => update({ sheetChoice: value, overlay: null })
            });
        }
        if (state.overlay === 'dialog') {
            return renderDialog({
                id: 'gallery-dialog',
                title: 'Değişiklikler atılsın mı?',
                message: 'Kaydedilmemiş değişiklikler kaybolur. Bu işlem geri alınamaz.',
                confirmLabel: 'At',
                cancelLabel: 'Vazgeç',
                danger: true,
                onConfirm: close,
                onCancel: close
            });
        }
        return null;
    }

    function render() {
        documentRoot.dataset.theme = resolveTheme(state.theme, systemTheme.prefersDark());
        const current = snackbar.getCurrent();
        root.replaceChildren(
            h(
                'div',
                { class: 'gallery', dataset: { gallery: 'root' } },
                h('h1', { class: 'gallery-title' }, 'Pisi Mobil · bileşen galerisi'),
                renderSegmented({ label: 'Tema', options: THEMES, selected: state.theme, onSelect: (theme) => update({ theme }) }),
                section('colours', 'Renkler ve kontrast', colours()),
                section(
                    'type',
                    'Yazı ölçeği',
                    TYPE_SCALE.map(([step, px]) =>
                        h('p', { class: 'gallery-type', style: `font-size: var(--pisi-text-${step})` }, `${px} · Sakin ve çalışkan bir kedi`)
                    )
                ),
                section(
                    'space',
                    'Boşluk, köşe ve gölge',
                    cluster(
                        SPACES.map((step) =>
                            h('span', {
                                class: 'gallery-space',
                                style: `width: var(--pisi-space-${step}); height: var(--pisi-space-${step})`,
                                title: `space-${step}`
                            })
                        )
                    ),
                    cluster(
                        ['sm', 'md', 'lg', 'full'].map((radius) =>
                            h('span', { class: 'gallery-radius', style: `border-radius: var(--pisi-radius-${radius})` }, radius)
                        ),
                        [1, 2].map((level) =>
                            h(
                                'span',
                                { class: 'gallery-radius', style: `box-shadow: var(--pisi-shadow-${level}); border-color: transparent` },
                                `gölge ${level}`
                            )
                        )
                    )
                ),
                section(
                    'icons',
                    'İkonlar (Lucide)',
                    h(
                        'div',
                        { class: 'gallery-icons' },
                        PISI_ICON_NAMES.map((name) => h('span', { class: 'gallery-icon' }, icon(name), h('code', {}, name)))
                    )
                ),
                section(
                    'buttons',
                    'Düğmeler',
                    cluster(
                        renderButton({ label: 'Kaydet', variant: 'primary' }),
                        renderButton({ label: 'Vazgeç' }),
                        renderButton({ label: 'Tümü', variant: 'text' }),
                        renderButton({ label: 'Sil', variant: 'danger' })
                    ),
                    cluster(
                        renderButton({ label: 'Yeni not', variant: 'primary', icon: 'plus' }),
                        renderButton({ label: 'Ara', icon: 'search' }),
                        renderButton({ label: 'Pasif', variant: 'primary', disabled: true })
                    ),
                    renderButton({ label: 'Tam genişlik', variant: 'primary', block: true }),
                    cluster(
                        renderIconButton({ icon: 'back', label: 'Geri' }),
                        renderIconButton({ icon: 'search', label: 'Ara' }),
                        renderIconButton({ icon: 'settings', label: 'Ayarları aç' }),
                        renderIconButton({ icon: 'close', label: 'Kapat' }),
                        renderFab({ label: 'Hızlı ekle' }),
                        renderFab({ label: 'Yeni görev', extended: true })
                    )
                ),
                section(
                    'chips',
                    'Çip ve segment',
                    renderChipRow({
                        label: 'Görev görünümü',
                        chips: FILTERS.map(([id, label, count]) =>
                            renderChip({ label, count, selected: state.filter === id, dataset: { filter: id }, onClick: () => update({ filter: id }) })
                        )
                    }),
                    renderSegmented({
                        label: 'Görünüm',
                        options: [
                            { value: 'today', label: 'Gün' },
                            { value: 'week', label: 'Hafta' },
                            { value: 'month', label: 'Ay' }
                        ],
                        selected: 'week',
                        onSelect: () => {}
                    })
                ),
                section(
                    'lists',
                    'Liste satırı, kart, boş durum',
                    renderList({
                        label: 'Görevler',
                        rows: [
                            taskRow('a', 'TÜBİTAK raporunun yöntem bölümünü gözden geçir ve danışmana gönder', '14:00 · Öncelik 2'),
                            taskRow('b', 'Kedi maması al', 'Bugün'),
                            renderListRow({ title: 'Tema', value: 'Sistem', chevron: true, onClick: () => update({ overlay: 'choice' }) }),
                            renderListRow({ title: 'Sürüm', value: '0.1.0' })
                        ]
                    }),
                    renderCard({ title: 'Toplantı notları', children: h('p', {}, 'Gündem · Mobil plan · Sonraki adımlar') }),
                    frame(
                        renderEmptyState({
                            icon: 'inbox',
                            title: 'Bugün için görev yok',
                            note: 'Yeni bir görev eklemek için aşağıdaki düğmeyi kullan.',
                            action: renderButton({ label: 'Görev ekle', variant: 'primary', icon: 'plus' })
                        })
                    )
                ),
                section(
                    'tasks',
                    'Görev satırı',
                    h(
                        'ul',
                        { class: 'pisi-task-list' },
                        [
                            fullTaskRow('row-1', 'TÜBİTAK raporunun yöntem bölümünü gözden geçir ve danışmana gönder', [
                                { kind: 'time', text: '10:00' },
                                { kind: 'priority', level: 5, text: PRIORITIES[4] },
                                { kind: 'source', text: 'Rapor planı' }
                            ]),
                            fullTaskRow('row-2', 'Kira ödemesi', [
                                { kind: 'date', text: '12 Kas' },
                                { kind: 'priority', level: 4, text: PRIORITIES[3] },
                                { kind: 'repeat', text: 'Her ay' }
                            ]),
                            fullTaskRow('row-3', 'Kedi maması al', [{ kind: 'priority', level: 2, text: PRIORITIES[1] }])
                        ].map((row) => h('li', { class: 'pisi-task-item' }, row))
                    ),
                    taskAddSample(),
                    cluster(
                        PRIORITIES.map((text, index) =>
                            h(
                                'span',
                                { class: 'pisi-task-meta-item pisi-task-meta-priority', dataset: { priority: String(index + 1) } },
                                h('span', { class: 'pisi-task-priority-mark', 'aria-hidden': 'true' }),
                                text
                            )
                        )
                    )
                ),
                section(
                    'fields',
                    'Metin alanı, arama ve onay kutusu',
                    renderSearchField({
                        id: 'gallery-search',
                        label: 'Notlarda ara',
                        placeholder: 'Notlarda ara',
                        value: 'ışık',
                        clearLabel: 'Aramayı temizle',
                        onInput: () => {}
                    }),
                    renderTextField({ id: 'gallery-title', label: 'Başlık', value: 'Haftalık plan' }),
                    renderTextField({ id: 'gallery-date', label: 'Tarih', placeholder: 'ör. yarın 14:00', hint: 'Türkçe tarih ve saat ifadelerini anlar.' }),
                    renderTextField({ id: 'gallery-error', label: 'Not adı', value: 'a/b', error: 'Ad “/” içeremez.' }),
                    renderTextField({ id: 'gallery-body', label: 'Açıklama', multiline: true, value: 'İlk satır\nİkinci satır' }),
                    cluster(
                        renderCheckbox({
                            checked: state.agreed,
                            text: 'Tamamlananları göster',
                            dataset: { check: 'agreed' },
                            onChange: (agreed) => update({ agreed })
                        }),
                        renderCheckbox({ checked: false, label: 'İşaretsiz', onChange: () => {} }),
                        renderCheckbox({ checked: true, label: 'Pasif', disabled: true, onChange: () => {} })
                    )
                ),
                section(
                    'overlays',
                    'Sheet, diyalog, snackbar',
                    cluster(
                        renderButton({ label: 'Sheet aç', dataset: { open: 'sheet' }, onClick: () => update({ overlay: 'sheet' }) }),
                        renderButton({ label: 'Seçim sheet’i', dataset: { open: 'choice' }, onClick: () => update({ overlay: 'choice' }) }),
                        renderButton({ label: 'Diyalog aç', dataset: { open: 'dialog' }, onClick: () => update({ overlay: 'dialog' }) }),
                        renderButton({ label: 'Tarih seç', icon: 'calendar', dataset: { open: 'date' }, onClick: () => update({ overlay: 'date' }) }),
                        renderButton({
                            label: 'Snackbar göster',
                            dataset: { open: 'snackbar' },
                            onClick: () => snackbar.show({ message: 'Görev tamamlandı', actionLabel: 'Geri al', onUndo: () => {} })
                        })
                    ),
                    frame(renderSnackbar({ message: 'Not kaydedildi' }))
                ),
                section(
                    'chrome',
                    'Üst başlık ve alt menü',
                    frame(renderHeader({ title: 'Pisi', trailing: renderIconButton({ icon: 'settings', label: 'Ayarları aç' }) })),
                    frame(renderHeader({ title: 'Ayarlar', leading: renderIconButton({ icon: 'back', label: 'Geri' }) })),
                    frame(renderBottomNav({ label: 'Ana menü', items: TABS, active: state.tab, onSelect: (tab) => update({ tab }) }))
                ),
                current ? h('div', { class: 'gallery-floating' }, renderSnackbar(current)) : null,
                overlay()
            )
        );
    }

    systemTheme.subscribe(render);
    view.addEventListener('keydown', (event) => event.key === 'Escape' && state.overlay && update({ overlay: null }));
    render();
}
