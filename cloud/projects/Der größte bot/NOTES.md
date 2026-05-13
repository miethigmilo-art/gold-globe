# Notizen + Design-Entscheidungen

## Warum kein direkter TradingView-Zugriff

TradingView bietet **kein öffentliches API** für Chartdaten. Optionen, die
existieren:

| Option | Problem |
|---|---|
| `tvdatafeed` / `tradingview-scraper` (pip) | Reverse-engineered, bricht bei jedem TV-Update, verletzt TOS |
| Headless-Browser (Playwright/Puppeteer auf tradingview.com) | Same TOS-Issue + Cloudflare-Bot-Detection + Captcha |
| TV Premium "Custom Indicators" API | nur Read auf eigene Indikatoren, kein Zugriff auf Charts |
| TV-Webhooks aus Pine | **Funktioniert** — Pine-Strategie auf TV läuft, postet JSON an Bot-Endpoint |

**Entscheidung:** Signale kommen über Webhooks rein (wie im `trading-bot`
bereits etabliert). Charts und Indikatoren rechnen wir selbst aus
Capital.com-Candles (`src/data.js`). Wenn der User später unbedingt TV-Charts
visuell will, geht das nur über das TV-Web-UI im Browser — nicht der Bot.

## Lern-Modell

Der Bot ist **nicht** ML im engeren Sinn (kein Neural Net, kein Reinforcement
Learning). Stattdessen:

- Pro Strategie: rollender Lookback (default N=30 Trades)
- Win-Rate p, durchschnittliches R = avgWin / avgLoss
- Kelly-Fraktion: `f = p - (1-p)/R`
- Multiplier auf Base-Risk: `clamp(0.5 + f*2, 0.5, 1.5)`
- Bei 3 Verlust-Trades in Folge: Strategy-Mult = 0.5 (Streak-Schutz)

Vorteil: deterministisch, transparent, debug-bar. ML kommt rein wenn die
Grundmechanik 6+ Monate stabil läuft und genug Daten da sind.

## Memory-File als "Brain"

Statt SQLite oder JSON-State-File: **Markdown** in Obsidian-Format.

Begründung:
- User kann Memory live lesen, kommentieren, korrigieren
- Versionierung über git (Diff in cloud/projects/Der größte bot/memory/)
- Lessons-Learned-Sektion ist semi-strukturierter Freitext, ideal für Human +
  Bot gemeinsam zu pflegen
- Strategy-Stats bleiben strukturiert (YAML-Block innerhalb Markdown)

Risiko: Schreibkonflikt wenn User editiert während Bot schreibt. Lösung im
Scaffold: Bot schreibt atomar (temp-file + rename), und vor jedem Read
hash-Vergleich; bei externem Edit übernimmt User-Version komplett.

## Capital.com Spezifika

- Demo + Live über gleichen `BASE_URL` (per `.env`)
- Session: CST + X-SECURITY-TOKEN, 10 Min TTL → Auto-Relogin bei 401
- Order: `POST /positions` mit `epic`, `direction`, `size`, `stopLevel`,
  `profitLevel`
- Candles: `GET /prices/{epic}?resolution=MINUTE_5&max=500`
- Rate-Limit: ca. 10 req/sec — Bot drosselt selbst

## Sicherheits-Defaults

- Default ist `--dry-run` (kein echter Order). `--live` muss explizit gesetzt
  werden
- Max-Drawdown pro Strategie (default 20 %): bei Überschreitung Auto-Pause
- Tages-Verlust-Stop: konfigurierbar pro Strategie
- Keine Pyramidierung: nur eine offene Position pro (Strategie, Epic)
