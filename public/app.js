'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let globe        = null;
let countryData  = {};
let eventsData   = [];
let currentTicker = 'GC=F';
let autoTimer    = null;
let lastIndicators = null;

const TICKER_LABELS = {
  'GC=F': 'XAU / USD', 'SI=F': 'XAG / USD', 'CL=F': 'WTI / USD',
  'SPY': 'S&P 500 ETF', 'QQQ': 'NASDAQ 100', 'NVDA': 'NVIDIA',
  'AAPL': 'APPLE', 'BTC-USD': 'BTC / USD', 'ETH-USD': 'ETH / USD'
};

// ── Color helpers ─────────────────────────────────────────────────────────────
function scoreToColor(score) {
  if (score === undefined || score === null) return 'rgba(40, 60, 100, 0.6)';
  if (score >= 3)  return 'rgba(0, 170, 68, 0.85)';
  if (score >= 1)  return 'rgba(136, 204, 0, 0.85)';
  if (score >= -1) return 'rgba(255, 204, 0, 0.85)';
  if (score >= -3) return 'rgba(255, 102, 0, 0.85)';
  return 'rgba(204, 34, 0, 0.85)';
}
function scoreToColorSolid(score) {
  if (score === undefined || score === null) return '#283c64';
  if (score >= 3)  return '#00aa44';
  if (score >= 1)  return '#88cc00';
  if (score >= -1) return '#ffcc00';
  if (score >= -3) return '#ff6600';
  return '#cc2200';
}
function eventIcon(type) {
  return { war:'⚔️', trade_route:'🚢', sanctions:'🚫', central_bank:'🏦', mining:'⛏️', economic:'📊', geopolitical:'🌐', earnings:'📈', regulation:'⚖️', macro:'🏛️' }[type] || '📍';
}
function regimeColor(r) {
  return { bull:'#00aa44', uptrend:'#44cc88', neutral:'#ffcc00', range:'#6090b0', downtrend:'#ff6600', bear:'#ff4444', volatile:'#cc44ff', crash:'#ff0044' }[r] || '#6090b0';
}
function dirColor(d) { return d === 'BUY' ? '#44cc88' : d === 'SELL' ? '#ff4444' : '#ffcc00'; }

// ── Ticker Switch ─────────────────────────────────────────────────────────────
function switchTicker(ticker) {
  currentTicker = ticker;
  document.querySelectorAll('.ticker-btn').forEach(b => b.classList.toggle('active', b.dataset.ticker === ticker));
  const el = document.getElementById('price-label');
  if (el) el.textContent = TICKER_LABELS[ticker] || ticker;
  document.getElementById('gold-price-value').textContent = '—';
  document.getElementById('gold-price-change').textContent = '';
  document.getElementById('confluence-label').textContent = 'Confluence — Lade...';
  document.getElementById('analytics-content').innerHTML = '<div class="loading-msg">Lade Indikatoren...</div>';
  const lg = document.getElementById('legend-title');
  if (lg) lg.textContent = `Einfluss auf ${ticker.replace('=F','').replace('-USD','')}`;

  loadGoldPrice();
  loadIndicators();

  // Globe neu färben
  countryData = {};
  fetch(`/api/countries?ticker=${encodeURIComponent(currentTicker)}`).then(r=>r.json()).then(d=>{
    if (!d.error) {
      countryData = d;
      if (globe) globe.polygonCapColor(x=>scoreToColor(countryData[x.properties.ISO_A3||x.properties.ADM0_A3]?.score));
    }
  }).catch(()=>{});
  fetch(`/api/events?ticker=${encodeURIComponent(currentTicker)}`).then(r=>r.json()).then(d=>{
    if (Array.isArray(d)) { renderEvents(d); if (globe) globe.pointsData(d); }
  }).catch(()=>{});
}

