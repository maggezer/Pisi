import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../capacitor.config.json'), 'utf8'));

describe('Android yapılandırması', () => {
    it('WebView klavyenin tam giriş bağlantısını alır: kaydırarak yazma, öneriler ve Türkçe harfler çalışır', () => {
        // captureInput gives the WebView a bare BaseInputConnection: committed text becomes key events, and letters the
        // virtual key map does not have (ğ, ş, ı, ö, ü, İ) are dropped; composition (swipe typing, the long-press menu) stops.
        expect(config.android?.captureInput).toBeUndefined();
    });
});
