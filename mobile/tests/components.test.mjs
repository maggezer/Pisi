import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderButton, renderFab, renderIconButton } from '../src/ui/button.mjs';
import { renderChip, renderChipRow, renderSegmented, syncChipRowFade } from '../src/ui/chip.mjs';
import { renderCheckbox, renderTextField } from '../src/ui/field.mjs';
import { PISI_ICON_NAMES, icon } from '../src/ui/icons.mjs';
import { renderCard, renderEmptyState, renderList, renderListRow } from '../src/ui/list.mjs';
import { renderChoiceSheet, renderDialog, renderSheet } from '../src/ui/overlay.mjs';
import { createShell, renderBottomNav, renderHeader, renderShell } from '../src/ui/shell.mjs';
import { createSnackbarController, renderSnackbar } from '../src/ui/snackbar.mjs';
import { createTaskAddRow } from '../src/ui/task-add.mjs';

const name = (element) => (element.getAttribute('aria-label') || element.textContent).trim();

describe('ikonlar', () => {
    it('her ikon süs amaçlı satır içi SVG olarak çizilir', () => {
        expect(PISI_ICON_NAMES).toEqual(
            expect.arrayContaining(['pisi', 'tasks', 'notes', 'calendar', 'maps', 'settings', 'back', 'close', 'plus', 'check', 'undo'])
        );
        for (const iconName of PISI_ICON_NAMES) {
            const svg = icon(iconName);
            expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
            expect(svg.getAttribute('aria-hidden')).toBe('true');
            expect(svg.getAttribute('stroke')).toBe('currentColor');
            expect(svg.children.length).toBeGreaterThan(0);
            expect(svg.textContent).toBe('');
        }
        expect(() => icon('yok')).toThrow();
    });
});

describe('düğmeler', () => {
    it('dört tür düğme tıklamayı iletir; pasif düğme iletmez', () => {
        const onClick = vi.fn();
        for (const variant of ['primary', 'secondary', 'text', 'danger']) {
            const button = renderButton({ label: 'Kaydet', variant, onClick });
            expect(button.type).toBe('button');
            expect(button.classList.contains(`pisi-button-${variant}`)).toBe(true);
            button.click();
        }
        expect(onClick).toHaveBeenCalledTimes(4);
        expect(() => renderButton({ label: 'x', variant: 'mor' })).toThrow();

        const disabled = renderButton({ label: 'Kaydet', disabled: true, onClick });
        disabled.click();
        expect(disabled.disabled).toBe(true);
        expect(onClick).toHaveBeenCalledTimes(4);
        expect(renderButton({ label: 'Yeni', icon: 'plus' }).querySelector('svg')).not.toBe(null);
    });

    it('ikon düğmesi ve FAB erişilebilir ad olmadan oluşturulamaz', () => {
        expect(renderIconButton({ icon: 'settings', label: 'Ayarları aç' }).getAttribute('aria-label')).toBe('Ayarları aç');
        expect(() => renderIconButton({ icon: 'settings' })).toThrow();
        expect(renderFab({ label: 'Hızlı ekle' }).getAttribute('aria-label')).toBe('Hızlı ekle');
        expect(name(renderFab({ label: 'Yeni görev', extended: true }))).toBe('Yeni görev');
        expect(() => renderFab({})).toThrow();
    });
});

