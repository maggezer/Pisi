// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMobileViewport } from './mobile-viewport.js';

let controller;

afterEach(async () => {
  await controller?.destroy();
  controller = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function viewport(height) {
  const target = new EventTarget();
  target.height = height;
  target.offsetTop = 0;
  return target;
}

describe('mobile viewport and soft keyboard lifecycle', () => {
  it('uses native keyboard height when a full-screen WebView does not resize', async () => {
    const callbacks = {};
    const visualViewport = viewport(800);
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true, configurable: true });
    Object.defineProperty(window, 'visualViewport', { value: visualViewport, configurable: true });
    const keyboard = {
      addListener: vi.fn(async (name, callback) => {
        callbacks[name] = callback;
        return { remove: vi.fn(async () => {}) };
      })
    };

    document.body.innerHTML = '<input id="field">';
    document.querySelector('#field').focus();
    controller = installMobileViewport({ keyboard, isNative: true });
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('800px');

    callbacks.keyboardWillShow({ keyboardHeight: 300 });
    expect(controller.isKeyboardVisible()).toBe(true);
    expect(document.documentElement.dataset.keyboard).toBe('open');
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('500px');
    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('300px');

    visualViewport.height = 500;
    visualViewport.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('500px');

    visualViewport.height = 800;
    callbacks.keyboardDidHide();
    expect(controller.isKeyboardVisible()).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('800px');
  });

  it('infers an on-screen keyboard from the visual viewport on the web', async () => {
    const visualViewport = viewport(760);
    Object.defineProperty(window, 'innerHeight', { value: 760, writable: true, configurable: true });
    Object.defineProperty(window, 'visualViewport', { value: visualViewport, configurable: true });
    document.body.innerHTML = '<textarea id="field"></textarea>';
    const field = document.querySelector('#field');
    field.focus();
    controller = installMobileViewport();

    visualViewport.height = 430;
    visualViewport.dispatchEvent(new Event('resize'));
    expect(controller.isKeyboardVisible()).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('430px');

    visualViewport.height = 760;
    visualViewport.dispatchEvent(new Event('resize'));
    expect(controller.isKeyboardVisible()).toBe(false);
    expect(document.documentElement.dataset.keyboard).toBe('closed');
    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe('760px');
  });
});
