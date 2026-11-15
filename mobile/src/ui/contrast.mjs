// WCAG 2.x contrast maths for the design tokens (docs/mobile-plan.md M3).
// Pure functions: the contrast test and the component gallery both use them.

/** '#rgb', '#rrggbb' or '#rrggbbaa' -> { r, g, b, a } with channels 0-255 and alpha 0-1. */
export function parseHexColor(value) {
    const hex = String(value ?? '')
        .trim()
        .replace(/^#/, '');
    if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) throw new Error(`Not a hex colour: ${value}`);
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
    const channel = (index) => Number.parseInt(full.slice(index, index + 2), 16);
    return { r: channel(0), g: channel(2), b: channel(4), a: full.length === 8 ? channel(6) / 255 : 1 };
}

/** Paints a translucent colour over an opaque one. */
export function blendOver(foreground, background) {
    const mix = (top, bottom) => top * foreground.a + bottom * (1 - foreground.a);
    return { r: mix(foreground.r, background.r), g: mix(foreground.g, background.g), b: mix(foreground.b, background.b), a: 1 };
}

export function relativeLuminance({ r, g, b }) {
    const linear = (channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Contrast ratio (1-21) of a foreground colour drawn on an opaque background. */
export function contrastRatio(foreground, background) {
    const back = parseHexColor(background);
    if (back.a !== 1) throw new Error(`Background must be opaque: ${background}`);
    const front = blendOver(parseHexColor(foreground), back);
    const [light, dark] = [relativeLuminance(front), relativeLuminance(back)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
}

/**
 * Reads the colour tokens of both themes from the text of tokens.css.
 * The plain `:root` block is the light theme; `:root[data-theme='dark']` overrides it.
 */
export function readColorTokens(css) {
    const block = (selector) => {
        const start = css.indexOf(`${selector} {`);
        if (start < 0) throw new Error(`tokens.css has no ${selector} block`);
        const body = css.slice(start, css.indexOf('}', start));
        return Object.fromEntries([...body.matchAll(/(--pisi-[\w-]+):\s*(#[0-9a-f]{3,8})\s*;/gi)].map(([, name, value]) => [name, value.toLowerCase()]));
    };
    const light = block(':root');
    return { light, dark: { ...light, ...block(":root[data-theme='dark']") } };
}
