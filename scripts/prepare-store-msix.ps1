param(
    [Parameter(Mandatory = $true)]
    [string]$X64Layout,

    [Parameter(Mandatory = $true)]
    [string]$Arm64Layout,

    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,

    [Parameter(Mandatory = $true)]
    [string]$IdentityName,

    [Parameter(Mandatory = $true)]
    [string]$Publisher,

    [Parameter(Mandatory = $true)]
    [string]$PublisherDisplayName
)

$ErrorActionPreference = 'Stop'

function Escape-Xml([string]$Value) {
    return [System.Security.SecurityElement]::Escape($Value)
}

function Write-ScaledPng {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination,

        [Parameter(Mandatory = $true)]
        [int]$Width,

        [Parameter(Mandatory = $true)]
        [int]$Height
    )

    $sourceImage = [System.Drawing.Image]::FromFile($Source)
    try {
        $bitmap = New-Object System.Drawing.Bitmap($Width, $Height)
        try {
            $bitmap.SetResolution(96, 96)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

                $sourceRatio = $sourceImage.Width / $sourceImage.Height
                $targetRatio = $Width / $Height

                if ($sourceRatio -gt $targetRatio) {
                    $drawWidth = $Width
                    $drawHeight = [int][Math]::Round($Width / $sourceRatio)
                    $drawX = 0
                    $drawY = [int][Math]::Round(($Height - $drawHeight) / 2)
                }
                else {
                    $drawHeight = $Height
                    $drawWidth = [int][Math]::Round($Height * $sourceRatio)
                    $drawY = 0
                    $drawX = [int][Math]::Round(($Width - $drawWidth) / 2)
                }

                $graphics.DrawImage($sourceImage, $drawX, $drawY, $drawWidth, $drawHeight)
            }
            finally {
                $graphics.Dispose()
            }

            $directory = Split-Path -Parent $Destination
            New-Item -ItemType Directory -Force $directory | Out-Null
            $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
        }
        finally {
            $bitmap.Dispose()
        }
    }
    finally {
        $sourceImage.Dispose()
    }
}

foreach ($layout in @($X64Layout, $Arm64Layout)) {
    if (-not (Test-Path -LiteralPath $layout -PathType Container)) {
        throw "Store layout not found: $layout"
    }

    if (-not (Test-Path -LiteralPath (Join-Path $layout 'Pisi.exe') -PathType Leaf)) {
        throw "Pisi.exe not found in Store layout: $layout"
    }
}

if ([string]::IsNullOrWhiteSpace($IdentityName)) {
    throw 'Microsoft Store Identity Name is required.'
}
if ([string]::IsNullOrWhiteSpace($Publisher)) {
    throw 'Microsoft Store Publisher is required.'
}
if ([string]::IsNullOrWhiteSpace($PublisherDisplayName)) {
    throw 'Microsoft Store Publisher Display Name is required.'
}

$package = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\package.json') | ConvertFrom-Json
$semver = [string]$package.version
$baseVersion = ($semver -split '-', 2)[0]
$parts = @($baseVersion -split '\.')

if ($parts.Count -gt 4) {
    throw "package.json version cannot be converted to an MSIX version: $semver"
}

$numericParts = @()
foreach ($part in $parts) {
    $value = 0
    if (-not [int]::TryParse($part, [ref]$value) -or $value -lt 0 -or $value -gt 65535) {
        throw "Invalid MSIX version component '$part' in package.json version '$semver'."
    }
    $numericParts += $value
}

while ($numericParts.Count -lt 4) {
    $numericParts += 0
}

$msixVersion = ($numericParts -join '.')
$manifestDirectory = Split-Path -Parent $ManifestPath
New-Item -ItemType Directory -Force $manifestDirectory | Out-Null

Add-Type -AssemblyName System.Drawing

$sourceLogo = Join-Path $PSScriptRoot '..\assets\pisi.png'
if (-not (Test-Path -LiteralPath $sourceLogo -PathType Leaf)) {
    throw "Pisi source logo not found: $sourceLogo"
}

$assetSpecs = @(
    @{ Name = 'StoreLogo.png'; Width = 50; Height = 50 },
    @{ Name = 'Square44x44Logo.png'; Width = 44; Height = 44 },
    @{ Name = 'Square150x150Logo.png'; Width = 150; Height = 150 },
    @{ Name = 'Wide310x150Logo.png'; Width = 310; Height = 150 }
)

foreach ($layout in @($X64Layout, $Arm64Layout)) {
    $assetDirectory = Join-Path $layout 'Assets'
    New-Item -ItemType Directory -Force $assetDirectory | Out-Null

    foreach ($spec in $assetSpecs) {
        Write-ScaledPng `
            -Source $sourceLogo `
            -Destination (Join-Path $assetDirectory $spec.Name) `
            -Width $spec.Width `
            -Height $spec.Height
    }
}

$identityXml = Escape-Xml $IdentityName
$publisherXml = Escape-Xml $Publisher
$publisherDisplayXml = Escape-Xml $PublisherDisplayName

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  <Identity
    Name="$identityXml"
    Publisher="$publisherXml"
    Version="$msixVersion"
    ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Pisi</DisplayName>
    <PublisherDisplayName>$publisherDisplayXml</PublisherDisplayName>
    <Description>Pisi desktop knowledge mapping app</Description>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="en-US" />
    <Resource Language="tr-TR" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily
      Name="Windows.Desktop"
      MinVersion="10.0.17763.0"
      MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Applications>
    <Application
      Id="Pisi"
      Executable="Pisi.exe"
      EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Pisi"
        Description="Pisi desktop knowledge mapping app"
        BackgroundColor="transparent"
        Square44x44Logo="Assets\Square44x44Logo.png"
        Square150x150Logo="Assets\Square150x150Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@

Set-Content -LiteralPath $ManifestPath -Value $manifest -Encoding utf8NoBOM

Write-Host "Prepared Microsoft Store MSIX manifest: $ManifestPath"
Write-Host "MSIX version: $msixVersion"
Write-Host "Store identity: $IdentityName"
