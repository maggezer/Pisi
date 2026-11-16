// The field being typed in stays above the keyboard (docs/mobile-plan.md M10).
// Android makes the window shorter when the keyboard opens (Keyboard.resize:
// native), and the screens scroll inside their own containers, so the field
// can end up below the visible part: the task add row at the end of the Pisi
// tab, the last block of a note. When the window changes size or a field takes
// the focus, the field's scrolling container is moved just enough to bring the
// field (in a note, the caret) back into view. A field that is already visible
// is left alone, so this does nothing where the WebView has scrolled it itself.
//
// While the keyboard is open the document carries `data-keyboard="open"`: what
// is pinned to the bottom of the screen (the menu button and the date wheel of
// the Pisi tab, the tab bar) would ride on the keyboard and cover the field, so
// the stylesheet hides it. The keyboard counts as open while a field has the
// focus and the window is clearly shorter than it has been at this width; the
// same rule holds in a browser, where the E2E tests make the window shorter.

const EDITABLE = 'input, textarea, [contenteditable="true"], [contenteditable=""]';
const MARGIN = 16;
// A keyboard takes well over a fifth of a phone's height; a toolbar or a split screen changing size does not shrink it this much at once.
const KEYBOARD_SHARE = 0.8;

/** The keyboard is open when a field is being typed in and the window is clearly shorter than the tallest it has been at this width. */
export function isKeyboardOpen({ editing, height, tallest }) {
    return Boolean(editing) && tallest > 0 && height < tallest * KEYBOARD_SHARE;
}

function scrollerOf(view, element) {
    for (let node = element.parentElement; node; node = node.parentElement) {
        const { overflowY } = view.getComputedStyle(node);
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    }
    return view.document.scrollingElement ?? null;
}

/** In a note the caret matters, not the whole block; an empty block has no caret box, so the block is used. */
function targetBox(view, element) {
    if (element.isContentEditable) {
        const selection = view.document.getSelection?.();
        if (selection?.rangeCount && element.contains(selection.anchorNode)) {
            const box = selection.getRangeAt(0).getBoundingClientRect();
            if (box.width || box.height) return box;
        }
    }
    return element.getBoundingClientRect();
}

/**
 * How far the container has to scroll for `box` to be seen inside the band `top`..`bottom`
 * (0 when it already is). A field taller than the band is only brought in when none of it shows.
 */
export function getRevealDelta(box, { top, bottom, margin = MARGIN }) {
    const room = bottom - top - 2 * margin;
    if (room <= 0) return 0;
    if (box.bottom - box.top > room) {
        if (box.bottom <= top || box.top >= bottom) return box.top - (top + margin);
        return 0;
    }
    if (box.bottom > bottom - margin) return box.bottom - (bottom - margin);
    if (box.top < top + margin) return box.top - (top + margin);
    return 0;
}

/** Starts watching `view`; returns the function that stops it. */
export function watchKeyboard(view, { margin = MARGIN } = {}) {
    const document = view.document;
    const root = document.documentElement;
    // The tallest window seen at each width: turning the phone changes the width, the keyboard only the height.
    const tallest = new Map();
    let frame = null;

    function markKeyboard(editing) {
        const width = view.innerWidth;
        const height = view.visualViewport?.height ?? view.innerHeight;
        if (!editing || !tallest.has(width)) tallest.set(width, Math.max(tallest.get(width) ?? 0, height));
        const open = isKeyboardOpen({ editing, height, tallest: tallest.get(width) });
        if (open) root.dataset.keyboard = 'open';
        else delete root.dataset.keyboard;
    }

    function reveal() {
        frame = null;
        const element = document.activeElement;
        const editing = Boolean(element?.matches?.(EDITABLE));
        markKeyboard(editing);
        if (!editing) return;
        const scroller = scrollerOf(view, element);
        if (!scroller) return;
        const viewport = view.visualViewport;
        const windowTop = viewport ? viewport.offsetTop : 0;
        const windowBottom = viewport ? viewport.offsetTop + viewport.height : view.innerHeight;
        const isPage = scroller === document.scrollingElement;
        const area = isPage ? { top: windowTop, bottom: windowBottom } : scroller.getBoundingClientRect();
        const delta = getRevealDelta(targetBox(view, element), {
            top: Math.max(windowTop, area.top),
            bottom: Math.min(windowBottom, area.bottom),
            margin
        });
        if (delta) scroller.scrollTop += delta;
    }

    function schedule() {
        if (frame !== null) return;
        frame = view.requestAnimationFrame(reveal);
    }

    markKeyboard(false);
    view.addEventListener('resize', schedule);
    view.visualViewport?.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    return () => {
        view.removeEventListener('resize', schedule);
        view.visualViewport?.removeEventListener('resize', schedule);
        document.removeEventListener('focusin', schedule);
        document.removeEventListener('focusout', schedule);
        if (frame !== null) view.cancelAnimationFrame(frame);
        frame = null;
        delete root.dataset.keyboard;
    };
}
