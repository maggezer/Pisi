# Windows code signing

Pisi production Windows releases are required to be Authenticode-signed.

The release workflow intentionally fails when no signing identity is available,
and it verifies every Setup and Portable executable before publishing a GitHub
Release. Local development builds remain unsigned unless signing credentials
are explicitly provided.

## Supported release modes

### 1. electron-builder certificate input

The workflow understands the standard electron-builder environment variables:

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

Store both values as GitHub Actions repository or environment secrets.

`WIN_CSC_LINK` may be a supported certificate location accepted by
electron-builder. Never commit a certificate or its password to the repository.

This mode is mainly useful when you already have a signing credential that can
be supplied through electron-builder's standard certificate input.

### 2. Windows certificate store / HSM / cloud signing provider

For modern publicly trusted code-signing certificates, the private key normally
lives in a hardware or cloud HSM rather than an exportable PFX file.

A provider setup step must make the signing certificate/private-key provider
available to the Windows runner in `Cert:\CurrentUser\My`. Then add this
GitHub secret:

- `PISI_WINDOWS_CERT_SHA1` — the 40-character thumbprint of the code-signing
  certificate.

The release workflow passes that thumbprint to electron-builder's SignTool
configuration. This keeps the Pisi build provider-neutral: DigiCert KeyLocker,
SSL.com eSigner, another HSM service, or a controlled self-hosted Windows runner
can be used as long as the provider exposes the certificate to SignTool.

Do not set `WIN_CSC_LINK` and `PISI_WINDOWS_CERT_SHA1` at the same time.

## Release guarantees

A tagged release will fail before publication when:

- no signing identity is configured;
- both signing modes are configured at once;
- the requested certificate-store thumbprint is unavailable;
- electron-builder cannot code-sign the app;
- any final Setup or Portable executable has an invalid Authenticode signature;
- any release executable has no timestamp;
- release executables were signed by different certificates.

The Windows build uses SHA-256 signing and an RFC3161 timestamp.

## SmartScreen

Authenticode signing establishes publisher identity and protects binary
integrity, but a new publisher may still receive Microsoft Defender SmartScreen
warnings until reputation has been established. Keep the same trusted publisher
identity across releases; changing signing identity can reset or fragment that
reputation.

## Before the first public release

1. Obtain a publicly trusted Windows code-signing identity from a CA/signing
   service that supports your organization and preferred HSM/cloud workflow.
2. Add the provider setup to the `windows-release` job if it needs a client or
   GitHub Action to load the certificate into the Windows certificate store.
3. Configure exactly one signing mode described above.
4. Run a tagged beta release.
5. Confirm the release job reports all four artifacts as `Valid` before
   publication.
