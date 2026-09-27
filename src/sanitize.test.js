// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { sanitizeRichHtml } from './sanitize.js';

describe('rich text typography preservation', () => {
  it('preserves desktop typography styles that mobile may not render natively', () => {
    const html = `
      <p>
        <span style="font-family: 'Comic Sans MS'; font-size: 18px; font-style: italic; font-weight: 700; color: #123456">
          Desktop biçimi
        </span>
      </p>
    `;

    const sanitized = sanitizeRichHtml(html);
    const host = document.createElement('div');
    host.innerHTML = sanitized;
    const span = host.querySelector('span');

    expect(span.style.fontFamily).toContain('Comic Sans MS');
    expect(span.style.fontSize).toBe('18px');
    expect(span.style.fontStyle).toBe('italic');
    expect(span.style.fontWeight).toBe('700');
    expect(span.style.color).toBe('#123456');
  });

  it('keeps typography context when mobile edits inside the formatted span', () => {
    const host = document.createElement('div');
    host.innerHTML = sanitizeRichHtml(
      '<p><span style="font-family: \'Comic Sans MS\'; font-size: 18px; font-weight: 700">Desktop</span></p>'
    );

    const span = host.querySelector('span');
    span.append(document.createTextNode(' + mobil'));

    const saved = sanitizeRichHtml(host.innerHTML);
    const roundTrip = document.createElement('div');
    roundTrip.innerHTML = saved;
    const savedSpan = roundTrip.querySelector('span');

    expect(savedSpan.textContent).toBe('Desktop + mobil');
    expect(savedSpan.style.fontFamily).toContain('Comic Sans MS');
    expect(savedSpan.style.fontSize).toBe('18px');
    expect(savedSpan.style.fontWeight).toBe('700');
  });

  it('still strips unsafe style payloads', () => {
    const sanitized = sanitizeRichHtml(
      '<span style="font-family: Arial; background-image: url(javascript:alert(1)); position: fixed; font-weight: 600">X</span>'
    );
    const host = document.createElement('div');
    host.innerHTML = sanitized;
    const style = host.querySelector('span').getAttribute('style');

    expect(style).toContain('font-family: Arial');
    expect(style).toContain('font-weight: 600');
    expect(style).not.toContain('background-image');
    expect(style).not.toContain('position');
    expect(style).not.toContain('url(');
  });
});
