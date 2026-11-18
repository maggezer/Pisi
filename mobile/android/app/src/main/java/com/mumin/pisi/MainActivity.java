package com.mumin.pisi;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The repo's own plugins (Pisi Sync secrets in the Android Keystore, opening attachments) are registered before the bridge starts.
        registerPlugin(PisiSecretsPlugin.class);
        registerPlugin(PisiFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
