package com.mumin.pisi;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.text.Normalizer;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * The plain rules of opening an attachment (docs/sync-plan.md S6 step 4, PisiFilesPlugin):
 * the file must be inside the app's projects folder, executable kinds are never opened
 * (the same list as the desktop's main/functions/editor-file-asset-store.js), and the copy
 * handed to another app carries the block's own file name, made safe.
 */
final class OpenFile {

    static final Set<String> EXECUTABLE = new HashSet<>(
        Arrays.asList(
            (
                "exe msi msix msp appx appxbundle bat cmd com scr pif cpl ps1 psm1 vbs vbe js jse mjs cjs wsf wsh hta jar " +
                "app command tool sh bash zsh csh fish ksh run bin desktop appimage deb rpm dmg pkg mpkg lnk url reg inf scf gadget " +
                "py pyw pl rb php apk xpi"
            ).split(" ")
        )
    );

    private OpenFile() {}

    /** `relative` under `filesDir`, or null when it leaves `filesDir/projects/` or is not a file. */
    static File resolveInside(File filesDir, String relative) throws IOException {
        if (relative == null || relative.isEmpty()) return null;
        File projects = new File(filesDir, "projects").getCanonicalFile();
        File target = new File(filesDir, relative).getCanonicalFile();
        if (!target.getPath().startsWith(projects.getPath() + File.separator)) return null;
        return target.isFile() ? target : null;
    }

    /** The extension of a name in lower case, or "" when it has none. */
    static String extension(String name) {
        int dot = name == null ? -1 : name.lastIndexOf('.');
        if (dot <= 0 || dot == name.length() - 1) return "";
        return name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    static boolean isExecutable(String name) {
        return EXECUTABLE.contains(extension(name));
    }

    /** A file name without separators or control characters; `fallback` when nothing is left. */
    static String safeName(String name, String fallback) {
        String clean = Normalizer.normalize(name == null ? "" : name, Normalizer.Form.NFC)
            .replaceAll("[\\u0000-\\u001f\\u007f/\\\\:*?\"<>|]+", " ")
            .replaceAll("\\s+", " ")
            .trim()
            .replaceAll("^\\.+", "");
        if (clean.length() > 120) clean = clean.substring(0, 120).trim();
        return clean.isEmpty() ? fallback : clean;
    }

    /** Copies `source` into `folder` (emptied first) under `name`; resolves the copy. */
    static File copyForViewing(File source, File folder, String name) throws IOException {
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("cache folder");
        File[] old = folder.listFiles();
        if (old != null) for (File file : old) if (file.isFile()) file.delete();
        File copy = new File(folder, name);
        Files.copy(source.toPath(), copy.toPath(), StandardCopyOption.REPLACE_EXISTING);
        return copy;
    }
}
