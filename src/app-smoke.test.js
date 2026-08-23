// @vitest-environment happy-dom

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

describe('Pisi responsive application shell', () => {
  it('exercises critical phone flows without dropping editor focus', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await import('./main.js');

    await vi.waitFor(() => {
      expect(document.querySelector('.app-shell')).toBeTruthy();
    });
    expect(document.body.textContent).toContain('Pisi');
    expect(document.body.textContent).toContain('Pisi’ye hoş geldin');
    expect(document.querySelector('.tablet-rail')).toBeTruthy();
    expect(document.querySelectorAll('.bottom-nav .nav-button')).toHaveLength(5);

    document.querySelector('[data-route="maps"]').click();
    expect(document.body.textContent).toContain('Fikir haritaları');

    document.querySelector('[data-route="tasks"]').click();
    expect(document.body.textContent).toContain('Hızlı yakala ve planla');

    document.querySelector('[data-route="data"]').click();
    expect(document.body.textContent).toContain('Node sistemi');

    document.querySelector('[data-route="notes"]').click();
    document.querySelector('[data-open]').click();
    await vi.waitFor(() => expect(document.querySelector('.detail-shell')).toBeTruthy());
    expect(document.querySelector('#note-title').value).toBe('Pisi’ye hoş geldin');
    expect(document.querySelector('[data-todo-button]')).toBeTruthy();

    const title = document.querySelector('#note-title');
    title.focus();
    title.value = 'Mobil klavye regresyon notu';
    title.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(document.activeElement).toBe(title);

    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const editor = document.querySelector('#rich-editor');
    expect(document.activeElement).toBe(editor);
    editor.innerHTML = '<p>Samsung klavyesi açıkken yazı odağı korunur.</p>';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(document.activeElement).toBe(editor);

    document.querySelector('#detail-back').click();
    await vi.waitFor(() => expect(document.querySelector('.app-shell')).toBeTruthy());
    expect(document.body.textContent).toContain('Mobil klavye regresyon notu');

    document.querySelector('.bottom-nav [data-route="tasks"]').click();
    const capture = document.querySelector('#task-capture-form');
    capture.elements.text.value = 'Mobil akışı denetle';
    capture.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.body.textContent).toContain('Mobil akışı denetle'));

    document.querySelector('[data-platform-quick-task]').click();
    await vi.waitFor(() => expect(document.querySelector('#quick-task-form')).toBeTruthy());
    const quickTaskInput = document.querySelector('#quick-task-form').elements.text;
    await vi.waitFor(() => expect(document.activeElement).toBe(quickTaskInput));
    quickTaskInput.value = 'Klavye görünümünü doğrula';
    quickTaskInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    document.querySelector('#quick-task-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.body.textContent).toContain('Klavye görünümünü doğrula'));

    document.querySelector('[data-platform-search]').click();
    const search = document.querySelector('#global-search-input');
    await vi.waitFor(() => expect(document.activeElement).toBe(search));
    search.value = 'Mobil klavye regresyon';
    search.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await vi.waitFor(() => expect(document.querySelector('[data-search-result]')).toBeTruthy());
    document.querySelector('[data-search-result]').click();
    await vi.waitFor(() => expect(document.querySelector('#note-title')?.value).toBe('Mobil klavye regresyon notu'));

    document.querySelector('#detail-back').click();
    await vi.waitFor(() => expect(document.querySelector('.bottom-nav')).toBeTruthy());
    document.querySelector('.bottom-nav [data-route="maps"]').click();
    document.querySelector('#new-map').click();
    await vi.waitFor(() => expect(document.querySelector('#map-viewport')).toBeTruthy());
    document.querySelector('#map-add-node').click();
    const nodeTitle = document.querySelector('#node-sheet-title');
    nodeTitle.focus();
    nodeTitle.value = 'Dokunmatik düğüm';
    nodeTitle.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(document.activeElement).toBe(nodeTitle);
    nodeTitle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(document.querySelector('#node-sheet-content'));
    document.querySelector('#close-node-sheet').click();
    expect(document.querySelector('#node-sheet-overlay')).toBeFalsy();

    document.querySelector('#map-back').click();
    await vi.waitFor(() => expect(document.querySelector('#new-map')).toBeTruthy());
    document.querySelector('.bottom-nav [data-route="calendar"]').click();
    document.querySelector('.calendar-day.today, .calendar-day:not(.blank)').click();
    await vi.waitFor(() => expect(document.querySelector('#rich-editor')).toBeTruthy());
    document.querySelector('#detail-back').click();
    await vi.waitFor(() => expect(document.querySelector('.calendar-card')).toBeTruthy());

    document.querySelector('.bottom-nav [data-route="settings"]').click();
    expect(Array.from(document.querySelectorAll('#calendar-setting option'), ({ value }) => value)).toEqual(['gregorian', 'hijri', 'lunar']);
    document.querySelector('[data-theme-option="light"]').click();
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    document.querySelector('.setting-action[data-route="data"]').click();
    document.querySelector('[data-data-tab="portability"]').click();
    document.querySelector('[data-integrity-check]').click();
    await vi.waitFor(() => expect(document.querySelector('#integrity-result').textContent).toContain('Sorun bulunmadı'));
  }, 10000);
});
