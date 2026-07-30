// @vitest-environment happy-dom

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

describe('KEDI application shell', () => {
  it('boots, navigates and opens a seeded note', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await import('./main.js');

    await vi.waitFor(() => {
      expect(document.querySelector('.app-shell')).toBeTruthy();
    });
    expect(document.body.textContent).toContain('KEDI');
    expect(document.body.textContent).toContain('KEDI’ye hoş geldin');

    document.querySelector('[data-route="maps"]').click();
    expect(document.body.textContent).toContain('Fikir haritaları');

    document.querySelector('[data-route="notes"]').click();
    document.querySelector('[data-open]').click();
    expect(document.querySelector('.detail-shell')).toBeTruthy();
    expect(document.querySelector('#note-title').value).toBe('KEDI’ye hoş geldin');
  });
});