// ── Globe ─────────────────────────────────────────────────────────────────────
function initGlobe(countries) {
  countryData = countries;
  const w = window.innerWidth - 370, h = window.innerHeight;
  const wrap = document.getElementById('globe-wrap');
  wrap.style.width = w + 'px';
  wrap.style.height = h + 'px';

  globe = Globe()(wrap)
    .globeImageUrl('/earth-dark.jpg')
    .backgroundImageUrl('/night-sky.png')
    .backgroundColor('rgba(0,0,0,1)')
    .width(w).height(h)
    .atmosphereAltitude(0.12)
    .pointsData([])
    .pointLat('lat').pointLng('lng')
    .pointColor(d => d.impact === 'bullish' ? '#44cc88' : d.impact === 'bearish' ? '#ff4444' : '#ffcc00')
    .pointRadius(d => d.magnitude * 0.3 + 0.2)
    .pointAltitude(0.02)
    .pointLabel(d => `<div style="background:rgba(10,20,40,.95);padding:8px 12px;border-radius:6px;border:1px solid #2a4a6a;max-width:200px">
      <div style="font-size:13px;font-weight:bold;color:#f0c040">${eventIcon(d.type)} ${d.name}</div>
      <div style="font-size:11px;color:#b0c0d8;margin-top:4px">${d.description}</div>
    </div>`);

  globe.controls().autoRotate = true;
  globe.controls().autoRotateSpeed = 0.3;

  window.addEventListener('resize', () => {
    const nw = window.innerWidth - 370, nh = window.innerHeight;
    wrap.style.width = nw + 'px'; wrap.style.height = nh + 'px';
    globe.width(nw).height(nh);
  });

  hideLoading();

  fetch('/api/geojson').then(r=>r.json()).then(world => {
    if (!world.features) return;
    globe.polygonsData(world.features)
      .polygonCapColor(d => {
        const iso = d.properties.ISO_A3 || d.properties.ADM0_A3;
        return scoreToColor(countryData[iso]?.score);
      })
      .polygonSideColor(() => 'rgba(30, 60, 100, 0.2)')
      .polygonStrokeColor(() => 'rgba(60, 100, 160, 0.4)')
      .polygonLabel(d => {
        const iso  = d.properties.ISO_A3 || d.properties.ADM0_A3;
        const info = countryData[iso];
        if (!info) return `<div style="background:rgba(10,20,40,.9);padding:8px 12px;border-radius:6px;font-size:13px;color:#e0e6f0">${d.properties.ADMIN||d.properties.NAME}</div>`;
        const color = scoreToColorSolid(info.score);
        return `<div style="background:rgba(10,20,40,.95);padding:10px 14px;border-radius:8px;border:1px solid ${color};max-width:220px">
          <div style="font-size:14px;font-weight:bold;color:${color}">${info.name}</div>
          <div style="font-size:12px;color:#c0d0e0;margin:4px 0">${info.reason}</div>
          <div style="font-size:11px;color:#8090a8">Score: ${info.score>0?'+':''}${info.score} • ${info.trend}</div>
        </div>`;
      })
      .onPolygonClick(d => showCountryPopup(d.properties.ADMIN || d.properties.NAME))
      .polygonsTransitionDuration(800);
  }).catch(err => console.error('GeoJSON:', err));
}

function hideLoading() {
  const el = document.getElementById('loading');
  el.style.opacity = '0';
  setTimeout(() => { el.style.display = 'none'; }, 600);
}

// ── Events ────────────────────────────────────────────────────────────────────
function renderEvents(events) {
  eventsData = events;
  const container = document.getElementById('events-list');
  container.innerHTML = events.map(e => `
    <div class="event-item" onclick="flyToEvent(${e.lat}, ${e.lng})">
      <div class="event-header">
        <span class="event-icon">${eventIcon(e.type)}</span>
        <span class="event-name">${e.name}</span>
        <span class="impact-badge impact-${e.impact}">${e.impact==='bullish'?'↑':e.impact==='bearish'?'↓':'→'}</span>
      </div>
      <div class="event-desc">${e.description}</div>
    </div>
  `).join('');
}
function flyToEvent(lat, lng) {
  if (globe) { globe.controls().autoRotate = false; globe.pointOfView({ lat, lng, altitude: 1.5 }, 1200); setTimeout(() => { globe.controls().autoRotate = true; }, 4000); }
}

