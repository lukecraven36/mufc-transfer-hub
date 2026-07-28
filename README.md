# Manchester United Transfer Hub

🔴 **Interactive fan-made dashboard** for Manchester United transfer activity — built as a static app so it's free to host and easy to keep updated.

## Files

- `index.html` — page structure + meta tags (edit copy/branding here)
- `styles.css` — all styling (Man Utd red/gold/black theme, dark/light mode)
- `app.js` — all logic: rendering, filters, charts, CSV export, player detail modal, photo/stats lookup
- `data.json` — **the only file you need to touch to update transfer data** (transfers, rumour ledger, news)
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

Update `rumours` for the speculative-targets panel — keep these clearly framed as unconfirmed, which the UI already labels. Rumours are now structured ledger entries; see below.

## The Rumour Accountability Ledger

This is the part of the project that isn't a commodity. Fees and ins/outs are available everywhere; a running, public record of **which outlets actually get Manchester United transfers right** is not. It compounds — every window logged makes the dataset more valuable, and it can't be back-filled by anyone starting later.

### Logging a rumour

Add an entry to `rumours` in `data.json`:

```json
{
  "id": "r-player-name-in",
  "player": "Player Name",
  "club": "Selling Club",
  "position": "CM",
  "type": "in",
  "fee": "~£40m (reported)",
  "claim": "What the outlet actually said",
  "claimStrength": "linked",
  "outlet": "Sky Sports",
  "via": null,
  "journalist": "Reporter Name",
  "sourceRaw": "Sky Sports (23 Jul 2026)",
  "firstReported": "2026-07-23",
  "window": "26/27 Summer",
  "resolution": { "verdict": "open", "resolvedOn": null, "outcome": null, "matchedTransfer": null, "note": null },
  "timeline": []
}
```

The three fields that carry all the weight:

- **`outlet`** — who reported it. An entry with no outlet is marked `"unattributed": true` and is excluded from all scoring. Never guess this.
- **`firstReported`** — the date it *first* appeared, not the date you logged it. Lead time is the whole argument for tier-one sources being worth reading.
- **`claimStrength`** — how strong a claim they actually made. This decides whether a failed rumour counts against them.

### `claimStrength` — read this before logging anything

| Value | Means | If the move never happens |
|---|---|---|
| `linked` | Interest, monitoring, "on a shortlist", "made checks" | **No move** — *not* counted as wrong |
| `talks` | A bid lodged, negotiations underway, terms being discussed | **Incorrect** |
| `advanced` | Deal agreed, medical booked, "here we go" | **Incorrect** |

This distinction is the entire credibility of the feature. An outlet that writes "United are monitoring X" has not predicted a signing — punishing them when X doesn't sign is the cheap-gotcha version of this idea, and any journalist could dismantle it in one reply. Grading strictly only what was claimed strongly is what makes the table defensible when it gets quoted back at you.

**When in doubt, log it as `linked`.** Under-claiming costs you nothing; over-claiming costs you the argument.

### The two numbers

- **Accuracy** — of the claims strong enough to be judged, how many were right. Partials count half.
- **Signal rate** — of *everything* an outlet reported, how much became a real transfer.

Both are needed. An outlet that only ever writes "monitoring" can hold a flawless accuracy score while converting almost nothing — the signal rate is where that shows up. Quoting one without the other is misleading.

### Resolving

Most of it is automatic. On load, every rumour is matched against completed `transfers` by player name:

- Move happened, club as reported → **correct**
- Move happened, but a different club or direction → **partial**
- No move, window still open → **open**
- No move, window closed (`meta.windowDeadline` passed) → **no move** for `linked`, **incorrect** for `talks`/`advanced`

To override a call by hand — a deal that completed under a different name, a claim that was right in substance but wrong in detail — set `resolution.verdict` in `data.json`. **A manual verdict always beats auto-resolution**, so nothing is locked in by the matching logic:

```json
"resolution": {
  "verdict": "partial",
  "resolvedOn": "2026-08-14",
  "outcome": "Signed, but on loan rather than the permanent deal reported",
  "matchedTransfer": null,
  "note": "Right player, right club, wrong deal structure."
}
```

Keep `meta.windowDeadline` accurate — it's what flips unfulfilled claims from "open" to resolved.

### Rules that keep it defensible

1. **Never log a rumour without an outlet.** Better an unattributed entry excluded from scoring than a wrong attribution.
2. **Attribute to the originator, not the aggregator.** Where a story is picked up second-hand, put the originator in `outlet` and the paper that carried it in `via`. Paper-talk round-ups are logged under `Sky Sports Paper Talk` for exactly this reason — they're a digest, not a source, and shouldn't be scored as if they broke the story.
3. **Credit the journalist where one is named.** Outlet-level scoring hides that a masthead's record is often one reporter's.
4. **Record `claim` verbatim in substance.** When someone disputes a verdict, the quote is the defence.
5. **Never revise history quietly.** Correct a wrong verdict, but treat resolved entries as a published record — that's what gives the table its authority.
6. **Publish the misses, including your own.** The account's credibility comes from being seen to apply the same standard to everyone.

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

- **Image generation pipeline** — render each deal and the ledger table to themed 1200×675 PNGs, so posts carry a native image instead of a link (X suppresses links, and most people never click through). Also drives per-deal OG cards.
- **GitHub Actions as the backend** — a scheduled workflow to refresh data, regenerate images, commit and redeploy. Free, no server, and it bakes the football-data.org lookups in at build time instead of fetching them live.
- Ledger extensions: per-journalist table, lead-time-to-completion stats, and a cross-window career record once a second window is logged.
- Player comparison tool
- More historical seasons once verified line-item data is available

---

**Glory Glory Man United** 👹

*Not affiliated with Manchester United Football Club or INEOS. Fan-made project — fees and details sourced from public reporting, see "Data sourcing" above.*
