/* ==================== MUFC TRANSFER HUB — APP LOGIC ====================
   Data lives in data.json (edit that file to add/update transfers — this
   file recalculates every KPI, chart and history figure from it, so there
   is a single source of truth. */

let DATA = null;      // raw parsed data.json
let transfers = [];   // DATA.transfers
let rumours = [];     // DATA.rumours
let news = [];        // DATA.news
let currentSeason = "";
let current = [], ins = [], outs = [], loans = [];
let totalSpend = 0, totalIncome = 0, netSpend = 0;
let filtered = [];
let charts = {};

// ==================== LIVE SQUAD INFO CONFIG ====================
// For players currently in Manchester United's squad, football-data.org can supply
// position/nationality/shirt number/contract info (its free tier doesn't include
// match-level stats like goals/assists — see SETUP.md). Fetched via a small
// Cloudflare Worker proxy that holds the API key privately — see stats-proxy-worker.js
// and SETUP.md for how to sign up and deploy it. Paste your deployed Worker's URL
// below once it's live. Leave blank to disable this (player cards still work,
// falling back to the Wikipedia bio in that case).
const STATS_PROXY_URL = 'https://mufc-stats-proxy.lukecraven36.workers.dev';

// ==================== BOOT ====================
async function boot() {
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    document.querySelector('.main').innerHTML =
      `<div class="error-msg"><i class="fas fa-triangle-exclamation"></i> Could not load data.json (${err.message}). If you're opening this file directly (file://), run it through a local server instead — most browsers block fetch() on local files. Try: <code>npx serve</code> or the VS Code "Live Server" extension.</div>`;
    return;
  }

  transfers = DATA.transfers || [];
  transfers.forEach((t, i) => { t._idx = i; });
  rumours = DATA.rumours || [];
  news = DATA.news || [];
  currentSeason = DATA.meta?.currentSeason || (transfers[0] && transfers[0].season) || "";

  current = transfers.filter(t => t.season === currentSeason);
  ins = current.filter(t => t.type === "in");
  outs = current.filter(t => t.type === "out");
  loans = current.filter(t => t.type === "loan");
  totalSpend = ins.reduce((s, t) => s + t.fee, 0);
  totalIncome = outs.reduce((s, t) => s + t.fee, 0);
  netSpend = totalSpend - totalIncome;

  document.getElementById('dataDate').textContent = formatDate(DATA.meta?.lastUpdated);

  // Verdicts are derived before anything renders — the rumour cards and the
  // ledger tab both display them, so they need to exist first.
  resolveLedger();

  populateSeasonFilter();
  renderKPIs();
  renderPlayerGrids();
  applyFilters();
  renderTimeline();
  renderClubs();
  renderRumours();
  renderLedger();
  renderNews();
  renderHistorySnap();
  renderSourceList();
  initCharts();
  bindEvents();
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ==================== PLAYER PHOTOS (Wikipedia, with generated-avatar fallback) ====================
const PHOTO_CACHE_KEY = 'mufc-photo-cache-v1';
const PHOTO_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function loadPhotoCache() {
  try { return JSON.parse(localStorage.getItem(PHOTO_CACHE_KEY)) || {}; }
  catch { return {}; }
}
function savePhotoCache(cache) {
  try { localStorage.setItem(PHOTO_CACHE_KEY, JSON.stringify(cache)); } catch { /* ignore quota errors */ }
}
const photoCache = loadPhotoCache();