// ── Price ─────────────────────────────────────────────────────────────────────
async function loadGoldPrice() {
  try {
    const r = await fetch(`/api/gold-price?ticker=${encodeURIComponent(currentTicker)}`);
    const data = await r.json();
    if (data.current) {
      const history = data.history;
      const prev    = history[history.length - 2]?.price;
      const curr    = data.current.price;
      const change  = prev ? ((curr - prev) / prev * 100) : 0;
      document.getElementById('gold-price-value').textContent = `$${curr.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      document.getElementById('gold-price-change').innerHTML = `<span class="${change >= 0 ? 'positive' : 'negative'}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}%</span>`;
    }
  } catch (e) { document.getElementById('gold-price-value').textContent = 'N/A'; }
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────
async function loadIndicators() {
  try {
    const r = await fetch(`/api/indicators?ticker=${encodeURIComponent(currentTicker)}`);
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    lastIndicators = d;
    renderAnalytics(d);
    renderConfluenceMeter(d.confluence, d.regime, d.session);
    renderRegimeBadge(d.regime);
  } catch (e) {
    document.getElementById('analytics-content').innerHTML = `<div style="color:#ff6666;padding:12px;font-size:12px">Fehler: ${e.message}</div>`;
  }
}

function renderRegimeBadge(regime) {
  const el = document.getElementById('regime-badge');
  if (!el) return;
  const labels = { bull:'BULL TREND', uptrend:'UPTREND', neutral:'NEUTRAL', range:'RANGING', downtrend:'DOWNTREND', bear:'BEAR TREND', volatile:'VOLATILE', crash:'CRASH' };
  el.textContent = labels[regime] || regime.toUpperCase();
  el.style.color  = regimeColor(regime);
  el.style.borderColor = regimeColor(regime);
  el.style.display = 'block';
}

function renderConfluenceMeter(conf, regime, session) {
  if (!conf) return;
  const label  = document.getElementById('confluence-label');
  const fill   = document.getElementById('confluence-fill');
  const meta   = document.getElementById('confluence-meta');
  const dir    = conf.direction;
  const color  = dirColor(dir);
  const pct    = conf.pct; // 0-100 where 50 = neutral

  label.innerHTML = `Confluence <span style="color:${color};font-weight:700">${dir}</span> <span style="color:#6090b0">${conf.score > 0 ? '+' : ''}${conf.score}/${conf.maxScore} · ${conf.strength}</span>`;
  fill.style.width = pct + '%';
  fill.style.background = color;
  meta.innerHTML = `<span style="color:${regimeColor(regime)}">${regime.toUpperCase()}</span> · <span style="color:${session?.tradeable ? '#44cc88' : '#ff8844'}">${session?.label || '—'}</span> · ${session?.utcTime || ''}`;
}

function renderAnalytics(d) {
  const conf = d.confluence;
  const ind  = d;
  const r    = (v, dec=1) => v !== null && v !== undefined ? v.toFixed(dec) : '—';

  // RSI-Farbe
  const rsiColor = !ind.rsi ? '#6090b0' : ind.rsi > 70 ? '#ff4444' : ind.rsi < 30 ? '#44cc88' : ind.rsi > 55 ? '#88cc00' : '#ffcc00';
  const macdColor = ind.macd?.histogram > 0 ? '#44cc88' : '#ff4444';

  const html = `
    <div class="analytics-section">
      <div class="analytics-title">Technische Indikatoren</div>
      <div class="ind-grid">
        <div class="ind-cell">
          <div class="ind-label">RSI 14</div>
          <div class="ind-val" style="color:${rsiColor}">${r(ind.rsi)}</div>
        </div>
        <div class="ind-cell">
          <div class="ind-label">MACD Hist</div>
          <div class="ind-val" style="color:${macdColor}">${r(ind.macd?.histogram,4)}</div>
        </div>
        <div class="ind-cell">
          <div class="ind-label">ADX</div>
          <div class="ind-val" style="color:${ind.adx?.trending ? '#f0c040' : '#6090b0'}">${r(ind.adx?.adx)} ${ind.adx?.trending ? '▲' : ''}</div>
        </div>
        <div class="ind-cell">
          <div class="ind-label">Stoch K/D</div>
          <div class="ind-val">${r(ind.stoch?.k)} / ${r(ind.stoch?.d)}</div>
        </div>
        <div class="ind-cell">
          <div class="ind-label">BB Position</div>
          <div class="ind-val">${ind.bb ? (ind.bb.pct * 100).toFixed(0) + '%' : '—'}</div>
        </div>
        <div class="ind-cell">
          <div class="ind-label">ATR</div>
          <div class="ind-val">$${r(ind.atr,2)}</div>
        </div>
        <div class="ind-cell">
          <div class="ind-label">Vol Ratio</div>
          <div class="ind-val" style="color:${ind.volR > 1.3 ? '#f0c040' : '#8090a8'}">×${r(ind.volR,2)}</div>
        </div>
        <div class="ind-cell">
          <div class="ind-label">Momentum 20d</div>
          <div class="ind-val" style="color:${ind.mom20 > 0 ? '#44cc88' : '#ff4444'}">${ind.mom20 > 0 ? '+' : ''}${r(ind.mom20)}%</div>
        </div>
      </div>
    </div>

    <div class="analytics-section">
      <div class="analytics-title">Moving Averages</div>
      <div class="ma-table">
        ${[['SMA 20', ind.sma20], ['SMA 50', ind.sma50], ['SMA 200', ind.sma200], ['EMA 9', ind.ema9], ['EMA 21', ind.ema21]].map(([name, val]) => {
          if (!val || !ind.curr) return '';
          const above = ind.curr > val;
          return `<div class="ma-row">
            <span class="ma-name">${name}</span>
            <span class="ma-val">$${val.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
            <span style="color:${above ? '#44cc88' : '#ff4444'};font-size:10px">${above ? '▲ über' : '▼ unter'}</span>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="analytics-section">
      <div class="analytics-title">Confluence-Signale (${conf.score > 0 ? '+' : ''}${conf.score} / ${conf.maxScore})</div>
      <div class="signal-list">
        ${conf.signals.map(s => `
          <div class="signal-row">
            <span class="signal-dot" style="background:${s.bull === true ? '#44cc88' : s.bull === false ? '#ff4444' : '#6090b0'}"></span>
            <span class="signal-name">${s.name}</span>
            <span class="signal-val" style="color:${s.bull === true ? '#44cc88' : s.bull === false ? '#ff6666' : '#6090b0'}">${s.val}</span>
          </div>
        `).join('')}
      </div>
    </div>

    ${d.risk ? `<div class="analytics-section">
      <div class="analytics-title">Empfohlenes Risk-Setup</div>
      <div class="ind-grid">
        <div class="ind-cell">
          <div class="ind-label">Entry</div>
          <div class="ind-val">$${d.curr?.toFixed(2)}</div>
        </div>
        <div class="ind-cell">
          <div class="ind-label">Stop-Loss</div>
          <div class="ind-val" style="color:#ff4444">$${d.risk.sl}</div>
        </div>
        <div class="ind-cell">
          <div class="ind-label">Take-Profit</div>
          <div class="ind-val" style="color:#44cc88">$${d.risk.tp}</div>
        </div>
        <div class="ind-cell">
          <div class="ind-label">R:R Ratio</div>
          <div class="ind-val" style="color:#f0c040">1 : ${d.risk.rr}</div>
        </div>
      </div>
    </div>` : ''}
  `;

  document.getElementById('analytics-content').innerHTML = html;
}

// ── Country Popup ─────────────────────────────────────────────────────────────
async function showCountryPopup(name) {
  document.getElementById('popup-title').textContent = `🌍 ${name}`;
  document.getElementById('popup-body').innerHTML = '<div class="popup-loading"><div class="spinner" style="margin:0 auto 10px"></div>KI analysiert...</div>';
  document.getElementById('popup').classList.add('visible');
  if (globe) globe.controls().autoRotate = false;
  try {
    const r = await fetch('/api/analyze', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ country: name, ticker: currentTicker }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    const color = scoreToColorSolid(d.score);
    const scoreStr = d.score > 0 ? `+${d.score}` : String(d.score);
    document.getElementById('popup-body').innerHTML = `
      <div class="popup-score">
        <div class="score-badge" style="background:${color}22;border:2px solid ${color};color:${color}">${scoreStr}</div>
        <div><div style="font-size:14px;font-weight:bold;color:${color}">${d.trend||''}</div><div class="popup-headline">${d.headline}</div></div>
      </div>
      <div class="popup-section"><div class="popup-section-title">📌 Einflussfaktoren</div><ul class="popup-factors">${(d.factors||[]).map(f=>`<li>${f}</li>`).join('')}</ul></div>
      ${d.recentEvents?.length?`<div class="popup-section"><div class="popup-section-title">📰 Aktuelle Ereignisse</div><ul class="popup-events">${d.recentEvents.map(e=>`<li>${e}</li>`).join('')}</ul></div>`:''}
      ${d.assetRelevance?`<div class="popup-section"><div class="popup-section-title">📊 Relevanz für ${currentTicker}</div><div style="font-size:12px;color:#b0c0d8">${d.assetRelevance}</div></div>`:''}
      ${d.outlook?`<div class="popup-outlook">📅 ${d.outlook}</div>`:''}
    `;
  } catch (err) { document.getElementById('popup-body').innerHTML = `<div style="padding:20px;color:#ff6666;font-size:13px">Fehler: ${err.message}</div>`; }
}
function closePopup() { document.getElementById('popup').classList.remove('visible'); if (globe) globe.controls().autoRotate = true; }

// ── Signal ────────────────────────────────────────────────────────────────────
async function sendSignal(dryRun = false) {
  const strategie = document.getElementById('signal-strategie').value;
  const output    = document.getElementById('signal-output');
  output.innerHTML = '<span style="color:#6080a0;font-size:11px">⏳ Analysiere Indikatoren + Makro...</span>';

  try {
    const r = await fetch('/api/signal', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ strategie, dryRun, ticker: currentTicker })
    });
    const d = await r.json();

    if (d.status === 'skipped') {
      output.innerHTML = `<div class="signal-skip">
        ⏸️ <strong>Kein Signal</strong><br>
        <span style="font-size:11px;color:#8090a8">${d.reason}</span>
        ${d.confluence ? `<br><span style="font-size:10px;color:#4a6080">Confluence: ${d.confluence.score}/${d.confluence.maxScore} | Regime: ${d.regime||'—'}</span>` : ''}
      </div>`;
      addLog('⏸️ ' + d.reason, dryRun);
      return;
    }

    const color = d.signal === 'BUY' ? '#44cc88' : '#ff4444';
    const icon  = d.signal === 'BUY' ? '📈' : '📉';
    output.innerHTML = `
      <div class="signal-card" style="border-color:${color}44">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:18px;font-weight:bold;color:${color}">${icon} ${d.signal} ${dryRun?'<span style="font-size:10px;color:#4a6080">[Test]</span>':''}</div>
          <div style="font-size:11px;color:#f0c040">${d.confidence}% Konfidenz</div>
        </div>
        <div class="sig-grid">
          <div><span class="sig-lbl">Stop-Loss</span><br><strong style="color:#ff4444">$${d.payload?.sl}</strong></div>
          <div><span class="sig-lbl">Take-Profit</span><br><strong style="color:#44cc88">$${d.payload?.tp}</strong></div>
          <div><span class="sig-lbl">R:R</span><br><strong style="color:#f0c040">1:${d.risk?.rr||'—'}</strong></div>
          <div><span class="sig-lbl">Regime</span><br><strong style="color:${regimeColor(d.regime||'neutral')}">${(d.regime||'—').toUpperCase()}</strong></div>
          <div><span class="sig-lbl">Confluence</span><br><strong style="color:${color}">${d.confluence?.score||'—'}/${d.confluence?.maxScore||13}</strong></div>
          <div><span class="sig-lbl">Session</span><br><strong style="color:${d.session?.tradeable?'#44cc88':'#ff8844'}">${d.session?.label||'—'}</strong></div>
        </div>
        ${d.reason?`<div style="margin-top:8px;font-size:11px;color:#8090a8">${d.reason}</div>`:''}
        ${d.botResponse?.error?`<div style="color:#ff6666;font-size:11px;margin-top:6px">Bot Fehler: ${d.botResponse.error}</div>`:''}
      </div>
    `;
    addLog(`${icon} ${d.signal} | ${d.confidence}% | Conf:${d.confluence?.score} | R:R ${d.risk?.rr}`, dryRun);
  } catch (err) {
    output.innerHTML = `<span style="color:#ff6666;font-size:12px">Fehler: ${err.message}</span>`;
  }
}

function addLog(msg, dryRun) {
  const log  = document.getElementById('signal-log');
  const time = new Date().toLocaleTimeString('de-DE');
  const tag  = dryRun ? ' <span style="color:#4a6080">[Test]</span>' : '';
  log.innerHTML = `<div>${time} — ${msg}${tag}</div>` + log.innerHTML;
}

function toggleAuto() {
  const btn    = document.getElementById('auto-btn');
  const status = document.getElementById('auto-status');
  if (autoTimer) {
    clearInterval(autoTimer); autoTimer = null;
    btn.textContent = '▶ Start'; btn.style.color = '';
    status.textContent = ''; return;
  }
  const mins = parseInt(document.getElementById('auto-interval').value) || 60;
  sendSignal(false);
  autoTimer = setInterval(() => sendSignal(false), mins * 60 * 1000);
  btn.textContent = '⏹ Stop'; btn.style.color = '#ff6666';
  status.textContent = `✅ Läuft — alle ${mins} Min`;
  addLog(`Auto gestartet (alle ${mins} Min)`, false);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  initGlobe({});

  document.querySelectorAll('.ticker-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTicker(btn.dataset.ticker));
  });

  loadGoldPrice();
  loadIndicators();
  setInterval(loadGoldPrice, 300000);
  setInterval(loadIndicators, 120000); // Indikatoren alle 2min

  Promise.all([
    fetch(`/api/countries?ticker=${encodeURIComponent(currentTicker)}`).then(r=>r.json()).catch(()=>({})),
    fetch(`/api/events?ticker=${encodeURIComponent(currentTicker)}`).then(r=>r.json()).catch(()=>[])
  ]).then(([countries, events]) => {
    if (events && Array.isArray(events)) renderEvents(events);
    if (countries && !countries.error && Object.keys(countries).length > 0) {
      countryData = countries;
      if (globe) globe.polygonCapColor(d => {
        const iso = d.properties.ISO_A3 || d.properties.ADM0_A3;
        return scoreToColor(countryData[iso]?.score);
      });
      if (globe && eventsData.length > 0) globe.pointsData(eventsData);
    }
  });
}

init();
