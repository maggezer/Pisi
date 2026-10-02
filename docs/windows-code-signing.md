# Windows code signing

Pisi uses two separate Windows distribution paths:

- GitHub beta Setup/Portable executables can be unsigned.
- Microsoft Store packages are uploaded unsigned and are signed by Microsoft during Store publishing.

Authenticode signing for direct EXE distribution remains supported, but it is
optional until Pisi has its own public code-signing identity.

## Optional direct EXE signing

The GitHub release workflow detects either of these signing modes:

### electron-builder certificate input

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

### Windows certificate store / HSM provider

- `PISI_WINDOWS_CERT_SHA1`

Do not configure both modes at the same time.

When a signing identity is present, the release workflow enables
`forceCodeSigning`, signs Setup and Portable artifacts with SHA-256 and an
RFC3161 timestamp, and verifies every final executable before publishing.

When no signing identity is present, the GitHub beta release is intentionally
published unsigned and a warning is written to the GitHub Actions job summary.

## Microsoft Store packages

The Store pipeline is separate from direct EXE signing. It produces an unsigned
x64 + ARM64 MSIX bundle and a Store upload archive. Partner Center signs the
package during Store publishing, so the Store path does not require a Pisi
code-signing certificate.

See `docs/microsoft-store.md` for the required Partner Center variables,
credentials, package build, and optional publishing flow.

## SmartScreen

Unsigned GitHub beta EXE files can trigger Microsoft Defender SmartScreen or
show an unknown publisher. This is accepted for the beta/direct-download
channel.

The Microsoft Store distribution channel uses Microsoft's Store signing and
installation flow.

If direct web/GitHub distribution becomes a primary end-user channel later,
configure one of the optional Authenticode modes above and keep the same
publisher identity across releases.
