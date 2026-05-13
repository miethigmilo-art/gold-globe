# Der größte bot — Brain

Diese Datei ist das persistente Gedächtnis des Bots. Du kannst sie in Obsidian
direkt editieren. Der Bot liest sie beim Start und nach jedem Tick erneut,
falls sie sich extern geändert hat. Konflikt-Resolution: User-Edit gewinnt.

## Watchlist

- GOLD
- EURUSD
- US500

## Active Pauses

## News Feeds

- https://www.investing.com/rss/news_25.rss
- https://www.fxstreet.com/rss/news
- https://feeds.reuters.com/reuters/businessNews
- https://www.cnbc.com/id/10000664/device/rss/rss.html

## Strategy Stats

```yaml
trendFollow:
  trades: 0
  winRate: 0
  pnl: 0
  mult: 1.0
  recent: []
meanReversion:
  trades: 0
  winRate: 0
  pnl: 0
  mult: 1.0
  recent: []
breakout:
  trades: 0
  winRate: 0
  pnl: 0
  mult: 1.0
  recent: []
```

## Lessons Learned

- (Bot trägt hier nach Trades automatisch Beobachtungen ein. Du kannst frei
  editieren — der Bot überschreibt diese Sektion nur additiv, nie destruktiv.)

## AI Audit Log

## Open Questions

- Soll der Bot Krypto auch außerhalb der Marktöffnung handeln?
- Welche Timeframes priorisieren bei Konflikt zwischen Strategien?
