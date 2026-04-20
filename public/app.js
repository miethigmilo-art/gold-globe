'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let globe = null;
let countryData = {};
let eventsData = [];
let backtestChart = null;

// ── Color helpers ────────────────────────────────────────────────────────────
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
  const icons = { war: '⚔️', trade_route: '🚢', sanctions: '🚫', central_bank: '🏦', mining: '⛏️', economic: '📊', geopolitical: '🌐' };
  return icons[type] || '📍';
}

// ── Globe init ───────────────────────────────────────────────────────────────
function initGlobe(countries) {
  countryData = countries;

  const w = window.innerWidth - 340;
  const h = window.innerHeight;
  const wrap = document.getElementById('globe-wrap');
  wrap.style.width = w + 'px';
  wrap.style.height = h + 'px';

  // Globus SOFORT starten — Kugel zeigen ohne Länderdaten
  globe = Globe()(wrap)
    .globeImageUrl('/earth-dark.jpg')
    .backgroundImageUrl('/night-sky.png')
    .backgroundColor('rgba(0,0,0,1)')
    .width(w)
    .height(h)
    .atmosphereAltitude(0.12)
    .pointsData([])
    .pointLat('lat')
    .pointLng('lng')
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
    const nw = window.innerWidth - 340;
    const nh = window.innerHeight;
    wrap.style.width = nw + 'px';
    wrap.style.height = nh + 'px';
    globe.width(nw).height(nh);
  });

  hideLoading();

  // Ländergrenzen im Hintergrund nachladen
  fetch('/api/geojson')
    .then(r => r.json())
    .then(world => {
      if (!world.features) return;
      globe
        .polygonsData(world.features)
        .polygonCapColor(d => {
          const iso = d.properties.ISO_A3 || d.properties.ADM0_A3;
          return scoreToColor(countryData[iso]?.score);
        })
        .polygonSideColor(() => 'rgba(30, 60, 100, 0.2)')
        .polygonStrokeColor(() => 'rgba(60, 100, 160, 0.4)')
        .polygonLabel(d => {
          const iso = d.properties.ISO_A3 || d.properties.ADM0_A3;
          const info = countryData[iso];
          if (!info) return `<div style="background:rgba(10,20,40,.9);padding:8px 12px;border-radius:6px;font-size:13px;color:#e0e6f0">${d.properties.ADMIN || d.properties.NAME}</div>`;
          const color = scoreToColorSolid(info.score);
          return `<div style="background:rgba(10,20,40,.95);padding:10px 14px;border-radius:8px;border:1px solid ${color};max-width:220px">
            <div style="font-size:14px;font-weight:bold;color:${color}">${info.name}</div>
            <div style="font-size:12px;color:#c0d0e0;margin:4px 0">${info.reason}</div>
            <div style="font-size:11px;color:#8090a8">Score: ${info.score > 0 ? '+' : ''}${info.score} • ${info.trend}</div>
          </div>`;
        })
        .onPolygonClick(d => {
          const name = d.properties.ADMIN || d.properties.NAME;
          showCountryPopup(name);
        })
        .polygonsTransitionDuration(800);
    })
    .catch(err => console.error('GeoJSON Fehler:', err));
}

function hideLoading() {
  const el = document.getElementById('loading');
  el.style.opacity = '0';
  setTimeout(() => { el.style.display = 'none'; }, 600);
}

// ── Events list ──────────────────────────────────────────────────────────────
function renderEvents(events) {
  eventsData = events;
  const container = document.getElementById('events-list');
  container.innerHTML = events.map(e => `
    <div class="event-item" onclick="flyToEvent(${e.lat}, ${e.lng})">
      <div class="event-header">
        <span class="event-icon">${eventIcon(e.type)}</span>
        <span class="event-name">${e.name}</span>
        <span class="impact-badge impact-${e.impact}">${e.impact === 'bullish' ? '↑' : e.impact === 'bearish' ? '↓' : '→'}</span>
      </div>
      <div class="event-desc">${e.description}</div>
    </div>
  `).join('');
}

function flyToEvent(lat, lng) {
  if (globe) {
    globe.controls().autoRotate = false;
    globe.pointOfView({ lat, lng, altitude: 1.5 }, 1200);
    setTimeout(() => { globe.controls().autoRotate = true; }, 4000);
  }
}

