# Kortix / Suna deploy options

Daytona often blocks signup ("use your primary or work email"). You still have three working paths.

## Quick pick

| Path | Sandbox | Best for |
|------|---------|----------|
| **A. Kortix Cloud** | Included | Fastest — no infra, works on phone |
| **B. Official self-host + E2B** | [E2B](https://e2b.dev) | Self-host without Daytona |
| **C. Railway template** | Daytona only | Only if you can get a Daytona key |

---

## A. Kortix Cloud (recommended if Daytona fails)

1. Sign up at [kortix.com](https://kortix.com)
2. Create a project and run agents from the web UI or mobile browser
3. Optional: point the OpenMind `/app` shell at your Kortix API key

No Railway, Supabase migrations, or sandbox provider setup required.

---

## B. Official self-host + E2B (Daytona replacement)

The **official** Kortix stack supports `daytona`, `e2b`, and `platinum`. E2B is the easiest alternative:

- Free hobby tier: **$100 one-time credits**, no credit card
- Signup: [e2b.dev/dashboard?tab=keys](https://e2b.dev/dashboard?tab=keys)
- Copy your `E2B_API_KEY` (starts with `e2b_`)

### Cloudflare tunnel (no domain — good for testing)

One command on a Linux box with Docker (laptop, VPS, home PC):

```bash
cd kortix-setup
# .env must contain E2B_API_KEY (and optionally other keys for reference)
./cloudflare-deploy.sh
```

This installs Kortix, starts the stack, and prints a `https://….trycloudflare.com` URL you can open on your phone.

**Note:** The tunnel URL changes every time you stop/start the stack. For a stable URL, use a VPS + domain later.

### On a VPS with a domain (production)

```bash
# 1. Bootstrap Kortix (Docker + CLI + stack)
export KORTIX_DOMAIN=agents.yourdomain.com   # or omit for Cloudflare tunnel testing
./termux-ssh-bootstrap.sh

# 2. Add E2B instead of Daytona
export E2B_API_KEY=e2b_...
./configure-sandbox.sh e2b

# 3. Finish setup (GitHub token, LLM keys) and open dashboard
kortix self-host configure
kortix self-host open
```

### Platinum (Kortix's own sandbox)

If E2B also fails, try [Platinum](https://www.platinum.dev):

```bash
npm i -g @platinum-dev/cli
pt login    # opens browser, creates pt_live_... key
export PLATINUM_API_KEY=pt_live_...
./configure-sandbox.sh platinum
```

---

## C. Railway one-click (Daytona required)

The Railway template `kortix-suna-ai` deploys the **community** backend (`iqbalexperience/suna-backend`), which is **Daytona-only** — it does not support E2B or Platinum.

If you cannot get a Daytona account, **do not use this path**. Use A or B instead.

If you do have Daytona:

```bash
cp .env.example .env   # fill in all keys including DAYTONA_API_KEY
railway login          # on your laptop (browser auth)
./railway-deploy.sh
```

Then run Supabase migrations from your laptop:

```bash
git clone https://github.com/iqbalexperience/suna-backend
cd suna-backend
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Expose the `basejump` schema in Supabase → Settings → API.

---

## Secrets checklist

Already in your local `.env` (gitignored):

- Supabase URL + anon + service_role
- OpenAI, Anthropic, Tavily, Firecrawl
- QStash (EU) token + signing keys

Still needed (pick one sandbox path):

- **E2B:** `E2B_API_KEY` → use `./configure-sandbox.sh e2b`
- **Platinum:** `PLATINUM_API_KEY` → use `./configure-sandbox.sh platinum`
- **Daytona:** `DAYTONA_API_KEY` → only for `./railway-deploy.sh`
