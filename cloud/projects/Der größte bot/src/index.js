require('dotenv').config();
const fs = require('fs');
const { CapitalClient } = require('./capital');
const { toSeries }      = require('./data');
const { Memory }        = require('./memory');
const { Learner }       = require('./learner');
const { RiskManager }   = require('./risk');
const { REGISTRY }      = require('./strategies');
const { NewsFeed }      = require('./news');
const { AiAdvisor }     = require('./ai');

const LIVE = process.argv.includes('--live');
const TICK = parseInt(process.env.TICK_INTERVAL_MS || '60000', 10);
const NEWS_TICK = parseInt(process.env.NEWS_POLL_INTERVAL_MS || '300000', 10);
const MIN_CONF  = parseFloat(process.env.AI_MIN_CONFIDENCE || '0.75');
const AI_MAX_NEWS = parseInt(process.env.AI_MAX_NEWS_PER_TICK || '6', 10);
const AI_SIZE_FACTOR = parseFloat(process.env.AI_TRADE_SIZE_FACTOR || '0.5');

function log(...a) { console.log(new Date().toISOString(), ...a); }

function parseList(md) {
  return md.split('\n')
    .map(l => l.replace(/^[-*]\s+/, '').trim())
    .filter(l => l && !l.startsWith('#'));
}

const RUNTIME = {
  filterStrengthen: new Map(),
  filterBlock:      new Map()
};

function filterExpired(map, now = Date.now()) {
  for (const [k, until] of map) if (until <= now) map.delete(k);
}

async function evaluateOnce(ctx) {
  const { client, memory, learner, risk } = ctx;
  filterExpired(RUNTIME.filterStrengthen);
  filterExpired(RUNTIME.filterBlock);

  if (memory.externallyChanged()) {
    log('memory changed externally — reload');
    memory.load();
    learner.loadFromStats(memory.getStrategyStats());
  }

  const watchlist = parseList(memory.getSection('Watchlist'));
  const pauses    = new Set(parseList(memory.getSection('Active Pauses')));
  if (!watchlist.length) { log('watchlist empty'); return; }

  const acc = await client.getAccounts();
  const equity = acc.accounts?.[0]?.balance?.balance ?? 0;
  risk.noteEquity(equity);

  const gate = risk.allowed(equity);
  if (!gate.ok) { log('risk gate closed:', gate.reason); return; }

  for (const epic of watchlist) {
    if (RUNTIME.filterBlock.has(epic) || RUNTIME.filterBlock.has('*')) {
      log(`[ai-block] ${epic} pausiert`);
      continue;
    }

    for (const [name, strat] of Object.entries(REGISTRY)) {
      if (pauses.has(`${name}:${epic}`) || pauses.has(name)) continue;

      let candles;
      try { candles = await client.candles(epic, strat.timeframe, 250); }
      catch (e) { log(`candles ${epic} ${strat.timeframe}:`, e.response?.data || e.message); continue; }

      const series = toSeries(candles);
      const signal = strat.fn(series);
      if (!signal) continue;

      const strengthen = RUNTIME.filterStrengthen.has(epic);
      const mult = learner.multiplier(name) * (strengthen ? 0.5 : 1);
      const size = risk.positionSize({ equity, entry: signal.entry, stop: signal.stop, multiplier: mult });
      if (size <= 0) continue;

      log(`signal [${name}] ${epic} ${signal.side} entry=${signal.entry} sl=${signal.stop} tp=${signal.target} size=${size.toFixed(4)} mult=${mult.toFixed(2)}${strengthen ? ' [strengthened]' : ''}`);
      if (!LIVE) { log('DRY-RUN — order skipped'); continue; }

      try {
        await client.openPosition({
          epic, direction: signal.side, size,
          stopLevel: signal.stop, profitLevel: signal.target
        });
        log('order placed');
      } catch (e) { log('order failed:', e.response?.data || e.message); }
    }
  }

  memory.setStrategyStats(learner.exportStats());
  memory.flush();
}