// ── Gold Price ───────────────────────────────────────────────────────────────
async function loadGoldPrice() {
  try {
    const r = await fetch('/api/gold-price');
    const data = await r.json();
    if (data.current) {
      const history = data.history;
      const prev = history[history.length - 2]?.price;
      const curr = data.current.price;
      const change = prev ? ((curr - prev) / prev * 100) : 0;
      document.getElementById('gold-price-value').textContent = `$${curr.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      document.getElementById('gold-price-change').innerHTML = `<span class="${change >= 0 ? 'positive' : 'negative'}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}%</span>`;
    }
  } catch (e) {
    document.getElementById('gold-price-value').textContent = 'Nicht verfügbar';
  }
}

// ── Country Popup ────────────────────────────────────────────────────────────
async function showCountryPopup(name, iso) {
  document.getElementById('popup-title').textContent = `🌍 ${name}`;
  document.getElementById('popup-body').innerHTML = '<div class="popup-loading"><div class="spinner" style="margin:0 auto 10px"></div>KI analysiert...</div>';
  document.getElementById('popup').classList.add('visible');

  if (globe) globe.controls().autoRotate = false;

  try {
    const r = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: name })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);

    const color = scoreToColorSolid(d.score);
    const scoreStr = d.score > 0 ? `+${d.score}` : String(d.score);

    document.getElementById('popup-body').innerHTML = `
      <div class="popup-score">
        <div class="score-badge" style="background:${color}22;border:2px solid ${color};color:${color}">${scoreStr}</div>
        <div>
          <div style="font-size:14px;font-weight:bold;color:${color}">${d.trend || ''}</div>
          <div class="popup-headline">${d.headline}</div>
        </div>
      </div>

      <div class="popup-section">
        <div class="popup-section-title">📌 Einflussfaktoren</div>
        <ul class="popup-factors">${(d.factors || []).map(f => `<li>${f}</li>`).join('')}</ul>
      </div>

      ${d.recentEvents?.length ? `<div class="popup-section">
        <div class="popup-section-title">📰 Aktuelle Ereignisse</div>
        <ul class="popup-events">${d.recentEvents.map(e => `<li>${e}</li>`).join('')}</ul>
      </div>` : ''}

      ${d.goldRelevance ? `<div class="popup-section">
        <div class="popup-section-title">🥇 Goldrelevanz</div>
        <div style="font-size:12px;color:#b0c0d8">${d.goldRelevance}</div>
      </div>` : ''}

      ${d.outlook ? `<div class="popup-outlook">📅 ${d.outlook}</div>` : ''}
    `;
  } catch (err) {
    document.getElementById('popup-body').innerHTML = `<div style="padding:20px;color:#ff6666;font-size:13px">Fehler: ${err.message}</div>`;
  }
}

function closePopup() {
  document.getElementById('popup').classList.remove('visible');
  if (globe) globe.controls().autoRotate = true;
}