function avatarUrl(name, bg = "DA291C") {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${bg}&color=fff&size=128&bold=true&font-size=0.4`;
}

// Looks up a free-licensed thumbnail from Wikipedia's public REST API.
// Falls back silently (returns null) on any miss/error so the caller can
// use the generated avatar instead. Results are cached in localStorage.
async function fetchWikipediaPhoto(name) {
  const cached = photoCache[name];
  if (cached && (Date.now() - cached.ts) < PHOTO_CACHE_TTL_MS) {
    return cached.url; // may be null (a cached "not found")
  }
  const candidates = [name, `${name} (footballer)`];
  for (const title of candidates) {
    try {
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (json.type === 'disambiguation') continue;
      const url = json.thumbnail?.source || null;
      if (url) {
        photoCache[name] = { url, ts: Date.now() };
        savePhotoCache(photoCache);
        return url;
      }
    } catch { /* network/CORS failure — try next candidate or fall back */ }
  }
  photoCache[name] = { url: null, ts: Date.now() };
  savePhotoCache(photoCache);
  return null;
}

// Attaches a photo to an <img>: tries Wikipedia first, falls back to avatar.
function hydratePhoto(img) {
  const name = img.dataset.name;
  const bg = img.dataset.bg;
  fetchWikipediaPhoto(name).then(url => {
    img.src = url || avatarUrl(name, bg);
  });
}

// ==================== NAV ====================
function showSection(id) {
  const btn = document.querySelector(`.nav-btn[data-section="${id}"]`);
  const section = document.getElementById(id);
  if (!btn || !section) return;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  section.classList.add('active');
}

function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.section));
  });

  // In-copy links that jump to another tab, e.g. Rumours -> Ledger
  document.querySelectorAll('[data-goto]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      showSection(link.dataset.goto);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  const themeBtn = document.getElementById('themeToggle');
  themeBtn.addEventListener('click', () => {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') !== 'light';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    themeBtn.innerHTML = isDark ? '<i class="fas fa-sun"></i> <span>Light</span>' : '<i class="fas fa-moon"></i> <span>Dark</span>';
    localStorage.setItem('mufc-theme', isDark ? 'light' : 'dark');
  });
  if (localStorage.getItem('mufc-theme') === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    themeBtn.innerHTML = '<i class="fas fa-sun"></i> <span>Light</span>';
  }

  ['searchAll', 'filterType', 'filterSeason', 'filterFee'].forEach(id => {
    document.getElementById(id).addEventListener('input', applyFilters);
    document.getElementById(id).addEventListener('change', applyFilters);
  });
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('searchAll').value = '';
    document.getElementById('filterType').value = 'all';
    document.getElementById('filterSeason').value = 'all';
    document.getElementById('filterFee').value = 'all';
    applyFilters();
  });

  document.getElementById('exportCsv').addEventListener('click', () => downloadCSV(toCSV(current), 'mufc-transfers-current-window.csv'));
  document.getElementById('exportFiltered').addEventListener('click', () => downloadCSV(toCSV(filtered), 'mufc-transfers-filtered.csv'));

  document.getElementById('shareBtn').addEventListener('click', () => {
    if (navigator.share) navigator.share({ title: 'Man Utd Transfer Dashboard', url: window.location.href });
    else copyLink();
  });
  document.getElementById('shareTwitterBtn').addEventListener('click', shareTwitter);
  document.getElementById('copyLinkBtn').addEventListener('click', copyLink);
  document.getElementById('shareDiscordBtn').addEventListener('click', shareDiscord);

  document.querySelectorAll('.player-grid').forEach(grid => {
    grid.addEventListener('click', e => {
      const card = e.target.closest('.player-card');
      if (!card) return;
      const idx = Number(card.dataset.transferIdx);
      if (!Number.isNaN(idx) && transfers[idx]) openPlayerModal(transfers[idx]);
    });
    grid.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.player-card');
      if (!card) return;
      e.preventDefault();
      const idx = Number(card.dataset.transferIdx);
      if (!Number.isNaN(idx) && transfers[idx]) openPlayerModal(transfers[idx]);
    });
  });

  document.getElementById('modalCloseBtn').addEventListener('click', closePlayerModal);
  document.getElementById('playerModalOverlay').addEventListener('click', e => {
    if (e.target.id === 'playerModalOverlay') closePlayerModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePlayerModal();
  });
}

// ==================== KPI ====================
function renderKPIs() {
  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpi-card"><div class="kpi-label"><i class="fas fa-arrow-down"></i> Total Spend</div><div class="kpi-value red">£${totalSpend}m</div><div class="kpi-sub">${ins.length} arrivals</div></div>
    <div class="kpi-card income"><div class="kpi-label"><i class="fas fa-arrow-up"></i> Total Income</div><div class="kpi-value green">£${totalIncome}m</div><div class="kpi-sub">${outs.length} departures</div></div>
    <div class="kpi-card net"><div class="kpi-label"><i class="fas fa-balance-scale"></i> Net Spend</div><div class="kpi-value" style="color:var(--mufc-orange)">£${netSpend}m</div><div class="kpi-sub">${currentSeason} so far</div></div>
    <div class="kpi-card free"><div class="kpi-label"><i class="fas fa-gift"></i> Free Moves</div><div class="kpi-value gold">${current.filter(t => t.fee === 0).length}</div><div class="kpi-sub">Ins + Outs + Loans</div></div>
    <div class="kpi-card"><div class="kpi-label"><i class="fas fa-exchange-alt"></i> Active Loans</div><div class="kpi-value">${loans.length}</div><div class="kpi-sub">Outgoing</div></div>
    <div class="kpi-card"><div class="kpi-label"><i class="fas fa-user-plus"></i> £30m+ Deals</div><div class="kpi-value">${current.filter(t => t.fee >= 30).length}</div><div class="kpi-sub">Major moves</div></div>
  `;
}

// ==================== PLAYER CARDS ====================
// fee === 0 covers three different situations that must not render identically:
// a genuine free/released move, an actual loan, or a permanent deal where a fee
// was paid but never disclosed (e.g. academy/development compensation). Status
// text and type distinguish the first two; anything left over is "undisclosed",
// not "Free" — showing that as a free transfer would misrepresent the deal.
function isFreeOrReleasedStatus(t) {
  const s = (t.status || '').toLowerCase();
  return s.includes('free') || s.includes('released');
}
function feeDisplayText(t) {
  if (t.fee > 0) return `£${t.fee}m${t.feeMax > t.fee ? `–${t.feeMax}m` : ''}`;
  if (t.type === 'loan') return 'Loan';
  return isFreeOrReleasedStatus(t) ? 'Free' : 'Undisclosed fee';
}

