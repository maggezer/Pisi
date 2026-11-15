import { describe, expect, it, vi } from 'vitest';
import { PISI_DIARY_SAVE_DELAY_MS, createDiaryAutosave } from '../src/screens/pisi/diary-autosave.mjs';
import { renderDatePicker } from '../src/ui/date-picker.mjs';
import { renderTaskRow } from '../src/ui/task-row.mjs';

describe('görev satırı', () => {
    const row = (overrides = {}) =>
        renderTaskRow({
            id: 'task_a',
            title: 'TÜBİTAK raporunun yöntem bölümünü gözden geçir',
            meta: [
                { kind: 'time', text: '10:00' },
                { kind: 'priority', level: 4, text: 'Yüksek' },
                { kind: 'source', text: 'Rapor' }
            ],
            checkLabel: 'Tamamla: TÜBİTAK raporu',
            onToggle: () => {},
            onOpen: () => {},
            ...overrides
        });

    it('onay kutusu ve satır iki ayrı düğmedir; biri tamamlar, öteki açar', () => {
        const onToggle = vi.fn();
        const onOpen = vi.fn();
        const element = row({ onToggle, onOpen });
        const [check, body] = element.querySelectorAll('button');
        expect(element.querySelectorAll('button button').length).toBe(0);
        expect([check.getAttribute('role'), check.getAttribute('aria-checked'), check.getAttribute('aria-label')]).toEqual([
            'checkbox',
            'false',
            'Tamamla: TÜBİTAK raporu'
        ]);
        check.click();
        body.click();
        expect([onToggle.mock.calls, onOpen.mock.calls]).toEqual([[['task_a']], [['task_a']]]);
    });

    it('başlığın tamamı ve meta satırı yazılır; öncelik rengin yanında adıyla da verilir', () => {
        const element = row();
        expect(element.querySelector('.pisi-task-title').textContent).toBe('TÜBİTAK raporunun yöntem bölümünü gözden geçir');
        expect([...element.querySelectorAll('.pisi-task-meta-item')].map((item) => item.textContent)).toEqual(['10:00', 'Yüksek', 'Rapor']);
        const priority = element.querySelector('.pisi-task-meta-priority');
        expect(priority.dataset.priority).toBe('4');
        expect(priority.querySelector('.pisi-task-priority-mark').getAttribute('aria-hidden')).toBe('true');
        expect(row({ meta: [] }).querySelector('.pisi-task-meta')).toBe(null);
    });

    it('tamamlanan görev işaretli çizilir', () => {
        const element = row({ done: true });
        expect(element.classList.contains('pisi-task-done')).toBe(true);
        expect(element.querySelector('[role="checkbox"]').getAttribute('aria-checked')).toBe('true');
    });
});

