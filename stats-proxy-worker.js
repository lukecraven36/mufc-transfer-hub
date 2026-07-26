/* ====================================================================
   MUFC Transfer Hub — football-data.org stats proxy (Cloudflare Worker)
   ====================================================================
   Purpose: app.js (running on GitHub Pages, public source) needs live
   player stats from football-data.org, but that API requires a secret
   key. This Worker sits in between: it holds the key as an encrypted
   Cloudflare secret (never visible in source, never committed to the
   repo) and only forwards a small allow-listed set of read-only routes.

   Deployment: see SETUP.md in the repo root for the full walkthrough
   (signing up for a football-data.org key, creating this Worker,
   setting the secret, and wiring the deployed URL into app.js).

   Routes exposed to the browser:
     GET /team-squad                -> /v4/teams/66            (Man Utd squad)
     GET /person/:id                -> /v4/persons/:id          (bio)
     GET /person/:id/matches        -> /v4/persons/:id/matches  (stats aggregation)
       forwards query params: dateFrom, dateTo, competitions, limit

   Everything else returns 404. This whitelist is deliberate: without it,
   this Worker would be an open, unauthenticated proxy for the entire
   football-data.org API, and anyone could point their own app at it and
   burn your rate limit / key.
   ==================================================================== */

const MUFC_TEAM_ID = 66;
const UPSTREAM = 'https://api.football-data.org';
const ALLOWED_MATCH_PARAMS = ['dateFrom', 'dateTo', 'competitions', 'limit'];

export default {
  async fetch(request, env) {
    const allowOrigin = env.ALLOWED_ORIGIN || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(request.url);
    let upstreamPath;

    const personMatchesMatch = url.pathname.match(/^\/person\/(\d+)\/matches$/);
    const personMatch = url.pathname.match(/^\/person\/(\d+)$/);

    if (url.pathname === '/team-squad') {
      upstreamPath = `/v4/teams/${MUFC_TEAM_ID}`;
    } else if (personMatchesMatch) {
      const qs = new URLSearchParams();
      for (const key of ALLOWED_MATCH_PARAMS) {
        const val = url.searchParams.get(key);
        if (val) qs.set(key, val);
      }
      const qsStr = qs.toString();
      upstreamPath = `/v4/persons/${personMatchesMatch[1]}/matches${qsStr ? `?${qsStr}` : ''}`;
    } else if (personMatch) {
      upstreamPath = `/v4/persons/${personMatch[1]}`;
    } else {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!env.FOOTBALL_DATA_API_KEY) {
      return new Response(JSON.stringify({ error: 'Worker is missing the FOOTBALL_DATA_API_KEY secret' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const upstreamRes = await fetch(`${UPSTREAM}${upstreamPath}`, {
      headers: { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY }
    });
    const body = await upstreamRes.text();
    return new Response(body, {
      status: upstreamRes.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};
