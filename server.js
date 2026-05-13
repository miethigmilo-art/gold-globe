require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3001;

let Anthropic;
try {
  const sdk = require('@anthropic-ai/sdk');
  Anthropic = sdk.default || sdk;
} catch (e) {
  console.error('Anthropic SDK nicht gefunden:', e.message);
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Ticker-Metadaten ─────────────────────────────────────────────────────────
const TICKER_META = {
  'GC=F':    { name: 'Gold',          symbol: 'XAU/USD', type: 'commodity', cur: 'USD' },
  'SI=F':    { name: 'Silver',        symbol: 'XAG/USD', type: 'commodity', cur: 'USD' },
  'CL=F':    { name: 'Crude Oil',     symbol: 'WTI',     type: 'commodity', cur: 'USD' },
  'SPY':     { name: 'S&P 500',       symbol: 'SPY',     type: 'etf',       cur: 'USD' },
  'QQQ':     { name: 'NASDAQ 100',    symbol: 'QQQ',     type: 'etf',       cur: 'USD' },
  'AAPL':    { name: 'Apple',         symbol: 'AAPL',    type: 'stock',     cur: 'USD' },
  'NVDA':    { name: 'NVIDIA',        symbol: 'NVDA',    type: 'stock',     cur: 'USD' },
  'BTC-USD': { name: 'Bitcoin',       symbol: 'BTC/USD', type: 'crypto',    cur: 'USD' },
  'ETH-USD': { name: 'Ethereum',      symbol: 'ETH/USD', type: 'crypto',    cur: 'USD' },
};

function getMeta(ticker) {
  return TICKER_META[ticker] || { name: ticker, symbol: ticker, type: 'unknown', cur: 'USD' };
}

function getSystemPrompt(ticker) {
  const m = getMeta(ticker);
  return `You are a ${m.name} market analyst AI with expertise in geopolitics, macroeconomics, and ${m.type} markets.

When analyzing country influence on ${m.name} prices (-5 to +5):
+5: Major buyers/drivers, high conflict/crisis, strong direct correlation
+3: Active participants, rising exposure, geopolitical hotspots
0: Neutral, balanced impact
-3: Stabilizing forces, sellers, low exposure
-5: Actively suppressive policy, dominant alternatives

Always respond ONLY with valid JSON, no markdown, no explanations outside JSON.`;
}

// ── Cache (keyed by ticker) ──────────────────────────────────────────────────
const cache = {};
const TTL_LONG  = 3600000;  // 1h
const TTL_SHORT = 300000;   // 5min

function getCache(ticker) {
  if (!cache[ticker]) cache[ticker] = { countries: null, events: null, price: null, tCountry: 0, tEvents: 0, tPrice: 0 };
  return cache[ticker];
}

// ── Price fetcher ────────────────────────────────────────────────────────────
async function fetchPrice(ticker, range = '2y') {
  const c = getCache(ticker);
  if (c.price && Date.now() - c.tPrice < TTL_SHORT) return c.price;

  const r = await axios.get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }
  );
  const result = r.data.chart.result[0];
  const history = result.timestamp
    .map((ts, i) => ({
      date:  new Date(ts * 1000).toISOString().split('T')[0],
      price: result.indicators.quote[0].close[i],
      high:  result.indicators.quote[0].high?.[i],
      low:   result.indicators.quote[0].low?.[i],
      vol:   result.indicators.quote[0].volume?.[i],
    }))
    .filter(d => d.price != null);

  const data = { history, current: history[history.length - 1] };
  c.price  = data;
  c.tPrice = Date.now();
  return data;
}

