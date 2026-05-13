function toSeries(capitalCandles) {
  return capitalCandles.prices.map(p => ({
    t:    p.snapshotTimeUTC,
    o:    p.openPrice.bid,
    h:    p.highPrice.bid,
    l:    p.lowPrice.bid,
    c:    p.closePrice.bid,
    vol:  p.lastTradedVolume || 0
  }));
}

function sma(values, n) {
  if (values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

function ema(values, n) {
  if (values.length < n) return null;
  const k = 2 / (n + 1);
  let e = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const avgG = gains / n, avgL = losses / n;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function atr(series, n = 14) {
  if (series.length < n + 1) return null;
  const trs = [];
  for (let i = series.length - n; i < series.length; i++) {
    const c = series[i], p = series[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  return trs.reduce((a, b) => a + b, 0) / n;
}

function highestHigh(series, n) {
  return Math.max(...series.slice(-n).map(c => c.h));
}

function lowestLow(series, n) {
  return Math.min(...series.slice(-n).map(c => c.l));
}

module.exports = { toSeries, sma, ema, rsi, atr, highestHigh, lowestLow };
