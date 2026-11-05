# Pisi auto-update architecture

Pisi intentionally uses different update mechanisms for different Windows
distribution channels.

## Microsoft Store / MSIX

When Electron reports `process.windowsStore === true`, Pisi does not run its
direct updater. The Microsoft Store owns update delivery for the MSIX package.

The Store workflow can optionally submit every tagged build automatically when
the repository variable `PISI_STORE_AUTO_PUBLISH` is set to `true` and the
Partner Center credentials are configured. After Microsoft accepts/publishes
the new package, existing Store installations receive it through the Store
update mechanism.

## Direct NSIS installation

The normal NSIS installer contains Pisi's direct updater only when the build
has a public HTTPS update feed configured.

Repository variables:

- `PISI_UPDATE_FEED_URL` — public HTTPS directory containing `latest.json`
  and the matching Setup executables.
- `PISI_UPDATE_CHANNEL` — update channel, defaults to `beta`.

Example feed layout:

```text
https://updates.example.com/pisi/windows/beta/
  latest.json
  Pisi-0.12.0-Setup-x64.exe
  Pisi-0.12.0-Setup-arm64.exe
```

The release workflow generates `latest.json` automatically. Its installer
entries use relative URLs so the exact same release directory can be mirrored
to any HTTPS static host.

The updater:

1. starts only in packaged NSIS builds;
2. waits briefly after application startup;
3. checks the feed every six hours;
4. compares semantic versions and update channels;
5. downloads only the installer for the current architecture;
6. requires HTTPS;
7. requires the installer URL to originate from the configured feed;
8. verifies SHA-256 before accepting the download;
9. verifies SHA-256 again immediately before launching the installer;
10. asks the user before closing Pisi and starting the installer.

No GitHub access token is embedded in the application.

## Private source repository

`maggezer/Pisi` is private. A private GitHub Releases feed is therefore not
safe for desktop auto-update because clients would need a GitHub token.

Do not place `GH_TOKEN`, a personal access token, or repository credentials in
the packaged application.

Use a public binary-only endpoint instead. It can be a small public release
repository, object storage/CDN, or a static HTTPS site. Mirror these files from
the release job:

- `latest.json`
- `Pisi-<version>-Setup-x64.exe`
- `Pisi-<version>-Setup-arm64.exe`

Until `PISI_UPDATE_FEED_URL` exists, direct NSIS builds continue to work but
their updater stays disabled.

## Portable build

Portable Pisi intentionally does not self-update. It is marked as
`pisiDistribution=portable` during packaging and the updater refuses to run.

This avoids silently turning a portable installation into an installed NSIS
copy.

## Renderer/API surface

The preload exposes a bounded update bridge:

- `window.pisiUpdates.getStatus()`
- `window.pisiUpdates.check()`
- `window.pisiUpdates.install()`
- `window.pisiUpdates.onStatus(callback)`

This allows a future Settings/About UI to show update state without exposing
Node or arbitrary download/execute primitives to the renderer.