function playerCard(t) {
  const feeText = feeDisplayText(t);
  const feeClass = t.type === 'in' ? 'fee-negative' : (t.fee > 0 ? 'fee-positive' : 'fee-zero');
  const bg = t.type === 'in' ? '00C853' : (t.type === 'out' ? 'DA291C' : 'FF9100');
  const seed = t.photoSeed || t.player;
  return `
    <div class="player-card ${t.type}" data-transfer-idx="${t._idx}" tabindex="0" role="button" aria-haspopup="dialog">
      <img class="player-photo" data-name="${escapeAttr(seed)}" data-bg="${bg}" src="${avatarUrl(seed, bg)}" alt="${escapeAttr(t.player)}" loading="lazy" />
      <div class="player-info">
        <div class="player-name">${t.player}</div>
        <div class="player-meta">${t.position} • Age ${t.age ?? '—'} • ${t.date}</div>
        <div class="player-fee ${feeClass}">${feeText}</div>
        <div class="player-flow">
          <span class="club-tag">${t.from}</span>
          <span class="arrow">→</span>
          <span class="club-tag">${t.to}</span>
        </div>
        ${t.notes ? `<div style="margin-top:0.35rem;font-size:0.7rem;color:var(--mufc-gray);">${t.notes}</div>` : ''}
        ${t.source ? `<div class="source-tag"><i class="fas fa-check-circle"></i> Source: ${t.source}</div>` : ''}
      </div>
    </div>`;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

function hydrateVisiblePhotos(container) {
  container.querySelectorAll('img.player-photo[data-name]').forEach(hydratePhoto);
}

function renderPlayerGrids() {
  const insGrid = document.getElementById('insGrid');
  const outsGrid = document.getElementById('outsGrid');
  const loansGrid = document.getElementById('loansGrid');
  const headlineGrid = document.getElementById('headlineMoves');

  insGrid.innerHTML = ins.map(playerCard).join('');
  outsGrid.innerHTML = outs.map(playerCard).join('');
  loansGrid.innerHTML = loans.map(playerCard).join('');
  const headlines = current.filter(t => t.fee >= 30).slice(0, 6);
  headlineGrid.innerHTML = (headlines.length ? headlines : current.slice(0, 6)).map(playerCard).join('');

  [insGrid, outsGrid, loansGrid, headlineGrid].forEach(hydrateVisiblePhotos);
}

// ==================== MASTER TABLE + FILTERS ====================
function populateSeasonFilter() {
  const select = document.getElementById('filterSeason');
  const seasons = [...new Set(transfers.map(t => t.season))].sort();
  select.innerHTML = '<option value="all">All Seasons</option>' +
    seasons.map(s => `<option value="${s}">${s}</option>`).join('');
}

function applyFilters() {
  const q = document.getElementById('searchAll').value.toLowerCase();
  const type = document.getElementById('filterType').value;
  const season = document.getElementById('filterSeason').value;
  const fee = document.getElementById('filterFee').value;
  filtered = transfers.filter(t => {
    if (type !== 'all' && t.type !== type) return false;
    if (season !== 'all' && t.season !== season) return false;
    if (fee === 'paid' && t.fee === 0) return false;
    if (fee === 'free' && t.fee > 0) return false;
    if (fee === 'big' && t.fee < 30) return false;
    if (q && !(t.player.toLowerCase().includes(q) || t.from.toLowerCase().includes(q) || t.to.toLowerCase().includes(q))) return false;
    return true;
  });
  renderMasterTable();
}

function renderMasterTable() {
  const tbody = document.getElementById('masterBody');
  tbody.innerHTML = filtered.map(t => `
    <tr>
      <td>${t.season}</td>
      <td><strong>${t.player}</strong></td>
      <td><span class="type-badge type-${t.type === 'in' ? 'in' : (t.type === 'loan' ? 'loan' : (t.fee === 0 ? 'free' : 'out'))}">${t.type}</span></td>
      <td>${t.position}</td>
      <td>${t.age ?? '—'}</td>
      <td><span class="club-tag">${t.from}</span></td>
      <td><span class="club-tag">${t.to}</span></td>
      <td class="${t.fee > 0 ? (t.type === 'in' ? 'fee-negative' : 'fee-positive') : 'fee-zero'}">${feeDisplayText(t)}</td>
      <td>${t.status}</td>
      <td class="source-tag">${t.source || '—'}</td>
    </tr>`).join('');
  document.getElementById('filterCount').textContent = `Showing ${filtered.length} of ${transfers.length} transfers`;
}

// ==================== CSV EXPORT ====================
function toCSV(rows) {
  const headers = ['Season', 'Player', 'Type', 'Position', 'Age', 'From', 'To', 'Fee (£m)', 'Fee Max (£m)', 'Status', 'Notes', 'Source'];
  const lines = [headers.join(',')];
  rows.forEach(t => {
    lines.push([t.season, `"${t.player}"`, t.type, t.position, t.age ?? '', `"${t.from}"`, `"${t.to}"`, t.fee, t.feeMax, `"${t.status}"`, `"${(t.notes || '').replace(/"/g, '""')}"`, `"${t.source || ''}"`].join(','));
  });
  return lines.join('\n');
}
function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  showToast('CSV downloaded');
}

// ==================== TIMELINE ====================
function renderTimeline() {
  document.getElementById('timeline').innerHTML = current.map(t => `
    <div class="timeline-item"><div class="timeline-date">${t.date}</div><div>${describeTransfer(t)}</div></div>`).join('');
}

function describeTransfer(t) {
  function feeParen(freeWord) {
    if (t.fee > 0) return ` (£${t.fee}m${t.feeMax > t.fee ? `–${t.feeMax}m` : ''})`;
    return isFreeOrReleasedStatus(t) ? ` (${freeWord})` : ' (fee undisclosed)';
  }
  if (t.type === 'in') return `${t.player} signs from ${t.from}${feeParen('free')}`;
  if (t.type === 'out') return `${t.player} departs to ${t.to}${feeParen('released')}`;
  return `${t.player} — ${t.status.toLowerCase()} to ${t.to}`;
}

// ==================== CLUBS ====================
function renderClubs() {
  const fromMap = {}, toMap = {};
  current.forEach(t => {
    if (t.type === 'in') fromMap[t.from] = (fromMap[t.from] || 0) + 1;
    else toMap[t.to] = (toMap[t.to] || 0) + 1;
  });
  document.getElementById('clubsFrom').innerHTML = Object.entries(fromMap).sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `<div class="club-chip">${c} <span class="count">${n}</span></div>`).join('');
  document.getElementById('clubsTo').innerHTML = Object.entries(toMap).sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `<div class="club-chip">${c} <span class="count">${n}</span></div>`).join('');
}