// ── AI Recommendation ────────────────────────────────────────────────────────
async function getRecommendation() {
  const btn = document.getElementById('rec-btn');
  const output = document.getElementById('rec-output');
  btn.disabled = true;
  btn.textContent = '⏳ Analysiere...';
  output.innerHTML = '';

  try {
    const es = new EventSource('/api/recommendation');
    let buffer = '';

    es.onmessage = (e) => {
      if (e.data === '[DONE]') {
        es.close();
        btn.disabled = false;
        btn.textContent = '🔄 Neue Empfehlung';
        return;
      }
      try {
        const { text, error } = JSON.parse(e.data);
        if (error) { output.innerHTML += `<span style="color:#ff6666">${error}</span>`; return; }
        buffer += text;
        // Render markdown-like formatting
        output.innerHTML = buffer
          .replace(/## (.*)/g, '<h2>$1</h2>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\n/g, '<br>');
      } catch {}
    };

    es.onerror = () => {
      es.close();
      btn.disabled = false;
      btn.textContent = '🤖 KI-Empfehlung abrufen';
    };
  } catch (err) {
    output.innerHTML = `<span style="color:#ff6666">${err.message}</span>`;
    btn.disabled = false;
    btn.textContent = '🤖 KI-Empfehlung abrufen';
  }
}

// ── Backtest ─────────────────────────────────────────────────────────────────
async function runBacktest() {
  const btn = document.getElementById('backtest-btn');
  btn.textContent = '⏳ Lädt...';
  btn.disabled = true;

  try {
    const r = await fetch('/api/backtest');
    const d = await r.json();
    if (d.error) throw new Error(d.error);

    const s  = d.stats;
    const sA = d.statsAI;
    const sR = d.realStats;

    const statsEl = document.getElementById('backtest-stats');
    statsEl.innerHTML = `
      <div class="stat-card" style="grid-column:1/-1;background:rgba(20,40,70,0.6);border-color:#2a4a8a">
        <div class="stat-label" style="color:#f0c040;font-size:10px;margin-bottom:6px">⭐ DEIN TRADING BOT (Real)</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
          <div><div class="stat-label">Rendite</div><div class="stat-value" style="color:#44cc88;font-size:14px">${sR.totalReturn}</div></div>
          <div><div class="stat-label">Win-Rate</div><div class="stat-value" style="font-size:14px">${sR.winRate}</div></div>
          <div><div class="stat-label">Profit Factor</div><div class="stat-value" style="font-size:14px">${sR.profitFactor}</div></div>
          <div><div class="stat-label">Max. DD</div><div class="stat-value" style="color:#ff8844;font-size:14px">${sR.maxDrawdown}</div></div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">SMA 20/50 Rendite</div>
        <div class="stat-value" style="color:${parseFloat(s.totalReturn) >= 0 ? '#f0c040' : '#ff4444'};font-size:14px">${s.totalReturn}</div>
        <div class="stat-label" style="margin-top:4px">Max DD: ${s.maxDrawdown}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">🤖 KI-Enhanced Rendite</div>
        <div class="stat-value" style="color:${parseFloat(sA.totalReturn) >= 0 ? '#44cc88' : '#ff4444'};font-size:14px">${sA.totalReturn}</div>
        <div class="stat-label" style="margin-top:4px">Max DD: ${sA.maxDrawdown}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Trades</div>
        <div class="stat-value">${s.totalTrades}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Win-Rate</div>
        <div class="stat-value">${s.winRate}</div>
      </div>
    `;

    // Chart mit 2 Linien
    const ctx = document.getElementById('backtest-chart').getContext('2d');
    if (backtestChart) backtestChart.destroy();

    const labels   = d.equityCurve.map(p => p.date);
    const values   = d.equityCurve.map(p => p.equity);
    const valuesAI = d.equityCurveAI.map(p => p.equity);

    backtestChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'SMA 20/50',
            data: values,
            borderColor: '#f0c040',
            backgroundColor: 'rgba(240,192,64,0.06)',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: true,
            tension: 0.3
          },
          {
            label: '🤖 KI-Enhanced',
            data: valuesAI,
            borderColor: '#44cc88',
            backgroundColor: 'rgba(68,204,136,0.06)',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: '#8090a8', font: { size: 10 }, boxWidth: 12 }
          }
        },
        scales: {
          x: {
            ticks: { color: '#4a6080', font: { size: 9 }, maxTicksLimit: 6 },
            grid: { color: 'rgba(30,50,80,0.5)' }
          },
          y: {
            ticks: { color: '#4a6080', font: { size: 9 }, callback: v => '$' + v.toLocaleString() },
            grid: { color: 'rgba(30,50,80,0.5)' }
          }
        }
      }
    });

    btn.textContent = '🔄 Backtest wiederholen';
    btn.disabled = false;
  } catch (err) {
    document.getElementById('backtest-stats').innerHTML = `<div style="color:#ff6666;font-size:13px">Fehler: ${err.message}</div>`;
    btn.textContent = '📊 Backtest starten';
    btn.disabled = false;
  }
}

// ── Trading Dashboard ────────────────────────────────────────────────────────
const TRADING_BOT_URL = 'https://trading-bot-production-86d8.up.railway.app';

