$ErrorActionPreference = "Stop"
$GradleVersion = "8.11.1"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Cache = Join-Path $env:USERPROFILE ".pisi-gradle"
$Zip = Join-Path $Cache "gradle-$GradleVersion-bin.zip"
$Home = Join-Path $Cache "gradle-$GradleVersion"
New-Item -ItemType Directory -Force -Path $Cache | Out-Null
if (-not (Test-Path $Home)) {
    if (-not (Test-Path $Zip)) { Invoke-WebRequest "https://services.gradle.org/distributions/gradle-$GradleVersion-bin.zip" -OutFile $Zip }
    Expand-Archive -Force $Zip $Cache
}
& (Join-Path $Home "bin\gradle.bat") -p $Root assembleDebug
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "APK: app\build\outputs\apk\debug\app-debug.apk"