// ── ATR helper ───────────────────────────────────────────────────────────────
function calcATR(history, period = 14) {
  const trs = [];
  for (let i = 1; i < history.length; i++) {
    const h = history[i].high || history[i].price;
    const l = history[i].low  || history[i].price;
    const pc = history[i - 1].price;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

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
      messages: [{ role: 'user', content: `Return a JSON object mapping ISO-3 country codes to influence data for ${meta.name} prices in ${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}.

Include ALL: USA,CHN,IND,RUS,SAU,AUS,ZAF,CAN,GBR,DEU,FRA,JPN,BRA,MEX,TUR,EGY,IRN,IRQ,UKR,ISR,GHA,PER,IDN,KOR,CHE,SGP,ARE,KAZ,MNG,ARG,NGA,ETH,ZMB,PNG,MYS,THA,VNM,PAK,BGD,COD,POL,SWE,NOR,FIN,NLD,BEL,ITA,ESP,PRT,AUT

Format: {"USA":{"score":-2,"name":"United States","reason":"reason","trend":"bearish"}}` }]
    });

    const text = msg.content[0].text;
    const m = text.match(/\{[\s\S]*\}/);
    const data = JSON.parse(m[0]);
    c.countries  = data;
    c.tCountry   = Date.now();
    res.json(data);
  } catch (err) {
    console.error('/api/countries:', err.message);
    res.status(500).json({ error: err.message });
  }
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
      messages: [{ role: 'user', content: `List 12 current major events affecting ${meta.name} prices (${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}).

Return ONLY a JSON array:
[{"id":1,"type":"war","name":"Event Name","lat":49.0,"lng":32.0,"description":"desc","impact":"bullish","magnitude":5}]

Types: war,trade_route,sanctions,central_bank,mining,economic,geopolitical,earnings,regulation,macro
Impact: bullish,bearish,neutral  Magnitude: 1-5` }]
    });

    const text = msg.content[0].text;
    const m = text.match(/\[[\s\S]*\]/);
    const data = JSON.parse(m[0]);
    c.events  = data;
    c.tEvents = Date.now();
    res.json(data);
  } catch (err) {
    console.error('/api/events:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Country detail ────────────────────────────────────────────────────────────
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
      messages: [{ role: 'user', content: `Analyze ${country}'s current impact on ${meta.name} prices.

Return ONLY:
{"country":"${country}","score":0,"headline":"brief headline","factors":["f1","f2","f3"],"recentEvents":["e1","e2"],"outlook":"short-term outlook","assetRelevance":"how country affects ${meta.name} specifically"}` }]
    });

    const text = msg.content.find(b => b.type === 'text')?.text || '{}';
    const m = text.match(/\{[\s\S]*\}/);
    res.json(JSON.parse(m[0]));
  } catch (err) {
    console.error('/api/analyze:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Recommendation (streaming SSE) ──────────────────────────────────────────
app.get('/api/recommendation', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  const meta = getMeta(ticker);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const stream = client.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: getSystemPrompt(ticker), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Provide a comprehensive ${meta.name} (${meta.symbol}) trading recommendation for ${new Date().toLocaleString('de-DE', { month: 'long', year: 'numeric' })}.

## 🎯 EMPFEHLUNG: [KAUFEN / VERKAUFEN / HALTEN]
**Konfidenz:** X%
**Zielpreis (3 Monate):** $X

## 📊 Makroökonomische Analyse
## 🌍 Geopolitische Faktoren
## ⚠️ Hauptrisiken
## 📈 Einstiegsstrategie

Deutsch. Präzise Zahlen und Zeitrahmen.` }]
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── Price history ─────────────────────────────────────────────────────────────
app.get('/api/gold-price', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  try {
    res.json(await fetchPrice(ticker));
  } catch (err) {
    console.error('/api/gold-price:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Backtest ──────────────────────────────────────────────────────────────────
app.get('/api/backtest', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  try {
    const data = await fetchPrice(ticker);
    const history = data.history;

    let position = null, equity = 10000;
    let positionAI = null, equityAI = 10000;
    const equityCurve = [], equityCurveAI = [], trades = [];

    for (let i = 50; i < history.length; i++) {
      const prices = history.slice(i - 50, i).map(d => d.price);
      const sma20  = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const sma50  = prices.reduce((a, b) => a + b, 0) / 50;
      const price  = history[i].price;
      const trend  = Math.max(0, Math.min(1, (sma20 / sma50 - 1) * 50));

      if (!position && sma20 > sma50 * 1.002) {
        position = { entry: price, date: history[i].date, units: equity / price };
        trades.push({ type: 'BUY', date: history[i].date, price: price.toFixed(2) });
      } else if (position && sma20 < sma50 * 0.998) {
        const pnl = (price - position.entry) * position.units;
        equity += pnl;
        trades.push({ type: 'SELL', date: history[i].date, price: price.toFixed(2), pnl: pnl.toFixed(2) });
        position = null;
      }

      if (!positionAI && sma20 > sma50 * 1.002) {
        positionAI = { entry: price, sl: price * 0.985, tp: price * (1.025 + trend * 0.02), units: equityAI / price };
      } else if (positionAI) {
        if (trend > 0.5) {
          positionAI.tp = Math.max(positionAI.tp, price * (1.015 + trend * 0.015));
          positionAI.sl = Math.max(positionAI.sl, price * (0.988 + trend * 0.005));
        } else {
          positionAI.sl = Math.max(positionAI.sl, price * 0.992);
        }
        const hitSL = price <= positionAI.sl, hitTP = price >= positionAI.tp;
        if (hitSL || hitTP || sma20 < sma50 * 0.998) {
          equityAI += ((hitTP ? positionAI.tp : hitSL ? positionAI.sl : price) - positionAI.entry) * positionAI.units;
          positionAI = null;
        }
      }

      equityCurve.push({ date: history[i].date, equity: parseFloat((position ? equity + (price - position.entry) * position.units : equity).toFixed(2)) });
      equityCurveAI.push({ date: history[i].date, equity: parseFloat((positionAI ? equityAI + (price - positionAI.entry) * positionAI.units : equityAI).toFixed(2)) });
    }

    const sells = trades.filter(t => t.type === 'SELL');
    const wins  = sells.filter(t => parseFloat(t.pnl) > 0).length;

    function maxDD(curve) {
      let peak = curve[0]?.equity || 10000, dd = 0;
      for (const p of curve) {
        if (p.equity > peak) peak = p.equity;
        const d = (peak - p.equity) / peak * 100;
        if (d > dd) dd = d;
      }
      return dd;
    }

    res.json({
      ticker,
      trades: trades.slice(-30),
      equityCurve: equityCurve.slice(-500),
      equityCurveAI: equityCurveAI.slice(-500),
      stats: {
        totalTrades: sells.length,
        winRate: sells.length ? ((wins / sells.length) * 100).toFixed(1) + '%' : '0%',
        totalReturn: (((equity - 10000) / 10000) * 100).toFixed(1) + '%',
        finalEquity: equity.toFixed(2),
        maxDrawdown: maxDD(equityCurve).toFixed(1) + '%',
        strategy: 'SMA 20/50'
      },
      statsAI: {
        totalReturn: (((equityAI - 10000) / 10000) * 100).toFixed(1) + '%',
        finalEquity: equityAI.toFixed(2),
        maxDrawdown: maxDD(equityCurveAI).toFixed(1) + '%',
        strategy: 'SMA 20/50 + KI SL/TP'
      },
      realStats: { totalReturn: '35.000%', winRate: '56%', profitFactor: '1.7', maxDrawdown: '32.44%', totalTrades: 187, strategy: 'Dein Trading Bot (real)' }
    });
  } catch (err) {
    console.error('/api/backtest:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Signal ────────────────────────────────────────────────────────────────────
app.post('/api/signal', async (req, res) => {
  const { strategie = 'mittel', dryRun = false, ticker = 'GC=F' } = req.body;
  const meta = getMeta(ticker);
  try {
    let currentPrice = 3200;
    try { const d = await fetchPrice(ticker, '5d'); currentPrice = d.current.price; } catch {}

    const msg = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 512,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: getSystemPrompt(ticker), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Aktueller ${meta.name} Preis: $${currentPrice.toFixed(2)}

Analysiere JETZT und generiere ein präzises Trading-Signal.
Nur traden wenn Konfidenz > 65%.

Gib NUR JSON zurück:
{"signal":"BUY","confidence":75,"sl":${(currentPrice * 0.985).toFixed(2)},"tp":${(currentPrice * 1.025).toFixed(2)},"reason":"kurze Begründung","skip":false}

Wenn kein Signal: {"skip":true,"reason":"Kein klares Signal"}` }]
    });

    const text   = msg.content.find(b => b.type === 'text')?.text || '{}';
    const signal = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);

    if (signal.skip) return res.json({ status: 'skipped', reason: signal.reason });

    const payload = { side: signal.signal, sl: parseFloat(signal.sl), tp: parseFloat(signal.tp) };
    let botResponse = null;
    if (!dryRun) {
      try {
        const r = await axios.post(`${TRADING_BOT_URL}/webhook/${strategie}`, payload, { timeout: 10000 });
        botResponse = r.data;
      } catch (e) { botResponse = { error: e.message }; }
    }

    res.json({ status: 'sent', signal, payload, botResponse, dryRun, ticker, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('/api/signal:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Market View ───────────────────────────────────────────────────────────────
app.get('/api/market-view', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  const meta = getMeta(ticker);
  try {
    const priceData = await fetchPrice(ticker, '20d');
    const currentPrice = priceData.current.price;
    const atr = calcATR(priceData.history);

    const msg = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 512,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: getSystemPrompt(ticker), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `${meta.name} Preis: $${currentPrice.toFixed(2)}, ATR(14): $${atr.toFixed(2)}

Offene Long-Position läuft. Empfehle SL/TP Anpassung.

Gib NUR JSON:
{"sentiment":"bullish","score":3,"sl_action":"tighten","sl_adjustment_pct":-0.5,"tp_action":"extend","tp_adjustment_pct":1.2,"confidence":72,"reason":"max 15 Wörter"}` }]
    });

    const text = msg.content.find(b => b.type === 'text')?.text || '{}';
    const view = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
    res.json({ ...view, ticker, price: currentPrice, atr, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('/api/market-view:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SNAPSHOT — Bot-optimierter Einzel-Endpunkt ───────────────────────────────
// GET /api/snapshot?ticker=GC=F
// Gibt alles zurück was ein Bot in einem Call braucht
app.get('/api/snapshot', async (req, res) => {
  const ticker = req.query.ticker || 'GC=F';
  const meta   = getMeta(ticker);
  try {
    // Preis (kurz gecacht)
    const priceData = await fetchPrice(ticker, '20d');
    const currentPrice = priceData.current.price;
    const prevPrice    = priceData.history[priceData.history.length - 2]?.price;
    const change24h    = prevPrice ? ((currentPrice - prevPrice) / prevPrice * 100) : 0;
    const atr          = calcATR(priceData.history);

    // Signal + Sentiment parallel via Claude
    const [sigMsg, viewMsg] = await Promise.all([
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        system: [{ type: 'text', text: getSystemPrompt(ticker), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `${meta.name}: $${currentPrice.toFixed(2)}, ATR: $${atr.toFixed(2)}, 24h: ${change24h.toFixed(2)}%

Schnelles Trading-Signal. Nur JSON:
{"signal":"BUY","confidence":70,"sl":${(currentPrice*0.985).toFixed(2)},"tp":${(currentPrice*1.02).toFixed(2)},"reason":"max 10 Wörter","skip":false}` }]
      }),
      client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 128,
        system: [{ type: 'text', text: getSystemPrompt(ticker), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `${meta.name}: $${currentPrice.toFixed(2)}. Markt-Sentiment. Nur JSON:
{"sentiment":"bullish","score":3,"trend":"up","confidence":72,"summary":"max 10 Wörter"}` }]
      })
    ]);

    const sigText  = sigMsg.content[0]?.text  || '{}';
    const viewText = viewMsg.content[0]?.text || '{}';
    const signal   = JSON.parse(sigText.match(/\{[\s\S]*\}/)[0]);
    const view     = JSON.parse(viewText.match(/\{[\s\S]*\}/)[0]);

    // Länder-Top-5 aus Cache (kein neuer API-Call wenn nicht gecacht)
    const c = getCache(ticker);
    let topCountries = [];
    if (c.countries) {
      topCountries = Object.entries(c.countries)
        .sort((a, b) => Math.abs(b[1].score) - Math.abs(a[1].score))
        .slice(0, 5)
        .map(([iso, d]) => ({ iso, ...d }));
    }

    // Events aus Cache
    const events = c.events ? c.events.slice(0, 5) : [];

    res.json({
      ticker,
      meta,
      price: { current: currentPrice, change24h: parseFloat(change24h.toFixed(2)), atr: parseFloat(atr.toFixed(2)) },
      signal:  signal.skip ? { skip: true, reason: signal.reason } : signal,
      view,
      topCountries,
      events,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('/api/snapshot:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Ticker-Liste ──────────────────────────────────────────────────────────────
app.get('/api/tickers', (req, res) => res.json(TICKER_META));

// ── Trading Bot Proxy ─────────────────────────────────────────────────────────
const TRADING_BOT_URL = process.env.TRADING_BOT_URL || 'https://trading-bot-production-86d8.up.railway.app';

app.get('/api/trading-performance', async (req, res) => {
  try {
    const r = await axios.get(`${TRADING_BOT_URL}/api/performance`, { timeout: 15000 });
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/trading-adjust', async (req, res) => {
  try {
    const r = await axios.post(`${TRADING_BOT_URL}/api/auto-adjust`, req.body, { timeout: 60000 });
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Auto-Signal ───────────────────────────────────────────────────────────────
let autoInterval = null;
let autoConfig   = { strategie: 'goldglobe', intervalMins: 60, ticker: 'GC=F' };
let letzteSignale = [];

async function runAutoSignal() {
  const ticker = autoConfig.ticker;
  const meta   = getMeta(ticker);
  console.log(`🤖 Auto-Signal [${meta.name}/${autoConfig.strategie}]...`);
  try {
    let currentPrice = 3200;
    try { const d = await fetchPrice(ticker, '5d'); currentPrice = d.current.price; } catch {}

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: getSystemPrompt(ticker), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content:
        `${meta.name}: $${currentPrice.toFixed(2)}\nSignal generieren. Nur JSON:\n` +
        `{"signal":"BUY","confidence":75,"sl":${(currentPrice*0.985).toFixed(2)},"tp":${(currentPrice*1.025).toFixed(2)},"reason":"kurze Begründung","skip":false}\n` +
        `Wenn kein Signal: {"skip":true,"reason":"Kein Signal"}`
      }]
    });

    const text   = msg.content.find(b => b.type === 'text')?.text || '{}';
    const signal = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
    const logEntry = { ts: new Date().toISOString(), ticker, strategie: autoConfig.strategie, signal: signal.skip ? 'SKIP' : signal.signal, confidence: signal.confidence || null, reason: signal.reason, botResponse: null };

    if (!signal.skip) {
      try {
        const r = await axios.post(`${TRADING_BOT_URL}/webhook/${autoConfig.strategie}`,
          { side: signal.signal, sl: parseFloat(signal.sl), tp: parseFloat(signal.tp) }, { timeout: 10000 });
        logEntry.botResponse = r.data;
        console.log(`✅ ${signal.signal} | ${signal.confidence}% | ${meta.name}`);
      } catch (e) { logEntry.botResponse = { error: e.message }; }
    } else {
      console.log(`⏭ ${signal.reason}`);
    }

    letzteSignale.unshift(logEntry);
    if (letzteSignale.length > 50) letzteSignale.pop();
  } catch (e) { console.error('❌ Auto-Signal:', e.message); }
}

app.post('/api/auto/start', (req, res) => {
  const { strategie = 'goldglobe', intervalMins = 60, ticker = 'GC=F' } = req.body;
  if (autoInterval) clearInterval(autoInterval);
  autoConfig = { strategie, intervalMins, ticker };
  runAutoSignal();
  autoInterval = setInterval(runAutoSignal, intervalMins * 60 * 1000);
  console.log(`▶ Auto: alle ${intervalMins}min [${ticker}/${strategie}]`);
  res.json({ ok: true, strategie, intervalMins, ticker });
});

app.post('/api/auto/stop', (req, res) => {
  if (autoInterval) { clearInterval(autoInterval); autoInterval = null; }
  res.json({ ok: true });
});

app.get('/api/auto/status', (req, res) => res.json({ aktiv: !!autoInterval, ...autoConfig, letzteSignale }));

// ── Image proxy ───────────────────────────────────────────────────────────────
app.get('/img/:name', async (req, res) => {
  try {
    const r = await axios.get('https://cdn.jsdelivr.net/npm/three-globe@2.32.2/example/img/' + req.params.name, { responseType: 'arraybuffer', timeout: 15000 });
    res.setHeader('Content-Type', r.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(r.data));
  } catch { res.status(500).send('Image error'); }
});

// ── GeoJSON proxy ─────────────────────────────────────────────────────────────
let geoJsonCache = null;
app.get('/api/geojson', async (req, res) => {
  try {
    if (geoJsonCache) return res.json(geoJsonCache);
    const r = await axios.get('https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson', { timeout: 15000 });
    geoJsonCache = r.data;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`🌍 Globe läuft auf http://localhost:${PORT}`));
