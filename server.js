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

const SYSTEM_PROMPT = `You are a gold market analyst AI with expertise in geopolitics, macroeconomics, and commodity markets.

When analyzing country influence on gold prices (-5 to +5):
+5: Major gold buyers/hoarders, high conflict zones, hyperinflation, heavy sanctions
+3: Active central bank buyers, gold producers with rising output, geopolitical hotspots
0: Neutral, balanced trade, moderate economies
-3: Strong USD allies, gold sellers, low inflation stable economies
-5: US dollar dominance, aggressive rate hikes, strong crypto alternatives

Always respond ONLY with valid JSON, no markdown, no explanations outside JSON.`;

const cache = { countries: null, events: null, gold: null, tCountry: 0, tEvents: 0, tGold: 0 };
const TTL = 3600000;

// ── Country influence ────────────────────────────────────────────────────────
app.get('/api/countries', async (req, res) => {
  try {
    if (cache.countries && Date.now() - cache.tCountry < TTL) return res.json(cache.countries);

    const msg = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Return a JSON object mapping ISO-3 country codes to influence data for gold prices in April 2026.

Include ALL of these countries: USA, CHN, IND, RUS, SAU, AUS, ZAF, CAN, GBR, DEU, FRA, JPN, BRA, MEX, TUR, EGY, IRN, IRQ, UKR, ISR, GHA, PER, IDN, KOR, CHE, SGP, ARE, KAZ, MNG, ARG, NGA, ETH, ZMB, PNG, MYS, THA, VNM, PAK, BGD, COD, POL, SWE, NOR, FIN, NLD, BEL, ITA, ESP, PRT, AUT

Format exactly:
{"USA":{"score":-2,"name":"United States","reason":"Strong dollar, Fed rate policy suppresses gold","trend":"bearish"},"CHN":{"score":4,"name":"China","reason":"Record central bank gold buying, de-dollarization","trend":"bullish"}}` }]
    });

    const text = msg.content[0].text;
    const m = text.match(/\{[\s\S]*\}/);
    const data = JSON.parse(m[0]);
    cache.countries = data;
    cache.tCountry = Date.now();
    res.json(data);
  } catch (err) {
    console.error('/api/countries:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Geopolitical events ──────────────────────────────────────────────────────
app.get('/api/events', async (req, res) => {
  try {
    if (cache.events && Date.now() - cache.tEvents < TTL) return res.json(cache.events);

    const msg = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2048,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `List 12 current major events affecting gold prices (April 2026).

Return ONLY a JSON array:
[{"id":1,"type":"war","name":"Russia-Ukraine War","lat":49.0,"lng":32.0,"description":"Ongoing conflict, safe-haven demand","impact":"bullish","magnitude":5},{"id":2,"type":"trade_route","name":"Suez Canal Disruptions","lat":30.0,"lng":32.5,"description":"Houthi attacks disrupting trade","impact":"bullish","magnitude":3}]

Types: war, trade_route, sanctions, central_bank, mining, economic, geopolitical
Impact: bullish, bearish, neutral
Magnitude: 1-5` }]
    });

    const text = msg.content[0].text;
    const m = text.match(/\[[\s\S]*\]/);
    const data = JSON.parse(m[0]);
    cache.events = data;
    cache.tEvents = Date.now();
    res.json(data);
  } catch (err) {
    console.error('/api/events:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Country detail analysis ──────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { country } = req.body;
  if (!country) return res.status(400).json({ error: 'country required' });
  try {
    const msg = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Analyze ${country}'s current impact on gold prices (April 2026).

Return ONLY this JSON:
{"country":"${country}","score":0,"headline":"brief headline","factors":["factor 1","factor 2","factor 3"],"recentEvents":["event 1","event 2"],"outlook":"short-term outlook description","goldRelevance":"how this country affects gold specifically"}` }]
    });

    const text = msg.content.find(b => b.type === 'text')?.text || '{}';
    const m = text.match(/\{[\s\S]*\}/);
    res.json(JSON.parse(m[0]));
  } catch (err) {
    console.error('/api/analyze:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── AI Recommendation (streaming SSE) ───────────────────────────────────────
app.get('/api/recommendation', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const stream = client.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Provide a comprehensive GOLD trading recommendation for April 2026.

Structure your response as:
## 🎯 EMPFEHLUNG: [KAUFEN / VERKAUFEN / HALTEN]
**Konfidenz:** X%
**Zielpreis (3 Monate):** $X.XXX

## 📊 Makroökonomische Analyse
[analysis]

## 🌍 Geopolitische Faktoren
[analysis]

## ⚠️ Hauptrisiken
[risks]

## 📈 Einstiegsstrategie
[strategy]

Write in German. Be specific with numbers and timeframes.` }]
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

// ── Gold price history (Yahoo Finance) ──────────────────────────────────────
app.get('/api/gold-price', async (req, res) => {
  try {
    if (cache.gold && Date.now() - cache.tGold < 300000) return res.json(cache.gold);

    const r = await axios.get(
      'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=2y',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }
    );
    const result = r.data.chart.result[0];
    const history = result.timestamp
      .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().split('T')[0], price: result.indicators.quote[0].close[i] }))
      .filter(d => d.price != null);

    const data = { history, current: history[history.length - 1] };
    cache.gold = data;
    cache.tGold = Date.now();
    res.json(data);
  } catch (err) {
    console.error('/api/gold-price:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Backtest (SMA 20/50 + KI-Enhanced) ──────────────────────────────────────
app.get('/api/backtest', async (req, res) => {
  try {
    let history;
    if (cache.gold) {
      history = cache.gold.history;
    } else {
      const r = await axios.get(
        'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=2y',
        { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }
      );
      const result = r.data.chart.result[0];
      history = result.timestamp
        .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().split('T')[0], price: result.indicators.quote[0].close[i] }))
        .filter(d => d.price != null);
    }

    // ── Standard SMA 20/50 Strategie ─────────────────────────────────────────
    const trades = [];
    let position = null;
    let equity = 10000;
    const equityCurve = [];

    // ── KI-Enhanced Strategie ─────────────────────────────────────────────────
    let positionAI = null;
    let equityAI = 10000;
    const equityCurveAI = [];

    for (let i = 50; i < history.length; i++) {
      const prices = history.slice(i - 50, i).map(d => d.price);
      const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const sma50 = prices.reduce((a, b) => a + b, 0) / 50;
      const price = history[i].price;

      // Trend-Stärke als KI-Sentiment-Proxy (0..1)
      const trendStärke = Math.max(0, Math.min(1, (sma20 / sma50 - 1) * 50));

      // ── Standard Entry/Exit ──────────────────────────────────────────────
      if (!position && sma20 > sma50 * 1.002) {
        const sl = price * 0.985;
        const tp = price * 1.025;
        position = { entry: price, date: history[i].date, sl, tp, units: equity / price };
        trades.push({ type: 'BUY', date: history[i].date, price: price.toFixed(2) });
      } else if (position && sma20 < sma50 * 0.998) {
        const pnl = (price - position.entry) * position.units;
        equity += pnl;
        trades.push({ type: 'SELL', date: history[i].date, price: price.toFixed(2), pnl: pnl.toFixed(2) });
        position = null;
      }

      // ── KI-Enhanced Entry/Exit ───────────────────────────────────────────
      if (!positionAI && sma20 > sma50 * 1.002) {
        const sl = price * 0.985;
        const tp = price * (1.025 + trendStärke * 0.02); // stärkerer Trend → weiteres TP
        positionAI = { entry: price, date: history[i].date, sl, tp, units: equityAI / price };
      } else if (positionAI) {
        // KI passt SL/TP dynamisch an
        if (trendStärke > 0.5) {
          // Starker Trend: TP ausdehnen, SL nachziehen
          positionAI.tp  = Math.max(positionAI.tp,  price * (1.015 + trendStärke * 0.015));
          positionAI.sl  = Math.max(positionAI.sl,  price * (0.988 + trendStärke * 0.005));
        } else {
          // Schwacher Trend: TP enger, SL schützen
          positionAI.sl = Math.max(positionAI.sl, price * 0.992);
        }

        const hitSL = price <= positionAI.sl;
        const hitTP = price >= positionAI.tp;
        const crossover = sma20 < sma50 * 0.998;

        if (hitSL || hitTP || crossover) {
          const exitPrice = hitTP ? positionAI.tp : hitSL ? positionAI.sl : price;
          const pnl = (exitPrice - positionAI.entry) * positionAI.units;
          equityAI += pnl;
          positionAI = null;
        }
      }

      const curEquity   = position   ? equity   + (price - position.entry)   * position.units   : equity;
      const curEquityAI = positionAI ? equityAI + (price - positionAI.entry) * positionAI.units : equityAI;
      equityCurve.push({   date: history[i].date, equity: parseFloat(curEquity.toFixed(2))   });
      equityCurveAI.push({ date: history[i].date, equity: parseFloat(curEquityAI.toFixed(2)) });
    }

    const sellTrades = trades.filter(t => t.type === 'SELL');
    const wins = sellTrades.filter(t => parseFloat(t.pnl) > 0).length;

    // ── Drawdown berechnen ────────────────────────────────────────────────
    function maxDrawdown(curve) {
      let peak = curve[0]?.equity || 10000;
      let dd = 0;
      for (const p of curve) {
        if (p.equity > peak) peak = p.equity;
        const d = (peak - p.equity) / peak * 100;
        if (d > dd) dd = d;
      }
      return dd;
    }

    const ddStd = maxDrawdown(equityCurve);
    const ddAI  = maxDrawdown(equityCurveAI);

    res.json({
      trades: trades.slice(-30),
      equityCurve: equityCurve.slice(-500),
      equityCurveAI: equityCurveAI.slice(-500),
      stats: {
        totalTrades: sellTrades.length,
        winRate: sellTrades.length ? ((wins / sellTrades.length) * 100).toFixed(1) + '%' : '0%',
        totalReturn: (((equity - 10000) / 10000) * 100).toFixed(1) + '%',
        finalEquity: equity.toFixed(2),
        maxDrawdown: ddStd.toFixed(1) + '%',
        strategy: 'SMA 20/50'
      },
      statsAI: {
        totalReturn: (((equityAI - 10000) / 10000) * 100).toFixed(1) + '%',
        finalEquity: equityAI.toFixed(2),
        maxDrawdown: ddAI.toFixed(1) + '%',
        strategy: 'SMA 20/50 + KI SL/TP'
      },
      realStats: {
        totalReturn: '35.000%',
        winRate: '56%',
        profitFactor: '1.7',
        maxDrawdown: '32.44%',
        totalTrades: 187,
        strategy: 'Dein Trading Bot (real)'
      }
    });
  } catch (err) {
    console.error('/api/backtest:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Image proxy für Globe-Texturen
app.get('/img/:name', async (req, res) => {
  try {
    const base = 'https://cdn.jsdelivr.net/npm/three-globe@2.32.2/example/img/';
    const r = await axios.get(base + req.params.name, { responseType: 'arraybuffer', timeout: 15000 });
    res.setHeader('Content-Type', r.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(r.data));
  } catch (err) {
    res.status(500).send('Image error');
  }
});

// ── Auto-Signal: KI generiert Signal und sendet an Trading Bot ──────────────
const TRADING_BOT_URL = process.env.TRADING_BOT_URL || 'https://trading-bot-production-86d8.up.railway.app';

app.post('/api/signal', async (req, res) => {
  const { strategie = 'mittel', dryRun = false } = req.body;
  try {
    // 1. Gold-Preis für SL/TP Berechnung
    let currentPrice = 3200;
    try {
      const gp = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=5d',
        { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
      const closes = gp.data.chart.result[0].indicators.quote[0].close.filter(Boolean);
      currentPrice = closes[closes.length - 1];
    } catch {}

    // 2. Claude analysiert und generiert Signal
    const msg = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 512,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Aktueller Goldpreis: $${currentPrice.toFixed(2)}

Analysiere den Goldmarkt JETZT (April 2026) und generiere ein präzises Trading-Signal.

Strategie-Parameter:
- Win-Rate: 56%, Profit Factor: 1.7, Max Drawdown: 32%
- Nur traden wenn Konfidenz > 65%

Gib NUR dieses JSON zurück:
{"signal":"BUY","confidence":75,"sl":${(currentPrice * 0.985).toFixed(2)},"tp":${(currentPrice * 1.025).toFixed(2)},"reason":"kurze Begründung","skip":false}

Wenn kein klares Signal: {"skip":true,"reason":"Kein klares Signal"}` }]
    });

    const text = msg.content.find(b => b.type === 'text')?.text || '{}';
    const m = text.match(/\{[\s\S]*\}/);
    const signal = JSON.parse(m[0]);

    if (signal.skip) {
      return res.json({ status: 'skipped', reason: signal.reason });
    }

    // 3. Webhook an Trading Bot senden
    const payload = {
      side: signal.signal,
      sl: parseFloat(signal.sl),
      tp: parseFloat(signal.tp)
    };

    let botResponse = null;
    if (!dryRun) {
      try {
        const endpoint = `${TRADING_BOT_URL}/webhook/${strategie}`;
        const r = await axios.post(endpoint, payload, { timeout: 10000 });
        botResponse = r.data;
      } catch (e) {
        botResponse = { error: e.message };
      }
    }

    res.json({
      status: 'sent',
      signal,
      payload,
      botResponse,
      dryRun,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('/api/signal:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Market View: gibt Sentiment + SL/TP Empfehlung zurück ───────────────────
app.get('/api/market-view', async (req, res) => {
  try {
    // Gold-Preis holen
    let currentPrice = 3200;
    let atr = 35; // Default ATR
    try {
      const gp = await axios.get('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=20d',
        { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
      const closes = gp.data.chart.result[0].indicators.quote[0].close.filter(Boolean);
      currentPrice = closes[closes.length - 1];
      // ATR berechnen (vereinfacht)
      const highs = gp.data.chart.result[0].indicators.quote[0].high.filter(Boolean);
      const lows = gp.data.chart.result[0].indicators.quote[0].low.filter(Boolean);
      const ranges = highs.map((h, i) => h - lows[i]);
      atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    } catch {}

    const msg = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 512,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Aktueller Goldpreis: $${currentPrice.toFixed(2)}, ATR (20 Tage): $${atr.toFixed(2)}

Analysiere den Goldmarkt JETZT. Eine offene Long-Position läuft.
Empfehle wie SL und TP angepasst werden sollen.

Gib NUR dieses JSON zurück:
{
  "sentiment": "bullish",
  "score": 3,
  "sl_action": "tighten",
  "sl_adjustment_pct": -0.5,
  "tp_action": "extend",
  "tp_adjustment_pct": 1.2,
  "confidence": 72,
  "reason": "kurze Begründung max 15 Wörter"
}

sl_action: "tighten" (enger), "loosen" (weiter), "keep" (behalten)
tp_action: "extend" (weiter), "reduce" (enger), "keep" (behalten)
sl_adjustment_pct: % Änderung vom aktuellen SL (negativ = enger bei Long)
tp_adjustment_pct: % Änderung vom aktuellen TP (positiv = weiter bei Long)` }]
    });

    const text = msg.content.find(b => b.type === 'text')?.text || '{}';
    const m = text.match(/\{[\s\S]*\}/);
    const view = JSON.parse(m[0]);

    res.json({ ...view, price: currentPrice, atr, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('/api/market-view:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Trading Bot Proxy ────────────────────────────────────────────────────────
app.get('/api/trading-performance', async (req, res) => {
  try {
    const r = await axios.get(`${TRADING_BOT_URL}/api/performance`, { timeout: 15000 });
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trading-adjust', async (req, res) => {
  try {
    const r = await axios.post(`${TRADING_BOT_URL}/api/auto-adjust`,
      req.body, { timeout: 60000 });
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GeoJSON proxy (cached)
let geoJsonCache = null;
app.get('/api/geojson', async (req, res) => {
  try {
    if (geoJsonCache) return res.json(geoJsonCache);
    const r = await axios.get(
      'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson',
      { timeout: 15000 }
    );
    geoJsonCache = r.data;
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Server-seitige Automatik ──────────────────────────
let autoInterval  = null;
let autoConfig    = { strategie: 'goldglobe', intervalMins: 60 };
let letzteSignale = [];

async function runAutoSignal() {
  console.log(`🤖 Auto-Signal läuft [${autoConfig.strategie}]...`);
  try {
    let currentPrice = 3200;
    try {
      const gp = await axios.get(
        'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=5d',
        { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }
      );
      const closes = gp.data.chart.result[0].indicators.quote[0].close.filter(Boolean);
      currentPrice = closes[closes.length - 1];
    } catch(e) { console.log('Preis-Fallback genutzt:', e.message); }

    const msg = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 512,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content:
        `Aktueller Goldpreis: $${currentPrice.toFixed(2)}\n\n` +
        `Analysiere den Goldmarkt JETZT und generiere ein präzises Trading-Signal.\n\n` +
        `Strategie-Parameter:\n- Win-Rate: 56%, Profit Factor: 1.7, Max Drawdown: 32%\n- Nur traden wenn Konfidenz > 65%\n\n` +
        `Gib NUR dieses JSON zurück:\n` +
        `{"signal":"BUY","confidence":75,"sl":${(currentPrice*0.985).toFixed(2)},"tp":${(currentPrice*1.025).toFixed(2)},"reason":"kurze Begründung","skip":false}\n\n` +
        `Wenn kein klares Signal: {"skip":true,"reason":"Kein klares Signal"}`
      }]
    });

    const text   = msg.content.find(b => b.type === 'text')?.text || '{}';
    const match  = text.match(/\{[\s\S]*\}/);
    const signal = JSON.parse(match[0]);

    const logEntry = {
      ts:          new Date().toISOString(),
      strategie:   autoConfig.strategie,
      signal:      signal.skip ? 'SKIP' : signal.signal,
      confidence:  signal.confidence || null,
      reason:      signal.reason,
      botResponse: null
    };

    if (!signal.skip) {
      try {
        const r = await axios.post(
          `${TRADING_BOT_URL}/webhook/${autoConfig.strategie}`,
          { side: signal.signal, sl: parseFloat(signal.sl), tp: parseFloat(signal.tp) },
          { timeout: 10000 }
        );
        logEntry.botResponse = r.data;
        console.log(`✅ Auto-Signal gesendet: ${signal.signal} | Konfidenz: ${signal.confidence}%`);
      } catch(e) {
        logEntry.botResponse = { error: e.message };
        console.error('❌ Bot-Webhook Fehler:', e.message);
      }
    } else {
      console.log(`⏭ Übersprungen: ${signal.reason}`);
    }

    letzteSignale.unshift(logEntry);
    if (letzteSignale.length > 50) letzteSignale.pop();

  } catch(e) {
    console.error('❌ Auto-Signal Fehler:', e.message);
  }
}

app.post('/api/auto/start', (req, res) => {
  const { strategie = 'goldglobe', intervalMins = 60 } = req.body;
  if (autoInterval) clearInterval(autoInterval);
  autoConfig = { strategie, intervalMins };
  runAutoSignal();
  autoInterval = setInterval(runAutoSignal, intervalMins * 60 * 1000);
  console.log(`▶ Automatik gestartet: alle ${intervalMins} Min [${strategie}]`);
  res.json({ ok: true, strategie, intervalMins });
});

app.post('/api/auto/stop', (req, res) => {
  if (autoInterval) { clearInterval(autoInterval); autoInterval = null; }
  console.log('⏹ Automatik gestoppt');
  res.json({ ok: true });
});

app.get('/api/auto/status', (req, res) => {
  res.json({ aktiv: !!autoInterval, ...autoConfig, letzteSignale });
});

app.listen(PORT, () => console.log(`🌍 Gold Globe läuft auf http://localhost:${PORT}`));
