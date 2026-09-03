package com.maggezer.pisi;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.util.Log;
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
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import org.json.JSONObject;

@CapacitorPlugin(name = "PisiSyncFolder")
public class PisiSyncFolderPlugin extends Plugin {
    private static final String TAG = "PisiStorage";
    private static final String PREFS = "pisi-sync-folder";
    private static final String URI_KEY = "tree-uri";
    private static final String TRANSACTION_KEY = "pending-write-transaction";
    private static final String LAST_WRITE_KEY = "last-local-write";
    private static final String LAST_WRITE_PATH_KEY = "last-local-write-path";
    private static final String LAST_WRITE_BYTES_KEY = "last-local-write-bytes";
    private static final String DRIVESYNC_PACKAGE = "com.ttxapps.drivesync";
    private static final int MAX_FILE_BYTES = 48 * 1024 * 1024;
    private static final int MAX_LIST_FILES = 10000;

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
    }

    private String isoNow() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    private Uri configuredUri() {
        String raw = preferences().getString(URI_KEY, "");
        return raw.isEmpty() ? null : Uri.parse(raw);
    }

    private DocumentFile configuredRoot() {
        Uri uri = configuredUri();
        return uri == null ? null : DocumentFile.fromTreeUri(getContext(), uri);
    }

    private UriPermission persistedPermission(Uri uri) {
        if (uri == null) return null;
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (uri.equals(permission.getUri())) return permission;
        }
        return null;
    }

    private boolean hasPersistedReadWritePermission(Uri uri) {
        UriPermission permission = persistedPermission(uri);
        return permission != null && permission.isReadPermission() && permission.isWritePermission();
    }

    private void putFolderStatus(JSObject response, Uri uri, DocumentFile root) {
        boolean exists = root != null && root.exists();
        boolean readable = exists && root.canRead();
        boolean writable = exists && root.canWrite();
        boolean persisted = hasPersistedReadWritePermission(uri);
        response.put("configured", persisted && readable && writable);
        response.put("uri", uri == null ? "" : uri.toString());
        response.put("name", root == null ? "" : root.getName());
        response.put("readable", readable);
        response.put("writable", writable);
        response.put("permissionPersisted", persisted);
        response.put("provider", uri == null || uri.getAuthority() == null ? "" : uri.getAuthority());
        response.put("storageBackend", "SAF");
        response.put("driveSyncInstalled",
            getContext().getPackageManager().getLaunchIntentForPackage(DRIVESYNC_PACKAGE) != null);
        response.put("lastLocalWrite", preferences().getString(LAST_WRITE_KEY, ""));
        response.put("lastLocalWritePath", preferences().getString(LAST_WRITE_PATH_KEY, ""));
        response.put("lastLocalWriteBytes", preferences().getLong(LAST_WRITE_BYTES_KEY, 0));
    }

    private String[] safeSegments(String input) throws Exception {
        String raw = String.valueOf(input == null ? "" : input)
            .replace('\\', '/')
            .replaceAll("^/+", "")
            .replaceAll("/+$", "");
        if (raw.isEmpty()) return new String[0];
        String[] segments = raw.split("/");
        if (segments.length > 24) throw new Exception("Proje yolu çok derin.");
        for (String segment : segments) {
            boolean invalid = segment.isEmpty() || segment.equals(".") ||
                segment.equals("..") || segment.length() > 180;
            for (int index = 0; !invalid && index < segment.length(); index++) {
                invalid = Character.isISOControl(segment.charAt(index));
            }
            if (invalid) throw new Exception("Geçersiz proje dosyası yolu.");
        }
        return segments;
    }

    private void validateWritableSegments(String[] segments) throws Exception {
        for (String segment : segments) {
            if (!Normalizer.isNormalized(segment, Normalizer.Form.NFC)) {
                throw new Exception("Dosya adı Unicode NFC biçiminde olmalı.");
            }
            if (segment.matches(".*[<>:\"|?*].*") || segment.endsWith(".") || segment.endsWith(" ")) {
                throw new Exception("Dosya adı Windows ile uyumlu değil: " + segment);
            }
            String stem = segment.split("\\.", 2)[0].toUpperCase(Locale.ROOT);
            if (stem.matches("CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]")) {
                throw new Exception("Windows için ayrılmış dosya adı kullanılamaz: " + segment);
            }
        }
    }

    private DocumentFile findPath(DocumentFile root, String input) throws Exception {
        DocumentFile current = root;
        for (String segment : safeSegments(input)) {
            current = current.findFile(segment);
            if (current == null) return null;
        }
        return current;
    }

    private DocumentFile ensureParent(DocumentFile root, String[] segments) throws Exception {
        DocumentFile current = root;
        for (int index = 0; index < segments.length - 1; index += 1) {
            DocumentFile next = current.findFile(segments[index]);
            if (next == null) next = current.createDirectory(segments[index]);
            if (next == null || !next.isDirectory()) {
                throw new Exception("Proje alt klasörü oluşturulamadı.");
            }
            current = next;
        }
        return current;
    }

    private String parentPath(String path) {
        int split = path.lastIndexOf('/');
        return split < 0 ? "" : path.substring(0, split);
    }

    private DocumentFile createExactFile(DocumentFile parent, String mimeType, String name) throws Exception {
        DocumentFile file = parent.createFile(mimeType, name);
        if (file == null) throw new Exception("Proje dosyası oluşturulamadı.");
        if (!name.equals(file.getName())) {
            try { file.delete(); } catch (Exception ignored) {}
            throw new Exception("Android belge sağlayıcısı dosya adını değiştirdi: " + name);
        }
        return file;
    }

    private byte[] readBytes(DocumentFile file) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream input = resolver.openInputStream(file.getUri())) {
            if (input == null) throw new Exception("Proje dosyası açılamadı.");
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] bytes = new byte[8192];
            int read;
            int total = 0;
            while ((read = input.read(bytes)) >= 0) {
                total += read;
                if (total > MAX_FILE_BYTES) throw new Exception("Proje dosyası boyut sınırını aşıyor.");
                buffer.write(bytes, 0, read);
            }
            return buffer.toByteArray();
        }
    }

    private void writeBytes(DocumentFile file, byte[] bytes) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ParcelFileDescriptor descriptor;
        try {
            descriptor = resolver.openFileDescriptor(file.getUri(), "rwt");
        } catch (Exception unsupportedTruncateMode) {
            descriptor = resolver.openFileDescriptor(file.getUri(), "w");
        }
        if (descriptor == null) throw new Exception("Proje dosyası yazma tanıtıcısı açılamadı.");
        try (ParcelFileDescriptor owned = descriptor;
             FileOutputStream output = new FileOutputStream(owned.getFileDescriptor())) {
            output.write(bytes);
            output.flush();
            output.getFD().sync();
        }
    }

    private String sha256(byte[] bytes) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        StringBuilder value = new StringBuilder();
        for (byte item : digest.digest(bytes)) {
            value.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        }
        return value.toString();
    }

    private void validateJson(byte[] bytes, String expectedId, String expectedType) throws Exception {
        JSONObject data;
        try {
            data = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new Exception("Yazılan JSON yeniden ayrıştırılamadı.");
        }
        if ((expectedId == null || expectedId.isEmpty()) &&
            (expectedType == null || expectedType.isEmpty())) return;
        JSONObject pisi = data.optJSONObject("pisi");
        if (pisi == null) throw new Exception("Yazılan Pisi dosyasında metadata yok.");
        if (expectedId != null && !expectedId.isEmpty() && !expectedId.equals(pisi.optString("id"))) {
            throw new Exception("Yazılan dosyanın Pisi kimliği doğrulanamadı.");
        }
        if (expectedType != null && !expectedType.isEmpty() && !expectedType.equals(pisi.optString("type"))) {
            throw new Exception("Yazılan dosyanın Pisi türü doğrulanamadı.");
        }
    }

    private boolean sameContent(DocumentFile file, byte[] expected) throws Exception {
        return file != null && file.isFile() && Arrays.equals(readBytes(file), expected);
    }

    private void saveTransaction(JSONObject transaction) throws Exception {
        if (!preferences().edit().putString(TRANSACTION_KEY, transaction.toString()).commit()) {
            throw new Exception("Yazma kurtarma günlüğü kaydedilemedi.");
        }
    }

    private void clearTransaction() {
        preferences().edit().remove(TRANSACTION_KEY).commit();
    }

    private void copyVerified(DocumentFile source, DocumentFile target) throws Exception {
        byte[] bytes = readBytes(source);
        writeBytes(target, bytes);
        if (!sameContent(target, bytes)) throw new Exception("Kurtarma kopyası doğrulanamadı.");
    }

    private void recoverPendingTransaction(DocumentFile root) throws Exception {
        String raw = preferences().getString(TRANSACTION_KEY, "");
        if (raw.isEmpty()) return;
        long started = System.currentTimeMillis();
        JSONObject tx = new JSONObject(raw);
        String parentPath = tx.optString("parentPath", "");
        String targetName = tx.getString("targetName");
        String tempName = tx.getString("tempName");
        String backupName = tx.optString("backupName", "");
        String expectedHash = tx.getString("expectedHash");
        DocumentFile parent = parentPath.isEmpty() ? root : findPath(root, parentPath);
        if (parent == null || !parent.isDirectory()) {
            throw new Exception("Yarım kalan yazmanın üst klasörü bulunamadı.");
        }
        DocumentFile target = parent.findFile(targetName);
        DocumentFile temp = parent.findFile(tempName);
        DocumentFile backup = backupName.isEmpty() ? null : parent.findFile(backupName);
        if (target != null && expectedHash.equals(sha256(readBytes(target)))) {
            if (temp != null) temp.delete();
            if (backup != null) backup.delete();
            clearTransaction();
            Log.i(TAG, "RECOVER_WRITE path=" + tx.optString("path") +
                " result=new-kept durationMs=" + (System.currentTimeMillis() - started));
            return;
        }
        if (temp != null && expectedHash.equals(sha256(readBytes(temp)))) {
            if (target == null) {
                if (!temp.renameTo(targetName)) {
                    target = createExactFile(parent, "application/json", targetName);
                    copyVerified(temp, target);
                } else {
                    target = parent.findFile(targetName);
                }
            } else {
                copyVerified(temp, target);
            }
            if (target != null && expectedHash.equals(sha256(readBytes(target)))) {
                DocumentFile remainingTemp = parent.findFile(tempName);
                if (remainingTemp != null) remainingTemp.delete();
                if (backup != null) backup.delete();
                clearTransaction();
                Log.i(TAG, "RECOVER_WRITE path=" + tx.optString("path") +
                    " result=new-completed durationMs=" + (System.currentTimeMillis() - started));
                return;
            }
        }
        if (backup != null && backup.isFile()) {
            byte[] oldBytes = readBytes(backup);
            if (target == null) {
                if (!backup.renameTo(targetName)) {
                    target = createExactFile(parent, "application/json", targetName);
                    writeBytes(target, oldBytes);
                }
            } else {
                writeBytes(target, oldBytes);
            }
            if (!sameContent(parent.findFile(targetName), oldBytes)) {
                throw new Exception("Yarım kalan yazmanın eski sürümü geri yüklenemedi.");
            }
            DocumentFile remainingBackup = parent.findFile(backupName);
            if (remainingBackup != null) remainingBackup.delete();
        }
        DocumentFile remainingTemp = parent.findFile(tempName);
        if (remainingTemp != null) remainingTemp.delete();
        clearTransaction();
        Log.i(TAG, "RECOVER_WRITE path=" + tx.optString("path") +
            " result=old-restored durationMs=" + (System.currentTimeMillis() - started));
    }

    private JSObject writeTextVerifiedInternal(
        DocumentFile root,
        String path,
        String content,
        String expectedId,
        String expectedType
    ) throws Exception {
        long started = System.currentTimeMillis();
        String operation = expectedType == null || expectedType.isEmpty()
            ? "WRITE_JSON" : "SAVE_" + expectedType.toUpperCase(Locale.ROOT);
        String[] segments = safeSegments(path);
        validateWritableSegments(segments);
        if (segments.length == 0) throw new Exception("Proje dosya yolu gerekli.");
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_FILE_BYTES) throw new Exception("Proje dosyası boyut sınırını aşıyor.");
        validateJson(bytes, expectedId, expectedType);
        DocumentFile parent = ensureParent(root, segments);
        String name = segments[segments.length - 1];
        DocumentFile target = parent.findFile(name);
        String token = UUID.randomUUID().toString().replace("-", "");
        String tempName = ".pisi-tmp-" + token + ".json";
        String backupName = target == null ? "" : ".pisi-old-" + token + ".json";
        DocumentFile temp = createExactFile(parent, "application/json", tempName);
        String expectedHash = sha256(bytes);
        try {
            writeBytes(temp, bytes);
            if (!sameContent(temp, bytes)) throw new Exception("Geçici dosya byte doğrulamasını geçemedi.");
            validateJson(readBytes(temp), expectedId, expectedType);
            if (target != null) {
                DocumentFile backup = createExactFile(parent, "application/json", backupName);
                copyVerified(target, backup);
            }
            saveTransaction(new JSONObject()
                .put("version", 1)
                .put("path", path)
                .put("parentPath", parentPath(path))
                .put("targetName", name)
                .put("tempName", tempName)
                .put("backupName", backupName)
                .put("expectedHash", expectedHash));
            if (target == null) {
                if (!temp.renameTo(name)) {
                    target = createExactFile(parent, "application/json", name);
                    copyVerified(temp, target);
                }
            } else {
                copyVerified(temp, target);
            }
            target = parent.findFile(name);
            if (target == null || !sameContent(target, bytes)) {
                throw new Exception("Hedef dosya aynı byte içeriğiyle geri okunamadı.");
            }
            validateJson(readBytes(target), expectedId, expectedType);
            if (parent.findFile(name) == null) throw new Exception("Hedef dosya klasör listesinde görünmüyor.");
            DocumentFile remainingTemp = parent.findFile(tempName);
            if (remainingTemp != null && !remainingTemp.delete()) {
                throw new Exception("Geçici yazma dosyası temizlenemedi.");
            }
            DocumentFile remainingBackup = backupName.isEmpty() ? null : parent.findFile(backupName);
            if (remainingBackup != null && !remainingBackup.delete()) {
                throw new Exception("Eski sürüm kurtarma kopyası temizlenemedi.");
            }
            clearTransaction();
            String completedAt = isoNow();
            preferences().edit()
                .putString(LAST_WRITE_KEY, completedAt)
                .putString(LAST_WRITE_PATH_KEY, path)
                .putLong(LAST_WRITE_BYTES_KEY, bytes.length)
                .commit();
            JSObject response = new JSObject();
            response.put("ok", true);
            response.put("verified", true);
            response.put("listed", true);
            response.put("jsonParsed", true);
            response.put("bytes", bytes.length);
            response.put("sha256", expectedHash);
            response.put("path", path);
            response.put("uri", target.getUri().toString());
            response.put("completedAt", completedAt);
            response.put("durationMs", System.currentTimeMillis() - started);
            Log.i(TAG, operation + " id=" + String.valueOf(expectedId) + " relativePath=" + path +
                " storageUri=" + configuredUri() + " result=ok bytes=" + bytes.length +
                " verified=true durationMs=" + (System.currentTimeMillis() - started));
            return response;
        } catch (Exception error) {
            try { recoverPendingTransaction(root); } catch (Exception recoveryError) {
                error.addSuppressed(recoveryError);
            }
            DocumentFile remainingTemp = parent.findFile(tempName);
            if (remainingTemp != null) try { remainingTemp.delete(); } catch (Exception ignored) {}
            Log.e(TAG, operation + " id=" + String.valueOf(expectedId) + " relativePath=" + path +
                " storageUri=" + configuredUri() + " result=failed bytes=" + bytes.length +
                " verified=false durationMs=" + (System.currentTimeMillis() - started) +
                " exception=" + error.getClass().getSimpleName() + ":" + error.getMessage());
            throw error;
        }
    }

    private void requireConfigured(PluginCall call, FolderOperation operation) {
        getBridge().execute(() -> {
            try {
                DocumentFile root = configuredRoot();
                Uri uri = configuredUri();
                if (!hasPersistedReadWritePermission(uri) || root == null || !root.exists() ||
                    !root.canRead() || !root.canWrite()) {
                    throw new Exception("Pisi proje klasörü okunamıyor veya yazılamıyor. Klasörü yeniden seçin.");
                }
                recoverPendingTransaction(root);
                operation.run(root);
            } catch (Exception error) {
                call.reject(error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void chooseFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        Uri previous = configuredUri();
        if (previous != null) intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, previous);
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
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        Uri previous = configuredUri();
        try {
            if (
                previous != null && !previous.equals(uri) &&
                !preferences().getString(TRANSACTION_KEY, "").isEmpty()
            ) {
                DocumentFile previousRoot = DocumentFile.fromTreeUri(getContext(), previous);
                if (previousRoot == null || !hasPersistedReadWritePermission(previous)) {
                    throw new Exception("Eski klasördeki yarım yazma kurtarılamadan klasör değiştirilemez.");
                }
                recoverPendingTransaction(previousRoot);
            }
            if ((flags & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0 ||
                (flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == 0) {
                throw new Exception("Android klasör için okuma-yazma izni vermedi.");
            }
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            DocumentFile root = DocumentFile.fromTreeUri(getContext(), uri);
            if (root == null || !root.exists() || !root.canRead() || !root.canWrite()) {
                throw new Exception("Seçilen klasör okuma ve yazma izni vermedi.");
            }
            if (!hasPersistedReadWritePermission(uri)) throw new Exception("Android kalıcı klasör iznini kaydetmedi.");
            if (!preferences().edit().putString(URI_KEY, uri.toString()).commit()) {
                throw new Exception("Klasör seçimi uygulama ayarlarına kaydedilemedi.");
            }
            if (previous != null && !previous.equals(uri)) {
                try {
                    getContext().getContentResolver().releasePersistableUriPermission(previous,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (Exception ignored) {}
            }
            JSObject response = new JSObject();
            putFolderStatus(response, uri, root);
            call.resolve(response);
        } catch (Exception error) {
            if (previous == null || !previous.equals(uri)) {
                try {
                    getContext().getContentResolver().releasePersistableUriPermission(uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (Exception ignored) {}
            }
            call.reject("Klasör bağlanamadı: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void getFolder(PluginCall call) {
        Uri uri = configuredUri();
        DocumentFile root = configuredRoot();
        JSObject response = new JSObject();
        putFolderStatus(response, uri, root);
        call.resolve(response);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        getBridge().execute(() -> {
            Uri uri = configuredUri();
            try {
                DocumentFile root = configuredRoot();
                if (root != null && root.exists() && hasPersistedReadWritePermission(uri)) {
                    recoverPendingTransaction(root);
                } else if (!preferences().getString(TRANSACTION_KEY, "").isEmpty()) {
                    throw new Exception("Yarım kalan dosya yazımı kurtarılmadan klasör bağlantısı kesilemez.");
                }
                if (!preferences().edit().remove(URI_KEY).commit()) {
                    throw new Exception("Klasör bağlantısı uygulama ayarlarından kaldırılamadı.");
                }
                if (uri != null) {
                    try {
                        getContext().getContentResolver().releasePersistableUriPermission(uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    } catch (Exception ignored) {}
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("Klasör bağlantısı güvenle kesilemedi: " + error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void readText(PluginCall call) {
        String path = call.getString("path", "");
        requireConfigured(call, (root) -> {
            long started = System.currentTimeMillis();
            DocumentFile file = findPath(root, path);
            if (file == null || !file.isFile()) {
                JSObject response = new JSObject();
                response.put("exists", false);
                response.put("content", "");
                call.resolve(response);
                return;
            }
            byte[] bytes = readBytes(file);
            JSObject response = new JSObject();
            response.put("exists", true);
            response.put("content", new String(bytes, StandardCharsets.UTF_8));
            response.put("bytes", bytes.length);
            response.put("sha256", sha256(bytes));
            response.put("durationMs", System.currentTimeMillis() - started);
            call.resolve(response);
        });
    }

    @PluginMethod
    public void writeText(PluginCall call) {
        String path = call.getString("path", "");
        String content = call.getString("content", "");
        String expectedId = call.getString("expectedId", "");
        String expectedType = call.getString("expectedType", "");
        requireConfigured(call, (root) -> call.resolve(writeTextVerifiedInternal(
            root, path, content, expectedId, expectedType
        )));
    }

    @PluginMethod
    public void probeFolder(PluginCall call) {
        requireConfigured(call, (root) -> {
            String name = ".pisi-write-test-" + UUID.randomUUID().toString().replace("-", "") + ".json";
            String token = UUID.randomUUID().toString();
            String content = new JSONObject()
                .put("format", "pisi-storage-probe")
                .put("token", token)
                .toString();
            writeTextVerifiedInternal(root, name, content, "", "");
            DocumentFile file = root.findFile(name);
            byte[] expected = content.getBytes(StandardCharsets.UTF_8);
            if (file == null || !sameContent(file, expected)) {
                throw new Exception("Klasör deneme dosyası listede veya içerikte doğrulanamadı.");
            }
            if (!file.delete() || root.findFile(name) != null) {
                throw new Exception("Klasör deneme dosyası silinemedi.");
            }
            JSObject response = new JSObject();
            response.put("ok", true);
            response.put("verified", true);
            response.put("created", true);
            response.put("readBack", true);
            response.put("listed", true);
            response.put("deleted", true);
            response.put("bytes", expected.length);
            response.put("checkedAt", isoNow());
            Log.i(TAG, "PROBE_FOLDER storageUri=" + configuredUri() +
                " result=ok created=true readBack=true listed=true deleted=true bytes=" + expected.length);
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
                collectFiles(start, "", collected, path.isEmpty());
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
            long started = System.currentTimeMillis();
            DocumentFile file = findPath(root, path);
            if (file != null && file.isFile() && !file.delete()) throw new Exception("Proje dosyası silinemedi.");
            if (findPath(root, path) != null) throw new Exception("Silinen proje dosyası klasör listesinde kalıyor.");
            JSObject response = new JSObject();
            response.put("ok", true);
            response.put("verified", true);
            response.put("durationMs", System.currentTimeMillis() - started);
            Log.i(TAG, "DELETE_FILE relativePath=" + path + " storageUri=" + configuredUri() +
                " result=ok verified=true durationMs=" + (System.currentTimeMillis() - started));
            call.resolve(response);
        });
    }

    @PluginMethod
    public void moveEntry(PluginCall call) {
        String fromPath = call.getString("fromPath", "");
        String toPath = call.getString("toPath", "");
        requireConfigured(call, (root) -> {
            long started = System.currentTimeMillis();
            String[] targetSegments = safeSegments(toPath);
            validateWritableSegments(targetSegments);
            if (targetSegments.length == 0 || fromPath.equals(toPath)) {
                throw new Exception("Taşıma için farklı kaynak ve hedef yolları gerekli.");
            }
            DocumentFile source = findPath(root, fromPath);
            DocumentFile existingTarget = findPath(root, toPath);
            JSObject response = new JSObject();
            if (source == null) {
                response.put("ok", true);
                response.put("verified", existingTarget != null);
                response.put("moved", false);
                response.put("missing", existingTarget == null);
                response.put("alreadyMoved", existingTarget != null);
                call.resolve(response);
                return;
            }
            if (existingTarget != null) {
                throw new Exception("Taşıma hedefi zaten var: " + toPath);
            }
            DocumentFile sourceParent = parentPath(fromPath).isEmpty()
                ? root : findPath(root, parentPath(fromPath));
            DocumentFile targetParent = ensureParent(root, targetSegments);
            if (sourceParent == null || !sourceParent.isDirectory()) {
                throw new Exception("Taşıma kaynağının üst klasörü bulunamadı.");
            }
            Uri moved = DocumentsContract.moveDocument(
                getContext().getContentResolver(),
                source.getUri(),
                sourceParent.getUri(),
                targetParent.getUri()
            );
            if (moved == null) throw new Exception("Android belge sağlayıcısı taşımayı desteklemedi.");
            String targetName = targetSegments[targetSegments.length - 1];
            String sourceName = source.getName();
            if (sourceName == null) throw new Exception("Taşınan dosya adı alınamadı.");
            DocumentFile movedEntry = targetParent.findFile(sourceName);
            if (movedEntry == null) {
                movedEntry = DocumentFile.fromSingleUri(getContext(), moved);
            }
            if (!sourceName.equals(targetName)) {
                if (movedEntry == null || !movedEntry.renameTo(targetName)) {
                    throw new Exception("Taşınan dosya hedef adıyla yeniden adlandırılamadı.");
                }
            }
            if (findPath(root, fromPath) != null || findPath(root, toPath) == null) {
                throw new Exception("Taşıma kaynak/hedef klasör listesinde doğrulanamadı.");
            }
            response.put("ok", true);
            response.put("verified", true);
            response.put("moved", true);
            response.put("missing", false);
            response.put("alreadyMoved", false);
            response.put("durationMs", System.currentTimeMillis() - started);
            Log.i(TAG, "MOVE_ENTRY fromPath=" + fromPath + " toPath=" + toPath +
                " storageUri=" + configuredUri() + " result=ok verified=true durationMs=" +
                (System.currentTimeMillis() - started));
            call.resolve(response);
        });
    }

    @PluginMethod
    public void openDriveSync(PluginCall call) {
        try {
            Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(DRIVESYNC_PACKAGE);
            JSObject response = new JSObject();
            if (launch == null) {
                response.put("opened", false);
                response.put("installed", false);
                call.resolve(response);
                return;
            }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(launch);
            response.put("opened", true);
            response.put("installed", true);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("DriveSync açılamadı: " + error.getMessage(), error);
        }
    }

    private void collectFiles(
        DocumentFile directory,
        String prefix,
        List<String> output,
        boolean rootScan
    ) throws Exception {
        for (DocumentFile entry : directory.listFiles()) {
            if (output.size() >= MAX_LIST_FILES) throw new Exception("Proje klasöründe çok fazla dosya var.");
            String name = entry.getName();
            if (name == null || name.isEmpty() || name.length() > 180) continue;
            boolean invalidName = name.equals(".") || name.equals("..");
            for (int index = 0; !invalidName && index < name.length(); index++) {
                invalidName = Character.isISOControl(name.charAt(index));
            }
            if (invalidName) continue;
            String relative = prefix.isEmpty() ? name : prefix + "/" + name;
            String lower = relative.toLowerCase(Locale.ROOT);
            if (entry.isDirectory()) {
                String lowerName = name.toLowerCase(Locale.ROOT);
                if (lowerName.equals(".git") || lowerName.equals("node_modules") ||
                    (rootScan && lowerName.equals(".pisi-sync")) ||
                    lower.equals(".pisi-history") || lower.startsWith(".pisi-history/") ||
                    lower.equals(".pisi/sync-trash") || lower.startsWith(".pisi/sync-trash/") ||
                    (rootScan && (lower.equals(".pisi/recovery") || lower.startsWith(".pisi/recovery/")))) {
                    continue;
                }
                collectFiles(entry, relative, output, false);
            } else if (entry.isFile() &&
                !lower.startsWith(".pisi-tmp-") && !lower.startsWith(".pisi-old-") &&
                !lower.contains("/.pisi-tmp-") && !lower.contains("/.pisi-old-") &&
                (lower.endsWith(".json") || lower.endsWith(".node") || lower.endsWith(".map"))) {
                output.add(relative);
            }
        }
    }

    private interface FolderOperation {
        void run(DocumentFile root) throws Exception;
    }
}