async function applyAiVerdict({ client, memory, risk }, verdict, newsItem) {
  if (verdict.confidence < MIN_CONF) return;
  log(`[ai] action=${verdict.action} ${verdict.instrument || '-'} ${verdict.side || ''} conf=${verdict.confidence.toFixed(2)} urg=${verdict.urgencyMin}min :: ${verdict.reasoning}`);

  const until = Date.now() + Math.max(15, verdict.urgencyMin) * 60_000;

  switch (verdict.action) {
    case 'FILTER_STRENGTHEN':
      if (verdict.instrument) RUNTIME.filterStrengthen.set(verdict.instrument, until);
      break;

    case 'FILTER_BLOCK':
      RUNTIME.filterBlock.set(verdict.instrument || '*', until);
      break;

    case 'EMERGENCY_CLOSE':
      try {
        const open = await client.listPositions();
        for (const p of (open.positions || [])) {
          if (verdict.instrument && p.market?.epic !== verdict.instrument) continue;
          if (!LIVE) { log(`DRY-RUN — would close ${p.position?.dealId}`); continue; }
          await client.closePosition(p.position.dealId);
          log(`[ai] closed ${p.position.dealId} (${p.market?.epic})`);
        }
      } catch (e) { log('[ai] close failed:', e.response?.data || e.message); }
      break;

    case 'OPEN_TRADE':
      if (!verdict.instrument || !verdict.side) return;
      try {
        const mkt = await client.getMarket(verdict.instrument);
        const snap = mkt.snapshot;
        const entry = verdict.side === 'BUY' ? parseFloat(snap.offer) : parseFloat(snap.bid);
        const acc = await client.getAccounts();
        const equity = acc.accounts?.[0]?.balance?.balance ?? 0;
        const stopDist = entry * 0.005;
        const stop   = verdict.side === 'BUY' ? entry - stopDist : entry + stopDist;
        const target = verdict.side === 'BUY' ? entry + stopDist * 2 : entry - stopDist * 2;
        const size = risk.positionSize({ equity, entry, stop, multiplier: AI_SIZE_FACTOR });
        if (size <= 0) { log('[ai] size=0'); return; }

        log(`[ai] OPEN_TRADE ${verdict.instrument} ${verdict.side} size=${size.toFixed(4)} sl=${stop.toFixed(4)} tp=${target.toFixed(4)}`);
        if (!LIVE) { log('DRY-RUN — ai order skipped'); return; }
        await client.openPosition({ epic: verdict.instrument, direction: verdict.side, size, stopLevel: stop, profitLevel: target });
        appendAiAudit(memory, { ts: new Date().toISOString(), news: newsItem.title, verdict });
      } catch (e) { log('[ai] open failed:', e.response?.data || e.message); }
      break;
  }
}

function appendAiAudit(memory, entry) {
  const section = memory.getSection('AI Audit Log') || '';
  const line = `- ${entry.ts} :: ${entry.verdict.action} ${entry.verdict.instrument || ''} ${entry.verdict.side || ''} conf=${entry.verdict.confidence} :: "${entry.news}"`;
  const trimmed = section.split('\n').filter(Boolean).slice(-49).join('\n');
  memory.setSection('AI Audit Log', `${trimmed}\n${line}`.trim());
  memory.flush();
}

async function newsTick(ctx) {
  const { news, advisor, memory } = ctx;
  const feedsSection = memory.getSection('News Feeds');
  if (feedsSection) news.setFeeds(parseList(feedsSection));
  const watchlist = parseList(memory.getSection('Watchlist'));
  if (!watchlist.length) return;

  let items;
  try { items = await news.poll(); }
  catch (e) { log('news poll error:', e.message); return; }
  if (!items.length) return;
  log(`news: ${items.length} fresh items`);

  const batch = items.slice(0, AI_MAX_NEWS);
  let verdicts;
  try {
    verdicts = await advisor.score({
      news: batch,
      watchlist,
      recentLessons: memory.getSection('Lessons Learned').slice(0, 1500)
    });
  } catch (e) { log('ai score error:', e.message); return; }

  for (let i = 0; i < batch.length; i++) {
    const v = verdicts[i];
    if (!v) continue;
    await applyAiVerdict(ctx, v, batch[i]);
  }
}

async function main() {
  const memoryFile = process.env.MEMORY_FILE || 'memory/brain.md';
  if (!fs.existsSync(memoryFile)) { console.error(`memory file not found: ${memoryFile}`); process.exit(1); }

  const client = new CapitalClient({
    apiKey:   process.env.CAPITAL_API_KEY,
    email:    process.env.CAPITAL_EMAIL,
    password: process.env.CAPITAL_PASSWORD,
    baseUrl:  process.env.CAPITAL_BASE_URL
  });
  const memory  = new Memory(memoryFile);
  const learner = new Learner();
  const risk    = new RiskManager();
  const news    = new NewsFeed();
  memory.load();
  learner.loadFromStats(memory.getStrategyStats());

  const advisor = process.env.ANTHROPIC_API_KEY
    ? new AiAdvisor({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.AI_MODEL })
    : null;
  if (!advisor) log('ANTHROPIC_API_KEY fehlt — AI/News-Modul deaktiviert');

  log(`starting — LIVE=${LIVE} tick=${TICK}ms newsTick=${NEWS_TICK}ms ai=${!!advisor}`);

  const ctx = { client, memory, learner, risk, news, advisor };
  await evaluateOnce(ctx);
  setInterval(() => evaluateOnce(ctx).catch(e => log('tick error:', e.message)), TICK);

  if (advisor) {
    await newsTick(ctx);
    setInterval(() => newsTick(ctx).catch(e => log('news tick error:', e.message)), NEWS_TICK);
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
