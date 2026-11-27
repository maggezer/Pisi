package com.mumin.pisi;

import android.os.Bundle;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The repo's own plugins (Pisi Sync secrets in the Android Keystore, opening attachments) are registered before the bridge starts.
        registerPlugin(PisiSecretsPlugin.class);
        registerPlugin(PisiFilesPlugin.class);
        super.onCreate(savedInstanceState);
        hideNavigationBar();
    }

    @Override
    public void onResume() {
        super.onResume();
        hideNavigationBar();
    }

    /**
     * Android puts the navigation bar back when the window gets the focus again (after the keyboard, a dialog, the QR
     * scanner or another app), so it is hidden again each time.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideNavigationBar();
    }

    /**
     * The back, home and recents buttons (or the gesture bar) are hidden: the app uses the whole height of the screen.
     * A swipe up from the bottom edge shows them for a moment over the app, without moving its content; then they hide
     * again by themselves. The status bar stays. A hidden bar has no inset, so the --safe-area-inset-bottom the SystemBars
     * plugin gives the page is 0 and nothing is left padded for it.
     */
    private void hideNavigationBar() {
        Window window = getWindow();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.navigationBars());
    }
}
