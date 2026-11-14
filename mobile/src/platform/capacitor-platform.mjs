// The only place that talks to Capacitor. On Android it wires the hardware
// back button, the pause/resume events and the system bars; in a browser
// (vite dev, E2E) it falls back to Escape and page visibility.

import { App } from '@capacitor/app';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';

const ignore = () => {};

function listen(eventName, handler) {
    const handle = App.addListener(eventName, handler);
    return () => void handle.then((listener) => listener.remove()).catch(ignore);
}

export function createCapacitorPlatform({ target = window } = {}) {
    const isNative = Capacitor.isNativePlatform();

    return {
        isNative,

        onBackButton(handler) {
            if (isNative) return listen('backButton', () => handler());
            const onKey = (event) => {
                if (event.key === 'Escape') handler();
            };
            target.addEventListener('keydown', onKey);
            return () => target.removeEventListener('keydown', onKey);
        },

        onPause(handler) {
            if (isNative) return listen('pause', () => handler());
            const onVisibility = () => target.document.visibilityState === 'hidden' && handler();
            target.document.addEventListener('visibilitychange', onVisibility);
            return () => target.document.removeEventListener('visibilitychange', onVisibility);
        },

        onResume(handler) {
            if (isNative) return listen('resume', () => handler());
            const onVisibility = () => target.document.visibilityState === 'visible' && handler();
            target.document.addEventListener('visibilitychange', onVisibility);
            return () => target.document.removeEventListener('visibilitychange', onVisibility);
        },

        /** Sends the app to the background; Android keeps it running. */
        minimizeApp() {
            if (isNative) App.minimizeApp().catch(ignore);
        },

        /** Matches the system bar icons to the theme; paints the bar itself where Android still allows it (below 15). */
        setSystemBars({ dark, color }) {
            if (!isNative) return;
            SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(ignore);
            StatusBar.setBackgroundColor({ color }).catch(ignore);
        }
    };
}
