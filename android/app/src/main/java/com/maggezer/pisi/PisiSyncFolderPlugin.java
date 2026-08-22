package com.maggezer.pisi;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "PisiSyncFolder")
public class PisiSyncFolderPlugin extends Plugin {
    private static final String PREFS = "pisi-sync-folder";
    private static final String URI_KEY = "tree-uri";
    private static final int MAX_FILE_BYTES = 48 * 1024 * 1024;
    private static final int MAX_LIST_FILES = 10000;

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
    }

    private Uri configuredUri() {
        String raw = preferences().getString(URI_KEY, "");
        return raw.isEmpty() ? null : Uri.parse(raw);
    }

    private DocumentFile configuredRoot() {
        Uri uri = configuredUri();
        if (uri == null) return null;
        return DocumentFile.fromTreeUri(getContext(), uri);
    }

    private String[] safeSegments(String input) throws Exception {
        String raw = String.valueOf(input == null ? "" : input)
            .replace('\\', '/')
            .replaceAll("^/+", "")
            .replaceAll("/+$", "");
        if (raw.isEmpty()) return new String[0];
        String[] segments = raw.split("/");
        if (segments.length > 24) throw new Exception("Sync yolu çok derin.");
        for (String segment : segments) {
            if (
                segment.isEmpty() ||
                segment.equals(".") ||
                segment.equals("..") ||
                !segment.matches("[A-Za-z0-9._:-]{1,180}")
            ) {
                throw new Exception("Geçersiz sync yolu.");
            }
        }
        return segments;
    }

    private DocumentFile findPath(DocumentFile root, String input) throws Exception {
        DocumentFile current = root;
        for (String segment : safeSegments(input)) {
            current = current.findFile(segment);
            if (current == null) return null;
        }
        return current;
    }

    private DocumentFile ensureParent(
        DocumentFile root,
        String[] segments
    ) throws Exception {
        DocumentFile current = root;
        for (int index = 0; index < segments.length - 1; index += 1) {
            DocumentFile next = current.findFile(segments[index]);
            if (next == null) next = current.createDirectory(segments[index]);
            if (next == null || !next.isDirectory()) {
                throw new Exception("Sync alt klasörü oluşturulamadı.");
            }
            current = next;
        }
        return current;
    }

    private void requireConfigured(PluginCall call, FolderOperation operation) {
        getBridge().execute(() -> {
            try {
                DocumentFile root = configuredRoot();
                if (root == null || !root.exists() || !root.canRead()) {
                    throw new Exception("Önce bir Pisi Sync klasörü seçin.");
                }
                operation.run(root);
            } catch (Exception error) {
                call.reject(error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void chooseFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "folderChosen");
    }

    @ActivityCallback
    private void folderChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.reject("Klasör seçimi iptal edildi.");
            return;
        }
        Uri uri = data.getData();
        if (uri == null) {
            call.reject("Klasör URI alınamadı.");
            return;
        }
        int flags = data.getFlags() & (
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        );
        try {
            getContext().getContentResolver()
                .takePersistableUriPermission(uri, flags);
            preferences().edit().putString(URI_KEY, uri.toString()).apply();
            JSObject response = new JSObject();
            response.put("configured", true);
            response.put("uri", uri.toString());
            DocumentFile root = DocumentFile.fromTreeUri(getContext(), uri);
            response.put("name", root == null ? "Pisi Sync" : root.getName());
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Klasör izni kalıcılaştırılamadı.", error);
        }
    }

    @PluginMethod
    public void getFolder(PluginCall call) {
        DocumentFile root = configuredRoot();
        JSObject response = new JSObject();
        response.put("configured", root != null && root.exists());
        response.put("uri", configuredUri() == null ? "" : configuredUri().toString());
        response.put("name", root == null ? "" : root.getName());
        call.resolve(response);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        Uri uri = configuredUri();
        if (uri != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION |
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                );
            } catch (Exception ignored) {}
        }
        preferences().edit().remove(URI_KEY).apply();
        call.resolve();
    }

    @PluginMethod
    public void readText(PluginCall call) {
        String path = call.getString("path", "");
        requireConfigured(call, (root) -> {
            DocumentFile file = findPath(root, path);
            if (file == null || !file.isFile()) {
                JSObject response = new JSObject();
                response.put("exists", false);
                response.put("content", "");
                call.resolve(response);
                return;
            }
            ContentResolver resolver = getContext().getContentResolver();
            try (InputStream input = resolver.openInputStream(file.getUri())) {
                if (input == null) throw new Exception("Sync dosyası açılamadı.");
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] bytes = new byte[8192];
                int read;
                int total = 0;
                while ((read = input.read(bytes)) >= 0) {
                    total += read;
                    if (total > MAX_FILE_BYTES) {
                        throw new Exception("Sync dosyası boyut sınırını aşıyor.");
                    }
                    buffer.write(bytes, 0, read);
                }
                JSObject response = new JSObject();
                response.put("exists", true);
                response.put(
                    "content",
                    buffer.toString(StandardCharsets.UTF_8.name())
                );
                call.resolve(response);
            }
        });
    }

    @PluginMethod
    public void writeText(PluginCall call) {
        String path = call.getString("path", "");
        String content = call.getString("content", "");
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_FILE_BYTES) {
            call.reject("Sync dosyası boyut sınırını aşıyor.");
            return;
        }
        requireConfigured(call, (root) -> {
            String[] segments = safeSegments(path);
            if (segments.length == 0) throw new Exception("Sync dosya yolu gerekli.");
            DocumentFile parent = ensureParent(root, segments);
            String name = segments[segments.length - 1];
            DocumentFile file = parent.findFile(name);
            if (file == null) file = parent.createFile("application/json", name);
            if (file == null || !file.isFile()) {
                throw new Exception("Sync dosyası oluşturulamadı.");
            }
            ContentResolver resolver = getContext().getContentResolver();
            OutputStream output;
            try {
                output = resolver.openOutputStream(file.getUri(), "wt");
            } catch (Exception unsupportedTruncateMode) {
                output = resolver.openOutputStream(file.getUri(), "w");
            }
            if (output == null) output = resolver.openOutputStream(file.getUri(), "w");
            if (output == null) throw new Exception("Sync dosyası yazılamadı.");
            try (OutputStream stream = output) {
                stream.write(bytes);
                stream.flush();
            }
            JSObject response = new JSObject();
            response.put("ok", true);
            response.put("bytes", bytes.length);
            call.resolve(response);
        });
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        String path = call.getString("path", "");
        requireConfigured(call, (root) -> {
            DocumentFile start = findPath(root, path);
            JSArray files = new JSArray();
            if (start != null && start.isDirectory()) {
                List<String> collected = new ArrayList<>();
                collectFiles(start, "", collected);
                for (String value : collected) files.put(value);
            }
            JSObject response = new JSObject();
            response.put("files", files);
            call.resolve(response);
        });
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String path = call.getString("path", "");
        requireConfigured(call, (root) -> {
            DocumentFile file = findPath(root, path);
            if (file != null && file.isFile() && !file.delete()) {
                throw new Exception("Eski sync parçası temizlenemedi.");
            }
            JSObject response = new JSObject();
            response.put("ok", true);
            call.resolve(response);
        });
    }

    private void collectFiles(
        DocumentFile directory,
        String prefix,
        List<String> output
    ) throws Exception {
        for (DocumentFile entry : directory.listFiles()) {
            if (output.size() >= MAX_LIST_FILES) {
                throw new Exception("Sync klasöründe çok fazla dosya var.");
            }
            String name = entry.getName();
            if (name == null || !name.matches("[A-Za-z0-9._:-]{1,180}")) continue;
            String relative = prefix.isEmpty() ? name : prefix + "/" + name;
            if (entry.isDirectory()) collectFiles(entry, relative, output);
            else if (entry.isFile() && name.endsWith(".json")) output.add(relative);
        }
    }

    private interface FolderOperation {
        void run(DocumentFile root) throws Exception;
    }
}
