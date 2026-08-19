#!/usr/bin/env bash
# Bootstrap Kortix self-host on a Linux server (VPS or home PC).
# Run this AFTER you SSH in from Termux.
set -euo pipefail

DOMAIN="${KORTIX_DOMAIN:-}"
EMAIL="${KORTIX_ADMIN_EMAIL:-admin@example.com}"
TUNNEL="${KORTIX_TUNNEL:-}"

log() { printf '\033[1m[kortix-setup]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[kortix-setup]\033[0m %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" = "0" ]; then
  die "Run as a normal user with sudo, not as root."
fi

command -v curl >/dev/null 2>&1 || die "curl is required."

log "Installing Kortix CLI..."
curl -fsSL https://kortix.com/install | bash

if ! command -v docker >/dev/null 2>&1; then
  log "Docker not found. Installing via official bootstrap script..."
  curl -fsSL https://raw.githubusercontent.com/kortix-ai/suna/main/scripts/kortix-selfhost-up.sh \
    | bash -s -- ${DOMAIN:+--domain "$DOMAIN"} ${EMAIL:+--email "$EMAIL"}
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  log "Adding current user to docker group..."
  sudo usermod -aG docker "$USER"
  die "Log out and SSH back in, then re-run this script."
fi

if [ -n "$DOMAIN" ]; then
  log "Initializing self-host with domain: $DOMAIN"
  kortix self-host init --domain "$DOMAIN" --yes --admin-email "$EMAIL"
elif [ "$TUNNEL" = "cloudflare" ]; then
  log "Initializing self-host with Cloudflare quick tunnel (good for testing)"
  kortix self-host init --tunnel cloudflare --yes --admin-email "$EMAIL"
else
  log "No domain set. Using Cloudflare quick tunnel for testing."
  log "For production later: export KORTIX_DOMAIN=your-domain.com"
  kortix self-host init --tunnel cloudflare --yes --admin-email "$EMAIL"
fi

log "Starting Kortix..."
kortix self-host start

log ""
log "Next steps:"
log "  1. kortix self-host configure"
log "  2. Add DAYTONA_API_KEY + GitHub token"
log "  3. kortix self-host start"
log "  4. Open dashboard: kortix self-host open"
log ""
log "From your phone (Termux), you can tunnel the dashboard with:"
log "  ssh -L 13737:127.0.0.1:13737 user@your-server"
