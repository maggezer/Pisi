# Microsoft Store distribution

Pisi has a dedicated Microsoft Store packaging workflow:

`.github/workflows/store-msix.yml`

The workflow keeps the current stable electron-builder v26 packaging path for
the Electron application and uses Microsoft's Windows App Development CLI
(WinApp CLI) to create the final Store package.

## Why this path

electron-builder v26 supports the legacy AppX Store target, while Microsoft's
WinApp CLI can package an existing Electron output directly as modern MSIX.

Pisi therefore builds normal unpacked Electron layouts first and then packages
those layouts with WinApp CLI. No electron-builder major/beta upgrade is
required.

The Store output contains both supported Windows architectures:

- x64
- ARM64

The workflow creates:

- `Pisi-<version>-Store-x64-arm64.msixbundle`
- `Pisi-<version>-Store.msixupload`
- `SHA256SUMS.txt`

The MSIX bundle is deliberately unsigned. Microsoft Store signs the package
when Partner Center publishes it.

## One-time Partner Center setup

Before the Store workflow can build a valid Store package:

1. Create a Microsoft Partner Center developer account.
2. Create a new MSIX/PWA product.
3. Reserve the name `Pisi`.
4. Copy the package identity values supplied by Partner Center.

Configure these GitHub repository **Variables**:

- `PISI_STORE_IDENTITY_NAME`
- `PISI_STORE_PUBLISHER`
- `PISI_STORE_PUBLISHER_DISPLAY_NAME`
- `PISI_STORE_PRODUCT_ID`

The first three values are used to generate `Package.appxmanifest`.
They must match the values assigned to the Store product.

Until the three identity variables are configured, the Store packaging job is
skipped. Normal CI and GitHub beta releases are unaffected.

## Package-only operation

Every `v*.*.*` tag triggers the Store workflow.

When Store identity variables exist, the workflow:

1. validates the tag against `package.json`;
2. builds x64 and ARM64 unpacked Electron layouts;
3. generates Store visual assets from `assets/pisi.png`;
4. generates the Store manifest using the Partner Center identity;
5. creates one unsigned multi-architecture `.msixbundle`;
6. creates a `.msixupload` archive;
7. generates SHA-256 checksums;
8. uploads the files as a GitHub Actions artifact.

This does **not** automatically submit the package to Microsoft.

## Optional automatic Store publishing

Publishing is deliberately manual. Run the **Microsoft Store MSIX** workflow
from GitHub Actions and enable the `publish` input.

Automatic publishing additionally requires an Entra/Partner Center application
with the required Partner Center permissions.

Configure these GitHub **Secrets**:

- `PISI_STORE_TENANT_ID`
- `PISI_STORE_SELLER_ID`
- `PISI_STORE_CLIENT_ID`
- `PISI_STORE_CLIENT_SECRET`

The workflow uses Microsoft's Store Developer CLI to authenticate and publish
the generated `.msixupload` file to `PISI_STORE_PRODUCT_ID`.

Because `publish` defaults to false, a normal manual workflow run only builds
and validates the Store package. A Store submission happens only after a user
explicitly requests it.

## Versioning

Pisi's semantic version is converted to the four-part MSIX version format.

Example:

`0.11.0` becomes `0.11.0.0`.

Each numeric part must be in the MSIX-supported range 0-65535.

## Direct EXE releases

This Store flow does not remove the existing Setup or Portable builds.

GitHub beta releases still provide:

- Setup x64
- Setup ARM64
- Portable x64
- Portable ARM64

Authenticode signing for those direct-download executables is optional. If a
public signing identity is configured later, the release workflow automatically
uses and verifies it.
