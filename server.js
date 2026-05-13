require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3001;

let Anthropic;
try {
  const sdk = require('@anthropic-ai/sdk');
  Anthropic = sdk.default || sdk;
} catch (e) { console.error('Anthropic SDK fehlt:', e.message); process.exit(1); }

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ════════════════════════════════════════════════════════════════════
// TICKER META
// ════════════════════════════════════════════════════════════════════
const TICKER_META = {
  'GC=F':    { name: 'Gold',       symbol: 'XAU/USD', type: 'commodity', cur: 'USD', sessions: ['london','ny'] },
  'SI=F':    { name: 'Silver',     symbol: 'XAG/USD', type: 'commodity', cur: 'USD', sessions: ['london','ny'] },
  'CL=F':    { name: 'Crude Oil',  symbol: 'WTI',     type: 'commodity', cur: 'USD', sessions: ['london','ny'] },
  'SPY':     { name: 'S&P 500',    symbol: 'SPY',     type: 'etf',       cur: 'USD', sessions: ['ny'] },
  'QQQ':     { name: 'NASDAQ 100', symbol: 'QQQ',     type: 'etf',       cur: 'USD', sessions: ['ny'] },
  'AAPL':    { name: 'Apple',      symbol: 'AAPL',    type: 'stock',     cur: 'USD', sessions: ['ny'] },
  'NVDA':    { name: 'NVIDIA',     symbol: 'NVDA',    type: 'stock',     cur: 'USD', sessions: ['ny'] },
  'BTC-USD': { name: 'Bitcoin',    symbol: 'BTC/USD', type: 'crypto',    cur: 'USD', sessions: ['all'] },
  'ETH-USD': { name: 'Ethereum',   symbol: 'ETH/USD', type: 'crypto',    cur: 'USD', sessions: ['all'] },
};
function getMeta(t) { return TICKER_META[t] || { name: t, symbol: t, type: 'unknown', cur: 'USD', sessions: ['all'] }; }

function getSystemPrompt(ticker) {
  const m = getMeta(ticker);
  return `You are a quantitative ${m.name} market analyst. You have deep expertise in technical analysis, macroeconomics, geopolitics, and ${m.type} markets.
You receive pre-computed technical indicator data and must synthesize it with fundamental/macro knowledge.
Respond ONLY with valid JSON. No markdown, no text outside JSON.`;
}

// ════════════════════════════════════════════════════════════════════
// CACHE
// ════════════════════════════════════════════════════════════════════
const cache = {};
const TTL_LONG  = 3600000;
const TTL_SHORT = 300000;
const TTL_PRICE = 60000; // 1min für Intraday-genauigkeit

function getCache(t) {
  if (!cache[t]) cache[t] = { countries: null, events: null, price: null, price20d: null, tCountry: 0, tEvents: 0, tPrice: 0, tPrice20: 0 };
  return cache[t];
}

// ════════════════════════════════════════════════════════════════════
// PRICE FETCHER
// ════════════════════════════════════════════════════════════════════
async function fetchPrice(ticker, range = '1y') {
  const c   = getCache(ticker);
  const key = range === '1d' || range === '5d' ? 'tPrice' : 'tPrice20';
  const dat = range === '1d' || range === '5d' ? 'price'  : 'price20d';
  const ttl = range === '1d' || range === '5d' ? TTL_PRICE : TTL_SHORT;

  if (c[dat] && Date.now() - c[key] < ttl) return c[dat];

  const r = await axios.get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 }
  );
  const res = r.data.chart.result[0];
  const history = res.timestamp
    .map((ts, i) => ({
      date:  new Date(ts * 1000).toISOString().split('T')[0],
      open:  res.indicators.quote[0].open?.[i],
      high:  res.indicators.quote[0].high?.[i],
      low:   res.indicators.quote[0].low?.[i],
      price: res.indicators.quote[0].close?.[i],
      vol:   res.indicators.quote[0].volume?.[i] || 0,
    }))
    .filter(d => d.price != null);

  const data = { history, current: history[history.length - 1] };
  c[dat]  = data;
  c[key]  = Date.now();
  return data;
}

// ════════════════════════════════════════════════════════════════════
// TECHNICAL INDICATOR ENGINE
// ════════════════════════════════════════════════════════════════════

function calcSMA(prices, p) {
  if (prices.length < p) return null;
  return prices.slice(-p).reduce((a, b) => a + b, 0) / p;
}

function calcEMA(prices, p) {
  if (prices.length < p) return null;
  const k = 2 / (p + 1);
  let ema = prices.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const slice = prices.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i] - slice[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0) return 100;
  return 100 - (100 / (1 + avgG / avgL));
}

function calcMACD(prices, fast = 12, slow = 26, signal = 9) {
  if (prices.length < slow + signal) return null;
  const emaFast   = calcEMA(prices, fast);
  const emaSlow   = calcEMA(prices, slow);
  const macdLine  = emaFast - emaSlow;
  // Signal line: EMA of last `signal` MACD values (approximate with recent window)
  const macdHist  = [];
  for (let i = slow; i <= prices.length; i++) {
    const ef = calcEMA(prices.slice(0, i), fast);
    const es = calcEMA(prices.slice(0, i), slow);
    if (ef !== null && es !== null) macdHist.push(ef - es);
  }
  const signalLine = calcEMA(macdHist, signal);
  const histogram  = macdLine - (signalLine || 0);
  return { macd: macdLine, signal: signalLine, histogram, bullish: histogram > 0 };
}

function calcBollinger(prices, period = 20, stdMult = 2) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mid   = slice.reduce((a, b) => a + b, 0) / period;
  const std   = Math.sqrt(slice.map(p => (p - mid) ** 2).reduce((a, b) => a + b, 0) / period);
  const upper = mid + stdMult * std;
  const lower = mid - stdMult * std;
  const curr  = prices[prices.length - 1];
  const pct   = std > 0 ? (curr - lower) / (upper - lower) : 0.5; // 0=lower, 1=upper
  const bw    = std > 0 ? (upper - lower) / mid : 0; // bandwidth
  return { upper, mid, lower, pct, bw, std };
}