// ==================== RUMOURS ====================
// Rumour names carry a trailing club/context suffix for display, e.g. "Éderson (Atalanta)"
// or "Joshua Zirkzee (to Juventus)" — strip it before using the name as a photo/avatar
// seed, otherwise the club text corrupts both the generated initials and the Wikipedia lookup.
function rumourPlayerName(fullName) {
  return String(fullName).replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// Display label for a ledger entry: "Player (Club)" for incoming links,
// "Player (to Club)" for exits. Falls back to just the name when the
// counterparty isn't known.
function rumourLabel(r) {
  if (!r.club) return r.player;
  return r.type === 'out' ? `${r.player} (to ${r.club})` : `${r.player} (${r.club})`;
}

function rumourCard(r) {
  const seed = r.player;
  const bg = r.type === 'out' ? 'DA291C' : '00C853';
  const feeClass = r.type === 'out' ? 'fee-positive' : 'fee-negative';
  const label = rumourLabel(r);
  const v = r.resolution?.verdict || 'open';
  const attribution = r.outlet
    ? `${r.outlet}${r.journalist ? ` — ${r.journalist}` : ''}${r.via ? `, via ${r.via}` : ''}`
    : 'No outlet recorded';
  return `
    <div class="player-card rumour-target ${r.type === 'out' ? 'out' : 'in'}" data-rumour-id="${escapeAttr(r.id)}">
      <img class="player-photo" data-name="${escapeAttr(seed)}" data-bg="${bg}" src="${avatarUrl(seed, bg)}" alt="${escapeAttr(label)}" loading="lazy" />
      <div class="player-info">
        <div class="player-name">${escapeHtml(label)} ${verdictBadge(v)}</div>
        <div class="player-meta">${r.type === 'out' ? 'Potential departure' : 'Linked target'}${r.position ? ` · ${escapeHtml(r.position)}` : ''}${STRENGTH_LABEL[r.claimStrength] ? ` · ${STRENGTH_LABEL[r.claimStrength]}` : ''}</div>
        <div class="player-fee ${feeClass}">${escapeHtml(r.fee || 'Undisclosed')}</div>
        ${r.claim ? `<div style="margin-top:0.35rem;font-size:0.7rem;color:var(--mufc-gray);">${escapeHtml(r.claim)}</div>` : ''}
        <div class="source-tag ${r.outlet ? '' : 'source-tag-muted'}">
          <i class="fas ${r.outlet ? 'fa-check-circle' : 'fa-circle-question'}"></i>
          ${escapeHtml(attribution)}${r.firstReported ? ` · first reported ${formatDate(r.firstReported)}` : ''}
        </div>
      </div>
    </div>`;
}

function rumourEmptyState(direction) {
  return `<div class="empty-state">No ${direction} rumours reported yet.</div>`;
}

function renderRumours() {
  const insList = rumours.filter(r => r.type === 'in');
  const outsList = rumours.filter(r => r.type === 'out');
  const inGrid = document.getElementById('rumoursInGrid');
  const outGrid = document.getElementById('rumoursOutGrid');
  inGrid.innerHTML = insList.length ? insList.map(rumourCard).join('') : rumourEmptyState('incoming');
  outGrid.innerHTML = outsList.length ? outsList.map(rumourCard).join('') : rumourEmptyState('outgoing');
  [inGrid, outGrid].forEach(hydrateVisiblePhotos);
}

/* ==================== RUMOUR ACCOUNTABILITY LEDGER ====================
   Every rumour is logged with who reported it, when, and how strong the
   claim was. Once a deal happens (or the window shuts without it), each
   entry gets a verdict — and those verdicts aggregate into a per-outlet
   accuracy table.

   The methodology matters more than the code here, because the obvious
   naive version is unfair and would discredit the whole feature. An outlet
   that reports "United are monitoring X" has not claimed X will sign; if
   X doesn't sign, the outlet wasn't *wrong*. So claims are scored by the
   strength they were actually made at:

     linked    interest/monitoring only   -> if it doesn't happen: EXPIRED,
                                             not counted against accuracy
     talks     concrete bid/negotiation   -> if it doesn't happen: INCORRECT
     advanced  deal agreed/imminent       -> if it doesn't happen: INCORRECT

   That gives two separate, honest numbers per outlet:
     Accuracy    — of the claims strong enough to be right or wrong, how
                   many were right.
     Signal rate — of everything they reported, how much became real. This
                   is where spray-and-pray outlets show up: they can hold a
                   perfect accuracy score while converting almost nothing.
   ==================================================================== */

const STRENGTH_LABEL = {
  linked: 'Linked',
  talks: 'In talks',
  advanced: 'Advanced',
};

// Only these claim strengths can be judged "wrong" when a deal fails.
const STRICT_STRENGTHS = new Set(['talks', 'advanced']);

const VERDICT_META = {
  correct:   { label: 'Correct',   cls: 'verdict-correct',   icon: 'fa-circle-check' },
  partial:   { label: 'Partial',   cls: 'verdict-partial',   icon: 'fa-circle-half-stroke' },
  incorrect: { label: 'Incorrect', cls: 'verdict-incorrect', icon: 'fa-circle-xmark' },
  expired:   { label: 'No move',   cls: 'verdict-expired',   icon: 'fa-circle-minus' },
  open:      { label: 'Open',      cls: 'verdict-open',      icon: 'fa-clock' },
};

function verdictBadge(v) {
  const m = VERDICT_META[v] || VERDICT_META.open;
  return `<span class="verdict-badge ${m.cls}"><i class="fas ${m.icon}"></i> ${m.label}</span>`;
}

// Has the window this rumour belongs to closed? Until it has, an unfulfilled
// rumour is simply still open — not a miss.
function windowClosed() {
  const deadline = DATA?.meta?.windowDeadline;
  if (!deadline) return false;
  return startOfDay(new Date()) > startOfDay(new Date(deadline + 'T00:00:00'));
}

// Find a completed transfer matching this rumour's player.
function matchTransfer(r) {
  const target = normalizeName(r.player);
  if (!target) return null;
  return current.find(t => normalizeName(t.player) === target) || null;
}

/* Derive a verdict for each rumour.

   A manually-set verdict in data.json always wins — auto-resolution is a
   convenience for the common cases, not an authority. Everything else is
   inferred:
     - matched a completed transfer, counterparty club as reported -> correct
     - matched, but the club or deal type differs materially       -> partial
     - no match, window still open                                 -> open
     - no match, window closed, weak claim                         -> expired
     - no match, window closed, strong claim                       -> incorrect */
function deriveVerdict(r) {
  const manual = r.resolution?.verdict;
  if (manual && manual !== 'open') {
    return { ...r.resolution, source: 'manual' };
  }

  const t = matchTransfer(r);
  if (t) {
    const counterparty = t.type === 'in' ? t.from : t.to;
    const clubMatches = !r.club ||
      normalizeName(counterparty).includes(normalizeName(r.club)) ||
      normalizeName(r.club).includes(normalizeName(counterparty));
    const directionMatches = (r.type === 'in') === (t.type === 'in');
    const verdict = clubMatches && directionMatches ? 'correct' : 'partial';
    return {
      verdict,
      resolvedOn: null,
      outcome: `${t.type === 'in' ? 'Signed from' : 'Left for'} ${counterparty}` +
               (t.fee ? ` — £${t.fee}m` : ' — free'),
      matchedTransfer: t._idx,
      note: verdict === 'partial'
        ? `Move happened but not as reported (reported ${r.club || 'unspecified club'}, actual ${counterparty}).`
        : null,
      source: 'auto',
    };
  }

  if (!windowClosed()) {
    return { verdict: 'open', resolvedOn: null, outcome: null, matchedTransfer: null, note: null, source: 'auto' };
  }

  // A claim with no named outlet can't be held against anyone, so it never
  // resolves to "incorrect" no matter how strong it was — there is nobody to
  // charge it to. It closes as a non-event instead.
  const attributed = !r.unattributed && !!r.outlet;
  const strict = attributed && STRICT_STRENGTHS.has(r.claimStrength);
  return {
    verdict: strict ? 'incorrect' : 'expired',
    resolvedOn: DATA?.meta?.windowDeadline || null,
    outcome: 'No move materialised before the window closed',
    matchedTransfer: null,
    note: strict ? null
      : attributed ? 'Reported as interest only, so not scored against accuracy.'
      : 'No outlet recorded, so this claim is not scored.',
    source: 'auto',
  };
}

// Attach resolved verdicts to every rumour. Called once at boot.
function resolveLedger() {
  rumours.forEach(r => {
    r.resolution = { ...(r.resolution || {}), ...deriveVerdict(r) };
  });
}

/* Aggregate per outlet.
     accuracy    = correct / (correct + partial + incorrect), partial counts half
     signalRate  = (correct + partial) / all resolved entries
   Unattributed entries (no named outlet) are excluded entirely — they can't
   fairly be credited or blamed to anyone. */
function ledgerByOutlet() {
  const map = new Map();

  rumours.forEach(r => {
    if (r.unattributed || !r.outlet) return;
    const key = r.outlet;
    if (!map.has(key)) {
      map.set(key, {
        outlet: key,
        journalists: new Set(),
        total: 0, correct: 0, partial: 0, incorrect: 0, expired: 0, open: 0,
      });
    }
    const row = map.get(key);
    row.total++;
    if (r.journalist) row.journalists.add(r.journalist);
    const v = r.resolution?.verdict || 'open';
    if (row[v] !== undefined) row[v]++;
  });

  const rows = [...map.values()].map(row => {
    const judged = row.correct + row.partial + row.incorrect;
    const resolved = judged + row.expired;
    return {
      ...row,
      journalists: [...row.journalists],
      judged,
      resolved,
      accuracy: judged ? (row.correct + row.partial * 0.5) / judged : null,
      signalRate: resolved ? (row.correct + row.partial) / resolved : null,
    };
  });

  // Most-judged first, then most accurate — an outlet with one lucky hit
  // shouldn't top a table above one with a real track record.
  rows.sort((a, b) => (b.judged - a.judged) || ((b.accuracy ?? -1) - (a.accuracy ?? -1)) || (b.total - a.total));
  return rows;
}

function ledgerTotals() {
  const t = { total: rumours.length, correct: 0, partial: 0, incorrect: 0, expired: 0, open: 0, unattributed: 0 };
  rumours.forEach(r => {
    if (r.unattributed || !r.outlet) t.unattributed++;
    const v = r.resolution?.verdict || 'open';
    if (t[v] !== undefined) t[v]++;
  });
  return t;
}

function pct(n) {
  return n === null || n === undefined ? '—' : `${Math.round(n * 100)}%`;
}

function accuracyBar(v) {
  if (v === null || v === undefined) return '<span class="ledger-muted">—</span>';
  const p = Math.round(v * 100);
  const tone = p >= 70 ? 'bar-good' : p >= 40 ? 'bar-mid' : 'bar-bad';
  return `<div class="ledger-bar-wrap" role="img" aria-label="${p} percent">
      <div class="ledger-bar ${tone}" style="width:${p}%"></div>
      <span class="ledger-bar-label">${p}%</span>
    </div>`;
}

function renderLedgerTable() {
  const rows = ledgerByOutlet();
  const body = document.getElementById('ledgerBody');
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty-state">No attributed rumours logged yet.</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(r => `
    <tr>
      <td>
        <strong>${escapeHtml(r.outlet)}</strong>
        ${r.journalists.length ? `<div class="ledger-sub">${escapeHtml(r.journalists.join(', '))}</div>` : ''}
      </td>
      <td class="num">${r.total}</td>
      <td class="num verdict-correct-text">${r.correct}</td>
      <td class="num verdict-partial-text">${r.partial}</td>
      <td class="num verdict-incorrect-text">${r.incorrect}</td>
      <td class="num ledger-muted">${r.expired}</td>
      <td>${accuracyBar(r.accuracy)}</td>
      <td>${accuracyBar(r.signalRate)}</td>
    </tr>`).join('');
}

function renderLedgerSummary() {
  const t = ledgerTotals();
  const el = document.getElementById('ledgerSummary');
  if (!el) return;
  const judged = t.correct + t.partial + t.incorrect;
  const overall = judged ? (t.correct + t.partial * 0.5) / judged : null;

  const cards = [
    { label: 'Rumours logged', value: t.total, sub: `${t.unattributed} unattributed` },
    { label: 'Still open', value: t.open, sub: windowClosed() ? 'window closed' : 'window open' },
    { label: 'Confirmed correct', value: t.correct, sub: `${t.partial} partial` },
    { label: 'Overall accuracy', value: pct(overall), sub: `${judged} judged claim${judged === 1 ? '' : 's'}` },
  ];

  el.innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div class="kpi-label">${escapeHtml(c.label)}</div>
      <div class="kpi-value">${escapeHtml(String(c.value))}</div>
      <div class="kpi-sub">${escapeHtml(c.sub)}</div>
    </div>`).join('');
}

