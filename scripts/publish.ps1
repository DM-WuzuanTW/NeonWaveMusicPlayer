$ErrorActionPreference = "Stop"

# Release flow: bump version, push a tag, and let GitHub Actions build and
# publish the Windows / macOS / Linux installers (.github/workflows/release.yml).
# No local build is required anymore.

# 1. Bump patch version
$version = node scripts/increment_version.cjs
if (-not $version) {
    Write-Host "Version bump failed." -ForegroundColor Red
    exit 1
}

Write-Host "Releasing NeonWave v$version..." -ForegroundColor Cyan

# 2. Commit and push
git add package.json
try {
    git commit -m "chore: release v$version"
}
catch {
    Write-Host "   Nothing to commit." -ForegroundColor Gray
}
git push origin main

# 3. Tag and push (this triggers the Release workflow)
if ($(git tag -l "v$version")) {
    Write-Host "Tag v$version already exists. Skipping tag creation." -ForegroundColor Yellow
}
else {
    git tag "v$version"
}
git push origin "v$version"

Write-Host ""
Write-Host "Tag v$version pushed. GitHub Actions is now building Windows/macOS/Linux." -ForegroundColor Green
Write-Host "Progress: https://github.com/wu-zuan/NeonWaveMusicPlayer/actions" -ForegroundColor Cyan
Write-Host "Release:  https://github.com/wu-zuan/NeonWaveMusicPlayer/releases/tag/v$version" -ForegroundColor Cyan
