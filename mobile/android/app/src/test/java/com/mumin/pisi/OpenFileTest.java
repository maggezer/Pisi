package com.mumin.pisi;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** The rules PisiFilesPlugin opens an attachment by (docs/sync-plan.md S6 step 4). */
public class OpenFileTest {

    @Rule
    public TemporaryFolder folder = new TemporaryFolder();

    @Test
    public void onlyFilesInsideTheProjectsFolderAreOpened() throws Exception {
        File files = folder.newFolder("files");
        File inside = new File(files, "projects/default/inv_Not__node_1/file/abc.pdf");
        inside.getParentFile().mkdirs();
        Files.write(inside.toPath(), "pdf".getBytes(StandardCharsets.UTF_8));
        File secret = new File(files, "sync/secrets/x");
        secret.getParentFile().mkdirs();
        Files.write(secret.toPath(), "k".getBytes(StandardCharsets.UTF_8));

        assertEquals(inside.getCanonicalFile(), OpenFile.resolveInside(files, "projects/default/inv_Not__node_1/file/abc.pdf"));
        assertNull(OpenFile.resolveInside(files, "sync/secrets/x"));
        assertNull(OpenFile.resolveInside(files, "projects/default/../../sync/secrets/x"));
        assertNull(OpenFile.resolveInside(files, "projects/default/yok.pdf"));
        assertNull(OpenFile.resolveInside(files, "projects"));
        assertNull(OpenFile.resolveInside(files, ""));
    }

    @Test
    public void executableKindsAreNotOpened() {
        for (String name : new String[] { "kur.apk", "a.EXE", "betik.sh", "x.js" }) assertTrue(name, OpenFile.isExecutable(name));
        for (String name : new String[] { "rapor.pdf", "tablo.xlsx", "ses.mp3", "adsız" }) assertFalse(name, OpenFile.isExecutable(name));
    }

    @Test
    public void theCopyCarriesASafeVersionOfTheBlockName() throws Exception {
        assertEquals("Rapor 2026.pdf", OpenFile.safeName("Rapor/2026.pdf", "abc.pdf"));
        assertEquals("abc.pdf", OpenFile.safeName("..", "abc.pdf"));
        assertEquals("abc.pdf", OpenFile.safeName(null, "abc.pdf"));
        assertEquals("Çiçek notu.txt", OpenFile.safeName("Çiçek\u0000notu.txt", "x"));

        File source = folder.newFile("abc.pdf");
        Files.write(source.toPath(), "içerik".getBytes(StandardCharsets.UTF_8));
        File cache = new File(folder.getRoot(), "cache/pisi-open");
        cache.mkdirs();
        Files.write(new File(cache, "eski.pdf").toPath(), new byte[] { 1 });
        File copy = OpenFile.copyForViewing(source, cache, "Rapor.pdf");
        assertEquals("Rapor.pdf", copy.getName());
        assertEquals("içerik", new String(Files.readAllBytes(copy.toPath()), StandardCharsets.UTF_8));
        assertFalse(new File(cache, "eski.pdf").exists());
    }
}
