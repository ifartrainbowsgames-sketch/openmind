# Railway deploy guide

You paid for Railway — here's what actually works on it.

## Important: Suna template vs E2B

| Deploy | Works on Railway? | Sandboxes |
|--------|-------------------|-----------|
| **OpenMind** (`./railway-openmind.ps1`) | ✅ Yes | Chat + LangGraph (no code VM) |
| **Suna template** (`./railway-deploy.sh`) | ⚠️ Only with **Daytona** | Full agent VMs |
| **E2B self-host** (`./e2b-deploy.sh`) | ❌ Not on Railway | Run on your PC with Docker |

The Railway `kortix-suna-ai` template uses the **community backend**, which is **Daytona-only**. Your E2B key does **not** work with that template.

---

## Recommended: OpenMind on Railway (~$5/mo)

Uses what you already have: **Supabase + OpenAI + Anthropic**. Mobile app at `/app`.

### One-time

```powershell
# Install Railway CLI (if needed)
iwr https://railway.app/install.ps1 | iex

# Login (opens browser)
railway login
```

### Deploy

```powershell
cd c:\Users\ezraw\openmind\kortix-setup
copy .env.example .env    # fill in SUPABASE_URL + SUPABASE_ANON_KEY
.\railway-openmind.ps1
```

Then open `https://YOUR-APP.up.railway.app/app` on your phone.

---

## If you still want full Suna on Railway

You **must** get a **Daytona API key** (signup at app.daytona.io — see README for work-email issues).

Then:

```powershell
cd kortix-setup
# .env needs DAYTONA_API_KEY + QStash + Tavily + Firecrawl + Supabase
.\railway-deploy.sh
```

Plus Supabase migrations (see `railway-deploy.sh` output).

---

## Cheapest full agents (E2B, not Railway)

Your PC has Docker. Run free tunnel + E2B on your machine:

```powershell
# Use WSL or Git Bash:
cd kortix-setup
./e2b-deploy.sh
```

Railway $5 is then optional (only needed if you want OpenMind hosted 24/7 without your PC on).
