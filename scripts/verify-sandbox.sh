#!/usr/bin/env bash
# Prove the sandbox is a session, not a one-shot.
#
# Call 1 writes a file and returns a sandboxId. Call 2 passes that id back and
# reads the file. If call 2 finds it, state survives between tool calls — which
# is the difference between a coding worker that can clone → install → test and
# one that starts from an empty machine every time.
#
# Reads VITE_SUPABASE_URL and the publishable key from .env. Never prints the key.
#
# Usage: scripts/verify-sandbox.sh

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE — copy .env.example and fill it in" >&2; exit 1; }

get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'\r'; }

URL="$(get VITE_SUPABASE_URL)"
KEY="$(get VITE_SUPABASE_KEY)"
[ -n "$KEY" ] || KEY="$(get VITE_SUPABASE_PUBLISHABLE_KEY)"
[ -n "$URL" ] || { echo "VITE_SUPABASE_URL missing from $ENV_FILE" >&2; exit 1; }
[ -n "$KEY" ] || { echo "no publishable/anon key in $ENV_FILE" >&2; exit 1; }

FN="$URL/functions/v1/agent-tools"
MARKER="openmind-session-check-$$"

call() {
  curl -s -X POST "$FN" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "$1" \
    --max-time 90
}

echo "== Call 1 — write a file, get a sandbox =="
REQ1=$(printf '{"tool":"workspace_write_file","input":{"path":"session-check.txt","content":"%s"}}' "$MARKER")
RES1="$(call "$REQ1")"
echo "$RES1"

if grep -q '\[MOCK' <<<"$RES1"; then
  echo
  echo "Sandbox is mocked. Set the key, then retry:  npx supabase secrets set E2B_API_KEY=..." >&2
  exit 1
fi

SANDBOX="$(sed -n 's/.*"sandboxId":"\([^"]*\)".*/\1/p' <<<"$RES1")"
if [ -z "$SANDBOX" ]; then
  echo
  echo "No sandboxId came back — the deployed function is the old build." >&2
  echo "Run: npx supabase functions deploy agent-tools" >&2
  exit 1
fi
echo "sandbox: $SANDBOX"

echo
echo "== Call 2 — same sandbox, read the file back =="
REQ2=$(printf '{"tool":"workspace_read_file","input":{"path":"session-check.txt"},"sandboxId":"%s"}' "$SANDBOX")
RES2="$(call "$REQ2")"
echo "$RES2"

echo
if grep -q "$MARKER" <<<"$RES2"; then
  echo "PASS — the file survived between calls. The sandbox is a session."
else
  echo "FAIL — call 2 could not see call 1's file." >&2
  echo "Either the sandbox was recreated between calls (check E2B expiry/quota)" >&2
  echo "or sandboxId is not being threaded through. Compare the two ids above." >&2
  exit 1
fi
