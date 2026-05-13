# Der größte bot

Ein lernender Multi-Strategie Trading-Bot für Capital.com mit persistentem
Gedächtnis in einer Obsidian-Markdown-Datei.

## Vision

- Tradet beliebige Instrumente, die Capital.com anbietet (FX, Indizes, Aktien,
  Krypto, Rohstoffe)
- Mehrere Strategien laufen parallel, jede bekommt ein Kapital-Gewicht
- Performance pro Strategie wird beobachtet; Gewichte werden adaptiv
  angepasst (Kelly-Anlehnung) — Strategien mit positivem Edge bekommen mehr,
  schlechte werden gedrosselt
- Gedächtnis (Memory) liegt in `memory/brain.md` als strukturierte
  Markdown-Datei: Bot liest beim Start, schreibt nach jeder Session
- Signal-Quellen: (a) eigene Strategien auf Capital.com-Candles,
  (b) TradingView-Webhooks (Pine-Strategien posten an unseren `/webhook`)

## Aktueller Stand (Scaffold)

```
src/
├── index.js          orchestrator + tick + news-tick   ✓ skeleton
├── capital.js        Capital.com REST-Client           ✓ login/order/positions
├── data.js           Indikatoren                       ✓
├── memory.js         Obsidian markdown read/write      ✓
├── learner.js        Kelly-Gewichtung                  ✓
├── risk.js           Sizing/Drawdown/Tages-Stop        ✓
├── news.js           RSS-Polling + Dedupe              ✓
├── ai.js             Claude-API News-Scoring           ✓ (output_config.format JSON-Schema)
└── strategies/
    └── index.js      trendFollow / meanRev / breakout  ✓ Logik, nicht backtested

memory/
└── brain.md          Persistenter Bot-Speicher         ✓
```

**AI-Reaktionen auf News:**

- Claude-Modell bewertet jedes News-Item gegen die Watchlist
- Verdict-Schema: `action ∈ {NONE, OPEN_TRADE, FILTER_STRENGTHEN, FILTER_BLOCK, EMERGENCY_CLOSE}` + `confidence` 0-1
- `OPEN_TRADE` nur bei `confidence > 0.8` UND `AI_MIN_CONFIDENCE` Threshold
- AI-Trades nutzen `AI_TRADE_SIZE_FACTOR` (default 0.5) auf den Risk-Multiplikator → kleinere Positionen als Strategie-Trades
- Risk-Gate (Drawdown, Tages-Stop) gilt auch für AI-Trades
- Jeder AI-Trade wird in `memory/brain.md` → `## AI Audit Log` festgehalten

**Was fehlt für Produktiv-Einsatz:**

1. Backtesting-Framework (`src/backtest.js` muss noch entstehen)
2. Live-Datenstream / Tick-Handler — aktuell pollt der Bot, kein WebSocket
3. Telegram/Discord-Notifications (kann aus dem bestehenden `trading-bot`
   übernommen werden)
4. Persistenter Trade-Log (`memory/trades.jsonl` ist vorgesehen)
5. Echte Strategien — die drei mitgelieferten sind reine Templates, kein Edge

## Start

```bash
cp .env.example .env       # Capital.com-Credentials eintragen
npm install
node src/index.js           # läuft im DRY-RUN, kein echter Trade
node src/index.js --live    # echte Orders (Vorsicht!)
```

## Memory-Konzept

Der Bot **liest beim Start** `memory/brain.md` und parsed die Sektionen:

- `## Strategy Stats` — Trades, Win-Rate, PnL pro Strategie
- `## Lessons Learned` — Freitext, vom User editierbar
- `## Watchlist` — Instrumente, die der Bot beobachten soll
- `## Active Pauses` — Strategien die manuell pausiert sind

Der Bot **schreibt zurück** nach jedem Trade-Tick: aktualisierte Stats,
neue Erkenntnisse (z.B. "EUR/USD 2 Tage in Folge in Sideways verloren →
Strategie 'trendFollow' für EUR/USD pausiert").

Du kannst die Datei in Obsidian editieren — der Bot übernimmt deine
Änderungen beim nächsten Read-Zyklus. Konflikt-Resolution: User gewinnt.

## TradingView-Zugriff

Direkter Browser-/API-Zugriff auf TradingView-Charts ist **nicht** möglich —
TradingView hat kein öffentliches API, Scraping verletzt die TOS, und
inoffizielle Lösungen (TVDatafeed, tradingview-scraper) brechen regelmäßig.

**Stattdessen:** TradingView-Pine-Strategien posten Signale per Webhook an
unseren Bot (genauso wie `trading-bot` es bereits macht). Charts visualisieren
wir per Capital.com-Candles. Details: siehe `NOTES.md`.
