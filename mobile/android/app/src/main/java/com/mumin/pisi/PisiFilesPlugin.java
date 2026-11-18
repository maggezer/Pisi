package com.mumin.pisi;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.MimeTypeMap;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;

/**
 * Opens a note's file attachment in the phone's default app (docs/sync-plan.md S6 step 4,
 * mobile/src/platform/file-opener.mjs). The file is copied under its own name to the cache
 * (`cache/pisi-open/`) and shared through the app's FileProvider with read permission only.
 * Rejections: NOT_FOUND, BLOCKED (an executable kind), NO_APP, OPEN_FAILED.
 */
@CapacitorPlugin(name = "PisiFiles")
public class PisiFilesPlugin extends Plugin {

    @PluginMethod
    public void openFile(PluginCall call) {
        String name = call.getString("name", "");
        try {
            File source = OpenFile.resolveInside(getContext().getFilesDir(), call.getString("path"));
            if (source == null) {
                call.reject("Dosya yok.", "NOT_FOUND");
                return;
            }
            String safe = OpenFile.safeName(name, source.getName());
            if (OpenFile.isExecutable(safe) || OpenFile.isExecutable(source.getName())) {
                call.reject("Bu tür dosya açılmaz.", "BLOCKED");
                return;
            }
            File copy = OpenFile.copyForViewing(source, new File(getContext().getCacheDir(), "pisi-open"), safe);
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(OpenFile.extension(safe));
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", copy);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, mime == null ? "application/octet-stream" : mime);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getActivity().startActivity(intent);
                call.resolve();
            } catch (ActivityNotFoundException error) {
                call.reject("Açacak uygulama yok.", "NO_APP");
            }
        } catch (IOException | IllegalArgumentException error) {
            call.reject("Dosya açılamadı.", "OPEN_FAILED");
        }
    }
}
