class Learner {
  constructor({ lookback = 30, minTrades = 10, minMult = 0.5, maxMult = 1.5 } = {}) {
    this.lookback  = lookback;
    this.minTrades = minTrades;
    this.minMult   = minMult;
    this.maxMult   = maxMult;
    this.trades    = {};
  }

  loadFromStats(stats) {
    for (const [name, s] of Object.entries(stats || {})) {
      this.trades[name] = Array.isArray(s.recent) ? s.recent : [];
    }
  }

  record(strategy, pnl) {
    if (!this.trades[strategy]) this.trades[strategy] = [];
    this.trades[strategy].push(pnl);
    if (this.trades[strategy].length > this.lookback) this.trades[strategy].shift();
  }

  streakLossing(strategy, n = 3) {
    const ts = this.trades[strategy] || [];
    if (ts.length < n) return false;
    return ts.slice(-n).every(p => p <= 0);
  }

  multiplier(strategy) {
    const ts = this.trades[strategy] || [];
    if (ts.length < this.minTrades) return 1.0;
    if (this.streakLossing(strategy)) return this.minMult;

    let wins = 0, grossWin = 0, grossLoss = 0;
    for (const p of ts) {
      if (p > 0) { wins++; grossWin += p; }
      else       { grossLoss += -p; }
    }
    const n       = ts.length;
    const winRate = wins / n;
    const lossCount = n - wins;
    const avgWin  = wins ? grossWin / wins : 0;
    const avgLoss = lossCount ? grossLoss / lossCount : 0;
    const r       = avgLoss > 0 ? avgWin / avgLoss : 1;
    const kelly   = winRate - (1 - winRate) / r;
    return Math.max(this.minMult, Math.min(this.maxMult, 0.5 + kelly * 2));
  }

  statsFor(strategy) {
    const ts    = this.trades[strategy] || [];
    const wins  = ts.filter(p => p > 0).length;
    const total = ts.reduce((a, b) => a + b, 0);
    return {
      trades:  ts.length,
      winRate: ts.length ? (wins / ts.length).toFixed(2) : 0,
      pnl:     total.toFixed(2),
      mult:    this.multiplier(strategy).toFixed(2),
      recent:  ts
    };
  }

  exportStats() {
    const out = {};
    for (const name of Object.keys(this.trades)) out[name] = this.statsFor(name);
    return out;
  }
}

module.exports = { Learner };