function calcATR(history, period = 14) {
  if (history.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < history.length; i++) {
    const h  = history[i].high  || history[i].price;
    const l  = history[i].low   || history[i].price;
    const pc = history[i - 1].price;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function calcStochastic(history, kPeriod = 14, dPeriod = 3) {
  if (history.length < kPeriod + dPeriod) return null;
  const kValues = [];
  for (let i = kPeriod - 1; i < history.length; i++) {
    const slice  = history.slice(i - kPeriod + 1, i + 1);
    const high   = Math.max(...slice.map(d => d.high || d.price));
    const low    = Math.min(...slice.map(d => d.low  || d.price));
    const curr   = history[i].price;
    kValues.push(high === low ? 50 : ((curr - low) / (high - low)) * 100);
  }
  const k = kValues[kValues.length - 1];
  const d = kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
  return { k, d, bullish: k > d && k < 80, oversold: k < 20, overbought: k > 80 };
}

function calcADX(history, period = 14) {
  if (history.length < period * 2) return null;
  const slice = history.slice(-(period * 2 + 1));
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < slice.length; i++) {
    const h  = slice[i].high  || slice[i].price;
    const l  = slice[i].low   || slice[i].price;
    const ph = slice[i-1].high || slice[i-1].price;
    const pl = slice[i-1].low  || slice[i-1].price;
    const pc = slice[i-1].price;
    const up = h - ph, dn = pl - l;
    plusDM.push((up > dn && up > 0) ? up : 0);
    minusDM.push((dn > up && dn > 0) ? dn : 0);
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const smoothTR  = tr.slice(-period).reduce((a,b)=>a+b,0);
  const smoothPDM = plusDM.slice(-period).reduce((a,b)=>a+b,0);
  const smoothMDM = minusDM.slice(-period).reduce((a,b)=>a+b,0);
  if (smoothTR === 0) return null;
  const pDI = (smoothPDM / smoothTR) * 100;
  const mDI = (smoothMDM / smoothTR) * 100;
  const dx  = Math.abs(pDI - mDI) / (pDI + mDI) * 100;
  return { adx: dx, pDI, mDI, trending: dx > 25, strongTrend: dx > 40 };
}

function calcVolumeRatio(history, period = 20) {
  if (history.length < period + 1) return 1;
  const avgVol = history.slice(-(period + 1), -1).map(d => d.vol).reduce((a,b)=>a+b,0) / period;
  const currVol = history[history.length - 1].vol;
  return avgVol > 0 ? currVol / avgVol : 1;
}

function calcSupportResistance(history, lookback = 60) {
  const slice  = history.slice(-lookback);
  const prices = slice.map(d => d.price);
  const highs  = slice.map(d => d.high || d.price);
  const lows   = slice.map(d => d.low  || d.price);
  const curr   = prices[prices.length - 1];

  // Find local maxima/minima as S/R
  const resistances = [], supports = [];
  for (let i = 2; i < highs.length - 2; i++) {
    if (highs[i] > highs[i-1] && highs[i] > highs[i+1] && highs[i] > highs[i-2] && highs[i] > highs[i+2])
      resistances.push(highs[i]);
    if (lows[i] < lows[i-1] && lows[i] < lows[i+1] && lows[i] < lows[i-2] && lows[i] < lows[i+2])
      supports.push(lows[i]);
  }

  const nearResistance = resistances.filter(r => r > curr).sort((a,b)=>a-b)[0];
  const nearSupport    = supports.filter(s => s < curr).sort((a,b)=>b-a)[0];
  const distToRes      = nearResistance ? (nearResistance - curr) / curr * 100 : 999;
  const distToSup      = nearSupport    ? (curr - nearSupport)    / curr * 100 : 999;

  return { nearResistance, nearSupport, distToRes, distToSup };
}

// ════════════════════════════════════════════════════════════════════
// ALLE INDIKATOREN AUF EINMAL BERECHNEN
// ════════════════════════════════════════════════════════════════════
function calcAllIndicators(history) {
  const prices = history.map(d => d.price);
  const curr   = prices[prices.length - 1];

  const sma20  = calcSMA(prices, 20);
  const sma50  = calcSMA(prices, 50);
  const sma200 = calcSMA(prices, 200);
  const ema9   = calcEMA(prices, 9);
  const ema21  = calcEMA(prices, 21);
  const rsi    = calcRSI(prices, 14);
  const macd   = calcMACD(prices);
  const bb     = calcBollinger(prices, 20);
  const atr    = calcATR(history, 14);
  const atrPct = atr / curr * 100;
  const stoch  = calcStochastic(history, 14, 3);
  const adx    = calcADX(history, 14);
  const volR   = calcVolumeRatio(history, 20);
  const sr     = calcSupportResistance(history, 60);

  // Wöchentliche Trend-Prüfung (letzte 5 Kerzen als "Woche")
  const weekAvg = prices.slice(-5).reduce((a,b)=>a+b,0) / 5;
  const weekTrend = curr > weekAvg ? 'up' : 'down';

  // 3-Wochen-Momentum
  const mom20 = sma20 && prices[prices.length - 20] ? ((curr / prices[prices.length - 20]) - 1) * 100 : 0;

  return { curr, sma20, sma50, sma200, ema9, ema21, rsi, macd, bb, atr, atrPct, stoch, adx, volR, sr, weekTrend, mom20 };
}

// ════════════════════════════════════════════════════════════════════
// MARKET REGIME DETECTION
// ════════════════════════════════════════════════════════════════════
function detectRegime(ind) {
  const { curr, sma20, sma50, sma200, adx, atrPct, rsi, mom20 } = ind;

  // Crash: Kurs weit unter SMA200 + hohe Volatilität
  if (sma200 && curr < sma200 * 0.93 && atrPct > 3) return 'crash';

  // Bear-Trend
  if (sma200 && curr < sma200 && sma50 && curr < sma50 && mom20 < -5) return 'bear';

  // Strong Bull-Trend
  if (sma200 && curr > sma200 * 1.02 && adx?.adx > 30 && mom20 > 3) return 'bull';

  // Trend (neutral direction)
  if (adx?.adx > 25) return curr > (sma50 || curr) ? 'uptrend' : 'downtrend';

  // Range / Chop
  if (adx?.adx < 20 && atrPct < 1.5) return 'range';

  // Volatile / Breakout zone
  if (atrPct > 2.5) return 'volatile';

  return 'neutral';
}

// ════════════════════════════════════════════════════════════════════
// CONFLUENCE SCORING — Herz des Systems
// Jeder Indikator gibt Punkte: +1 bullish, -1 bearish, 0 neutral
// Max: ±13 Punkte
// ════════════════════════════════════════════════════════════════════
function calcConfluence(ind, regime) {
  const { curr, sma20, sma50, sma200, ema9, ema21, rsi, macd, bb, stoch, adx, volR, sr, mom20 } = ind;
  const signals = [];
  let score = 0;

  // 1. SMA-Trend-Stack (200 > 50 > 20 > Preis = bullish)
  if (sma200 && sma50 && sma20) {
    if (curr > sma20 && sma20 > sma50 && sma50 > sma200) { score += 2; signals.push({ name: 'SMA-Stack', val: '+2 Bullish', bull: true }); }
    else if (curr < sma20 && sma20 < sma50 && sma50 < sma200) { score -= 2; signals.push({ name: 'SMA-Stack', val: '-2 Bearish', bull: false }); }
    else if (curr > sma50) { score += 1; signals.push({ name: 'SMA-Stack', val: '+1 über SMA50', bull: true }); }
    else { score -= 1; signals.push({ name: 'SMA-Stack', val: '-1 unter SMA50', bull: false }); }
  }

  // 2. EMA Crossover
  if (ema9 && ema21) {
    if (ema9 > ema21) { score += 1; signals.push({ name: 'EMA 9/21', val: '+1 Crossover bullish', bull: true }); }
    else { score -= 1; signals.push({ name: 'EMA 9/21', val: '-1 Crossover bearish', bull: false }); }
  }

  // 3. RSI
  if (rsi !== null) {
    if (rsi > 55 && rsi < 75)       { score += 1; signals.push({ name: 'RSI', val: `+1 (${rsi.toFixed(0)}) Momentum`, bull: true }); }
    else if (rsi < 45 && rsi > 25)  { score -= 1; signals.push({ name: 'RSI', val: `-1 (${rsi.toFixed(0)}) Schwach`, bull: false }); }
    else if (rsi <= 25)              { score += 1; signals.push({ name: 'RSI', val: `+1 (${rsi.toFixed(0)}) Oversold`, bull: true }); } // Reversal
    else if (rsi >= 75)              { score -= 1; signals.push({ name: 'RSI', val: `-1 (${rsi.toFixed(0)}) Overbought`, bull: false }); }
    else                             { signals.push({ name: 'RSI', val: `0 (${rsi.toFixed(0)}) Neutral`, bull: null }); }
  }

  // 4. MACD
  if (macd) {
    if (macd.histogram > 0 && macd.macd > 0)  { score += 2; signals.push({ name: 'MACD', val: '+2 Bullish + über Null', bull: true }); }
    else if (macd.histogram > 0)               { score += 1; signals.push({ name: 'MACD', val: '+1 Histogram positiv', bull: true }); }
    else if (macd.histogram < 0 && macd.macd < 0) { score -= 2; signals.push({ name: 'MACD', val: '-2 Bearish + unter Null', bull: false }); }
    else                                        { score -= 1; signals.push({ name: 'MACD', val: '-1 Histogram negativ', bull: false }); }
  }

  // 5. Bollinger Band Position
  if (bb) {
    if (bb.pct < 0.2)                 { score += 1; signals.push({ name: 'Bollinger', val: '+1 Unterband (Bounce)', bull: true }); }
    else if (bb.pct > 0.8)            { score -= 1; signals.push({ name: 'Bollinger', val: '-1 Oberband (Überhitzt)', bull: false }); }
    else if (bb.pct > 0.5 && bb.bw > 0.03) { score += 1; signals.push({ name: 'Bollinger', val: '+1 Mitte-oben Breakout', bull: true }); }
    else                              { signals.push({ name: 'Bollinger', val: `0 Mitte (${(bb.pct*100).toFixed(0)}%)`, bull: null }); }
  }

  // 6. Stochastic
  if (stoch) {
    if (stoch.oversold)              { score += 1; signals.push({ name: 'Stochastic', val: `+1 Oversold K:${stoch.k.toFixed(0)}`, bull: true }); }
    else if (stoch.overbought)       { score -= 1; signals.push({ name: 'Stochastic', val: `-1 Overbought K:${stoch.k.toFixed(0)}`, bull: false }); }
    else if (stoch.bullish)          { score += 1; signals.push({ name: 'Stochastic', val: `+1 K>D bullish K:${stoch.k.toFixed(0)}`, bull: true }); }
    else                             { score -= 1; signals.push({ name: 'Stochastic', val: `-1 K<D bearish K:${stoch.k.toFixed(0)}`, bull: false }); }
  }

  // 7. ADX Trend-Stärke
  if (adx) {
    if (adx.pDI > adx.mDI && adx.trending) { score += 1; signals.push({ name: 'ADX', val: `+1 Trend bullish (${adx.adx.toFixed(0)})`, bull: true }); }
    else if (adx.mDI > adx.pDI && adx.trending) { score -= 1; signals.push({ name: 'ADX', val: `-1 Trend bearish (${adx.adx.toFixed(0)})`, bull: false }); }
    else { signals.push({ name: 'ADX', val: `0 Kein Trend (${adx?.adx.toFixed(0)})`, bull: null }); }
  }

  // 8. Volume Bestätigung
  if (volR > 1.3) {
    const volDir = curr > (sma20 || curr) ? 1 : -1;
    score += volDir;
    signals.push({ name: 'Volume', val: `${volDir > 0 ? '+1' : '-1'} Hohe Vol x${volR.toFixed(1)} bestätigt`, bull: volDir > 0 });
  } else {
    signals.push({ name: 'Volume', val: `0 Normal x${volR.toFixed(1)}`, bull: null });
  }

  // 9. Support/Resistance
  if (sr.distToRes < sr.distToSup && sr.distToSup > 1) {
    score += 1;
    signals.push({ name: 'S/R', val: `+1 Mehr Raum nach oben (${sr.distToRes.toFixed(1)}% zu Res)`, bull: true });
  } else if (sr.distToSup < sr.distToRes && sr.distToRes > 1) {
    score -= 1;
    signals.push({ name: 'S/R', val: `-1 Nahe Support (${sr.distToSup.toFixed(1)}%)`, bull: false });
  }

  // 10. Momentum
  if (mom20 > 4)       { score += 1; signals.push({ name: 'Momentum', val: `+1 20d: +${mom20.toFixed(1)}%`, bull: true }); }
  else if (mom20 < -4) { score -= 1; signals.push({ name: 'Momentum', val: `-1 20d: ${mom20.toFixed(1)}%`, bull: false }); }

  // Regime-Filter: In "range" und "volatile" Score dämpfen
  let regimeMult = 1;
  if (regime === 'range')    regimeMult = 0.7;
  if (regime === 'volatile') regimeMult = 0.6;
  if (regime === 'crash')    { score = Math.min(score, -2); regimeMult = 0.8; }

  const adjustedScore = score * regimeMult;
  const maxScore = 13;
  const pct      = Math.min(100, Math.max(0, ((adjustedScore + maxScore) / (maxScore * 2)) * 100));

  return {
    score:          parseFloat(adjustedScore.toFixed(2)),
    rawScore:       score,
    maxScore,
    pct:            parseFloat(pct.toFixed(1)),
    direction:      adjustedScore >= 2 ? 'BUY' : adjustedScore <= -2 ? 'SELL' : 'NEUTRAL',
    strength:       Math.abs(adjustedScore) >= 6 ? 'STRONG' : Math.abs(adjustedScore) >= 3 ? 'MODERATE' : 'WEAK',
    signals,
    tradeable:      Math.abs(adjustedScore) >= 3,
    highConf:       Math.abs(adjustedScore) >= 5,
  };
}

// ════════════════════════════════════════════════════════════════════
// SESSION FILTER
// ════════════════════════════════════════════════════════════════════
function getSessionInfo(ticker) {
  const meta = getMeta(ticker);
  const now  = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const utcT = utcH * 60 + utcM;

  const sessions = {
    asia:    { start: 0*60,   end: 8*60,   name: 'Asia',            quality: 0.6 },
    london:  { start: 7*60,   end: 16*60,  name: 'London',          quality: 0.9 },
    overlap: { start: 13*60,  end: 16*60,  name: 'London/NY Overlap', quality: 1.0 },
    ny:      { start: 13*60,  end: 22*60,  name: 'New York',        quality: 0.9 },
    offhours:{ start: 22*60,  end: 24*60,  name: 'Off-Hours',       quality: 0.3 },
  };

  let active = [], quality = 0.5;
  for (const [k, s] of Object.entries(sessions)) {
    if (utcT >= s.start && utcT < s.end) {
      active.push(s.name);
      quality = Math.max(quality, s.quality);
    }
  }

  if (meta.sessions.includes('all') || meta.type === 'crypto') quality = Math.max(quality, 0.7);

  return {
    utcTime: `${String(utcH).padStart(2,'0')}:${String(utcM).padStart(2,'0')} UTC`,
    activeSessions: active.length ? active : ['Off-Hours'],
    quality,
    tradeable: quality >= 0.7,
    label: active.length ? active.join(' + ') : 'Off-Hours'
  };
}

// ════════════════════════════════════════════════════════════════════
// ATR-BASIERTES DYNAMISCHES SL/TP + POSITION SIZING
// ════════════════════════════════════════════════════════════════════
function calcRiskParams(currentPrice, atr, direction, confluence, equity = 10000) {
  // SL/TP als Vielfaches von ATR — stärkerer Confluence → engeres SL (mehr Überzeugung)
  const confMult  = confluence.highConf ? 1.2 : 1.5;
  const tpMult    = confluence.highConf ? 3.0 : 2.5; // R:R 1:2 bis 1:2.5

  const slDist    = atr * confMult;
  const tpDist    = atr * tpMult;

  const sl        = direction === 'BUY'  ? currentPrice - slDist : currentPrice + slDist;
  const tp        = direction === 'BUY'  ? currentPrice + tpDist : currentPrice - tpDist;

  // Position Sizing: 1% Equity Risk
  const riskAmt   = equity * 0.01;
  const units     = riskAmt / slDist;
  const posValue  = units * currentPrice;
  const rr        = tpDist / slDist;

  return {
    sl:       parseFloat(sl.toFixed(2)),
    tp:       parseFloat(tp.toFixed(2)),
    slDist:   parseFloat(slDist.toFixed(2)),
    tpDist:   parseFloat(tpDist.toFixed(2)),
    rr:       parseFloat(rr.toFixed(2)),
    units:    parseFloat(units.toFixed(4)),
    posValue: parseFloat(posValue.toFixed(2)),
    riskPct:  '1.0%',
  };
}

// ════════════════════════════════════════════════════════════════════
// MULTI-ASSET KORRELATION
// ════════════════════════════════════════════════════════════════════
async function fetchCorrelations(primaryTicker) {
  const correlatedTickers = {
    'GC=F':    ['SI=F', 'DX-Y.NYB', 'GDX'],     // Gold korreliert mit Silber, invers zu USD
    'SI=F':    ['GC=F', 'CL=F'],
    'CL=F':    ['BZ=F', 'XLE'],
    'SPY':     ['QQQ', 'BTC-USD'],
    'QQQ':     ['SPY', 'NVDA', 'AAPL'],
    'BTC-USD': ['ETH-USD', 'SPY'],
    'NVDA':    ['QQQ', 'SPY'],
  };

  const peers = (correlatedTickers[primaryTicker] || []).slice(0, 2);
  const results = {};

  await Promise.allSettled(peers.map(async t => {
    try {
      const d  = await fetchPrice(t, '20d');
      const p  = d.history.map(x => x.price);
      const c  = calcAllIndicators(d.history);
      const reg = detectRegime(c);
      const conf = calcConfluence(c, reg);
      results[t] = { direction: conf.direction, score: conf.score, regime: reg, ticker: t, name: getMeta(t).name };
    } catch { /* ignore missing tickers */ }
  }));

  return results;
}

// ════════════════════════════════════════════════════════════════════
// WIN-RATE TRACKING (in-memory + file persist)
// ════════════════════════════════════════════════════════════════════
const WR_FILE = path.join(__dirname, 'signal_log.json');
let signalLog = [];
try { signalLog = JSON.parse(fs.readFileSync(WR_FILE, 'utf8')); } catch { signalLog = []; }

function saveSignalLog() {
  try { fs.writeFileSync(WR_FILE, JSON.stringify(signalLog.slice(-500), null, 2)); } catch {}
}

function logSignal(entry) {
  signalLog.unshift({ ...entry, id: Date.now() });
  if (signalLog.length > 500) signalLog.pop();
  saveSignalLog();
}

function calcWinRate(ticker = null, last = 100) {
  const relevant = signalLog
    .filter(s => s.signal && s.signal !== 'SKIP' && s.outcome)
    .filter(s => !ticker || s.ticker === ticker)
    .slice(0, last);

  if (!relevant.length) return null;
  const wins = relevant.filter(s => s.outcome === 'WIN').length;
  const totalPnL = relevant.reduce((a, s) => a + (s.pnl || 0), 0);
  const avgConf  = relevant.reduce((a, s) => a + (s.confidence || 0), 0) / relevant.length;
  return {
    total: relevant.length, wins, losses: relevant.length - wins,
    winRate: ((wins / relevant.length) * 100).toFixed(1) + '%',
    totalPnL: totalPnL.toFixed(2),
    avgConfidence: avgConf.toFixed(0),
  };
}

// ════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ════════════════════════════════════════════════════════════════════
function getSystemPrompt(ticker) {
  const m = getMeta(ticker);
  return `You are a quantitative ${m.name} market analyst. Deep expertise in technical analysis, macroeconomics, geopolitics, ${m.type} markets.
You receive pre-computed technical indicator data and synthesize it with fundamental/macro knowledge.
Respond ONLY with valid JSON. No markdown, no text outside JSON.`;
}

// ════════════════════════════════════════════════════════════════════
// ROUTING
// ════════════════════════════════════════════════════════════════════

const TRADING_BOT_URL = process.env.TRADING_BOT_URL || 'https://trading-bot-production-86d8.up.railway.app';

// ── Ticker-Liste ──────────────────────────────────────────────────────────────
app.get('/api/tickers', (req, res) => res.json(TICKER_META));

// ── Technische Indikatoren ────────────────────────────────────────────────────
app.get('/api/indicators', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  try {
    const data = await fetchPrice(ticker, '1y');
    const ind  = calcAllIndicators(data.history);
    const reg  = detectRegime(ind);
    const conf = calcConfluence(ind, reg);
    const sess = getSessionInfo(ticker);
    const risk = conf.direction !== 'NEUTRAL'
      ? calcRiskParams(ind.curr, ind.atr, conf.direction, conf)
      : null;

    res.json({ ticker, ...ind, regime: reg, confluence: conf, session: sess, risk, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('/api/indicators:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Countries ────────────────────────────────────────────────────────────────
app.get('/api/countries', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  const c = getCache(ticker);
  const meta = getMeta(ticker);
  try {
    if (c.countries && Date.now() - c.tCountry < TTL_LONG) return res.json(c.countries);

    const msg = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      system: [{ type: 'text', text: getSystemPrompt(ticker), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Return JSON mapping ISO-3 country codes to influence data for ${meta.name} prices (${new Date().toLocaleString('en',{month:'long',year:'numeric'})}).
Include: USA,CHN,IND,RUS,SAU,AUS,ZAF,CAN,GBR,DEU,FRA,JPN,BRA,MEX,TUR,EGY,IRN,IRQ,UKR,ISR,GHA,PER,IDN,KOR,CHE,SGP,ARE,KAZ,MNG,ARG,NGA,ETH,ZMB,PNG,MYS,THA,VNM,PAK,BGD,COD,POL,SWE,NOR,FIN,NLD,BEL,ITA,ESP,PRT,AUT
Format: {"USA":{"score":-2,"name":"United States","reason":"reason","trend":"bearish"}}` }]
    });
    const m = msg.content[0].text.match(/\{[\s\S]*\}/);
    const data = JSON.parse(m[0]);
    c.countries = data; c.tCountry = Date.now();
    res.json(data);
  } catch (err) { console.error('/api/countries:', err.message); res.status(500).json({ error: err.message }); }
});

// ── Events ───────────────────────────────────────────────────────────────────
app.get('/api/events', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  const c = getCache(ticker);
  const meta = getMeta(ticker);
  try {
    if (c.events && Date.now() - c.tEvents < TTL_LONG) return res.json(c.events);

    const msg = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2048,
      system: [{ type: 'text', text: getSystemPrompt(ticker), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `List 12 major events affecting ${meta.name} prices now.
JSON array only: [{"id":1,"type":"war","name":"Name","lat":0,"lng":0,"description":"desc","impact":"bullish","magnitude":5}]
Types: war,trade_route,sanctions,central_bank,mining,economic,geopolitical,earnings,regulation,macro` }]
    });
    const m = msg.content[0].text.match(/\[[\s\S]*\]/);
    const data = JSON.parse(m[0]);
    c.events = data; c.tEvents = Date.now();
    res.json(data);
  } catch (err) { console.error('/api/events:', err.message); res.status(500).json({ error: err.message }); }
});

// ── Country Detail ────────────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { country, ticker = 'GC=F' } = req.body;
  if (!country) return res.status(400).json({ error: 'country required' });
  const meta = getMeta(ticker);
  try {
    const msg = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: getSystemPrompt(ticker), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Analyze ${country}'s impact on ${meta.name}.
JSON only: {"country":"${country}","score":0,"headline":"h","factors":["f1","f2","f3"],"recentEvents":["e1","e2"],"outlook":"outlook","assetRelevance":"relevance"}` }]
    });
    const text = msg.content.find(b => b.type === 'text')?.text || '{}';
    res.json(JSON.parse(text.match(/\{[\s\S]*\}/)[0]));
  } catch (err) { console.error('/api/analyze:', err.message); res.status(500).json({ error: err.message }); }
});

// ── Recommendation Streaming ─────────────────────────────────────────────────
app.get('/api/recommendation', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  const meta = getMeta(ticker);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    // Indikatoren als Kontext mitschicken
    let indContext = '';
    try {
      const d = await fetchPrice(ticker, '1y');
      const ind = calcAllIndicators(d.history);
      const reg = detectRegime(ind);
      const conf = calcConfluence(ind, reg);
      indContext = `\nAktuelle Indikatoren: RSI=${ind.rsi?.toFixed(1)}, MACD=${ind.macd?.histogram?.toFixed(2)}, ADX=${ind.adx?.adx?.toFixed(1)}, Confluence=${conf.score}/${conf.maxScore} (${conf.direction}), Regime=${reg}`;
    } catch {}

    const stream = client.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: getSystemPrompt(ticker), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `${meta.name} Handelsempfehlung (${new Date().toLocaleString('de',{month:'long',year:'numeric'})}).${indContext}

## 🎯 EMPFEHLUNG: [KAUFEN / VERKAUFEN / HALTEN]
**Konfidenz:** X% | **Regime:** X | **Confluence:** X/13
**Zielpreis (3 Monate):** $X | **Stop-Loss:** $X

## 📊 Technische Analyse
## 🌍 Fundamentale/Makro-Analyse
## ⚠️ Hauptrisiken
## 📈 Einstiegsstrategie & Position Sizing

Deutsch. Präzise Zahlen.` }]
    });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta')
        res.write(`data: ${JSON.stringify({ text: ev.delta.text })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
});

// ── Price ─────────────────────────────────────────────────────────────────────
app.get('/api/gold-price', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  try { res.json(await fetchPrice(ticker, '2y')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Backtest (erweitert mit Confluence-Filter) ───────────────────────────────
app.get('/api/backtest', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  try {
    const data    = await fetchPrice(ticker, '2y');
    const history = data.history;

    // Standard SMA
    let pos = null, equity = 10000;
    // KI-Enhanced (SMA + dynamischer SL/TP)
    let posAI = null, equityAI = 10000;
    // Confluence-Filter (nur traden wenn confluence >= 3)
    let posConf = null, equityConf = 10000;

    const trades = [], equityCurve = [], equityCurveAI = [], equityCurveConf = [];

    for (let i = 200; i < history.length; i++) {
      const slice  = history.slice(0, i);
      const prices = slice.map(d => d.price);
      const sma20  = calcSMA(prices, 20);
      const sma50  = calcSMA(prices, 50);
      const price  = history[i].price;
      const atr    = calcATR(slice, 14);
      const trend  = sma20 && sma50 ? Math.max(0, Math.min(1, (sma20 / sma50 - 1) * 50)) : 0;

      // ── Standard SMA ──
      if (!pos && sma20 > sma50 * 1.002) {
        pos = { entry: price, units: equity / price };
        trades.push({ type: 'BUY', date: history[i].date, price: price.toFixed(2) });
      } else if (pos && sma20 < sma50 * 0.998) {
        const pnl = (price - pos.entry) * pos.units;
        equity += pnl;
        trades.push({ type: 'SELL', date: history[i].date, price: price.toFixed(2), pnl: pnl.toFixed(2) });
        pos = null;
      }

      // ── KI-Enhanced (ATR SL/TP) ──
      if (!posAI && sma20 > sma50 * 1.002) {
        posAI = { entry: price, sl: price - atr * 1.5, tp: price + atr * 2.5, units: equityAI / price };
      } else if (posAI) {
        if (trend > 0.5) { posAI.tp = Math.max(posAI.tp, price + atr * 2); posAI.sl = Math.max(posAI.sl, price - atr * 1.2); }
        else { posAI.sl = Math.max(posAI.sl, price - atr * 1.5); }
        const exit = price <= posAI.sl ? posAI.sl : price >= posAI.tp ? posAI.tp : sma20 < sma50 * 0.998 ? price : null;
        if (exit !== null) { equityAI += (exit - posAI.entry) * posAI.units; posAI = null; }
      }

      // ── Confluence Filter ──
      if (i % 3 === 0 && slice.length >= 60) { // Alle 3 Tage neu berechnen (Performance)
        const ind  = calcAllIndicators(slice.slice(-200));
        const reg  = detectRegime(ind);
        const conf = calcConfluence(ind, reg);
        if (!posConf && conf.direction === 'BUY' && conf.tradeable && sma20 > sma50) {
          const rp = calcRiskParams(price, atr, 'BUY', conf);
          posConf = { entry: price, sl: rp.sl, tp: rp.tp, units: (equityConf * 0.01) / (price - rp.sl) };
        } else if (!posConf && conf.direction === 'SELL' && conf.tradeable && sma20 < sma50) {
          const rp = calcRiskParams(price, atr, 'SELL', conf);
          posConf = { entry: price, sl: rp.sl, tp: rp.tp, units: (equityConf * 0.01) / (rp.sl - price), short: true };
        } else if (posConf) {
          const hitSL = posConf.short ? price >= posConf.sl : price <= posConf.sl;
          const hitTP = posConf.short ? price <= posConf.tp : price >= posConf.tp;
          if (hitSL || hitTP || (conf.direction === 'NEUTRAL' && i % 9 === 0)) {
            const ep = hitTP ? posConf.tp : hitSL ? posConf.sl : price;
            const pnl = posConf.short ? (posConf.entry - ep) * posConf.units : (ep - posConf.entry) * posConf.units;
            equityConf += pnl;
            posConf = null;
          }
        }
      }

      const cur     = pos     ? equity     + (price - pos.entry)     * pos.units     : equity;
      const curAI   = posAI   ? equityAI   + (price - posAI.entry)   * posAI.units   : equityAI;
      const curConf = posConf ? equityConf + (posConf.short ? (posConf.entry - price) : (price - posConf.entry)) * posConf.units : equityConf;
      equityCurve.push({ date: history[i].date, equity: parseFloat(cur.toFixed(2)) });
      equityCurveAI.push({ date: history[i].date, equity: parseFloat(curAI.toFixed(2)) });
      equityCurveConf.push({ date: history[i].date, equity: parseFloat(curConf.toFixed(2)) });
    }

    const sells = trades.filter(t => t.type === 'SELL');
    const wins  = sells.filter(t => parseFloat(t.pnl) > 0).length;
    function maxDD(curve) {
      let peak = curve[0]?.equity || 10000, dd = 0;
      for (const p of curve) { if (p.equity > peak) peak = p.equity; const d = (peak - p.equity) / peak * 100; if (d > dd) dd = d; }
      return dd;
    }

    res.json({
      ticker, trades: trades.slice(-30),
      equityCurve: equityCurve.slice(-500),
      equityCurveAI: equityCurveAI.slice(-500),
      equityCurveConf: equityCurveConf.slice(-500),
      stats:     { totalTrades: sells.length, winRate: sells.length ? ((wins/sells.length)*100).toFixed(1)+'%' : '0%', totalReturn: (((equity-10000)/10000)*100).toFixed(1)+'%', finalEquity: equity.toFixed(2), maxDrawdown: maxDD(equityCurve).toFixed(1)+'%', strategy: 'SMA 20/50' },
      statsAI:   { totalReturn: (((equityAI-10000)/10000)*100).toFixed(1)+'%', finalEquity: equityAI.toFixed(2), maxDrawdown: maxDD(equityCurveAI).toFixed(1)+'%', strategy: 'SMA + ATR SL/TP' },
      statsConf: { totalReturn: (((equityConf-10000)/10000)*100).toFixed(1)+'%', finalEquity: equityConf.toFixed(2), maxDrawdown: maxDD(equityCurveConf).toFixed(1)+'%', strategy: 'Confluence Filter' },
      realStats: { totalReturn: '35.000%', winRate: '56%', profitFactor: '1.7', maxDrawdown: '32.44%', totalTrades: 187, strategy: 'Dein Trading Bot (real)' }
    });
  } catch (err) { console.error('/api/backtest:', err.message); res.status(500).json({ error: err.message }); }
});

// ── Deep Signal (Haupt-Signal-Endpunkt mit Confluence) ───────────────────────
app.post('/api/signal', async (req, res) => {
  const { strategie = 'mittel', dryRun = false, ticker = 'GC=F' } = req.body;
  const meta = getMeta(ticker);
  try {
    // 1. Technische Analyse
    const priceData = await fetchPrice(ticker, '1y');
    const ind       = calcAllIndicators(priceData.history);
    const regime    = detectRegime(ind);
    const conf      = calcConfluence(ind, regime);
    const session   = getSessionInfo(ticker);
    const risk      = calcRiskParams(ind.curr, ind.atr, conf.direction, conf);
    const corr      = await fetchCorrelations(ticker);

    // 2. Confluence-Check: Kein Trade wenn zu schwach oder schlechte Session
    if (!conf.tradeable) {
      return res.json({ status: 'skipped', reason: `Confluence zu niedrig (${conf.score}/${conf.maxScore})`, confluence: conf, regime, session });
    }
    if (!session.tradeable) {
      return res.json({ status: 'skipped', reason: `Schlechte Session: ${session.label} (Qualität: ${(session.quality*100).toFixed(0)}%)`, session });
    }

    // 3. Korrelations-Check: Gegenläufige korrelierte Assets dämpfen Signal
    const corrVotes = Object.values(corr);
    const corrBull  = corrVotes.filter(v => v.direction === 'BUY').length;
    const corrBear  = corrVotes.filter(v => v.direction === 'SELL').length;
    if (conf.direction === 'BUY'  && corrBear > corrBull && corrVotes.length > 0) {
      return res.json({ status: 'skipped', reason: `Korrelierte Assets kontra-indizieren BUY`, corr, confluence: conf });
    }
    if (conf.direction === 'SELL' && corrBull > corrBear && corrVotes.length > 0) {
      return res.json({ status: 'skipped', reason: `Korrelierte Assets kontra-indizieren SELL`, corr, confluence: conf });
    }

    // 4. Claude für finale Validierung + Begründung
    const bullSignals = conf.signals.filter(s => s.bull === true).map(s => s.name).join(', ');
    const bearSignals = conf.signals.filter(s => s.bull === false).map(s => s.name).join(', ');

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: getSystemPrompt(ticker), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content:
        `${meta.name}: $${ind.curr.toFixed(2)} | ATR: $${ind.atr.toFixed(2)} | Regime: ${regime}\n` +
        `Confluence: ${conf.score}/${conf.maxScore} → ${conf.direction} (${conf.strength})\n` +
        `Bullish Indikatoren: ${bullSignals}\nBearish Indikatoren: ${bearSignals}\n` +
        `RSI: ${ind.rsi?.toFixed(1)} | MACD Hist: ${ind.macd?.histogram?.toFixed(2)} | ADX: ${ind.adx?.adx?.toFixed(1)}\n` +
        `Session: ${session.label} (Qualität ${(session.quality*100).toFixed(0)}%)\n` +
        `Korrelierte Assets: ${JSON.stringify(Object.values(corr).map(v=>({n:v.name,d:v.direction})))}\n\n` +
        `Validiere dieses ${conf.direction}-Signal und gib JSON zurück:\n` +
        `{"signal":"${conf.direction}","confidence":75,"sl":${risk.sl},"tp":${risk.tp},"reason":"max 15 Wörter auf Deutsch","skip":false,"override":false}\n` +
        `Wenn du fundamental/makro Gegenargument hast: {"skip":true,"reason":"Grund"} oder {"override":true,"signal":"anderes Signal"}`
      }]
    });

    const text   = msg.content.find(b => b.type === 'text')?.text || '{}';
    const signal = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);

    if (signal.skip) {
      return res.json({ status: 'skipped', reason: signal.reason, confluence: conf, regime });
    }

    // Override-Behandlung
    const finalSignal = signal.override ? signal.signal : conf.direction;
    const finalRisk   = signal.override ? calcRiskParams(ind.curr, ind.atr, finalSignal, conf) : risk;

    const payload = { side: finalSignal, sl: parseFloat(signal.sl || finalRisk.sl), tp: parseFloat(signal.tp || finalRisk.tp) };

    // Log
    const logEntry = {
      ts: new Date().toISOString(), ticker, strategie,
      signal: finalSignal, confidence: signal.confidence,
      confluenceScore: conf.score, regime,
      sl: payload.sl, tp: payload.tp,
      reason: signal.reason, outcome: null, pnl: null
    };

    let botResponse = null;
    if (!dryRun) {
      try {
        const r = await axios.post(`${TRADING_BOT_URL}/webhook/${strategie}`, payload, { timeout: 10000 });
        botResponse = r.data;
        logSignal(logEntry);
      } catch (e) { botResponse = { error: e.message }; }
    }

    res.json({
      status: 'sent', signal: finalSignal, confidence: signal.confidence,
      payload, botResponse, dryRun, ticker,
      confluence: conf, regime, session,
      indicators: { rsi: ind.rsi, macd: ind.macd?.histogram, adx: ind.adx?.adx, atr: ind.atr },
      correlations: corr, risk: finalRisk,
      reason: signal.reason, timestamp: new Date().toISOString()
    });
  } catch (err) { console.error('/api/signal:', err.message); res.status(500).json({ error: err.message }); }
});

// ── Market View ───────────────────────────────────────────────────────────────
app.get('/api/market-view', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  const meta   = getMeta(ticker);
  try {
    const priceData    = await fetchPrice(ticker, '1y');
    const ind          = calcAllIndicators(priceData.history);
    const regime       = detectRegime(ind);
    const conf         = calcConfluence(ind, regime);
    const session      = getSessionInfo(ticker);
    const currentPrice = ind.curr;

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: getSystemPrompt(ticker), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content:
        `${meta.name}: $${currentPrice.toFixed(2)}, ATR: $${ind.atr.toFixed(2)}, Regime: ${regime}, Confluence: ${conf.score} (${conf.direction})\n` +
        `RSI: ${ind.rsi?.toFixed(1)}, MACD: ${ind.macd?.histogram?.toFixed(3)}\n` +
        `Offene Long-Position. SL/TP anpassen?\n` +
        `JSON: {"sentiment":"bullish","score":3,"sl_action":"tighten","sl_adjustment_pct":-0.5,"tp_action":"extend","tp_adjustment_pct":1.2,"confidence":72,"reason":"max 15 Wörter"}`
      }]
    });

    const text = msg.content.find(b => b.type === 'text')?.text || '{}';
    const view = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
    res.json({ ...view, ticker, price: currentPrice, atr: ind.atr, regime, confluence: conf.score, session, timestamp: new Date().toISOString() });
  } catch (err) { console.error('/api/market-view:', err.message); res.status(500).json({ error: err.message }); }
});

// ── SNAPSHOT — Bot One-Call ───────────────────────────────────────────────────
app.get('/api/snapshot', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  const meta   = getMeta(ticker);
  try {
    const priceData    = await fetchPrice(ticker, '1y');
    const ind          = calcAllIndicators(priceData.history);
    const regime       = detectRegime(ind);
    const conf         = calcConfluence(ind, regime);
    const session      = getSessionInfo(ticker);
    const currentPrice = ind.curr;
    const prevPrice    = priceData.history[priceData.history.length - 2]?.price;
    const change24h    = prevPrice ? ((currentPrice - prevPrice) / prevPrice * 100) : 0;
    const risk         = conf.tradeable
      ? calcRiskParams(currentPrice, ind.atr, conf.direction, conf)
      : null;

    const c = getCache(ticker);
    const topCountries = c.countries
      ? Object.entries(c.countries).sort((a,b)=>Math.abs(b[1].score)-Math.abs(a[1].score)).slice(0,5).map(([iso,d])=>({iso,...d}))
      : [];

    res.json({
      ticker, meta,
      price: { current: currentPrice, change24h: parseFloat(change24h.toFixed(2)), atr: parseFloat(ind.atr.toFixed(2)) },
      indicators: {
        rsi: ind.rsi ? parseFloat(ind.rsi.toFixed(1)) : null,
        macd: ind.macd ? { histogram: parseFloat(ind.macd.histogram.toFixed(4)), bullish: ind.macd.bullish } : null,
        adx: ind.adx ? { value: parseFloat(ind.adx.adx.toFixed(1)), trending: ind.adx.trending, pDI: parseFloat(ind.adx.pDI.toFixed(1)), mDI: parseFloat(ind.adx.mDI.toFixed(1)) } : null,
        bb: ind.bb ? { pct: parseFloat(ind.bb.pct.toFixed(2)), bw: parseFloat(ind.bb.bw.toFixed(4)) } : null,
        stoch: ind.stoch ? { k: parseFloat(ind.stoch.k.toFixed(1)), d: parseFloat(ind.stoch.d.toFixed(1)) } : null,
        sma: { sma20: ind.sma20, sma50: ind.sma50, sma200: ind.sma200 },
        volRatio: parseFloat(ind.volR.toFixed(2)),
        mom20: parseFloat(ind.mom20.toFixed(2)),
      },
      confluence: { score: conf.score, maxScore: conf.maxScore, direction: conf.direction, strength: conf.strength, tradeable: conf.tradeable, signals: conf.signals },
      regime,
      session,
      risk,
      topCountries,
      events: c.events ? c.events.slice(0, 5) : [],
      timestamp: new Date().toISOString()
    });
  } catch (err) { console.error('/api/snapshot:', err.message); res.status(500).json({ error: err.message }); }
});

// ── Multi-Snapshot (Korrelations-Überblick) ───────────────────────────────────
app.get('/api/multi-snapshot', async (req, res) => {
  const tickers = (req.query.tickers || 'GC=F,BTC-USD,SPY').split(',').slice(0, 6);
  const results = {};
  await Promise.allSettled(tickers.map(async t => {
    try {
      const d    = await fetchPrice(t, '1y');
      const ind  = calcAllIndicators(d.history);
      const reg  = detectRegime(ind);
      const conf = calcConfluence(ind, reg);
      const sess = getSessionInfo(t);
      results[t] = {
        ticker: t, name: getMeta(t).name,
        price: ind.curr, change24h: d.history.length > 1 ? parseFloat(((ind.curr / d.history[d.history.length-2].price - 1)*100).toFixed(2)) : 0,
        rsi: ind.rsi ? parseFloat(ind.rsi.toFixed(1)) : null,
        confluence: { score: conf.score, direction: conf.direction, tradeable: conf.tradeable },
        regime: reg, sessionTradeable: sess.tradeable
      };
    } catch (e) { results[t] = { error: e.message }; }
  }));
  res.json({ snapshots: results, timestamp: new Date().toISOString() });
});

// ── Portfolio Signal (Multi-Asset optimiert) ─────────────────────────────────
app.get('/api/portfolio-signal', async (req, res) => {
  const tickers = (req.query.tickers || 'GC=F,BTC-USD,SPY,NVDA').split(',').slice(0, 6);
  try {
    const snapshots = {};
    await Promise.allSettled(tickers.map(async t => {
      try {
        const d    = await fetchPrice(t, '1y');
        const ind  = calcAllIndicators(d.history);
        const reg  = detectRegime(ind);
        const conf = calcConfluence(ind, reg);
        const sess = getSessionInfo(t);
        const risk = conf.tradeable ? calcRiskParams(ind.curr, ind.atr, conf.direction, conf) : null;
        snapshots[t] = { ticker: t, name: getMeta(t).name, price: ind.curr, atr: ind.atr, ind, reg, conf, sess, risk };
      } catch {}
    }));

    // Best Opportunity: höchster absoluter Confluence-Score + gute Session + tradeables
    const ranked = Object.values(snapshots)
      .filter(s => s.conf?.tradeable && s.sess?.tradeable)
      .sort((a, b) => Math.abs(b.conf.score) - Math.abs(a.conf.score));

    const best = ranked[0] || null;
    const signals = Object.values(snapshots).map(s => ({
      ticker: s.ticker, name: s.name, direction: s.conf?.direction, score: s.conf?.score,
      regime: s.reg, tradeable: s.conf?.tradeable && s.sess?.tradeable, sl: s.risk?.sl, tp: s.risk?.tp
    }));

    res.json({ best: best ? { ticker: best.ticker, name: best.name, direction: best.conf.direction, score: best.conf.score, sl: best.risk?.sl, tp: best.risk?.tp } : null, signals, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Win-Rate Stats ────────────────────────────────────────────────────────────
app.get('/api/winrate', (req, res) => {
  const ticker = req.query.ticker || null;
  res.json({ overall: calcWinRate(null, 100), byTicker: ticker ? calcWinRate(ticker, 100) : null, recentSignals: signalLog.slice(0, 20) });
});

// Signal-Outcome eintragen (vom Bot zurückgemeldet)
app.post('/api/signal-outcome', (req, res) => {
  const { id, outcome, pnl } = req.body; // outcome: 'WIN' | 'LOSS'
  const entry = signalLog.find(s => s.id === id);
  if (entry) { entry.outcome = outcome; entry.pnl = pnl; saveSignalLog(); res.json({ ok: true }); }
  else res.status(404).json({ error: 'Signal nicht gefunden' });
});

// ── Trading Bot Proxy ─────────────────────────────────────────────────────────
app.get('/api/trading-performance', async (req, res) => {
  try { const r = await axios.get(`${TRADING_BOT_URL}/api/performance`, { timeout: 15000 }); res.json(r.data); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/trading-adjust', async (req, res) => {
  try { const r = await axios.post(`${TRADING_BOT_URL}/api/auto-adjust`, req.body, { timeout: 60000 }); res.json(r.data); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Auto-Signal (Server-seitig) ───────────────────────────────────────────────
let autoInterval = null;
let autoConfig   = { strategie: 'goldglobe', intervalMins: 60, ticker: 'GC=F' };

async function runAutoSignal() {
  const ticker = autoConfig.ticker;
  const meta   = getMeta(ticker);
  console.log(`🤖 Auto-Signal [${meta.name}/${autoConfig.strategie}]...`);
  try {
    const priceData = await fetchPrice(ticker, '1y');
    const ind       = calcAllIndicators(priceData.history);
    const regime    = detectRegime(ind);
    const conf      = calcConfluence(ind, regime);
    const session   = getSessionInfo(ticker);

    const logEntry = { ts: new Date().toISOString(), ticker, strategie: autoConfig.strategie, regime, confluenceScore: conf.score, signal: null, confidence: null, reason: null, botResponse: null, outcome: null, pnl: null };

    if (!conf.tradeable) {
      logEntry.signal = 'SKIP'; logEntry.reason = `Confluence ${conf.score}/${conf.maxScore}`;
      console.log(`⏭ ${logEntry.reason}`);
      logSignal(logEntry); return;
    }
    if (!session.tradeable) {
      logEntry.signal = 'SKIP'; logEntry.reason = `Session: ${session.label}`;
      console.log(`⏭ ${logEntry.reason}`);
      logSignal(logEntry); return;
    }

    const risk = calcRiskParams(ind.curr, ind.atr, conf.direction, conf);

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 256,
      system: [{ type: 'text', text: getSystemPrompt(ticker), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content:
        `${meta.name}: $${ind.curr.toFixed(2)} | Regime: ${regime} | Confluence: ${conf.score} → ${conf.direction}\n` +
        `RSI: ${ind.rsi?.toFixed(1)} | ATR: ${ind.atr.toFixed(2)}\n` +
        `Validiere Signal. JSON: {"signal":"${conf.direction}","confidence":75,"reason":"max 10 Wörter","skip":false}`
      }]
    });

    const text   = msg.content.find(b => b.type === 'text')?.text || '{}';
    const signal = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);

    logEntry.signal     = signal.skip ? 'SKIP' : signal.signal;
    logEntry.confidence = signal.confidence;
    logEntry.reason     = signal.reason;

    if (!signal.skip) {
      try {
        const r = await axios.post(`${TRADING_BOT_URL}/webhook/${autoConfig.strategie}`,
          { side: signal.signal, sl: risk.sl, tp: risk.tp }, { timeout: 10000 });
        logEntry.botResponse = r.data;
        console.log(`✅ ${signal.signal} | ${signal.confidence}% | ${meta.name} | Conf: ${conf.score}`);
      } catch (e) { logEntry.botResponse = { error: e.message }; }
    } else { console.log(`⏭ ${signal.reason}`); }

    logSignal(logEntry);
  } catch (e) { console.error('❌ Auto-Signal:', e.message); }
}

app.post('/api/auto/start', (req, res) => {
  const { strategie = 'goldglobe', intervalMins = 60, ticker = 'GC=F' } = req.body;
  if (autoInterval) clearInterval(autoInterval);
  autoConfig = { strategie, intervalMins, ticker };
  runAutoSignal();
  autoInterval = setInterval(runAutoSignal, intervalMins * 60 * 1000);
  console.log(`▶ Auto: alle ${intervalMins}min [${ticker}/${strategie}]`);
  res.json({ ok: true, ...autoConfig });
});

app.post('/api/auto/stop', (req, res) => {
  if (autoInterval) { clearInterval(autoInterval); autoInterval = null; }
  res.json({ ok: true });
});

app.get('/api/auto/status', (req, res) => {
  res.json({ aktiv: !!autoInterval, ...autoConfig, letzteSignale: signalLog.slice(0, 20) });
});

// ── Image proxy ────────────────────────────────────────────────────────────────
app.get('/img/:name', async (req, res) => {
  try {
    const r = await axios.get('https://cdn.jsdelivr.net/npm/three-globe@2.32.2/example/img/' + req.params.name, { responseType: 'arraybuffer', timeout: 15000 });
    res.setHeader('Content-Type', r.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(r.data));
  } catch { res.status(500).send('Image error'); }
});

// ── GeoJSON ────────────────────────────────────────────────────────────────────
let geoJsonCache = null;
app.get('/api/geojson', async (req, res) => {
  try {
    if (geoJsonCache) return res.json(geoJsonCache);
    const r = await axios.get('https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson', { timeout: 15000 });
    geoJsonCache = r.data;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════
// PORTFOLIO MANAGER — Leverage, Knockout, Multi-Trade
// ════════════════════════════════════════════════════════════════════

const PORTFOLIO_FILE  = path.join(__dirname, 'portfolio.json');
const OBSIDIAN_TRADES = path.join(__dirname, 'cloud', 'obsidian', 'trading');

const DEFAULT_PORTFOLIO = {
  equity: 10000,
  openPositions: [],
  closedTrades: [],
  externalBots: {},
  neuralState: {},
  settings: {
    maxOpenTrades: 5,
    maxTotalMarginPct: 0.30,
    maxRiskPerTrade: 0.02,
    defaultLeverage: 10,
    defaultType: 'cfd',
  }
};

function loadPortfolio() {
  try { return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf8')); }
  catch { return JSON.parse(JSON.stringify(DEFAULT_PORTFOLIO)); }
}
function savePortfolio(p) {
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(p, null, 2));
}

let portfolio = loadPortfolio();

// ── Leverage / Knockout Berechnung ───────────────────────────────────────────
function calcLeverageParams(ticker, direction, currentPrice, leverage, type, equityBudget, atr) {
  const meta = getMeta(ticker);

  if (type === 'knockout') {
    // Knockout-Zertifikat (Turbo/Mini-Future)
    // Barrier = Finanzierungslevel → bei Long: unter aktuellem Preis
    // Empfehlung: Barrier mindestens 3×ATR entfernt (Schutz vor Rauschen)
    const safetyBuffer = Math.max(atr * 3, currentPrice * 0.05);
    const barrier      = direction === 'BUY'
      ? currentPrice - safetyBuffer
      : currentPrice + safetyBuffer;
    const intrinsicVal = direction === 'BUY'
      ? currentPrice - barrier
      : barrier - currentPrice;
    const effectiveLev = currentPrice / intrinsicVal;
    const ratio        = 0.1; // 1 Zertifikat = 0.1 Einheit Underlying
    const certPrice    = intrinsicVal * ratio;

    // Kapitaleinsatz: equityBudget = invested EUR
    const numCerts     = equityBudget / certPrice;
    const units        = numCerts * ratio;
    const notional     = units * currentPrice;
    const margin       = equityBudget; // bei KO = volles Risiko

    // SL = Barrier + kleiner Sicherheitsabstand (auto-close vor echtem KO)
    const slBuffer     = atr * 0.3;
    const sl           = direction === 'BUY' ? barrier + slBuffer : barrier - slBuffer;
    const tp           = direction === 'BUY'
      ? currentPrice + intrinsicVal * effectiveLev * 0.4
      : currentPrice - intrinsicVal * effectiveLev * 0.4;

    return { type: 'knockout', barrier, intrinsicVal, effectiveLev: parseFloat(effectiveLev.toFixed(1)),
             certPrice, numCerts: parseFloat(numCerts.toFixed(0)), ratio,
             units, notional, margin, sl: parseFloat(sl.toFixed(2)), tp: parseFloat(tp.toFixed(2)),
             maxLoss: equityBudget, note: `KO bei $${barrier.toFixed(2)}` };
  }

  // ── CFD ──────────────────────────────────────────────────────────
  const margin   = equityBudget;
  const notional = margin * leverage;
  const units    = notional / currentPrice;

  // ATR-basiertes SL/TP
  const slDist   = atr * 1.5;
  const tpDist   = atr * 2.5;
  const sl       = direction === 'BUY' ? currentPrice - slDist : currentPrice + slDist;
  const tp       = direction === 'BUY' ? currentPrice + tpDist : currentPrice - tpDist;
  const maxLoss  = units * slDist; // Verlust wenn SL trifft (ohne Leverage-Schutz)

  return { type: 'cfd', leverage, units: parseFloat(units.toFixed(4)),
           notional: parseFloat(notional.toFixed(2)), margin,
           sl: parseFloat(sl.toFixed(2)), tp: parseFloat(tp.toFixed(2)),
           maxLoss: parseFloat(maxLoss.toFixed(2)), rr: parseFloat((tpDist/slDist).toFixed(2)) };
}

// ── Unrealized P&L berechnen ─────────────────────────────────────────────────
function calcUnrealizedPnL(pos, currentPrice) {
  const diff = pos.direction === 'BUY'
    ? currentPrice - pos.entryPrice
    : pos.entryPrice - currentPrice;
  return parseFloat((diff * pos.units).toFixed(2));
}

// ── Obsidian-Sync ─────────────────────────────────────────────────────────────
function syncToObsidian(p) {
  try {
    fs.mkdirSync(OBSIDIAN_TRADES, { recursive: true });
    const today  = new Date().toISOString().split('T')[0];
    const closed = p.closedTrades.slice(0, 50);

    const wins   = closed.filter(t => t.realizedPnL > 0).length;
    const losses = closed.filter(t => t.realizedPnL <= 0).length;
    const totalPnL = closed.reduce((a, t) => a + (t.realizedPnL || 0), 0);

    let md = `# Trading Log — ${today}\n\n`;
    md += `## Portfolio\n- **Equity:** $${p.equity.toFixed(2)}\n`;
    md += `- **Offene Positionen:** ${p.openPositions.length}\n`;
    md += `- **Win-Rate:** ${closed.length ? ((wins/closed.length)*100).toFixed(1) : 0}% (${wins}W/${losses}L)\n`;
    md += `- **Gesamt PnL:** $${totalPnL.toFixed(2)}\n\n`;

    if (p.openPositions.length > 0) {
      md += `## Offene Positionen\n`;
      for (const pos of p.openPositions) {
        md += `- **${pos.ticker}** ${pos.direction} | Entry: $${pos.entryPrice} | SL: $${pos.sl} | TP: $${pos.tp} | ${pos.type.toUpperCase()} ${pos.leverage||''}x | Eröffnet: ${pos.openTime?.split('T')[0]}\n`;
      }
      md += '\n';
    }

    md += `## Letzte Trades\n| Ticker | Dir | Typ | Entry | Exit | PnL | Regime |\n|---|---|---|---|---|---|---|\n`;
    for (const t of closed.slice(0, 20)) {
      md += `| ${t.ticker} | ${t.direction} | ${t.type} | $${t.entryPrice} | $${t.exitPrice||'—'} | ${t.realizedPnL >= 0 ? '+' : ''}$${t.realizedPnL?.toFixed(2)} | ${t.regime} |\n`;
    }

    if (Object.keys(p.externalBots).length > 0) {
      md += `\n## Externe Bots\n`;
      for (const [name, bot] of Object.entries(p.externalBots)) {
        md += `- **${name}:** ${bot.lastSignal||'—'} (${bot.lastSeen?.split('T')[0]||'—'})\n`;
      }
    }

    fs.writeFileSync(path.join(OBSIDIAN_TRADES, `trades-${today}.md`), md);
    console.log('📁 Obsidian sync OK');
    return true;
  } catch (e) {
    console.error('Obsidian sync Fehler:', e.message);
    return false;
  }
}

