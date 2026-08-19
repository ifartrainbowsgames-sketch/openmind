#!/usr/bin/env bash
# Push migrations and deploy Edge Functions to a Supabase project.
#
# Handles the one failure that reliably bites: a table created by hand in the
# dashboard SQL editor has no migration row, so `db push` replays the file and
# dies on CREATE POLICY — Postgres has no CREATE POLICY IF NOT EXISTS. When that
# happens the script marks the already-applied migration as applied and retries,
# rather than leaving you to work out what "policy already exists" meant.
#
# Secrets are NOT set here on purpose. Use:
#   npx supabase secrets set E2B_API_KEY=...
#
# Usage:
#   scripts/deploy-supabase.sh                      # link (if needed), push, deploy all
#   scripts/deploy-supabase.sh --migrations-only
#   scripts/deploy-supabase.sh --functions-only
#   scripts/deploy-supabase.sh --dry-run
#   PROJECT_REF=abc123 scripts/deploy-supabase.sh

set -euo pipefail

PROJECT_REF="${PROJECT_REF:-jvjxqrfzdhujtoenaejb}"
FUNCTIONS=(agent-tools mcp-proxy nango-session nango-act)

DO_MIGRATIONS=1
DO_FUNCTIONS=1
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --migrations-only) DO_FUNCTIONS=0 ;;
    --functions-only)  DO_MIGRATIONS=0 ;;
    --dry-run)         DRY_RUN=1 ;;
    -h|--help)         sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
warn() { printf '\033[33m!  %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓  %s\033[0m\n' "$*"; }

supa() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY RUN: npx supabase $*"
    return 0
  fi
  npx supabase "$@"
}

# ── preflight ────────────────────────────────────────────────────────────────

say "Preflight"
if ! npx supabase --version >/dev/null 2>&1; then
  echo "supabase CLI unavailable — run: npm i -D supabase" >&2
  exit 1
fi
ok "CLI $(npx supabase --version 2>/dev/null | tail -1)"

if [ ! -f supabase/.temp/project-ref ]; then
  warn "Project not linked. Linking to $PROJECT_REF (needs 'npx supabase login' first)."
  supa link --project-ref "$PROJECT_REF"
else
  ok "Linked to $(cat supabase/.temp/project-ref)"
fi

# ── migrations ───────────────────────────────────────────────────────────────

if [ "$DO_MIGRATIONS" = "1" ]; then
  say "Migrations"
  supa migration list || true

  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY RUN: npx supabase db push"
  elif npx supabase db push; then
    ok "Migrations applied"
  else
    warn "db push failed — checking for the already-exists case"

    # Only auto-repair when the DB genuinely already has the objects. Any other
    # failure (syntax, permissions, connectivity) must stay loud.
    push_log="$(npx supabase db push 2>&1 || true)"
    if grep -qiE 'already exists' <<<"$push_log"; then
      failed="$(grep -oE '[0-9]{14}' <<<"$push_log" | head -1)"
      if [ -n "$failed" ]; then
        warn "Migration $failed describes objects that already exist."
        warn "Marking it applied (this changes bookkeeping only — no schema change)."
        supa migration repair --status applied "$failed"
        npx supabase db push
        ok "Migrations applied after repair"
      else
        echo "Could not identify which migration to repair. Resolve by hand:" >&2
        echo "$push_log" >&2
        exit 1
      fi
    else
      echo "$push_log" >&2
      echo "db push failed for a reason this script will not guess at." >&2
      exit 1
    fi
  fi
fi

# ── functions ────────────────────────────────────────────────────────────────

if [ "$DO_FUNCTIONS" = "1" ]; then
  say "Edge Functions"
  for fn in "${FUNCTIONS[@]}"; do
    if [ ! -d "supabase/functions/$fn" ]; then
      warn "skipping $fn — no such directory"
      continue
    fi
    echo "deploying $fn…"
    supa functions deploy "$fn"
  done
  ok "Functions deployed"
fi

# ── what still needs a human ─────────────────────────────────────────────────

say "Next"
cat <<'EOF'
Secrets are not set by this script. The sandbox tools stay mocked until:

  npx supabase secrets set E2B_API_KEY=...

Optional: TAVILY_API_KEY, BROWSERLESS_API_KEY, SEARXNG_URL, NANGO_SECRET_KEY,
E2B_TEMPLATE (if the 'base' template lacks the runtime you need).

Verify the sandbox is a real session — the second call must see the first
call's file, which is the whole point of the change:

  scripts/verify-sandbox.sh
EOF
