const EDITABLE_SELECTOR = [
  'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])',
  'textarea',
  'select',
  '[contenteditable="true"]'
].join(',');

const KEYBOARD_THRESHOLD = 120;
export const LANDSCAPE_PISI_BREAKPOINT = 600;

export function resolvePisiLayoutMode({ width, height }) {
  const safeWidth = Math.max(1, Math.round(Number(width) || 1));
  const safeHeight = Math.max(1, Math.round(Number(height) || 1));
  return safeWidth >= LANDSCAPE_PISI_BREAKPOINT || safeWidth > safeHeight
    ? 'landscape'
    : 'portrait';
}

export function isEditableElement(element) {
  return Boolean(element?.matches?.(EDITABLE_SELECTOR));
}

export function installMobileViewport({
  win = window,
  doc = document,
  keyboard = null,
  isNative = false
} = {}) {
  const root = doc.documentElement;
  const visualViewport = win.visualViewport;
  const cleanup = [];
  const nativeHandles = [];
  let keyboardVisible = false;
  let keyboardHeight = 0;
  let stableHeight = Math.max(1, Math.round(visualViewport?.height || win.innerHeight || root.clientHeight || 1));
  let revealTimer;

  const editableIsFocused = () => isEditableElement(doc.activeElement);

  const setKeyboardState = (visible, height = 0) => {
    keyboardVisible = Boolean(visible);
    keyboardHeight = keyboardVisible ? Math.max(0, Math.round(Number(height) || keyboardHeight)) : 0;
    root.dataset.keyboard = keyboardVisible ? 'open' : 'closed';
    root.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
  };

  const currentWidth = () => Math.max(
    1,
    Math.round(visualViewport?.width || win.innerWidth || root.clientWidth || 1)
  );

  const updateLayoutMode = () => {
    const width = currentWidth();
    const height = Math.max(
      1,
      Math.round(visualViewport?.height || win.innerHeight || root.clientHeight || stableHeight)
    );
    const mode = resolvePisiLayoutMode({ width, height });
    root.dataset.layout = mode;
    root.style.setProperty('--window-width', `${width}px`);
    return mode;
  };

  const visibleHeight = () => {
    const layoutHeight = Math.max(1, Math.round(win.innerHeight || root.clientHeight || stableHeight));
    const visualHeight = Math.max(1, Math.round(visualViewport?.height || layoutHeight));
    let height = Math.min(layoutHeight, visualHeight);

    if (!keyboardVisible) {
      stableHeight = Math.max(height, layoutHeight);
    } else if (keyboardHeight > 0 && height >= stableHeight - 24) {
      // Some full-screen Android WebViews report an unchanged viewport. Native
      // keyboard height is a safe fallback until resizeOnFullScreen catches up.
      height = Math.max(240, stableHeight - keyboardHeight);
    }
    return height;
  };

  const revealFocusedField = () => {
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      const active = doc.activeElement;
      if (!isEditableElement(active)) return;
      active.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }, 80);
  };

  const updateViewport = () => {
    updateLayoutMode();
    if (!isNative && visualViewport) {
      const inferredHeight = Math.max(0, Math.round((win.innerHeight || stableHeight) - visualViewport.height - (visualViewport.offsetTop || 0)));
      if (inferredHeight >= KEYBOARD_THRESHOLD && editableIsFocused()) setKeyboardState(true, inferredHeight);
      else if (keyboardVisible && inferredHeight < KEYBOARD_THRESHOLD) setKeyboardState(false);
    }
    const height = visibleHeight();
    root.style.setProperty('--app-height', `${height}px`);
    if (keyboardVisible) revealFocusedField();
  };

  const listen = (target, event, handler, options) => {
    target?.addEventListener?.(event, handler, options);
    cleanup.push(() => target?.removeEventListener?.(event, handler, options));
  };

  listen(win, 'resize', updateViewport, { passive: true });
  listen(win, 'orientationchange', () => {
    stableHeight = Math.max(1, Math.round(win.innerHeight || visualViewport?.height || stableHeight));
    updateViewport();
  }, { passive: true });
  listen(visualViewport, 'resize', updateViewport, { passive: true });
  listen(visualViewport, 'scroll', updateViewport, { passive: true });
  listen(doc, 'focusin', (event) => {
    if (!isEditableElement(event.target)) return;
    root.dataset.inputActive = 'true';
    revealFocusedField();
  });
  listen(doc, 'focusout', () => {
    setTimeout(() => {
      if (!editableIsFocused()) delete root.dataset.inputActive;
    }, 0);
  });

  if (keyboard?.addListener) {
    const register = (name, handler) => {
      Promise.resolve(keyboard.addListener(name, handler)).then((handle) => {
        if (handle?.remove) nativeHandles.push(handle);
      }).catch(() => {});
    };
    register('keyboardWillShow', (info) => {
      setKeyboardState(true, info?.keyboardHeight);
      updateViewport();
      revealFocusedField();
    });
    register('keyboardDidShow', (info) => {
      setKeyboardState(true, info?.keyboardHeight);
      updateViewport();
      revealFocusedField();
    });
    register('keyboardWillHide', () => {
      setKeyboardState(false);
      updateViewport();
    });
    register('keyboardDidHide', () => {
      setKeyboardState(false);
      updateViewport();
    });
  }

  setKeyboardState(false);
  updateViewport();

  return {
    isKeyboardVisible: () => keyboardVisible,
    refresh: updateViewport,
    destroy: async () => {
      clearTimeout(revealTimer);
      cleanup.splice(0).forEach((remove) => remove());
      await Promise.allSettled(nativeHandles.splice(0).map((handle) => handle.remove()));
      delete root.dataset.inputActive;
      delete root.dataset.keyboard;
      delete root.dataset.layout;
      root.style.removeProperty('--keyboard-height');
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--window-width');
    }
  };
}
