const { ema, rsi, atr, highestHigh, lowestLow } = require('../data');

function trendFollow(series, params = {}) {
  const { emaLen = 200, swingLen = 18, rsiFilter = 55, slATR = 2.0, minRRR = 2.0 } = params;
  if (series.length < emaLen + 2) return null;

  const closes = series.map(c => c.c);
  const lastC  = closes[closes.length - 1];
  const prevC  = closes[closes.length - 2];
  const ema200 = ema(closes, emaLen);
  const a      = atr(series, 14);
  const r      = rsi(closes, 14);
  const hh     = highestHigh(series.slice(0, -1), swingLen);
  const ll     = lowestLow(series.slice(0, -1),  swingLen);

  if (lastC > hh && prevC <= hh && lastC > ema200 && r > rsiFilter) {
    const stop = Math.min(lastC - a * slATR, ll);
    return { side: 'BUY', entry: lastC, stop, target: lastC + (lastC - stop) * minRRR };
  }
  if (lastC < ll && prevC >= ll && lastC < ema200 && r < (100 - rsiFilter)) {
    const stop = Math.max(lastC + a * slATR, hh);
    return { side: 'SELL', entry: lastC, stop, target: lastC - (stop - lastC) * minRRR };
  }
  return null;
}

function meanReversion(series, params = {}) {
  const { rsiBuy = 30, rsiSell = 70, rangeLen = 20, slATR = 1.0, tpATR = 0.8 } = params;
  if (series.length < rangeLen + 15) return null;

  const closes = series.map(c => c.c);
  const lastC  = closes[closes.length - 1];
  const r      = rsi(closes, 14);
  const a      = atr(series, 14);
  const hh     = highestHigh(series.slice(0, -1), rangeLen);
  const ll     = lowestLow(series.slice(0, -1),  rangeLen);

  if (r < rsiBuy && lastC <= ll * 1.002) {
    return { side: 'BUY', entry: lastC, stop: lastC - a * slATR, target: lastC + a * tpATR };
  }
  if (r > rsiSell && lastC >= hh * 0.998) {
    return { side: 'SELL', entry: lastC, stop: lastC + a * slATR, target: lastC - a * tpATR };
  }
  return null;
}

function breakout(series, params = {}) {
  const { lookback = 50, slATR = 1.5, minRRR = 2.0 } = params;
  if (series.length < lookback + 15) return null;

  const lastC = series[series.length - 1].c;
  const a     = atr(series, 14);
  const hh    = highestHigh(series.slice(0, -1), lookback);
  const ll    = lowestLow(series.slice(0, -1),  lookback);

  if (lastC > hh) {
    const stop = lastC - a * slATR;
    return { side: 'BUY', entry: lastC, stop, target: lastC + (lastC - stop) * minRRR };
  }
  if (lastC < ll) {
    const stop = lastC + a * slATR;
    return { side: 'SELL', entry: lastC, stop, target: lastC - (stop - lastC) * minRRR };
  }
  return null;
}

const REGISTRY = {
  trendFollow:    { fn: trendFollow,    timeframe: 'MINUTE_15' },
  meanReversion:  { fn: meanReversion,  timeframe: 'MINUTE_5'  },
  breakout:       { fn: breakout,       timeframe: 'MINUTE_30' }
};

module.exports = { REGISTRY };
