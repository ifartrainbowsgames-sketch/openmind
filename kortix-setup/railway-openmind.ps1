# Deploy OpenMind to Railway (uses your Supabase + works without Daytona/E2B).
#
# Prerequisites:
#   npm i -g @railway/cli   OR   iwr https://railway.app/install.ps1 | iex
#   railway login
#
# Usage (from repo root):
#   cd kortix-setup
#   .\railway-openmind.ps1
$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
$EnvFile = if ($env:ENV_FILE) { $env:ENV_FILE } else { Join-Path $PSScriptRoot ".env" }
$RootEnv = Join-Path $Root ".env"

function Log($msg) { Write-Host "[railway-openmind] $msg" -ForegroundColor Cyan }
function Die($msg) { Write-Host "[railway-openmind] $msg" -ForegroundColor Red; exit 1 }

if (-not (Get-Command railway -ErrorAction SilentlyContinue)) {
    Die "Railway CLI missing. Install: iwr https://railway.app/install.ps1 | iex"
}

if (-not (Test-Path $EnvFile) -and (Test-Path $RootEnv)) {
    $EnvFile = $RootEnv
    Log "Using root .env: $RootEnv"
}

if (-not (Test-Path $EnvFile)) {
    Die "Missing .env — copy .env.example to repo root or kortix-setup/.env"
}

Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        Set-Item -Path "env:$($matches[1])" -Value $matches[2]
    }
}

# Map kortix-setup .env names → Vite build args
if (-not $env:VITE_SUPABASE_URL -and $env:SUPABASE_URL) { $env:VITE_SUPABASE_URL = $env:SUPABASE_URL }
if (-not $env:VITE_SUPABASE_KEY -and $env:VITE_SUPABASE_PUBLISHABLE_KEY) { $env:VITE_SUPABASE_KEY = $env:VITE_SUPABASE_PUBLISHABLE_KEY }
if (-not $env:VITE_SUPABASE_KEY -and $env:SUPABASE_ANON_KEY) { $env:VITE_SUPABASE_KEY = $env:SUPABASE_ANON_KEY }
if (-not $env:VITE_SUPABASE_KEY -and $env:NEXT_PUBLIC_SUPABASE_ANON_KEY) { $env:VITE_SUPABASE_KEY = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY }

if (-not $env:VITE_SUPABASE_URL) { Die "Set VITE_SUPABASE_URL or SUPABASE_URL in .env" }
if (-not $env:VITE_SUPABASE_KEY) { Die "Set VITE_SUPABASE_KEY or SUPABASE_ANON_KEY in .env" }

railway whoami 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Die "Not logged in. Run: railway login" }

Set-Location $Root
Log "Linking Railway project..."
$ProjectId = "1af3412c-53ac-48ef-a928-aa7c69a6f80f"
railway link --project $ProjectId 2>$null

$services = railway service list --json 2>$null | ConvertFrom-Json
if (-not $services -or $services.Count -eq 0) {
    Log "Creating openmind service..."
    railway add --service openmind --variables "VITE_SUPABASE_URL=$($env:VITE_SUPABASE_URL)" --variables "VITE_SUPABASE_KEY=$($env:VITE_SUPABASE_KEY)" --json | Out-Null
}
railway service link openmind 2>$null

Log "Setting build variables..."
railway variables set "VITE_SUPABASE_URL=$($env:VITE_SUPABASE_URL)" "VITE_SUPABASE_KEY=$($env:VITE_SUPABASE_KEY)" 2>$null

Log "Deploying..."
railway up --detach -y --service openmind

Log "Generating public URL (port 8080)..."
railway domain --service openmind --port 8080 2>$null

Log ""
Log "Done. Open dashboard:"
Log "  railway open"
Log ""
Log "Your mobile app: https://YOUR-APP.up.railway.app/app"
