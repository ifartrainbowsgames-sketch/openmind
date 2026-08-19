#!/usr/bin/env bash
# Deploy Suna/Kortix to Railway from your laptop.
#
# Prerequisites (one-time):
#   1. curl -fsSL https://railway.app/install.sh | sh
#   2. railway login
#   3. cp .env.example .env  &&  fill in your keys
#   4. Run Supabase migrations (see README below)
#
# Usage:
#   cd kortix-setup
#   cp .env.example .env   # fill in values
#   ./railway-deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
TEMPLATE="${RAILWAY_TEMPLATE:-kortix-suna-ai}"

log() { printf '\033[1m[suna-railway]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[suna-railway]\033[0m %s\n' "$*" >&2; exit 1; }

command -v railway >/dev/null 2>&1 || die "Railway CLI missing. Install: curl -fsSL https://railway.app/install.sh | sh"
[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE — copy .env.example to .env and fill in your keys."

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

require() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "Missing required env var: $name (set it in .env)"
}

log "Checking required secrets..."
require SUPABASE_URL
require SUPABASE_ANON_KEY
require SUPABASE_SERVICE_ROLE_KEY
require OPENAI_API_KEY
require ANTHROPIC_API_KEY
require TAVILY_API_KEY
require FIRECRAWL_API_KEY
require DAYTONA_API_KEY
require QSTASH_TOKEN
require QSTASH_CURRENT_SIGNING_KEY
require QSTASH_NEXT_SIGNING_KEY

: "${QSTASH_URL:=https://qstash.upstash.io}"
: "${FIRECRAWL_URL:=https://api.firecrawl.dev}"
: "${ENV_MODE:=production}"
: "${NEXT_PUBLIC_SUPABASE_URL:=$SUPABASE_URL}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:=$SUPABASE_ANON_KEY}"

if ! railway whoami >/dev/null 2>&1; then
  die "Not logged in. Run: railway login"
fi

log "Creating Railway project..."
railway init --name suna-kortix 2>/dev/null || true

log "Deploying template: $TEMPLATE"
railway deploy -t "$TEMPLATE" \
  -v "suna-backend.SUPABASE_URL=$SUPABASE_URL" \
  -v "suna-backend.SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY" \
  -v "suna-backend.SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY" \
  -v "suna-backend.OPENAI_API_KEY=$OPENAI_API_KEY" \
  -v "suna-backend.ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" \
  -v "suna-backend.TAVILY_API_KEY=$TAVILY_API_KEY" \
  -v "suna-backend.FIRECRAWL_API_KEY=$FIRECRAWL_API_KEY" \
  -v "suna-backend.FIRECRAWL_URL=$FIRECRAWL_URL" \
  -v "suna-backend.DAYTONA_API_KEY=$DAYTONA_API_KEY" \
  -v "suna-backend.QSTASH_URL=$QSTASH_URL" \
  -v "suna-backend.QSTASH_TOKEN=$QSTASH_TOKEN" \
  -v "suna-backend.QSTASH_CURRENT_SIGNING_KEY=$QSTASH_CURRENT_SIGNING_KEY" \
  -v "suna-backend.QSTASH_NEXT_SIGNING_KEY=$QSTASH_NEXT_SIGNING_KEY" \
  -v "suna-backend.ENV_MODE=$ENV_MODE" \
  ${OPENROUTER_API_KEY:+-v "suna-backend.OPENROUTER_API_KEY=$OPENROUTER_API_KEY"} \
  ${SMITHERY_API_KEY:+-v "suna-backend.SMITHERY_API_KEY=$SMITHERY_API_KEY"} \
  ${WEBHOOK_BASE_URL:+-v "suna-backend.WEBHOOK_BASE_URL=$WEBHOOK_BASE_URL"} \
  -v "suna-frontend.NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL" \
  -v "suna-frontend.NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY"

log ""
log "Deploy started. Next steps:"
log "  1. railway open          — open Railway dashboard"
log "  2. Copy backend public URL from Railway"
log "  3. Set WEBHOOK_BASE_URL in .env to that URL"
log "  4. Set frontend vars:"
log "       NEXT_PUBLIC_BACKEND_URL=https://YOUR-BACKEND.up.railway.app/api"
log "       NEXT_PUBLIC_URL=https://YOUR-FRONTEND.up.railway.app"
log "  5. Redeploy or update variables in Railway UI"
log ""
log "Supabase migrations (required once):"
log "  git clone https://github.com/iqbalexperience/suna-backend"
log "  cd suna-backend && supabase login && supabase link --project-ref YOUR_REF"
log "  supabase db push"
log "  Then expose 'basejump' schema in Supabase → Settings → API"
