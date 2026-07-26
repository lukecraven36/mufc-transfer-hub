/* ==================== MUFC TRANSFER HUB — APP LOGIC ====================
   Data lives in data.json (edit that file to add/update transfers — this
   file recalculates every KPI, chart and history figure from it, so there
   is a single source of truth. */

let DATA = null;      // raw parsed data.json
let transfers = [];   // DATA.transfers
let rumours = [];     // DATA.rumours
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
  currentSeason = DATA.meta?.currentSeason || (transfers[0] && transfers[0].season) || "";

  current = transfers.filter(t => t.season === currentSeason);
  ins = current.filter(t => t.type === "in");
  outs = current.filter(t => t.type === "out");
  loans = current.filter(t => t.type === "loan");
  totalSpend = ins.reduce((s, t) => s + t.fee, 0);
  totalIncome = outs.reduce((s, t) => s + t.fee, 0);
  netSpend = totalSpend - totalIncome;

  document.getElementById('dataDate').textContent = formatDate(DATA.meta?.lastUpdated);

  populateSeasonFilter();
  renderKPIs();
  renderPlayerGrids();
  applyFilters();
  renderTimeline();
  renderClubs();
  renderRumours();
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
function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.section).classList.add('active');
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
function playerCard(t) {
  const feeText = t.fee === 0
    ? (t.status.toLowerCase().includes('free') || t.status.toLowerCase().includes('released') ? 'Free' : 'Loan')
    : `£${t.fee}m${t.feeMax > t.fee ? `–${t.feeMax}m` : ''}`;
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
      <td class="${t.fee > 0 ? (t.type === 'in' ? 'fee-negative' : 'fee-positive') : 'fee-zero'}">${t.fee === 0 ? 'Free' : '£' + t.fee + 'm' + (t.feeMax > t.fee ? `–${t.feeMax}m` : '')}</td>
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
  if (t.type === 'in') return `${t.player} signs from ${t.from}${t.fee > 0 ? ` (£${t.fee}m${t.feeMax > t.fee ? `–${t.feeMax}m` : ''})` : ' (free)'}`;
  if (t.type === 'out') return `${t.player} departs to ${t.to}${t.fee > 0 ? ` (£${t.fee}m${t.feeMax > t.fee ? `–${t.feeMax}m` : ''})` : ' (released)'}`;
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
function renderRumours() {
  document.getElementById('rumourList').innerHTML = rumours.map(r =>
    `<span class="rumour-chip"><i class="fas fa-user-secret"></i> ${r.name} <small style="opacity:0.7">(${r.fee})</small></span>`
  ).join('') + `<div style="margin-top:0.5rem;font-size:0.72rem;color:var(--mufc-gray);"><i class="fas fa-info-circle"></i> Speculative — sourced from press/agent talk, not confirmed deals.</div>`;
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
  const feeText = t.fee === 0
    ? (t.status.toLowerCase().includes('free') || t.status.toLowerCase().includes('released') ? 'Free' : 'Loan')
    : `£${t.fee}m${t.feeMax > t.fee ? `–${t.feeMax}m` : ''}`;
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