describe('tarih seçici', () => {
    const labels = {
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
    const picker = (overrides = {}) =>
        renderDatePicker({
            id: 'date',
            title: 'Tarih seç',
            month: '2026-11',
            selected: '2026-11-12',
            today: '2026-11-14',
            locale: 'tr-TR',
            marks: { tasks: new Set(['2026-11-14']), diary: new Set(['2026-11-12', '2026-11-14']) },
            labels,
            onSelect: () => {},
            onMonth: () => {},
            onClose: () => {},
            ...overrides
        });

    it('ayın günlerini pazartesiden başlayarak dizer; bugün ve seçili gün ayrı işaretlenir', () => {
        const element = picker();
        const cells = [...element.querySelectorAll('.pisi-date-grid > .pisi-date-cell')];
        expect(cells).toHaveLength(42);
        expect(cells.slice(0, 7).map((cell) => cell.textContent)).toEqual(['', '', '', '', '', '', '1']);
        expect(element.querySelectorAll('button.pisi-date-cell').length).toBe(30);
        expect(element.querySelector('[aria-pressed="true"]').dataset.date).toBe('2026-11-12');
        expect(element.querySelector('[aria-current="date"]').dataset.date).toBe('2026-11-14');
        expect(element.querySelector('[data-autofocus]').dataset.date).toBe('2026-11-12');
    });

    it('noktaların anlamı hem erişilebilir adda hem açıklama satırında yazar', () => {
        const element = picker();
        expect(element.querySelector('[data-date="2026-11-14"]').getAttribute('aria-label')).toBe('Cumartesi, 14 Kasım, Bugün, görev var, günlük var');
        expect(element.querySelector('[data-date="2026-11-12"]').getAttribute('aria-label')).toBe('Perşembe, 12 Kasım, günlük var');
        expect(element.querySelector('[data-date="2026-11-13"]').getAttribute('aria-label')).toBe('Cuma, 13 Kasım');
        expect(element.querySelector('.pisi-date-legend').textContent).toBe('GörevGünlük');
    });

    it('gün, ay ve bugün seçimlerini iletir', () => {
        const onSelect = vi.fn();
        const onMonth = vi.fn();
        const element = picker({ onSelect, onMonth });
        element.querySelector('[data-date="2026-11-20"]').click();
        element.querySelector('[data-action="pick-today"]').click();
        element.querySelector('[data-action="previous-month"]').click();
        element.querySelector('[data-action="next-month"]').click();
        expect(onSelect.mock.calls).toEqual([['2026-11-20'], ['2026-11-14']]);
        expect(onMonth.mock.calls).toEqual([[-1], [1]]);
        expect(element.querySelector('[data-action="previous-month"]').getAttribute('aria-label')).toBe('Önceki ay');
    });
});

describe('günlük otomatik kaydı', () => {
    function setup(save = async () => ({ ok: true })) {
        const saved = [];
        const errors = [];
        const calls = [];
        const autosave = createDiaryAutosave({
            save: (date, text) => {
                calls.push([date, text]);
                return save(date, text);
            },
            setTimer: (callback, delay) => setTimeout(callback, delay),
            clearTimer: (timer) => clearTimeout(timer),
            onSaved: (job) => saved.push(job),
            onError: (error, job) => errors.push([error.message, job.date])
        });
        return { autosave, saved, errors, calls };
    }

    it('yazma durunca bir kez kaydeder', async () => {
        vi.useFakeTimers();
        const { autosave, calls } = setup();
        autosave.edit('2026-11-14', 'a');
        await vi.advanceTimersByTimeAsync(PISI_DIARY_SAVE_DELAY_MS - 1);
        autosave.edit('2026-11-14', 'ab');
        await vi.advanceTimersByTimeAsync(PISI_DIARY_SAVE_DELAY_MS - 1);
        expect([calls, autosave.getPending('2026-11-14')]).toEqual([[], 'ab']);
        await vi.advanceTimersByTimeAsync(1);
        expect([calls, autosave.getPending('2026-11-14')]).toEqual([[['2026-11-14', 'ab']], null]);
        vi.useRealTimers();
    });

    it('flush beklemeden yazar; başka güne geçilince önceki günün metni önce yazılır', async () => {
        vi.useFakeTimers();
        const { autosave, calls, saved } = setup();
        autosave.edit('2026-11-14', 'bugün');
        autosave.edit('2026-11-15', 'yarın');
        await autosave.flush();
        expect(calls).toEqual([
            ['2026-11-14', 'bugün'],
            ['2026-11-15', 'yarın']
        ]);
        expect(saved.map((job) => job.date)).toEqual(['2026-11-14', '2026-11-15']);
        await vi.advanceTimersByTimeAsync(PISI_DIARY_SAVE_DELAY_MS * 2);
        expect(calls).toHaveLength(2);
        vi.useRealTimers();
    });

    it('bir kayıt başarısız olsa da sonraki kayıtlar sürer', async () => {
        let fail = true;
        const { autosave, errors, saved } = setup(async () => {
            if (fail) throw new Error('disk dolu');
            return { ok: true };
        });
        autosave.edit('2026-11-14', 'a');
        await autosave.flush();
        fail = false;
        autosave.edit('2026-11-14', 'ab');
        await autosave.flush();
        expect([errors, saved.map((job) => job.text)]).toEqual([[['disk dolu', '2026-11-14']], ['ab']]);
    });
});
