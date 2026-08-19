#!/usr/bin/env bash
# Deploy Kortix self-host with E2B sandboxes + free Cloudflare quick tunnel.
#
# Run on a Linux machine with Docker (laptop, VPS, home PC).
#
# Usage:
#   cd kortix-setup
#   cp .env.example .env   # add E2B_API_KEY (+ optional LLM keys)
#   ./e2b-deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
EMAIL="${KORTIX_ADMIN_EMAIL:-admin@example.com}"
TUNNEL_WAIT_SECS="${TUNNEL_WAIT_SECS:-120}"

log() { printf '\033[1m[e2b]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[e2b]\033[0m %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required."
[[ "$(id -u)" != "0" ]] || die "Run as a normal user with sudo, not as root."
[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE — copy .env.example and set E2B_API_KEY."

set -a; source "$ENV_FILE"; set +a
[[ -n "${E2B_API_KEY:-}" ]] || die "E2B_API_KEY missing. Get one: https://e2b.dev/dashboard?tab=keys"

if ! command -v kortix >/dev/null 2>&1; then
  log "Installing Kortix CLI..."
  curl -fsSL https://kortix.com/install | bash
fi

if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi

if ! docker info >/dev/null 2>&1; then
  log "Adding $USER to docker group..."
  sudo usermod -aG docker "$USER"
  die "Log out and back in (or: newgrp docker), then re-run ./e2b-deploy.sh"
fi

log "Checking E2B key..."
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "X-API-Key: $E2B_API_KEY" https://api.e2b.dev/health || true)"
[[ "$HTTP_CODE" == "200" ]] || die "E2B key check failed (HTTP $HTTP_CODE). Verify key at https://e2b.dev/dashboard?tab=keys"

log "Initializing Kortix (Cloudflare quick tunnel — free, no account)..."
kortix self-host init --tunnel cloudflare --yes --admin-email "$EMAIL"

log "Configuring E2B sandbox provider..."
ENV_ARGS=(ALLOWED_SANDBOX_PROVIDERS=e2b "E2B_API_KEY=$E2B_API_KEY")
[[ -n "${OPENAI_API_KEY:-}" ]] && ENV_ARGS+=("OPENAI_API_KEY=$OPENAI_API_KEY")
[[ -n "${ANTHROPIC_API_KEY:-}" ]] && ENV_ARGS+=("ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY")
[[ -n "${OPENROUTER_API_KEY:-}" ]] && ENV_ARGS+=("OPENROUTER_API_KEY=$OPENROUTER_API_KEY")
kortix self-host env set "${ENV_ARGS[@]}"

log "Starting stack (first run downloads images — 5–15 min)..."
kortix self-host start

log "Waiting for public URL..."
PUBLIC_URL=""
for _ in $(seq 1 "$TUNNEL_WAIT_SECS"); do
  PUBLIC_URL="$(kortix self-host logs cloudflared 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
  [[ -n "$PUBLIC_URL" ]] && break
  sleep 1
done

log ""
log "════════════════════════════════════════════════════════"
if [[ -n "$PUBLIC_URL" ]]; then
  log "Open on phone or laptop:"
  log "  $PUBLIC_URL"
else
  log "Get URL when ready:"
  log "  kortix self-host logs cloudflared | grep trycloudflare"
fi
log ""
log "Local dashboard: http://localhost:13737"
log "════════════════════════════════════════════════════════"
log ""
log "Finish setup in the dashboard:"
log "  1. Create account"
log "  2. Settings → Git → connect GitHub"
log "  3. Add LLM keys if not already set from .env"
log ""
log "Commands: kortix self-host status | logs | stop"