// ── Positions aktualisieren (SL/TP check + PnL update) ───────────────────────
async function updatePositions() {
  if (!portfolio.openPositions.length) return;
  const toClose = [];

  for (const pos of portfolio.openPositions) {
    try {
      const d  = await fetchPrice(pos.ticker, '5d');
      const cp = d.current.price;
      pos.currentPrice   = cp;
      pos.unrealizedPnL  = calcUnrealizedPnL(pos, cp);

      // Knockout-Check
      if (pos.type === 'knockout' && pos.barrier) {
        const koHit = pos.direction === 'BUY' ? cp <= pos.barrier : cp >= pos.barrier;
        if (koHit) { pos.closeReason = 'KNOCKOUT'; pos.exitPrice = pos.barrier; toClose.push(pos); continue; }
      }
      // SL/TP Check
      const slHit = pos.direction === 'BUY' ? cp <= pos.sl : cp >= pos.sl;
      const tpHit = pos.direction === 'BUY' ? cp >= pos.tp : cp <= pos.tp;
      if (slHit) { pos.closeReason = 'SL'; pos.exitPrice = pos.sl; toClose.push(pos); }
      else if (tpHit) { pos.closeReason = 'TP'; pos.exitPrice = pos.tp; toClose.push(pos); }
    } catch {}
  }

  for (const pos of toClose) {
    closePosition(pos.id, pos.exitPrice, pos.closeReason);
  }
  savePortfolio(portfolio);
}

