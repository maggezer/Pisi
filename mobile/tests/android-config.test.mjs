import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PISI_THEME_BACKGROUNDS } from '../src/app/theme.mjs';

const root = path.resolve(import.meta.dirname, '..');
const res = path.join(root, 'android/app/src/main/res');
const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const xml = (file) => new window.DOMParser().parseFromString(fs.readFileSync(path.join(root, file), 'utf8'), 'application/xml');
const attr = (element, name) => element?.getAttribute(`android:${name}`) ?? null;
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

/** Width, height and the colour type of a PNG, from its header. */
function pngHeader(file) {
    const bytes = fs.readFileSync(file);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

describe('Android yapılandırması', () => {
    it('WebView klavyenin tam giriş bağlantısını alır: kaydırarak yazma, öneriler ve Türkçe harfler çalışır', () => {
        // captureInput gives the WebView a bare BaseInputConnection: committed text becomes key events, and letters the
        // virtual key map does not have (ğ, ş, ı, ö, ü, İ) are dropped; composition (swipe typing, the long-press menu) stops.
        expect(config.android?.captureInput).toBeUndefined();
    });

    it('uygulama ikonu uyarlanabilir ikondur ve zeminsizdir: başlatıcının şeklinde yalnız kedi, resmin içinde çerçeve yoktur', () => {
        const application = xml('android/app/src/main/AndroidManifest.xml').querySelector('application');
        expect(attr(application, 'icon')).toBe('@mipmap/ic_launcher');
        expect(attr(application, 'roundIcon')).toBe('@mipmap/ic_launcher_round');

        for (const name of ['ic_launcher', 'ic_launcher_round']) {
            const icon = xml(`android/app/src/main/res/mipmap-anydpi-v26/${name}.xml`).documentElement;
            expect(icon.tagName).toBe('adaptive-icon');
            // No coloured background of its own: the wallpaper shows around the cat.
            expect(attr(icon.querySelector('background'), 'drawable')).toBe('@android:color/transparent');
            // The foreground is drawn to fit the launcher's safe zone itself; an inset would only shrink the cat.
            expect(icon.querySelector('foreground > *')).toBeNull();
            expect(attr(icon.querySelector('foreground'), 'drawable')).toBe('@mipmap/ic_launcher_foreground');
            expect(attr(icon.querySelector('monochrome'), 'drawable')).toBe('@mipmap/ic_launcher_monochrome');
        }
        for (const density of DENSITIES) {
            for (const layer of ['ic_launcher_foreground', 'ic_launcher_monochrome']) {
                const header = pngHeader(path.join(res, `mipmap-${density}`, `${layer}.png`));
                // 108 dp square with an alpha channel (colour type 6): the background shows around the cat.
                expect(header.width, `${density}/${layer}`).toBe(header.height);
                expect(header.colorType, `${density}/${layer}`).toBe(6);
            }
        }
    });

    it('açılış ekranı Android 12 API ile çizilir: uygulamanın arka planında zeminsiz kedi; eski açılış resimleri yok', () => {
        const launch = [...xml('android/app/src/main/res/values/styles.xml').querySelectorAll('style')].find(
            (style) => style.getAttribute('name') === 'AppTheme.NoActionBarLaunch'
        );
        const items = Object.fromEntries([...launch.querySelectorAll('item')].map((item) => [item.getAttribute('name'), item.textContent.trim()]));
        expect(launch.getAttribute('parent')).toBe('Theme.SplashScreen');
        expect(items).toEqual({
            windowSplashScreenBackground: '@color/pisi_background',
            windowSplashScreenAnimatedIcon: '@mipmap/ic_launcher_foreground',
            postSplashScreenTheme: '@style/AppTheme.NoActionBar'
        });

        const color = (folder) =>
            [...xml(`android/app/src/main/res/${folder}/colors.xml`).querySelectorAll('color')].find((item) => item.getAttribute('name') === 'pisi_background')
                ?.textContent;
        // The same colours the app gives the system bars (app/theme.mjs), so the splash, the WebView and the page match.
        expect([color('values'), color('values-night')]).toEqual(
            [PISI_THEME_BACKGROUNDS.light, PISI_THEME_BACKGROUNDS.dark].map((value) => value.toUpperCase())
        );

        const pictures = fs.readdirSync(res, { recursive: true }).filter((file) => /(^|\/)(splash|pisi_launcher)\.png$/.test(file));
        expect(pictures).toEqual([]);
    });

    it('bildirimin rengi uygulamanın vurgu rengidir; eski turkuaz zemin rengi hiçbir yerde kalmaz', () => {
        expect(config.plugins.LocalNotifications).toEqual({ smallIcon: 'ic_stat_pisi', iconColor: '#D9801F' });
        const colours = fs
            .readdirSync(res, { recursive: true })
            .filter((file) => file.endsWith('.xml'))
            .flatMap((file) => [...xml(`android/app/src/main/res/${file}`).querySelectorAll('color')].map((item) => item.getAttribute('name')));
        expect(colours).not.toContain('ic_launcher_background');
    });
});
