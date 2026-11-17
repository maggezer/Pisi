package com.mumin.pisi;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** SecretBox with a software AES key (the app uses one from the Android Keystore): docs/sync-plan.md S5. */
public class SecretBoxTest {

    @Rule
    public TemporaryFolder folder = new TemporaryFolder();

    private static final String TOKEN = "pst_aGVsbG8tdGhpcy1pcy1hLXRlc3QtdG9rZW4tdmFsdWUtMTIz";
    private SecretKey key;
    private SecretBox box;
    private File dir;

    @Before
    public void setUp() throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES");
        generator.init(256);
        key = generator.generateKey();
        dir = new File(folder.getRoot(), "sync/secrets");
        box = new SecretBox(dir, () -> key);
    }

    private static boolean contains(byte[] haystack, byte[] needle) {
        outer:
        for (int i = 0; i + needle.length <= haystack.length; i++) {
            for (int j = 0; j < needle.length; j++) if (haystack[i + j] != needle[j]) continue outer;
            return true;
        }
        return false;
    }

    @Test
    public void storesAndReadsBack() throws Exception {
        String value = "{\"v\":1,\"token\":\"" + TOKEN + "\",\"key\":\"AAAA\"}";
        box.put("sync-sp_test", value);
        assertEquals(value, box.get("sync-sp_test"));
        assertNull(box.get("sync-other"));
    }

    @Test
    public void noPlainTextOnDisk() throws Exception {
        box.put("sync-sp_test", "{\"token\":\"" + TOKEN + "\"}");
        File[] files = dir.listFiles();
        assertEquals(1, files.length);
        byte[] stored = Files.readAllBytes(files[0].toPath());
        assertFalse(contains(stored, TOKEN.getBytes(StandardCharsets.UTF_8)));
        assertFalse(contains(stored, Base64.getEncoder().encode(TOKEN.getBytes(StandardCharsets.UTF_8))));
        assertFalse(contains(stored, "token".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    public void eachWriteUsesANewNonce() throws Exception {
        box.put("a", "aynı değer");
        byte[] first = Files.readAllBytes(new File(dir, "a.bin").toPath());
        box.put("a", "aynı değer");
        byte[] second = Files.readAllBytes(new File(dir, "a.bin").toPath());
        assertFalse(java.util.Arrays.equals(first, second));
    }

    @Test
    public void changedFileOrOtherKeyDoesNotOpen() throws Exception {
        box.put("a", "değer");
        File file = new File(dir, "a.bin");
        byte[] stored = Files.readAllBytes(file.toPath());
        stored[stored.length - 1] ^= 1;
        Files.write(file.toPath(), stored);
        assertThrows(SecretBox.UnreadableSecretException.class, () -> box.get("a"));

        box.put("b", "değer");
        KeyGenerator generator = KeyGenerator.getInstance("AES");
        generator.init(256);
        SecretKey other = generator.generateKey();
        assertThrows(SecretBox.UnreadableSecretException.class, () -> new SecretBox(dir, () -> other).get("b"));
    }

    @Test
    public void aFileCopiedUnderAnotherNameDoesNotOpen() throws Exception {
        box.put("a", "değer");
        Files.copy(new File(dir, "a.bin").toPath(), new File(dir, "b.bin").toPath());
        assertThrows(SecretBox.UnreadableSecretException.class, () -> box.get("b"));
    }

    @Test
    public void removeAndNames() throws Exception {
        box.put("a", "değer");
        box.remove("a");
        assertNull(box.get("a"));
        box.remove("a");
        assertThrows(IllegalArgumentException.class, () -> box.put("../x", "değer"));
        assertTrue(dir.isDirectory());
        File[] left = dir.listFiles();
        assertEquals(0, left.length);
    }
}