function closePosition(id, exitPrice, reason = 'manual') {
  const idx = portfolio.openPositions.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const pos       = portfolio.openPositions[idx];
  const diff      = pos.direction === 'BUY' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
  const realPnL   = parseFloat((diff * pos.units).toFixed(2));

  pos.exitPrice    = exitPrice;
  pos.realizedPnL  = realPnL;
  pos.closeReason  = reason;
  pos.closeTime    = new Date().toISOString();
  pos.status       = 'closed';
  pos.outcome      = realPnL > 0 ? 'WIN' : 'LOSS';

  portfolio.equity          += realPnL;
  portfolio.closedTrades.unshift(pos);
  portfolio.openPositions.splice(idx, 1);
  if (portfolio.closedTrades.length > 500) portfolio.closedTrades.pop();
  savePortfolio(portfolio);
  syncToObsidian(portfolio);
  console.log(`📊 Closed ${pos.ticker} ${pos.direction} → ${reason} | PnL: $${realPnL}`);
  return pos;
}

// SL/TP-Check alle 60s
setInterval(updatePositions, 60000);

// ── PORTFOLIO ROUTES ──────────────────────────────────────────────────────────

// Übersicht
app.get('/api/portfolio', (req, res) => {
  const p = portfolio;
  const closed = p.closedTrades;
  const wins   = closed.filter(t => t.realizedPnL > 0).length;
  const totalPnL = closed.reduce((a, t) => a + (t.realizedPnL || 0), 0);
  const totalMargin = p.openPositions.reduce((a, pos) => a + (pos.margin || 0), 0);
  res.json({
    equity: p.equity,
    totalMargin,
    marginPct: p.equity ? (totalMargin / p.equity * 100).toFixed(1) + '%' : '0%',
    openCount: p.openPositions.length,
    totalTrades: closed.length,
    wins, losses: closed.length - wins,
    winRate: closed.length ? ((wins / closed.length) * 100).toFixed(1) + '%' : '—',
    totalPnL: totalPnL.toFixed(2),
    settings: p.settings,
    timestamp: new Date().toISOString()
  });
});

