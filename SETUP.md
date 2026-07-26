# Live Player Stats Setup (football-data.org + Cloudflare Worker)

The player cards (Ins/Outs/Loans/Headline Moves) now open a detail modal.
For players currently in Manchester United's squad, it can show live
appearances/goals/assists/cards from football-data.org. Everyone else
(most Outs, historical loans) falls back to the Wikipedia bio automatically
— no broken UI either way.

This feature is **off by default** (`STATS_PROXY_URL = ''` in [app.js](app.js))
until you complete the two steps below. Nothing else in the site depends on it.

Why a proxy at all? This is a public repo — if the football-data.org key were
pasted into app.js, anyone viewing the page source could grab it and burn
your rate limit (or worse). The Cloudflare Worker holds the key server-side,
as an encrypted secret, and only exposes three narrow read-only routes.

## Step 1 — Get a free football-data.org API key

1. Go to **football-data.org** and open their registration page (Resources →
   "Get a free API Key", or `/client/register`).
2. Fill in the form (name, email, password) and submit. No credit card needed
   for the free tier.
3. Check your email and verify the account if asked.
4. Log in and go to **My Account**. Your API token/key is shown there —
   copy it somewhere safe. You won't paste it into any file in this repo;
   it goes into Cloudflare in Step 2 instead.

Free tier limits (as of writing): 10 requests/minute, 12 competitions
including the Premier League. That's comfortably enough for on-demand modal
opens on a personal dashboard.

## Step 2 — Deploy the Cloudflare Worker proxy

Cloudflare's free plan needs just an email + password — no credit card.

1. Go to **dash.cloudflare.com** and sign up (or log in).
2. In the left sidebar, open **Workers & Pages**.
3. Click **Create** → **Workers** → **Create Worker** (or "Start from Hello
   World!"). Give it a name, e.g. `mufc-stats-proxy` — this becomes part of
   its URL (`mufc-stats-proxy.<your-subdomain>.workers.dev`).
4. Click **Deploy** to create it with the placeholder code, then click
   **Edit code** to open the online editor.
5. Delete the placeholder code and paste in the full contents of
   [stats-proxy-worker.js](stats-proxy-worker.js) from this repo.
6. Click **Deploy** (top right) to publish it.
7. Add the API key as a secret so it never appears in code:
   - Go to the Worker's **Settings** tab → **Variables and Secrets**.
   - Add a variable named `FOOTBALL_DATA_API_KEY`, paste in your
     football-data.org key, and set its type to **Secret** (encrypted).
   - Save/deploy.
8. (Optional but recommended) Add a second variable named `ALLOWED_ORIGIN`
   set to your GitHub Pages URL, e.g. `https://<your-username>.github.io`.
   This restricts which sites can call the Worker. Leave it unset (or `*`)
   if you'd rather not bother — the route whitelist already limits what the
   Worker can be used for.
9. Copy the Worker's URL, shown at the top of its page — it looks like
   `https://mufc-stats-proxy.<your-subdomain>.workers.dev`.

## Step 3 — Wire it into the site

Open [app.js](app.js) and set:

```js
const STATS_PROXY_URL = 'https://mufc-stats-proxy.<your-subdomain>.workers.dev';
```

(no trailing slash). Save, reload the site, and open a player card — the
"Live Stats" section in the modal should populate for current-squad players
within a second or two.

## How matching works (and its limits)

football-data.org's free tier has no "search player by name" endpoint — the
only list of players we can browse is Manchester United's own registered
squad (`/v4/teams/66`). So:

- **Players currently at United** (new signings, current loan-listed squad
  members) get matched by name and show live stats.
- **Players who've left** (most Outs, past loans/permanent exits) can't be
  looked up this way — the modal automatically falls back to showing the
  Wikipedia bio instead, with a note explaining why. This is intentional,
  not a bug.

If a name match is ambiguous or fails for a current player too, it falls
back the same way rather than showing broken or blank UI.