// The receipts list: every entry that has actually been judged, newest first.
function renderLedgerReceipts() {
  const el = document.getElementById('ledgerReceipts');
  if (!el) return;

  // Only attributed entries appear here — a receipt with no outlet on it
  // isn't a receipt, and putting one in this list implies blame it can't carry.
  const judged = rumours
    .filter(r => !r.unattributed && r.outlet)
    .filter(r => ['correct', 'partial', 'incorrect'].includes(r.resolution?.verdict))
    .sort((a, b) => String(b.firstReported || '').localeCompare(String(a.firstReported || '')));

  if (!judged.length) {
    el.innerHTML = `<div class="empty-state">Nothing resolved yet. Verdicts appear here as deals complete, and automatically at the window deadline (${formatDate(DATA?.meta?.windowDeadline)}) for anything that didn't happen.</div>`;
    return;
  }

  el.innerHTML = judged.map(r => `
    <div class="receipt-row ${r.resolution.verdict}">
      <div class="receipt-main">
        <div class="receipt-player">${escapeHtml(rumourLabel(r))} ${verdictBadge(r.resolution.verdict)}</div>
        <div class="receipt-claim">“${escapeHtml(r.claim || 'No claim recorded')}”</div>
        ${r.resolution.outcome ? `<div class="receipt-outcome"><i class="fas fa-arrow-right-long"></i> ${escapeHtml(r.resolution.outcome)}</div>` : ''}
        ${r.resolution.note ? `<div class="receipt-note">${escapeHtml(r.resolution.note)}</div>` : ''}
      </div>
      <div class="receipt-meta">
        <div class="receipt-outlet">${escapeHtml(r.outlet || 'Unattributed')}</div>
        ${r.journalist ? `<div class="ledger-sub">${escapeHtml(r.journalist)}</div>` : ''}
        <div class="ledger-sub">${r.firstReported ? formatDate(r.firstReported) : 'date not recorded'}</div>
      </div>
    </div>`).join('');
}

