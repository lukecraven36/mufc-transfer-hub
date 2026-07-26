# Manchester United Transfer Hub

🔴 **Interactive fan-made dashboard** for Manchester United transfer activity — built as a static app so it's free to host and easy to keep updated.

## Files

- `index.html` — page structure + meta tags (edit copy/branding here)
- `styles.css` — all styling (Man Utd red/gold/black theme, dark/light mode)
- `app.js` — all logic: rendering, filters, charts, CSV export, player detail modal, photo/stats lookup
- `data.json` — **the only file you need to touch to update transfer data**
- `stats-proxy-worker.js` / `SETUP.md` — optional Cloudflare Worker + walkthrough for the live player-stats feature (see below)

Splitting these out means you can update a transfer by editing one array entry in `data.json` and everything else — KPI cards, charts, history trend, CSV export — recalculates automatically. No hardcoded totals to keep in sync.

## Updating data

Open `data.json` and add a row to `transfers`:

```json
{ "season":"26/27", "player":"Name", "type":"in", "position":"CM", "age":24,
  "from":"Club A", "to":"Manchester United", "fee":20, "feeMax":25,
  "status":"Permanent", "date":"Aug 2026", "notes":"Optional detail",
  "photoSeed":"Name", "source":"Sky Sports" }
```

- `type` is `in`, `out`, or `loan`.
- `fee`/`feeMax` are guaranteed fee and ceiling-with-add-ons (both `0` for frees/releases).
- `source` should name the outlet that reported the deal — it's shown on the player card and in the CSV export, and matters for credibility on a data-focused account.
- Bump `meta.lastUpdated` (and `meta.currentSeason` when a new window opens) so the header badge stays accurate.

Update `rumours` for the speculative-targets panel — keep these clearly framed as unconfirmed, which the UI already labels.

## Data sourcing

Fees and deal details are compiled from public reporting: Sky Sports, BBC Sport, ESPN, The Athletic, United In Focus, and club statements (manutd.com). Transfer fees are not officially published by the Premier League or the clubs involved, so reputable football-media reporting is the standard source for this kind of data — figures can be revised as outlets update their reporting. Each transfer's `source` field and the footer source list exist so readers can trace a figure back to its origin.

Player photos are fetched at runtime from Wikipedia's public REST API (freely licensed images, no key required) and automatically fall back to a generated initials avatar if no photo is found — so the app never breaks or needs manual image hosting.

## Player detail modal & live squad info

Clicking any player card opens a modal with the full transfer details, plus
a Wikipedia bio and, for players currently in Manchester United's squad,
live position/nationality/shirt number/contract info from football-data.org.
(Its free tier doesn't include match-level stats like goals/assists — see
SETUP.md if you want those from a different source.) The football-data.org
integration requires a small Cloudflare Worker to keep the API key off the
public page — it's optional and off by default. See [SETUP.md](SETUP.md)
for the full walkthrough; without it, cards still open and show the
Wikipedia bio.

## Running locally

Photos and data load via `fetch()`, which most browsers block on `file://` pages. Serve the folder instead of double-clicking `index.html`:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed local URL.

## Deploying for free

**GitHub Pages**
1. Create a public GitHub repo and push these four files (`index.html`, `styles.css`, `app.js`, `data.json`) plus this README.
2. Repo → Settings → Pages → Deploy from branch → `main` / `root`.
3. Live at `https://<username>.github.io/<repo>/`.
4. To update data going forward: edit `data.json`, commit, push — Pages redeploys automatically.

**Netlify / Vercel** — both also work by connecting the same GitHub repo (no build step needed, it's static files) and will redeploy on every push.

## Future ideas

- Player comparison tool
- Automated deal alerts (would need a small backend/cron to poll a feed)
- More historical seasons once verified line-item data is available
- Per-transfer permalinks for sharing individual deals on X

---

**Glory Glory Man United** 👹

*Not affiliated with Manchester United Football Club or INEOS. Fan-made project — fees and details sourced from public reporting, see "Data sourcing" above.*
