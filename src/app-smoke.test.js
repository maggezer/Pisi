// @vitest-environment happy-dom

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

describe('Pisi responsive application shell', () => {
  it('boots, navigates and opens a seeded note', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await import('./main.js');

    await vi.waitFor(() => {
      expect(document.querySelector('.app-shell')).toBeTruthy();
    });
    expect(document.body.textContent).toContain('Pisi');
    expect(document.body.textContent).toContain('Pisi’ye hoş geldin');
    expect(document.querySelector('.tablet-rail')).toBeTruthy();

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
  });
});