function renderLedger() {
  renderLedgerSummary();
  renderLedgerTable();
  renderLedgerReceipts();
  const note = document.getElementById('ledgerDeadlineNote');
  if (note) {
    note.textContent = windowClosed()
      ? 'Window closed — unfulfilled claims have been resolved.'
      : `Window open until ${formatDate(DATA?.meta?.windowDeadline)}. Unfulfilled links stay "open" until then.`;
  }
}

// ==================== LATEST NEWS ====================
// Only a date (not a time) is stored per item, so "relative time" is approximated
// to whole days — that's the resolution the data actually supports.
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function daysAgo(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return null;
  const today = startOfDay(new Date());
  return Math.round((today - startOfDay(d)) / (24 * 60 * 60 * 1000));
}

function relativeTime(dateStr) {
  const diff = daysAgo(dateStr);
  if (diff === null) return dateStr;
  if (diff <= 0) return 'Today';
  if (diff === 1) return '1 day ago';
  return `${diff} days ago`;
}

function newsItemHTML(item, isPinned) {
  return `
    <div class="news-item${isPinned ? ' pinned' : ''}">
      ${isPinned ? '<div class="news-just-in">Just In</div>' : ''}
      <div class="news-headline">${escapeHtml(item.headline)}</div>
      <div class="news-meta">${escapeHtml(relativeTime(item.date))}${item.source ? ` · ${escapeHtml(item.source)}` : ''}</div>
      <div class="news-summary">${escapeHtml(item.summary)}</div>
    </div>`;
}

function renderNews() {
  const feed = document.getElementById('newsFeed');
  const recent = news
    .filter(n => { const d = daysAgo(n.date); return d !== null && d >= 0 && d <= 5; })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!recent.length) {
    feed.innerHTML = '<div class="empty-state">No breaking news right now.</div>';
    return;
  }
  const [pinned, ...rest] = recent;
  feed.innerHTML = newsItemHTML(pinned, true) + rest.map(n => newsItemHTML(n, false)).join('');
}

// ==================== SEASON AGGREGATES (derived from transfers, not hardcoded) ====================
function seasonAggregate(season) {
  const rows = transfers.filter(t => t.season === season);
  const seasonIns = rows.filter(t => t.type === 'in');
  const seasonOuts = rows.filter(t => t.type === 'out');
  const spend = seasonIns.reduce((s, t) => s + t.fee, 0);
  const spendMax = seasonIns.reduce((s, t) => s + t.feeMax, 0);
  const income = seasonOuts.reduce((s, t) => s + t.fee, 0);
  const incomeMax = seasonOuts.reduce((s, t) => s + t.feeMax, 0);
  return { season, spend, spendMax, income, incomeMax, net: spend - income, netMax: spendMax - incomeMax, rows };
}

function allSeasons() {
  return [...new Set(transfers.map(t => t.season))].sort();
}

function renderHistorySnap() {
  const seasons = allSeasons();
  const html = seasons.map(s => {
    const a = seasonAggregate(s);
    const label = s === currentSeason ? `${s} (current window)` : s;
    const topBuys = a.rows.filter(t => t.type === 'in').sort((x, y) => y.fee - x.fee).slice(0, 4)
      .map(t => `${t.player.split(' ').pop()} £${t.fee}m`).join(', ') || '—';
    return `
      <div style="margin-bottom:0.9rem;padding-bottom:0.9rem;border-bottom:1px solid var(--mufc-border);">
        <strong style="color:var(--mufc-gold)">${label}</strong><br>
        <span style="color:var(--mufc-gray)">${topBuys}</span><br>
        Spend £${a.spend}m (up to £${round1(a.spendMax)}m) | Income £${a.income}m (up to £${round1(a.incomeMax)}m) | Net
        <span style="color:${a.net <= 0 ? 'var(--mufc-red-light)' : 'var(--mufc-green)'}">${a.net >= 0 ? '+' : ''}£${a.net}m</span>
      </div>`;
  }).join('');
  document.getElementById('historySnap').innerHTML = html +
    `<div style="font-size:0.72rem;color:var(--mufc-gray);"><i class="fas fa-info-circle"></i> Figures computed directly from the transfer records in data.json — guaranteed fee basis, with disclosed add-on ceilings shown separately.</div>`;
}

function round1(n) { return Math.round(n * 10) / 10; }

function renderSourceList() {
  const el = document.getElementById('sourceList');
  if (!el) return;
  const list = DATA.meta?.sourceList || [];
  el.innerHTML = list.map(s => `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`).join(' · ');
}

// ==================== CHARTS ====================
function chartColor(varName, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
}

