class RiskManager {
  constructor({ baseRiskPct = 1.0, leverage = 5, reservePct = 20, maxDrawdownPct = 20, dailyStopPct = 5 } = {}) {
    this.baseRiskPct    = baseRiskPct;
    this.leverage       = leverage;
    this.reservePct     = reservePct;
    this.maxDrawdownPct = maxDrawdownPct;
    this.dailyStopPct   = dailyStopPct;
    this.dayStartEquity = null;
    this.dayDate        = null;
    this.peakEquity     = null;
  }

  noteEquity(equity) {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dayDate !== today) {
      this.dayDate        = today;
      this.dayStartEquity = equity;
    }
    if (this.peakEquity === null || equity > this.peakEquity) this.peakEquity = equity;
  }

  dailyPnLPct(equity) {
    if (!this.dayStartEquity) return 0;
    return (equity - this.dayStartEquity) / this.dayStartEquity * 100;
  }

  drawdownPct(equity) {
    if (!this.peakEquity) return 0;
    return (this.peakEquity - equity) / this.peakEquity * 100;
  }

  allowed(equity) {
    if (this.drawdownPct(equity) >= this.maxDrawdownPct)  return { ok: false, reason: 'max drawdown' };
    if (this.dailyPnLPct(equity)  <= -this.dailyStopPct)  return { ok: false, reason: 'daily stop' };
    if (this.dailyPnLPct(equity)  >=  this.dailyStopPct)  return { ok: false, reason: 'daily target' };
    return { ok: true };
  }

  positionSize({ equity, entry, stop, multiplier = 1.0 }) {
    const slDist = Math.abs(entry - stop);
    if (slDist === 0) return 0;
    const usable      = equity * (this.reservePct / 100);
    const riskCapital = usable * (this.baseRiskPct * multiplier / 100);
    let size = riskCapital / slDist;
    const maxValue = usable * this.leverage;
    if (size * entry > maxValue) size = maxValue / entry;
    return size;
  }
}

module.exports = { RiskManager };
