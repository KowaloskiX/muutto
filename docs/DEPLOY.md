# Deploy

The app is a standard Next.js 15 app. `next build` passes (checked on a clean copy of the repo). Two options:

## Option A — Vercel (recommended for the demo URL)

1. `npm i -g vercel && vercel login` (needs your account; nothing here can do it for you).
2. From `kilpailutus/`: `vercel link`, then set env vars:
   ```
   vercel env add EXA_API_KEY production
   vercel env add OPENAI_API_KEY production
   vercel env add OPENAI_MODEL production          # gpt-5.4-mini
   vercel env add LLM_DAILY_TOKEN_CAP production   # e.g. 1500000
   vercel env add PUBLIC_BASE_URL production       # https://<your-app>.vercel.app (enables live Exa Monitor webhooks)
   ```
3. `vercel --prod`.
4. Warm the demo query against the deployed URL: `node scripts/warm.mjs https://<your-app>.vercel.app`.

Things to know on Vercel:
- **Function duration.** Routes declare `maxDuration` up to 300 s (`/api/find` 300, `/api/compare-quotes` 180, `/api/verify-connect` 150, `/api/agent` 120). Plans with a lower cap clamp these; a typical cold `/api/find` takes 15–30 s, so it fits even a 60 s cap, but a long agent errand may not.
- **Caches are per instance.** The real-result cache (`src/lib/cache.ts`) and the LLM usage counter live in memory + the OS temp dir. On serverless they reset when an instance is recycled and are not shared between instances. Warm right before presenting, and treat `LLM_DAILY_TOKEN_CAP` as per-instance on Vercel.
- **Webhooks.** With `PUBLIC_BASE_URL` set to an https URL, Exa Monitors post to `/api/exa-webhook` (HMAC-verified). Without it, monitors run in polling mode.

## Option B — Run locally and expose with a tunnel

Keeps caches and the usage counter in one process (most predictable for a live demo):

```
cd kilpailutus
set -a; . ./.env.local; set +a
npm run build && npm start            # or npm run dev
npx cloudflared tunnel --url http://localhost:3000   # or ngrok http 3000
```

Set `PUBLIC_BASE_URL` to the tunnel's https URL before `npm start` for live Monitor webhooks.

## Pre-demo checklist

See `docs/DEMO-RUNBOOK.md`.