function initCharts() {
  Object.values(charts).forEach(c => c && c.destroy());
  charts = {};

  charts.spend = new Chart(document.getElementById('spendChart'), {
    type: 'doughnut',
    data: { labels: ['Spend (Ins)', 'Income (Outs)'], datasets: [{ data: [totalSpend, totalIncome], backgroundColor: ['#DA291C', '#00C853'], borderWidth: 0, hoverOffset: 8 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: chartColor('--mufc-gray', '#A0A0A0'), padding: 14 } }, tooltip: { callbacks: { label: ctx => ` £${ctx.raw}m` } } } }
  });

  const feePlayers = current.filter(t => t.fee > 0).sort((a, b) => b.fee - a.fee);
  charts.fee = new Chart(document.getElementById('feeBarChart'), {
    type: 'bar',
    data: { labels: feePlayers.map(t => t.player.split(' ').pop()), datasets: [{ label: 'Fee £m', data: feePlayers.map(t => t.type === 'in' ? t.fee : -t.fee), backgroundColor: feePlayers.map(t => t.type === 'in' ? '#DA291C' : '#00C853'), borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => { const t = feePlayers[ctx.dataIndex]; return `${t.type === 'in' ? 'Spend' : 'Income'}: £${Math.abs(ctx.raw)}m`; } } } }, scales: { x: { ticks: { color: '#A0A0A0' }, grid: { color: '#2A2A2A' } }, y: { ticks: { color: chartColor('--text', '#FFFFFF') }, grid: { display: false } } } }
  });

  const clubFees = {};
  current.forEach(t => { if (t.fee > 0) { const c = t.type === 'in' ? t.from : t.to; clubFees[c] = (clubFees[c] || 0) + t.fee; } });
  const clubEntries = Object.entries(clubFees).sort((a, b) => b[1] - a[1]);
  charts.club = new Chart(document.getElementById('clubChart'), {
    type: 'bar',
    data: { labels: clubEntries.map(e => e[0]), datasets: [{ label: 'Volume £m', data: clubEntries.map(e => e[1]), backgroundColor: '#DA291C', borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#A0A0A0', maxRotation: 40 }, grid: { display: false } }, y: { ticks: { color: '#A0A0A0' }, grid: { color: '#2A2A2A' } } } }
  });

  const seasons = allSeasons();
  const seasonAggs = seasons.map(seasonAggregate);
  charts.hist = new Chart(document.getElementById('historyChart'), {
    type: 'line',
    data: {
      labels: seasons.map(s => s === currentSeason ? `${s}*` : s),
      datasets: [{ label: 'Net Spend (£m, guaranteed)', data: seasonAggs.map(a => a.net), borderColor: '#DA291C', backgroundColor: 'rgba(218,41,28,0.12)', fill: true, tension: 0.3, pointBackgroundColor: '#F5C518', pointRadius: 6 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#A0A0A0' } }, tooltip: { callbacks: { label: ctx => ` Net: £${ctx.raw}m` } } }, scales: { x: { ticks: { color: '#A0A0A0' }, grid: { color: '#2A2A2A' } }, y: { ticks: { color: '#A0A0A0' }, grid: { color: '#2A2A2A' }, reverse: true } } }
  });

  const posCount = {};
  current.forEach(t => { posCount[t.position] = (posCount[t.position] || 0) + 1; });
  charts.pos = new Chart(document.getElementById('posChart'), {
    type: 'doughnut',
    data: { labels: Object.keys(posCount), datasets: [{ data: Object.values(posCount), backgroundColor: ['#DA291C', '#00C853', '#FF9100', '#F5C518', '#4FC3F7', '#AB47BC', '#78909C'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#A0A0A0', padding: 12 } } } }
  });
}

// ==================== PLAYER DETAIL MODAL ====================
// Squad info (position/nationality/shirt number/contract) comes from football-data.org
// (free tier) via a Cloudflare Worker proxy that holds the API key privately (see
// stats-proxy-worker.js). We can only reliably resolve a football-data.org player id
// for players currently in Manchester United's registered squad (that's the only
// "search" the free tier gives us — there's no name-search endpoint, and match-level
// stats like goals/assists aren't included on the free tier at all). Every player also
// gets the Wikipedia bio we already fetch for photos; anyone we can't match against the
// squad — most "Outs" and historical loans — just gets that bio, with no error shown.

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalizeName(str) {
  return String(str || '')
    .normalize('NFD').replace(new RegExp('[̀-ͯ]', 'g'), '') // strip accents
    .toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

const SQUAD_CACHE_KEY = 'mufc-squad-cache-v1';
const SQUAD_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const PERSON_CACHE_KEY = 'mufc-person-cache-v2'; // v2: cache shape changed from {bundle} to {person}
const PERSON_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const WIKI_SUMMARY_CACHE_KEY = 'mufc-wiki-summary-cache-v1';
const WIKI_SUMMARY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let squadPromise = null;
function getUnitedSquad() {
  if (!STATS_PROXY_URL) return Promise.resolve(null);
  if (squadPromise) return squadPromise;
  squadPromise = (async () => {
    try {
      const raw = localStorage.getItem(SQUAD_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.ts < SQUAD_CACHE_TTL_MS) return cached.squad;
      }
    } catch { /* ignore bad cache */ }
    try {
      const res = await fetch(`${STATS_PROXY_URL}/team-squad`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const squad = json.squad || [];
      try { localStorage.setItem(SQUAD_CACHE_KEY, JSON.stringify({ squad, ts: Date.now() })); } catch { /* quota */ }
      return squad;
    } catch {
      return null; // proxy unreachable / not deployed yet / rate-limited
    }
  })();
  return squadPromise;
}

function findSquadMatch(t, squad) {
  if (!squad || !squad.length) return null;
  const target = normalizeName(t.photoSeed || t.player);
  let match = squad.find(p => normalizeName(p.name) === target);
  if (match) return match;
  const targetLast = target.split(' ').pop();
  const lastNameMatches = squad.filter(p => normalizeName(p.lastName || '').split(' ').pop() === targetLast);
  return lastNameMatches.length === 1 ? lastNameMatches[0] : null;
}

// football-data.org's free tier never returns real match-level stats — its
// /persons/{id}/matches endpoint responds with an explanatory string instead of
// the aggregations object ("...only available for paid subscriptions"), for every
// player, every time. So we only fetch the bio endpoint, which free tier does serve.
async function fetchPersonInfo(personId) {
  let cache;
  try { cache = JSON.parse(localStorage.getItem(PERSON_CACHE_KEY)) || {}; } catch { cache = {}; }
  const cached = cache[personId];
  if (cached && (Date.now() - cached.ts) < PERSON_CACHE_TTL_MS) return cached.person;

  try {
    const res = await fetch(`${STATS_PROXY_URL}/person/${personId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const person = await res.json();
    cache[personId] = { person, ts: Date.now() };
    try { localStorage.setItem(PERSON_CACHE_KEY, JSON.stringify(cache)); } catch { /* quota */ }
    return person;
  } catch {
    return null;
  }
}

async function fetchWikipediaSummary(name) {
  let cache;
  try { cache = JSON.parse(localStorage.getItem(WIKI_SUMMARY_CACHE_KEY)) || {}; } catch { cache = {}; }
  const cached = cache[name];
  if (cached && (Date.now() - cached.ts) < WIKI_SUMMARY_CACHE_TTL_MS) return cached.data;

  const candidates = [name, `${name} (footballer)`];
  for (const title of candidates) {
    try {
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (json.type === 'disambiguation') continue;
      const data = { extract: json.extract || '', pageUrl: json.content_urls?.desktop?.page || null };
      cache[name] = { data, ts: Date.now() };
      try { localStorage.setItem(WIKI_SUMMARY_CACHE_KEY, JSON.stringify(cache)); } catch { /* quota */ }
      return data;
    } catch { /* try next candidate */ }
  }
  const data = { extract: '', pageUrl: null };
  cache[name] = { data, ts: Date.now() };
  try { localStorage.setItem(WIKI_SUMMARY_CACHE_KEY, JSON.stringify(cache)); } catch { /* quota */ }
  return data;
}

function transferDetailsHTML(t) {
  const feeText = feeDisplayText(t);
  return `
    <div class="modal-section-title">Transfer Details</div>
    <div class="modal-transfer-row"><span class="club-tag">${escapeHtml(t.from)}</span><span class="arrow">→</span><span class="club-tag">${escapeHtml(t.to)}</span></div>
    <div class="modal-transfer-row">${escapeHtml(t.season)} · ${escapeHtml(t.date)} · ${escapeHtml(t.status)} · <strong>${feeText}</strong></div>
    ${t.notes ? `<div class="modal-transfer-row" style="color:var(--mufc-gray);font-size:0.82rem;">${escapeHtml(t.notes)}</div>` : ''}
    ${t.source ? `<div class="source-tag"><i class="fas fa-check-circle"></i> Source: ${escapeHtml(t.source)}</div>` : ''}
  `;
}

function squadInfoHTML(person) {
  const contractUntil = person.currentTeam?.contract?.until;
  return `
    <div class="modal-section-title">Squad Info (football-data.org)</div>
    <div class="modal-transfer-row" style="font-size:0.85rem;">
      ${escapeHtml(person.position || '')}${person.nationality ? ` · ${escapeHtml(person.nationality)}` : ''}${person.shirtNumber ? ` · #${person.shirtNumber}` : ''}${contractUntil ? ` · Contract until ${escapeHtml(contractUntil)}` : ''}
    </div>
  `;
}

function bioHTML(bio) {
  if (!bio || !bio.extract) return '';
  return `
    <div class="modal-section-title">Background</div>
    <div class="modal-bio">${escapeHtml(bio.extract)}${bio.pageUrl ? ` <a href="${bio.pageUrl}" target="_blank" rel="noopener">Read more on Wikipedia</a>` : ''}</div>
  `;
}

async function renderLiveStatsSection(t, container) {
  let squadHTML = '';
  if (STATS_PROXY_URL) {
    const squad = await getUnitedSquad();
    const match = findSquadMatch(t, squad);
    if (match) {
      const person = await fetchPersonInfo(match.id);
      if (person) squadHTML = squadInfoHTML(person);
    }
  }
  const bio = await fetchWikipediaSummary(t.photoSeed || t.player);
  container.innerHTML = squadHTML + bioHTML(bio);
}

function openPlayerModal(t) {
  const seed = t.photoSeed || t.player;
  const bg = t.type === 'in' ? '00C853' : (t.type === 'out' ? 'DA291C' : 'FF9100');
  const content = document.getElementById('playerModalContent');
  content.innerHTML = `
    <div class="modal-header">
      <img class="modal-photo" id="modalPlayerPhoto" data-name="${escapeAttr(seed)}" data-bg="${bg}" src="${avatarUrl(seed, bg)}" alt="${escapeAttr(t.player)}" />
      <div>
        <div class="modal-name" id="modalPlayerName">${escapeHtml(t.player)}</div>
        <div class="modal-subtitle">${escapeHtml(t.position)} · Age ${t.age ?? '—'}</div>
      </div>
    </div>
    ${transferDetailsHTML(t)}
    <div id="modalLiveStats"><div class="modal-loading"><i class="fas fa-spinner fa-spin"></i> Loading player info…</div></div>
  `;
  hydratePhoto(document.getElementById('modalPlayerPhoto'));

  const overlay = document.getElementById('playerModalOverlay');
  overlay.classList.add('show');
  document.getElementById('modalCloseBtn').focus();

  renderLiveStatsSection(t, document.getElementById('modalLiveStats'));
}

function closePlayerModal() {
  document.getElementById('playerModalOverlay').classList.remove('show');
}

// ==================== SHARE ====================
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
function shareTwitter() {
  const text = encodeURIComponent(`Check out this interactive Manchester United Transfer Dashboard 🔴 #MUFC #Transfers`);
  const url = encodeURIComponent(window.location.href);
  window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
}
function copyLink() {
  navigator.clipboard.writeText(window.location.href).then(() => showToast('Link copied!'));
}
function shareDiscord() {
  navigator.clipboard.writeText(`Manchester United Transfer Dashboard: ${window.location.href}`).then(() => showToast('Discord message copied!'));
}

// ==================== INIT ====================
boot();
