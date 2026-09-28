// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installMobileViewport,
  LANDSCAPE_PISI_BREAKPOINT,
  resolvePisiLayoutMode
} from './mobile-viewport.js';

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

describe('Pisi portrait and landscape layout modes', () => {
  it('uses the Android foldable breakpoint and orientation together', () => {
    expect(LANDSCAPE_PISI_BREAKPOINT).toBe(600);
    expect(resolvePisiLayoutMode({ width: 412, height: 915 })).toBe('portrait');
    expect(resolvePisiLayoutMode({ width: 915, height: 412 })).toBe('landscape');
    expect(resolvePisiLayoutMode({ width: 600, height: 900 })).toBe('landscape');
    expect(resolvePisiLayoutMode({ width: 599, height: 900 })).toBe('portrait');
  });

  it('updates the root layout mode when the window folds, unfolds or rotates', () => {
    const visualViewport = viewport(900);
    visualViewport.width = 412;
    Object.defineProperty(window, 'innerWidth', { value: 412, writable: true, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 900, writable: true, configurable: true });
    Object.defineProperty(window, 'visualViewport', { value: visualViewport, configurable: true });

    controller = installMobileViewport();
    expect(document.documentElement.dataset.layout).toBe('portrait');

    visualViewport.width = 700;
    window.innerWidth = 700;
    visualViewport.dispatchEvent(new Event('resize'));
    expect(document.documentElement.dataset.layout).toBe('landscape');

    visualViewport.width = 568;
    visualViewport.height = 320;
    window.innerWidth = 568;
    window.innerHeight = 320;
    window.dispatchEvent(new Event('orientationchange'));
    expect(document.documentElement.dataset.layout).toBe('landscape');
  });
});

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
