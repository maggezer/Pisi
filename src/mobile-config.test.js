// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Android keyboard and responsive CSS configuration', () => {
  it('loads responsive overrides after base styles', () => {
    const entry = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(entry.indexOf("import './styles.css'")).toBeLessThan(entry.indexOf("import './platform.css'"));
    expect(html).not.toContain('/src/platform.css');
    expect(entry).toContain("querySelectorAll('button[data-theme-option]')");
    expect(entry).not.toContain("querySelectorAll('[data-theme]')");
  });

  it('keeps Android resize and Capacitor full-screen fallback enabled', () => {
    const config = JSON.parse(readFileSync(new URL('../capacitor.config.json', import.meta.url), 'utf8'));
    const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
    expect(config.plugins.Keyboard).toMatchObject({ resize: 'native', resizeOnFullScreen: true });
    expect(manifest).toContain('android:windowSoftInputMode="adjustResize"');
  });

  it('uses a persisted scoped folder grant and accepts real Pisi file names', () => {
    const plugin = readFileSync(new URL(
      '../android/app/src/main/java/com/maggezer/pisi/PisiSyncFolderPlugin.java',
      import.meta.url
    ), 'utf8');
    expect(plugin).toContain('Intent.ACTION_OPEN_DOCUMENT_TREE');
    expect(plugin).toContain('takePersistableUriPermission');
    expect(plugin).toContain('permission.isReadPermission() && permission.isWritePermission()');
    expect(plugin).toContain('response.put("permissionPersisted", persisted)');
    expect(plugin).toContain('lower.endsWith(".node")');
    expect(plugin).toContain('lower.endsWith(".map")');
    expect(plugin).toContain('Character.isISOControl');
    expect(plugin).not.toContain('!segment.matches("[A-Za-z0-9._:-]{1,180}")');
  });
});
