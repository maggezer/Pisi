import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PISI_THEME_BACKGROUNDS } from '../src/app/theme.mjs';
import { blendOver, contrastRatio, parseHexColor, readColorTokens, relativeLuminance } from '../src/ui/contrast.mjs';
import { PISI_TEXT_CONTRAST, PISI_TOKEN_PAIRS, PISI_UI_CONTRAST } from '../src/ui/token-pairs.mjs';

// Vitest runs from the package root (mobile/).
const css = fs.readFileSync('src/ui/tokens.css', 'utf8');
const themes = readColorTokens(css);
const sizeTokens = (prefix) => [...css.matchAll(new RegExp(`--pisi-${prefix}-[\\w]+:\\s*([\\d.]+)rem`, 'g'))].map(([, rem]) => Number(rem) * 16);

describe('kontrast hesabı', () => {
    it('WCAG oranını hesaplar', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(contrastRatio('#fff', '#ffffff')).toBe(1);
        expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
        expect(relativeLuminance(parseHexColor('#ffffff'))).toBeCloseTo(1, 5);
    });

    it('eski prototipin turuncusu açık zeminde metin olarak AA sınırının altındadır (G11)', () => {
        expect(contrastRatio('#d9801f', '#fbf7f1')).toBeLessThan(3);
    });

    it('yarı saydam rengi zemine karıştırır', () => {
        expect(blendOver(parseHexColor('#00000080'), parseHexColor('#ffffff')).r).toBeCloseTo(127, 0);
        expect(contrastRatio('#00000080', '#ffffff')).toBeCloseTo(contrastRatio('#7f7f7f', '#ffffff'), 1);
        expect(() => contrastRatio('#000000', '#ffffff80')).toThrow();
    });

    it('geçersiz rengi reddeder', () => {
        expect(() => parseHexColor('rgb(0,0,0)')).toThrow();
        expect(() => parseHexColor('#12')).toThrow();
    });

    it('token dosyasından iki temayı okur; koyu tema açık temanın üzerine yazar', () => {
        const sample = ":root {\n --pisi-a: #111111;\n --pisi-b: #FFF;\n}\n:root[data-theme='dark'] {\n --pisi-a: #eeeeee;\n}";
        expect(readColorTokens(sample)).toEqual({ light: { '--pisi-a': '#111111', '--pisi-b': '#fff' }, dark: { '--pisi-a': '#eeeeee', '--pisi-b': '#fff' } });
        expect(() => readColorTokens(':root {}')).toThrow();
    });
});

describe('tasarım token çiftleri', () => {
    for (const theme of ['light', 'dark']) {
        for (const { foreground, background, kind } of PISI_TOKEN_PAIRS) {
            const minimum = kind === 'text' ? PISI_TEXT_CONTRAST : PISI_UI_CONTRAST;
            it(`${theme}: ${foreground} / ${background} en az ${minimum}:1 (${kind})`, () => {
                expect(themes[theme][foreground], foreground).toBeDefined();
                expect(themes[theme][background], background).toBeDefined();
                expect(contrastRatio(themes[theme][foreground], themes[theme][background])).toBeGreaterThanOrEqual(minimum);
            });
        }
    }

    it('eşikler: metin 4.5, arayüz öğesi 3', () => {
        expect([PISI_TEXT_CONTRAST, PISI_UI_CONTRAST]).toEqual([4.5, 3]);
        expect(new Set(PISI_TOKEN_PAIRS.map((pair) => pair.kind))).toEqual(new Set(['text', 'ui']));
    });

    it('her renk tokenı iki temada da tanımlıdır ve en az bir çiftte sınanır', () => {
        expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
        const tested = new Set(PISI_TOKEN_PAIRS.flatMap((pair) => [pair.foreground, pair.background]));
        // --pisi-line only separates rows and carries no information of its own.
        expect(Object.keys(themes.light).filter((name) => !tested.has(name))).toEqual(['--pisi-line']);
    });

    it('sistem çubuğu yedek renkleri zemin tokenıyla aynıdır', () => {
        expect(themes.light['--pisi-bg']).toBe(PISI_THEME_BACKGROUNDS.light);
        expect(themes.dark['--pisi-bg']).toBe(PISI_THEME_BACKGROUNDS.dark);
    });

    it('yazı ölçeği 12/14/16/20/24/32, boşluklar 4 tabanlıdır, dokunma hedefi 48 dp', () => {
        expect(sizeTokens('text')).toEqual([12, 14, 16, 20, 24, 32]);
        expect(sizeTokens('space')).toEqual([4, 8, 12, 16, 24, 32, 48]);
        expect(css).toMatch(/--pisi-touch:\s*3rem;/);
        expect(css.match(/--pisi-font:/g)).toHaveLength(1);
    });
});