// Position öffnen
app.post('/api/positions/open', async (req, res) => {
  const { ticker = 'GC=F', direction, type = 'cfd', leverage, invest, strategie = 'manual', source = 'goldglobe', overrideChecks = false } = req.body;
  if (!direction) return res.status(400).json({ error: 'direction required' });

  const p   = portfolio;
  const lev = leverage || p.settings.defaultLeverage;
  const eq  = p.equity;

  // Max-Trade-Check
  if (!overrideChecks && p.openPositions.length >= p.settings.maxOpenTrades)
    return res.status(400).json({ error: `Max ${p.settings.maxOpenTrades} offene Trades` });

  // Margin-Budget
  const budget = invest || (eq * p.settings.maxRiskPerTrade);
  const totalMargin = p.openPositions.reduce((a, pos) => a + (pos.margin || 0), 0);
  if (!overrideChecks && (totalMargin + budget) / eq > p.settings.maxTotalMarginPct)
    return res.status(400).json({ error: `Margin-Limit erreicht (${(p.settings.maxTotalMarginPct*100)}%)` });

  try {
    const priceData = await fetchPrice(ticker, '1y');
    const ind       = calcAllIndicators(priceData.history);
    const regime    = detectRegime(ind);
    const conf      = calcConfluence(ind, regime);
    const lp        = calcLeverageParams(ticker, direction, ind.curr, lev, type, budget, ind.atr);

    const pos = {
      id:             `pos_${Date.now()}`,
      ticker,         name: getMeta(ticker).name,
      direction,      type,
      leverage:       lp.effectiveLev || lev,
      entryPrice:     ind.curr,
      currentPrice:   ind.curr,
      units:          lp.units,
      margin:         budget,
      notional:       lp.notional,
      sl:             lp.sl,
      tp:             lp.tp,
      barrier:        lp.barrier || null,
      certPrice:      lp.certPrice || null,
      rr:             lp.rr || null,
      confluenceScore: conf.score,
      regime,
      openTime:       new Date().toISOString(),
      closeTime:      null,
      status:         'open',
      unrealizedPnL:  0,
      realizedPnL:    null,
      strategie,
      source,
      leverageParams: lp,
    };

    p.openPositions.push(pos);
    savePortfolio(p);
    res.json({ ok: true, position: pos });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Offene Positionen (mit aktuellem Preis)
app.get('/api/positions', async (req, res) => {
  // Preise aktualisieren
  await updatePositions();
  res.json({ positions: portfolio.openPositions, equity: portfolio.equity });
});

// Position schließen
app.post('/api/positions/:id/close', (req, res) => {
  const { exitPrice } = req.body;
  const pos = portfolio.openPositions.find(p => p.id === req.params.id);
  if (!pos) return res.status(404).json({ error: 'Position nicht gefunden' });
  const exit = exitPrice || pos.currentPrice || pos.entryPrice;
  const closed = closePosition(req.params.id, exit, 'manual');
  res.json({ ok: true, trade: closed });
});

// Alle schließen
app.post('/api/positions/close-all', async (req, res) => {
  await updatePositions();
  const ids = portfolio.openPositions.map(p => p.id);
  const closed = [];
  for (const id of ids) {
    const pos = portfolio.openPositions.find(p => p.id === id);
    if (pos) closed.push(closePosition(id, pos.currentPrice || pos.entryPrice, 'manual_all'));
  }
  res.json({ ok: true, closed: closed.length });
});

// SL/TP anpassen
app.post('/api/positions/:id/update-sltp', (req, res) => {
  const { sl, tp } = req.body;
  const pos = portfolio.openPositions.find(p => p.id === req.params.id);
  if (!pos) return res.status(404).json({ error: 'nicht gefunden' });
  if (sl) pos.sl = sl;
  if (tp) pos.tp = tp;
  savePortfolio(portfolio);
  res.json({ ok: true, position: pos });
});

// Trade-Historie
app.get('/api/trades/history', (req, res) => {
  const limit  = parseInt(req.query.limit) || 100;
  const ticker = req.query.ticker || null;
  let trades   = portfolio.closedTrades.slice(0, limit);
  if (ticker) trades = trades.filter(t => t.ticker === ticker);
  res.json({ trades, total: portfolio.closedTrades.length });
});

// Trade-Statistiken
app.get('/api/trades/stats', (req, res) => {
  const trades = portfolio.closedTrades;
  if (!trades.length) return res.json({ message: 'Keine Trades' });
  const wins       = trades.filter(t => t.realizedPnL > 0);
  const losses     = trades.filter(t => t.realizedPnL <= 0);
  const totalPnL   = trades.reduce((a, t) => a + (t.realizedPnL || 0), 0);
  const grossWin   = wins.reduce((a, t) => a + t.realizedPnL, 0);
  const grossLoss  = Math.abs(losses.reduce((a, t) => a + t.realizedPnL, 0));
  const avgWin     = wins.length ? grossWin / wins.length : 0;
  const avgLoss    = losses.length ? grossLoss / losses.length : 0;
  const profFactor = grossLoss > 0 ? grossWin / grossLoss : null;

  // Nach Typ aufschlüsseln
  const byType = {};
  for (const t of trades) {
    if (!byType[t.type]) byType[t.type] = { count: 0, wins: 0, pnl: 0 };
    byType[t.type].count++; byType[t.type].pnl += t.realizedPnL || 0;
    if (t.realizedPnL > 0) byType[t.type].wins++;
  }

  // Max Drawdown auf Equity-Kurve
  let peak = 10000, dd = 0, runEq = 10000;
  for (const t of [...trades].reverse()) {
    runEq += t.realizedPnL || 0;
    if (runEq > peak) peak = runEq;
    const d = (peak - runEq) / peak * 100;
    if (d > dd) dd = d;
  }

  res.json({
    totalTrades: trades.length,
    wins: wins.length, losses: losses.length,
    winRate: ((wins.length / trades.length) * 100).toFixed(1) + '%',
    totalPnL: totalPnL.toFixed(2),
    avgWin: avgWin.toFixed(2), avgLoss: avgLoss.toFixed(2),
    profitFactor: profFactor ? profFactor.toFixed(2) : '—',
    maxDrawdown: dd.toFixed(1) + '%',
    byType
  });
});

// Obsidian Sync manuell
app.post('/api/trades/sync-obsidian', (req, res) => {
  const ok = syncToObsidian(portfolio);
  res.json({ ok, path: OBSIDIAN_TRADES });
});

// Equity zurücksetzen / Portfolio resetten
app.post('/api/portfolio/reset', (req, res) => {
  const { equity = 10000 } = req.body;
  portfolio = JSON.parse(JSON.stringify(DEFAULT_PORTFOLIO));
  portfolio.equity = equity;
  savePortfolio(portfolio);
  res.json({ ok: true, equity });
});

// ════════════════════════════════════════════════════════════════════
// EXTERNE BOTS — Google Drive & Webhook-Empfang
// ════════════════════════════════════════════════════════════════════

// Externes Signal empfangen (andere Bots posten hierher)
app.post('/api/external-signal', async (req, res) => {
  const { botName, ticker, signal, sl, tp, confidence, reason, strategy, leverage, type } = req.body;
  if (!botName || !signal) return res.status(400).json({ error: 'botName + signal required' });

  const entry = {
    botName, ticker: ticker || 'GC=F', signal, sl, tp, confidence,
    reason, strategy, leverage, type: type || 'cfd',
    receivedAt: new Date().toISOString()
  };

  // Speichern
  if (!portfolio.externalBots[botName]) portfolio.externalBots[botName] = { history: [] };
  portfolio.externalBots[botName].lastSignal   = signal;
  portfolio.externalBots[botName].lastTicker   = ticker;
  portfolio.externalBots[botName].lastSeen     = new Date().toISOString();
  portfolio.externalBots[botName].history.unshift(entry);
  if (portfolio.externalBots[botName].history.length > 50) portfolio.externalBots[botName].history.pop();

  // Auto-Trade wenn Signal strong ist
  let autoTrade = null;
  if (confidence >= 70 && (signal === 'BUY' || signal === 'SELL')) {
    try {
      const priceData = await fetchPrice(ticker || 'GC=F', '1y');
      const ind       = calcAllIndicators(priceData.history);
      const lev       = leverage || portfolio.settings.defaultLeverage;
      const budget    = portfolio.equity * portfolio.settings.maxRiskPerTrade;
      const lp        = calcLeverageParams(ticker || 'GC=F', signal, ind.curr, lev, type || 'cfd', budget, ind.atr);

      if (portfolio.openPositions.length < portfolio.settings.maxOpenTrades) {
        const pos = {
          id: `pos_ext_${Date.now()}`, ticker: ticker || 'GC=F', name: getMeta(ticker||'GC=F').name,
          direction: signal, type: type || 'cfd', leverage: lev,
          entryPrice: ind.curr, currentPrice: ind.curr,
          units: lp.units, margin: budget, notional: lp.notional,
          sl: sl || lp.sl, tp: tp || lp.tp, barrier: lp.barrier || null,
          confluenceScore: confidence / 10, regime: detectRegime(ind),
          openTime: new Date().toISOString(), status: 'open',
          unrealizedPnL: 0, realizedPnL: null,
          strategie: strategy || botName, source: botName, leverageParams: lp,
        };
        portfolio.openPositions.push(pos);
        autoTrade = pos;
      }
    } catch (e) { console.error('Auto-Trade ext signal:', e.message); }
  }

  savePortfolio(portfolio);
  res.json({ ok: true, entry, autoTrade });
});

// Fleet Status (alle Bots)
app.get('/api/fleet', (req, res) => {
  res.json({
    externalBots: portfolio.externalBots,
    openPositions: portfolio.openPositions.length,
    botCount: Object.keys(portfolio.externalBots).length,
    timestamp: new Date().toISOString()
  });
});

// Google Drive Bot-Sync (polling von einem Google Sheet / CSV URL)
app.post('/api/fleet/gdrive-sync', async (req, res) => {
  const { sheetUrl, botName = 'gdrive-bot' } = req.body;
  if (!sheetUrl) return res.status(400).json({ error: 'sheetUrl required' });

  try {
    // Google Sheets CSV Export URL: spreadsheets/d/ID/export?format=csv
    const csvUrl = sheetUrl.includes('export') ? sheetUrl
      : sheetUrl.replace('/edit', '/export?format=csv');
    const r    = await axios.get(csvUrl, { timeout: 10000 });
    const rows = r.data.split('\n').slice(1).filter(Boolean);
    const signals = [];

    for (const row of rows.slice(-10)) { // Letzte 10 Zeilen
      const cols = row.split(',');
      if (cols.length >= 4) {
        signals.push({ ticker: cols[0]?.trim(), signal: cols[1]?.trim(), confidence: parseFloat(cols[2]), reason: cols[3]?.trim(), ts: cols[4]?.trim() });
      }
    }

    // Neuestes Signal verarbeiten
    const latest = signals[signals.length - 1];
    if (latest?.signal) {
      if (!portfolio.externalBots[botName]) portfolio.externalBots[botName] = { history: [] };
      portfolio.externalBots[botName].lastSignal  = latest.signal;
      portfolio.externalBots[botName].lastTicker  = latest.ticker;
      portfolio.externalBots[botName].lastSeen    = new Date().toISOString();
      portfolio.externalBots[botName].history.unshift({ ...latest, botName, receivedAt: new Date().toISOString() });
      savePortfolio(portfolio);
    }

    res.json({ ok: true, signals, latest, botName });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════
// NEURAL STATUS — Live-Zustand des Bot-Gehirns für Visualisierung
// ════════════════════════════════════════════════════════════════════
app.get('/api/neural-status', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  try {
    const priceData = await fetchPrice(ticker, '1y');
    const ind       = calcAllIndicators(priceData.history);
    const regime    = detectRegime(ind);
    const conf      = calcConfluence(ind, regime);
    const session   = getSessionInfo(ticker);

    const nodes = {
      marketData:  { id: 'marketData',  label: 'Market Data',       status: 'active',   value: `$${ind.curr?.toFixed(2)}`,      color: '#44cc88' },
      indicators:  { id: 'indicators',  label: 'Indicator Engine',   status: 'active',   value: `RSI:${ind.rsi?.toFixed(0)} ADX:${ind.adx?.adx?.toFixed(0)}`, color: '#60a5fa' },
      regime:      { id: 'regime',      label: 'Regime Detector',    status: 'active',   value: regime.toUpperCase(),             color: '#a78bfa' },
      confluence:  { id: 'confluence',  label: 'Confluence Engine',  status: conf.tradeable ? 'active' : 'idle', value: `${conf.score}/${conf.maxScore} ${conf.direction}`, color: conf.direction==='BUY'?'#44cc88':conf.direction==='SELL'?'#ff4444':'#ffcc00' },
      session:     { id: 'session',     label: 'Session Filter',     status: session.tradeable ? 'active' : 'blocked', value: session.label, color: session.tradeable ? '#44cc88' : '#ff8844' },
      claudeAI:    { id: 'claudeAI',    label: 'Claude AI',          status: 'standby',  value: 'claude-sonnet-4-6',              color: '#f0c040' },
      riskMgr:     { id: 'riskMgr',     label: 'Risk Manager',       status: 'active',   value: `ATR:$${ind.atr?.toFixed(2)}`,    color: '#fb923c' },
      positions:   { id: 'positions',   label: 'Position Manager',   status: portfolio.openPositions.length ? 'active' : 'idle', value: `${portfolio.openPositions.length} offen`, color: '#34d399' },
      botWebhook:  { id: 'botWebhook',  label: 'Bot Webhook',        status: 'standby',  value: 'Railway',                       color: '#60a5fa' },
      obsidian:    { id: 'obsidian',    label: 'Obsidian Vault',     status: 'idle',     value: 'cloud/obsidian',                 color: '#a78bfa' },
      extBots:     { id: 'extBots',     label: 'External Bots',      status: Object.keys(portfolio.externalBots).length ? 'active' : 'idle', value: `${Object.keys(portfolio.externalBots).length} Bots`, color: '#f472b6' },
    };

    const edges = [
      { from: 'marketData',  to: 'indicators',  active: true,  dir: conf.direction },
      { from: 'indicators',  to: 'regime',       active: true,  dir: conf.direction },
      { from: 'indicators',  to: 'confluence',   active: true,  dir: conf.direction },
      { from: 'regime',      to: 'confluence',   active: true,  dir: conf.direction },
      { from: 'confluence',  to: 'session',      active: conf.tradeable, dir: conf.direction },
      { from: 'session',     to: 'claudeAI',     active: session.tradeable && conf.tradeable, dir: conf.direction },
      { from: 'confluence',  to: 'claudeAI',     active: conf.tradeable, dir: conf.direction },
      { from: 'claudeAI',    to: 'riskMgr',      active: session.tradeable && conf.tradeable, dir: conf.direction },
      { from: 'riskMgr',     to: 'positions',    active: true, dir: conf.direction },
      { from: 'riskMgr',     to: 'botWebhook',   active: session.tradeable && conf.tradeable, dir: conf.direction },
      { from: 'positions',   to: 'obsidian',     active: portfolio.openPositions.length > 0, dir: 'neutral' },
      { from: 'extBots',     to: 'confluence',   active: Object.keys(portfolio.externalBots).length > 0, dir: 'neutral' },
      { from: 'extBots',     to: 'positions',    active: Object.keys(portfolio.externalBots).length > 0, dir: 'neutral' },
    ];

    res.json({ nodes, edges, ticker, regime, confluence: conf, session, portfolio: { equity: portfolio.equity, openPositions: portfolio.openPositions.length }, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`🌍 Globe läuft auf http://localhost:${PORT}`));