describe('çip ve segment', () => {
    it('çip seçili durumunu aria-pressed ile bildirir', () => {
        const onClick = vi.fn();
        const row = renderChipRow({
            label: 'Görünüm',
            chips: [renderChip({ label: 'Bugün', count: 3, selected: true, onClick }), renderChip({ label: 'Yaklaşan', onClick })]
        });
        const [today, upcoming] = row.querySelectorAll('button');
        expect(row.getAttribute('aria-label')).toBe('Görünüm');
        expect(today.getAttribute('aria-pressed')).toBe('true');
        expect(today.querySelector('.pisi-chip-count').textContent).toBe('3');
        expect(upcoming.getAttribute('aria-pressed')).toBe('false');
        expect(upcoming.querySelector('.pisi-chip-count')).toBe(null);
        upcoming.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('çip satırı: daha çip olan kenar solar, kaydırdıkça öteki kenar (G14)', () => {
        const row = renderChipRow({ label: 'Görünümler', chips: [renderChip({ label: 'Bugün', onClick: () => {} })] });
        expect(row.dataset.fade).toBe('none');
        const layout = (scrollLeft) => {
            Object.defineProperty(row, 'scrollWidth', { value: 600, configurable: true });
            Object.defineProperty(row, 'clientWidth', { value: 380, configurable: true });
            Object.defineProperty(row, 'scrollLeft', { value: scrollLeft, configurable: true });
        };
        layout(0);
        syncChipRowFade(row);
        expect(row.dataset.fade).toBe('end');
        layout(100);
        row.dispatchEvent(new Event('scroll'));
        expect(row.dataset.fade).toBe('both');
        layout(220);
        row.dispatchEvent(new Event('scroll'));
        expect(row.dataset.fade).toBe('start');
        Object.defineProperty(row, 'scrollWidth', { value: 380, configurable: true });
        syncChipRowFade(row);
        expect(row.dataset.fade).toBe('none');
    });

    it('segment tek seçimlidir; seçili olana yeniden dokunmak bir şey yapmaz', () => {
        const onSelect = vi.fn();
        const options = [
            { value: 'day', label: 'Gün' },
            { value: 'week', label: 'Hafta' }
        ];
        const segmented = renderSegmented({ label: 'Görünüm', options, selected: 'day', onSelect });
        expect(segmented.getAttribute('role')).toBe('radiogroup');
        const [day, week] = segmented.querySelectorAll('[role="radio"]');
        expect([day.getAttribute('aria-checked'), week.getAttribute('aria-checked')]).toEqual(['true', 'false']);
        day.click();
        week.click();
        expect(onSelect.mock.calls).toEqual([['week']]);
    });
});

describe('liste satırı, kart, boş durum', () => {
    it('tıklanabilir satır tek bir düğmedir; diğeri düğme değildir', () => {
        const onClick = vi.fn();
        const action = renderListRow({ title: 'Tema', value: 'Sistem', chevron: true, dataset: { setting: 'theme' }, onClick });
        expect(action.tagName).toBe('BUTTON');
        expect(action.dataset.setting).toBe('theme');
        expect(action.querySelector('.pisi-row-value').textContent).toBe('Sistem');
        expect(action.querySelector('svg').dataset.icon).toBe('chevron-right');
        action.click();
        expect(onClick).toHaveBeenCalledTimes(1);

        const plain = renderListRow({ title: 'Rapor', meta: '14:00 · Öncelik 2', leading: renderCheckbox({ label: 'Tamamla', onChange() {} }) });
        expect(plain.tagName).toBe('DIV');
        expect(plain.querySelector('.pisi-row-meta').textContent).toBe('14:00 · Öncelik 2');
        expect(plain.querySelector('.pisi-row-leading [role="checkbox"]')).not.toBe(null);
    });

    it('liste satırları sırayla listeler', () => {
        const list = renderList({ label: 'Ayarlar', rows: [renderListRow({ title: 'Bir' }), renderListRow({ title: 'İki' })] });
        expect(list.tagName).toBe('UL');
        expect([...list.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['Bir', 'İki']);
    });

    it('kart ve boş durum içeriğini gösterir', () => {
        const onClick = vi.fn();
        const card = renderCard({ title: 'Toplantı', children: [document.createTextNode('Gündem')], onClick });
        expect(card.tagName).toBe('BUTTON');
        expect(card.querySelector('h3').textContent).toBe('Toplantı');
        card.click();
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(renderCard({ title: 'Salt' }).tagName).toBe('ARTICLE');

        const action = renderButton({ label: 'Görev ekle' });
        const empty = renderEmptyState({ icon: 'inbox', title: 'Görev yok', note: 'Yeni görev ekle.', action });
        expect(empty.querySelector('.pisi-empty-title').textContent).toBe('Görev yok');
        expect(empty.querySelector('.pisi-empty-note').textContent).toBe('Yeni görev ekle.');
        expect(empty.contains(action)).toBe(true);
        expect(renderEmptyState({ title: 'Boş' }).querySelector('svg')).toBe(null);
    });
});

describe('metin alanı ve onay kutusu', () => {
    it('etiket alana bağlıdır; ipucu ve hata aria ile duyurulur', () => {
        const onInput = vi.fn();
        const field = renderTextField({ id: 'title', label: 'Başlık', value: 'Plan', hint: 'Kısa tut.', onInput });
        const input = field.querySelector('input');
        expect(field.querySelector('label').getAttribute('for')).toBe('title');
        expect(input.value).toBe('Plan');
        expect(field.querySelector(`#${input.getAttribute('aria-describedby')}`).textContent).toBe('Kısa tut.');
        expect(input.hasAttribute('aria-invalid')).toBe(false);
        input.value = 'Yeni plan';
        input.dispatchEvent(new window.Event('input'));
        expect(onInput).toHaveBeenCalledWith('Yeni plan');

        const invalid = renderTextField({ id: 'name', label: 'Ad', hint: 'Kısa tut.', error: 'Ad boş olamaz.' });
        expect(invalid.querySelector('input').getAttribute('aria-invalid')).toBe('true');
        expect(invalid.querySelector('#name-note').textContent).toBe('Ad boş olamaz.');

        const area = renderTextField({ id: 'body', label: 'Açıklama', multiline: true, value: 'a\nb' });
        expect(area.querySelector('textarea').value).toBe('a\nb');
        expect(area.querySelector('textarea').hasAttribute('aria-describedby')).toBe(false);
    });

    it('onay kutusu yeni durumu bildirir ve adsız oluşturulamaz', () => {
        const onChange = vi.fn();
        const unchecked = renderCheckbox({ checked: false, label: 'Tamamla', onChange });
        expect(unchecked.getAttribute('role')).toBe('checkbox');
        expect(unchecked.getAttribute('aria-checked')).toBe('false');
        expect(unchecked.querySelector('svg')).toBe(null);
        unchecked.click();

        const checked = renderCheckbox({ checked: true, text: 'Tamamlananları göster', onChange });
        expect(checked.getAttribute('aria-checked')).toBe('true');
        expect(checked.querySelector('svg').dataset.icon).toBe('check');
        expect(checked.hasAttribute('aria-label')).toBe(false);
        expect(name(checked)).toBe('Tamamlananları göster');
        checked.click();

        expect(onChange.mock.calls).toEqual([[true], [false]]);
        expect(() => renderCheckbox({ onChange })).toThrow();
    });
});

describe('sheet ve diyalog', () => {
    it('sheet kapat düğmesiyle ve perdeye dokununca kapanır, içine dokununca kapanmaz', () => {
        const onClose = vi.fn();
        const content = document.createElement('p');
        const backdrop = renderSheet({ id: 'quick', title: 'Hızlı ekle', children: content, closeLabel: 'Kapat', onClose });
        const dialog = backdrop.querySelector('[role="dialog"]');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(backdrop.querySelector(`#${dialog.getAttribute('aria-labelledby')}`).textContent).toBe('Hızlı ekle');

        content.click();
        expect(onClose).not.toHaveBeenCalled();
        backdrop.querySelector('[aria-label="Kapat"]').click();
        backdrop.click();
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('seçim sheet’i seçili seçeneği işaretler ve seçimi iletir', () => {
        const onSelect = vi.fn();
        const options = [
            { value: 'light', label: 'Açık' },
            { value: 'dark', label: 'Koyu' }
        ];
        const sheet = renderChoiceSheet({ id: 'theme', title: 'Tema', options, selected: 'dark', closeLabel: 'Kapat', onSelect, onClose() {} });
        expect(sheet.dataset.sheet).toBe('theme');
        expect(sheet.querySelector('[role="radio"][aria-checked="true"]').dataset.value).toBe('dark');
        sheet.querySelector('[data-value="light"]').click();
        expect(onSelect).toHaveBeenCalledWith('light');
    });

    it('diyalog onay ve vazgeçi ayrı iletir; perde vazgeç sayılır', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        const backdrop = renderDialog({
            id: 'discard',
            title: 'Atılsın mı?',
            message: 'Geri alınamaz.',
            confirmLabel: 'At',
            cancelLabel: 'Vazgeç',
            danger: true,
            onConfirm,
            onCancel
        });
        const dialog = backdrop.querySelector('[role="alertdialog"]');
        expect(backdrop.querySelector(`#${dialog.getAttribute('aria-describedby')}`).textContent).toBe('Geri alınamaz.');
        expect(backdrop.querySelector('[data-action="confirm"]').classList.contains('pisi-button-danger')).toBe(true);

        backdrop.querySelector('[data-action="confirm"]').click();
        expect([onConfirm.mock.calls.length, onCancel.mock.calls.length]).toEqual([1, 0]);
        backdrop.querySelector('[data-action="cancel"]').click();
        backdrop.click();
        expect([onConfirm.mock.calls.length, onCancel.mock.calls.length]).toEqual([1, 2]);

        const plain = renderDialog({ id: 'ok', title: 'Tamam mı?', confirmLabel: 'Tamam', cancelLabel: 'Vazgeç', onConfirm, onCancel });
        expect(plain.querySelector('[data-action="confirm"]').classList.contains('pisi-button-primary')).toBe(true);
        expect(plain.querySelector('[role="alertdialog"]').hasAttribute('aria-describedby')).toBe(false);
    });
});

describe('snackbar', () => {
    afterEach(() => vi.useRealTimers());

    function controller(duration = 5000) {
        vi.useFakeTimers();
        const changes = [];
        const snackbar = createSnackbarController({
            onChange: (current) => changes.push(current?.message ?? null),
            setTimer: (run, ms) => globalThis.setTimeout(run, ms),
            clearTimer: (id) => globalThis.clearTimeout(id),
            duration
        });
        return { snackbar, changes };
    }

    it('mesajı duyurur; geri al düğmesi yalnız geri alınabilir işlemde görünür', () => {
        const onAction = vi.fn();
        const bar = renderSnackbar({ message: 'Görev tamamlandı', actionLabel: 'Geri al', onAction });
        expect(bar.getAttribute('role')).toBe('status');
        expect(bar.querySelector('.pisi-snackbar-message').textContent).toBe('Görev tamamlandı');
        bar.querySelector('[data-action="undo"]').click();
        expect(onAction).toHaveBeenCalledTimes(1);
        expect(renderSnackbar({ message: 'Kaydedildi' }).querySelector('button')).toBe(null);
    });

    it('süre dolunca kendiliğinden kapanır', () => {
        const { snackbar, changes } = controller(5000);
        snackbar.show({ message: 'Kaydedildi' });
        expect(snackbar.getCurrent().actionLabel).toBe(null);
        vi.advanceTimersByTime(4999);
        expect(snackbar.getCurrent()).not.toBe(null);
        vi.advanceTimersByTime(1);
        expect(snackbar.getCurrent()).toBe(null);
        expect(changes).toEqual(['Kaydedildi', null]);
    });

    it('geri al bir kez çalışır ve snackbar’ı kapatır', () => {
        const { snackbar } = controller();
        const onUndo = vi.fn();
        snackbar.show({ message: 'Tamamlandı', actionLabel: 'Geri al', onUndo });
        const shown = snackbar.getCurrent();
        shown.onAction();
        shown.onAction();
        expect(onUndo).toHaveBeenCalledTimes(1);
        expect(snackbar.getCurrent()).toBe(null);
        vi.advanceTimersByTime(10000);
        expect(snackbar.getCurrent()).toBe(null);
    });

    it('yeni snackbar eskisinin yerini alır ve süreyi baştan başlatır; eskisinin geri alı artık çalışmaz', () => {
        const { snackbar, changes } = controller(5000);
        const firstUndo = vi.fn();
        snackbar.show({ message: 'Bir', actionLabel: 'Geri al', onUndo: firstUndo });
        const first = snackbar.getCurrent();
        vi.advanceTimersByTime(4000);
        snackbar.show({ message: 'İki' });
        first.onAction();
        expect(firstUndo).not.toHaveBeenCalled();
        vi.advanceTimersByTime(4000);
        expect(snackbar.getCurrent().message).toBe('İki');
        vi.advanceTimersByTime(1000);
        snackbar.dismiss();
        expect(changes).toEqual(['Bir', 'İki', null]);
    });
});

describe('üst başlık ve alt menü', () => {
    const items = [
        { id: 'pisi', icon: 'pisi', label: 'Pisi' },
        { id: 'tasks', icon: 'tasks', label: 'Görevler' }
    ];

    it('alt menüde her öğenin ikonu ve görünür etiketi vardır; etkin öğe işaretlidir', () => {
        const onSelect = vi.fn();
        const nav = renderBottomNav({ label: 'Ana menü', items, active: 'tasks', onSelect });
        const tabs = [...nav.querySelectorAll('.pisi-tab')];
        expect(nav.getAttribute('aria-label')).toBe('Ana menü');
        expect(tabs.map((tab) => tab.querySelector('.pisi-tab-label').textContent)).toEqual(['Pisi', 'Görevler']);
        expect(tabs.map((tab) => tab.querySelector('svg').dataset.icon)).toEqual(['pisi', 'tasks']);
        expect(tabs.map((tab) => tab.getAttribute('aria-current'))).toEqual([null, 'page']);
        tabs[0].click();
        expect(onSelect).toHaveBeenCalledWith('pisi');
    });

    it('başlık baştaki ve sondaki denetimleri başlığın iki yanına koyar', () => {
        const back = renderIconButton({ icon: 'back', label: 'Geri' });
        const header = renderHeader({ title: 'Ayarlar', leading: back });
        expect([...header.children].map((child) => child.tagName)).toEqual(['BUTTON', 'H1']);
        expect(header.querySelector('h1').textContent).toBe('Ayarlar');
    });

    it('kabuk: FAB ve snackbar ekran gövdesinin üstünde, alt menünün dışında durur', () => {
        const t = (key) => key;
        const base = { t, title: 'Pisi', tabs: items, activeTab: 'pisi', inSubScreen: false, body: document.createElement('section') };
        expect(renderShell(base).querySelector('.pisi-floating')).toBe(null);

        const shell = renderShell({ ...base, fab: renderFab({ label: 'Hızlı ekle' }), snackbar: renderSnackbar({ message: 'Kaydedildi' }) });
        const floating = shell.querySelector('.pisi-body .pisi-floating');
        expect(floating.querySelector('.pisi-fab')).not.toBe(null);
        expect(floating.querySelector('[role="status"]')).not.toBe(null);
        expect(shell.querySelector('.pisi-tabs').contains(floating)).toBe(false);
        expect(shell.querySelector('[data-action="settings"]').getAttribute('aria-label')).toBe('action.openSettings');

        const sub = renderShell({ ...base, inSubScreen: true });
        expect(sub.querySelector('.pisi-tabs')).toBe(null);
        expect(sub.querySelector('[data-action="back"]').getAttribute('aria-label')).toBe('action.back');
    });

    it('kalıcı kabuk: aynı sheet yeniden verildiğinde yerinden oynamaz, odak içinde kalır', () => {
        const t = (key) => key;
        const shell = createShell({ t, title: 'Görevler', tabs: items, activeTab: 'tasks', inSubScreen: false, body: document.createElement('section') });
        document.body.append(shell.element);
        const input = document.createElement('input');
        const sheet = renderSheet({ id: 'task', title: 'Görev', closeLabel: 'Kapat', onClose: () => {}, children: input });
        shell.setLayer({ sheet });
        input.focus();
        shell.setLayer({ sheet, snackbar: renderSnackbar({ message: 'Kaydedildi' }) });
        shell.setLayer({ sheet });
        expect(document.activeElement).toBe(input);
        expect(shell.element.querySelector('.pisi-floating')).toBe(null);
        expect(shell.element.querySelectorAll('[data-sheet]').length).toBe(1);

        shell.setLayer({ sheet: renderSheet({ id: 'other', title: 'Başka', closeLabel: 'Kapat', onClose: () => {}, children: [] }) });
        expect([...shell.element.querySelectorAll('[data-sheet]')].map((element) => element.dataset.sheet)).toEqual(['other']);
        shell.setLayer({});
        expect(shell.element.querySelector('[data-sheet]')).toBe(null);
        shell.element.remove();
    });
});

describe('görev ekleme satırı', () => {
    it('çipler yazılanın nasıl okunduğunu gösterir; düğme olan çip tıklamayı iletir', () => {
        const t = (key) => key;
        const onPick = vi.fn();
        const onSubmit = vi.fn();
        const row = createTaskAddRow({
            t,
            id: 'quick',
            describe: (text) => [
                { kind: 'date', icon: 'calendar', text: `gün:${text}` },
                { kind: 'priority', text: 'Öncelik 3', label: 'Önceliği değiştir', onClick: onPick }
            ],
            onSubmit
        });
        const chips = row.element.querySelector('.pisi-task-add-chips');
        expect([row.input.id, row.input.getAttribute('aria-describedby'), chips.id, chips.hidden]).toEqual(['quick', 'quick-chips', 'quick-chips', true]);

        row.input.value = 'rapor';
        row.input.dispatchEvent(new Event('input'));
        expect(chips.hidden).toBe(false);
        const [date, priority] = chips.children;
        expect([date.tagName, date.dataset.chip, date.textContent]).toEqual(['SPAN', 'date', 'gün:rapor']);
        expect([priority.tagName, priority.dataset.chip, priority.getAttribute('aria-label'), priority.textContent]).toEqual([
            'BUTTON',
            'priority',
            'Önceliği değiştir',
            'Öncelik 3'
        ]);
        expect(priority.type).toBe('button');
        priority.click();
        expect(onPick).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();

        row.setReadOnly(true);
        row.element.dispatchEvent(new Event('submit', { cancelable: true }));
        expect(onSubmit).not.toHaveBeenCalled();
        row.setReadOnly(false);
        row.element.dispatchEvent(new Event('submit', { cancelable: true }));
        expect(onSubmit).toHaveBeenCalledWith('rapor');
        expect([row.input.value, chips.hidden]).toEqual(['', true]);
    });
});
