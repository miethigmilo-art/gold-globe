require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { CapitalClient } = require('./capital');
const { toSeries }      = require('./data');
const { Memory }        = require('./memory');
const { Learner }       = require('./learner');
const { RiskManager }   = require('./risk');
const { REGISTRY }      = require('./strategies');

const LIVE = process.argv.includes('--live');
const TICK = parseInt(process.env.TICK_INTERVAL_MS || '60000', 10);

function log(...a) { console.log(new Date().toISOString(), ...a); }

function parseWatchlist(md) {
  return md.split('\n')
    .map(l => l.replace(/^[-*]\s+/, '').trim())
    .filter(l => l && !l.startsWith('#'));
}

function parsePauses(md) {
  return new Set(md.split('\n')
    .map(l => l.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean));
}

async function evaluateOnce(ctx) {
  const { client, memory, learner, risk } = ctx;

  if (memory.externallyChanged()) {
    log('memory file changed externally — reloading');
    memory.load();
    learner.loadFromStats(memory.getStrategyStats());
  }

  const watchlist = parseWatchlist(memory.getSection('Watchlist'));
  const pauses    = parsePauses(memory.getSection('Active Pauses'));
  if (!watchlist.length) { log('watchlist empty — nothing to do'); return; }

  const acc = await client.getAccounts();
  const equity = acc.accounts?.[0]?.balance?.balance ?? 0;
  risk.noteEquity(equity);

  const gate = risk.allowed(equity);
  if (!gate.ok) { log('risk gate closed:', gate.reason); return; }

  for (const epic of watchlist) {
    for (const [name, strat] of Object.entries(REGISTRY)) {
      if (pauses.has(`${name}:${epic}`) || pauses.has(name)) continue;

      let candles;
      try { candles = await client.candles(epic, strat.timeframe, 250); }
      catch (e) { log(`candles ${epic} ${strat.timeframe}:`, e.response?.data || e.message); continue; }

      const series = toSeries(candles);
      const signal = strat.fn(series);
      if (!signal) continue;

      const mult = learner.multiplier(name);
      const size = risk.positionSize({ equity, entry: signal.entry, stop: signal.stop, multiplier: mult });
      if (size <= 0) continue;

      log(`signal [${name}] ${epic} ${signal.side} entry=${signal.entry} sl=${signal.stop} tp=${signal.target} size=${size.toFixed(4)} mult=${mult.toFixed(2)}`);

      if (!LIVE) { log('DRY-RUN — order skipped'); continue; }

      try {
        const r = await client.openPosition({
          epic, direction: signal.side, size,
          stopLevel: signal.stop, profitLevel: signal.target
        });
        log('order placed:', r);
      } catch (e) {
        log('order failed:', e.response?.data || e.message);
      }
    }
  }

  memory.setStrategyStats(learner.exportStats());
  memory.flush();
}

async function main() {
  const memoryFile = process.env.MEMORY_FILE || 'memory/brain.md';
  if (!fs.existsSync(memoryFile)) {
    console.error(`memory file not found: ${memoryFile}`);
    process.exit(1);
  }

  const client = new CapitalClient({
    apiKey:   process.env.CAPITAL_API_KEY,
    email:    process.env.CAPITAL_EMAIL,
    password: process.env.CAPITAL_PASSWORD,
    baseUrl:  process.env.CAPITAL_BASE_URL
  });
  const memory  = new Memory(memoryFile);
  const learner = new Learner();
  const risk    = new RiskManager();

  memory.load();
  learner.loadFromStats(memory.getStrategyStats());

  log(`starting — LIVE=${LIVE} tick=${TICK}ms watchlist=${parseWatchlist(memory.getSection('Watchlist')).length}`);

  const ctx = { client, memory, learner, risk };
  await evaluateOnce(ctx);
  setInterval(() => { evaluateOnce(ctx).catch(e => log('tick error:', e.message)); }, TICK);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
