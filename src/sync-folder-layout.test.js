import { describe, expect, it } from 'vitest';
import {
  chooseSyncLayout, formatSyncStoragePath, makeSyncPaths,
  SYNC_LAYOUT_DIRECT, SYNC_LAYOUT_NESTED
} from './sync-folder-layout.js';

describe('Pisi Sync folder layout', () => {
  it('uses the standard nested protocol directory for a shared workspace folder', () => {
    const choice = chooseSyncLayout({
      folderName: 'Pisi Sync',
      nested: 'valid',
      direct: 'missing'
    });
    expect(choice.mode).toBe(SYNC_LAYOUT_NESTED);
    expect(makeSyncPaths(choice.mode).manifest).toBe('.pisi-sync/manifest.json');
    expect(formatSyncStoragePath('Pisi Sync', choice.mode)).toBe('Pisi Sync/.pisi-sync');
  });

  it('treats a directly selected .pisi-sync directory as the protocol root', () => {
    const choice = chooseSyncLayout({
      folderName: '.pisi-sync',
      direct: 'valid',
      nested: 'missing'
    });
    expect(choice.mode).toBe(SYNC_LAYOUT_DIRECT);
    expect(makeSyncPaths(choice.mode).manifest).toBe('manifest.json');
    expect(formatSyncStoragePath('.pisi-sync', choice.mode)).toBe('.pisi-sync');
  });

  it('repairs the old nested-folder mismatch by preferring the direct project', () => {
    const choice = chooseSyncLayout({
      folderName: '.pisi-sync',
      direct: 'valid',
      nested: 'valid'
    });
    expect(choice.mode).toBe(SYNC_LAYOUT_DIRECT);
    expect(choice.duplicateProjects).toBe(true);
  });

  it('recovers an existing project even when the provider does not expose its folder name', () => {
    const choice = chooseSyncLayout({
      folderName: '',
      direct: 'valid',
      nested: 'missing'
    });
    expect(choice.mode).toBe(SYNC_LAYOUT_DIRECT);
    expect(choice.recoveredAlternate).toBe(true);
  });
});
