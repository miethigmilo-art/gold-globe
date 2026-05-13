'use strict';
// ── Neural Network Visualization ─────────────────────────────────────────────
// Canvas-basiert, zeigt Datenfluss des Trading-Bot-Gehirns als animiertes Netz

(function() {

const canvas  = document.getElementById('neural-canvas');
if (!canvas) return;
const ctx     = canvas.getContext('2d');
let W, H;
let nodes     = {};
let edges     = [];
let particles = [];
let animFrame = null;
let lastFetch = 0;

// ── Node Layout (relative Positionen 0-1) ─────────────────────────────────────
const NODE_LAYOUT = {
  marketData:  { x: 0.12, y: 0.20, emoji: '📡' },
  extBots:     { x: 0.12, y: 0.70, emoji: '🤝' },
  indicators:  { x: 0.32, y: 0.20, emoji: '📊' },
  regime:      { x: 0.32, y: 0.45, emoji: '🌊' },
  confluence:  { x: 0.50, y: 0.32, emoji: '⚡' },
  session:     { x: 0.50, y: 0.65, emoji: '🕐' },
  claudeAI:    { x: 0.68, y: 0.32, emoji: '🧠' },
  riskMgr:     { x: 0.68, y: 0.60, emoji: '🛡️' },
  positions:   { x: 0.86, y: 0.30, emoji: '💼' },
  botWebhook:  { x: 0.86, y: 0.58, emoji: '🔗' },
  obsidian:    { x: 0.86, y: 0.80, emoji: '📁' },
};

const NODE_RADIUS = () => Math.min(W, H) * 0.048;
const COLORS = { BUY: '#44cc88', SELL: '#ff4444', neutral: '#f0c040', active: '#60a5fa', idle: '#2a3a5a', blocked: '#ff8844' };

// ── Particle System ───────────────────────────────────────────────────────────
function spawnParticle(fromId, toId, color) {
  const from = getNodePos(fromId);
  const to   = getNodePos(toId);
  if (!from || !to) return;
  const speed = 0.4 + Math.random() * 0.4;
  particles.push({ x: from.x, y: from.y, tx: to.x, ty: to.y, t: 0, speed, color, size: 2.5 + Math.random() * 2 });
}

function getNodePos(id) {
  const layout = NODE_LAYOUT[id];
  if (!layout) return null;
  return { x: layout.x * W, y: layout.y * H };
}

// ── Draw ──────────────────────────────────────────────────────────────────────
function resize() {
  const container = canvas.parentElement;
  W = canvas.width  = container.clientWidth  || 600;
  H = canvas.height = container.clientHeight || 400;
}

function hexToRgb(hex, a = 1) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function drawEdge(edge) {
  const from = getNodePos(edge.from);
  const to   = getNodePos(edge.to);
  if (!from || !to) return;

  const color = edge.active
    ? (edge.dir === 'BUY' ? COLORS.BUY : edge.dir === 'SELL' ? COLORS.SELL : COLORS.neutral)
    : COLORS.idle;
  const alpha = edge.active ? 0.35 : 0.12;

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);

  // Bezier-Kurve für schöne Bögen
  const cx = (from.x + to.x) / 2 + (to.y - from.y) * 0.15;
  const cy = (from.y + to.y) / 2 + (from.x - to.x) * 0.15;
  ctx.quadraticCurveTo(cx, cy, to.x, to.y);

  ctx.strokeStyle = hexToRgb(color.startsWith('#') ? color : '#f0c040', alpha);
  ctx.lineWidth   = edge.active ? 1.5 : 0.8;
  ctx.stroke();
}

function drawNode(id, data) {
  const layout = NODE_LAYOUT[id];
  if (!layout) return;
  const x  = layout.x * W;
  const y  = layout.y * H;
  const r  = NODE_RADIUS();
  const nd = nodes[id] || data || {};

  const statusColor = nd.status === 'active' ? nd.color || COLORS.active
                    : nd.status === 'blocked' ? COLORS.blocked
                    : nd.status === 'standby' ? '#4a6090'
                    : COLORS.idle;

  // Glow bei active
  if (nd.status === 'active' || nd.status === 'standby') {
    const grad = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 1.8);
    grad.addColorStop(0, hexToRgb(statusColor, 0.18));
    grad.addColorStop(1, hexToRgb(statusColor, 0));
    ctx.beginPath();
    ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Node body
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0c1828';
  ctx.fill();
  ctx.strokeStyle = statusColor;
  ctx.lineWidth   = nd.status === 'active' ? 2 : 1;
  ctx.stroke();

  // Emoji
  ctx.font      = `${r * 0.7}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(layout.emoji, x, y - r * 0.1);

  // Label
  ctx.font      = `bold ${Math.max(9, r * 0.28)}px 'JetBrains Mono', monospace`;
  ctx.fillStyle = nd.status === 'active' ? '#e0e8f8' : '#4a6080';
  ctx.fillText(nd.label || id, x, y + r + 12);

  // Value (kleiner darunter)
  if (nd.value) {
    ctx.font      = `${Math.max(8, r * 0.22)}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = statusColor;
    ctx.fillText(String(nd.value).substring(0, 16), x, y + r + 24);
  }
}

