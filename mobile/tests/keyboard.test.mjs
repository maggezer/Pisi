import { afterEach, describe, expect, it } from 'vitest';
import { getRevealDelta, isKeyboardOpen, watchKeyboard } from '../src/ui/keyboard.mjs';

const band = { top: 100, bottom: 500, margin: 16 };
const box = (top, bottom) => ({ top, bottom });

describe('klavye: yazılan alan görünür kalır (M10)', () => {
    let stop = null;
    afterEach(() => {
        stop?.();
        stop = null;
        document.body.replaceChildren();
    });

    it('görünen alan yerinde kalır; alttaki yukarı, üstteki aşağı kaydırılır', () => {
        expect(getRevealDelta(box(200, 250), band)).toBe(0);
        expect(getRevealDelta(box(600, 650), band)).toBe(650 - 484);
        expect(getRevealDelta(box(40, 90), band)).toBe(40 - 116);
    });

    it('banttan uzun alan yalnız hiç görünmüyorsa getirilir; yer yoksa bir şey yapılmaz', () => {
        expect(getRevealDelta(box(150, 900), band)).toBe(0);
        expect(getRevealDelta(box(700, 1400), band)).toBe(700 - 116);
        expect(getRevealDelta(box(600, 650), { top: 100, bottom: 120, margin: 16 })).toBe(0);
    });

    it('klavye, bir alan yazılırken pencere belirgin biçimde kısalınca açık sayılır', () => {
        expect(isKeyboardOpen({ editing: true, height: 480, tallest: 839 })).toBe(true);
        expect(isKeyboardOpen({ editing: true, height: 800, tallest: 839 })).toBe(false);
        expect(isKeyboardOpen({ editing: false, height: 480, tallest: 839 })).toBe(false);
        expect(isKeyboardOpen({ editing: true, height: 480, tallest: 0 })).toBe(false);
    });

    it('pencere kısalınca belge "klavye açık" işaretini alır, alan kaydırılır; kapanınca işaret kalkar', async () => {
        const view = window;
        const frame = () => new Promise((resolve) => view.requestAnimationFrame(() => resolve()));
        const scroller = document.createElement('div');
        scroller.style.overflowY = 'auto';
        const input = document.createElement('input');
        scroller.append(input);
        document.body.append(scroller);
        // happy-dom does no layout: the scroller and the field are given their boxes.
        Object.defineProperties(scroller, { scrollHeight: { value: 2000 }, clientHeight: { value: 400 } });
        scroller.getBoundingClientRect = () => ({ top: 0, bottom: view.innerHeight });
        input.getBoundingClientRect = () => ({ top: 700 - scroller.scrollTop, bottom: 748 - scroller.scrollTop });

        view.happyDOM.setViewport({ width: 412, height: 839 });
        stop = watchKeyboard(view);
        input.focus();
        await frame();
        expect(document.documentElement.dataset.keyboard).toBeUndefined();
        expect(scroller.scrollTop).toBe(0);

        view.happyDOM.setViewport({ width: 412, height: 480 });
        view.dispatchEvent(new Event('resize'));
        await frame();
        expect(document.documentElement.dataset.keyboard).toBe('open');
        expect(scroller.scrollTop).toBe(748 - (480 - 16));

        view.happyDOM.setViewport({ width: 412, height: 839 });
        view.dispatchEvent(new Event('resize'));
        await frame();
        expect(document.documentElement.dataset.keyboard).toBeUndefined();

        stop();
        stop = null;
        expect(document.documentElement.dataset.keyboard).toBeUndefined();
    });
});
