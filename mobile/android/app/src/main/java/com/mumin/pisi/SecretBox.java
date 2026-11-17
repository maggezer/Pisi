package com.mumin.pisi;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.GeneralSecurityException;
import java.util.Arrays;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Small secrets of Pisi Sync (the device token and the project key, docs/sync-plan.md S5 step 1),
 * stored wrapped: AES-256-GCM with a key that never leaves its source (the Android Keystore in the
 * app, a software key in unit tests). Each value is one file {@code <name>.bin} in {@code dir}:
 * "PSB1" | IV length | IV | ciphertext and tag. The name is bound as additional data, so a file
 * copied under another name does not open. Writes go to a temporary file first and are renamed.
 */
public final class SecretBox {

    /** Where the wrapping key comes from. */
    public interface KeySource {
        SecretKey get() throws GeneralSecurityException;
    }

    /** A value that is there but does not open (wrong key, changed file). */
    public static final class UnreadableSecretException extends Exception {
        UnreadableSecretException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private static final byte[] MAGIC = "PSB1".getBytes(StandardCharsets.US_ASCII);
    private static final Pattern NAME = Pattern.compile("^[A-Za-z0-9_-]{1,100}$");
    private static final int TAG_BITS = 128;

    private final File dir;
    private final KeySource keys;

    public SecretBox(File dir, KeySource keys) {
        this.dir = dir;
        this.keys = keys;
    }

    private File fileOf(String name) {
        if (name == null || !NAME.matcher(name).matches()) throw new IllegalArgumentException("Geçersiz ad.");
        return new File(dir, name + ".bin");
    }

    private static byte[] aad(String name) {
        return ("pisi-secrets/1|" + name).getBytes(StandardCharsets.UTF_8);
    }

    public void put(String name, String value) throws GeneralSecurityException, IOException {
        File target = fileOf(name);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        // The cipher picks a fresh random IV; the Keystore does not let the caller choose one.
        cipher.init(Cipher.ENCRYPT_MODE, keys.get());
        cipher.updateAAD(aad(name));
        byte[] sealed = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(MAGIC);
        out.write(iv.length);
        out.write(iv);
        out.write(sealed);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Klasör açılamadı.");
        File temp = new File(dir, "." + name + "." + UUID.randomUUID() + ".tmp");
        try (FileOutputStream stream = new FileOutputStream(temp)) {
            stream.write(out.toByteArray());
            stream.getFD().sync();
        }
        if (!temp.renameTo(target)) {
            temp.delete();
            throw new IOException("Değer yazılamadı.");
        }
    }

    /** The value, or null when there is none. */
    public String get(String name) throws UnreadableSecretException, IOException {
        File source = fileOf(name);
        if (!source.isFile()) return null;
        byte[] data = Files.readAllBytes(source.toPath());
        try {
            if (data.length < MAGIC.length + 1 || !Arrays.equals(Arrays.copyOfRange(data, 0, MAGIC.length), MAGIC)) {
                throw new GeneralSecurityException("Biçim tanınmadı.");
            }
            int ivLength = data[MAGIC.length] & 0xff;
            int start = MAGIC.length + 1;
            if (ivLength < 12 || data.length < start + ivLength + TAG_BITS / 8) throw new GeneralSecurityException("Biçim tanınmadı.");
            byte[] iv = Arrays.copyOfRange(data, start, start + ivLength);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, keys.get(), new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(aad(name));
            byte[] plain = cipher.doFinal(data, start + ivLength, data.length - start - ivLength);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException error) {
            throw new UnreadableSecretException("Değer açılamadı.", error);
        }
    }

    public void remove(String name) throws IOException {
        File target = fileOf(name);
        if (target.exists() && !target.delete()) throw new IOException("Değer silinemedi.");
    }
}
