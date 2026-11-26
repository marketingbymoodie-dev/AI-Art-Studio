# One-way theme copy: pull the published Petposterous theme, then push it
# only to petstage.myshopify.com. The live store is never a push target.
$ErrorActionPreference = "Stop"

$Live = "h7epay-gh.myshopify.com"
$Dest = "petstage.myshopify.com"
if ($Dest -ne "petstage.myshopify.com" -or $Live -ne "h7epay-gh.myshopify.com" -or $Dest -eq $Live) {
  throw "Refusing to run. Pull is the live store and push is Pet Stage only."
}

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Theme = Join-Path $Root "tmp\petstage-theme"
$StatePath = Join-Path $Root "tmp\petstage-theme.state.json"
New-Item -ItemType Directory -Force -Path (Join-Path $Root "tmp") | Out-Null
New-Item -ItemType Directory -Force -Path $Theme | Out-Null

Write-Host "Pulling the published theme from $Live. This does not change that store."
$previous = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& npx shopify theme pull --store $Live --live --path $Theme --nodelete
$pullCode = $LASTEXITCODE
$ErrorActionPreference = $previous
if ($pullCode -ne 0) { throw "Theme pull failed. Nothing was pushed." }

$ShopifyDir = Join-Path $Theme ".shopify"
if (Test-Path $ShopifyDir) { Remove-Item -Recurse -Force $ShopifyDir }

& node (Join-Path $Root "scripts\sanitize-petstage-theme.mjs") $Theme
if ($LASTEXITCODE -ne 0) { throw "Theme sanitize failed. Nothing was pushed." }

$ThemeId = ""
if (Test-Path $StatePath) {
  $state = Get-Content $StatePath -Raw | ConvertFrom-Json
  if ($state.themeId) { $ThemeId = [string]$state.themeId }
}
if ($ThemeId -and $ThemeId -notmatch "^\d+$") { throw "Saved theme id is not numeric." }

$PushLog = Join-Path $Root "tmp\petstage-theme-push.json"
if (Test-Path $PushLog) { Remove-Item -Force $PushLog }
$ThemeName = "PetStage-mirror"

$previous = $ErrorActionPreference
$ErrorActionPreference = "Continue"
if (-not $ThemeId) {
  Write-Host "Pushing a new unpublished theme named $ThemeName to $Dest."
  & cmd /c "npx shopify theme push --store $Dest --unpublished --json --path `"$Theme`" --theme $ThemeName > `"$PushLog`" 2>&1"
} else {
  Write-Host "Updating Pet Stage theme $ThemeId."
  & cmd /c "npx shopify theme push --store $Dest --theme $ThemeId --allow-live --json --path `"$Theme`" > `"$PushLog`" 2>&1"
}
$pushCode = $LASTEXITCODE
$ErrorActionPreference = $previous
if ($pushCode -ne 0) { throw "Theme push to Pet Stage failed." }

$pushText = Get-Content $PushLog -Raw
if ($pushText -match "h7epay") { throw "Push output mentioned the live store. Stopped before publish." }
$ThemeId = (& node (Join-Path $Root "scripts\sanitize-petstage-theme.mjs") --theme-id $PushLog | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $ThemeId -notmatch "^\d+$") { throw "Theme push did not confirm a Pet Stage theme id. Stopped before publish." }

$published = $false
if (-not $state -or -not $state.published) {
  Write-Host "Publishing theme $ThemeId on $Dest only."
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & npx shopify theme publish --store $Dest --theme $ThemeId --force
  $publishCode = $LASTEXITCODE
  $ErrorActionPreference = $previous
  if ($publishCode -ne 0) { throw "Pet Stage publish failed. The theme was uploaded but not published." }
  $published = $true
} else {
  $published = $true
}

@{ themeId = $ThemeId; shop = $Dest; published = $published } | ConvertTo-Json | Set-Content -Path $StatePath
Write-Host "Pet Stage theme $ThemeId is ready. The live store was not changed."
