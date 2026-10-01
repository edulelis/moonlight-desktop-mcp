# Install or update Moonlight Desktop MCP on Windows.
# Review this script before running it. Re-running it updates a clean checkout
# and preserves paired identities in LocalAppData.
[CmdletBinding()]
param(
  [string]$Ref = $(if ($env:MOONLIGHT_MCP_REF) { $env:MOONLIGHT_MCP_REF } else { "main" }),
  [string]$InstallDir = $(if ($env:MOONLIGHT_MCP_INSTALL_DIR) { $env:MOONLIGHT_MCP_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Moonlight Desktop MCP\\app" }),
  [switch]$SkipCodexConfiguration
)

$ErrorActionPreference = "Stop"
$Repository = if ($env:MOONLIGHT_MCP_REPOSITORY) { $env:MOONLIGHT_MCP_REPOSITORY } else { "https://github.com/edulelis/moonlight-desktop-mcp.git" }

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath;$env:Path"
}

function Ensure-WingetPackage([string]$Id, [string[]]$ExtraArguments = @()) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "WinGet is required to install missing dependencies. Install App Installer, then run this command again."
  }
  & winget install --id $Id --exact --source winget --accept-source-agreements --accept-package-agreements @ExtraArguments
  if ($LASTEXITCODE -ne 0) { throw "WinGet could not install $Id." }
}

function Invoke-Checked([string]$Label, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE." }
}

Refresh-ProcessPath
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Ensure-WingetPackage "Git.Git"; Refresh-ProcessPath }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Ensure-WingetPackage "OpenJS.NodeJS.LTS"; Refresh-ProcessPath }
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) { Ensure-WingetPackage "Kitware.CMake"; Refresh-ProcessPath }
$VsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\\Installer\\vswhere.exe"
$BuildToolsPresent = (Test-Path $VsWhere) -and ((& $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath) -ne $null)
if (-not $BuildToolsPresent) {
  Ensure-WingetPackage "Microsoft.VisualStudio.2022.BuildTools" @("--override", "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended")
}

$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) { throw "Node.js 20 or newer is required." }

$VcpkgRoot = if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { Join-Path $env:LOCALAPPDATA "vcpkg" }
if (-not (Test-Path (Join-Path $VcpkgRoot ".git"))) {
  if (Test-Path $VcpkgRoot) { throw "$VcpkgRoot exists but is not a vcpkg Git checkout. Set VCPKG_ROOT or move it aside." }
  New-Item -ItemType Directory -Force -Path (Split-Path $VcpkgRoot -Parent) | Out-Null
  Invoke-Checked "Cloning vcpkg" { & git clone https://github.com/microsoft/vcpkg.git $VcpkgRoot }
}
$Vcpkg = Join-Path $VcpkgRoot "vcpkg.exe"
if (-not (Test-Path $Vcpkg)) { Invoke-Checked "Bootstrapping vcpkg" { & (Join-Path $VcpkgRoot "bootstrap-vcpkg.bat") -disableMetrics } }
Invoke-Checked "Installing FFmpeg and OpenSSL with vcpkg" { & $Vcpkg install "ffmpeg[avcodec,swscale]" openssl --triplet x64-windows }
$env:CMAKE_TOOLCHAIN_FILE = Join-Path $VcpkgRoot "scripts\\buildsystems\\vcpkg.cmake"

if (Test-Path (Join-Path $InstallDir ".git")) {
  $dirty = & git -C $InstallDir status --porcelain
  if ($dirty) { throw "The existing checkout has local changes. Commit, stash, or choose MOONLIGHT_MCP_INSTALL_DIR before updating." }
  Invoke-Checked "Fetching the existing checkout" { & git -C $InstallDir fetch --tags origin }
  if ($Ref -eq "main") {
    Invoke-Checked "Checking out main" { & git -C $InstallDir checkout main }
    Invoke-Checked "Updating main" { & git -C $InstallDir pull --ff-only origin main }
  } else {
    Invoke-Checked "Checking out $Ref" { & git -C $InstallDir checkout --detach $Ref }
  }
} else {
  if (Test-Path $InstallDir) { throw "$InstallDir exists but is not a Git checkout. Choose MOONLIGHT_MCP_INSTALL_DIR or move it aside." }
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir -Parent) | Out-Null
  Invoke-Checked "Cloning Moonlight Desktop MCP" { & git clone $Repository $InstallDir }
  if ($Ref -eq "main") { Invoke-Checked "Checking out main" { & git -C $InstallDir checkout main } } else { Invoke-Checked "Checking out $Ref" { & git -C $InstallDir checkout --detach $Ref } }
}

Push-Location $InstallDir
try {
  Invoke-Checked "Installing Node dependencies" { & npm ci }
  Invoke-Checked "Preparing the Moonlight core" { & npm run setup:native }
  Invoke-Checked "Building the native bridge" { & npm run build:native }
  Invoke-Checked "Checking the installation" { & npm run doctor -- --strict }
} finally {
  Pop-Location
}

if (-not $SkipCodexConfiguration -and (Get-Command codex -ErrorAction SilentlyContinue)) {
  & codex mcp get moonlight-desktop *> $null
  if ($LASTEXITCODE -ne 0) {
    $node = (Get-Command node).Source
    $entry = Join-Path $InstallDir "src\\index.js"
    $data = if ($env:MOONLIGHT_MCP_DATA_DIR) { $env:MOONLIGHT_MCP_DATA_DIR } else { Join-Path $env:LOCALAPPDATA "Moonlight Desktop MCP" }
    & codex mcp add moonlight-desktop --env "MOONLIGHT_MCP_DATA_DIR=$data" -- $node $entry
  }
}

Write-Host ""
Write-Host "Moonlight Desktop MCP is ready at $InstallDir"
Write-Host "Re-run this command to update a clean checkout. Set MOONLIGHT_MCP_REF to install a specific tag or commit."
