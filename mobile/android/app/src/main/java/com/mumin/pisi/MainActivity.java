package com.mumin.pisi;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The repo's own plugin (Pisi Sync secrets in the Android Keystore) is registered before the bridge starts.
        registerPlugin(PisiSecretsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
