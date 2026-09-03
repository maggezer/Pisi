package com.maggezer.pisi;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PisiSyncFolderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