function drawParticles(dt) {
  const alive = [];
  for (const p of particles) {
    p.t += p.speed * dt * 0.001;
    if (p.t >= 1) continue;

    const ex = p.tx - p.x, ey = p.ty - p.y;
    const px  = p.x + ex * p.t;
    const py  = p.y + ey * p.t;

    ctx.beginPath();
    ctx.arc(px, py, p.size, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgb(p.color, 0.9 - p.t * 0.5);
    ctx.fill();
    alive.push(p);
  }
  particles = alive;
}

let lastTime = 0;
function frame(ts) {
  const dt = ts - lastTime;
  lastTime  = ts;

  ctx.clearRect(0, 0, W, H);

  // Sternfeld-Hintergrund
  if (!window._stars) {
    window._stars = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.2, a: Math.random() * 0.4 + 0.1 }));
  }
  for (const s of window._stars) {
    ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180,200,240,${s.a})`; ctx.fill();
  }

  // Edges
  for (const edge of edges) drawEdge(edge);

  // Particles
  drawParticles(dt);

  // Nodes
  for (const id of Object.keys(NODE_LAYOUT)) drawNode(id, nodes[id]);

  // Partikel spawnen
  if (Math.random() < 0.12) {
    const activeEdges = edges.filter(e => e.active);
    if (activeEdges.length) {
      const e     = activeEdges[Math.floor(Math.random() * activeEdges.length)];
      const color = e.dir === 'BUY' ? COLORS.BUY : e.dir === 'SELL' ? COLORS.SELL : COLORS.neutral;
      spawnParticle(e.from, e.to, color);
    }
  }

  animFrame = requestAnimationFrame(frame);
}

// ── Daten laden ───────────────────────────────────────────────────────────────
async function fetchNeuralStatus() {
  try {
    const ticker = window.currentTicker || 'GC=F';
    const r = await fetch(`/api/neural-status?ticker=${encodeURIComponent(ticker)}`);
    const d = await r.json();
    if (d.error) return;
    nodes = d.nodes || {};
    edges = d.edges || [];

    // Portfolio-Info aktualisieren
    const el = document.getElementById('neural-portfolio');
    if (el && d.portfolio) {
      el.innerHTML = `💼 $${d.portfolio.equity?.toFixed(2)} | ${d.portfolio.openPositions} offen | ${d.confluence?.direction || '—'} (${d.confluence?.score || 0}) | ${d.regime || '—'}`;
    }
  } catch {}
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.initNeuralViz = function() {
  resize();
  window.addEventListener('resize', resize);
  fetchNeuralStatus();
  setInterval(fetchNeuralStatus, 5000); // alle 5s
  requestAnimationFrame(frame);
};

window.stopNeuralViz = function() {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
};

})();
