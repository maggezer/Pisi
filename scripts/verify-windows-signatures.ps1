param(
    [Parameter(Mandatory = $true)]
    [string[]]$Path
)

$ErrorActionPreference = 'Stop'

if (-not $Path -or $Path.Count -eq 0) {
    throw 'At least one Windows executable must be provided for signature verification.'
}

$verified = @()
$expectedThumbprint = $null
$codeSigningOid = '1.3.6.1.5.5.7.3.3'

foreach ($candidate in $Path) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Signed artifact not found: $candidate"
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $candidate

    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
        throw "Authenticode verification failed for $candidate. Status: $($signature.Status). Message: $($signature.StatusMessage)"
    }

    if (-not $signature.SignerCertificate) {
        throw "Signer certificate missing for $candidate."
    }

    $ekuExtension = $signature.SignerCertificate.Extensions |
        Where-Object { $_.Oid.Value -eq '2.5.29.37' } |
        Select-Object -First 1

    if (-not $ekuExtension) {
        throw "Enhanced Key Usage extension missing for $candidate."
    }

    $typedEku = [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]$ekuExtension
    $hasCodeSigningEku = $typedEku.EnhancedKeyUsages |
        Where-Object { $_.Value -eq $codeSigningOid } |
        Select-Object -First 1

    if (-not $hasCodeSigningEku) {
        throw "Signer certificate for $candidate does not advertise the Code Signing EKU."
    }

    if (-not $signature.TimeStamperCertificate) {
        throw "RFC3161/Authenticode timestamp missing for $candidate."
    }

    $thumbprint = $signature.SignerCertificate.Thumbprint.ToUpperInvariant()

    if ($expectedThumbprint -and $thumbprint -ne $expectedThumbprint) {
        throw "Release artifacts were signed by different certificates. Expected $expectedThumbprint but found $thumbprint for $candidate."
    }

    $expectedThumbprint = $thumbprint

    $verified += [pscustomobject]@{
        File = [System.IO.Path]::GetFileName($candidate)
        Status = $signature.Status
        Subject = $signature.SignerCertificate.Subject
        Thumbprint = $thumbprint
        CertificateExpires = $signature.SignerCertificate.NotAfter.ToUniversalTime().ToString('o')
        TimestampSubject = $signature.TimeStamperCertificate.Subject
    }
}

$verified | Format-Table -AutoSize
Write-Host "Verified $($verified.Count) signed Windows release artifacts."
