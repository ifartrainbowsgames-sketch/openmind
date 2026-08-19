#!/usr/bin/env bash
# One-shot Kortix self-host with Cloudflare quick tunnel + E2B sandboxes.
# Run on YOUR laptop or VPS (needs Docker). Not for this cloud agent VM.
#
# Usage:
#   cd kortix-setup
#   cp .env.example .env    # fill in E2B_API_KEY + other keys
#   ./cloudflare-deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
EMAIL="${KORTIX_ADMIN_EMAIL:-admin@example.com}"
TUNNEL_WAIT_SECS="${TUNNEL_WAIT_SECS:-90}"

log() { printf '\033[1m[cloudflare]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[cloudflare]\033[0m %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required."

if [ "$(id -u)" = "0" ]; then
  die "Run as a normal user with sudo, not as root."
fi

[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE — copy .env.example and add E2B_API_KEY."
set -a; source "$ENV_FILE"; set +a

[[ -n "${E2B_API_KEY:-}" ]] || die "E2B_API_KEY missing in .env — get one at https://e2b.dev/dashboard?tab=keys"

if ! command -v kortix >/dev/null 2>&1; then
  log "Installing Kortix CLI..."
  curl -fsSL https://kortix.com/install | bash
fi

if ! command -v docker >/dev/null 2>&1; then
  log "Docker not found — installing..."
  curl -fsSL https://get.docker.com | sh
fi

if ! docker info >/dev/null 2>&1; then
  log "Adding $USER to docker group..."
  sudo usermod -aG docker "$USER"
  die "Log out and back in (or run: newgrp docker), then re-run this script."
fi

log "Initializing Kortix with Cloudflare quick tunnel..."
kortix self-host init --tunnel cloudflare --yes --admin-email "$EMAIL"

log "Configuring E2B sandbox provider..."
kortix self-host env set \
  ALLOWED_SANDBOX_PROVIDERS=e2b \
  E2B_API_KEY="$E2B_API_KEY"

log "Starting stack (first run pulls images — may take several minutes)..."
kortix self-host start

log "Waiting for Cloudflare tunnel URL (up to ${TUNNEL_WAIT_SECS}s)..."
PUBLIC_URL=""
for _ in $(seq 1 "$TUNNEL_WAIT_SECS"); do
  PUBLIC_URL="$(kortix self-host logs cloudflared 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
  if [[ -n "$PUBLIC_URL" ]]; then
    break
  fi
  sleep 1
done

log ""
log "════════════════════════════════════════════════════════"
if [[ -n "$PUBLIC_URL" ]]; then
  log "Public URL (open on phone or laptop):"
  log "  $PUBLIC_URL"
  log ""
  log "Local dashboard (same machine):"
  log "  http://localhost:13737"
else
  log "Stack is starting. Get the tunnel URL with:"
  log "  kortix self-host logs cloudflared | grep trycloudflare"
  log ""
  log "Local dashboard:"
  log "  http://localhost:13737"
fi
log "════════════════════════════════════════════════════════"
log ""
log "Next steps:"
log "  1. Open the URL above → create your account"
log "  2. Settings → Git → connect GitHub (required for projects)"
log "  3. Add your LLM API keys in the dashboard (BYOK)"
log ""
log "Useful commands:"
log "  kortix self-host status"
log "  kortix self-host logs"
log "  kortix self-host stop"
