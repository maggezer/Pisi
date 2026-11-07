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
8. verifies the Ed25519 signature of `latest.json` (`latest.json.sig`) with a
   public key built into the app, and rejects the update if it is missing,
   malformed, made with an unknown key or does not match;
9. verifies SHA-256 before accepting the download;
10. verifies SHA-256 again immediately before launching the installer;
11. when the build has a Windows signing identity, checks that the installer's
    Authenticode signature is valid and that its publisher is the expected name
    (otherwise the check is skipped and logged);
12. asks the user before closing Pisi and starting the installer.

A build with a feed but without a public key never updates
(`direct-unsigned` mode): an unsigned manifest could point the updater at any
installer.

## Update manifest signing

`latest.json` names the installer and its SHA-256, so whoever controls the feed
controls what runs. The release workflow therefore signs the manifest's exact
bytes with Ed25519 and publishes `latest.json.sig` next to it:

```json
{ "keyId": "3f2a9c0d1e4b5a67", "signature": "<base64>" }
```

`keyId` is the first 16 hex characters of SHA-256 over the public key (SPKI
DER). The app trusts every key in its built-in list, so the signing key can be
rotated without breaking installed copies.

### Create a signing key (once, on a trusted machine)

```bash
openssl genpkey -algorithm ed25519 -out pisi-update-signing.pem
```

```bash
node scripts/sign-update-manifest.mjs --public-key pisi-update-signing.pem
```

The second command prints the public key as one base64 line (and its key id).
Keep `pisi-update-signing.pem` offline (a password manager or hardware-backed
vault). Never commit it.

### Add it to GitHub

1. Repository → Settings → Secrets and variables → Actions → **Secrets** →
   New repository secret `PISI_UPDATE_SIGNING_KEY`: paste the whole content of
   `pisi-update-signing.pem` (including the `BEGIN`/`END` lines).
2. **Variables** → New repository variable `PISI_UPDATE_PUBLIC_KEYS`: the
   base64 public key line. Several keys are separated by commas.
3. Optional, with Windows code signing: variable `PISI_WINDOWS_PUBLISHER_NAME`
   with the certificate's subject common name (CN), for example `Pisi Ltd`.

When `PISI_UPDATE_FEED_URL` is set, the release fails if the public keys or the
signing secret are missing, and `scripts/sign-update-manifest.mjs` verifies the
new signature against `PISI_UPDATE_PUBLIC_KEYS` before anything is published.

### Rotate the key

1. Create the new key and add its public key to `PISI_UPDATE_PUBLIC_KEYS`
   (`old,new`), still signing with the old secret. Release once, so installed
   copies learn the new key.
2. Replace the `PISI_UPDATE_SIGNING_KEY` secret with the new private key and
   release.
3. After users have updated, remove the old public key from the list.

If the private key leaks, publish a release signed with a fresh key that is
already trusted (step 1 ahead of time), then remove the leaked key from the list.

### Installer publisher check

With `PISI_WINDOWS_PUBLISHER_NAME` and a code-signing identity, the build stores
the expected publisher. Before launching a downloaded installer the app runs
`Get-AuthenticodeSignature` (PowerShell, the file path passed through an
environment variable) and requires `Status = Valid` and a signer certificate
whose CN equals that name. Builds without a signing identity skip the check and
log `Authenticode check skipped`.

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
