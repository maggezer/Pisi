// Reading the desktop's pairing QR with the camera (docs/sync-plan.md S5
// step 3): Capacitor's official barcode scanner, QR codes only. It is
// offered only in the app; the browser build pairs with the code. The plugin
// is loaded on the first scan, so its web part never enters the main bundle.

import { Capacitor } from '@capacitor/core';

/**
 * Null where there is no camera scanner (a browser). Otherwise
 * `scan({ instructions }) → text`, or null when the user backed out.
 */
export function createQrScanner({ native = Capacitor.isNativePlatform() } = {}) {
    if (!native) return null;
    return {
        async scan({ instructions = '' } = {}) {
            try {
                const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner');
                const result = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE, scanInstructions: instructions });
                return typeof result?.ScanResult === 'string' && result.ScanResult ? result.ScanResult : null;
            } catch {
                // Cancelled, or the camera permission was refused.
                return null;
            }
        }
    };
}