async function loadTrading() {
  const el = document.getElementById('trading-accounts');
  el.innerHTML = '<div style="color:#6080a0;font-size:12px;padding:10px 0">Lädt...</div>';
  try {
    const r = await fetch(`${TRADING_BOT_URL}/api/performance`);
    const d = await r.json();

    const konten = [
      { key: 'mittel',    label: 'Mittel',     farbe: '#60a5fa', risiko: '1.7%' },
      { key: 'aggressiv', label: 'Aggressiv',  farbe: '#fb923c', risiko: '3.7%' },
      { key: 'goldglobe', label: '🤖 GoldGlobe', farbe: '#44cc88', risiko: '1.7% + KI' }
    ];

    el.innerHTML = konten.map(k => {
      const s = d[k.key];
      if (!s) return '';
      const equity = parseFloat(s.aktuellesEquity || 0);
      const pnl    = parseFloat(s.gesamtPnL || 0);
      const dd     = parseFloat(s.drawdown || 0);
      return `
        <div style="background:rgba(15,25,45,0.8);border:1px solid ${k.farbe}33;border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-size:13px;font-weight:600;color:${k.farbe}">${k.label}</div>
            <div style="font-size:10px;color:#6080a0">Risiko: ${k.risiko}</div>
          </div>
          <div style="font-size:22px;font-weight:bold;color:${equity >= 1000 ? '#44cc88' : '#ff6666'};margin-bottom:8px">${equity.toFixed(2)} €</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
            <div style="background:rgba(0,0,0,0.2);border-radius:4px;padding:6px">
              <div style="font-size:9px;color:#6080a0">Trades</div>
              <div style="font-size:13px;font-weight:600">${s.trades}</div>
            </div>
            <div style="background:rgba(0,0,0,0.2);border-radius:4px;padding:6px">
              <div style="font-size:9px;color:#6080a0">Win-Rate</div>
              <div style="font-size:13px;font-weight:600">${s.winRate}%</div>
            </div>
            <div style="background:rgba(0,0,0,0.2);border-radius:4px;padding:6px">
              <div style="font-size:9px;color:#6080a0">Drawdown</div>
              <div style="font-size:13px;font-weight:600;color:${dd > 15 ? '#ff6666' : '#ffcc44'}">${dd.toFixed(1)}%</div>
            </div>
            <div style="background:rgba(0,0,0,0.2);border-radius:4px;padding:6px;grid-column:1/-1">
              <div style="font-size:9px;color:#6080a0">Gesamt PnL</div>
              <div style="font-size:13px;font-weight:600;color:${pnl >= 0 ? '#44cc88' : '#ff6666'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} €</div>
            </div>
          </div>
        </div>`;
    }).join('');

  } catch (err) {
    el.innerHTML = `<div style="color:#ff6666;font-size:12px">Fehler: ${err.message}</div>`;
  }
}

