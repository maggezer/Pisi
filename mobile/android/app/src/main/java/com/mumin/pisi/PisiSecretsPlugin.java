package com.mumin.pisi;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/**
 * The phone's store for Pisi Sync's token and project key (docs/sync-plan.md S5 step 1,
 * mobile/src/platform/secrets.mjs). Values are wrapped with an AES key that lives in the
 * Android Keystore and cannot be read out; the wrapped files stay in Directory.Data/sync/secrets/.
 * Nothing here is logged.
 */
@CapacitorPlugin(name = "PisiSecrets")
public class PisiSecretsPlugin extends Plugin {

    private static final String KEY_ALIAS = "pisi-sync-secrets";
    private SecretBox box;

    @Override
    public void load() {
        box = new SecretBox(new File(getContext().getFilesDir(), "sync/secrets"), PisiSecretsPlugin::keystoreKey);
    }

    private static synchronized SecretKey keystoreKey() throws GeneralSecurityException {
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(
                new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            );
            return generator.generateKey();
        } catch (java.io.IOException error) {
            throw new GeneralSecurityException("Anahtar deposu açılamadı.", error);
        }
    }

    @PluginMethod
    public void put(PluginCall call) {
        String name = call.getString("name");
        String value = call.getString("value");
        if (value == null) {
            call.reject("Değer yok.", "INVALID_FIELD");
            return;
        }
        try {
            box.put(name, value);
            call.resolve();
        } catch (IllegalArgumentException error) {
            call.reject("Geçersiz ad.", "INVALID_FIELD");
        } catch (Exception error) {
            call.reject("Değer yazılamadı.", "SECRETS_WRITE_FAILED");
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        try {
            JSObject result = new JSObject();
            String value = box.get(call.getString("name"));
            result.put("value", value == null ? JSObject.NULL : value);
            call.resolve(result);
        } catch (IllegalArgumentException error) {
            call.reject("Geçersiz ad.", "INVALID_FIELD");
        } catch (SecretBox.UnreadableSecretException error) {
            call.reject("Değer açılamadı.", "SECRETS_UNREADABLE");
        } catch (Exception error) {
            call.reject("Değer okunamadı.", "SECRETS_UNREADABLE");
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            box.remove(call.getString("name"));
            call.resolve();
        } catch (IllegalArgumentException error) {
            call.reject("Geçersiz ad.", "INVALID_FIELD");
        } catch (Exception error) {
            call.reject("Değer silinemedi.", "SECRETS_WRITE_FAILED");
        }
    }
}
