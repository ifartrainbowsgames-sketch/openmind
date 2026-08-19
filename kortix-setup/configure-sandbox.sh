#!/usr/bin/env bash
# Configure sandbox provider for official Kortix self-host (E2B or Platinum).
# Daytona is NOT supported here — use railway-deploy.sh for the community Railway stack.
#
# Usage:
#   export E2B_API_KEY=e2b_...
#   ./configure-sandbox.sh e2b
#
#   export PLATINUM_API_KEY=pt_live_...
#   ./configure-sandbox.sh platinum
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
PROVIDER="${1:-}"

log() { printf '\033[1m[sandbox]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[sandbox]\033[0m %s\n' "$*" >&2; exit 1; }

command -v kortix >/dev/null 2>&1 || die "Kortix CLI missing. Run: curl -fsSL https://kortix.com/install | bash"
[[ -f "$ENV_FILE" ]] && { set -a; source "$ENV_FILE"; set +a; }

case "$PROVIDER" in
  e2b)
    [[ -n "${E2B_API_KEY:-}" ]] || die "Set E2B_API_KEY in .env or environment. Get one at https://e2b.dev/dashboard?tab=keys"
    log "Configuring E2B sandbox provider..."
    kortix self-host env set \
      ALLOWED_SANDBOX_PROVIDERS=e2b \
      E2B_API_KEY="$E2B_API_KEY"
    ;;
  platinum)
    [[ -n "${PLATINUM_API_KEY:-}" ]] || die "Set PLATINUM_API_KEY. Run: npm i -g @platinum-dev/cli && pt login"
    log "Configuring Platinum sandbox provider..."
    kortix self-host env set \
      ALLOWED_SANDBOX_PROVIDERS=platinum \
      PLATINUM_API_KEY="$PLATINUM_API_KEY"
    ;;
  daytona)
    die "Daytona on official self-host: kortix self-host env set ALLOWED_SANDBOX_PROVIDERS=daytona DAYTONA_API_KEY=... DAYTONA_SERVER_URL=https://app.daytona.io/api DAYTONA_TARGET=us"
    ;;
  *)
    die "Usage: $0 {e2b|platinum}\n\n  e2b       — free \$100 credits, no CC (https://e2b.dev)\n  platinum  — Kortix microVM sandboxes (https://platinum.dev)"
    ;;
esac

log "Restarting API to apply sandbox config..."
kortix self-host start

log ""
log "Sandbox provider set to: $PROVIDER"
log "Next: kortix self-host configure  (add GitHub token + LLM keys if not done)"
log "      kortix self-host open"