async function triggerAdjust() {
  const btn = document.getElementById('adjust-btn');
  const out = document.getElementById('adjust-output');
  btn.disabled = true;
  btn.textContent = '⏳ KI analysiert...';
  out.textContent = '';
  try {
    const r = await fetch(`${TRADING_BOT_URL}/api/auto-adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategie: 'goldglobe' })
    });
    const d = await r.json();
    const res = d.ergebnisse?.goldglobe;
    if (res?.status === 'adjusted') {
      out.innerHTML = `✅ Angepasst: SL → ${res.newSL} | TP → ${res.newTP}<br>Sentiment: ${res.view?.sentiment} (${res.view?.confidence}% Konfidenz)`;
    } else if (res?.status === 'no_position') {
      out.textContent = '⏭️ Keine offene Position gerade';
    } else if (res?.status === 'low_confidence') {
      out.textContent = `⏭️ Konfidenz zu niedrig (${res.confidence}%)`;
    } else if (res?.status === 'no_change') {
      out.textContent = '⏭️ KI sagt: alles behalten';
    } else {
      out.textContent = JSON.stringify(res);
    }
  } catch (err) {
    out.textContent = 'Fehler: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = '🤖 KI SL/TP jetzt anpassen (GoldGlobe)';
}

// Auto-refresh Trading Tab alle 30s wenn aktiv
setInterval(() => {
  if (document.getElementById('tab-trading').classList.contains('active')) {
    loadTrading();
  }
}, 30000);

// ── Auto-Signal ──────────────────────────────────────────────────────────────
let autoTimer = null;

async function sendSignal(dryRun = false) {
  const strategie = document.getElementById('signal-strategie').value;
  const output = document.getElementById('signal-output');
  output.innerHTML = '<span style="color:#6080a0">⏳ KI analysiert Weltlage...</span>';

  try {
    const r = await fetch('/api/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategie, dryRun })
    });
    const d = await r.json();

    if (d.status === 'skipped') {
      output.innerHTML = `<div style="color:#ffcc00;padding:10px;background:rgba(255,200,0,.08);border-radius:6px;border-left:3px solid #ffcc00">
        ⏸️ <strong>Kein Signal</strong><br>
        <span style="font-size:11px">${d.reason}</span>
      </div>`;
      addLog('⏸️ Kein Signal: ' + d.reason, dryRun);
      return;
    }

    const s = d.signal;
    const color = s.signal === 'BUY' ? '#44cc88' : '#ff4444';
    const icon = s.signal === 'BUY' ? '📈' : '📉';

    output.innerHTML = `
      <div style="background:rgba(20,40,60,.8);border:1px solid ${color}44;border-radius:8px;padding:12px">
        <div style="font-size:18px;font-weight:bold;color:${color};margin-bottom:8px">${icon} ${s.signal} ${dryRun ? '<span style="font-size:11px;color:#6080a0">(Dry Run)</span>' : ''}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
          <div><span style="color:#6080a0">Konfidenz</span><br><strong style="color:#f0c040">${s.confidence}%</strong></div>
          <div><span style="color:#6080a0">Stop Loss</span><br><strong style="color:#ff4444">$${s.sl}</strong></div>
          <div><span style="color:#6080a0">Take Profit</span><br><strong style="color:#44cc88">$${s.tp}</strong></div>
          <div><span style="color:#6080a0">Status</span><br><strong style="color:#90b8e0">${dryRun ? 'Test' : '✅ Gesendet'}</strong></div>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#8090a8">${s.reason}</div>
        ${d.botResponse?.error ? `<div style="color:#ff6666;font-size:11px;margin-top:6px">Bot Fehler: ${d.botResponse.error}</div>` : ''}
      </div>
    `;

    addLog(`${icon} ${s.signal} | Konfidenz: ${s.confidence}% | SL: $${s.sl} | TP: $${s.tp}`, dryRun);
  } catch (err) {
    output.innerHTML = `<span style="color:#ff6666">Fehler: ${err.message}</span>`;
  }
}

function addLog(msg, dryRun) {
  const log = document.getElementById('signal-log');
  const time = new Date().toLocaleTimeString('de-DE');
  const tag = dryRun ? ' <span style="color:#4a6080">[Test]</span>' : '';
  log.innerHTML = `<div>${time} — ${msg}${tag}</div>` + log.innerHTML;
}

function toggleAuto() {
  const btn = document.getElementById('auto-btn');
  const status = document.getElementById('auto-status');

  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
    btn.textContent = '▶ Starten';
    btn.style.color = '#6090c0';
    status.textContent = '';
    return;
  }

  const mins = parseInt(document.getElementById('auto-interval').value) || 60;
  const ms = mins * 60 * 1000;

  sendSignal(false);
  autoTimer = setInterval(() => sendSignal(false), ms);

  btn.textContent = '⏹ Stoppen';
  btn.style.color = '#ff6666';
  status.textContent = `✅ Läuft — nächstes Signal in ${mins} Minuten`;
  addLog(`Auto-Signal gestartet (alle ${mins} Min)`, false);
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'trading') loadTrading();
  });
});

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // 1. Globus sofort starten (leere Daten)
  initGlobe({});

  // 2. Restliche Daten parallel im Hintergrund laden
  loadGoldPrice();
  setInterval(loadGoldPrice, 300000);

  // Länder + Events parallel laden
  Promise.all([
    fetch('/api/countries').then(r => r.json()).catch(() => ({})),
    fetch('/api/events').then(r => r.json()).catch(() => [])
  ]).then(([countries, events]) => {
    if (events && Array.isArray(events)) renderEvents(events);
    if (countries && !countries.error && Object.keys(countries).length > 0) {
      countryData = countries;
      // Länderfarben aktualisieren ohne Globus neu zu bauen
      if (globe) globe.polygonCapColor(d => {
        const iso = d.properties.ISO_A3 || d.properties.ADM0_A3;
        return scoreToColor(countryData[iso]?.score);
      });
      // Events auf Globus anzeigen
      if (globe && eventsData.length > 0) globe.pointsData(eventsData);
    }
  });
}

init();
